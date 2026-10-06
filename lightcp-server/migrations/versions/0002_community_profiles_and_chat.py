"""Add public profiles and direct messages.

Revision ID: 0002
Revises: 0001
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("display_name", sa.String(length=48), nullable=False, server_default=""))
        batch.add_column(sa.Column("bio", sa.String(length=280), nullable=False, server_default=""))
        batch.add_column(sa.Column("location", sa.String(length=80), nullable=False, server_default=""))
        batch.add_column(sa.Column("avatar_data_url", sa.Text(), nullable=False, server_default=""))

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("sender_id", sa.String(length=36), nullable=False),
        sa.Column("recipient_id", sa.String(length=36), nullable=False),
        sa.Column("body", sa.String(length=2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"])
    op.create_index("ix_chat_messages_recipient_id", "chat_messages", ["recipient_id"])
    op.create_index(
        "ix_chat_messages_sender_recipient_created",
        "chat_messages",
        ["sender_id", "recipient_id", "created_at"],
    )
    op.create_index(
        "ix_chat_messages_recipient_read", "chat_messages", ["recipient_id", "read_at"]
    )


def downgrade() -> None:
    op.drop_table("chat_messages")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("avatar_data_url")
        batch.drop_column("location")
        batch.drop_column("bio")
        batch.drop_column("display_name")
