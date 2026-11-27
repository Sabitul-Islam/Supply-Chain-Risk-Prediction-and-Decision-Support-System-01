"""Returns management endpoints (rules in services/returns.py)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import ProductReturn, SalesOrder, User
from ..schemas import ReturnCreate, ReturnStatusIn
from ..services import returns as svc
from ..services.errors import transaction
from ..services.orders import returned_quantities

router = APIRouter(prefix="/api/returns", tags=["returns"])


def _get(db, rid) -> ProductReturn:
    r = db.get(ProductReturn, rid)
    if not r:
        raise HTTPException(404, "Return not found.")
    return r


@router.get("")
def list_returns(status: str | None = Query(None), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    rs = db.query(ProductReturn).order_by(ProductReturn.id.desc()).all()
    counts = {s: 0 for s in svc.STATUSES}
    for r in rs:
        counts[r.status] += 1
    return {"items": [svc.serialize_return(r) for r in rs if not status or r.status == status], "counts": counts,
            "statuses": svc.STATUSES, "outcomes": svc.OUTCOMES}


@router.get("/eligible-orders")
def eligible_orders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Delivered orders that still have units that can be returned."""
    out = []
    for o in db.query(SalesOrder).filter(SalesOrder.status == "Delivered").order_by(SalesOrder.id.desc()).all():
        done = returned_quantities(o)
        lines = [{"order_item_id": i.id, "product_id": i.product_id, "product_name": i.product.name,
                  "delivered": i.quantity, "returnable": i.quantity - done.get(i.id, 0)} for i in o.items]
        lines = [l for l in lines if l["returnable"] > 0]
        if lines:
            out.append({"id": o.id, "order_number": o.order_number, "customer_name": o.customer.name, "lines": lines})
    return out


@router.get("/{return_id}")
def get_return(return_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return svc.serialize_return(_get(db, return_id), detail=True)


@router.post("", status_code=201)
def create(data: ReturnCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    with transaction(db):
        r = svc.create_return(db, data.sales_order_id, data.reason,
                              [(i.order_item_id, i.quantity) for i in data.items], user.id)
    return svc.serialize_return(r, detail=True)


@router.post("/{return_id}/status")
def set_status(return_id: int, data: ReturnStatusIn, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    r = _get(db, return_id)
    with transaction(db):
        svc.change_status(db, r, data.status, user.id, data.inspection_outcome, data.notes)
    return svc.serialize_return(r, detail=True)
