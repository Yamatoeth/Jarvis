import numpy as np

from app.services.kokoro_service import KokoroTTSService


class _FakeKokoroEngine:
    def get_voices(self) -> list[str]:
        return ["af_sarah"]

    def create(self, text: str, voice: str, speed: float, lang: str):
        sample_rate = 24000
        audio = np.zeros(sample_rate, dtype=np.float32)
        return audio, sample_rate


def _service() -> KokoroTTSService:
    return KokoroTTSService(engine=_FakeKokoroEngine())


def test_kokoro_lists_voices():
    voices = _service().get_voices()

    assert voices
    assert "af_sarah" in voices


def test_kokoro_generates_wav_bytes():
    audio = _service().generate_speech("Hello from Kokoro.")

    assert audio.startswith(b"RIFF")
    assert len(audio) > 1024
