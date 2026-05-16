"""
FastAPI Application — Main app factory and route registration.
"""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from backend.config import FRONTEND_DIR
from backend.routes.auth import router as auth_router
from backend.routes.analysis import router as analysis_router
from backend.routes.feedback import router as feedback_router
from backend.routes.user_data import router as user_data_router
from backend.services.auth_manager import seed_default_admin


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.endswith(('.html', '.js', '.css')) or request.url.path in ('/', '/dashboard', '/analyzer'):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title="Smart Clinical Document Analyzer",
        description="AI-Powered Clinical Trial Document Analysis API",
        version="1.0.0",
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # No-cache for dev
    app.add_middleware(NoCacheMiddleware)

    # Seed default accounts
    seed_default_admin()

    # Register API routes
    app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
    app.include_router(analysis_router, prefix="/api/analysis", tags=["Analysis"])
    app.include_router(feedback_router, prefix="/api/feedback", tags=["Feedback"])
    app.include_router(user_data_router, prefix="/api/user", tags=["User Data"])

    # ── Serve Frontend Pages ───────────────────────────────────────────────

    @app.get("/", include_in_schema=False)
    async def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/dashboard", include_in_schema=False)
    async def serve_dashboard():
        return FileResponse(FRONTEND_DIR / "dashboard.html")

    @app.get("/analyzer", include_in_schema=False)
    async def serve_analyzer():
        return FileResponse(FRONTEND_DIR / "analyzer.html")

    @app.get("/sw.js", include_in_schema=False)
    async def no_service_worker():
        return Response(content="// no service worker", media_type="application/javascript", status_code=200)

    # Static files (CSS, JS)
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")

    return app
