"""
core/config.py
Konfigurasi aplikasi — dibaca dari .env secara otomatis
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
import os
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    # Database
    db_host: str = os.getenv('DB_HOST', '127.0.0.1')
    db_port: int = os.getenv('DB_PORT', '3306')
    db_user: str = os.getenv('DB_USER', 'root')
    db_password: str = os.getenv('DB_PASSWORD', '')
    db_name: str = os.getenv('DB_NAME', 'isaku')

    # JWT
    secret_key: str = os.getenv('SECRET_KEY')
    algorithm: str = os.getenv('ALGORITHM', 'HS256')
    access_token_expire_minutes: int = os.getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '400')

    # App
    app_env: str = os.getenv('APP_ENV', 'production')
    log_level: str = os.getenv('LOG_LEVEL', 'INFO')

    # Scraping (Google Play) — bisa di-override via .env atau form di UI
    scrape_app_id: str = os.getenv('SCRAPE_APP_ID', 'com.bcp.isaku')
    scrape_lang: str = os.getenv('SCRAPE_LANG', 'id')
    scrape_country: str = os.getenv('SCRAPE_COUNTRY', 'id')
    scrape_max_scan: int = int(os.getenv('SCRAPE_MAX_SCAN', '3000'))

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset=utf8mb4"
        )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Singleton settings — dibaca sekali, di-cache."""
    return Settings()
