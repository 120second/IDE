from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base


class TemplateCategory(Base):
    __tablename__ = "template_categories"
    __table_args__ = (
        Index("ix_template_categories_user_parent_sort", "user_id", "parent_id", "sort_order", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("template_categories.id", ondelete="CASCADE")
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    user = relationship("User", back_populates="template_categories")
    parent = relationship("TemplateCategory", remote_side=[id], back_populates="children")
    children = relationship("TemplateCategory", back_populates="parent", passive_deletes=True)
    templates = relationship("Template", back_populates="category", passive_deletes=True)


class Template(Base):
    __tablename__ = "templates"
    __table_args__ = (
        CheckConstraint("kind IN ('snippet', 'file')", name="ck_templates_kind"),
        Index("ix_templates_user_kind_sort", "user_id", "kind", "sort_order", "id"),
        Index("ix_templates_user_updated", "user_id", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    trigger: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    aliases_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    description: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    language: Mapped[str] = mapped_column(String(32), nullable=False, default="cpp")
    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("template_categories.id", ondelete="SET NULL")
    )
    favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_used: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    code: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    user = relationship("User", back_populates="templates")
    category = relationship("TemplateCategory", back_populates="templates")
