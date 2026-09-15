/**
 * Voice Pipeline Service
 * Thin mobile client around the backend-owned voice pipeline.
 *
 * Client responsibilities:
 * - record microphone input
 * - stream recorded audio to backend over WebSocket
 * - play returned audio
 *
 * Backend responsibilities:
 * - STT
 * - context assembly
 * - LLM generation
 * - TTS synthesis
 */
import * as FileSystem from 'expo-file-system/legacy'
import { Buffer } from 'buffer'

import { audioRecordingService } from './audioRecording'
import { audioPlaybackService } from './textToSpeech'
import WSClient, { type WsMessage } from './wsClient'
import apiClient from './apiClient'
import { ApiError } from './apiClient'

export type PipelineState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'

export interface PipelineResponse {
  userTranscript: string
  assistantResponse: string
  transcriptionTimeMs: number
  llmTimeMs: number
  ttsTimeMs: number
  totalTimeMs: number
}

export interface PipelineCallbacks {
  onStateChange?: (state: PipelineState) => void
  onTranscript?: (transcript: string) => void
  onResponse?: (response: string) => void
  onAudioLevel?: (level: number) => void
  onError?: (error: Error) => void
  onComplete?: (result: PipelineResponse) => void
  onStreamChunk?: (chunk: string) => void
}

export interface PipelineOptions {
  userId?: string
  streamLLM?: boolean
  playAudio?: boolean
  minRecordingMs?: number
  maxRecordingMs?: number
  voice?: string
}

interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export class ConversationHistory {
  private turns: ConversationTurn[] = []
  private maxTurns = 10

  add(role: 'user' | 'assistant', content: string): void {
    this.turns.push({ role, content, timestamp: new Date() })
    if (this.turns.length > this.maxTurns) {
      this.turns = this.turns.slice(-this.maxTurns)
    }
  }

  getHistory(): { role: 'user' | 'assistant'; content: string }[] {
    return this.turns.map(({ role, content }) => ({ role, content }))
  }

  clear(): void {
    this.turns = []
  }
}

type FinalizeContext = {
  startTime: number
  transcriptStartedAt: number | null
  llmStartedAt: number | null
}

function inferAudioMetadata(uri: string): { fileName: string; mimeType: string } {
  const fileName = uri.split('/').pop() || 'audio.m4a'
  const normalized = fileName.toLowerCase()

  if (normalized.endsWith('.wav')) {
    return { fileName, mimeType: 'audio/wav' }
  }
  if (normalized.endsWith('.caf')) {
    return { fileName, mimeType: 'audio/x-caf' }
  }
  if (normalized.endsWith('.mp3')) {
    return { fileName, mimeType: 'audio/mpeg' }
  }
  if (normalized.endsWith('.m4a')) {
    return { fileName, mimeType: 'audio/mp4' }
  }

  return { fileName, mimeType: 'application/octet-stream' }
}

