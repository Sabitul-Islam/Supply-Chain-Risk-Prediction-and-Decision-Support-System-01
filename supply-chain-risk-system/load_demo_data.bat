@echo off
REM Optional: creates a small DEMO scenario (sample orders, purchase orders, a return) via the real workflow rules.
REM Runs only when there are no orders yet. Stop the backend first.
cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
python -m app.demo_data
pause
