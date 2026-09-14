"""
Fact extractor for transcripts -> structured KB updates

This module exposes a primary function `extract_facts(transcript)` which
attempts to use the configured LLM provider to parse free-text
transcripts into a compact JSON array of factual assertions. If the provider
is not configured or the call fails, a lightweight rule-based fallback extracts
candidate facts from sentences.

The output format is a list of objects like:
  {"subject": "User", "predicate": "likes", "object": "black coffee", "confidence": 0.86}

This is intended to be called from a Celery task that persists facts into
the knowledge DB or updates embeddings.
"""
from typing import List, Dict, Any, Optional
import logging
import re
import json

from app.core.config import get_settings
from app.providers import llm_provider

settings = get_settings()
logger = logging.getLogger(__name__)


def _extract_json_array_payload(content: str) -> Optional[List[Dict[str, Any]]]:
    """Extract a JSON array of objects from mixed LLM text without backtracking regex.

    Mirrors ``[\\s*{.*}\\s*]`` with greedy ``.*``: first ``[`` followed by optional
    whitespace and ``{``, then the last ``]`` preceded by optional whitespace and ``}``.
    """
    start = -1
    index = 0
    length = len(content)
    while index < length:
        if content[index] == "[":
            cursor = index + 1
            while cursor < length and content[cursor].isspace():
                cursor += 1
            if cursor < length and content[cursor] == "{":
                start = index
                break
        index += 1
    if start == -1:
        return None

    end = -1
    index = length - 1
    while index >= 0:
        if content[index] == "]":
            cursor = index - 1
            while cursor >= 0 and content[cursor].isspace():
                cursor -= 1
            if cursor >= 0 and content[cursor] == "}":
                end = index
                break
        index -= 1
    if end <= start:
        return None

    try:
        parsed = json.loads(content[start : end + 1])
        if isinstance(parsed, list):
            return parsed
    except Exception:
        logger.exception("Failed to parse JSON substring from LLM output")
    return None


def _rule_based_extract(transcript: str) -> List[Dict[str, Any]]:
    """Simple heuristic extractor: split into sentences and look for verb
    phrases that indicate personal facts. Returns low-confidence facts.
    """
    facts: List[Dict[str, Any]] = []
    # Normalize
    text = transcript.strip()
    if not text:
        return facts

    # Split into sentences (naive)
    sentences = re.split(r"(?<=[.!?])\s+", text)

    fact_patterns = [
        (re.compile(r"\bmy name is (?P<object>.+?)(?:\.|$)", re.I), "identity", "name"),
        (re.compile(r"\bmy goal is (?P<object>.+?)(?:\.|$)", re.I), "goals", "stated_goal"),
        (re.compile(r"\bI (?:want|need|plan|aim) to (?P<object>.+?)(?:\.|$)", re.I), "goals", "stated_goal"),
        (re.compile(r"\bI am (?:working on|building) (?P<object>.+?)(?:\.|$)", re.I), "projects", "active_project"),
        (re.compile(r"\bI (?:live in|am from|am based in) (?P<object>.+?)(?:\.|$)", re.I), "identity", "home_base"),
        (re.compile(r"\bI'm (?:from|in|based in) (?P<object>.+?)(?:\.|$)", re.I), "identity", "home_base"),
        (re.compile(r"\bI(?:'m| am) (?:a |an )?(?P<object>.+?)(?:\.|$)", re.I), "identity", "self_description"),
        (re.compile(r"\bI (?:like|love|enjoy) (?P<object>.+?)(?:\.|$)", re.I), "identity", "preference"),
        (re.compile(r"\bI (?:don't |do not )?(?:like|love|enjoy) (?P<object>.+?)(?:\.|$)", re.I), "patterns", "aversion"),
        (re.compile(r"\bMy (?:favorite|favourite) (?P<object>.+?) is (?P<object2>.+?)(?:\.|$)", re.I), "identity", "preference"),
        (re.compile(r"\bI met (?P<object>.+?)(?:\.|$)", re.I), "relationships", "person"),
        (re.compile(r"\bI (?:bought|purchased) (?P<object>.+?)(?:\.|$)", re.I), "finances", "purchase"),
    ]

    for s in sentences:
        s = s.strip()
        for pattern, domain, field_name in fact_patterns:
            m = pattern.search(s)
            if m:
                obj = m.groupdict().get("object") or m.groupdict().get("object2")
                if obj:
                    obj = obj.strip().strip('.').strip()
                    facts.append({
                        "subject": "user",
                        "predicate": field_name,
                        "object": obj,
                        "domain": domain,
                        "field_name": field_name,
                        "field_value": obj,
                        "source": "rule_fallback",
                        "confidence": 0.4,
                    })
                    break

    return facts


