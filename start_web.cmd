@echo off
setlocal
set PYTHONUTF8=1
cd /d "%~dp0"
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if not errorlevel 1 (
    py -3 bootstrap.py
    goto :finished
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if not errorlevel 1 (
    python bootstrap.py
    goto :finished
)
echo Can cai Python 3.10 hoac moi hon de chay ung dung.
echo Tai Python tai https://www.python.org/downloads/windows/
echo Khi cai, chon Add Python to PATH. Sau do mo lai file nay.
start "" "https://www.python.org/downloads/windows/"
:finished
pause
