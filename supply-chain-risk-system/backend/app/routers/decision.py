"""Integrated decision support (services/decision.py)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..services import decision as svc

router = APIRouter(prefix="/api/decision", tags=["decision support"], dependencies=[Depends(get_current_user)])


@router.get("/report")
def report(db: Session = Depends(get_db)):
    """Everything: overall risk overview, prioritised actions and the five scenarios."""
    return svc.full_report(db)


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    return svc.risk_overview(db, svc._plans(db))


@router.get("/actions")
def actions(db: Session = Depends(get_db)):
    return svc.priority_actions(db, svc._plans(db))


@router.get("/inventory-shortage")
def inventory_shortage(db: Session = Depends(get_db)):
    return svc.inventory_shortage(svc._plans(db))


@router.get("/supplier-risk")
def supplier_risk(db: Session = Depends(get_db)):
    return svc.supplier_exposure(db, svc._plans(db))


@router.get("/shipment-delay")
def shipment_delay(db: Session = Depends(get_db)):
    return svc.shipment_delay(db, svc._plans(db))


@router.get("/equipment")
def equipment(db: Session = Depends(get_db)):
    return svc.equipment(db)


@router.get("/demand-plan")
def demand_plan(db: Session = Depends(get_db)):
    """Demand forecast compared with the inventory plan of every stocked product."""
    return svc.demand_plan(svc._plans(db))
