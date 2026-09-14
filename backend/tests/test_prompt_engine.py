from app.core.prompt_engine import build_messages, build_system_prompt, strip_markdown_for_voice


def test_build_system_prompt_uses_structured_context_sections():
    prompt = build_system_prompt(
        {
            "character": {"full_name": "Obito"},
            "knowledge_summary": {"summary": "Goal: ship the app this week"},
            "recent_conversation": {"summary": "User: Help me debug audio\nAssistant: Let's inspect the playback path."},
        }
    )

    assert "Server context:" in prompt
    assert "Goal: ship the app this week" in prompt
    assert "Recent conversation:" in prompt
    assert "Context Builder" not in prompt
    assert "plain spoken text" in prompt
    assert "Do not use Markdown" in prompt


def test_build_messages_does_not_duplicate_raw_context_in_user_message():
    messages = build_messages("What should I work on next?", {"knowledge_summary": {"summary": "Focus on voice UX"}})

    assert len(messages) == 2
    assert messages[1]["content"] == "What should I work on next?"


def test_strip_markdown_for_voice_removes_spoken_formatting_markers():
    text = "You’re probably referring to the **Founding Fathers**.\n\nSee `history` and [source](https://example.com)."

    result = strip_markdown_for_voice(text)

    assert result == "You’re probably referring to the Founding Fathers.\n\nSee history and source."
    assert "**" not in result
    assert "`" not in result


def test_strip_markdown_for_voice_preserves_unclosed_and_empty_link_edges():
    assert strip_markdown_for_voice("[source](https://example.com)") == "source"
    assert strip_markdown_for_voice("[](https://example.com)") == "[](https://example.com)"
    assert strip_markdown_for_voice("[source]()") == "[source]()"
    assert strip_markdown_for_voice("See [partial](https://example.com") == "See [partial](https://example.com"
    assert strip_markdown_for_voice("**bold** and *italic*") == "bold and italic"
    assert strip_markdown_for_voice("__bold__ and _italic_") == "bold and italic"
    assert strip_markdown_for_voice("**unclosed") == "unclosed"
    assert strip_markdown_for_voice("**line\nbreak**") == "line\nbreak"
    assert strip_markdown_for_voice("***nested***") == "nested"


def test_strip_markdown_for_voice_handles_pathological_emphasis_quickly():
    payload = ("*" * 5000) + "text"
    result = strip_markdown_for_voice(payload)
    assert "text" in result
