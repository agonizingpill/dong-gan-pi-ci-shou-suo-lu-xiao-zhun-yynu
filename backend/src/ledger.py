import hashlib
import json
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from redis.exceptions import RedisError
from sqlalchemy import inspect, select

from .db import QUEUE, redis, utcnow
from .models import (
    BatchState, CalibrationRelease, ChamberRun, DryBatch, LabEvent, Phase, RecipeLot,
    ReleaseState, RunState, ShrinkageSample, Stage,
)

log = logging.getLogger(__name__)


def checksum(data):
    normalized = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(normalized.encode()).hexdigest()


def record(db, actor, action, detail, code=None):
    db.add(LabEvent(batch_code=code, actor=actor, action=action, detail=detail))


def blocked(db, actor, action, detail, code):
    record(db, actor, f'{action}.blocked', detail, code)
    db.commit()
    raise HTTPException(409, detail)


def row(model):
    result = {}
    for col in inspect(type(model)).column_attrs:
        value = getattr(model, col.key)
        if isinstance(value, datetime):
            value = value.replace(tzinfo=timezone.utc).isoformat()
        result[col.key] = value
    return result


def locked_batch(db, code):
    batch = db.scalar(select(DryBatch).where(DryBatch.code == code).with_for_update())
    if batch is None:
        raise HTTPException(404, '没有找到该冻干批次')
    return batch


def latest_run(db, code):
    return db.scalar(select(ChamberRun).filter_by(batch_code=code).order_by(ChamberRun.id.desc()).limit(1))


def release_for(db, run_id):
    return db.scalar(select(CalibrationRelease).filter_by(run_id=run_id))


def samples_for(db, run_id, *, retest=False):
    return db.scalars(select(ShrinkageSample).filter_by(run_id=run_id, is_retest=retest)
                      .order_by(ShrinkageSample.specimen, ShrinkageSample.id)).all()


def vacuum_points(points):
    return [point for point in points if point['phase'] == Phase.VACUUM]


def curve_issue(points):
    vacuum = vacuum_points(points)
    if len(vacuum) < 2:
        return '曲线缺少完整真空段，至少补录两个真空采集点'
    phases = [point['phase'] for point in points]
    order = {Phase.FREEZE: 0, Phase.VACUUM: 1, Phase.FINISH: 2}
    if phases[0] != Phase.FREEZE or phases[-1] != Phase.FINISH or phases != sorted(phases, key=order.get):
        return '曲线阶段应按预冻、抽真空、解析干燥顺序采集'
    return None


def training_run(db, batch):
    run = latest_run(db, batch.code)
    if not run:
        raise ValueError('批次缺少设备曲线，请先导入设备记录')
    issue = curve_issue(run.points)
    if issue:
        raise ValueError(issue)
    if run.state != RunState.FROZEN:
        raise ValueError('设备曲线尚未冻结，试算与放行必须引用冻结版本')
    return run


def paired_measurements(db, run):
    pairs = {}
    for sample in samples_for(db, run.id):
        pairs.setdefault(sample.specimen, {})[sample.stage] = round(sample.thickness_mm, 5)
    if len(pairs) < 2 or any(len(pair) != 2 for pair in pairs.values()):
        raise ValueError('样本阶段不足，至少两个试片且每个均须配齐冻干前与冻干后厚度')
    if any(pair[Stage.POST] > pair[Stage.PRE] for pair in pairs.values()):
        raise ValueError('样本阶段读数异常，请核查冻干后厚度大于前厚度的试片')
    return pairs


