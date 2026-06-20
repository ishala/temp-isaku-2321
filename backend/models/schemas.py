"""
models/schemas.py
Pydantic schemas untuk request body dan response FastAPI.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator, ConfigDict


# ── Auth ───────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    full_name: str
    role: str

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str
    role: str
    is_active: int
    last_login_at: Optional[datetime]
    created_at: datetime

class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "analyst"

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v):
        if v not in ("admin", "analyst"):
            raise ValueError("role harus 'admin' atau 'analyst'")
        return v

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[int] = None
    password: Optional[str] = None


# ── Predict ────────────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    text: str
    save_to_db: bool = False
    source_id: Optional[int] = None

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Teks tidak boleh kosong")
        return v

class ProbabilityDetail(BaseModel):
    positive: Optional[float]
    negative: Optional[float]

class PredictResponse(BaseModel):
    nb_sentiment:   Optional[str]
    nb_confidence:  Optional[float]
    nb_probs:       Optional[ProbabilityDetail]
    svm_sentiment:  Optional[str]
    svm_confidence: Optional[float]
    svm_probs:      Optional[ProbabilityDetail]
    cleaned_text:   str
    model_agree:    Optional[bool]
    result_id:      Optional[int] = None   # diisi jika save_to_db=True


# ── Scraping ───────────────────────────────────────────────────────────────────
class ScrapeRequest(BaseModel):
    year: int
    month: Optional[int] = None          # 1-12; None / 0 = semua bulan di tahun itu
    app_id: Optional[str] = None         # default dari config bila kosong
    max_results: int = 500               # batas baris yang disimpan

    @field_validator("month")
    @classmethod
    def month_range(cls, v):
        if v in (None, 0):
            return None
        if not 1 <= v <= 12:
            raise ValueError("month harus 1-12")
        return v

class ScrapeResponse(BaseModel):
    inserted: int
    scanned: int
    source_id: int
    app_id: str
    period: str
    message: str


# ── Preprocessing ──────────────────────────────────────────────────────────────
class PreprocessRunRequest(BaseModel):
    review_ids: Optional[list[int]] = None   # None = semua yang belum dipreprocess

class PreprocessRunResponse(BaseModel):
    processed: int
    message: str

class PreprocessStats(BaseModel):
    total: int
    preprocessed: int
    pending: int

class PreprocessPreview(BaseModel):
    review_id: int
    original: str
    cleaned: str
    normalized: str
    no_stopword: str
    stemmed: str


# ── Prediksi dari DB (dataset ter-preprocess) ───────────────────────────────────
class PredictDbRequest(BaseModel):
    review_ids: Optional[list[int]] = None   # None = semua preprocessed yg belum dianalisis

class PredictDbResponse(BaseModel):
    analyzed: int
    skipped: int
    message: str


# ── Baris tabel ulasan (enriched, dipakai halaman Data Ulasan) ──────────────────
class ReviewTableRow(BaseModel):
    id: int
    teks: str
    bintang: Optional[int]
    tanggal: Optional[datetime]
    source: str
    status: str
    preprocessed: bool
    analyzed: bool
    nb_label: Optional[str]
    nb_conf: Optional[float]
    svm_label: Optional[str]
    svm_conf: Optional[float]
    result_id: Optional[int]


# ── Reviews ────────────────────────────────────────────────────────────────────
class ReviewCreate(BaseModel):
    original_text: str
    source_id: int
    app_version: Optional[str] = None
    star_rating: Optional[int] = None
    review_date: Optional[datetime] = None

class ReviewUpdate(BaseModel):
    original_text: Optional[str] = None
    app_version: Optional[str] = None
    star_rating: Optional[int] = None
    review_date: Optional[datetime] = None
    status: Optional[str] = None

class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_id: int
    original_text: str
    app_version: Optional[str]
    star_rating: Optional[int]
    review_date: Optional[datetime]
    status: str
    created_at: datetime


# ── Data Sources ───────────────────────────────────────────────────────────────
class DataSourceCreate(BaseModel):
    name: str
    type: str
    file_name: Optional[str] = None
    total_rows: int = 0
    scraped_url: Optional[str] = None
    description: Optional[str] = None

class DataSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    type: str
    file_name: Optional[str]
    total_rows: int
    scraped_url: Optional[str]
    description: Optional[str]
    created_at: datetime


# ── Batch Jobs ─────────────────────────────────────────────────────────────────
class BatchJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_id: int
    job_name: str
    status: str
    total_rows: int
    processed_rows: int
    error_message: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime


# ── Analysis Results ───────────────────────────────────────────────────────────
class ApprovalRequest(BaseModel):
    approval_status: str  # "approved" | "rejected"

    @field_validator("approval_status")
    @classmethod
    def must_be_valid(cls, v):
        if v not in ("approved", "rejected"):
            raise ValueError("approval_status harus 'approved' atau 'rejected'")
        return v

class AnalysisResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    review_id: int
    batch_job_id: Optional[int]
    nb_sentiment: Optional[str]
    nb_confidence: Optional[float]
    svm_sentiment: Optional[str]
    svm_confidence: Optional[float]
    model_agree: Optional[bool]
    approval_status: str
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    created_at: datetime


# ── Label Corrections ──────────────────────────────────────────────────────────
class CorrectionCreate(BaseModel):
    corrected_label: str
    correction_note: Optional[str] = None

    @field_validator("corrected_label")
    @classmethod
    def label_valid(cls, v):
        if v not in ("positive", "negative"):
            raise ValueError("corrected_label harus 'positive' atau 'negative'")
        return v

class CorrectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    result_id: int
    corrected_by: int
    original_nb: Optional[str]
    original_svm: Optional[str]
    corrected_label: str
    correction_note: Optional[str]
    corrected_at: datetime


# ── Reports ────────────────────────────────────────────────────────────────────
class ReportStats(BaseModel):
    total_reviews: int
    total_analyzed: int
    total_approved: int
    total_pending: int
    total_rejected: int
    total_corrections: int
    nb_positive: int
    nb_negative: int
    svm_positive: int
    svm_negative: int
    agreement_count: int
    agreement_rate: float


# ── Activity Log (Audit Trail, admin) ──────────────────────────────────────────
class ActivityLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[int]
    username: Optional[str]
    action: str
    entity: Optional[str]
    entity_id: Optional[int]
    description: Optional[str]
    ip_address: Optional[str]
    status: str
    created_at: datetime

class ActivityLogPage(BaseModel):
    total: int          # total baris yang cocok filter (untuk pagination)
    items: list[ActivityLogOut]

class ActivityStats(BaseModel):
    total: int          # total seluruh log
    today: int          # log hari ini
    active_users: int   # pengguna unik yang beraktivitas (punya log)
    failed: int         # aksi gagal (mis. login gagal)

class ActivityFilters(BaseModel):
    actions: list[str]
    entities: list[str]
    users: list[dict]   # {id, username}
