"""
routers/predict.py
Endpoint prediksi sentimen: single text dan batch CSV
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
import pandas as pd
from io import BytesIO, StringIO

from core.database import get_db, User, Review, AnalysisResult, DataSource, BatchJob
from core.database import SourceTypeEnum, JobStatusEnum, SentimentEnum
from core.ml_pipeline import get_pipeline, MLPipeline
from core.auth import get_current_user
from core.activity import log_activity, Action, Entity
from models.schemas import (
    PredictRequest, PredictResponse, ProbabilityDetail, BatchJobOut,
    PredictDbRequest, PredictDbResponse,
)
from core.logger import logger

router = APIRouter(prefix="/api/predict", tags=["Predict"])


# ── Single text prediction ─────────────────────────────────────────────────────
@router.post("/", response_model=PredictResponse)
def predict_single(
    payload: PredictRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    pipeline: MLPipeline = Depends(get_pipeline),
):
    logger.info(f"Single predict by {current_user.username}: '{payload.text[:50]}...'")
    cleaned, stemmed = pipeline.preprocess(payload.text)
    result = pipeline.predict_stemmed(stemmed, cleaned)

    result_id = None

    # Simpan ke DB jika diminta (pakai source yang dipilih, atau auto "Input Manual")
    if payload.save_to_db:
        source = None
        if payload.source_id:
            source = db.query(DataSource).filter(DataSource.id == payload.source_id).first()
            if not source:
                raise HTTPException(status_code=404, detail="DataSource tidak ditemukan")
        if source is None:
            source = db.query(DataSource).filter(DataSource.name == "Input Manual").first()
            if source is None:
                source = DataSource(
                    name="Input Manual",
                    type=SourceTypeEnum.manual,
                    total_rows=0,
                    description="Input teks tunggal dari halaman Analisis",
                )
                db.add(source)
                db.flush()

        review = Review(
            source_id=source.id,
            original_text=payload.text,
            cleaned_text=cleaned,
            stemmed_text=stemmed,
            preprocessed_at=datetime.utcnow(),
        )
        db.add(review)
        db.flush()

        ar = AnalysisResult(
            review_id=review.id,
            nb_sentiment=result.nb_sentiment,
            nb_confidence=result.nb_confidence,
            svm_sentiment=result.svm_sentiment,
            svm_confidence=result.svm_confidence,
        )
        db.add(ar)
        db.commit()
        db.refresh(ar)
        result_id = ar.id
        logger.info(f"Hasil disimpan ke DB — review_id={review.id}, result_id={ar.id}")

    snippet = payload.text[:60] + ("…" if len(payload.text) > 60 else "")
    nb = result.nb_sentiment or "-"
    svm = result.svm_sentiment or "-"
    log_activity(
        action=Action.PREDICT, entity=Entity.PREDICTION, entity_id=result_id, user=current_user,
        description=f"Prediksi teks tunggal: \"{snippet}\" → NB={nb}, SVM={svm}"
                    + (" (disimpan)" if payload.save_to_db else ""),
        request=request,
    )

    return PredictResponse(
        nb_sentiment=result.nb_sentiment,
        nb_confidence=result.nb_confidence,
        nb_probs=ProbabilityDetail(**(result.nb_probs or {"positive": None, "negative": None})),
        svm_sentiment=result.svm_sentiment,
        svm_confidence=result.svm_confidence,
        svm_probs=ProbabilityDetail(**(result.svm_probs or {"positive": None, "negative": None})),
        cleaned_text=result.cleaned_text,
        model_agree=result.model_agree,
        result_id=result_id,
    )


# ── Prediksi dari data preprocessed di DB ──────────────────────────────────────
@router.get("/db/pending")
def list_db_pending(
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Ulasan yang sudah dipreprocess tetapi belum dianalisis (siap diprediksi)."""
    rows = (
        db.query(Review)
        .filter(Review.stemmed_text.isnot(None))
        .filter(func.trim(Review.stemmed_text) != "")
        .filter(~Review.analysis_results.any())
        .order_by(Review.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "teks": r.original_text,
            "stemmed": r.stemmed_text,
            "bintang": r.star_rating,
            "tanggal": r.review_date.isoformat() if r.review_date else None,
            "source": r.source.name if r.source else "-",
        }
        for r in rows
    ]