async function writeAudioToCache(chunks: Buffer[]): Promise<string> {
  const output = `${FileSystem.cacheDirectory}jarvis_tts_${Date.now()}.wav`
  const bytes = Buffer.concat(chunks)
  await FileSystem.writeAsStringAsync(output, bytes.toString('base64'), {
    encoding: FileSystem.EncodingType.Base64,
  })
  return output
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class VoicePipelineService {
  private state: PipelineState = 'idle'
  private callbacks: PipelineCallbacks = {}
  private conversationHistory = new ConversationHistory()
  private isInitialized = false
  private operationId = 0
  private activeWs: WSClient | null = null
  private lastPlaybackStoppedAt = 0

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true

    try {
      await audioPlaybackService.initialize()

      const hasPermission = await audioRecordingService.requestPermissions()
      if (!hasPermission) {
        throw new Error('Microphone permission denied')
      }

      this.isInitialized = true
      return true
    } catch (error) {
      console.error('Failed to initialize voice pipeline:', error)
      return false
    }
  }

  setCallbacks(callbacks: PipelineCallbacks): void {
    this.callbacks = callbacks
  }

  setCallback<K extends keyof PipelineCallbacks>(
    key: K,
    callback: PipelineCallbacks[K]
  ): void {
    this.callbacks[key] = callback
  }

  getState(): PipelineState {
    return this.state
  }

  private setState(state: PipelineState): void {
    this.state = state
    this.callbacks.onStateChange?.(state)
  }

  private beginOperation(): number {
    this.operationId += 1
    return this.operationId
  }

  private isCurrentOperation(operationId: number): boolean {
    return operationId === this.operationId
  }

  private toUserFacingError(error: unknown): Error {
    if (error instanceof ApiError) {
      if (error.status === 0 || error.status === 408) {
        return new Error('Backend unreachable. Check that the server is running and EXPO_PUBLIC_API_URL is correct.')
      }
      return new Error(error.message)
    }

    if (error instanceof Error) {
      if (/microphone permission/i.test(error.message)) {
        return new Error('Microphone permission denied. Enable microphone access and try again.')
      }
      if (/timed out/i.test(error.message)) {
        return new Error('The request timed out. Please try again.')
      }
      if (/websocket closed/i.test(error.message) || /voice backend/i.test(error.message)) {
        return new Error('Voice backend unavailable. Check that the backend is running and reachable.')
      }
      return error
    }

    return new Error(String(error))
  }

  async startListening(): Promise<void> {
    if (this.state === 'speaking' || this.state === 'thinking' || this.state === 'transcribing') {
      await this.cancel()
    }

    if (this.state !== 'idle') {
      console.warn('Pipeline is not idle, cannot start listening')
      return
    }

    const initialized = await this.initialize()
    if (!initialized) {
      this.setState('error')
      this.callbacks.onError?.(new Error('Voice pipeline failed to initialize'))
      return
    }

    const msSincePlayback = Date.now() - this.lastPlaybackStoppedAt
    if (msSincePlayback < 700) {
      await delay(700 - msSincePlayback)
    }

    this.beginOperation()
    this.setState('listening')
    const ok = await audioRecordingService.startRecording((level) => {
      this.callbacks.onAudioLevel?.(level.level)
    })

    if (!ok) {
      await audioRecordingService.cancelRecording()
      this.setState('idle')
      this.callbacks.onError?.(new Error(audioRecordingService.getLastError() || 'Failed to start recording'))
    }
  }

  async stopListening(options: PipelineOptions = {}): Promise<PipelineResponse | null> {
    if (this.state !== 'listening') {
      console.warn('Pipeline is not listening')
      return null
    }

    try {
      const recording = await audioRecordingService.stopRecording()
      if (!recording) {
        throw new Error('No recording available')
      }

      const minMs = options.minRecordingMs ?? 500
      if (recording.durationMs < minMs) {
        this.setState('idle')
        this.callbacks.onError?.(new Error('Recording too short. Hold to talk a little longer.'))
        return null
      }

      return await this.sendRecordingToBackend(recording.uri, options)
    } catch (error) {
      this.setState('error')
      this.callbacks.onError?.(this.toUserFacingError(error))
      return null
    }
  }

  async processText(text: string, options: PipelineOptions = {}): Promise<PipelineResponse | null> {
    const operationId = this.beginOperation()
    if (!options.userId) {
      const error = new Error('userId is required for backend-owned text processing')
      this.setState('error')
      this.callbacks.onError?.(error)
      return null
    }

    try {
      const startTime = Date.now()
      this.callbacks.onTranscript?.(text)
      this.setState('thinking')

      const result = await apiClient.processQuery(options.userId, text)
      if (!this.isCurrentOperation(operationId)) return null
      const assistantResponse = result.response || ''
      let ttsTimeMs = 0

      this.callbacks.onResponse?.(assistantResponse)
      this.conversationHistory.add('user', text)
      this.conversationHistory.add('assistant', assistantResponse)

      if (options.playAudio !== false && assistantResponse) {
        this.setState('speaking')
        const playbackStartedAt = Date.now()
        const audioBuffer = await apiClient.synthesizeSpeech(assistantResponse, options.voice)
        if (!this.isCurrentOperation(operationId)) return null
        const audioPath = await writeAudioToCache([Buffer.from(audioBuffer)])
        await new Promise<void>((resolve, reject) => {
          audioPlaybackService.play(
            audioPath,
            () => {
              this.lastPlaybackStoppedAt = Date.now()
              resolve()
            },
            (error) => reject(error)
          )
        })
        if (!this.isCurrentOperation(operationId)) return null
        ttsTimeMs = Date.now() - playbackStartedAt
      }

      const response: PipelineResponse = {
        userTranscript: text,
        assistantResponse,
        transcriptionTimeMs: 0,
        llmTimeMs: Date.now() - startTime - ttsTimeMs,
        ttsTimeMs,
        totalTimeMs: Date.now() - startTime,
      }

      this.setState('idle')
      this.callbacks.onComplete?.(response)
      return response
    } catch (error) {
      this.setState('error')
      this.callbacks.onError?.(this.toUserFacingError(error))
      return null
    }
  }

  async cancel(): Promise<void> {
    this.beginOperation()
    this.activeWs?.disconnect()
    this.activeWs = null
    await audioPlaybackService.stop()
    this.lastPlaybackStoppedAt = Date.now()
    await audioRecordingService.cancelRecording()
    this.setState('idle')
  }

  clearHistory(): void {
    this.conversationHistory.clear()
  }

  private async sendRecordingToBackend(
    audioUri: string,
    options: PipelineOptions
  ): Promise<PipelineResponse> {
    const operationId = this.beginOperation()
    const userId = options.userId
    if (!userId) {
      throw new Error('userId is required for backend-owned voice processing')
    }

    const ws = new WSClient()
    this.activeWs = ws
    const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    })
    const metadata = inferAudioMetadata(audioUri)
    const audioChunks: Buffer[] = []
    let transcript = ''
    let assistantResponse = ''

    const ctx: FinalizeContext = {
      startTime: Date.now(),
      transcriptStartedAt: null,
      llmStartedAt: null,
    }

    return new Promise<PipelineResponse>(async (resolve, reject) => {
      const finalize = async (shouldPlayAudio: boolean) => {
        try {
          if (!this.isCurrentOperation(operationId)) {
            ws.disconnect()
            unsubscribe()
            return
          }
          let ttsTimeMs = 0

          if (shouldPlayAudio && audioChunks.length > 0) {
            this.setState('speaking')
            const playbackStartedAt = Date.now()
            const audioPath = await writeAudioToCache(audioChunks)
            if (!this.isCurrentOperation(operationId)) {
              ws.disconnect()
              unsubscribe()
              return
            }
            await new Promise<void>((playResolve, playReject) => {
              audioPlaybackService.play(
                audioPath,
                () => {
                  this.lastPlaybackStoppedAt = Date.now()
                  playResolve()
                },
                (error) => playReject(error)
              )
            })
            if (!this.isCurrentOperation(operationId)) {
              ws.disconnect()
              unsubscribe()
              return
            }
            ttsTimeMs = Date.now() - playbackStartedAt
          }

          this.conversationHistory.add('user', transcript)
          this.conversationHistory.add('assistant', assistantResponse)

          const response: PipelineResponse = {
            userTranscript: transcript,
            assistantResponse,
            transcriptionTimeMs: ctx.transcriptStartedAt
              ? (ctx.llmStartedAt || Date.now()) - ctx.transcriptStartedAt
              : 0,
            llmTimeMs: ctx.llmStartedAt ? Date.now() - ctx.llmStartedAt - ttsTimeMs : 0,
            ttsTimeMs,
            totalTimeMs: Date.now() - ctx.startTime,
          }

          this.setState('idle')
          this.callbacks.onComplete?.(response)
          ws.disconnect()
          if (this.activeWs === ws) {
            this.activeWs = null
          }
          unsubscribe()
          resolve(response)
        } catch (error) {
          ws.disconnect()
          if (this.activeWs === ws) {
            this.activeWs = null
          }
          unsubscribe()
          reject(error)
        }
      }

      const fail = (error: Error) => {
        if (!this.isCurrentOperation(operationId)) {
          ws.disconnect()
          unsubscribe()
          return
        }
        this.setState('error')
        this.callbacks.onError?.(this.toUserFacingError(error))
        ws.disconnect()
        if (this.activeWs === ws) {
          this.activeWs = null
        }
        unsubscribe()
        reject(error)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unsubscribe = ws.onMessage((message: any) => {
        try {
          if (!this.isCurrentOperation(operationId)) {
            return
          }
          switch (message?.type) {
            case 'ready':
            case 'ack_audio':
            case 'ignored':
              break
            case 'stt_start':
              this.setState('transcribing')
              ctx.transcriptStartedAt = Date.now()
              break
            case 'stt_done':
              transcript = typeof message.transcript === 'string' ? message.transcript : ''
              if (!transcript.trim()) {
                fail(new Error('Transcription failed. Please speak more clearly and try again.'))
                return
              }
              this.callbacks.onTranscript?.(transcript)
              this.setState('thinking')
              ctx.llmStartedAt = Date.now()
              break
            case 'context_built':
              this.setState('thinking')
              if (!ctx.llmStartedAt) {
                ctx.llmStartedAt = Date.now()
              }
              break
            case 'llm_chunk':
              this.setState('thinking')
              if (!ctx.llmStartedAt) {
                ctx.llmStartedAt = Date.now()
              }
              if (typeof message.data === 'string') {
                assistantResponse += message.data
                this.callbacks.onStreamChunk?.(message.data)
              }
              break
            case 'llm_done':
              if (typeof message.content === 'string') {
                assistantResponse = message.content
                this.callbacks.onResponse?.(assistantResponse)
              }
              break
            case 'tts_audio_chunk':
              if (typeof message.data === 'string') {
                audioChunks.push(Buffer.from(message.data, 'base64'))
              }
              break
            case 'tts_audio_base64':
              if (typeof message.data === 'string') {
                audioChunks.length = 0
                audioChunks.push(Buffer.from(message.data, 'base64'))
              }
              void finalize(options.playAudio !== false)
              break
            case 'tts_audio_done':
              void finalize(options.playAudio !== false)
              break
            case 'final_text': {
              const ft = message as { type: string; text?: unknown }
              if (typeof ft.text === 'string') {
                assistantResponse = ft.text
                this.callbacks.onResponse?.(assistantResponse)
              }
              void finalize(false)
              break
            }
            case 'error':
              fail(new Error(typeof message.message === 'string' ? message.message : 'Voice backend error'))
              break
            case 'closed':
              if (this.state !== 'idle') {
                fail(new Error('Voice WebSocket closed before completion'))
              }
              break
            default:
              break
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })

      try {
        await ws.connect(userId)
        if (!this.isCurrentOperation(operationId)) {
          ws.disconnect()
          unsubscribe()
          return
        }
        ws.sendJson({
          type: 'audio_chunk',
          data: base64Audio,
          file_name: metadata.fileName,
          mime_type: metadata.mimeType,
          voice: options.voice,
        })
        ws.sendJson({
          type: 'final',
          file_name: metadata.fileName,
          mime_type: metadata.mimeType,
          voice: options.voice,
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

export const voicePipelineService = new VoicePipelineService()

export default voicePipelineService
