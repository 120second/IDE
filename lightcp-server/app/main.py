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
from app.core.errors import AppError
from app.core.rate_limit import RateLimiter
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
    app.state.rate_limiter = RateLimiter()
    install_error_handlers(app)

    @app.middleware("http")
    async def limit_requests(request, call_next):
        path = request.url.path
        rules = {
            "/api/auth/login": (15, 60),
            "/api/auth/register": (10, 600),
            "/api/auth/forgot-password": (5, 300),
            "/api/auth/reset-password": (15, 300),
            "/api/community/messages": (30, 60),
        }
        rule = rules.get(path) if request.method == "POST" else None
        limit, seconds = rule or (600, 60)
        try:
            identity = request.client.host if request.client else "unknown"
            app.state.rate_limiter.check(path if rule else "api", identity, limit, seconds)
        except AppError as error:
            return JSONResponse(status_code=error.status_code,
                content={"error": {"code": error.code, "message": error.message}},
                headers={"Retry-After": str(seconds)})
        return await call_next(request)

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
