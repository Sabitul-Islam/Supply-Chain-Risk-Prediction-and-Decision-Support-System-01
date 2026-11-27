"""Purchase Order workflow, reorder recommendations and inbound receipts (rules in services/purchasing.py)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import PurchaseOrder, User
from ..schemas import POCreate, POGenerateIn, POReceiveIn, POStatusIn
from ..services import purchasing as svc
from ..services.errors import transaction
from ..services.planning import replenishment_plan

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase orders"])


def _get(db, po_id) -> PurchaseOrder:
    po = db.get(PurchaseOrder, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found.")
    return po


@router.get("")
def list_pos(status: str | None = Query(None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pos = (db.query(PurchaseOrder).options(joinedload(PurchaseOrder.supplier), joinedload(PurchaseOrder.items))
           .order_by(PurchaseOrder.id.desc()).all())
    counts = {s: 0 for s in svc.STATUSES}
    for p in pos:
        counts[p.status] += 1
    rows = [svc.serialize_po(p) for p in pos if not status or p.status == status]
    return {"items": rows, "counts": counts, "statuses": svc.STATUSES,
            "inbound_delayed": sum(1 for p in pos if p.status == "Ordered" and svc.inbound_state(p)["is_delayed"])}


@router.get("/recommendations")
def recommendations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Inventory records at stockout risk with forecast-based replenishment quantity and recommended supplier."""
    return replenishment_plan(db)


@router.post("/generate", status_code=201)
def generate(data: POGenerateIn | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    with transaction(db):
        pos = svc.generate_from_plan(db, user.id, data.inventory_ids if data else None)
    return {"created": len(pos), "purchase_orders": [svc.serialize_po(p) for p in pos]}


@router.get("/{po_id}")
def get_po(po_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return svc.serialize_po(_get(db, po_id), detail=True)


@router.post("", status_code=201)
def create(data: POCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    with transaction(db):
        po = svc.create_po(db, data.supplier_id, data.warehouse,
                           [(i.product_id, i.quantity, i.unit_cost) for i in data.items], user.id, data.notes,
                           data.expected_arrival_date)
    return svc.serialize_po(po, detail=True)


@router.post("/{po_id}/status")
def set_status(po_id: int, data: POStatusIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    po = _get(db, po_id)
    with transaction(db):
        svc.change_status(db, po, data.status, user.id, data.expected_arrival_date)
    return svc.serialize_po(po, detail=True)


@router.post("/{po_id}/receive")
def receive(po_id: int, data: POReceiveIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    po = _get(db, po_id)
    lines = {l.item_id: l.received_quantity for l in data.items} if data.items else None
    if data.items and len(lines) != len(data.items):
        raise HTTPException(422, "Each line can be listed only once.")
    with transaction(db):
        svc.receive(db, po, lines, data.actual_arrival_date, user.id)
    return svc.serialize_po(po, detail=True)
