"""
routers/activity.py
Audit trail aktivitas pengguna (admin only): daftar log dengan filter +
pagination, statistik ringkas, dan opsi filter (daftar aksi/entitas/user).
"""
from datetime import datetime, date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, distinct

from core.database import get_db, User, ActivityLog
from core.auth import require_admin
from models.schemas import (
    ActivityLogOut, ActivityLogPage, ActivityStats, ActivityFilters,
)

router = APIRouter(prefix="/api/activity", tags=["Activity Log (Admin)"])


@router.get("/", response_model=ActivityLogPage)
def list_activity(
    user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    entity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Daftar aktivitas terurut terbaru, dengan filter & pagination."""
    q = db.query(ActivityLog)

    if user_id:
        q = q.filter(ActivityLog.user_id == user_id)
    if action:
        q = q.filter(ActivityLog.action == action)
    if entity:
        q = q.filter(ActivityLog.entity == entity)
    if status:
        q = q.filter(ActivityLog.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            ActivityLog.description.like(like),
            ActivityLog.username.like(like),
            ActivityLog.ip_address.like(like),
        ))
    if date_from:
        q = q.filter(ActivityLog.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(ActivityLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))

    total = q.count()
    items = (
        q.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return ActivityLogPage(total=total, items=items)


@router.get("/stats", response_model=ActivityStats)
def activity_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """KPI ringkas untuk header halaman Log Aktivitas."""
    total = db.query(func.count(ActivityLog.id)).scalar() or 0

    start_today = datetime.combine(date.today(), datetime.min.time())
    today = (
        db.query(func.count(ActivityLog.id))
        .filter(ActivityLog.created_at >= start_today)
        .scalar()
    ) or 0

    active_users = (
        db.query(func.count(distinct(ActivityLog.user_id)))
        .filter(ActivityLog.user_id.isnot(None))
        .scalar()
    ) or 0

    failed = (
        db.query(func.count(ActivityLog.id))
        .filter(ActivityLog.status == "failed")
        .scalar()
    ) or 0

    return ActivityStats(total=total, today=today, active_users=active_users, failed=failed)


@router.get("/filters", response_model=ActivityFilters)
def activity_filters(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Nilai distinct untuk mengisi dropdown filter di frontend."""
    actions = [a[0] for a in db.query(distinct(ActivityLog.action)).all() if a[0]]
    entities = [e[0] for e in db.query(distinct(ActivityLog.entity)).all() if e[0]]

    # Pengguna yang pernah punya log (untuk dropdown), pakai snapshot username
    user_rows = (
        db.query(ActivityLog.user_id, ActivityLog.username)
        .filter(ActivityLog.user_id.isnot(None))
        .distinct()
        .all()
    )
    seen, users = set(), []
    for uid, uname in user_rows:
        if uid in seen:
            continue
        seen.add(uid)
        users.append({"id": uid, "username": uname or f"user#{uid}"})
    users.sort(key=lambda u: (u["username"] or "").lower())

    return ActivityFilters(
        actions=sorted(actions),
        entities=sorted(entities),
        users=users,
    )