@router.post("/db", response_model=PredictDbResponse)
def predict_from_db(
    payload: PredictDbRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    pipeline: MLPipeline = Depends(get_pipeline),
):
    """
    Jalankan prediksi NB + SVM memakai teks hasil preprocessing yang sudah
    tersimpan (stemmed_text). Hanya untuk ulasan yang belum dianalisis.
    """
    if not pipeline.nb_available and not pipeline.svm_available:
        raise HTTPException(status_code=503, detail="Model belum tersedia di server.")

    q = (
        db.query(Review)
        .filter(Review.stemmed_text.isnot(None))
        .filter(func.trim(Review.stemmed_text) != "")
        .filter(~Review.analysis_results.any())
    )
    if payload.review_ids:
        q = q.filter(Review.id.in_(payload.review_ids))
    reviews = q.all()

    if not reviews:
        return PredictDbResponse(analyzed=0, skipped=0,
                                 message="Tidak ada data preprocessed yang perlu diprediksi.")

    analyzed = skipped = 0
    for r in reviews:
        result = pipeline.predict_stemmed(r.stemmed_text, r.cleaned_text or "")
        if not result.nb_sentiment and not result.svm_sentiment:
            skipped += 1
            continue
        db.add(AnalysisResult(
            review_id=r.id,
            nb_sentiment=result.nb_sentiment,
            nb_confidence=result.nb_confidence,
            svm_sentiment=result.svm_sentiment,
            svm_confidence=result.svm_confidence,
        ))
        analyzed += 1

    db.commit()
    logger.info(f"Prediksi DB: {analyzed} dianalisis, {skipped} dilewati oleh {current_user.username}")
    log_activity(
        action=Action.PREDICT, entity=Entity.PREDICTION, user=current_user,
        description=f"Prediksi dataset dari DB: {analyzed} ulasan dianalisis, {skipped} dilewati",
        request=request,
    )
    return PredictDbResponse(
        analyzed=analyzed, skipped=skipped,
        message=f"{analyzed} ulasan berhasil diprediksi.",
    )


# ── Batch CSV prediction ───────────────────────────────────────────────────────
@router.post("/batch", response_model=BatchJobOut, status_code=202)
async def predict_batch(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    text_column: str = Form(...),
    source_name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    pipeline: MLPipeline = Depends(get_pipeline),
):
    """
    Upload CSV → proses batch di background → kembalikan batch_job_id.
    Frontend bisa polling /api/predict/batch/{job_id}/status untuk progress.
    """
    # Baca file CSV dengan encoding fallback (sama seperti app.py asli)
    df = _read_csv_with_fallback(await file.read())
    if df is None:
        raise HTTPException(status_code=400, detail="File CSV tidak dapat dibaca. Pastikan format dan encoding benar.")

    if text_column not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"Kolom '{text_column}' tidak ditemukan. Kolom tersedia: {list(df.columns)}"
        )

    # Buat DataSource
    source = DataSource(
        name=source_name,
        type=SourceTypeEnum.csv,
        file_name=file.filename,
        total_rows=len(df),
    )
    db.add(source)
    db.flush()

    # Buat BatchJob
    job = BatchJob(
        source_id=source.id,
        created_by=current_user.id,
        job_name=f"Batch CSV: {file.filename}",
        status=JobStatusEnum.queued,
        total_rows=len(df),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(f"Batch job {job.id} dibuat oleh {current_user.username} — {len(df)} baris")
    log_activity(
        action=Action.PREDICT, entity=Entity.BATCH, entity_id=job.id, user=current_user,
        description=f"Memulai prediksi batch CSV '{file.filename}' ({len(df)} baris)",
        request=request,
    )

    # Jalankan di background
    background_tasks.add_task(
        _run_batch_job,
        job_id=job.id,
        df=df,
        text_column=text_column,
        source_id=source.id,
        pipeline=pipeline,
    )

    return job


@router.get("/batch/{job_id}/status", response_model=BatchJobOut)
def get_batch_status(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    job = db.query(BatchJob).filter(BatchJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Batch job tidak ditemukan")
    return job


# ── Background task ────────────────────────────────────────────────────────────
def _run_batch_job(
    job_id: int,
    df: pd.DataFrame,
    text_column: str,
    source_id: int,
    pipeline: MLPipeline,
):
    """Dijalankan di background thread oleh FastAPI BackgroundTasks."""
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        job = db.query(BatchJob).filter(BatchJob.id == job_id).first()
        job.status = JobStatusEnum.running
        job.started_at = datetime.utcnow()
        db.commit()

        for idx, row in df.iterrows():
            text = str(row[text_column])
            if not text or text.strip() in ("", "nan"):
                continue

            result = pipeline.predict(text)

            review = Review(source_id=source_id, original_text=text)
            db.add(review)
            db.flush()

            ar = AnalysisResult(
                review_id=review.id,
                batch_job_id=job_id,
                nb_sentiment=result.nb_sentiment,
                nb_confidence=result.nb_confidence,
                svm_sentiment=result.svm_sentiment,
                svm_confidence=result.svm_confidence,
            )
            db.add(ar)

            job.processed_rows = int(idx) + 1
            db.commit()

        job.status = JobStatusEnum.done
        job.finished_at = datetime.utcnow()
        db.commit()
        logger.info(f"Batch job {job_id} selesai — {job.processed_rows} baris diproses")

    except Exception as e:
        logger.error(f"Batch job {job_id} gagal: {e}")
        job = db.query(BatchJob).filter(BatchJob.id == job_id).first()
        if job:
            job.status = JobStatusEnum.failed
            job.error_message = str(e)
            db.commit()
    finally:
        db.close()


# ── CSV reader helper ──────────────────────────────────────────────────────────
def _read_csv_with_fallback(content: bytes) -> Optional[pd.DataFrame]:
    encodings = ["utf-8", "utf-8-sig", "latin1", "iso-8859-1", "cp1252"]
    separators = [",", ";", "\t", "|"]

    for enc in encodings:
        try:
            return pd.read_csv(BytesIO(content), encoding=enc)
        except Exception:
            pass

    for sep in separators:
        for enc in encodings:
            try:
                return pd.read_csv(BytesIO(content), encoding=enc, sep=sep, engine="python")
            except Exception:
                pass

    return None
