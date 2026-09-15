"""
Shared WebSocket protocol constants for the JARVIS voice pipeline.

Import these in app/api/voice.py so the backend uses the same
message-type strings as the frontend (src/services/wsProtocol.ts).
"""
from typing import Final

# Client → Server
WS_AUDIO_CHUNK: Final[str] = "audio_chunk"
WS_FINAL: Final[str] = "final"

# Server → Client
WS_READY: Final[str] = "ready"
WS_STT_START: Final[str] = "stt_start"
WS_STT_DONE: Final[str] = "stt_done"
WS_ACK_AUDIO: Final[str] = "ack_audio"
WS_CONTEXT_BUILT: Final[str] = "context_built"
WS_LLM_CHUNK: Final[str] = "llm_chunk"
WS_LLM_ERROR: Final[str] = "llm_error"
WS_LLM_DONE: Final[str] = "llm_done"
WS_TTS_AUDIO_CHUNK: Final[str] = "tts_audio_chunk"
WS_TTS_AUDIO_DONE: Final[str] = "tts_audio_done"
WS_TTS_AUDIO_BASE64: Final[str] = "tts_audio_base64"
WS_ERROR: Final[str] = "error"
WS_IGNORED: Final[str] = "ignored"

# Convenience set for validation
WS_SERVER_TYPES: Final[set[str]] = {
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
}
