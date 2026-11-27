"""Business-rule errors raised by the workflow services and translated to HTTP responses by the routers."""
from contextlib import contextmanager

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .inventory_ops import StockError


class WorkflowError(ValueError):
    """Invalid business operation (e.g. an invalid status transition). status 409 = conflict, 400/404 also used."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


@contextmanager
def transaction(db: Session):
    """Run a workflow step as ONE database transaction: commit on success, roll back everything on any error,
    so stock quantities, documents and the movement log can never be left half-updated."""
    try:
        yield
        db.commit()
    except WorkflowError as e:
        db.rollback()
        raise HTTPException(e.status, str(e))
    except StockError as e:
        db.rollback()
        raise HTTPException(409, str(e))
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, f"The change conflicts with existing records ({e.orig}).")
    except Exception:
        db.rollback()
        raise
