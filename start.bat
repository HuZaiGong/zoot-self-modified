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

rem No python at all: use uv to install Python 3.13 (user scope), then create venv.
if not defined PY (
    where uv.exe >nul 2>nul || (
        echo uv not found. Install uv first: https://docs.astral.sh/uv/getting-started/installation/
        pause
        exit /b 1
    )
    echo Installing Python 3.13 via uv...
    uv python install 3.13 || (echo Failed to install Python 3.13. & pause & exit /b 1)
    for /f "delims=" %%p in ('uv python find 3.13') do set "UVPY=%%p"
    if not defined UVPY (echo uv python find returned nothing. & pause & exit /b 1)
    echo Creating venv with uv...
    uv venv "%~dp0venv" --python "%UVPY%" || (echo Failed to create venv. & pause & exit /b 1)
    set "PY=%~dp0venv\Scripts\pythonw.exe"
    if not exist "%PY%" set "PY=%~dp0venv\Scripts\python.exe"
)

rem Repo-local venv missing deps: bootstrap with uv (fallback: plain pip).
if exist "%~dp0venv\Scripts\python.exe" (
    "%~dp0venv\Scripts\python.exe" -c "import fastapi, openai, uvicorn, pydantic, cryptography; assert pydantic.__version__.startswith('1.')" >nul 2>nul
    if errorlevel 1 (
        echo Installing dependencies...
        where uv.exe >nul 2>nul && (
            uv pip install --python "%~dp0venv\Scripts\python.exe" -r "%~dp0requirements.txt" || (echo Dependency install failed. & pause & exit /b 1)
        ) || (
            "%~dp0venv\Scripts\pip.exe" install -r "%~dp0requirements.txt" || (echo Dependency install failed. & pause & exit /b 1)
        )
    )
)

set "PYTHONIOENCODING=utf-8"
start "ZOOT" "%PY%" "%~dp0launch.py" --port %PORT%
echo ZOOT server starting: http://127.0.0.1:%PORT%
echo A browser window opens automatically; otherwise run bootstrap.bat
timeout /t 3 >nul
endlocal
