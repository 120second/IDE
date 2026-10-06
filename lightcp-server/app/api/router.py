from fastapi import APIRouter

from app.api.routes import auth, community, health, templates


api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(community.router)
api_router.include_router(templates.router)

