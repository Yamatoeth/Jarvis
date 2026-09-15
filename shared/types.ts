/**
 * J.A.R.V.I.S. shared type definitions used by the mobile app and API client.
 * Phase 1 keeps the client thin: voice, conversations, and Knowledge Base facts.
 */

export interface User {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  audioUrl?: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  created_at: string;
  updated_at?: string;
}
import type { KnowledgeDomain } from "../../src/constants";

export interface KnowledgeFact {
  id: string;
  domain: KnowledgeDomain;
  field_name: string;
  field_value: string;
  confidence: number;
  source: 'onboarding' | 'conversation' | 'manual' | 'system' | string;
  last_updated: string;
}

export interface KnowledgeUpdate {
  id: string;
  user_id: string;
  conversation_id?: string | null;
  table_name: string;
  field_name: string;
  old_value?: string | null;
  new_value?: string | null;
  confidence: number;
  source: string;
  created_at: string;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  durationMs?: number;
}

export interface VoiceResponse {
  text: string;
  audioUrl?: string;
  memoryUpdated?: boolean;
}
