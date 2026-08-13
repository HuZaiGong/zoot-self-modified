@echo off
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=55000"

if not exist "bootstrap_token.txt" (
    echo bootstrap_token.txt not found. Make sure the server is running ^(start.bat / start.sh^).
    pause
    exit /b 1
)
for /f "usebackq delims=" %%t in ("bootstrap_token.txt") do set "TOKEN=%%t"
start "" "http://127.0.0.1:%PORT%/__local/bootstrap?token=%TOKEN%&next=%2Fstatic%2Findex.html"
endlocal
