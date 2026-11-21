import json
import logging
import time
from datetime import timedelta
from pathlib import Path

from redis.exceptions import RedisError
from sqlalchemy import or_, select

from .calculation import estimate
from .db import QUEUE, Session, redis, utcnow
from .ledger import checksum, inside, record
from .models import BatchState, CalibrationRelease, ChamberRun, DryBatch, ReleaseState

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)
HEARTBEAT = Path('/tmp/worker-heartbeat')


def claim(wakeup_id):
    with Session.begin() as db:
        eligible = or_(CalibrationRelease.state == ReleaseState.QUEUED,
                       (CalibrationRelease.state == ReleaseState.RUNNING) &
                       (CalibrationRelease.touched_at < utcnow() - timedelta(minutes=5)))
        query = select(CalibrationRelease).where(eligible)
        if wakeup_id is not None:
            query = query.where(CalibrationRelease.id == wakeup_id)
        release = db.scalar(query.order_by(CalibrationRelease.id).limit(1).with_for_update(skip_locked=True))
        if release is None:
            return None
        release.state = ReleaseState.RUNNING
        release.attempts += 1
        release.touched_at = utcnow()
        return release.id, release.attempts, release.snapshot, release.input_hash


def settle(job, result, error):
    release_id, attempt, snapshot, digest = job
    with Session.begin() as db:
        batch = db.scalar(select(DryBatch).where(DryBatch.code == snapshot['batch']).with_for_update())
        entry = db.get(CalibrationRelease, release_id, with_for_update=True)
        if entry.attempts != attempt or entry.state != ReleaseState.RUNNING:
            return
        entry.touched_at = utcnow()
        if error is not None:
            entry.state = ReleaseState.FAILED
            entry.error = error[:240]
            record(db, 'worker', 'fit.failed', entry.error, batch.code)
            return
        evidence = Path(f'/evidence/fit-{release_id}.json')
        temp = evidence.with_suffix(f'.{attempt}.tmp')
        try:
            payload = {'input_hash': digest, 'snapshot': snapshot, 'result': result}
            temp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
            temp.replace(evidence)
        finally:
            temp.unlink(missing_ok=True)
        entry.result = result
        entry.prediction_pct = result['prediction_pct']
        within_window = inside(entry.prediction_pct, snapshot['window'])
        entry.state = ReleaseState.AWAITING if within_window else ReleaseState.RETEST
        batch.state = BatchState.REVIEW
        run = db.get(ChamberRun, entry.run_id)
        record(db, 'worker', 'fit.completed' if within_window else 'retest.opened',
               f'{run.source_name} · {entry.prediction_pct:.3f}% · 工艺窗 {snapshot["window"]}', batch.code)
        log.info('calibration %s %s', release_id, entry.state.value)


def process(job):
    _, _, snapshot, digest = job
    try:
        if checksum(snapshot) != digest:
            raise ValueError('试算输入快照校验失败')
        result = estimate(snapshot)
    except Exception as exc:
        log.exception('calibration fit failed')
        settle(job, None, str(exc))
    else:
        try:
            settle(job, result, None)
        except OSError:
            log.exception('calibration evidence could not be written')
            settle(job, None, '证据卷暂不可写，可按原快照重试')


def main():
    while True:
        try:
            try:
                entry = redis.blpop(QUEUE, timeout=2)
            except RedisError:
                log.warning('Redis unavailable; checking committed calibration queue')
                time.sleep(2)
                entry = None
            job = claim(int(entry[1])) if entry else None
            job = job or claim(None)
            if job:
                process(job)
            HEARTBEAT.touch()
        except Exception:
            log.exception('worker iteration failed')
            time.sleep(3)


if __name__ == '__main__':
    main()