async def _llm_extract(transcript: str) -> Optional[List[Dict[str, Any]]]:
    """Use the configured LLM provider to extract facts as JSON. Returns None on
    failure so caller can fallback.
    """
    if not settings.groq_api_key and not settings.test_mode:
        return None

    system = (
        "You are a JSON-extraction assistant. Given a user's transcript, "
        "extract concise factual assertions as a JSON array. Each item should "
        "have keys: domain, field_name, field_value, confidence (0-1), and source. "
        "Allowed domains: identity, goals, projects, finances, relationships, patterns. "
        "Return ONLY valid JSON. If no facts, return an empty array."
    )

    messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Transcript:\n{transcript}"},
        ]

    try:
        content = await llm_provider.complete(messages)
        try:
            parsed = json.loads(content)
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict):
                for key in ["facts", "items", "data"]:
                    if isinstance(parsed.get(key), list):
                        return parsed[key]
        except json.JSONDecodeError:
            payload = _extract_json_array_payload(content)
            if payload is not None:
                return payload
        return None
    except Exception:
        logger.exception("LLM fact extraction failed")
        return None


async def extract_facts(transcript: str) -> List[Dict[str, Any]]:
    """Primary entrypoint: try provider extraction, fall back to rules.
    Returns a list of fact dicts.
    """
    # Try provider extraction first
    try:
        ai_result = await _llm_extract(transcript)
        if ai_result is not None:
            # Ensure each fact has expected keys and types
            sanitized = []
            for item in ai_result:
                if not isinstance(item, dict):
                    continue
                pred = item.get("field_name") or item.get("predicate") or item.get("relation") or "statement"
                obj = item.get("field_value") or item.get("object") or item.get("value") or ""
                domain = item.get("domain") or _domain_for_predicate(str(pred))
                conf = float(item.get("confidence", 0.6)) if item.get("confidence") is not None else 0.6
                sanitized.append({
                    "subject": item.get("subject", "user"),
                    "predicate": pred,
                    "object": obj,
                    "domain": domain,
                    "field_name": pred,
                    "field_value": obj,
                    "confidence": conf,
                    "source": item.get("source", "llm"),
                })
            if sanitized:
                return sanitized
    except Exception:
        logger.exception("Provider extraction attempt raised")

    # Fallback: rule-based
    try:
        return _rule_based_extract(transcript)
    except Exception:
        logger.exception("Rule-based extraction failed")
        return []


def _domain_for_predicate(predicate: str) -> str:
    predicate = predicate.lower()
    if any(token in predicate for token in ("goal", "target", "ambition")):
        return "goals"
    if any(token in predicate for token in ("project", "building", "working")):
        return "projects"
    if any(token in predicate for token in ("finance", "income", "expense", "purchase", "debt", "investment")):
        return "finances"
    if any(token in predicate for token in ("person", "relationship", "met")):
        return "relationships"
    if any(token in predicate for token in ("habit", "pattern", "aversion", "trigger")):
        return "patterns"
    return "identity"


def facts_to_kb_updates(facts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Transform extracted facts into KB update payloads suitable for
    persistence. This is a thin mapping and can be adapted to your DB schema.
    """
    updates = []
    for f in facts:
        field_name = f.get("field_name") or f.get("predicate", "statement")
        field_value = f.get("field_value") or f.get("object", "")
        updates.append({
            "domain": f.get("domain") or _domain_for_predicate(str(field_name)),
            "field_name": field_name,
            "field_value": field_value,
            "confidence": float(f.get("confidence", 0.5)),
            "source": f.get("source", "extractor"),
        })
    return updates


__all__ = ["extract_facts", "facts_to_kb_updates"]
