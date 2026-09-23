from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.template import (
    CategoryMoveRequest,
    TemplateCategoryInput,
    TemplateCategoryResponse,
    TemplateFavoriteRequest,
    TemplateInput,
    TemplateMoveRequest,
    TemplateResponse,
)
from app.services import templates as service


router = APIRouter(tags=["templates"])


@router.get("/template-categories", response_model=list[TemplateCategoryResponse])
def list_template_categories(
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TemplateCategoryResponse]:
    return service.list_categories(session, user)


@router.post(
    "/template-categories",
    response_model=TemplateCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_template_category(
    payload: TemplateCategoryInput,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateCategoryResponse:
    return service.create_category(session, user, payload)


@router.put("/template-categories/{category_id}", response_model=TemplateCategoryResponse)
def update_template_category(
    category_id: int,
    payload: TemplateCategoryInput,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateCategoryResponse:
    return service.update_category(session, user, category_id, payload)


@router.put("/template-categories/{category_id}/move", response_model=TemplateCategoryResponse)
def move_template_category(
    category_id: int,
    payload: CategoryMoveRequest,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateCategoryResponse:
    return service.move_category(session, user, category_id, payload)


@router.delete("/template-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template_category(
    category_id: int,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    service.delete_category(session, user, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/templates", response_model=list[TemplateResponse])
def list_templates(
    kind: Literal["snippet", "file"] | None = None,
    search: str = Query(default="", max_length=120),
    favorite_only: bool = False,
    recent_only: bool = False,
    category_id: int | None = None,
    sort: Literal["manual", "name", "recentlyUsed", "usageCount", "updated", "created"] = "manual",
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TemplateResponse]:
    return service.list_templates(
        session,
        user,
        kind=kind,
        search=search,
        favorite_only=favorite_only,
        recent_only=recent_only,
        category_id=category_id,
        sort=sort,
    )


@router.get("/templates/{template_id}", response_model=TemplateResponse)
def get_template(
    template_id: int,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    return service.get_template(session, user, template_id)


@router.post("/templates", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: TemplateInput,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    return service.create_template(session, user, payload)


@router.put("/templates/{template_id}", response_model=TemplateResponse)
def update_template(
    template_id: int,
    payload: TemplateInput,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    return service.update_template(session, user, template_id, payload)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    service.delete_template(session, user, template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/templates/{template_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
def set_template_favorite(
    template_id: int,
    payload: TemplateFavoriteRequest,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    service.set_favorite(session, user, template_id, payload.favorite)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/templates/{template_id}/use", status_code=status.HTTP_204_NO_CONTENT)
def record_template_use(
    template_id: int,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    service.record_use(session, user, template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/templates/{template_id}/move", status_code=status.HTTP_204_NO_CONTENT)
def move_template(
    template_id: int,
    payload: TemplateMoveRequest,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    service.move_template(session, user, template_id, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

