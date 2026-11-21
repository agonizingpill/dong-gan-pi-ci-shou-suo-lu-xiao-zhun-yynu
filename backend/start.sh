#!/bin/sh
set -eu
python -m migrations.initial
if [ "${SEED_DEMO:-true}" = true ]; then
  python -m scripts.seed_demo || printf '%s\n' 'Demo seed failed; inspect the preceding log.' >&2
fi
exec uvicorn src.app:app --host 0.0.0.0 --port 8000
