"""
core/database.py
Koneksi MySQL via SQLAlchemy + definisi semua tabel ORM
"""
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, Float,
    Enum, DateTime, ForeignKey, Index,
    event, text
)
from sqlalchemy.dialects.mysql import TINYINT  # Impor TINYINT dari modul mysql
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session
from sqlalchemy.pool import QueuePool
from core.config import get_settings
from core.logger import logger
import enum

settings = get_settings()

# ── Engine ────────────────────────────────────────────────────────────────────
engine = create_engine(
    settings.database_url,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,          # cek koneksi sebelum dipakai
    pool_recycle=3600,           # recycle koneksi setiap 1 jam
    echo=(settings.app_env == "development"),
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── Enums ─────────────────────────────────────────────────────────────────────
class RoleEnum(str, enum.Enum):
    admin = "admin"
    analyst = "analyst"

class SourceTypeEnum(str, enum.Enum):
    csv = "csv"
    manual = "manual"
    scraping = "scraping"

class StatusEnum(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class JobStatusEnum(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"

class SentimentEnum(str, enum.Enum):
    positive = "positive"
    negative = "negative"


# ── ORM Models ────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    username       = Column(String(50), nullable=False, unique=True)
    full_name      = Column(String(150), nullable=False)
    password_hash  = Column(String(255), nullable=False)
    role           = Column(Enum(RoleEnum), nullable=False, default=RoleEnum.analyst)
    is_active      = Column(TINYINT, nullable=False, default=1)
    last_login_at  = Column(DateTime, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    # Relations
    approved_results   = relationship("AnalysisResult", back_populates="approver", foreign_keys="AnalysisResult.approved_by")
    corrections        = relationship("LabelCorrection", back_populates="corrector")
    batch_jobs         = relationship("BatchJob", back_populates="creator")

    __table_args__ = (
        Index("idx_username", "username"),
        Index("idx_role", "role"),
    )


class DataSource(Base):
    __tablename__ = "data_sources"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(255), nullable=False)
    type        = Column(Enum(SourceTypeEnum), nullable=False)
    file_name   = Column(String(255), nullable=True)
    total_rows  = Column(Integer, default=0)
    scraped_url = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)

    # Relations
    reviews    = relationship("Review", back_populates="source")
    batch_jobs = relationship("BatchJob", back_populates="source")


class Review(Base):
    __tablename__ = "reviews"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    source_id     = Column(Integer, ForeignKey("data_sources.id", ondelete="RESTRICT"), nullable=False)
    original_text = Column(Text, nullable=False)
    app_version   = Column(String(50), nullable=True)
    star_rating   = Column(Integer, nullable=True)
    review_date   = Column(DateTime, nullable=True)
    status        = Column(Enum(StatusEnum), default=StatusEnum.pending)
    created_at    = Column(DateTime, default=datetime.utcnow)

    # Hasil preprocessing (diisi di tahap Preprocessing, dipakai tahap Prediksi)
    cleaned_text    = Column(Text, nullable=True)
    stemmed_text    = Column(Text, nullable=True)
    preprocessed_at = Column(DateTime, nullable=True)

    # Relations
    source           = relationship("DataSource", back_populates="reviews")
    analysis_results = relationship("AnalysisResult", back_populates="review", cascade="all, delete")

    __table_args__ = (
        Index("idx_source", "source_id"),
        Index("idx_status", "status"),
        Index("idx_date", "review_date"),
        Index("idx_preprocessed", "preprocessed_at"),
    )


class BatchJob(Base):
    __tablename__ = "batch_jobs"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    source_id      = Column(Integer, ForeignKey("data_sources.id", ondelete="RESTRICT"), nullable=False)
    created_by     = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    job_name       = Column(String(255), nullable=False)
    status         = Column(Enum(JobStatusEnum), default=JobStatusEnum.queued)
    total_rows     = Column(Integer, default=0)
    processed_rows = Column(Integer, default=0)
    error_message  = Column(Text, nullable=True)
    started_at     = Column(DateTime, nullable=True)
    finished_at    = Column(DateTime, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    # Relations
    source   = relationship("DataSource", back_populates="batch_jobs")
    creator  = relationship("User", back_populates="batch_jobs")
    results  = relationship("AnalysisResult", back_populates="batch_job")

    __table_args__ = (
        Index("idx_job_status", "status"),
        Index("idx_created_by", "created_by"),
    )


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    review_id       = Column(Integer, ForeignKey("reviews.id", ondelete="CASCADE"), nullable=False)
    batch_job_id    = Column(Integer, ForeignKey("batch_jobs.id", ondelete="SET NULL"), nullable=True)
    nb_sentiment    = Column(Enum(SentimentEnum), nullable=True)
    nb_confidence   = Column(Float, nullable=True)
    svm_sentiment   = Column(Enum(SentimentEnum), nullable=True)
    svm_confidence  = Column(Float, nullable=True)
    # model_agree dihitung via property (MySQL generated column tidak mudah di SQLAlchemy)
    approval_status = Column(Enum(StatusEnum), default=StatusEnum.pending)
    approved_by     = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at     = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    # Relations
    review      = relationship("Review", back_populates="analysis_results")
    batch_job   = relationship("BatchJob", back_populates="results")
    approver    = relationship("User", back_populates="approved_results", foreign_keys=[approved_by])
    corrections = relationship("LabelCorrection", back_populates="result", cascade="all, delete")

    @property
    def model_agree(self) -> bool | None:
        if self.nb_sentiment and self.svm_sentiment:
            return self.nb_sentiment == self.svm_sentiment
        return None

    __table_args__ = (
        Index("idx_review", "review_id"),
        Index("idx_approval", "approval_status"),
    )


class LabelCorrection(Base):
    __tablename__ = "label_corrections"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    result_id        = Column(Integer, ForeignKey("analysis_results.id", ondelete="CASCADE"), nullable=False)
    corrected_by     = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    original_nb      = Column(Enum(SentimentEnum), nullable=True)
    original_svm     = Column(Enum(SentimentEnum), nullable=True)
    corrected_label  = Column(Enum(SentimentEnum), nullable=False)
    correction_note  = Column(Text, nullable=True)
    corrected_at     = Column(DateTime, default=datetime.utcnow)

    # Relations
    result   = relationship("AnalysisResult", back_populates="corrections")
    corrector = relationship("User", back_populates="corrections")

    __table_args__ = (
        Index("idx_result", "result_id"),
        Index("idx_corrector", "corrected_by"),
    )


class ActivityLog(Base):
    """
    Audit trail aktivitas pengguna: login, CRUD ulasan/pengguna/source,
    prediksi, preprocessing, scraping, approval, koreksi label, dll.
    `username` di-snapshot agar log tetap terbaca walau user dihapus.
    """
    __tablename__ = "activity_logs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    username    = Column(String(50), nullable=True)    # snapshot saat aksi terjadi
    action      = Column(String(40), nullable=False)   # login | create | update | delete | predict | ...
    entity      = Column(String(40), nullable=True)    # auth | user | review | source | prediction | batch
    entity_id   = Column(Integer, nullable=True)
    description = Column(String(500), nullable=True)
    ip_address  = Column(String(64), nullable=True)
    status      = Column(String(16), nullable=False, default="success")  # success | failed
    created_at  = Column(DateTime, default=datetime.utcnow)

    # Relations
    user = relationship("User")

    __table_args__ = (
        Index("idx_act_user", "user_id"),
        Index("idx_act_action", "action"),
        Index("idx_act_entity", "entity"),
        Index("idx_act_created", "created_at"),
    )


# ── Dependency FastAPI ─────────────────────────────────────────────────────────
def get_db():
    """Dependency injection — satu session per request, selalu ditutup."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_review_columns():
    """
    Migrasi ringan & idempotent: tambahkan kolom preprocessing pada tabel
    `reviews` bila DB lama belum punya (create_all tidak meng-ALTER tabel).
    """
    cols = {
        "cleaned_text":    "ADD COLUMN cleaned_text TEXT NULL",
        "stemmed_text":    "ADD COLUMN stemmed_text TEXT NULL",
        "preprocessed_at": "ADD COLUMN preprocessed_at DATETIME NULL",
    }
    try:
        with engine.begin() as conn:
            existing = {
                row[0] for row in conn.execute(text(
                    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews'"
                ))
            }
            for col, ddl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE reviews {ddl}"))
                    logger.info(f"Migrasi: kolom reviews.{col} ditambahkan")
    except Exception as e:
        logger.warning(f"Lewati migrasi kolom reviews: {e}")


def init_db():
    """Buat semua tabel jika belum ada. Dipanggil saat startup."""
    try:
        Base.metadata.create_all(bind=engine)
        _ensure_review_columns()
        logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise
