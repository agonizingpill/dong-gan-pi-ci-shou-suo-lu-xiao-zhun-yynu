import logging
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .operations_evidence import router as operations_evidence
from .db import engine, redis
from .routes import router

log = logging.getLogger('uvicorn.error')
app = FastAPI(title='北屿果研 · 冻干计量台', version='1.0')
app.include_router(operations_evidence)
app.include_router(router)


@app.middleware('http')
async def unexpected_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        log.exception('Unexpected request failure %s', request.state.request_id)
        return JSONResponse({'detail': '实验室台账暂不可用，请稍后重试'}, status_code=500)


@app.middleware('http')
async def trace_request(request: Request, call_next):
    request.state.request_id = uuid4().hex
    start = time.monotonic()
    response = await call_next(request)
    response.headers['X-Request-Id'] = request.state.request_id
    log.info('%s %s %s %.0fms %s', request.method, request.url.path, response.status_code,
             (time.monotonic() - start) * 1000, request.state.request_id)
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc):
    errors = [{'field': '.'.join(map(str, item['loc'][1:])), 'message': item['msg']} for item in exc.errors()]
    return JSONResponse({'detail': '请核对录入字段', 'fields': errors}, status_code=422)


@app.get('/health', include_in_schema=False)
def health():
    try:
        with engine.connect() as connection:
            connection.execute(text('SELECT 1'))
        redis.ping()
        return {'status': 'ok', 'dependencies': ['mysql', 'redis']}
    except Exception:
        return JSONResponse({'status': 'degraded'}, status_code=503)
