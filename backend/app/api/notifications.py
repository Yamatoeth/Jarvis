from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db.redis_client import redis_client
from app.core.config import get_settings
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class RegisterTokenRequest(BaseModel):
    user_id: str | int
    token: str


class ScheduleRequest(BaseModel):
    user_id: str | int
    title: str
    body: str
    when_ts: int | None = None  # epoch seconds, optional immediate


class NotificationStatusResponse(BaseModel):
    status: str


@router.post('/notifications/register', response_model=NotificationStatusResponse)
async def register_token(req: RegisterTokenRequest) -> NotificationStatusResponse:
    await redis_client.connect()
    # Basic validation of Expo push token format (best-effort)
    token = (req.token or '').strip()
    if not token or len(token) < 10:
        raise HTTPException(status_code=400, detail='Invalid token')

    key = f"push_tokens:{req.user_id}"
    # store as set (dedup)
    await redis_client.client.sadd(key, token)
    # keep tokens for 90 days
    await redis_client.client.expire(key, 60 * 60 * 24 * 90)
    return NotificationStatusResponse(status='ok')


@router.post('/notifications/schedule', response_model=NotificationStatusResponse)
async def schedule_notification(req: ScheduleRequest) -> NotificationStatusResponse:
    await redis_client.connect()
    # store scheduled notification in a Redis list for worker processing
    key = f"scheduled_notifications:{req.user_id}"
    payload = {"title": req.title, "body": req.body, "when_ts": req.when_ts}
    await redis_client.client.rpush(key, json.dumps(payload))
    # In production, Celery/worker should pick these up and call push service
    return NotificationStatusResponse(status='scheduled')


@router.post('/notifications/checkin')
async def jarvis_checkin(user_id: str | int) -> dict:
    """Trigger a simple check-in notification to be sent to the user. Useful for testing."""
    await redis_client.connect()
    key = f"push_tokens:{user_id}"
    tokens = await redis_client.client.smembers(key)
    if not tokens:
        raise HTTPException(status_code=404, detail='No push tokens for user')

    # Enforce daily limit per settings
    settings = get_settings()
    today_key = datetime.utcnow().strftime('%Y-%m-%d')
    counter_key = f"push_count:{user_id}:{today_key}"
    count = await redis_client.client.get(counter_key) or 0
    try:
        count = int(count)
    except Exception:
        count = 0

    if count >= settings.max_proactive_notifications_per_day:
        raise HTTPException(status_code=429, detail='Daily notification limit reached')

    # Queue pending message for worker
    pending_key = f"pending_push:{user_id}"
    message = {"title": "JARVIS: Quick check-in", "body": "You mentioned finishing X last week — update?"}
    await redis_client.client.rpush(pending_key, str(message))
    await redis_client.client.expire(pending_key, 60 * 60 * 24)

    # increment counter with 24h expiry
    await redis_client.client.incr(counter_key)
    await redis_client.client.expire(counter_key, 60 * 60 * 24)

    return {'status': 'queued', 'tokens_count': len(tokens), 'today_count': count + 1}
