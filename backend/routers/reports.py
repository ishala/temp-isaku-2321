"""
routers/reports.py
Endpoint statistik untuk dashboard, visualisasi, dan data print laporan.
Mendukung filter: rentang tanggal, source, dan status approval.
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from core.database import get_db, User, Review, AnalysisResult, LabelCorrection, BatchJob, DataSource
from core.database import StatusEnum, SentimentEnum
from core.auth import get_current_user
from core.ml_pipeline import get_pipeline, MLPipeline
from models.schemas import ReportStats
from core.logger import logger

router = APIRouter(prefix="/api/reports", tags=["Reports"])


# ── Helper filter ───────────────────────────────────────────────────────────────
def _parse_date(s: str | None):
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except ValueError:
        return None


def _review_date_col():
    return func.coalesce(Review.review_date, Review.created_at)


def _apply_review_filters(q, date_from, date_to, source):
    """Terapkan filter tanggal & source. Query harus sudah mengandung tabel Review."""
    dcol = _review_date_col()
    df, dt = _parse_date(date_from), _parse_date(date_to)
    if df:
        q = q.filter(dcol >= df)
    if dt:
        q = q.filter(dcol < dt + timedelta(days=1))
    if source:
        q = q.join(DataSource, Review.source_id == DataSource.id).filter(DataSource.type == source)
    return q


# ── Ringkasan statistik global ─────────────────────────────────────────────────
@router.get("/stats", response_model=ReportStats)
def get_stats(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    source: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Total ulasan (mengikuti filter tanggal & source)
    total_reviews = _apply_review_filters(db.query(Review.id), date_from, date_to, source).count()

    # Basis hasil analisis (join ke Review utk filter tanggal/source)
    abase = _apply_review_filters(
        db.query(AnalysisResult).join(Review, AnalysisResult.review_id == Review.id),
        date_from, date_to, source,
    )
    if status:
        abase = abase.filter(AnalysisResult.approval_status == status)

    total_analyzed = abase.count()
    total_approved = abase.filter(AnalysisResult.approval_status == StatusEnum.approved).count()
    total_pending  = abase.filter(AnalysisResult.approval_status == StatusEnum.pending).count()
    total_rejected = abase.filter(AnalysisResult.approval_status == StatusEnum.rejected).count()

    nb_positive  = abase.filter(AnalysisResult.nb_sentiment == SentimentEnum.positive).count()
    nb_negative  = abase.filter(AnalysisResult.nb_sentiment == SentimentEnum.negative).count()
    svm_positive = abase.filter(AnalysisResult.svm_sentiment == SentimentEnum.positive).count()
    svm_negative = abase.filter(AnalysisResult.svm_sentiment == SentimentEnum.negative).count()

    agreement_count = abase.filter(
        AnalysisResult.nb_sentiment == AnalysisResult.svm_sentiment,
        AnalysisResult.nb_sentiment.isnot(None),
    ).count()
    agreement_rate = (agreement_count / total_analyzed * 100) if total_analyzed > 0 else 0.0

    # Distribusi hanya untuk ulasan yang NB & SVM sepakat (dipakai mode "Semua")
    agree_positive = abase.filter(
        AnalysisResult.nb_sentiment == SentimentEnum.positive,
        AnalysisResult.svm_sentiment == SentimentEnum.positive,
    ).count()
    agree_negative = abase.filter(
        AnalysisResult.nb_sentiment == SentimentEnum.negative,
        AnalysisResult.svm_sentiment == SentimentEnum.negative,
    ).count()

    total_corrections = db.query(func.count(LabelCorrection.id)).scalar() or 0

    return ReportStats(
        total_reviews=total_reviews,
        total_analyzed=total_analyzed,
        total_approved=total_approved,
        total_pending=total_pending,
        total_rejected=total_rejected,
        total_corrections=total_corrections,
        nb_positive=nb_positive,
        nb_negative=nb_negative,
        svm_positive=svm_positive,
        svm_negative=svm_negative,
        agreement_count=agreement_count,
        agreement_rate=round(agreement_rate, 2),
        agree_positive=agree_positive,
        agree_negative=agree_negative,
    )


# ── Tren sentimen per hari ─────────────────────────────────────────────────────
@router.get("/trend")
def get_sentiment_trend(
    days: int = Query(365, ge=7, le=1095),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    source: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Agregasi harian sentimen NB & SVM, berdasarkan tanggal ulasan."""
    dcol = _review_date_col()
    q = (
        db.query(
            func.date(dcol).label("day"),
            func.sum(case((AnalysisResult.nb_sentiment == SentimentEnum.positive, 1), else_=0)).label("nb_pos"),
            func.sum(case((AnalysisResult.nb_sentiment == SentimentEnum.negative, 1), else_=0)).label("nb_neg"),
            func.sum(case((AnalysisResult.svm_sentiment == SentimentEnum.positive, 1), else_=0)).label("svm_pos"),
            func.sum(case((AnalysisResult.svm_sentiment == SentimentEnum.negative, 1), else_=0)).label("svm_neg"),
            func.sum(case(((AnalysisResult.nb_sentiment == SentimentEnum.positive) & (AnalysisResult.svm_sentiment == SentimentEnum.positive), 1), else_=0)).label("agree_pos"),
            func.sum(case(((AnalysisResult.nb_sentiment == SentimentEnum.negative) & (AnalysisResult.svm_sentiment == SentimentEnum.negative), 1), else_=0)).label("agree_neg"),
        )
        .join(Review, AnalysisResult.review_id == Review.id)
    )

    if not date_from and not date_to:
        q = q.filter(dcol >= datetime.utcnow() - timedelta(days=days))
    q = _apply_review_filters(q, date_from, date_to, source)
    if status:
        q = q.filter(AnalysisResult.approval_status == status)

    rows = q.group_by(func.date(dcol)).order_by(func.date(dcol)).all()

    return [
        {
            "date": str(r.day),
            "nb_positive": int(r.nb_pos or 0),
            "nb_negative": int(r.nb_neg or 0),
            "svm_positive": int(r.svm_pos or 0),
            "svm_negative": int(r.svm_neg or 0),
            "agree_positive": int(r.agree_pos or 0),
            "agree_negative": int(r.agree_neg or 0),
        }
        for r in rows
    ]


