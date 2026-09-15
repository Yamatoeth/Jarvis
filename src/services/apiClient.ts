/**
 * J.A.R.V.I.S. API Client
 * Handles communication with the FastAPI backend with runtime validation
 */
import type { User, Conversation, Message } from '../../shared/types'
import { z } from 'zod'
import { getBackendBaseUrl } from './backendUrl'
import {
  validateResponse,
  HealthResponseSchema,
  UserResponseSchema,
  ConversationResponseSchema,
  MessageResponseSchema,
  StatusResponseSchema,
  TtsVoicesResponseSchema,
  MemorySearchResponseSchema,
  ProcessQueryResponseSchema,
  OnboardingStartSchema,
  OnboardingAnswerSchema,
  OnboardingSummarySchema,
  type HealthResponse,
  type TtsVoicesResponse,
  type MemorySearchResponse,
  type ProcessQueryResponse,
  type StatusResponse,
  type OnboardingStartResponse,
  type OnboardingAnswerResponse,
  type OnboardingSummaryResponse,
} from './validation'

const API_BASE_URL = getBackendBaseUrl()

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 10000

/**
 * API Error class for structured error handling
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ============================================
// Trigger Logging
// ============================================

/**
 * Log trigger event to backend
 */
export async function logTrigger(payload: Record<string, unknown>): Promise<void> {
  const schema = z.void()
  return request<void>('/trigger', schema, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Message submission payload
 */

/**
 * Message submission payload
 */
type MessagePayload = {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  audioUrl?: string
}

/**
 * Fetch with timeout wrapper
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Make an API request with error handling and validation
 */
async function request<T>(
  endpoint: string,
  schema: z.ZodSchema<T>,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`
  
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const config: RequestInit = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }

  try {
    const response = await fetchWithTimeout(url, config)

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      throw new ApiError(
        response.status,
        errorBody.detail || `Request failed with status ${response.status}`,
        errorBody
      )
    }

    // Handle empty responses
    const text = await response.text()
    if (!text) {
      throw new ApiError(500, 'Empty response body')
    }

    const parsed = JSON.parse(text)
    // Validate response against schema
    return validateResponse(parsed, schema)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof z.ZodError) {
      throw new ApiError(0, `Invalid response format: ${error.message}`, error.flatten())
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, 'Request timed out')
    }
    throw new ApiError(0, 'Network error', error)
  }
}

async function requestArrayBuffer(
  endpoint: string,
  options: RequestInit = {}
): Promise<ArrayBuffer> {
  const url = `${API_BASE_URL}${endpoint}`
  const response = await fetchWithTimeout(url, options)

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      errorBody.detail || `Request failed with status ${response.status}`,
      errorBody
    )
  }

  return response.arrayBuffer()
}

// ============================================
// Health Check
// ============================================

/**
 * Check if the backend is healthy
 */
export async function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health', HealthResponseSchema)
}

/**
 * Get detailed backend status
 */
export async function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/api/v1/status', StatusResponseSchema)
}

// ============================================
// User Management
// ============================================

/**
 * Get or create a user
 */
export async function getOrCreateUser(userId: string): Promise<User> {
  return request<User>(`/api/v1/users/${userId}`, UserResponseSchema, {
    method: 'PUT',
  })
}

// Legacy user scoring and sensor endpoints are intentionally absent from Phase 1.

// ============================================
// Conversations
// ============================================

/**
 * Create a new conversation
 */
export async function createConversation(
  userId: string
): Promise<Conversation> {
  return request<Conversation>('/api/v1/conversations', ConversationResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
}

/**
 * Get conversation by ID
 */
export async function getConversation(
  conversationId: string
): Promise<Conversation> {
  return request<Conversation>(
    `/api/v1/conversations/${conversationId}`,
    ConversationResponseSchema
  )
}

/**
 * Get all conversations for a user
 */
export async function getConversations(userId: string): Promise<Conversation[]> {
  const ArraySchema = z.array(ConversationResponseSchema)
  return request<Conversation[]>(
    `/api/v1/conversations?user_id=${userId}`,
    ArraySchema
  )
}

/**
 * Add message to conversation
 */
export async function sendMessage(payload: MessagePayload): Promise<Message> {
  return request<Message>('/api/v1/messages', MessageResponseSchema, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Get messages for a conversation
 */
export async function getMessages(conversationId: string): Promise<Message[]> {
  const ArraySchema = z.array(MessageResponseSchema)
  return request<Message[]>(
    `/api/v1/conversations/${conversationId}/messages`,
    ArraySchema
  )
}

// Proactive coaching endpoints are intentionally absent from Phase 1.

// ============================================
// Memory & Context
// ============================================

/**
 * Search episodic memory (Pinecone)
 */
export async function searchMemory(
  userId: string,
  query: string,
  limit: number = 5
): Promise<MemorySearchResponse> {
  return request('/api/v1/memory/search', MemorySearchResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, query, limit }),
  })
}

/**
 * Get working memory state (Redis)
 */
export async function getWorkingMemory(
  userId: string
): Promise<Record<string, unknown>> {
  const WorkingMemorySchema = z.record(z.string(), z.any())
  return request<Record<string, unknown>>(`/api/v1/memory/working/${userId}`, WorkingMemorySchema)
}

/** Get all knowledge base items for a user */
export async function getKnowledge(userId: string) {
  const KnowledgeItemSchema = z.object({
    id: z.string(),
    domain: z.enum(['identity', 'goals', 'projects', 'finances', 'relationships', 'patterns']),
    field_name: z.string(),
    field_value: z.string(),
    confidence: z.number(),
    source: z.string(),
    last_updated: z.string(),
  })
  const ArraySchema = z.array(KnowledgeItemSchema)
  return request<Array<z.infer<typeof KnowledgeItemSchema>>>(
    `/api/v1/kb?user_id=${encodeURIComponent(userId)}`,
    ArraySchema
  )
}

/** Start an onboarding session */
export async function startOnboarding(userId: string): Promise<OnboardingStartResponse> {
  return request<OnboardingStartResponse>('/api/v1/onboarding/start', OnboardingStartSchema, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
}

/** Submit an answer in an onboarding session */
export async function submitOnboardingAnswer(
  userId: string,
  sessionId: string,
  answer: string
): Promise<OnboardingAnswerResponse> {
  return request<OnboardingAnswerResponse>(
    `/api/v1/onboarding/${sessionId}/answer`,
    OnboardingAnswerSchema,
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, answer }),
    }
  )
}

/** Get onboarding session summary */
export async function getOnboardingSummary(
  userId: string,
  sessionId: string
): Promise<OnboardingSummaryResponse> {
  return request<OnboardingSummaryResponse>(
    `/api/v1/onboarding/${sessionId}/summary?user_id=${encodeURIComponent(userId)}`,
    OnboardingSummarySchema
  )
}

// ============================================
// AI Processing
// ============================================

/**
 * Process a user query through the AI pipeline
 */
export async function processQuery(
  userId: string,
  query: string,
  context?: Record<string, unknown>
): Promise<ProcessQueryResponse> {
  return request('/api/v1/ai/process', ProcessQueryResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, query, context }),
  })
}

export async function synthesizeSpeech(
  text: string,
  voice?: string
): Promise<ArrayBuffer> {
  return requestArrayBuffer('/api/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice }),
  })
}

export async function getTtsVoices(): Promise<TtsVoicesResponse> {
  return request<TtsVoicesResponse>('/api/v1/tts/voices', TtsVoicesResponseSchema)
}

/** Clear conversation history (Redis messages) for a user */
export async function clearMessages(userId: string): Promise<{ status: string; user_id: string }> {
  return request('/api/v1/memory/messages/' + encodeURIComponent(userId), z.object({
    status: z.string(),
    user_id: z.string(),
  }), {
    method: 'DELETE',
  })
}

export async function get<T>(endpoint: string, schema: z.ZodSchema<T>): Promise<T> {
  return request<T>(endpoint, schema)
}

export async function post<T>(endpoint: string, schema: z.ZodSchema<T>, body?: unknown): Promise<T> {
  return request<T>(endpoint, schema, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Default export for convenience
export default {
  get,
  post,
  // Health
  checkHealth,
  getStatus,
  // Users
  getOrCreateUser,
  // Conversations
  createConversation,
  getConversation,
  getConversations,
  sendMessage,
  getMessages,
  // Memory
  searchMemory,
  getWorkingMemory,
  getKnowledge,
  clearMessages,
  // AI
  processQuery,
  synthesizeSpeech,
  getTtsVoices,
};
