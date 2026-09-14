"""
Central prompt templates and J.A.R.V.I.S. character enforcement.

Provides functions to build system prompts and LLM message arrays using
server-assembled context. Intended for use by the voice hot-path and other
AI endpoints so prompting stays consistent across the backend.
"""
from typing import Any, Dict, List, Optional
import json
import re

JARVIS_CHARACTER_PROMPT = (
    "You are J.A.R.V.I.S., a concise, context-aware executive assistant. "
    "Behave as a trusted advisor: calm, practical, and proactive without being pushy. "
    "Use the server-provided context when it is relevant, but do not invent facts that are not present. "
    "Preserve continuity with recent conversation when possible. "
    "Do not mention internal tools, JSON, context layers, or implementation details unless the user explicitly asks. "
    "Do NOT provide medical diagnoses or replace professional healthcare. "
    "Do NOT perform unsolicited interventions; only suggest actions when the user explicitly asks or when provided instructions in the context allow it."
)


def _compact_json(data: Any) -> str:
    try:
        return json.dumps(data, default=str, ensure_ascii=False)
    except Exception:
        return str(data)


def _truncate(text: str, limit: int = 220) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _format_context_sections(context: Optional[Dict[str, Any]]) -> str:
    if not context:
        return "No server context available."

    lines: list[str] = []

    character = context.get("character") or {}
    if character:
        name = character.get("full_name")
        char_parts = []
        if name:
            char_parts.append(f"name={name}")
        if char_parts:
            lines.append("Character: " + ", ".join(char_parts))

    knowledge_summary = (context.get("knowledge_summary") or {}).get("summary")
    if knowledge_summary:
        lines.append("Knowledge summary: " + _truncate(str(knowledge_summary), 400))

    recent_conversation = context.get("recent_conversation") or {}
    recent_summary = recent_conversation.get("summary")
    if recent_summary:
        lines.append("Recent conversation:\n" + str(recent_summary))

    working_memory = context.get("working_memory") or {}
    working_state = working_memory.get("state")
    if working_state:
        lines.append("Working state: " + _compact_json(working_state))

    episodic = context.get("episodic") or []
    if episodic:
        snippets = []
        for item in episodic[:3]:
            metadata = item.get("metadata") or item
            if not isinstance(metadata, dict):
                continue
            text = (
                metadata.get("content")
                or metadata.get("text")
                or metadata.get("summary")
                or metadata.get("field_value")
            )
            if text:
                snippets.append(_truncate(str(text), 220))
        if snippets:
            lines.append("Relevant memories:\n- " + "\n- ".join(snippets))

    client_context = context.get("client_context")
    if client_context:
        lines.append("Client context: " + _compact_json(client_context))

    return "\n\n".join(lines) if lines else "No server context available."


def build_system_prompt(context: Optional[Dict[str, Any]] = None) -> str:
    """Construct a concise system prompt with structured, human-readable context."""
    return (
        f"{JARVIS_CHARACTER_PROMPT}\n\n"
        "Response style:\n"
        "- Prefer short, actionable answers.\n"
        "- By default, answer in 2 to 4 short sentences and stay under about 80 words unless the user asks for more detail.\n"
        "- Write in plain spoken text. Do not use Markdown formatting such as **bold**, headings, tables, or code fences.\n"
        "- If context is insufficient, ask at most one clarifying question.\n"
        "- If prior conversation matters, continue naturally instead of restarting.\n"
        "- Be explicit when you are uncertain.\n\n"
        "Server context:\n"
        f"{_format_context_sections(context)}"
    )


def build_messages(user_input: str, context: Optional[Dict[str, Any]] = None, extra_instructions: Optional[str] = None) -> List[Dict[str, str]]:
    """Return a messages array ready for OpenAI-compatible chat completions.

    Args:
      user_input: the user's utterance or transcript
      context: server-assembled context dict (character, knowledge_summary, working_memory, episodic)
      extra_instructions: optional per-call instructions to append to system prompt
    """
    system_prompt = build_system_prompt(context)
    if extra_instructions:
        system_prompt = system_prompt + "\n\n" + extra_instructions

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_input},
    ]

    return messages


def _strip_markdown_links(text: str) -> str:
    """Replace [label](url) with label using linear scans (no backtracking)."""
    pieces: list[str] = []
    index = 0
    length = len(text)
    while index < length:
        open_bracket = text.find("[", index)
        if open_bracket == -1:
            pieces.append(text[index:])
            break
        pieces.append(text[index:open_bracket])
        close_bracket = text.find("]", open_bracket + 1)
        if (
            close_bracket == -1
            or close_bracket + 1 >= length
            or text[close_bracket + 1] != "("
        ):
            pieces.append(text[open_bracket])
            index = open_bracket + 1
            continue
        close_paren = text.find(")", close_bracket + 2)
        label = text[open_bracket + 1 : close_bracket]
        url = text[close_bracket + 2 : close_paren] if close_paren != -1 else ""
        if close_paren == -1 or not label or not url:
            pieces.append(text[open_bracket])
            index = open_bracket + 1
            continue
        pieces.append(label)
        index = close_paren + 1
    return "".join(pieces)


def _unwrap_delimiter(text: str, marker: str) -> str:
    """Strip paired markdown markers, matching the first closer (linear)."""
    pieces: list[str] = []
    index = 0
    marker_len = len(marker)
    while True:
        open_idx = text.find(marker, index)
        if open_idx == -1:
            pieces.append(text[index:])
            break
        close_idx = text.find(marker, open_idx + marker_len)
        if close_idx == -1:
            pieces.append(text[index:])
            break
        pieces.append(text[index:open_idx])
        pieces.append(text[open_idx + marker_len : close_idx])
        index = close_idx + marker_len
    return "".join(pieces)


def strip_markdown_for_voice(text: str) -> str:
    """Remove common Markdown markers so TTS does not speak formatting symbols."""
    cleaned = text
    cleaned = _strip_markdown_links(cleaned)
    cleaned = re.sub(r"```[\s\S]*?```", lambda match: match.group(0).strip("`"), cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = _unwrap_delimiter(cleaned, "**")
    cleaned = _unwrap_delimiter(cleaned, "__")
    cleaned = _unwrap_delimiter(cleaned, "*")
    cleaned = _unwrap_delimiter(cleaned, "_")
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s{0,3}>\s?", "", cleaned, flags=re.MULTILINE)
    cleaned = cleaned.replace("**", "").replace("__", "").replace("`", "")
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


__all__ = ["JARVIS_CHARACTER_PROMPT", "build_system_prompt", "build_messages", "strip_markdown_for_voice"]
