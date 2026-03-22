from pydantic import BaseModel, EmailStr, validator
from typing import Optional

class CreateUser(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    password: str
    is_superuser: bool = False
    is_active: bool = False

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: EmailStr
    is_superuser: bool
    is_active: bool

    class Config:
        from_attributes = True


class InactiveResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: EmailStr
    is_superuser: bool

    class Config:
        from_attributes = True


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    is_superuser: bool
    user_id: int


class TokenData(BaseModel):
    id: str | None = None
    
    
# Add this to your schemas.py
class ChangePassword(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str
    
    @validator('new_password')
    def validate_password_length(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        return v
    
    @validator('confirm_password')
    def passwords_match(cls, v, values, **kwargs):
        if 'new_password' in values and v != values['new_password']:
            raise ValueError('Passwords do not match')
        return v

# Add this to your schemas.py
class UpdateUser(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None

