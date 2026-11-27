from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import InventoryItem, InventoryTransaction, Product, SalesOrder, SalesOrderItem, User
from ..schemas import InventoryIn, StockAdjustIn
from ..services import inventory_ops as stock
from ..services.csv_utils import read_csv_upload, validate_rows
from ..services.errors import transaction
from ..services.orders import RESERVED_STATUSES
from ..services.planning import po_quantities
from ..services.risk import inventory_risk

router = APIRouter(prefix="/api", tags=["inventory"], dependencies=[Depends(get_current_user)])
COLUMNS = list(InventoryIn.model_fields)


def serialize(i: InventoryItem, po_qty: dict | None = None) -> dict:
    q = (po_qty or {}).get((i.product_id, i.warehouse), {"on_order": 0, "draft": 0})
    return {"id": i.id, **{c: getattr(i, c) for c in COLUMNS},
            "product_name": i.product.name, "category": i.product.category,
            "supplier": i.product.supplier.name if i.product.supplier else None,
            "on_order": q["on_order"], "draft_po_qty": q["draft"],
            **inventory_risk(i.available_stock, i.reserved_stock, i.reorder_level, i.safety_stock,
                             i.lead_time_days, i.avg_daily_demand)}


def all_items(db: Session) -> list[dict]:
    items = db.query(InventoryItem).options(joinedload(InventoryItem.product).joinedload(Product.supplier)).all()
    po_qty = po_quantities(db)
    order = {"High": 0, "Medium": 1, "Low": 2}
    return sorted((serialize(i, po_qty) for i in items), key=lambda x: (order[x["stockout_risk"]], x["days_of_cover"] or 0))


def order_reserved(db: Session, item_id: int) -> int:
    """Units reserved on this stock record by confirmed (not yet shipped) customer orders."""
    return int(db.query(func.coalesce(func.sum(SalesOrderItem.quantity), 0)).join(SalesOrder)
               .filter(SalesOrderItem.inventory_id == item_id, SalesOrder.status.in_(RESERVED_STATUSES)).scalar())


@router.get("/products")
def products(db: Session = Depends(get_db)):
    return [{"id": p.id, "name": p.name, "category": p.category, "department": p.department, "price": p.price,
             "supplier": p.supplier.name if p.supplier else None, "supplier_id": p.supplier_id}
            for p in db.query(Product).options(joinedload(Product.supplier)).order_by(Product.name).all()]


@router.get("/inventory")
def list_inventory(db: Session = Depends(get_db)):
    return all_items(db)


@router.get("/inventory/warehouses")
def warehouses(db: Session = Depends(get_db)):
    """Warehouse-level stock monitoring."""
    out: dict = {}
    for i in all_items(db):
        w = out.setdefault(i["warehouse"], {"warehouse": i["warehouse"], "records": 0, "available_stock": 0,
                                            "reserved_stock": 0, "net_stock": 0, "on_order": 0,
                                            "High": 0, "Medium": 0, "Low": 0})
        w["records"] += 1
        for k in ("available_stock", "reserved_stock", "net_stock", "on_order"):
            w[k] += i[k]
        w[i["stockout_risk"]] += 1
    return sorted(out.values(), key=lambda w: w["warehouse"])


@router.get("/inventory/transactions")
def transactions(inventory_id: int | None = None, product_id: int | None = None,
                 txn_type: str | None = Query(None, pattern="^(RECEIVED|RESERVED|RELEASED|DISPATCHED|RETURNED|ADJUSTED)$"),
                 limit: int = Query(200, ge=1, le=1000), db: Session = Depends(get_db)):
    """Stock movement history, newest first."""
    q = db.query(InventoryTransaction, Product.name).outerjoin(Product, Product.id == InventoryTransaction.product_id)
    if inventory_id:
        q = q.filter(InventoryTransaction.inventory_id == inventory_id)
    if product_id:
        q = q.filter(InventoryTransaction.product_id == product_id)
    if txn_type:
        q = q.filter(InventoryTransaction.txn_type == txn_type)
    rows = q.order_by(InventoryTransaction.id.desc()).limit(limit).all()
    return [stock.serialize_txn(t, name) for t, name in rows]


