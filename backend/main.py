"""
main.py
Entry point FastAPI — setup CORS, mount routers, startup/shutdown events.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from core.config import get_settings
from core.logger import setup_logger, logger
from core.database import init_db
from core.ml_pipeline import get_pipeline
from pathlib import Path

from routers.auth import router as auth_router, router_users
from routers.predict import router as predict_router
from routers.reviews import router as reviews_router, router_sources, router_results
from routers.reports import router as reports_router
from routers.scrape import router as scrape_router
from routers.preprocess import router as preprocess_router
from routers.activity import router as activity_router

settings = get_settings()


# ── Startup & Shutdown ─────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    setup_logger(settings.log_level)
    logger.info("=== Sentiment i.saku API starting ===")

    init_db()           # Buat tabel jika belum ada
    get_pipeline()      # Preload ML models

    logger.info("Startup complete — ready to serve requests")
    yield

    # Shutdown
    logger.info("=== Sentiment i.saku API shutting down ===")


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Sentiment i.saku API",
    description="Backend analisis sentimen ulasan pengguna i.saku (NB + SVM)",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",       # Swagger UI
    redoc_url="/redoc",
)

# ── CORS — izinkan frontend HTML/JS lokal ─────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",       # Live Server VS Code
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "null",                        # file:// untuk buka HTML langsung
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global exception handler ───────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Terjadi kesalahan internal server. Silakan coba lagi."},
    )

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(router_users)
app.include_router(predict_router)
app.include_router(reviews_router)
app.include_router(router_sources)
app.include_router(router_results)
app.include_router(reports_router)
app.include_router(scrape_router)
app.include_router(preprocess_router)
app.include_router(activity_router)


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
def health_check():
    pipeline = get_pipeline()
    return {
        "status": "ok",
        "models": {
            "naive_bayes": pipeline.nb_available,
            "svm": pipeline.svm_available,
        },
        "database": "connected",
    }

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount('/', StaticFiles(directory=str(FRONTEND_DIR), html=True),
            name='frontend')

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=(settings.app_env == "development"),
        log_level="warning",  # uvicorn log dikurangi, loguru yang handle
    )
