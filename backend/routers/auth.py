"""
routers/auth.py
Endpoint autentikasi: login, me, logout (client-side token delete)
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from core.database import get_db, User
from core.auth import (
    verify_password, create_access_token,
    get_current_user, require_admin, hash_password,
)
from core.activity import log_activity, Action, Entity
from models.schemas import (
    LoginRequest, TokenResponse, UserOut,
    UserCreate, UserUpdate,
)
from core.logger import logger

router = APIRouter(prefix="/api/auth", tags=["Auth"])


def _role_str(role) -> str:
    """Ambil nilai string dari RoleEnum atau string biasa."""
    return role.value if hasattr(role, "value") else str(role)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()

    if not user or not verify_password(payload.password, user.password_hash):
        logger.warning(f"Login gagal untuk username: {payload.username}")
        log_activity(
            action=Action.LOGIN, entity=Entity.AUTH, status="failed",
            user_id=(user.id if user else None), username=payload.username,
            description=f"Login gagal untuk username '{payload.username}'",
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah",
        )

    if not user.is_active:
        log_activity(
            action=Action.LOGIN, entity=Entity.AUTH, status="failed", user=user,
            description=f"Login ditolak — akun '{user.username}' nonaktif",
            request=request,
        )
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")

    # Update last_login
    user.last_login_at = datetime.utcnow()
    db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role})
    logger.info(f"Login berhasil: {user.username} (role={user.role})")
    log_activity(
        action=Action.LOGIN, entity=Entity.AUTH, user=user,
        description=f"Login berhasil (role={_role_str(user.role)})",
        request=request,
    )

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ── User management (admin only) ───────────────────────────────────────────────
router_users = APIRouter(prefix="/api/users", tags=["Users (Admin)"])


@router_users.get("/", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return db.query(User).order_by(User.created_at.desc()).all()


@router_users.post("/", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username sudah digunakan")

    user = User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info(f"User baru dibuat: {user.username} (role={user.role})")
    log_activity(
        action=Action.CREATE, entity=Entity.USER, entity_id=user.id, user=current_user,
        description=f"Membuat pengguna '{user.username}' ({user.full_name}, role={_role_str(user.role)})",
        request=request,
    )
    return user


@router_users.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    changes = []
    if payload.full_name is not None:
        user.full_name = payload.full_name
        changes.append("nama")
    if payload.role is not None:
        user.role = payload.role
        changes.append(f"role={payload.role}")
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changes.append("aktifkan" if payload.is_active else "nonaktifkan")
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        changes.append("reset password")

    db.commit()
    db.refresh(user)
    logger.info(f"User {user.username} diupdate")
    log_activity(
        action=Action.UPDATE, entity=Entity.USER, entity_id=user.id, user=current_user,
        description=f"Mengubah pengguna '{user.username}' ({', '.join(changes) or 'tanpa perubahan'})",
        request=request,
    )
    return user


@router_users.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    uname = user.username
    db.delete(user)
    db.commit()
    logger.info(f"User {uname} dihapus oleh {current_user.username}")
    log_activity(
        action=Action.DELETE, entity=Entity.USER, entity_id=user_id, user=current_user,
        description=f"Menghapus pengguna '{uname}'",
        request=request,
    )
