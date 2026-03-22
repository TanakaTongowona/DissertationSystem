from fastapi import APIRouter, Depends, status, HTTPException
from app.auth_services import oauth2, utils
# from app import schemas, database
from app.schemas.users import UserResponse, Token
from app.database.session import get_db
from app.database import models
from sqlalchemy.orm import Session
from fastapi.security.oauth2 import OAuth2PasswordRequestForm

router = APIRouter(tags=["Authentication"])

@router.post("/login", response_model=Token)
def login(
    user_credentials: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = (
        db.query(models.User)
        .filter(models.User.email == user_credentials.username)
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid credentials."
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive. Contact the admin to get your account activated"
        )
    if not utils.verify(user_credentials.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid credentials."
        )
    access_token = oauth2.create_access_token(data={"user_id": user.id})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_superuser": user.is_superuser,
        "user_id": user.id,
    }


@router.get("/seed/auth", response_model=UserResponse)
def seed_demo_credentials(db: Session = Depends(get_db)):
    admin_user = (
        db.query(models.User).filter(models.User.email == "admin@academy.com").first()
    )

    if admin_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin user exists. Try new credentials or delete existing admin user.",
        )

    new_admin_user = models.User(
        email="admin@academy.com",
        first_name="Test",
        last_name="Admin",
        password=utils.hash("password123"),
        is_superuser=True,
        is_active=True
    )

    db.add(new_admin_user)
    db.commit()
    db.refresh(new_admin_user)

    return new_admin_user

