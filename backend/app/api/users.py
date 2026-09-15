
from fastapi import APIRouter, Depends
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.db import models
from app.schemas.user import UserResponse

router = APIRouter()

@router.put("/users/{user_id}", response_model=UserResponse)
async def get_or_create_user(user_id: str, db: AsyncSession = Depends(get_db)):
    email = f"user-{user_id}@local.invalid"
    try:
        user = await db.get(models.User, user_id)
        if user is None:
            user = models.User(
                id=user_id,
                email=email,
                hashed_password="!",
                full_name=f"User {user_id[:8]}",
            )
            db.add(user)
            await db.flush()
        return UserResponse(id=user.id, email=getattr(user, "email", None), full_name=getattr(user, "full_name", None))
    except SQLAlchemyError:
        return UserResponse(id=user_id, email=email, full_name=f"User {user_id[:8]}")
