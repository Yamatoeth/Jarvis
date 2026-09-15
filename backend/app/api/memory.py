from typing import Any, AsyncGenerator, List, Optional
import json
import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import pinecone_client as pinecone_module
from app.db import redis_client as redis_module

router = APIRouter()
logger = logging.getLogger(__name__)


class MemoryHit(BaseModel):
    id: str
    title: Optional[str] = None
    snippet: Optional[str] = None
    score: Optional[float] = None
    metadata: Optional[dict] = None


class SearchResponse(BaseModel):
    success: bool
    data: List[MemoryHit]
    error: Optional[str] = None


@router.get("/memory/search", response_model=SearchResponse)
async def memory_search(
    user_id: str = Query(...),
    query: str = Query(..., min_length=1),
    top_k: int = Query(5, ge=1, le=50),
):
    """
    Search user's memory. Prefers Pinecone vector search if configured,
    otherwise falls back to a naive text scan of stored KB entries in Redis.
    """
    try:
        # Try Pinecone client first
        PineconeClient = getattr(pinecone_module, "PineconeClient", None)
        if PineconeClient:
            client = PineconeClient()
            # If client exposes async query/search
            if hasattr(client, "query"):
                results = await client.query(user_id=user_id, query=query, top_k=top_k)
            elif hasattr(client, "search"):
                results = await client.search(user_id=user_id, query=query, top_k=top_k)
            else:
                results = []

            hits: List[MemoryHit] = []
            for r in results or []:
                metadata = r.get("metadata") if isinstance(r, dict) else {}
                hits.append(
                    MemoryHit(
                        id=str(r.get("id") or metadata.get("kb_id", "")),
                        title=metadata.get("title") if metadata else None,
                        snippet=(metadata.get("snippet") or (metadata.get("content", "")[:200])) if metadata else None,
                        score=r.get("score") if isinstance(r, dict) else None,
                        metadata=metadata,
                    )
                )
            return SearchResponse(success=True, data=hits)

        # Fallback: naive Redis scan of kb entries
        get_redis = getattr(redis_module, "get_redis", None)
        if get_redis:
            r = await redis_module.get_redis()
            raw = await r.get(f"kb_entries:{user_id}")
            entries = json.loads(raw) if raw else []
            matches: List[MemoryHit] = []
            qlower = query.lower()
            for e in entries:
                content = (e.get("content") or "").lower()
                title = (e.get("title") or "").lower()
                if qlower in content or qlower in title:
                    matches.append(
                        MemoryHit(
                            id=e.get("id"),
                            title=e.get("title"),
                            snippet=(e.get("content") or "")[:200],
                            score=None,
                            metadata={"source": e.get("source")},
                        )
                    )
                    if len(matches) >= top_k:
                        break
            return SearchResponse(success=True, data=matches)

        # If no backend available, return empty
        return SearchResponse(success=True, data=[])
    except asyncio.TimeoutError:
        logger.warning("memory_search timed out")
        return SearchResponse(success=False, data=[], error="Search timed out")
    except (json.JSONDecodeError, ValueError) as e:
        logger.error("memory_search data error: %s", type(e).__name__)
        return SearchResponse(success=False, data=[], error=str(e))
    except Exception as exc:
        logger.exception("memory_search failed: %s", str(exc))
        return SearchResponse(success=False, data=[], error=str(exc))


async def _client_disconnected(request: Request) -> bool:
    try:
        return await request.is_disconnected()
    except (RuntimeError, ConnectionError):
        return True
    except Exception as e:
        logger.debug("Error checking client disconnection: %s", type(e).__name__)
        return False


async def _redis_pubsub_generator(user_id: str, request: Request) -> AsyncGenerator[str, None]:
    """
    Subscribe to Redis pubsub channel `memory_updates:{user_id}` and stream SSE messages.
    If Redis is not available, stream a short heartbeat and exit.
    """
    get_redis = getattr(redis_module, "get_redis", None)
    if not get_redis:
        # fallback: simple heartbeat then close
        for _ in range(3):
            if await _client_disconnected(request):
                return
            yield "event: heartbeat\ndata: {}\n\n"
            await asyncio.sleep(1)
        return

    redis = await redis_module.get_redis()
    try:
        # aioredis interface
        try:
            # use the low-level async client for pubsub
            pubsub = redis.client.pubsub()
            channel = f"memory_updates:{user_id}"
            await pubsub.subscribe(channel)
            while True:
                if await _client_disconnected(request):
                    break
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message:
                    data = message.get("data")
                    if isinstance(data, (bytes, bytearray)):
                        try:
                            s = data.decode()
                        except (UnicodeDecodeError, AttributeError) as e:
                            logger.debug("Error decoding message: %s", type(e).__name__)
                            s = str(data)
                    else:
                        s = json.dumps(data) if not isinstance(data, str) else data
                    yield f"data: {s}\n\n"
                else:
                    yield ":\n\n"
                    await asyncio.sleep(0.1)
        except (asyncio.TimeoutError, ConnectionError) as e:
            # fallback for other redis clients
            logger.warning("redis pubsub error: %s", type(e).__name__)
            for _ in range(3):
                if await _client_disconnected(request):
                    return
                yield "event: heartbeat\ndata: {}\n\n"
                await asyncio.sleep(1)
        except Exception as e:
            logger.exception("Unexpected error in redis pubsub: %s", str(e))
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except (RuntimeError, ConnectionError):
            pass
        except Exception as e:
            logger.debug("Error closing pubsub: %s", type(e).__name__)


