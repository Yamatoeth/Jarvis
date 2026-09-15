"""
Celery-aware durable fact extraction.

Extracted facts are written to PostgreSQL domain tables and logged in
`knowledge_updates`. Redis is refreshed only as a cache.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
import asyncio
import logging
import os
import uuid

from sqlalchemy import select

from app.core.config import get_settings
from app.core.fact_extractor import extract_facts, facts_to_kb_updates
from app.core.domain_config import MODEL_BY_DOMAIN
from app.db import models
from app.db.database import async_session_maker
from app.db.pinecone_client import pinecone_client, get_pinecone
from app.db.redis_client import redis_client
from app.providers import embedding_provider

logger = logging.getLogger(__name__)
settings = get_settings()

try:
    from celery import Celery

    CELERY_AVAILABLE = True
    broker = os.environ.get("CELERY_BROKER_URL", os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    celery_app = Celery("jarvis_tasks", broker=broker)

    @celery_app.task(
        bind=True,
        name="jarvis.extract_facts",
        autoretry_for=(Exception,),
        retry_backoff=True,
        retry_kwargs={"max_retries": 3},
    )
    def extract_facts_task(
        self,
        transcript: str,
        user_id: str,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        return asyncio.run(run_extract_facts(transcript, user_id, conversation_id))

except Exception:
    CELERY_AVAILABLE = False
    celery_app = None
    logger.info("Celery not available; fact extraction will run as an async background task")


async def _ensure_user(session, user_id: str) -> None:
    user = await session.get(models.User, user_id)
    if user is not None:
        return
    session.add(
        models.User(
            id=user_id,
            email=f"user-{user_id}@local.invalid",
            hashed_password="!",
            full_name=f"User {user_id[:8]}",
        )
    )
    await session.flush()


async def _apply_update(
    *,
    session,
    user_id: str,
    conversation_id: str | None,
    update: dict[str, Any],
) -> bool:
    domain = str(update.get("domain") or "identity")
    model_cls = MODEL_BY_DOMAIN.get(domain)
    if model_cls is None:
        logger.warning("Skipping extracted fact with unknown domain=%s", domain)
        return False

    field_name = str(update.get("field_name") or "statement")[:128]
    field_value = str(update.get("field_value") or "").strip()
    if not field_value:
        return False

    incoming_confidence = float(update.get("confidence", 0.5) or 0.5)
    source = str(update.get("source") or "conversation")[:50]

    result = await session.execute(
        select(model_cls).where(
            model_cls.user_id == user_id,
            model_cls.field_name == field_name,
        )
    )
    existing = result.scalars().first()

    old_value = None
    should_write = existing is None
    if existing is not None:
        old_value = existing.field_value
        existing_confidence = float(existing.confidence or 0.0)
        should_write = incoming_confidence >= existing_confidence

    if not should_write:
        return False

    if existing is None:
        session.add(
            model_cls(
                user_id=user_id,
                field_name=field_name,
                field_value=field_value,
                confidence=incoming_confidence,
                source=source,
                last_updated=datetime.utcnow(),
            )
        )
    else:
        existing.field_value = field_value
        existing.confidence = incoming_confidence
        existing.source = source
        existing.last_updated = datetime.utcnow()

    session.add(
        models.KnowledgeUpdate(
            user_id=user_id,
            conversation_id=conversation_id,
            table_name=model_cls.__tablename__,
            field_name=field_name,
            old_value=old_value,
            new_value=field_value,
            confidence=incoming_confidence,
            source=source,
        )
    )
    return True


async def _refresh_redis_summary(user_id: str) -> None:
    try:
        async with async_session_maker() as session:
            parts: list[str] = []
            for label, model_cls in MODEL_BY_DOMAIN.items():
                result = await session.execute(
                    select(model_cls)
                    .where(model_cls.user_id == user_id)
                    .order_by(model_cls.confidence.desc())
                    .limit(3)
                )
                rows = result.scalars().all()
                if rows:
                    facts = "; ".join(f"{row.field_name}: {row.field_value}" for row in rows)
                    parts.append(f"{label}: {facts}")
        if parts:
            await redis_client.set_working_memory(user_id, "kb_summary", " | ".join(parts), ttl_seconds=3600)
    except Exception:
        logger.exception("Failed to refresh Redis KB summary cache")


async def _upsert_episodic_memory(user_id: str, updates: list[dict[str, Any]]) -> None:
    if not pinecone_client.is_configured:
        return

    pc = get_pinecone()
    for update in updates:
        text = str(update.get("field_value") or "")
        if not text:
            continue
        embedding = await embedding_provider.embed_text(text)
        if not embedding:
            continue
        try:
            await pc.upsert_memory(
                memory_id=str(uuid.uuid4()),
                embedding=embedding,
                metadata={
                    "user_id": user_id,
                    "domain": update.get("domain"),
                    "field_name": update.get("field_name"),
                    "content": text,
                    "source": update.get("source", "conversation"),
                },
            )
        except Exception:
            logger.exception("Failed to upsert episodic memory")


async def run_extract_facts(
    transcript: str,
    user_id: str,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    facts = await extract_facts(transcript)
    updates = facts_to_kb_updates(facts)
    if not updates:
        return {"facts_extracted": 0, "updates_applied": 0}

    applied = 0
    async with async_session_maker() as session:
        await _ensure_user(session, user_id)
        for update in updates:
            if await _apply_update(
                session=session,
                user_id=user_id,
                conversation_id=conversation_id,
                update=update,
            ):
                applied += 1
        await session.commit()

    await _refresh_redis_summary(user_id)
    await _upsert_episodic_memory(user_id, updates)

    return {"facts_extracted": len(facts), "updates_applied": applied}


def _run_async_background(coro) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coro)
        return
    loop.create_task(coro)


def schedule_extract_facts(
    transcript: str,
    user_id: str,
    conversation_id: str | None = None,
) -> Optional[dict[str, Any]]:
    if CELERY_AVAILABLE and celery_app is not None:
        task = extract_facts_task.delay(transcript, user_id, conversation_id)
        return {"task_id": task.id}

    logger.info("Scheduling local async fact extraction fallback for user_id=%s", user_id)
    _run_async_background(run_extract_facts(transcript, user_id, conversation_id))
    return {"scheduled": "local_async"}


__all__ = ["schedule_extract_facts", "run_extract_facts", "extract_facts_task", "celery_app"]
