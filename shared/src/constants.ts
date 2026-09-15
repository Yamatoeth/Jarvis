/**
 * Shared constants used across the project.
 */

export const KNOWLEDGE_DOMAINS = [
  "identity",
  "goals",
  "projects",
  "finances",
  "relationships",
  "patterns",
] as const

export type KnowledgeDomain = typeof KNOWLEDGE_DOMAINS[number]
