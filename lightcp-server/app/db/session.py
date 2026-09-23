from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker


class Database:
    def __init__(self, url: str) -> None:
        if url.startswith("sqlite:///"):
            database_path = url.removeprefix("sqlite:///")
            if database_path != ":memory:":
                Path(database_path).parent.mkdir(parents=True, exist_ok=True)

        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
        if url.startswith("sqlite"):
            event.listen(self.engine, "connect", _configure_sqlite)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
            class_=Session,
        )

    def session(self) -> Generator[Session, None, None]:
        with self.session_factory() as session:
            yield session

    def dispose(self) -> None:
        self.engine.dispose()


def _configure_sqlite(dbapi_connection: object, _connection_record: object) -> None:
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA synchronous = NORMAL")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.close()
