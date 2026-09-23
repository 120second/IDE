from __future__ import annotations

import json

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import utcnow
from app.db.models.template import Template, TemplateCategory
from app.db.models.user import User
from app.schemas.template import (
    CategoryMoveRequest,
    TemplateCategoryInput,
    TemplateCategoryResponse,
    TemplateInput,
    TemplateMoveRequest,
    TemplateResponse,
)


def category_response(category: TemplateCategory) -> TemplateCategoryResponse:
    return TemplateCategoryResponse.model_validate(category)


def template_response(template: Template) -> TemplateResponse:
    try:
        aliases = json.loads(template.aliases_json)
    except json.JSONDecodeError:
        aliases = []
    return TemplateResponse(
        id=template.id,
        kind=template.kind,
        name=template.name,
        trigger=template.trigger,
        aliases=aliases if isinstance(aliases, list) else [],
        description=template.description,
        language=template.language,
        category_id=template.category_id,
        favorite=template.favorite,
        sort_order=template.sort_order,
        use_count=template.use_count,
        last_used=template.last_used,
        code=template.code,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


def list_categories(session: Session, user: User) -> list[TemplateCategoryResponse]:
    rows = session.scalars(
        select(TemplateCategory)
        .where(TemplateCategory.user_id == user.id)
        .order_by(TemplateCategory.sort_order, TemplateCategory.id)
    ).all()
    return [category_response(row) for row in rows]


def create_category(
    session: Session, user: User, request: TemplateCategoryInput
) -> TemplateCategoryResponse:
    _validate_parent(session, user, request.parent_id)
    category = TemplateCategory(user_id=user.id, **request.model_dump())
    session.add(category)
    session.commit()
    session.refresh(category)
    return category_response(category)


def update_category(
    session: Session,
    user: User,
    category_id: int,
    request: TemplateCategoryInput,
) -> TemplateCategoryResponse:
    category = _owned_category(session, user, category_id)
    _validate_parent(session, user, request.parent_id, category_id)
    category.name = request.name
    category.parent_id = request.parent_id
    category.sort_order = request.sort_order
    category.updated_at = utcnow()
    session.commit()
    session.refresh(category)
    return category_response(category)


def move_category(
    session: Session, user: User, category_id: int, request: CategoryMoveRequest
) -> TemplateCategoryResponse:
    category = _owned_category(session, user, category_id)
    _validate_parent(session, user, request.parent_id, category_id)
    category.parent_id = request.parent_id
    category.sort_order = request.sort_order
    category.updated_at = utcnow()
    session.commit()
    session.refresh(category)
    return category_response(category)


def delete_category(session: Session, user: User, category_id: int) -> None:
    category = _owned_category(session, user, category_id)
    session.delete(category)
    session.commit()


def list_templates(
    session: Session,
    user: User,
    *,
    kind: str | None = None,
    search: str = "",
    favorite_only: bool = False,
    recent_only: bool = False,
    category_id: int | None = None,
    sort: str = "manual",
) -> list[TemplateResponse]:
    statement: Select[tuple[Template]] = select(Template).where(Template.user_id == user.id)
    if kind:
        statement = statement.where(Template.kind == kind)
    if search.strip():
        escaped = search.strip().replace("%", r"\%").replace("_", r"\_")
        pattern = f"%{escaped}%"
        statement = statement.where(
            Template.name.ilike(pattern, escape="\\")
            | Template.trigger.ilike(pattern, escape="\\")
            | Template.aliases_json.ilike(pattern, escape="\\")
        )
    if favorite_only:
        statement = statement.where(Template.favorite.is_(True))
    if recent_only:
        statement = statement.where(Template.last_used.is_not(None))
    if category_id is not None:
        category_ids = _category_subtree_ids(session, user, category_id)
        statement = statement.where(Template.category_id.in_(category_ids))

    orderings = {
        "manual": (Template.sort_order, Template.id),
        "name": (func.lower(Template.name), Template.id),
        "recentlyUsed": (Template.last_used.desc(), Template.id),
        "usageCount": (Template.use_count.desc(), func.lower(Template.name), Template.id),
        "updated": (Template.updated_at.desc(), Template.id),
        "created": (Template.created_at.desc(), Template.id),
    }
    statement = statement.order_by(*orderings.get(sort, orderings["manual"]))
    return [template_response(row) for row in session.scalars(statement).all()]


def get_template(session: Session, user: User, template_id: int) -> TemplateResponse:
    return template_response(_owned_template(session, user, template_id))


def create_template(session: Session, user: User, request: TemplateInput) -> TemplateResponse:
    _validate_category(session, user, request.category_id)
    values = request.model_dump(exclude={"aliases"})
    template = Template(
        user_id=user.id,
        aliases_json=json.dumps(request.aliases, ensure_ascii=False),
        **values,
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    return template_response(template)


def update_template(
    session: Session, user: User, template_id: int, request: TemplateInput
) -> TemplateResponse:
    template = _owned_template(session, user, template_id)
    _validate_category(session, user, request.category_id)
    for key, value in request.model_dump(exclude={"aliases"}).items():
        setattr(template, key, value)
    template.aliases_json = json.dumps(request.aliases, ensure_ascii=False)
    template.updated_at = utcnow()
    session.commit()
    session.refresh(template)
    return template_response(template)


def delete_template(session: Session, user: User, template_id: int) -> None:
    template = _owned_template(session, user, template_id)
    session.delete(template)
    session.commit()


def set_favorite(session: Session, user: User, template_id: int, favorite: bool) -> None:
    template = _owned_template(session, user, template_id)
    template.favorite = favorite
    template.updated_at = utcnow()
    session.commit()


def record_use(session: Session, user: User, template_id: int) -> None:
    template = _owned_template(session, user, template_id)
    template.use_count += 1
    template.last_used = utcnow()
    session.commit()


def move_template(
    session: Session, user: User, template_id: int, request: TemplateMoveRequest
) -> None:
    template = _owned_template(session, user, template_id)
    _validate_category(session, user, request.category_id)
    template.category_id = request.category_id
    template.sort_order = request.sort_order
    template.updated_at = utcnow()
    session.commit()


def _owned_category(session: Session, user: User, category_id: int) -> TemplateCategory:
    category = session.scalar(
        select(TemplateCategory).where(
            TemplateCategory.id == category_id,
            TemplateCategory.user_id == user.id,
        )
    )
    if not category:
        raise AppError(404, "CATEGORY_NOT_FOUND", "模板分类不存在。")
    return category


def _owned_template(session: Session, user: User, template_id: int) -> Template:
    template = session.scalar(
        select(Template).where(Template.id == template_id, Template.user_id == user.id)
    )
    if not template:
        raise AppError(404, "TEMPLATE_NOT_FOUND", "模板不存在。")
    return template


def _validate_parent(
    session: Session,
    user: User,
    parent_id: int | None,
    category_id: int | None = None,
) -> None:
    visited: set[int] = set()
    current_id = parent_id
    while current_id is not None:
        if current_id == category_id or current_id in visited:
            raise AppError(422, "INVALID_CATEGORY_PARENT", "分类层级不能形成循环。")
        visited.add(current_id)
        current_id = _owned_category(session, user, current_id).parent_id


def _validate_category(session: Session, user: User, category_id: int | None) -> None:
    if category_id is not None:
        _owned_category(session, user, category_id)


def _category_subtree_ids(session: Session, user: User, root_id: int) -> set[int]:
    categories = session.scalars(
        select(TemplateCategory).where(TemplateCategory.user_id == user.id)
    ).all()
    result = {root_id}
    while True:
        previous_size = len(result)
        result.update(
            category.id
            for category in categories
            if category.parent_id in result
        )
        if len(result) == previous_size:
            return result
