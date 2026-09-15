"""
WebSocket voice hot-path

Endpoint flow (hot path):
 1. Receive audio chunks over WebSocket (base64 JSON or binary frames)
 2. Assemble audio and run STT through the configured STT provider
 3. Build server-side context via `build_context`
 4. Stream LLM response back over the WebSocket
 5. Synthesize TTS audio through the configured TTS provider

Notes:
 - This implementation focuses on clarity and safe fallbacks. Production
   deployments should add authentication, rate limits, backpressure, and
   binary streaming support.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Any, Optional
import base64
import asyncio
import logging
import json
import re

from app.auth import decode_token
from app.core.config import get_settings
from app.core.context_builder import build_context
from app.core.prompt_engine import build_messages, strip_markdown_for_voice
from app.core.ws_protocol import (
    WS_READY,
    WS_STT_START,
    WS_STT_DONE,
    WS_ACK_AUDIO,
    WS_CONTEXT_BUILT,
    WS_LLM_CHUNK,
    WS_LLM_ERROR,
    WS_LLM_DONE,
    WS_TTS_AUDIO_CHUNK,
    WS_TTS_AUDIO_DONE,
    WS_TTS_AUDIO_BASE64,
    WS_ERROR,
    WS_IGNORED,
    WS_FINAL,
    WS_AUDIO_CHUNK,
)
from app.services.kokoro_service import kokoro_tts_service
from app.services.conversation_memory import append_turn
from app.providers import AudioMetadata, llm_provider, stt_provider, tts_provider
from app.tasks.fact_extraction import schedule_extract_facts

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)

IGNORED_TRANSCRIPTS = {
    "thank you",
    "thanks",
    "thank you.",
    "thanks.",
    "you",
}


def _is_probable_stt_artifact(transcript: str | None) -> bool:
    if not transcript:
        return True
    normalized = re.sub(r"[^a-zA-Z' ]+", "", transcript).strip().lower()
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized in IGNORED_TRANSCRIPTS


class TextQueryRequest(BaseModel):
    user_id: str
    query: str
    context: dict[str, Any] | None = None


class AudioPayloadMetadata(BaseModel):
    file_name: str = "audio.m4a"
    mime_type: str = "audio/mp4"
    voice: str | None = None
    speed: float | None = None
    lang: str | None = None


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = None
    lang: str | None = None


async def _safe_send_json(ws: WebSocket, payload: dict) -> bool:
    """Send JSON to websocket but swallow errors if socket closed.

    Returns True if send succeeded, False otherwise.
    """
    try:
        await ws.send_json(payload)
        return True
    except (RuntimeError, ConnectionError):
        logger.debug("WebSocket closed or send failed for type=%s", payload.get("type"))
        return False
    except Exception as e:
        logger.warning("Unexpected error sending WebSocket message: %s", type(e).__name__)
        return False


def _parse_speed(value: Any, fallback: float | None) -> float | None:
    """Coerce arbitrary payload speed into a float, keeping previous value on invalid input."""
    if value is None:
        return fallback
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return fallback
    return fallback


async def stream_chat_response(messages, websocket: WebSocket) -> str:
    """Stream chat completions through the configured LLM provider."""
    full_text = ""
    try:
        async for delta in llm_provider.stream_chat(messages):
            full_text += delta
            await _safe_send_json(websocket, {"type": WS_LLM_CHUNK, "data": delta})

    except asyncio.TimeoutError:
        logger.warning("LLM streaming timed out")
        await _safe_send_json(websocket, {"type": WS_LLM_ERROR, "message": "LLM streaming timed out"})
    except (ValueError, RuntimeError) as e:
        logger.error("LLM streaming error: %s", type(e).__name__)
        await _safe_send_json(websocket, {"type": WS_LLM_ERROR, "message": "LLM streaming failed"})
    except Exception as e:
        logger.exception("Unexpected error during LLM streaming: %s", str(e))
        await _safe_send_json(websocket, {"type": WS_LLM_ERROR, "message": "LLM streaming failed"})
    clean_text = strip_markdown_for_voice(full_text)
    await _safe_send_json(websocket, {"type": WS_LLM_DONE, "content": clean_text})
    return clean_text


def _build_local_response(user_input: str, context: Optional[dict[str, Any]] = None) -> str:
    """Local fallback so development remains usable without external providers."""
    context = context or {}
    character = context.get("character") or {}
    name = character.get("full_name") or "there"
    knowledge_summary = context.get("knowledge_summary") or {}
    summary = knowledge_summary.get("summary") or ""

    normalized = user_input.strip()
    lower = normalized.lower()

    if not normalized:
        return "I didn't catch a question yet. Ask me anything and I'll help."

    if any(token in lower for token in ("hello", "hi", "hey", "bonjour", "salut")):
        return f"Hello {name}. I'm ready. Ask me a question and I'll answer in local mode."

    if "who are you" in lower:
        return "I'm J.A.R.V.I.S., your assistant. In local mode I can still answer and help you test the app end to end."

    if "what do you know about me" in lower:
        if summary:
            return f"Here's the context I currently have about you: {summary}"
        return "I don't have much saved context yet, but the assistant path is working and ready for onboarding data."

    response = f"You asked: {normalized}\n\nHere is a local-mode answer while provider APIs are not configured. "
    if summary:
        response += f"I also have this saved context: {summary}\n\n"
    response += (
        "The app, backend routing, and assistant loop are working. "
        "If you add Groq and voice provider keys, this same flow will use live model responses."
    )
    return response


async def generate_chat_response(messages, user_input: str, context: Optional[dict[str, Any]] = None) -> str:
    """Return a single assistant response through the configured LLM provider."""
    try:
        return strip_markdown_for_voice(await llm_provider.complete(messages))
    except asyncio.TimeoutError:
        logger.warning("LLM completion timed out, using fallback")
        return _build_local_response(user_input=user_input, context=context)
    except (ValueError, RuntimeError) as e:
        logger.error("LLM completion failed: %s", type(e).__name__)
        return _build_local_response(user_input=user_input, context=context)
    except Exception as e:
        logger.exception("Unexpected error in LLM completion: %s", str(e))
        return _build_local_response(user_input=user_input, context=context)


def _provider_metadata(metadata: AudioPayloadMetadata) -> AudioMetadata:
    return AudioMetadata(**metadata.model_dump())


async def synthesize_tts(
    text: str,
    *,
    voice: str | None = None,
    speed: float | None = None,
    lang: str | None = None,
) -> bytes:
    return await tts_provider.synthesize(
        text,
        AudioMetadata(voice=voice, speed=speed, lang=lang),
    )


@router.get("/tts/voices")
async def list_tts_voices():
    try:
        voices = await asyncio.to_thread(kokoro_tts_service.get_voices)
    except (asyncio.TimeoutError, RuntimeError) as e:
        logger.warning("Failed to fetch TTS voices: %s", type(e).__name__)
        voices = []
    except Exception as e:
        logger.exception("Unexpected error fetching TTS voices: %s", str(e))
        voices = []
    deepgram_default = settings.deepgram_tts_model
    return {"voices": [deepgram_default, *voices], "default": deepgram_default}


@router.post("/tts")
async def generate_tts(payload: TTSRequest):
    text = payload.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"detail": "Text cannot be empty"})

    audio_bytes = await synthesize_tts(
        text,
        voice=payload.voice,
        speed=payload.speed,
        lang=payload.lang,
    )
    return StreamingResponse(
        kokoro_tts_service.stream_audio(audio_bytes),
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="tts.wav"',
            "X-TTS-Voice": payload.voice or settings.deepgram_tts_model,
        },
    )


async def run_voice_pipeline(
    *,
    user_id: str,
    audio_bytes: bytes,
    metadata: AudioPayloadMetadata,
    websocket: WebSocket,
) -> None:
    await _safe_send_json(websocket, {"type": WS_STT_START})

    transcript = await stt_provider.transcribe(audio_bytes, _provider_metadata(metadata))

    await _safe_send_json(websocket, {"type": WS_STT_DONE, "transcript": transcript})
    if _is_probable_stt_artifact(transcript):
        await _safe_send_json(
            websocket,
            {
                "type": WS_ERROR,
                "message": "I only caught a short filler phrase. Please ask again.",
            },
        )
        return
    conversation_id: str | None = None
    if transcript:
        conversation_id = await append_turn(
            user_id=user_id,
            role="user",
            content=transcript,
        )

    start = asyncio.get_running_loop().time()
    context = await build_context(user_id, transcript)
    elapsed_ms = int((asyncio.get_running_loop().time() - start) * 1000)
    await _safe_send_json(websocket, {"type": WS_CONTEXT_BUILT, "ms": elapsed_ms})
    messages = build_messages(user_input=transcript or "", context=context)
    full_text = await stream_chat_response(messages, websocket)
    if full_text:
        conversation_id = await append_turn(
            user_id=user_id,
            role="assistant",
            content=full_text,
            conversation_id=conversation_id,
        )
        try:
            schedule_extract_facts(
                transcript=f"User: {transcript}\nAssistant: {full_text}",
                user_id=user_id,
                conversation_id=conversation_id,
            )
        except (asyncio.TimeoutError, ValueError) as e:
            logger.warning("Failed to schedule fact extraction: %s", type(e).__name__)
        except Exception as e:
            logger.exception("Unexpected error scheduling fact extraction: %s", str(e))

    tts_audio = await synthesize_tts(
        full_text,
        voice=metadata.voice,
        speed=metadata.speed,
        lang=metadata.lang,
    )
    try:
        chunk_size = 32 * 1024
        for i in range(0, len(tts_audio), chunk_size):
            chunk = tts_audio[i : i + chunk_size]
            b64chunk = base64.b64encode(chunk).decode()
            await _safe_send_json(websocket, {"type": WS_TTS_AUDIO_CHUNK, "data": b64chunk})
        await _safe_send_json(websocket, {"type": WS_TTS_AUDIO_DONE})
    except (RuntimeError, ConnectionError):
        logger.debug("WebSocket closed while streaming TTS chunks")
    except Exception as e:
        logger.exception("Unexpected error streaming TTS chunks: %s", str(e))
        b64 = base64.b64encode(tts_audio).decode()
        await _safe_send_json(websocket, {"type": WS_TTS_AUDIO_BASE64, "data": b64})


@router.post("/ai/process")
async def process_text_query(payload: TextQueryRequest):
    """Text-friendly entrypoint for the backend-owned assistant pipeline."""
    query = payload.query.strip()
    if not query:
        return JSONResponse(status_code=400, content={"detail": "Query cannot be empty"})

    context = await build_context(payload.user_id, query)
    if payload.context:
        context = {
            **context,
            "client_context": payload.context,
        }
    messages = build_messages(user_input=query, context=context)
    response_text = await generate_chat_response(messages, user_input=query, context=context)
    conversation_id = await append_turn(user_id=payload.user_id, role="user", content=query)
    await append_turn(
        user_id=payload.user_id,
        role="assistant",
        content=response_text,
        conversation_id=conversation_id,
    )
    memory_updated = False
    try:
        schedule_extract_facts(
            transcript=f"User: {query}\nAssistant: {response_text}",
            user_id=payload.user_id,
            conversation_id=conversation_id,
        )
        memory_updated = True
    except (asyncio.TimeoutError, ValueError) as e:
        logger.warning("Failed to schedule fact extraction: %s", type(e).__name__)
    except Exception as e:
        logger.exception("Unexpected error scheduling fact extraction: %s", str(e))

    return {
        "response": response_text,
        "memoryUpdated": memory_updated,
        "mode": "provider" if settings.groq_api_key else "local_fallback",
    }


def _extract_and_validate_token(token: Optional[str], expected_user_id: str) -> bool:
    """Validate JWT token and ensure it matches the user_id path param."""
    if not token:
        return False
    try:
        payload = decode_token(token)
        token_user_id = payload.get("sub")
        return token_user_id == expected_user_id
    except ValueError:
        logger.debug("Invalid JWT token format")
        return False
    except Exception as e:
        logger.warning("Error validating token: %s", type(e).__name__)
        return False


def _allow_insecure_dev_websocket() -> bool:
    return settings.allow_insecure_dev_auth and settings.app_env not in {"production", "prod"}


@router.websocket("/ws/voice/{user_id}")
async def websocket_voice(
    user_id: str,
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """WebSocket voice endpoint with optional JWT authentication.

    Query parameters:
    - token: JWT token for authentication (required in production).
             In development/test mode, token is optional.
    """
    if (
        not settings.test_mode
        and not _allow_insecure_dev_websocket()
        and not _extract_and_validate_token(token, user_id)
    ):
        await websocket.close(code=4003, reason="Unauthorized")
        return

    await websocket.accept()
    audio_buffer = bytearray()
    audio_metadata = AudioPayloadMetadata()
    MAX_AUDIO_BYTES = 50 * 1024 * 1024  # 50 MB max audio buffer
    print('[PIPELINE] ✅ WebSocket connected — client ready to stream audio')

    try:
        await websocket.send_json({"type": WS_READY})

        while True:
            msg = await websocket.receive()

            if msg.get("type") == "websocket.disconnect":
                break

            # Support binary frames (append) or JSON text frames
            if "bytes" in msg and msg["bytes"]:
                print(f'[PIPELINE 2/7] 📥 Audio chunk received — size: {len(msg["bytes"])} bytes')
                if len(audio_buffer) + len(msg["bytes"]) > MAX_AUDIO_BYTES:
                    await _safe_send_json(
                        websocket,
                        {"type": WS_ERROR, "message": "Audio too long. Please try a shorter recording."}
                    )
                    break
                # Special-case: client can send a single-frame b"__FINAL__" to indicate end-of-utterance
                if msg["bytes"] == b"__FINAL__":
                    await run_voice_pipeline(
                        user_id=user_id,
                        audio_bytes=bytes(audio_buffer),
                        metadata=audio_metadata,
                        websocket=websocket,
                    )
                    audio_buffer = bytearray()
                    audio_metadata = AudioPayloadMetadata()
                    continue

                audio_buffer.extend(msg["bytes"])
                # acknowledge
                await websocket.send_json({"type": WS_ACK_AUDIO})
                continue

            if "text" in msg and msg["text"]:
                try:
                    payload = json.loads(msg["text"]) if msg.get("text") else None
                except json.JSONDecodeError:
                    # Best-effort fallback: if the text contains a simple control like 'final',
                    # accept it as a final marker. This helps clients that send plain strings.
                    raw = msg.get("text")
                    try:
                        if raw and isinstance(raw, str) and raw.strip().lower() == WS_FINAL:
                            payload = {"type": WS_FINAL}
                        else:
                            payload = None
                    except (TypeError, AttributeError) as e:
                        logger.debug("Error parsing fallback control frame: %s", type(e).__name__)
                        payload = None

                # If the client sends a JSON control frame
                if payload and isinstance(payload, dict):
                    if payload.get("type") == WS_AUDIO_CHUNK:
                        data_b64 = payload.get("data")
                        if (
                            payload.get("file_name")
                            or payload.get("mime_type")
                            or payload.get("voice")
                            or payload.get("speed") is not None
                            or payload.get("lang")
                        ):
                            audio_metadata = AudioPayloadMetadata(
                                file_name=payload.get("file_name") or audio_metadata.file_name,
                                mime_type=payload.get("mime_type") or audio_metadata.mime_type,
                                voice=payload.get("voice") or audio_metadata.voice,
                                speed=_parse_speed(payload.get("speed"), audio_metadata.speed),
                                lang=payload.get("lang") or audio_metadata.lang,
                            )
                        if data_b64:
                            audio_buffer.extend(base64.b64decode(data_b64))
                            await websocket.send_json({"type": WS_ACK_AUDIO})
                        continue

                    if payload.get("type") == WS_FINAL:
                        if (
                            payload.get("file_name")
                            or payload.get("mime_type")
                            or payload.get("voice")
                            or payload.get("speed") is not None
                            or payload.get("lang")
                        ):
                            audio_metadata = AudioPayloadMetadata(
                                file_name=payload.get("file_name") or audio_metadata.file_name,
                                mime_type=payload.get("mime_type") or audio_metadata.mime_type,
                                voice=payload.get("voice") or audio_metadata.voice,
                                speed=_parse_speed(payload.get("speed"), audio_metadata.speed),
                                lang=payload.get("lang") or audio_metadata.lang,
                            )

                        await run_voice_pipeline(
                            user_id=user_id,
                            audio_bytes=bytes(audio_buffer),
                            metadata=audio_metadata,
                            websocket=websocket,
                        )
                        audio_buffer = bytearray()
                        audio_metadata = AudioPayloadMetadata()
                        continue

                # Unknown text frame; ignore or log
                await websocket.send_json({"type": WS_IGNORED})

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", user_id)
    except (asyncio.CancelledError, asyncio.TimeoutError) as e:
        logger.info("Voice pipeline cancelled/timeout for user %s: %s", user_id, type(e).__name__)
        try:
            await websocket.send_json({"type": WS_ERROR, "message": "Pipeline timeout"})
        except (RuntimeError, ConnectionError):
            pass
    except Exception as e:
        logger.exception("Error in voice websocket for user %s: %s", user_id, str(e))
        try:
            await websocket.send_json({"type": WS_ERROR, "message": "Server error in voice pipeline"})
        except (RuntimeError, ConnectionError):
            pass