@router.get("/inventory/template", response_class=PlainTextResponse)
def template(db: Session = Depends(get_db)):
    p = db.query(Product).first()
    pid = p.id if p else 365
    return ",".join(COLUMNS) + f"\n{pid},Central DC,500,40,420,60,7,45.5\n"


def _check_product(db, product_id):
    if not db.get(Product, product_id):
        raise HTTPException(400, f"Product {product_id} does not exist.")


def _check_duplicate(db, data: InventoryIn, exclude_id: int | None = None):
    q = db.query(InventoryItem).filter(InventoryItem.product_id == data.product_id,
                                       InventoryItem.warehouse == data.warehouse)
    if exclude_id:
        q = q.filter(InventoryItem.id != exclude_id)
    if q.first():
        raise HTTPException(409, f"Product {data.product_id} already has a stock record in {data.warehouse}.")


@router.post("/inventory", status_code=201)
def create(data: InventoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _check_product(db, data.product_id)
    _check_duplicate(db, data)
    item = InventoryItem(**data.model_dump())
    db.add(item)
    db.flush()
    stock.log_direct_edit(db, item, 0, 0, user.id)  # opening balance
    db.commit()
    db.refresh(item)
    return serialize(item)


@router.put("/inventory/{item_id}")
def update(item_id: int, data: InventoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory record not found.")
    _check_product(db, data.product_id)
    _check_duplicate(db, data, item_id)
    held = order_reserved(db, item_id)
    if held and (data.product_id != item.product_id or data.warehouse != item.warehouse):
        raise HTTPException(409, "This stock record has reservations for open orders - product and warehouse "
                                 "cannot be changed.")
    if data.reserved_stock < held:
        raise HTTPException(409, f"Reserved stock cannot be below {held} units reserved by confirmed orders.")
    old_a, old_r = item.available_stock, item.reserved_stock
    for k, v in data.model_dump().items():
        setattr(item, k, v)
    stock.log_direct_edit(db, item, old_a, old_r, user.id)
    db.commit()
    db.refresh(item)
    return serialize(item, po_quantities(db))


@router.post("/inventory/{item_id}/adjust")
def adjust(item_id: int, data: StockAdjustIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Record a stock adjustment (e.g. after a stock count, damage or loss)."""
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory record not found.")
    with transaction(db):
        stock.adjust(db, item, data.quantity_change, reference_type="manual", reference_label="Stock adjustment",
                     note=data.reason, user_id=user.id)
    db.refresh(item)
    return serialize(item, po_quantities(db))


@router.delete("/inventory/{item_id}")
def delete(item_id: int, db: Session = Depends(get_db)):
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory record not found.")
    if order_reserved(db, item_id):
        raise HTTPException(409, "This stock record has reservations for open orders and cannot be deleted.")
    db.delete(item)
    db.commit()
    return {"detail": "Inventory record deleted"}


@router.post("/inventory/upload")
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    df = await read_csv_upload(file, COLUMNS)
    valid, errors = validate_rows(df, InventoryIn, COLUMNS)
    known = {p.id for p in db.query(Product.id).all()}
    created = updated = 0
    for data in valid:
        if data.product_id not in known:
            errors.append({"row": "-", "error": f"product_id {data.product_id} does not exist in products"})
            continue
        item = db.query(InventoryItem).filter(InventoryItem.product_id == data.product_id,
                                              InventoryItem.warehouse == data.warehouse).first()
        if item:
            held = order_reserved(db, item.id)
            if data.reserved_stock < held:
                errors.append({"row": "-", "error": f"product {data.product_id} / {data.warehouse}: reserved stock "
                                                    f"cannot be below {held} (confirmed orders)"})
                continue
            updated += 1
            old_a, old_r = item.available_stock, item.reserved_stock
        else:
            item = InventoryItem()
            db.add(item)
            created += 1
            old_a = old_r = 0
        for k, v in data.model_dump().items():
            setattr(item, k, v)
        db.flush()
        stock.log_direct_edit(db, item, old_a, old_r, user.id)
    db.commit()
    return {"created": created, "updated": updated, "rejected": len(errors), "errors": errors[:25]}
