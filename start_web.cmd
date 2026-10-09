@echo off
setlocal
cd /d "%~dp0"
where pnpm >nul 2>&1
if errorlevel 1 (
    echo Can cai Node.js va pnpm truoc. Xem README.md.
    pause
    exit /b 1
)
pnpm dev
