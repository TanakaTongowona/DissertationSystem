from jose import JWTError, jwt
from datetime import datetime, timedelta
from app.schemas.users import UserResponse
from fastapi import HTTPException, status, Depends
from app.database.session import get_db
from app.database import models
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

oauth2 = OAuth2PasswordBearer(tokenUrl="login")

SECRET_KEY = "This is some arbitrary text"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_access_token(token, credentials_exception):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        id: str = payload.get("user_id")
        if id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return id


def get_current_user(
    token: str = Depends(oauth2), db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id = verify_access_token(token, credentials_exception)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    return user


def get_current_active_admin_user(
    current_user: UserResponse = Depends(get_current_user),
):
    if not current_user.is_superuser:
        raise status.HTTP_403_FORBIDDEN("Forbidden: Admin access required")

    return current_user
