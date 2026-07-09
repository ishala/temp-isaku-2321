"""
routers/reviews.py
CRUD ulasan + approval + koreksi label
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import or_

from core.database import get_db, User, Review, AnalysisResult, LabelCorrection, DataSource
from core.database import StatusEnum, SentimentEnum
from core.auth import get_current_user, require_admin
from core.activity import log_activity, Action, Entity
from models.schemas import (
    ReviewCreate, ReviewUpdate, ReviewOut,
    DataSourceCreate, DataSourceOut,
    AnalysisResultOut, ApprovalRequest,
    CorrectionCreate, CorrectionOut,
    ReviewTableRow,
)
from core.logger import logger

router = APIRouter(prefix="/api/reviews", tags=["Reviews"])
router_sources = APIRouter(prefix="/api/sources", tags=["Data Sources (Admin)"])


# ── Data Sources (admin) ───────────────────────────────────────────────────────
@router_sources.get("/", response_model=list[DataSourceOut])
def list_sources(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(DataSource).order_by(DataSource.created_at.desc()).all()


@router_sources.post("/", response_model=DataSourceOut, status_code=201)
def create_source(
    payload: DataSourceCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    source = DataSource(**payload.model_dump())
    db.add(source)
    db.commit()
    db.refresh(source)
    logger.info(f"DataSource baru: {source.name} (type={source.type})")
    log_activity(
        action=Action.CREATE, entity=Entity.SOURCE, entity_id=source.id, user=current_user,
        description=f"Membuat sumber data '{source.name}' (type={source.type})",
        request=request,
    )
    return source


@router_sources.delete("/{source_id}", status_code=204)
def delete_source(
    source_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    source = db.query(DataSource).filter(DataSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="DataSource tidak ditemukan")
    if source.reviews:
        raise HTTPException(status_code=400, detail="Tidak bisa hapus source yang masih memiliki ulasan")
    sname = source.name
    db.delete(source)
    db.commit()
    log_activity(
        action=Action.DELETE, entity=Entity.SOURCE, entity_id=source_id, user=current_user,
        description=f"Menghapus sumber data '{sname}'",
        request=request,
    )


# ── Reviews CRUD ───────────────────────────────────────────────────────────────
@router.get("/", response_model=list[ReviewOut])
def list_reviews(
    source_id: int | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Review)
    if source_id:
        q = q.filter(Review.source_id == source_id)
    if status:
        q = q.filter(Review.status == status)
    if search:
        q = q.filter(Review.original_text.contains(search))
    return q.order_by(Review.created_at.desc()).offset(skip).limit(limit).all()


_ID_LABEL = {"positive": "positif", "negative": "negatif"}
_ID_STATUS = {"approved": "disetujui", "rejected": "ditolak", "pending": "pending"}

def _id_label(sentiment) -> str | None:
    if sentiment is None:
        return None
    val = sentiment.value if hasattr(sentiment, "value") else str(sentiment)
    return _ID_LABEL.get(val, val)

def _enum_val(e):
    return e.value if hasattr(e, "value") else (str(e) if e is not None else None)


@router.get("/table", response_model=list[ReviewTableRow])
def list_reviews_table(
    source_id: int | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Daftar ulasan diperkaya untuk halaman Data Ulasan: status preprocessing,
    status analisis, dan label NB/SVM terbaru (bila sudah dianalisis).
    """
    # Eager-load relasi agar tidak terjadi N+1 (1 query per ulasan utk
    # analysis_results & source). Ini yang bikin halaman lambat tiap aksi.
    q = db.query(Review).options(
        selectinload(Review.analysis_results),
        joinedload(Review.source),
    )
    if source_id:
        q = q.filter(Review.source_id == source_id)
    if status:
        q = q.filter(Review.status == status)
    if search:
        q = q.filter(Review.original_text.contains(search))
    reviews = q.order_by(Review.created_at.desc()).offset(skip).limit(limit).all()

    rows = []
    for r in reviews:
        latest = max(r.analysis_results, key=lambda a: a.created_at) if r.analysis_results else None
        # Status mengikuti approval_status hasil analisis (bila ada), agar
        # approve/reject & laporan konsisten. Bila belum dianalisis → pending.
        if latest:
            status = _ID_STATUS.get(_enum_val(latest.approval_status), "pending")
        else:
            status = "pending"
        rows.append(ReviewTableRow(
            id=r.id,
            teks=r.original_text,
            bintang=r.star_rating,
            tanggal=r.review_date or r.created_at,
            source=r.source.name if r.source else "-",
            status=status,
            preprocessed=r.stemmed_text is not None,
            analyzed=latest is not None,
            nb_label=_id_label(latest.nb_sentiment) if latest else None,
            nb_conf=latest.nb_confidence if latest else None,
            svm_label=_id_label(latest.svm_sentiment) if latest else None,
            svm_conf=latest.svm_confidence if latest else None,
            result_id=latest.id if latest else None,
        ))
    return rows


