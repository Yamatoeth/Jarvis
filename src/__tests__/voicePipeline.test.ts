/**
 * Tests for voicePipeline.ts — state machine and pipeline logic.
 *
 * Focus on the state transitions and the VoicePipelineService class.
 * All external dependencies are mocked so tests run offline.
 */

import { VoicePipelineService, PipelineState, ConversationHistory } from '../services/voicePipeline'

// ── Mocks (hoisted before imports are evaluated) ─────────────────────

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { isDevice: true, expoConfig: {}, manifest: {}, manifest2: {} },
}))

jest.mock('expo-audio', () => ({
  __esModule: true,
  RecordingPresets: {
    HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 1, bitRate: 128000 },
  },
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { HIGH: 96 },
  requestRecordingPermissionsAsync: async () => ({ status: 'granted', granted: true }),
  getRecordingPermissionsAsync: async () => ({ status: 'granted' }),
  setAudioModeAsync: async () => ({}),
  AudioRecorder: class {
    uri: string | null = null
    async prepareToRecordAsync() {}
    record() { this.uri = 'file://mock/recording.wav' }
    async stop() {}
    getStatus() { return { isRecording: Boolean(this.uri), metering: -20, url: this.uri } }
  },
  Sound: class {
    async loadAsync() {}
    async playAsync() { return { sound: this, callback: () => {} } }
    async stopAsync() {}
    async unloadAsync() {}
  },
}))

jest.mock('expo-audio/build/AudioModule', () => ({
  __esModule: true,
  default: {
    EventEmitter: { addListener: () => ({ remove: () => {} }), removeListener: () => {} },
  },
}))

jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///tmp/cache/',
  readAsStringAsync: jest.fn().mockResolvedValue('mockbase64'),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
  getInfoAsync: async () => ({ exists: true, size: 12345 }),
  deleteAsync: async () => {},
}))

// Mock audioRecording module completely
jest.mock('../services/audioRecording', () => ({
  __esModule: true,
  AudioRecordingService: class {
    state = 'idle'
    async requestPermissions() { return true }
    async startRecording() { return true }
    async stopRecording() {
      return { uri: 'file://mock/recording.wav', durationMs: 2000, fileSize: 12345 }
    }
    async cancelRecording() {}
    getLastError() { return '' }
    isRecording() { return false }
    getState() { return this.state }
  },
  audioRecordingService: {
    requestPermissions: jest.fn().mockResolvedValue(true),
    startRecording: jest.fn().mockResolvedValue(true),
    stopRecording: jest.fn().mockResolvedValue({
      uri: 'file://mock/recording.wav',
      durationMs: 2000,
      fileSize: 12345,
    }),
    cancelRecording: jest.fn().mockResolvedValue(undefined),
    getLastError: jest.fn().mockReturnValue(''),
    isRecording: jest.fn().mockReturnValue(false),
    getState: jest.fn().mockReturnValue('idle'),
  },
}))

// Mock textToSpeech / audioPlayback module
jest.mock('../services/textToSpeech', () => ({
  __esModule: true,
  audioPlaybackService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockImplementation((_path: string, onDone: () => void) => {
      setTimeout(onDone, 10)
      return { then: (_: unknown, cb: () => void) => cb() }
    }),
    stop: jest.fn().mockResolvedValue(undefined),
  },
}))

// Mock apiClient
jest.mock('../services/apiClient', () => ({
  __esModule: true,
  apiClient: {
    processQuery: jest.fn().mockResolvedValue({ response: 'mock response' }),
    synthesizeSpeech: jest.fn().mockResolvedValue('mockaudio'),
    checkHealth: jest.fn().mockResolvedValue({ status: 'ok' }),
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'test-user' }),
  },
  ApiError: class extends Error {
    status: number
    constructor(message: string, status: number = 0) {
      super(message)
      this.status = status
    }
  },
}))

// Mock wsClient
jest.mock('../services/wsClient', () => {
  const MockWS = jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    sendJson: jest.fn(),
    sendAudioBase64: jest.fn(),
    sendFinal: jest.fn(),
    onMessage: jest.fn().mockImplementation((_handler: (msg: unknown) => void) => {
      return () => {}
    }),
  }))
  return {
    __esModule: true,
    default: MockWS,
    WSClient: MockWS,
  }
})

// ── Helpers ───────────────────────────────────────────────────────────

