from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="LIGHTCP_",
        extra="ignore",
    )

    environment: str = "development"
    database_url: str = "sqlite:///./data/lightcp.db"
    jwt_secret_key: str = Field(
        default="development-only-change-this-secret-key",
        min_length=32,
    )
    jwt_issuer: str = "lightcp-server"
    jwt_audience: str = "lightcp-client"
    access_token_expire_minutes: int = Field(default=1440, ge=5, le=43200)
    reset_code_secret: str = Field(
        default="development-only-reset-code-secret",
        min_length=24,
    )
    reset_code_expire_minutes: int = Field(default=10, ge=5, le=60)

    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True

    def validate_production(self) -> None:
        if self.environment.lower() != "production":
            return
        unsafe_prefixes = ("development-only", "replace-with", "change-me")
        if self.jwt_secret_key.lower().startswith(unsafe_prefixes):
            raise RuntimeError("LIGHTCP_JWT_SECRET_KEY must be configured in production")
        if self.reset_code_secret.lower().startswith(unsafe_prefixes):
            raise RuntimeError("LIGHTCP_RESET_CODE_SECRET must be configured in production")
        if self.jwt_secret_key == self.reset_code_secret:
            raise RuntimeError("JWT and reset-code secrets must be different")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_production()
    return settings
