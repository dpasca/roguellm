#!/bin/bash
source venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port "${ROGUELLM_BACKEND_PORT:-8127}"
