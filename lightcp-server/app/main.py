from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.db import models  # noqa: F401
from app.db.base import Base
from app.db.session import Database
from app.services.auth import AuthService
from app.services.email import EmailSender, SmtpEmailSender


logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    email_sender: EmailSender | None = None,
    initialize_schema: bool = False,
) -> FastAPI:
    settings = settings or get_settings()
    settings.validate_production()
    database = Database(settings.database_url)
    if initialize_schema:
        Base.metadata.create_all(database.engine)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        database.dispose()

    app = FastAPI(
        title="LightCP Server",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.database = database
    app.state.email_sender = email_sender or SmtpEmailSender(settings)
    app.state.auth_service = AuthService(settings, app.state.email_sender)
    install_error_handlers(app)

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(_request, error: RequestValidationError) -> JSONResponse:
        details = [
            {
                "type": item.get("type", "validation_error"),
                "location": list(item.get("loc", ())),
                "message": item.get("msg", "Invalid value"),
            }
            for item in error.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "请求数据不符合要求。",
                    "details": details,
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request, error: Exception) -> JSONResponse:
        logger.exception("Unhandled LightCP API error", exc_info=error)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "服务器暂时无法完成请求。",
                }
            },
        )

    app.include_router(api_router)
    return app


app = create_app()
