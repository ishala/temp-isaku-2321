"""
core/activity.py
Helper pencatatan audit trail aktivitas pengguna ke tabel activity_logs.

Dipakai oleh router-router untuk mencatat aksi penting (login, CRUD,
prediksi, preprocessing, scraping, approval, koreksi label, dll).

Catatan desain:
- log_activity() memakai SESSION TERPISAH agar pencatatan audit tidak
  ikut ter-rollback bila transaksi pemanggil gagal, dan kegagalan
  pencatatan TIDAK PERNAH menggagalkan request utama (selalu try/except).
- Hanya menerima nilai primitif (user_id, username) supaya aman dipanggil
  setelah session pemanggil di-commit/refresh.
"""
from typing import Optional, Any

from core.database import SessionLocal, ActivityLog
from core.logger import logger


# ── Kosakata aksi & entitas (dipakai konsisten FE & BE) ────────────────────────
class Action:
    LOGIN      = "login"
    LOGOUT     = "logout"
    CREATE     = "create"
    UPDATE     = "update"
    DELETE     = "delete"
    PREDICT    = "predict"
    PREPROCESS = "preprocess"
    SCRAPE     = "scrape"
    APPROVE    = "approve"
    REJECT     = "reject"
    CORRECT    = "correct"
    EXPORT     = "export"


class Entity:
    AUTH       = "auth"
    USER       = "user"
    REVIEW     = "review"
    SOURCE     = "source"
    PREDICTION = "prediction"
    BATCH      = "batch"


def _client_ip(request: Any) -> Optional[str]:
    """Ekstrak IP klien dari Request FastAPI (None bila tidak tersedia)."""
    if request is None:
        return None
    try:
        # Hormati proxy header bila ada, fallback ke koneksi langsung
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host if request.client else None
    except Exception:
        return None


def log_activity(
    *,
    action: str,
    user: Any = None,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    entity: Optional[str] = None,
    entity_id: Optional[int] = None,
    description: Optional[str] = None,
    status: str = "success",
    request: Any = None,
    ip: Optional[str] = None,
) -> None:
    """
    Catat satu baris aktivitas. Tidak pernah melempar exception ke pemanggil.

    `user` boleh objek User (akan diambil .id/.username), atau pakai
    user_id/username langsung. `request` dipakai untuk menangkap IP.
    """
    try:
        uid   = user_id if user_id is not None else (getattr(user, "id", None) if user else None)
        uname = username if username is not None else (getattr(user, "username", None) if user else None)
        resolved_ip = ip if ip is not None else _client_ip(request)

        db = SessionLocal()
        try:
            db.add(ActivityLog(
                user_id=uid,
                username=uname,
                action=action,
                entity=entity,
                entity_id=entity_id,
                description=(description[:500] if description else None),
                ip_address=resolved_ip,
                status=status,
            ))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        # Audit gagal tidak boleh mematahkan alur utama
        logger.warning(f"Gagal mencatat activity log ({action}/{entity}): {e}")
