"""
Knowledge Base API.

PostgreSQL is the durable source of truth for Phase 1 knowledge. Redis is used
only by background extraction/context code as a cache for compact summaries.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.fact_extractor import extract_facts, facts_to_kb_updates
from app.core.domain_config import MODEL_BY_DOMAIN
from app.db import models
from app.db.database import async_session_maker

router = APIRouter()
class KBUpdate(BaseModel):
    domain: str
    user_id: str
    field_name: str
    field_value: str
    confidence: float = Field(default=0.6, ge=0.0, le=1.0)
    source: str = "manual"
    conversation_id: Optional[str] = None


class KBApplyRequest(BaseModel):
    updates: list[KBUpdate]


class ExtractRequest(BaseModel):
    user_id: str
    transcript: str
    conversation_id: Optional[str] = None


def _model_for_domain(domain: str):
    model_cls = MODEL_BY_DOMAIN.get(domain)
    if model_cls is None:
        raise HTTPException(status_code=400, detail=f"unknown domain: {domain}")
    return model_cls


def _serialize_row(domain: str, row: Any) -> dict[str, Any]:
    return {
        "id": getattr(row, "id", None),
        "domain": domain,
        "field_name": getattr(row, "field_name", None),
        "field_value": getattr(row, "field_value", None),
        "confidence": getattr(row, "confidence", None),
        "source": getattr(row, "source", None),
        "last_updated": getattr(row, "last_updated", None).isoformat()
        if getattr(row, "last_updated", None)
        else None,
    }


async def _find_row_by_id(session, kb_id: str, user_id: str | None = None):
    for domain, model_cls in MODEL_BY_DOMAIN.items():
        stmt = select(model_cls).where(model_cls.id == kb_id)
        if user_id:
            stmt = stmt.where(model_cls.user_id == user_id)
        result = await session.execute(stmt)
        row = result.scalars().first()
        if row:
            return domain, model_cls, row
    return None, None, None


async def _apply_one(session, update: KBUpdate) -> bool:
    model_cls = _model_for_domain(update.domain)

    result = await session.execute(
        select(model_cls).where(
            model_cls.user_id == update.user_id,
            model_cls.field_name == update.field_name,
        )
    )
    existing = result.scalars().first()

    old_value = None
    should_write = existing is None
    if existing is not None:
        old_value = existing.field_value
        should_write = update.confidence >= float(existing.confidence or 0.0)

    if not should_write:
        return False

    if existing is None:
        session.add(
            model_cls(
                user_id=update.user_id,
                field_name=update.field_name,
                field_value=update.field_value,
                confidence=update.confidence,
                source=update.source,
                last_updated=datetime.utcnow(),
            )
        )
    else:
        existing.field_value = update.field_value
        existing.confidence = update.confidence
        existing.source = update.source
        existing.last_updated = datetime.utcnow()

    session.add(
        models.KnowledgeUpdate(
            user_id=update.user_id,
            conversation_id=update.conversation_id,
            table_name=model_cls.__tablename__,
            field_name=update.field_name,
            old_value=old_value,
            new_value=update.field_value,
            confidence=update.confidence,
            source=update.source,
        )
    )
    return True


def _summary_parts(items: Iterable[dict[str, Any]]) -> list[str]:
    grouped: dict[str, list[str]] = {}
    for item in items:
        domain = item.get("domain")
        field_name = item.get("field_name")
        field_value = item.get("field_value")
        if not domain or not field_name or not field_value:
            continue
        grouped.setdefault(str(domain), []).append(f"{field_name}: {field_value}")
    return [f"{domain}: {'; '.join(values[:5])}" for domain, values in grouped.items()]


@router.get("/kb")
async def list_knowledge(user_id: str = Query(...)):
    """Return all PostgreSQL KB facts for a user."""
    items: list[dict[str, Any]] = []
    async with async_session_maker() as session:
        for domain, model_cls in MODEL_BY_DOMAIN.items():
            result = await session.execute(
                select(model_cls)
                .where(model_cls.user_id == user_id)
                .order_by(model_cls.confidence.desc())
            )
            items.extend(_serialize_row(domain, row) for row in result.scalars().all())
    return items


@router.post("/kb")
async def create_knowledge(payload: dict[str, Any]):
    """Create or update a durable KB fact."""
    update = KBUpdate(
        domain=payload.get("domain", "identity"),
        user_id=str(payload.get("user_id") or ""),
        field_name=payload.get("field_name") or payload.get("title") or "manual_note",
        field_value=payload.get("field_value") or payload.get("content") or "",
        confidence=float(payload.get("confidence", 0.7)),
        source=payload.get("source", "manual"),
    )
    if not update.user_id or not update.field_value:
        raise HTTPException(status_code=400, detail="user_id and field_value/content required")

    async with async_session_maker() as session:
        applied = await _apply_one(session, update)
        await session.commit()
    return {"applied": applied}


@router.put("/kb/{kb_id}")
async def update_knowledge(kb_id: str, user_id: str = Query(...), payload: dict[str, Any] = Body(...)):
    """Update a KB fact by id."""
    async with async_session_maker() as session:
        domain, model_cls, row = await _find_row_by_id(session, kb_id, user_id)
        if row is None or model_cls is None:
            raise HTTPException(status_code=404, detail="KB entry not found")
        if row.user_id != user_id:
            raise HTTPException(status_code=403, detail="not authorized")

        old_value = row.field_value
        if "field_name" in payload:
            row.field_name = str(payload["field_name"])
        if "field_value" in payload or "content" in payload:
            row.field_value = str(payload.get("field_value") or payload.get("content") or "")
        if "confidence" in payload:
            row.confidence = float(payload["confidence"])
        if "source" in payload:
            row.source = str(payload["source"])
        row.last_updated = datetime.utcnow()

        session.add(
            models.KnowledgeUpdate(
                user_id=row.user_id,
                conversation_id=None,
                table_name=model_cls.__tablename__,
                field_name=row.field_name,
                old_value=old_value,
                new_value=row.field_value,
                confidence=row.confidence,
                source=payload.get("source", "manual"),
            )
        )
        await session.commit()

    return {"status": "ok", "item": _serialize_row(domain, row)}


@router.delete("/kb/{kb_id}")
async def delete_knowledge(kb_id: str, user_id: Optional[str] = Query(None)):
    """Delete a KB fact by id."""
    async with async_session_maker() as session:
        _, _, row = await _find_row_by_id(session, kb_id, user_id)
        if row is None:
            raise HTTPException(status_code=404, detail="KB entry not found")
        await session.delete(row)
        await session.commit()
    return {"status": "deleted", "id": kb_id}


@router.get("/kb/summary")
async def knowledge_summary(user_id: str = Query(...)):
    """Return a compact summary built from PostgreSQL KB facts."""
    items = await list_knowledge(user_id)
    parts = _summary_parts(items)
    return {"summary": " | ".join(parts), "count": len(items)}


@router.post("/kb/apply")
async def apply_updates(req: KBApplyRequest):
    """Apply structured KB updates to PostgreSQL with confidence conflict resolution."""
    applied = 0
    async with async_session_maker() as session:
        for update in req.updates:
            if await _apply_one(session, update):
                applied += 1
        await session.commit()
    return {"applied": applied}


@router.get("/kb/items/{domain}/{user_id}")
async def list_domain_items(domain: str, user_id: str):
    """List all PostgreSQL KB items for a domain."""
    model_cls = _model_for_domain(domain)
    async with async_session_maker() as session:
        result = await session.execute(select(model_cls).where(model_cls.user_id == user_id))
        rows = result.scalars().all()
    return {"items": [_serialize_row(domain, row) for row in rows]}


@router.post("/kb/extract")
async def extract_updates(req: ExtractRequest):
    """Extract KB update candidates from a transcript without applying them."""
    facts = await extract_facts(req.transcript)
    updates = []
    for update in facts_to_kb_updates(facts):
        updates.append(
            {
                **update,
                "user_id": req.user_id,
                "conversation_id": req.conversation_id,
            }
        )
    return {"suggested": updates, "errors": []}
