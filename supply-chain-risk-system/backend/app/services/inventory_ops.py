"""Inventory transaction policy - the ONLY place where stock quantities change.

Stock model (per product + warehouse inventory record):
    available_stock = units physically on hand
    reserved_stock  = part of the on-hand units promised to confirmed customer orders
    net stock       = available - reserved  (what can still be promised)

Policy
    RECEIVED    purchase order receipt          available + q
    RESERVED    sales order confirmed           reserved  + q   (only if net stock >= q)
    RELEASED    confirmed order cancelled       reserved  - q
    DISPATCHED  sales order shipped             available - q and reserved - q (stock leaves the warehouse)
    RETURNED    approved return restocked       available + q
    ADJUSTED    manual correction / stock count available +/- q (never below reserved or zero)

Every change is written as an atomic conditional UPDATE (so two requests can never over-reserve the same stock and
quantities can never become negative) plus one InventoryTransaction row. The transaction's unique idempotency key
stops the same business event (e.g. receiving the same PO line twice) from moving stock twice.
Callers commit the session; on any error they roll back, so stock and the transaction log always stay consistent.
"""
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..models import InventoryItem, InventoryTransaction

TXN_TYPES = ["RECEIVED", "RESERVED", "RELEASED", "DISPATCHED", "RETURNED", "ADJUSTED"]


class StockError(ValueError):
    """Raised when a stock movement would break an inventory rule (e.g. insufficient stock)."""


def _key_used(db: Session, key: str | None) -> bool:
    return key is not None and db.query(InventoryTransaction.id).filter(
        InventoryTransaction.idempotency_key == key).first() is not None


def _move(db: Session, item: InventoryItem, txn_type: str, quantity: int, available_change: int,
          reserved_change: int, condition, error: str, *, reference_type=None, reference_id=None,
          reference_label=None, key=None, note=None, user_id=None) -> InventoryTransaction:
    if _key_used(db, key):
        raise StockError(f"Duplicate stock movement: {txn_type} for {reference_label or key} was already recorded.")
    db.flush()  # make sure pending ORM changes are written before the conditional update
    res = db.execute(update(InventoryItem)
                     .where(InventoryItem.id == item.id, condition)
                     .values(available_stock=InventoryItem.available_stock + available_change,
                             reserved_stock=InventoryItem.reserved_stock + reserved_change)
                     .execution_options(synchronize_session=False))
    if res.rowcount != 1:
        db.refresh(item)
        raise StockError(error.format(net=item.available_stock - item.reserved_stock, reserved=item.reserved_stock,
                                      available=item.available_stock))
    db.refresh(item)
    txn = InventoryTransaction(inventory_id=item.id, product_id=item.product_id, warehouse=item.warehouse,
                               txn_type=txn_type, quantity=quantity, available_change=available_change,
                               reserved_change=reserved_change, available_after=item.available_stock,
                               reserved_after=item.reserved_stock, reference_type=reference_type,
                               reference_id=reference_id, reference_label=reference_label, idempotency_key=key,
                               note=note, created_by=user_id)
    db.add(txn)
    return txn


def _positive(q: int):
    if q is None or q <= 0:
        raise StockError("Quantity must be a positive whole number.")


def reserve(db, item, q, **ref):
    _positive(q)
    return _move(db, item, "RESERVED", q, 0, q,
                 InventoryItem.available_stock - InventoryItem.reserved_stock >= q,
                 f"Insufficient stock: requested {q}, only {{net}} unreserved units available.", **ref)


def release(db, item, q, **ref):
    _positive(q)
    return _move(db, item, "RELEASED", q, 0, -q, InventoryItem.reserved_stock >= q,
                 f"Cannot release {q} units: only {{reserved}} reserved.", **ref)


def dispatch(db, item, q, **ref):
    """Reserved units leave the warehouse."""
    _positive(q)
    return _move(db, item, "DISPATCHED", q, -q, -q,
                 (InventoryItem.reserved_stock >= q) & (InventoryItem.available_stock >= q),
                 f"Cannot dispatch {q} units: only {{reserved}} reserved / {{available}} on hand.", **ref)


def receive(db, item, q, **ref):
    _positive(q)
    return _move(db, item, "RECEIVED", q, q, 0, InventoryItem.id == item.id, "Receipt failed.", **ref)


def restock_return(db, item, q, **ref):
    _positive(q)
    return _move(db, item, "RETURNED", q, q, 0, InventoryItem.id == item.id, "Restock failed.", **ref)


def adjust(db, item, change: int, **ref):
    """Manual correction of on-hand stock (e.g. after a stock count). Cannot drop below reserved stock or zero."""
    if not change:
        raise StockError("Adjustment quantity must not be zero.")
    return _move(db, item, "ADJUSTED", change, change, 0,
                 (InventoryItem.available_stock + change >= InventoryItem.reserved_stock)
                 & (InventoryItem.available_stock + change >= 0),
                 f"Adjustment of {change} would leave on-hand stock below reserved stock ({{reserved}}) or below zero "
                 f"(on hand {{available}}).", **ref)


def log_direct_edit(db, item, old_available: int, old_reserved: int, user_id=None):
    """The inventory edit form changes quantities directly - record it so the movement history stays complete."""
    da, dr = item.available_stock - old_available, item.reserved_stock - old_reserved
    if da or dr:
        db.add(InventoryTransaction(inventory_id=item.id, product_id=item.product_id, warehouse=item.warehouse,
                                    txn_type="ADJUSTED", quantity=da, available_change=da, reserved_change=dr,
                                    available_after=item.available_stock, reserved_after=item.reserved_stock,
                                    reference_type="manual", reference_label="Record edit",
                                    note="Quantities edited on the inventory record", created_by=user_id))


def serialize_txn(t: InventoryTransaction, product_name: str | None = None) -> dict:
    return {"id": t.id, "inventory_id": t.inventory_id, "product_id": t.product_id, "product_name": product_name,
            "warehouse": t.warehouse, "txn_type": t.txn_type, "quantity": t.quantity,
            "available_change": t.available_change, "reserved_change": t.reserved_change,
            "available_after": t.available_after, "reserved_after": t.reserved_after,
            "reference_type": t.reference_type, "reference_id": t.reference_id,
            "reference_label": t.reference_label, "note": t.note, "created_at": t.created_at}