def add_curve(db, batch, payload, actor):
    previous = latest_run(db, batch.code)
    if previous:
        release = release_for(db, previous.id)
        if release and release.state != ReleaseState.HELD:
            blocked(db, actor, 'curve.import', '当前校准尚未结案，复测留置后才能导入新周期', batch.code)
    if batch.state in (BatchState.RELEASED, BatchState.REFERENCE):
        blocked(db, actor, 'curve.import', '已放行或归档的批次保留原曲线', batch.code)
    if db.scalar(select(ChamberRun.id).filter_by(batch_code=batch.code, source_name=payload['source_name'])):
        blocked(db, actor, 'curve.import', '同名曲线已存在，请用新文件名保留修订历史', batch.code)
    run = ChamberRun(batch_code=batch.code, **payload)
    db.add(run)
    batch.state = BatchState.COLLECTING
    record(db, actor, 'curve.import', run.source_name, batch.code)
    db.flush()
    return run


def freeze_curve(db, batch, run, actor):
    if run.state != RunState.DRAFT or latest_run(db, batch.code).id != run.id:
        blocked(db, actor, 'curve.freeze', '仅当前待采曲线可以冻结', batch.code)
    issue = curve_issue(run.points)
    if issue:
        blocked(db, actor, 'curve.freeze', issue, batch.code)
    run.state = RunState.FROZEN
    run.frozen_at = utcnow()
    run.checksum = checksum(run.points)
    record(db, actor, 'curve.freeze', f'{run.source_name} · {run.checksum}', batch.code)


def add_sample(db, batch, run, payload, actor):
    if batch.state != BatchState.COLLECTING or latest_run(db, batch.code).id != run.id or run.state != RunState.FROZEN:
        blocked(db, actor, 'sample.record', '仅采集中当前冻结曲线接受常规阶段测量', batch.code)
    matches = {item.stage: item.thickness_mm for item in samples_for(db, run.id) if item.specimen == payload['specimen']}
    if payload['stage'] in matches:
        blocked(db, actor, 'sample.record', '同一曲线、试片和阶段已有测量', batch.code)
    matches[payload['stage']] = payload['thickness_mm']
    if len(matches) == 2 and matches[Stage.POST] > matches[Stage.PRE]:
        blocked(db, actor, 'sample.record', '冻干后厚度不能大于冻干前读数，请核对试片', batch.code)
    sample = ShrinkageSample(run_id=run.id, technician=actor, **payload)
    db.add(sample)
    record(db, actor, 'sample.record', f'{sample.specimen} · {sample.stage} · {sample.thickness_mm:g} mm', batch.code)
    db.flush()
    return sample


def archive_reference(db, batch, actor, note):
    if batch.state != BatchState.COLLECTING:
        blocked(db, actor, 'reference.archive', '只有采集状态可以认证为历史标定批次', batch.code)
    try:
        pairs = paired_measurements(db, training_run(db, batch))
    except ValueError as exc:
        blocked(db, actor, 'reference.archive', str(exc), batch.code)
    batch.state = BatchState.REFERENCE
    record(db, actor, 'reference.archive', f'{len(pairs)} 组配对 · {note}', batch.code)


def feature_row(batch, recipe, run):
    vacuum = vacuum_points(run.points)
    return [
        round(recipe.solids_pct, 5), round(batch.feed_mm / recipe.nominal_mm, 6),
        vacuum[-1]['minute'] - vacuum[0]['minute'],
        round(sum(point['pressure_pa'] for point in vacuum) / len(vacuum), 6),
        round(sum(point['shelf_c'] for point in vacuum) / len(vacuum), 6),
    ]


def observed(pairs):
    return round(sum(100 * (1 - pair[Stage.POST] / pair[Stage.PRE]) for pair in pairs.values()) / len(pairs), 6)


