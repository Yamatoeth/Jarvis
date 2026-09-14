from __future__ import annotations

from io import BytesIO
from threading import Lock
from typing import Any, Iterable

from importlib.util import find_spec

from app.core.config import get_settings

settings = get_settings()


class KokoroUnavailableError(RuntimeError):
    """Raised when the optional local Kokoro TTS runtime is not installed."""


class KokoroTTSService:
    def __init__(self, engine: Any | None = None) -> None:
        self._lock = Lock()
        self._engine: Any | None = engine

    def _resolve_model_path(self) -> str:
        return settings.kokoro_model_path

    def _resolve_voices_path(self) -> str:
        return settings.kokoro_voices_path

    def is_available(self) -> bool:
        return find_spec("kokoro_onnx") is not None and find_spec("soundfile") is not None

    def _ensure_engine(self) -> Any:
        if self._engine is not None:
            return self._engine

        try:
            from kokoro_onnx import Kokoro
        except ModuleNotFoundError as exc:
            if exc.name == "kokoro_onnx":
                raise KokoroUnavailableError(
                    "Kokoro TTS is not installed. Install backend requirements or "
                    "configure DEEPGRAM_API_KEY with TTS_PROVIDER=deepgram."
                ) from exc
            raise

        with self._lock:
            if self._engine is None:
                self._engine = Kokoro(
                    model_path=self._resolve_model_path(),
                    voices_path=self._resolve_voices_path(),
                )
        return self._engine

    def get_voices(self) -> list[str]:
        engine = self._ensure_engine()
        return sorted(engine.get_voices())

    def generate_speech(
        self,
        text: str,
        *,
        voice: str | None = None,
        speed: float | None = None,
        lang: str | None = None,
    ) -> bytes:
        engine = self._ensure_engine()
        selected_voice = voice or settings.kokoro_default_voice
        selected_speed = speed if speed is not None else settings.kokoro_default_speed
        selected_lang = lang or settings.kokoro_default_language

        audio, sample_rate = engine.create(
            text=text,
            voice=selected_voice,
            speed=selected_speed,
            lang=selected_lang,
        )

        try:
            import soundfile as sf
        except ModuleNotFoundError as exc:
            if exc.name == "soundfile":
                raise KokoroUnavailableError(
                    "Kokoro TTS audio encoding requires soundfile. Install backend requirements."
                ) from exc
            raise

        buffer = BytesIO()
        sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
        return buffer.getvalue()

    def stream_audio(
        self,
        audio_bytes: bytes,
        *,
        chunk_size: int = 32 * 1024,
    ) -> Iterable[bytes]:
        for i in range(0, len(audio_bytes), chunk_size):
            yield audio_bytes[i : i + chunk_size]


kokoro_tts_service = KokoroTTSService()

__all__ = ["KokoroTTSService", "KokoroUnavailableError", "kokoro_tts_service"]
