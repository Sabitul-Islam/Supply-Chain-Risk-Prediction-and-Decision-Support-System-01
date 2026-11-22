@echo off
REM One-time setup: Python virtual environment, backend packages, model training, frontend packages.
cd /d "%~dp0backend"
py -3 -m venv .venv || python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if not exist .env copy .env.example .env
python -m app.ml.train
cd /d "%~dp0frontend"
call npm install
echo.
echo Setup complete. Run start_backend.bat and start_frontend.bat in two separate windows.
pause
