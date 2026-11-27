@echo off
REM Runs the automated backend tests on a temporary database (your data is not touched).
cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
python -m pytest -q
pause
