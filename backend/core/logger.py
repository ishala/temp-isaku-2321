"""
core/logger.py
Setup loguru — dua file terpisah: app.log (semua) dan error.log (WARNING ke atas)
"""
import sys
from loguru import logger
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)


def setup_logger(log_level: str = "DEBUG") -> None:
    """Inisialisasi logger. Dipanggil sekali saat startup FastAPI."""
    logger.remove()  # Hapus default handler

    # Handler 1: Console (warna, semua level)
    logger.add(
        sys.stdout,
        level=log_level,
        colorize=True,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        ),
    )

    # Handler 2: app.log — semua level, rotation 10MB, retention 30 hari
    logger.add(
        LOG_DIR / "app.log",
        level=log_level,
        rotation="10 MB",
        retention="30 days",
        compression="zip",
        encoding="utf-8",
        format=(
            "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | "
            "{name}:{function}:{line} | {message}"
        ),
    )

    # Handler 3: error.log — hanya WARNING ke atas
    logger.add(
        LOG_DIR / "error.log",
        level="WARNING",
        rotation="5 MB",
        retention="60 days",
        compression="zip",
        encoding="utf-8",
        format=(
            "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | "
            "{name}:{function}:{line} | {message}\n{exception}"
        ),
    )

    logger.info(f"Logger initialized — log dir: {LOG_DIR}")


# Export logger langsung agar bisa di-import di modul lain
__all__ = ["logger", "setup_logger"]
