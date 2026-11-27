"""Order Management and Fulfilment endpoints (business rules live in services/orders.py)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import InventoryItem, Product, SalesOrder, SalesOrderItem, User
from ..schemas import OrderCreate, OrderStatusIn, ShippingModeIn
from ..services import orders as svc
from ..services.errors import transaction

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _get(db, order_id) -> SalesOrder:
    o = db.get(SalesOrder, order_id)
    if not o:
        raise HTTPException(404, "Order not found.")
    return o


@router.get("")
def list_orders(status: str | None = Query(None), db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    q = db.query(SalesOrder).options(joinedload(SalesOrder.customer), joinedload(SalesOrder.items),
                                     joinedload(SalesOrder.shipments))
    all_orders = q.order_by(SalesOrder.id.desc()).all()
    counts = {s: 0 for s in svc.STATUSES}
    for o in all_orders:
        counts[o.status] += 1
    rows = [svc.serialize_order(o) for o in all_orders if not status or o.status == status]
    return {"items": rows, "counts": counts, "statuses": svc.STATUSES,
            "delayed": sum(1 for o in all_orders if o.shipments and svc.shipment_delay_state(o.shipments[0])["is_delayed"]
                           and o.status not in ("Delivered", "Cancelled"))}


@router.get("/available-products")
def available_products(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Products that can be ordered, with the largest unreserved quantity in a single warehouse."""
    best: dict = {}
    for i in db.query(InventoryItem).options(joinedload(InventoryItem.product)).all():
        net = i.available_stock - i.reserved_stock
        if i.product_id not in best or net > best[i.product_id]["available"]:
            best[i.product_id] = {"product_id": i.product_id, "name": i.product.name, "category": i.product.category,
                                  "department": i.product.department, "price": round(i.product.price, 2),
                                  "available": net, "warehouse": i.warehouse}
    return sorted(best.values(), key=lambda x: x["name"])


@router.get("/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return svc.serialize_order(_get(db, order_id), detail=True)


@router.post("", status_code=201)
def create(data: OrderCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    with transaction(db):
        o = svc.create_order(db, data, user.id)
    return svc.serialize_order(o, detail=True)


@router.post("/{order_id}/status")
def set_status(order_id: int, data: OrderStatusIn, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    o = _get(db, order_id)
    with transaction(db):
        svc.change_status(db, o, data.status, user.id, data.note, data.delivery_date)
    db.refresh(o)
    return svc.serialize_order(o, detail=True)


@router.post("/{order_id}/shipping-mode")
def set_shipping_mode(order_id: int, data: ShippingModeIn, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    o = _get(db, order_id)
    with transaction(db):
        svc.change_shipping_mode(db, o, data.shipping_mode, user.id)
    return svc.serialize_order(o, detail=True)
