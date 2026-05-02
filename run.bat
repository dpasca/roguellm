
@echo off
if "%ROGUELLM_BACKEND_PORT%"=="" set ROGUELLM_BACKEND_PORT=8127
python -m uvicorn main:app --reload --host 127.0.0.1 --port %ROGUELLM_BACKEND_PORT%
