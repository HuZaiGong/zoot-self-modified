@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" /min "F:\zoot\venv\Scripts\pythonw.exe" launch.py 55000
echo ZOOT 服务器已启动: http://127.0.0.1:55000
echo 浏览器窗口会自动打开；若未打开，运行 bootstrap.bat
timeout /t 3 >nul
