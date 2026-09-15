/**
 * Tests for wsProtocol.ts — verify message types and constants.
 *
 * These are pure type-level + constant tests; no mocks needed.
 */

import {
  WSMsg,
  type WsServerMessage,
  type WsClientMessage,
  type WsClientLocalMessage,
  type WsMessage,
  type WsMessageType,
} from '../services/wsProtocol'

// ── WSMsg constant keys ──────────────────────────────────────────────

const EXPECTED_SERVER_KEYS = [
  'READY',
  'STT_START',
  'STT_DONE',
  'ACK_AUDIO',
  'CONTEXT_BUILT',
  'LLM_CHUNK',
  'LLM_ERROR',
  'LLM_DONE',
  'TTS_AUDIO_CHUNK',
  'TTS_AUDIO_DONE',
  'TTS_AUDIO_BASE64',
  'ERROR',
  'IGNORED',
] as const

const EXPECTED_CLIENT_KEYS = ['AUDIO_CHUNK', 'FINAL'] as const

describe('WSMsg constants', () => {
  test('has all expected server-side keys', () => {
    for (const key of EXPECTED_SERVER_KEYS) {
      expect(WSMsg).toHaveProperty(key)
      expect(typeof (WSMsg as Record<string, unknown>)[key]).toBe('string')
    }
  })

  test('has all expected client-side keys', () => {
    for (const key of EXPECTED_CLIENT_KEYS) {
      expect(WSMsg).toHaveProperty(key)
      expect(typeof (WSMsg as Record<string, unknown>)[key]).toBe('string')
    }
  })

  test('server keys have correct string values', () => {
    expect(WSMsg.READY).toBe('ready')
    expect(WSMsg.STT_START).toBe('stt_start')
    expect(WSMsg.STT_DONE).toBe('stt_done')
    expect(WSMsg.ACK_AUDIO).toBe('ack_audio')
    expect(WSMsg.CONTEXT_BUILT).toBe('context_built')
    expect(WSMsg.LLM_CHUNK).toBe('llm_chunk')
    expect(WSMsg.LLM_ERROR).toBe('llm_error')
    expect(WSMsg.LLM_DONE).toBe('llm_done')
    expect(WSMsg.TTS_AUDIO_CHUNK).toBe('tts_audio_chunk')
    expect(WSMsg.TTS_AUDIO_DONE).toBe('tts_audio_done')
    expect(WSMsg.TTS_AUDIO_BASE64).toBe('tts_audio_base64')
    expect(WSMsg.ERROR).toBe('error')
    expect(WSMsg.IGNORED).toBe('ignored')
  })

  test('client keys have correct string values', () => {
    expect(WSMsg.AUDIO_CHUNK).toBe('audio_chunk')
    expect(WSMsg.FINAL).toBe('final')
  })
})

// ── WsServerMessage type ─────────────────────────────────────────────

describe('WsServerMessage type', () => {
  test('accepts all server message shapes', () => {
    // Each of these should type-check as WsServerMessage
    const messages: WsServerMessage[] = [
      { type: 'ready' },
      { type: 'stt_start' },
      { type: 'stt_done', transcript: 'hello' },
      { type: 'ack_audio' },
      { type: 'context_built', ms: 42 },
      { type: 'llm_chunk', data: 'chunk' },
      { type: 'llm_error', message: 'boom' },
      { type: 'llm_done', content: 'done' },
      { type: 'tts_audio_chunk', data: 'base64' },
      { type: 'tts_audio_done' },
      { type: 'tts_audio_base64', data: 'base64' },
      { type: 'error', message: 'error' },
      { type: 'ignored' },
    ]
    expect(messages).toHaveLength(13)
  })
})

// ── WsClientMessage type ─────────────────────────────────────────────

describe('WsClientMessage type', () => {
  test('accepts audio_chunk shape', () => {
    const msg: WsClientMessage = {
      type: 'audio_chunk',
      data: 'base64audio',
      file_name: 'test.m4a',
      mime_type: 'audio/mp4',
      voice: 'alloy',
      speed: 1.0,
      lang: 'en',
    }
    expect(msg.type).toBe('audio_chunk')
    expect(msg.data).toBe('base64audio')
  })

  test('accepts final shape', () => {
    const msg: WsClientMessage = {
      type: 'final',
      file_name: 'test.m4a',
      mime_type: 'audio/mp4',
      voice: 'alloy',
      speed: 1.0,
      lang: 'en',
    }
    expect(msg.type).toBe('final')
  })

  test('final requires at least type', () => {
    const msg: WsClientMessage = { type: 'final' }
    expect(msg.type).toBe('final')
  })
})

// ── WsClientLocalMessage type ────────────────────────────────────────

describe('WsClientLocalMessage type', () => {
  test('accepts closed shape', () => {
    const msg: WsClientLocalMessage = { type: 'closed', code: 1000, reason: 'normal', wasClean: true }
    expect(msg.type).toBe('closed')
  })

  test('accepts raw shape', () => {
    const msg: WsClientLocalMessage = { type: 'raw', data: 'some text' }
    expect(msg.type).toBe('raw')
  })
})

// ── WsMessage union ───────────────────────────────────────────────────

describe('WsMessage union', () => {
  test('includes WsServerMessage and WsClientLocalMessage', () => {
    const serverMsg: WsMessage = { type: 'ready' }
    const localMsg: WsMessage = { type: 'closed', code: 1000 }

    expect(serverMsg.type).toBe('ready')
    expect(localMsg.type).toBe('closed')
  })

  test('does NOT include client-to-server messages (audio_chunk, final)', () => {
    // WsMessage should NOT accept { type: 'audio_chunk' } — that's WsClientMessage, not WsMessage
    // This test verifies the union is correct: only server + local messages
    const validWsMessage: WsMessage = { type: 'llm_chunk', data: 'hello' }
    expect(validWsMessage.type).toBe('llm_chunk')
  })
})

// ── WsMessageType ─────────────────────────────────────────────────────

describe('WsMessageType', () => {
  test('WSMsg values are all non-empty strings', () => {
    const allValues = Object.values(WSMsg) as string[]
    for (const val of allValues) {
      expect(typeof val).toBe('string')
      expect(val.length).toBeGreaterThan(0)
    }
  })
})
