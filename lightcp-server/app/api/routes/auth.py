from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> TokenResponse:
    return request.app.state.auth_service.register(session, payload)


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> TokenResponse:
    return request.app.state.auth_service.login(session, payload.identifier, payload.password)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> MessageResponse:
    request.app.state.auth_service.request_password_reset(session, str(payload.email))
    return MessageResponse(message="如果该邮箱已注册，验证码将发送到对应邮箱。")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> MessageResponse:
    request.app.state.auth_service.reset_password(
        session,
        str(payload.email),
        payload.code,
        payload.new_password,
    )
    return MessageResponse(message="密码已重置，请使用新密码登录。")

