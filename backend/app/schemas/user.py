from typing import Optional
from pydantic import BaseModel, Field


class UserResponse(BaseModel):
    id: str = Field(..., description="User ID")
    email: Optional[str] = None
    full_name: Optional[str] = None
