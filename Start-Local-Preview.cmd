@echo off
cd /d "%~dp0"
set "PORT=3333"
set "APP_ORIGIN=http://localhost:3333"
echo LOKALNI PREGLED - Ovi podaci nisu u Supabase bazi.
echo Kada se pojavi Ready, otvorite http://localhost:3333
call npm run dev:preview
pause