@router.get("/stream/memory")
async def stream_memory(request: Request, user_id: str = Query(...)):
    """
    Server-Sent Events endpoint streaming memory update notifications for a user.
    Clients should connect with `Accept: text/event-stream`.
    """
    try:
        generator = _redis_pubsub_generator(user_id, request)
        return StreamingResponse(generator, media_type="text/event-stream")
    except Exception as exc:
        logger.exception("stream_memory failed")
        raise HTTPException(status_code=500, detail="stream error")


# --- Upsert API -------------------------------------------------------------


class UpsertItem(BaseModel):
    id: Optional[str] = None
    title: Optional[str]
    content: str
    source: Optional[str] = "client"


class UpsertRequest(BaseModel):
    user_id: str
    items: List[UpsertItem]


class UpsertResponse(BaseModel):
    success: bool
    added: int
    error: Optional[str] = None


@router.post("/memory/upsert", response_model=UpsertResponse)
async def memory_upsert(payload: UpsertRequest):
    """
    Persist provided KB entries into working memory (Redis) and publish
    a notification on `memory_updates:{user_id}`. If a background task
    scheduler is available (e.g. `app.tasks.fact_extraction.schedule_extract_facts`),
    schedule embedding/extraction jobs.
    """
    try:
        # normalize items
        items = []
        for it in payload.items:
            entry = {
                "id": it.id or None,
                "title": it.title or (it.content[:120] if it.content else ""),
                "content": it.content,
                "source": it.source or "client",
            }
            items.append(entry)

        # persist into working memory list under 'kb_entries'
        rc = await redis_module.get_redis()
        existing = await rc.get_working_memory(payload.user_id, "kb_entries") or []
        # assign ids for any missing
        import uuid

        new_entries = []
        for e in items:
            if not e.get("id"):
                e["id"] = str(uuid.uuid4())
            new_entries.append(e)

        combined = new_entries + existing
        await rc.set_working_memory(payload.user_id, "kb_entries", combined)

        # publish notifications for SSE subscribers
        try:
            # use low-level redis client for publish
            await rc.client.publish(f"memory_updates:{payload.user_id}", json.dumps({"type": "upsert", "count": len(new_entries)}))
        except (asyncio.TimeoutError, ConnectionError) as e:
            logger.warning("Failed to publish memory update: %s", type(e).__name__)
        except Exception as e:
            logger.exception("Unexpected error publishing memory update: %s", str(e))

        # schedule background extraction/embedding if available
        try:
            from app.tasks.fact_extraction import schedule_extract_facts

            # schedule per-item or a combined transcript summary; we'll pass concatenated content
            transcript = "\n\n".join([e.get("content", "") for e in new_entries])
            schedule_extract_facts(transcript, payload.user_id)
        except ImportError:
            logger.debug("Background task scheduler not available")
        except (asyncio.TimeoutError, ValueError) as e:
            logger.warning("Failed to schedule fact extraction: %s", type(e).__name__)
        except Exception as e:
            logger.debug("Unexpected error scheduling fact extraction: %s", type(e).__name__)

        return UpsertResponse(success=True, added=len(new_entries))
    except (asyncio.TimeoutError, ValueError) as e:
        logger.warning("memory_upsert error: %s", type(e).__name__)
        return UpsertResponse(success=False, added=0, error=str(e))
    except Exception as exc:
        logger.exception("memory_upsert failed: %s", str(exc))
        return UpsertResponse(success=False, added=0, error=str(exc))


@router.get("/working/{user_id}")
async def get_working_memory(user_id: str = Query(...)) -> dict:
    """Return working memory (Redis) for a user.

    Returns messages, state, and kb_summary from Redis.
    Used by the frontend contextService to fetch server-side context.
    """
    try:
        messages = await redis_client.get_messages(user_id, limit=20)
        state = await redis_client.get_user_state(user_id)
        kb_summary = await redis_client.get_working_memory(user_id, "kb_summary")
        return {
            "messages": messages,
            "state": state,
            "kb_summary": kb_summary,
        }
    except Exception as e:
        logger.exception("Failed to get working memory for user_id=%s: %s", user_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve working memory: {e}")


@router.delete("/messages/{user_id}")
async def clear_messages(user_id: str = Query(...)) -> dict:
    """Clear conversation history (Redis messages) for a user."""
    try:
        await redis_client.clear_messages(user_id)
        return {"status": "cleared", "user_id": user_id}
    except Exception as e:
        logger.exception("Failed to clear messages for user_id=%s: %s", user_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to clear messages: {e}")
