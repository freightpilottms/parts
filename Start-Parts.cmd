@echo off
cd /d "%~dp0"
set "APP_ORIGIN=http://localhost:3333"
call npm run db:setup
if errorlevel 1 (
  echo.
  echo Supabase nije dostupan. Provjerite internet i DATABASE_URL u .env.local.
  pause
  exit /b 1
)
echo Kada se pojavi Ready, otvorite http://localhost:3333
call npm run dev -- --port 3333
pause
