"""Initial LightCP authentication and template schema.

Revision ID: 0001
Revises:
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("username_normalized", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("email_normalized", sa.String(length=254), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email_normalized"),
        sa.UniqueConstraint("username_normalized"),
    )
    op.create_index("ix_users_email_normalized", "users", ["email_normalized"])
    op.create_index("ix_users_username_normalized", "users", ["username_normalized"])

    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("code_digest", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_password_reset_user_created",
        "password_reset_codes",
        ["user_id", "created_at"],
    )

    op.create_table(
        "template_categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["template_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_template_categories_user_id", "template_categories", ["user_id"])
    op.create_index(
        "ix_template_categories_user_parent_sort",
        "template_categories",
        ["user_id", "parent_id", "sort_order", "id"],
    )

    op.create_table(
        "templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("trigger", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("aliases_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("description", sa.String(length=2000), nullable=False, server_default=""),
        sa.Column("language", sa.String(length=32), nullable=False, server_default="cpp"),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used", sa.DateTime(timezone=True), nullable=True),
        sa.Column("code", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('snippet', 'file')", name="ck_templates_kind"),
        sa.ForeignKeyConstraint(["category_id"], ["template_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_templates_user_id", "templates", ["user_id"])
    op.create_index(
        "ix_templates_user_kind_sort", "templates", ["user_id", "kind", "sort_order", "id"]
    )
    op.create_index("ix_templates_user_updated", "templates", ["user_id", "updated_at"])


def downgrade() -> None:
    op.drop_table("templates")
    op.drop_table("template_categories")
    op.drop_table("password_reset_codes")
    op.drop_table("users")

