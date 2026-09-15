// WebSocket message type constants — single source of truth for the voice pipeline protocol.
// Import these in both frontend (src/services/*) and backend (app/api/voice.py) to prevent drift.

// ── Client → Server ──────────────────────────────────────────────

export type WsClientMessage =
  | { type: 'audio_chunk'; data: string; file_name?: string; mime_type?: string; voice?: string; speed?: number; lang?: string }
  | { type: 'final'; file_name?: string; mime_type?: string; voice?: string; speed?: number; lang?: string }

// ── Server → Client ──────────────────────────────────────────────

export type WsServerMessage =
  | { type: 'ready' }
  | { type: 'stt_start' }
  | { type: 'stt_done'; transcript: string }
  | { type: 'ack_audio' }
  | { type: 'context_built'; ms: number }
  | { type: 'llm_chunk'; data: string }
  | { type: 'llm_error'; message: string }
  | { type: 'llm_done'; content: string }
  | { type: 'tts_audio_chunk'; data: string }
  | { type: 'tts_audio_done' }
  | { type: 'tts_audio_base64'; data: string }
  | { type: 'error'; message: string }
  | { type: 'ignored' }

// ── Client-local messages (not sent over the wire) ───────────────

export type WsClientLocalMessage =
  | { type: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { type: 'raw'; data: string }

// ── All messages seen by WSClient consumers ──────────────────────

export type WsMessage = WsServerMessage | WsClientLocalMessage

// ── Constants ────────────────────────────────────────────────────

export const WSMsg = {
  // client → server
  AUDIO_CHUNK: 'audio_chunk',
  FINAL: 'final',

  // server → client
  READY: 'ready',
  STT_START: 'stt_start',
  STT_DONE: 'stt_done',
  ACK_AUDIO: 'ack_audio',
  CONTEXT_BUILT: 'context_built',
  LLM_CHUNK: 'llm_chunk',
  LLM_ERROR: 'llm_error',
  LLM_DONE: 'llm_done',
  TTS_AUDIO_CHUNK: 'tts_audio_chunk',
  TTS_AUDIO_DONE: 'tts_audio_done',
  TTS_AUDIO_BASE64: 'tts_audio_base64',
  ERROR: 'error',
  IGNORED: 'ignored',
} as const

export type WsMessageType = (typeof WSMsg)[keyof typeof WSMsg]
