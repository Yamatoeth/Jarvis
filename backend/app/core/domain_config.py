"""Shared knowledge domain configuration."""

from app.db import models

KNOWLEDGE_DOMAINS = [
    "identity",
    "goals",
    "projects",
    "finances",
    "relationships",
    "patterns",
]

MODEL_BY_DOMAIN = {
    "identity": models.KnowledgeIdentity,
    "goals": models.KnowledgeGoals,
    "projects": models.KnowledgeProjects,
    "finances": models.KnowledgeFinances,
    "relationships": models.KnowledgeRelationships,
    "patterns": models.KnowledgePatterns,
}
