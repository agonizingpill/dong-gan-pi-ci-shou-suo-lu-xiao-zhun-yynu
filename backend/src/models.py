from enum import StrEnum

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Double, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, utcnow


class Role(StrEnum):
    OPERATOR = 'operator'
    SUPERVISOR = 'supervisor'
    VIEWER = 'viewer'


class Stage(StrEnum):
    PRE = 'pre'
    POST = 'post'


class Phase(StrEnum):
    FREEZE = 'freeze'
    VACUUM = 'vacuum'
    FINISH = 'finish'


class BatchState(StrEnum):
    COLLECTING = 'collecting'
    REFERENCE = 'reference'
    CALIBRATING = 'calibrating'
    REVIEW = 'review'
    RELEASED = 'released'


class RunState(StrEnum):
    DRAFT = 'draft'
    FROZEN = 'frozen'


class ReleaseState(StrEnum):
    QUEUED = 'queued'
    RUNNING = 'running'
    FAILED = 'failed'
    AWAITING = 'awaiting_verification'
    RETEST = 'retest_required'
    VERIFIED = 'verified'
    HELD = 'held'
    RELEASED = 'released'


def enum(values):
    return Enum(values, values_callable=lambda variants: [item.value for item in variants])


class User(Base):
    __tablename__ = 'lab_users'
    username: Mapped[str] = mapped_column(String(32), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(192))
    role: Mapped[Role] = mapped_column(enum(Role))


class RecipeLot(Base):
    __tablename__ = 'recipe_lots'
    __table_args__ = (CheckConstraint('window_low < window_high'),)
    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    product: Mapped[str] = mapped_column(String(90))
    solids_pct: Mapped[float] = mapped_column(Double)
    nominal_mm: Mapped[float] = mapped_column(Double)
    window_low: Mapped[float] = mapped_column(Double)
    window_high: Mapped[float] = mapped_column(Double)


class DryBatch(Base):
    __tablename__ = 'dry_batches'
    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    recipe_code: Mapped[str] = mapped_column(ForeignKey('recipe_lots.code'), index=True)
    dryer: Mapped[str] = mapped_column(String(40))
    material_lot: Mapped[str] = mapped_column(String(40))
    feed_mm: Mapped[float] = mapped_column(Double)
    state: Mapped[BatchState] = mapped_column(enum(BatchState), default=BatchState.COLLECTING)


class ChamberRun(Base):
    __tablename__ = 'chamber_runs'
    __table_args__ = (UniqueConstraint('batch_code', 'source_name'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    batch_code: Mapped[str] = mapped_column(ForeignKey('dry_batches.code'), index=True)
    source_name: Mapped[str] = mapped_column(String(96))
    state: Mapped[RunState] = mapped_column(enum(RunState), default=RunState.DRAFT)
    points: Mapped[list] = mapped_column(JSON)
    checksum: Mapped[str | None] = mapped_column(String(64))
    frozen_at = mapped_column(DateTime(), nullable=True)


class ShrinkageSample(Base):
    __tablename__ = 'shrinkage_samples'
    __table_args__ = (
        UniqueConstraint('run_id', 'specimen', 'stage'), CheckConstraint('thickness_mm > 0'),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey('chamber_runs.id'), index=True)
    specimen: Mapped[str] = mapped_column(String(32))
    stage: Mapped[Stage] = mapped_column(enum(Stage))
    thickness_mm: Mapped[float] = mapped_column(Double)
    is_retest: Mapped[bool] = mapped_column(Boolean, default=False)
    technician: Mapped[str] = mapped_column(String(32))
    recorded_at = mapped_column(DateTime(), default=utcnow)


class CalibrationRelease(Base):
    __tablename__ = 'calibration_releases'
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey('chamber_runs.id'), unique=True)
    state: Mapped[ReleaseState] = mapped_column(enum(ReleaseState), default=ReleaseState.QUEUED, index=True)
    requested_by: Mapped[str] = mapped_column(String(32))
    input_hash: Mapped[str] = mapped_column(String(64))
    snapshot: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String(240))
    prediction_pct: Mapped[float | None] = mapped_column(Double)
    recheck_pct: Mapped[float | None] = mapped_column(Double)
    recheck_note: Mapped[str | None] = mapped_column(String(240))
    release_note: Mapped[str | None] = mapped_column(String(240))
    signed_by: Mapped[str | None] = mapped_column(String(32))
    signed_at = mapped_column(DateTime(), nullable=True)
    touched_at = mapped_column(DateTime(), default=utcnow)
    attempts: Mapped[int] = mapped_column(default=0)


class LabEvent(Base):
    __tablename__ = 'lab_events'
    id: Mapped[int] = mapped_column(primary_key=True)
    batch_code: Mapped[str | None] = mapped_column(ForeignKey('dry_batches.code'), index=True)
    actor: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(48))
    detail: Mapped[str] = mapped_column(Text)
    happened_at = mapped_column(DateTime(), default=utcnow)
