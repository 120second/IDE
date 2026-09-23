from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies import get_db


router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: Session = Depends(get_db)) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ready", "application": "lightcp-server"}

