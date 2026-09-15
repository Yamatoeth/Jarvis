/**
 * Runtime validation schemas using Zod
 * Ensures API responses match expected types at runtime
 */
import { z } from 'zod'

/**
 * Health check response from backend
 */
export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  debug: z.boolean(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

/**
 * Generic API response wrapper
 */
export const ApiResponseSchema = <T extends z.ZodSchema>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    error: z.string().optional(),
  })

/**
 * User response from API
 */
export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string().optional(),
  full_name: z.string().optional(),
  createdAt: z.string().optional(),
}).transform((user) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName ?? user.full_name ?? user.id,
  createdAt: user.createdAt ?? new Date(0).toISOString(),
}))
export type UserResponse = z.infer<typeof UserResponseSchema>

/**
 * Message response from API
 */
export const MessageResponseSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string(),
  audioUrl: z.string().optional(),
})
export type MessageResponse = z.infer<typeof MessageResponseSchema>

/**
 * Conversation response from API
 */
export const ConversationResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
})
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>

/**
 * Status response from API
 */
export const StatusResponseSchema = z.object({
  environment: z.string(),
  redis: z.string(),
  pinecone: z.string(),
})
export type StatusResponse = z.infer<typeof StatusResponseSchema>

/**
 * Knowledge fact response from API
 */
export const KnowledgeFactSchema = z.object({
  id: z.string(),
  domain: z.enum(['identity', 'goals', 'projects', 'finances', 'relationships', 'patterns']),
  field_name: z.string(),
  field_value: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.string().default('manual'),
  last_updated: z.string(),
})
export type KnowledgeFact = z.infer<typeof KnowledgeFactSchema>

/**
 * TTS voices response from API
 */
export const TtsVoicesResponseSchema = z.object({
  voices: z.array(z.string()),
  default: z.string(),
})
export type TtsVoicesResponse = z.infer<typeof TtsVoicesResponseSchema>

/**
 * Memory hit response
 */
export const MemoryHitSchema = z.object({
  id: z.string(),
  score: z.number(),
  metadata: z.record(z.string(), z.any()),
})
export type MemoryHit = z.infer<typeof MemoryHitSchema>

/**
 * Memory search response
 */
export const MemorySearchResponseSchema = z.array(MemoryHitSchema)
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>

/**
 * Process query response schema
 */
export const ProcessQueryResponseSchema = z.object({
  response: z.string(),
  memoryUpdated: z.boolean(),
})
export type ProcessQueryResponse = z.infer<typeof ProcessQueryResponseSchema>

/**
 * Onboarding session start response
 */
export const OnboardingStartSchema = z.object({
  session_id: z.string(),
  question: z.string().nullable(),
})
export type OnboardingStartResponse = z.infer<typeof OnboardingStartSchema>

/**
 * Onboarding answer response
 */
export const OnboardingAnswerSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'already_completed']),
  next_question: z.string().nullable(),
  facts_added: z.number().optional(),
  summary: z.string().optional(),
})
export type OnboardingAnswerResponse = z.infer<typeof OnboardingAnswerSchema>

/**
 * Onboarding summary response
 */
export const OnboardingSummarySchema = z.object({
  session: z.record(z.string(), z.any()),
  kb_summary: z.string().nullable(),
})
export type OnboardingSummaryResponse = z.infer<typeof OnboardingSummarySchema>

/**
 * Validate API response with schema
 * Throws if validation fails
 */
export function validateResponse<T>(data: unknown, schema: z.ZodSchema<T>): T {
  return schema.parse(data)
}

/**
 * Safely validate API response
 * Returns result or null if validation fails
 */
export function safeValidateResponse<T>(
  data: unknown,
  schema: z.ZodSchema<T>
): T | null {
  try {
    return schema.parse(data)
  } catch (error) {
    console.error('Validation error:', error)
    return null
  }
}