# ── Distribusi confidence score (histogram) ───────────────────────────────────
@router.get("/confidence-distribution")
def get_confidence_distribution(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT FLOOR(nb_confidence * 10) * 10 AS bucket, COUNT(*) AS nb_count
        FROM analysis_results WHERE nb_confidence IS NOT NULL
        GROUP BY bucket ORDER BY bucket
    """)).fetchall()
    nb_dist = {f"{int(r.bucket)}-{int(r.bucket)+10}%": r.nb_count for r in rows}

    rows2 = db.execute(text("""
        SELECT FLOOR(svm_confidence * 10) * 10 AS bucket, COUNT(*) AS svm_count
        FROM analysis_results WHERE svm_confidence IS NOT NULL
        GROUP BY bucket ORDER BY bucket
    """)).fetchall()
    svm_dist = {f"{int(r.bucket)}-{int(r.bucket)+10}%": r.svm_count for r in rows2}

    return {"nb": nb_dist, "svm": svm_dist}


# ── Data batch jobs ────────────────────────────────────────────────────────────
@router.get("/batch-jobs")
def get_batch_jobs_report(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    jobs = db.query(BatchJob).order_by(BatchJob.created_at.desc()).limit(50).all()
    return [
        {
            "id": j.id,
            "job_name": j.job_name,
            "status": j.status,
            "total_rows": j.total_rows,
            "processed_rows": j.processed_rows,
            "created_by": j.creator.full_name if j.creator else "-",
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        }
        for j in jobs
    ]


# ── Data mentah untuk print ────────────────────────────────────────────────────
@router.get("/raw-data")
def get_raw_data_for_print(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = _apply_review_filters(db.query(Review), date_from, date_to, source)
    reviews = q.order_by(_review_date_col().desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "original_text": r.original_text,
            "star_rating": r.star_rating,
            "app_version": r.app_version,
            "review_date": (r.review_date or r.created_at).isoformat() if (r.review_date or r.created_at) else None,
            "source": r.source.name if r.source else "-",
        }
        for r in reviews
    ]


# ── Hasil analisis untuk print ─────────────────────────────────────────────────
@router.get("/analysis-data")
def get_analysis_for_print(
    approval_status: str | None = Query("approved"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = _apply_review_filters(
        db.query(AnalysisResult).join(Review, AnalysisResult.review_id == Review.id),
        date_from, date_to, source,
    )
    if approval_status:
        q = q.filter(AnalysisResult.approval_status == approval_status)
    results = q.order_by(AnalysisResult.created_at.desc()).limit(limit).all()

    return [
        {
            "id": ar.id,
            "review_text": ar.review.original_text[:120] if ar.review else "-",
            "source": (ar.review.source.name if ar.review and ar.review.source else "-"),
            "nb_sentiment": ar.nb_sentiment.value if hasattr(ar.nb_sentiment, "value") else ar.nb_sentiment,
            "nb_confidence": round(ar.nb_confidence * 100, 1) if ar.nb_confidence else None,
            "svm_sentiment": ar.svm_sentiment.value if hasattr(ar.svm_sentiment, "value") else ar.svm_sentiment,
            "svm_confidence": round(ar.svm_confidence * 100, 1) if ar.svm_confidence else None,
            "model_agree": ar.model_agree,
            "approval_status": ar.approval_status.value if hasattr(ar.approval_status, "value") else ar.approval_status,
            "approved_by": ar.approver.full_name if ar.approver else "-",
        }
        for ar in results
    ]


# ── Kosakata berbobot sentimen tertinggi ───────────────────────────────────────
@router.get("/top-words")
def get_top_words(
    n: int = Query(20, ge=5, le=50),
    pipeline: MLPipeline = Depends(get_pipeline),
    _: User = Depends(get_current_user),
):
    """
    Daftar kosakata yang paling kuat menentukan sentimen positif maupun negatif,
    berdasarkan bobot fitur model. Dipakai kartu laporan "Kosakata Berpengaruh".
    """
    return pipeline.top_features(n)
