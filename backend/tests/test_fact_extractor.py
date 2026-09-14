import asyncio
import time

from app.core.fact_extractor import _extract_json_array_payload, _llm_extract


def test_extract_json_array_payload_reads_array_of_objects_from_prose():
    content = 'Here you go:\n[{"domain": "identity", "field_name": "name", "field_value": "Ada"}]\nThanks.'
    parsed = _extract_json_array_payload(content)
    assert parsed == [{"domain": "identity", "field_name": "name", "field_value": "Ada"}]


def test_extract_json_array_payload_skips_empty_or_non_object_arrays():
    assert _extract_json_array_payload("No facts: []") is None
    assert _extract_json_array_payload("not json") is None
    assert _extract_json_array_payload("[not an object]") is None


def test_extract_json_array_payload_handles_pathological_braces_quickly():
    payload = "[" + ("}" * 20000)
    started = time.monotonic()
    assert _extract_json_array_payload(payload) is None
    assert time.monotonic() - started < 1.0


def test_llm_extract_recovers_json_array_when_model_wraps_prose(monkeypatch):
    async def fake_complete(_messages):
        return 'Sure.\n[{"domain": "goals", "field_name": "stated_goal", "field_value": "ship"}]\n'

    monkeypatch.setattr("app.core.fact_extractor.llm_provider.complete", fake_complete)
    monkeypatch.setattr("app.core.fact_extractor.settings.groq_api_key", "test-key")

    result = asyncio.run(_llm_extract("My goal is ship."))
    assert result == [{"domain": "goals", "field_name": "stated_goal", "field_value": "ship"}]
