"""Shared test setup: every test run uses a fresh temporary SQLite database (your real database is never touched)."""
import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-0123456789")