def queue_fit(db, batch, actor):
    if batch.state != BatchState.COLLECTING:
        blocked(db, actor, 'fit.queue', '该批次当前状态不可提交新试算', batch.code)
    recipe = db.get(RecipeLot, batch.recipe_code)
    try:
        run = training_run(db, batch)
        target_pairs = paired_measurements(db, run)
    except ValueError as exc:
        blocked(db, actor, 'fit.queue', str(exc), batch.code)
    reference = db.scalars(select(DryBatch).filter_by(recipe_code=recipe.code, state=BatchState.REFERENCE)
                           .order_by(DryBatch.code)).all()
    if len(reference) < 3:
        blocked(db, actor, 'fit.queue', '至少需要三个同配方的已认证标定参考批次', batch.code)
    training = []
    for historical in reference:
        archived = latest_run(db, historical.code)
        pairs = paired_measurements(db, archived)
        training.append({
            'batch': historical.code, 'curve_hash': archived.checksum,
            'features': feature_row(historical, recipe, archived), 'observed': observed(pairs), 'pairs': pairs,
        })
    feature_columns = zip(*(item['features'] for item in training), strict=True)
    if not any(max(column) - min(column) > 1e-9 for column in feature_columns):
        blocked(db, actor, 'fit.queue', '参考批次工况一致，请认证有工况变化的同配方历史批次', batch.code)
    snapshot = {
        'batch': batch.code, 'recipe': recipe.code, 'curve_hash': run.checksum,
        'features': feature_row(batch, recipe, run), 'sample_pairs': target_pairs,
        'window': [round(recipe.window_low, 5), round(recipe.window_high, 5)], 'training': training,
    }
    release = CalibrationRelease(run_id=run.id, requested_by=actor, input_hash=checksum(snapshot), snapshot=snapshot)
    db.add(release)
    batch.state = BatchState.CALIBRATING
    record(db, actor, 'fit.queue', f'{run.source_name} · {release.input_hash}', batch.code)
    db.flush()
    return release


def wake_worker(release_id):
    try:
        redis.rpush(QUEUE, release_id)
    except RedisError:
        log.exception('Redis wake-up delayed; worker will scan committed calibrations')


def retry_fit(db, batch, release, actor):
    if release.state != ReleaseState.FAILED:
        blocked(db, actor, 'fit.retry', '仅计算失败的试算可按原输入重试', batch.code)
    release.state = ReleaseState.QUEUED
    release.error = None
    release.touched_at = utcnow()
    record(db, actor, 'fit.retry', f'以原输入 {release.input_hash} 重新计算', batch.code)


def inside(value, window):
    return window[0] <= value <= window[1]


def measure_retest(db, batch, run, release, payload, actor):
    if release.state not in (ReleaseState.AWAITING, ReleaseState.RETEST):
        blocked(db, actor, 'retest.record', '当前校准状态不接受复测', batch.code)
    if any(item.specimen == payload.specimen for item in samples_for(db, run.id)):
        blocked(db, actor, 'retest.record', '复测须取独立试片，试片编号不能与首测重复', batch.code)
    db.add_all([
        ShrinkageSample(run_id=run.id, technician=actor, specimen=payload.specimen, stage=stage,
                        thickness_mm=reading, is_retest=True)
        for stage, reading in [(Stage.PRE, payload.before_mm), (Stage.POST, payload.after_mm)]
    ])
    release.recheck_pct = round(100 * (1 - payload.after_mm / payload.before_mm), 6)
    release.recheck_note = payload.note
    acceptable = release.state == ReleaseState.AWAITING and inside(release.recheck_pct, release.snapshot['window'])
    release.state = ReleaseState.VERIFIED if acceptable else ReleaseState.HELD
    release.touched_at = utcnow()
    action = 'retest.verified' if acceptable else 'retest.held'
    record(db, actor, action, f'{payload.specimen} · {release.recheck_pct:.2f}% · {payload.note}', batch.code)


def sign_release(db, batch, run, release, actor, note):
    if release.state != ReleaseState.VERIFIED or run.state != RunState.FROZEN or latest_run(db, batch.code).id != run.id:
        blocked(db, actor, 'release.sign', '仅窗内且已复测确认的当前冻结曲线允许签发', batch.code)
    release.state = ReleaseState.RELEASED
    release.signed_at = utcnow()
    release.signed_by = actor
    release.release_note = note
    release.touched_at = release.signed_at
    batch.state = BatchState.RELEASED
    record(db, actor, 'release.sign', f'{run.source_name} · {note}', batch.code)
