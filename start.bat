@echo off
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=55000"

rem Prefer repo-local venv, then sibling venv, then PATH python.
set "PY="
if exist "%~dp0venv\Scripts\pythonw.exe" (
    set "PY=%~dp0venv\Scripts\pythonw.exe"
) else if exist "%~dp0..\venv\Scripts\pythonw.exe" (
    set "PY=%~dp0..\venv\Scripts\pythonw.exe"
) else if exist "%~dp0venv\Scripts\python.exe" (
    set "PY=%~dp0venv\Scripts\python.exe"
) else if exist "%~dp0..\venv\Scripts\python.exe" (
    set "PY=%~dp0..\venv\Scripts\python.exe"
) else (
    where pythonw.exe >nul 2>nul && set "PY=pythonw.exe"
    if not defined PY where python.exe >nul 2>nul && set "PY=python.exe"
)
if not defined PY (
    echo Python not found. Install Python 3.13 and create a venv, see README.
    pause
    exit /b 1
)

set "PYTHONIOENCODING=utf-8"
start "ZOOT" "%PY%" "%~dp0launch.py" --port %PORT%
echo ZOOT server starting: http://127.0.0.1:%PORT%
echo A browser window opens automatically; otherwise run bootstrap.bat
timeout /t 3 >nul
endlocal
