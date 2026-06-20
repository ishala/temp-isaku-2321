"""
core/auth.py
JWT token generation & verification, password hashing, FastAPI dependencies.
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from core.config import get_settings
from core.database import get_db, User, RoleEnum
from core.logger import logger

settings = get_settings()

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Password ───────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT ────────────────────────────────────────────────────────────────────────
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as e:
        logger.warning(f"JWT decode failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid atau sudah expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Dependencies ───────────────────────────────────────────────────────────────
def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(token)
    user_id: int = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token tidak valid")

    user = db.query(User).filter(User.id == int(user_id), User.is_active == 1).first()
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan atau nonaktif")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != RoleEnum.admin:
        logger.warning(f"Unauthorized admin access by user {current_user.username}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya admin yang dapat mengakses fitur ini",
        )
    return current_user


def require_analyst(current_user: User = Depends(get_current_user)) -> User:
    """Analyst dan admin keduanya boleh akses."""
    if current_user.role not in (RoleEnum.admin, RoleEnum.analyst):
        raise HTTPException(status_code=403, detail="Akses ditolak")
    return current_user
