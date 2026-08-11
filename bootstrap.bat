@echo off
chcp 65001 >nul
cd /d "%~dp0"
for /f "usebackq delims=" %%t in ("bootstrap_token.txt") do set TOKEN=%%t
start "" "http://127.0.0.1:55000/__local/bootstrap?token=%TOKEN%&next=%2Fstatic%2Findex.html"
