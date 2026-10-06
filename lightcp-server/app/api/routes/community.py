from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import AppError
from app.core.time import utcnow
from app.db.models.chat import ChatMessage
from app.db.models.user import User
from app.schemas.auth import UserResponse
from app.schemas.community import (
    ChatMessageResponse,
    ConversationResponse,
    MessageCreate,
    ProfileUpdate,
    UserSummary,
)


router = APIRouter(prefix="/community", tags=["community"])


def _summary(user: User) -> UserSummary:
    return UserSummary.model_validate(user)


@router.put("/profile", response_model=UserResponse)
def update_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> UserResponse:
    user.display_name = payload.display_name
    user.bio = payload.bio
    user.location = payload.location
    user.avatar_data_url = payload.avatar_data_url
    session.commit()
    session.refresh(user)
    return UserResponse.model_validate(user)


@router.get("/users", response_model=list[UserSummary])
def search_users(
    query: str = Query(default="", max_length=80),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> list[UserSummary]:
    term = query.strip().casefold()
    statement = select(User).where(User.is_active.is_(True), User.id != user.id)
    if term:
        pattern = f"%{term}%"
        statement = statement.where(
            or_(
                User.username_normalized.like(pattern),
                User.display_name.ilike(pattern),
            )
        )
    users = session.scalars(statement.order_by(User.username_normalized).limit(20)).all()
    return [_summary(item) for item in users]


@router.get("/conversations", response_model=list[ConversationResponse])
def list_conversations(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> list[ConversationResponse]:
    participant_filter = or_(ChatMessage.sender_id == user.id, ChatMessage.recipient_id == user.id)
    other_user = case(
        (ChatMessage.sender_id == user.id, ChatMessage.recipient_id),
        else_=ChatMessage.sender_id,
    )
    latest = (
        select(
            other_user.label("other_user_id"),
            func.max(ChatMessage.created_at).label("last_at"),
        )
        .where(participant_filter)
        .group_by(other_user)
        .subquery()
    )
    messages = session.scalars(
        select(ChatMessage)
        .join(
            latest,
            and_(
                other_user == latest.c.other_user_id,
                ChatMessage.created_at == latest.c.last_at,
            ),
        )
        .where(participant_filter)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
    ).all()
    latest_by_user: dict[str, ChatMessage] = {}
    for message in messages:
        other_id = message.recipient_id if message.sender_id == user.id else message.sender_id
        latest_by_user.setdefault(other_id, message)
    if not latest_by_user:
        return []
    unread_by_user = dict(
        session.execute(
            select(ChatMessage.sender_id, func.count(ChatMessage.id))
            .where(ChatMessage.recipient_id == user.id, ChatMessage.read_at.is_(None))
            .group_by(ChatMessage.sender_id)
        ).all()
    )
    people = {
        item.id: item
        for item in session.scalars(select(User).where(User.id.in_(latest_by_user))).all()
    }
    return [
        ConversationResponse(
            user=_summary(people[other_id]),
            last_message=ChatMessageResponse.model_validate(message),
            unread_count=unread_by_user.get(other_id, 0),
        )
        for other_id, message in latest_by_user.items()
        if other_id in people
    ]


@router.get("/messages/{other_user_id}", response_model=list[ChatMessageResponse])
def list_messages(
    other_user_id: str,
    limit: int = Query(default=80, ge=1, le=200),
    before_id: str | None = Query(default=None, max_length=36),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> list[ChatMessageResponse]:
    other = session.scalar(select(User).where(User.id == other_user_id, User.is_active.is_(True)))
    if not other:
        raise AppError(404, "USER_NOT_FOUND", "没有找到这个用户。")
    participants = or_(
        and_(ChatMessage.sender_id == user.id, ChatMessage.recipient_id == other_user_id),
        and_(ChatMessage.sender_id == other_user_id, ChatMessage.recipient_id == user.id),
    )
    statement = select(ChatMessage).where(participants)
    if before_id:
        cursor = session.scalar(select(ChatMessage).where(participants, ChatMessage.id == before_id))
        if not cursor:
            raise AppError(404, "MESSAGE_NOT_FOUND", "找不到这条消息。")
        statement = statement.where(or_(
            ChatMessage.created_at < cursor.created_at,
            and_(ChatMessage.created_at == cursor.created_at, ChatMessage.id < cursor.id),
        ))
    messages = list(
        session.scalars(
            statement.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(limit)
        ).all()
    )
    if messages:
        newest = messages[0]
        read_at = utcnow()
        session.execute(update(ChatMessage).where(
            ChatMessage.sender_id == other_user_id,
            ChatMessage.recipient_id == user.id,
            ChatMessage.read_at.is_(None),
            or_(ChatMessage.created_at < newest.created_at,
                and_(ChatMessage.created_at == newest.created_at, ChatMessage.id <= newest.id)),
        ).values(read_at=read_at), execution_options={"synchronize_session": "fetch"})
        session.commit()
    messages.reverse()
    return [ChatMessageResponse.model_validate(item) for item in messages]


@router.post("/messages", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
def send_message(
    payload: MessageCreate,
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> ChatMessageResponse:
    request.app.state.rate_limiter.check("message-user", user.id, 20, 60)
    if payload.recipient_id == user.id:
        raise AppError(400, "SELF_MESSAGE", "不能给自己发送消息。")
    recipient = session.scalar(
        select(User).where(User.id == payload.recipient_id, User.is_active.is_(True))
    )
    if not recipient:
        raise AppError(404, "USER_NOT_FOUND", "没有找到这个用户。")
    message = ChatMessage(sender_id=user.id, recipient_id=recipient.id, body=payload.body)
    session.add(message)
    session.commit()
    session.refresh(message)
    return ChatMessageResponse.model_validate(message)