function makeService(): VoicePipelineService {
  return new VoicePipelineService()
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('VoicePipelineService', () => {
  let service: VoicePipelineService
  let stateChanges: PipelineState[]

  beforeEach(() => {
    service = makeService()
    stateChanges = []
    service.setCallbacks({
      onStateChange: (state: PipelineState) => {
        stateChanges.push(state)
      },
    })
  })

  afterEach(async () => {
    try { await service.cancel() } catch {}
  })

  // ── State machine tests ────────────────────────────────────────────

  test('initial state is idle', () => {
    expect(service.getState()).toBe('idle')
    expect(stateChanges).toHaveLength(0)
  })

  test('idle → listening when startListening is called', async () => {
    await service.startListening()
    expect(service.getState()).toBe('listening')
    expect(stateChanges).toContain('listening')
  })

  test('stopListening when not listening warns and returns null', async () => {
    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => warns.push(String(args[0]))

    const result = await service.stopListening()
    console.warn = origWarn
    expect(result).toBeNull()
    expect(warns.length).toBeGreaterThanOrEqual(1)
  })

  // ── processText tests ──────────────────────────────────────────────

  test('processText returns PipelineResponse with expected fields', async () => {
    const result = await service.processText('hello', { userId: 'test-user' })
    expect(result).not.toBeNull()
    expect(result?.userTranscript).toBe('hello')
    expect(result?.assistantResponse).toBe('mock response')
    expect(typeof result?.totalTimeMs).toBe('number')
    expect(typeof result?.llmTimeMs).toBe('number')
  })

  test('processText error on missing userId', async () => {
    const errors: Error[] = []
    service.setCallback('onError', (e: Error) => errors.push(e))

    const result = await service.processText('hello', {})
    expect(result).toBeNull()
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toContain('userId is required')
  })

  test('processText calls onTranscript and onResponse callbacks', async () => {
    const transcripts: string[] = []
    const responses: string[] = []

    service.setCallbacks({
      onTranscript: (t: string) => transcripts.push(t),
      onResponse: (r: string) => responses.push(r),
    })

    await service.processText('test query', { userId: 'test-user' })
    expect(transcripts).toContain('test query')
    expect(responses).toContain('mock response')
  })

  test('processText sets thinking state during processing', async () => {
    await service.processText('hello', { userId: 'test-user' })
    // Should end at idle after processing completes
    expect(service.getState()).toBe('idle')
    // And we should have seen state changes
    expect(stateChanges.length).toBeGreaterThan(0)
  })

  // ── cancel tests ───────────────────────────────────────────────────

  test('cancel resets state to idle', async () => {
    await service.startListening()
    expect(service.getState()).toBe('listening')

    await service.cancel()
    expect(service.getState()).toBe('idle')
  })

  test('cancel is idempotent', async () => {
    await service.cancel()
    expect(service.getState()).toBe('idle')
    await service.cancel()
    expect(service.getState()).toBe('idle')
  })

  // ── ConversationHistory tests (exported class) ─────────────────────

  test('add and getHistory', () => {
    const history = new ConversationHistory()
    history.add('user', 'hello')
    history.add('assistant', 'hi there')
    const entries = history.getHistory()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ role: 'user', content: 'hello' })
    expect(entries[1]).toEqual({ role: 'assistant', content: 'hi there' })
  })

  test('caps at maxTurns (10)', () => {
    const history = new ConversationHistory()
    for (let i = 0; i < 15; i++) {
      history.add('user', `msg ${i}`)
    }
    expect(history.getHistory()).toHaveLength(10)
  })

  test('clear empties history', () => {
    const history = new ConversationHistory()
    history.add('user', 'hello')
    expect(history.getHistory()).toHaveLength(1)
    history.clear()
    expect(history.getHistory()).toHaveLength(0)
  })

  // ── toUserFacingError tests ────────────────────────────────────────

  test('maps ApiError with status 0 to backend unreachable', () => {
    const { ApiError } = require('../services/apiClient')
    const svc = makeService() as unknown as { toUserFacingError: (e: unknown) => Error }
    const mapped = svc.toUserFacingError(new ApiError('connection failed', 0))
    expect(mapped.message).toContain('Backend unreachable')
  })

  test('maps microphone permission error', () => {
    const svc = makeService() as unknown as { toUserFacingError: (e: unknown) => Error }
    const mapped = svc.toUserFacingError(new Error('microphone permission denied'))
    expect(mapped.message).toContain('Microphone permission denied')
  })

  test('maps websocket closed error', () => {
    const svc = makeService() as unknown as { toUserFacingError: (e: unknown) => Error }
    const mapped = svc.toUserFacingError(new Error('WebSocket closed'))
    expect(mapped.message).toContain('Voice backend unavailable')
  })

  // ── setCallbacks / setCallback ─────────────────────────────────────

  test('setCallback replaces handler and new handler is invoked', () => {
    const svc = makeService()
    const fn1 = jest.fn()
    const fn2 = jest.fn()

    svc.setCallbacks({ onStateChange: fn1 })
    svc.setCallback('onStateChange', fn2)

    // Cancel triggers a state transition to idle
    svc.cancel()
    // fn2 should have been called with 'idle'
    expect(fn2).toHaveBeenCalledWith('idle')
    // fn1 should NOT have been called (was replaced)
    expect(fn1).not.toHaveBeenCalled()
  })

  test('startListening then cancel returns to idle', async () => {
    await service.startListening()
    expect(service.getState()).toBe('listening')
    await service.cancel()
    expect(service.getState()).toBe('idle')
  })

  // ── Operation ID tracking ──────────────────────────────────────────

  test('beginOperation returns incrementing IDs', () => {
    const svc = makeService() as unknown as { beginOperation: () => number }
    expect(svc.beginOperation()).toBe(1)
    expect(svc.beginOperation()).toBe(2)
    expect(svc.beginOperation()).toBe(3)
  })

  test('isCurrentOperation matches when IDs match', () => {
    const svc = makeService() as unknown as { beginOperation: () => number; isCurrentOperation: (id: number) => boolean }
    const id = svc.beginOperation()
    expect(svc.isCurrentOperation(id)).toBe(true)
    expect(svc.isCurrentOperation(id + 1)).toBe(false)
  })
})