@router.get("/{review_id}", response_model=ReviewOut)
def get_review(
    review_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Ulasan tidak ditemukan")
    return review


@router.post("/", response_model=ReviewOut, status_code=201)
def create_review(
    payload: ReviewCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    source = db.query(DataSource).filter(DataSource.id == payload.source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="DataSource tidak ditemukan")

    review = Review(**payload.model_dump())
    db.add(review)
    db.commit()
    db.refresh(review)
    logger.info(f"Review baru dibuat oleh {current_user.username} — id={review.id}")
    snippet = (review.original_text or "")[:60]
    log_activity(
        action=Action.CREATE, entity=Entity.REVIEW, entity_id=review.id, user=current_user,
        description=f"Menambah ulasan: \"{snippet}\"",
        request=request,
    )
    return review


@router.put("/{review_id}", response_model=ReviewOut)
def update_review(
    review_id: int,
    payload: ReviewUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Ulasan tidak ditemukan")

    fields = payload.model_dump(exclude_none=True)
    for field, value in fields.items():
        setattr(review, field, value)

    db.commit()
    db.refresh(review)
    logger.info(f"Review {review_id} diupdate oleh {current_user.username}")
    log_activity(
        action=Action.UPDATE, entity=Entity.REVIEW, entity_id=review_id, user=current_user,
        description=f"Mengubah ulasan #{review_id} ({', '.join(fields.keys()) or 'tanpa perubahan'})",
        request=request,
    )
    return review


@router.delete("/{review_id}", status_code=204)
def delete_review(
    review_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Ulasan tidak ditemukan")
    snippet = (review.original_text or "")[:60]
    db.delete(review)
    db.commit()
    logger.info(f"Review {review_id} dihapus oleh {current_user.username}")
    log_activity(
        action=Action.DELETE, entity=Entity.REVIEW, entity_id=review_id, user=current_user,
        description=f"Menghapus ulasan #{review_id}: \"{snippet}\"",
        request=request,
    )


# ── Analysis Results: approval ─────────────────────────────────────────────────
@router.get("/{review_id}/results", response_model=list[AnalysisResultOut])
def get_results(
    review_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(AnalysisResult)
        .filter(AnalysisResult.review_id == review_id)
        .order_by(AnalysisResult.created_at.desc())
        .all()
    )


router_results = APIRouter(prefix="/api/results", tags=["Analysis Results"])


@router_results.get("/", response_model=list[AnalysisResultOut])
def list_results(
    approval_status: str | None = Query(None),
    model_agree: bool | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AnalysisResult)
    if approval_status:
        q = q.filter(AnalysisResult.approval_status == approval_status)
    return q.order_by(AnalysisResult.created_at.desc()).offset(skip).limit(limit).all()


@router_results.patch("/{result_id}/approve", response_model=AnalysisResultOut)
def approve_result(
    result_id: int,
    payload: ApprovalRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ar = db.query(AnalysisResult).filter(AnalysisResult.id == result_id).first()
    if not ar:
        raise HTTPException(status_code=404, detail="Hasil analisis tidak ditemukan")

    ar.approval_status = payload.approval_status
    ar.approved_by = current_user.id
    ar.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(ar)
    logger.info(
        f"Result {result_id} {payload.approval_status} oleh {current_user.username}"
    )
    log_activity(
        action=(Action.APPROVE if payload.approval_status == "approved" else Action.REJECT),
        entity=Entity.PREDICTION, entity_id=result_id, user=current_user,
        description=f"{'Menyetujui' if payload.approval_status == 'approved' else 'Menolak'} "
                    f"hasil analisis #{result_id} (ulasan #{ar.review_id})",
        request=request,
    )
    return ar


@router_results.post("/{result_id}/correct", response_model=CorrectionOut, status_code=201)
def correct_label(
    result_id: int,
    payload: CorrectionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ar = db.query(AnalysisResult).filter(AnalysisResult.id == result_id).first()
    if not ar:
        raise HTTPException(status_code=404, detail="Hasil analisis tidak ditemukan")

    orig_nb, orig_svm = ar.nb_sentiment, ar.svm_sentiment

    correction = LabelCorrection(
        result_id=result_id,
        corrected_by=current_user.id,
        original_nb=orig_nb,
        original_svm=orig_svm,
        corrected_label=payload.corrected_label,
        correction_note=payload.correction_note,
    )
    db.add(correction)

    # Terapkan label koreksi sebagai label final (NB & SVM) agar tampilan ikut berubah
    ar.nb_sentiment = payload.corrected_label
    ar.svm_sentiment = payload.corrected_label

    # Alur bisnis: koreksi label = prediksi ditolak → status menjadi 'rejected'
    ar.approval_status = StatusEnum.rejected
    ar.approved_by = current_user.id
    ar.approved_at = datetime.utcnow()

    db.commit()
    db.refresh(correction)
    logger.info(
        f"Koreksi label result {result_id} oleh {current_user.username}: "
        f"NB={orig_nb}, SVM={orig_svm} → {payload.corrected_label} (status=ditolak)"
    )
    log_activity(
        action=Action.CORRECT, entity=Entity.PREDICTION, entity_id=result_id, user=current_user,
        description=f"Koreksi label hasil #{result_id}: "
                    f"NB={_enum_val(orig_nb)}/SVM={_enum_val(orig_svm)} → {payload.corrected_label}",
        request=request,
    )
    return correction
