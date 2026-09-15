/**
 * WebSocket client for voice hot-path
 * Connects to backend `/ws/voice/{userId}` and sends audio chunks (base64)
 * and receives streaming LLM/TTS messages.
 *
 * Protocol types are defined in wsProtocol.ts and MUST match
 * the backend's app/core/ws_protocol.py.
 */
import { getBackendWsUrl } from './backendUrl'
import { WSMsg, type WsMessage } from './wsProtocol'

// ── Re-export protocol-aligned types ──────────────────────────────

export { WsMessage }

/** Type guard: audio chunk (base64) from TTS streaming */
export function isTtsAudioChunkMessage(msg: WsMessage): msg is { type: typeof WSMsg.TTS_AUDIO_CHUNK; data: string } {
  return msg.type === WSMsg.TTS_AUDIO_CHUNK && typeof (msg as Record<string, unknown>).data === 'string'
}

/** Type guard: LLM stream chunk */
export function isLLMChunkMessage(msg: WsMessage): msg is { type: typeof WSMsg.LLM_CHUNK; data: string } {
  return msg.type === WSMsg.LLM_CHUNK && typeof (msg as Record<string, unknown>).data === 'string'
}

/** Type guard: error message */
export function isErrorMessage(msg: WsMessage): msg is Extract<WsMessage, { type: typeof WSMsg.ERROR }> {
  return msg.type === WSMsg.ERROR
}

type MessageHandler = (msg: WsMessage) => void

export class WSClient {
  private ws: WebSocket | null = null
  private url: string
  private handlers: MessageHandler[] = []
  private connectTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(baseUrl?: string) {
    this.url = getBackendWsUrl(baseUrl)
    try {
      console.log('[WSClient] init baseUrl=', this.url)
    } catch {}
  }

  private get healthUrl(): string {
    return `${this.url.replace(/^ws/i, 'http')}/health`
  }

  private async assertBackendReachable(): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch(this.healthUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`health check returned HTTP ${response.status}`)
      }
      try {
        console.log('[WSClient] backend health ok ->', this.healthUrl)
      } catch {}
    } catch (error) {
      try {
        console.error('[WSClient] backend health failed ->', this.healthUrl, error)
      } catch {}
      throw new Error(
        `Voice backend is not reachable from this device at ${this.healthUrl}. ` +
          'Open that URL on the phone browser; if it fails, allow Python/uvicorn through the Mac firewall or use the same Wi-Fi network.'
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async connect(userId: string): Promise<void> {
    await this.assertBackendReachable()

    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}/api/v1/ws/voice/${encodeURIComponent(userId)}`
      try {
        console.log('[WSClient] connecting to', wsUrl)
      } catch {}
      this.ws = new WebSocket(wsUrl)
      let settled = false

      this.connectTimeout = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          this.ws?.close()
        } catch {}
        reject(new Error('Voice backend connection timed out'))
      }, 5000)

      this.ws.onopen = () => {
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout)
          this.connectTimeout = null
        }
        settled = true
        try {
          console.log('[WSClient] onopen -> connected to', wsUrl)
        } catch {}
        resolve()
      }

      this.ws.onerror = (e) => {
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout)
          this.connectTimeout = null
        }
        try {
          console.error('[WSClient] onerror', e)
        } catch {}
        if (!settled) {
          settled = true
          reject(
            new Error(
              `Unable to open the voice WebSocket at ${wsUrl}. ` +
                `The backend health check succeeded at ${this.healthUrl}, so check the backend terminal for a WebSocket rejection code.`
            )
          )
        }
      }

      this.ws.onmessage = (event) => {
        const msg = this.parseMessage(event.data)
        this.handlers.forEach((h) => h(msg))
      }

      this.ws.onclose = (event) => {
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout)
          this.connectTimeout = null
        }
        const reason = typeof event.reason === 'string' ? event.reason : ''
        try {
          console.log('[WSClient] onclose -> websocket closed', {
            code: event.code,
            reason,
            wasClean: event.wasClean,
          })
        } catch {}
        // notify handlers about close
        this.handlers.forEach((h) =>
          h({ type: 'closed', code: event.code, reason, wasClean: event.wasClean })
        )
      }
    })
  }

  disconnect(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout)
      this.connectTimeout = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private parseMessage(rawData: string): WsMessage {
    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>
      // Validate that parsed has a type field
      if (typeof parsed.type === 'string') {
        return parsed as WsMessage
      }
      return { type: 'raw', data: rawData }
    } catch {
      // If not JSON, forward raw
      return { type: 'raw', data: rawData }
    }
  }

  sendJson(obj: WsMessage | Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }
    try {
      const txt = JSON.stringify(obj)
      this.ws.send(txt)
      try {
        const msgType = (obj as Record<string, unknown>).type || 'json'
        console.log('[WSClient] sendJson ->', msgType, 'len=', txt.length)
      } catch {}
    } catch (err) {
      try {
        console.error('[WSClient] sendJson error', err)
      } catch {}
      throw err
    }
  }

  sendAudioBase64(b64: string): void {
    // send as a JSON control frame
    try {
      this.sendJson({ type: 'audio_chunk', data: b64 })
      try {
        console.log('[WSClient] sendAudioBase64 sent, bytes=', b64.length)
      } catch {}
    } catch (err) {
      try {
        console.warn('[WSClient] Failed sending audio chunk', err)
      } catch {}
    }
  }

  sendFinal(): void {
    try {
      try {
        console.log('[WSClient] sendFinal -> sending final marker')
      } catch {}
      this.sendJson({ type: 'final' })
    } catch (err) {
      try {
        console.error('[WSClient] sendFinal error', err)
      } catch {}
    }
  }

  onMessage(handler: MessageHandler): () => void {
    const wrappedHandler: MessageHandler = (msg) => {
      try {
        const preview = JSON.stringify(msg).slice(0, 200)
        console.log('[PIPELINE] 📨 Message received from backend:', preview)
      } catch (err) {
        console.warn('[PIPELINE ERROR ❌] Failed at message receive', err)
      }
      handler(msg)
    }
    this.handlers.push(wrappedHandler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== wrappedHandler)
    }
  }

  offMessage(handler: MessageHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler)
  }
}

export default WSClient
