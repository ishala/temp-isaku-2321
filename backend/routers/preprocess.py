"""
routers/preprocess.py
Tahap kedua flow: ambil data mentah (Review) → jalankan preprocessing →
simpan hasil (cleaned_text, stemmed_text) ke DB untuk dipakai tahap Prediksi.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.database import get_db, User, Review
from core.ml_pipeline import get_pipeline, MLPipeline
from core.auth import get_current_user
from core.activity import log_activity, Action, Entity
from core.logger import logger
from models.schemas import (
    PreprocessRunRequest, PreprocessRunResponse,
    PreprocessStats, PreprocessPreview,
)

router = APIRouter(prefix="/api/preprocess", tags=["Preprocessing"])


@router.get("/stats", response_model=PreprocessStats)
def preprocess_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    total = db.query(func.count(Review.id)).scalar() or 0
    done = db.query(func.count(Review.id)).filter(
        Review.stemmed_text.isnot(None)
    ).scalar() or 0
    return PreprocessStats(total=total, preprocessed=done, pending=total - done)


@router.get("/pending")
def list_pending(
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Data mentah yang belum dipreprocess."""
    rows = (
        db.query(Review)
        .filter(Review.stemmed_text.is_(None))
        .order_by(Review.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "teks": r.original_text,
            "bintang": r.star_rating,
            "tanggal": r.review_date.isoformat() if r.review_date else None,
            "source": r.source.name if r.source else "-",
        }
        for r in rows
    ]


@router.get("/preview/{review_id}", response_model=PreprocessPreview)
def preview(
    review_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    pipeline: MLPipeline = Depends(get_pipeline),
):
    """Tampilkan langkah preprocessing untuk satu ulasan (tanpa menyimpan)."""
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Ulasan tidak ditemukan")

    cleaned    = pipeline.clean_text(review.original_text)
    normalized = pipeline.normalize_slang(cleaned)
    no_stop    = pipeline.remove_stopwords(normalized)
    stemmed    = pipeline.stem_text(no_stop)

    return PreprocessPreview(
        review_id=review.id,
        original=review.original_text,
        cleaned=cleaned,
        normalized=normalized,
        no_stopword=no_stop,
        stemmed=stemmed,
    )


@router.post("/run", response_model=PreprocessRunResponse)
def run_preprocess(
    payload: PreprocessRunRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    pipeline: MLPipeline = Depends(get_pipeline),
):
    """
    Jalankan preprocessing untuk review_ids tertentu, atau semua data mentah
    yang belum dipreprocess bila review_ids kosong.
    """
    q = db.query(Review).filter(Review.stemmed_text.is_(None))
    if payload.review_ids:
        q = q.filter(Review.id.in_(payload.review_ids))
    reviews = q.all()

    if not reviews:
        return PreprocessRunResponse(processed=0, message="Tidak ada data mentah yang perlu dipreprocess.")

    now = datetime.utcnow()
    processed = 0
    for r in reviews:
        cleaned, stemmed = pipeline.preprocess(r.original_text)
        r.cleaned_text = cleaned
        r.stemmed_text = stemmed
        r.preprocessed_at = now
        processed += 1

    db.commit()
    logger.info(f"Preprocessing {processed} ulasan oleh {current_user.username}")
    log_activity(
        action=Action.PREPROCESS, entity=Entity.REVIEW, user=current_user,
        description=f"Menjalankan preprocessing {processed} ulasan",
        request=request,
    )
    return PreprocessRunResponse(
        processed=processed,
        message=f"{processed} ulasan berhasil dipreprocess dan disimpan.",
    )
