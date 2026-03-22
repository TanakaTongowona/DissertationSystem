from typing import List
from fastapi import APIRouter, Depends, status, HTTPException
from app.auth_services import oauth2, utils
from app.schemas.users import CreateUser, UserResponse, InactiveResponse,  ChangePassword, UpdateUser
from app.database.session import get_db
from app.database import models
from sqlalchemy.orm import Session

router = APIRouter(prefix="/users", tags=["Users"])

@router.post(
    "/register", status_code=status.HTTP_201_CREATED, response_model=UserResponse
)
def register_user(user_details: CreateUser, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == user_details.email).first()
    if user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account with this email already exist.",
        )
    hashed_password = utils.hash(user_details.password)
    user_details.password = hashed_password
    new_user = models.User(**user_details.dict())
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user



@router.get("/get_users", response_model=List[UserResponse])
def get_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view users.",
        )
    users = db.query(models.User).all()
    return users


@router.get("/superusers", response_model=List[UserResponse])
def get_all_superusers(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):

    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view superusers.",
        )

    superusers = db.query(models.User).filter(models.User.is_superuser).all()
    return superusers


@router.get("/inactive_users", response_model=List[InactiveResponse])
def get_inactive_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):
    """
    Retrieve a list of all users who are not yet activated.
    The admin panel can use this endpoint to populate a dropdown.
    """
    inactive_users = db.query(models.User).filter(models.User.is_active).all()
    if not inactive_users:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No inactive users found."
        )
    return inactive_users



@router.patch("/change-password", status_code=status.HTTP_200_OK)
def change_password(
    password_data: ChangePassword,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):
    """
    Change the current user's password.
    Requires current password verification.
    """
    # Verify current password
    if not utils.verify(password_data.current_password, current_user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )
    
    # Hash new password
    hashed_password = utils.hash(password_data.new_password)
    current_user.password = hashed_password
    db.commit()
    
    return {"message": "Password changed successfully"}


@router.get("/{id}", response_model=UserResponse)
def get_user(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):

    if current_user.id != id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view this user.",
        )
    user = db.query(models.User).filter(models.User.id == id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User does not exist"
        )
    return user


@router.patch("/make_user_superuser/{id}")
def make_user_superuser(
    id: int,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(oauth2.get_current_active_admin_user),
):
    user_query = db.query(models.User).filter(models.User.id == id)
    user = user_query.first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with id: {id} does not exist.",
        )
    if current_user.id == id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot make yourself a superuser.",
        )
    user.is_superuser = True
    db.commit()
    db.refresh(user)
    return {"message": "User is now superuser!"}


@router.patch("/update/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_data: UpdateUser,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_active_admin_user),
):
    """
    Update user details. Only superusers can update other users.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    # Check if email is being changed and if it's already taken
    if user_data.email and user_data.email != user.email:
        existing_user = db.query(models.User).filter(models.User.email == user_data.email).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered",
            )
    
    # Update user fields
    if user_data.first_name:
        user.first_name = user_data.first_name
    if user_data.last_name:
        user.last_name = user_data.last_name
    if user_data.email:
        user.email = user_data.email
    
    db.commit()
    db.refresh(user)
    return user


@router.patch("/activate/{user_id}", response_model=UserResponse)
def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):
    """
    Activate the selected user by setting is_active to True.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    user.is_active = True
    db.commit()
    db.refresh(user)
    return user


@router.patch("/deactivate/{user_id}", response_model=UserResponse)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):
    """
    Deactivate the selected user by setting is_active to False.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


