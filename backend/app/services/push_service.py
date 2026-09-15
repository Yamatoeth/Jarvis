"""Simple push service to send pending messages using Expo push API.

In production use a robust worker (Celery) and handle failures/retries.
"""
import asyncio
import json
from typing import Any, Dict, List
import aiohttp
from aiohttp import ClientTimeout
from app.db.redis_client import redis_client
import logging

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
LOGGER = logging.getLogger(__name__)


def _chunked(iterable, size: int):
    it = iter(iterable)
    while True:
        chunk = []
        try:
            for _ in range(size):
                chunk.append(next(it))
        except StopIteration:
            if chunk:
                yield chunk
            break
        yield chunk


async def _post_with_retries(session: aiohttp.ClientSession, payload: List[Dict], max_retries: int = 3) -> Dict:
    backoff = 1.0
    for attempt in range(1, max_retries + 1):
        try:
            async with session.post(EXPO_PUSH_URL, json=payload, timeout=ClientTimeout(total=10)) as resp:
                text = await resp.text()
                if resp.status == 200:
                    return {'status': 'ok', 'response': text}
                else:
                    LOGGER.warning('Expo push returned %s: %s', resp.status, text)
                    # retry on 5xx
                    if 500 <= resp.status < 600:
                        raise aiohttp.ClientResponseError(resp.request_info, resp.history, status=resp.status)
                    return {'status': 'failed', 'http_status': resp.status, 'body': text}
        except Exception as e:
            LOGGER.warning('Push attempt %s failed: %s', attempt, e)
            if attempt == max_retries:
                return {'status': 'error', 'error': str(e)}
            await asyncio.sleep(backoff)
            backoff *= 2
    return {'status': 'error', 'error': 'max retries exceeded'}


async def send_pending_for_user(user_id: str | int, batch_size: int = 50, concurrency: int = 4) -> Dict[str, Any]:
    """Send pending pushes for a given user.

    - Batches messages and tokens
    - Retries transient failures
    - Limits concurrency
    - Returns summary of sent/failed counts
    """
    await redis_client.connect()
    pending_key = f"pending_push:{user_id}"
    tokens_key = f"push_tokens:{user_id}"
    tokens = redis_client.client.smembers(tokens_key) or []
    if not tokens:
        return {'sent': 0, 'reason': 'no_tokens'}

    # Drain pending messages into a list (pop all)
    messages = []
    while True:
        item = redis_client.client.lpop(pending_key)
        if not item:
            break
        try:
            msg = json.loads(item) if isinstance(item, str) else item
            if isinstance(msg, dict):
                messages.append(msg)
            else:
                messages.append({'title': 'JARVIS', 'body': str(msg)})
        except (json.JSONDecodeError, TypeError):
            messages.append({'title': 'JARVIS', 'body': str(item)})

    if not messages:
        return {'sent': 0, 'reason': 'no_messages'}

    sent = 0
    errors: List[str] = []

    semaphore = asyncio.Semaphore(concurrency)

    async with aiohttp.ClientSession() as session:
        async def send_batch(batch_tokens: List[str], message: Dict) -> None:
            async with semaphore:
                # Build payload: one message per token
                payload = []
                for t in batch_tokens:
                    payload.append({
                        'to': t,
                        'title': message.get('title'),
                        'body': message.get('body'),
                        'data': message.get('data', {}),
                    })
                res = await _post_with_retries(session, payload)
                if res.get('status') == 'ok':
                    nonlocal sent
                    sent += len(batch_tokens)
                else:
                    errors.append(str(res))

        tasks = []
        # For each message, send to tokens in chunks
        for message in messages:
            for chunk in _chunked(tokens, batch_size):
                tasks.append(asyncio.create_task(send_batch(chunk, message)))

        if tasks:
            await asyncio.gather(*tasks)

    return {'sent': sent, 'errors': errors}


async def send_all_pending():
    await redis_client.connect()
    keys = await redis_client.client.keys('pending_push:*')
    summary = {}
    for k in keys:
        user_id = k.split(':', 1)[1]
        res = await send_pending_for_user(user_id)
        summary[user_id] = res
    return summary
