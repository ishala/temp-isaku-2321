"""
seed.py
Jalankan SEKALI untuk membuat akun admin pertama.
Gunakan: python seed.py
"""
import sys
from pathlib import Path

# Pastikan path benar
sys.path.insert(0, str(Path(__file__).parent))

from core.database import SessionLocal, init_db, User, RoleEnum
from core.auth import hash_password
from core.logger import setup_logger, logger


def seed():
    setup_logger("INFO")
    init_db()

    db = SessionLocal()
    try:
        # Cek apakah admin sudah ada
        existing = db.query(User).filter(User.username == "admin").first()
        if existing:
            logger.info("Admin sudah ada, skip seeding.")
            return

        admin = User(
            username="admin",
            full_name="Administrator",
            password_hash=hash_password("admin123"),
            role=RoleEnum.admin,
            is_active=1,
        )
        db.add(admin)

        # Tambah sample analyst
        analyst = User(
            username="analyst1",
            full_name="Analyst Pertama",
            password_hash=hash_password("analyst123"),
            role=RoleEnum.analyst,
            is_active=1,
        )
        db.add(analyst)
        db.commit()

        logger.info("✅ Seed berhasil!")
        logger.info("   Admin    → username: admin     | password: admin123")
        logger.info("   Analyst  → username: analyst1  | password: analyst123")

    except Exception as e:
        logger.error(f"Seed gagal: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
