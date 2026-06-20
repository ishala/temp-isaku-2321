"""
routers/scrape.py
Scraping ulasan Google Play → simpan sebagai data mentah (Review) di DB.
Tahap pertama dalam flow: data mentah → preprocessing → prediksi.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db, User, Review, DataSource, SourceTypeEnum, StatusEnum
from core.auth import get_current_user, require_admin
from core.activity import log_activity, Action, Entity
from core.config import get_settings
from core.logger import logger
from models.schemas import ScrapeRequest, ScrapeResponse

router = APIRouter(prefix="/api/scrape", tags=["Scraping"])
settings = get_settings()


def _period_bounds(year: int, month: int | None) -> tuple[datetime, datetime, str]:
    """Kembalikan (start, end, label) rentang tanggal yang diminta."""
    if month:
        start = datetime(year, month, 1)
        end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
        bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
                 "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][month - 1]
        label = f"{bulan} {year}"
    else:
        start = datetime(year, 1, 1)
        end = datetime(year + 1, 1, 1)
        label = f"Tahun {year}"
    return start, end, label


@router.post("/", response_model=ScrapeResponse)
def scrape_reviews(
    payload: ScrapeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Scrape ulasan Google Play untuk app tertentu, difilter berdasarkan
    tahun (dan bulan opsional), lalu simpan ke DB sebagai data mentah.
    """
    try:
        from google_play_scraper import reviews as gp_reviews, Sort
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Paket 'google-play-scraper' belum terpasang. Jalankan: pip install google-play-scraper",
        )

    app_id = (payload.app_id or settings.scrape_app_id).strip()
    start, end, label = _period_bounds(payload.year, payload.month)

    logger.info(f"Scraping '{app_id}' periode {label} oleh {current_user.username}")

    collected: list[dict] = []
    scanned = 0
    token = None

    try:
        while scanned < settings.scrape_max_scan:
            batch, token = gp_reviews(
                app_id,
                lang=settings.scrape_lang,
                country=settings.scrape_country,
                sort=Sort.NEWEST,
                count=200,
                continuation_token=token,
            )
            if not batch:
                break

            stop = False
            for item in batch:
                scanned += 1
                at = item.get("at")
                if not isinstance(at, datetime):
                    continue
                if at < start:
                    # NEWEST → begitu lebih tua dari periode, sisanya pasti lebih tua
                    stop = True
                    break
                if start <= at < end:
                    collected.append(item)
                    if len(collected) >= payload.max_results:
                        stop = True
                        break

            if stop or token is None:
                break
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Scraping gagal: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Gagal mengambil ulasan dari Google Play untuk '{app_id}'. "
                   f"Periksa app id / koneksi. ({e})",
        )

    if not collected:
        raise HTTPException(
            status_code=404,
            detail=f"Tidak ada ulasan ditemukan untuk periode {label} (dipindai {scanned} ulasan).",
        )

    # Buat DataSource untuk batch scraping ini
    source = DataSource(
        name=f"Google Play — {app_id} ({label})",
        type=SourceTypeEnum.scraping,
        scraped_url=f"https://play.google.com/store/apps/details?id={app_id}",
        total_rows=len(collected),
        description=f"Scraping periode {label} pada {datetime.utcnow():%Y-%m-%d %H:%M}",
    )
    db.add(source)
    db.flush()

    for item in collected:
        db.add(Review(
            source_id=source.id,
            original_text=item.get("content") or "",
            app_version=item.get("reviewCreatedVersion"),
            star_rating=item.get("score"),
            review_date=item.get("at"),
            status=StatusEnum.pending,
        ))

    db.commit()
    logger.info(f"Scraping selesai: {len(collected)} ulasan disimpan (source_id={source.id})")
    log_activity(
        action=Action.SCRAPE, entity=Entity.SOURCE, entity_id=source.id, user=current_user,
        description=f"Scraping Google Play '{app_id}' periode {label}: {len(collected)} ulasan disimpan",
        request=request,
    )

    return ScrapeResponse(
        inserted=len(collected),
        scanned=scanned,
        source_id=source.id,
        app_id=app_id,
        period=label,
        message=f"{len(collected)} ulasan periode {label} berhasil disimpan sebagai data mentah.",
    )
