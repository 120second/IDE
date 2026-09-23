from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, error: AppError) -> JSONResponse:
        detail: dict[str, Any] = {"code": error.code, "message": error.message}
        if error.field:
            detail["field"] = error.field
        return JSONResponse(status_code=error.status_code, content={"error": detail})

    @app.exception_handler(ValidationError)
    async def handle_validation_error(_request: Request, error: ValidationError) -> JSONResponse:
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
