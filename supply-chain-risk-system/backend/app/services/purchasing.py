"""Purchase Order workflow and inbound logistics.

    Draft -> Approved -> Ordered -> Received
      \\________\\__________\\-> Cancelled   (any time before receipt)

* Ordered: ordered_at is set; if no expected arrival date was entered it is ordered date + the supplier's average
  lead time (rounded up).
* Received: the received quantity of each line is added to stock (RECEIVED transaction) in the PO's warehouse;
  the actual arrival date is stored, so inbound delays are OBSERVED, not predicted.
  A PO can be received only once (status check + unique movement keys); short deliveries are recorded as such.
"""
import math
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models import InventoryItem, Product, PurchaseOrder, PurchaseOrderItem, Supplier
from . import inventory_ops as stock
from .errors import WorkflowError
from .orders import today
from .planning import replenishment_plan

STATUSES = ["Draft", "Approved", "Ordered", "Received", "Cancelled"]
TRANSITIONS = {"Draft": ["Approved", "Cancelled"], "Approved": ["Ordered", "Cancelled"],
               "Ordered": ["Received", "Cancelled"], "Received": [], "Cancelled": []}


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _total(po: PurchaseOrder):
    costs = [i.unit_cost for i in po.items]
    po.total_amount = round(sum(i.quantity * i.unit_cost for i in po.items), 2) if all(
        c is not None for c in costs) else None


def create_po(db: Session, supplier_id: int, warehouse: str, items: list[tuple[int, int, float | None]],
              user_id: int | None, notes: str | None = None, expected: date | None = None,
              source: str = "manual") -> PurchaseOrder:
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise WorkflowError(f"Supplier {supplier_id} does not exist.", 404)
    if not items:
        raise WorkflowError("A purchase order needs at least one line.", 422)
    ids = [pid for pid, _, _ in items]
    if len(ids) != len(set(ids)):
        raise WorkflowError("Each product can appear only once per purchase order.", 422)
    if expected and expected < today():
        raise WorkflowError("Expected arrival date cannot be in the past.", 422)
    po = PurchaseOrder(po_number="PENDING", supplier=supplier, warehouse=warehouse.strip(), status="Draft",
                       source=source, notes=notes, expected_arrival_date=expected, created_by=user_id)
    for pid, qty, cost in items:
        product = db.get(Product, pid)
        if not product:
            raise WorkflowError(f"Product {pid} does not exist.", 404)
        if qty <= 0:
            raise WorkflowError("Quantities must be positive.", 422)
        po.items.append(PurchaseOrderItem(product=product, quantity=qty, unit_cost=cost))
    _total(po)
    db.add(po)
    db.flush()
    po.po_number = f"PO-{po.id:06d}"
    return po


def change_status(db: Session, po: PurchaseOrder, new_status: str, user_id: int | None,
                  expected: date | None = None) -> PurchaseOrder:
    if new_status not in STATUSES:
        raise WorkflowError(f"Unknown status '{new_status}'.", 422)
    if new_status == "Received":
        raise WorkflowError("Use the receive action to record received quantities.", 422)
    if new_status not in TRANSITIONS[po.status]:
        allowed = ", ".join(TRANSITIONS[po.status]) or "none (final status)"
        raise WorkflowError(f"Cannot change {po.po_number} from {po.status} to {new_status}. Allowed: {allowed}.")
    if new_status == "Approved":
        po.approved_at = _now()
    elif new_status == "Ordered":
        po.ordered_at = _now()
        if expected:
            if expected < po.ordered_at.date():
                raise WorkflowError("Expected arrival date cannot be before the order date.", 422)
            po.expected_arrival_date = expected
        elif po.expected_arrival_date is None:
            po.expected_arrival_date = po.ordered_at.date() + timedelta(days=math.ceil(po.supplier.avg_lead_time_days))
    po.status = new_status
    return po


def receive(db: Session, po: PurchaseOrder, received: dict[int, int] | None, arrival: date | None,
            user_id: int | None) -> PurchaseOrder:
    """received = {po_item_id: quantity}; missing lines default to the full ordered quantity."""
    if po.status != "Ordered":
        raise WorkflowError(f"Only purchase orders with status Ordered can be received ({po.po_number} is "
                            f"{po.status}).")
    arrival = arrival or today()
    if po.ordered_at and arrival < po.ordered_at.date():
        raise WorkflowError("Arrival date cannot be before the order date.", 422)
    if arrival > today():
        raise WorkflowError("Arrival date cannot be in the future.", 422)
    received = received or {}
    unknown = set(received) - {i.id for i in po.items}
    if unknown:
        raise WorkflowError(f"Line(s) {sorted(unknown)} do not belong to {po.po_number}.", 422)
    total_units = 0
    for item in po.items:
        qty = received.get(item.id, item.quantity)
        if qty < 0 or qty > item.quantity:
            raise WorkflowError(f"Received quantity for {item.product.name} must be between 0 and {item.quantity}.",
                                422)
        item.received_quantity = qty
        total_units += qty
        if qty == 0:
            continue
        inv = db.query(InventoryItem).filter(InventoryItem.product_id == item.product_id,
                                             InventoryItem.warehouse == po.warehouse).first()
        if inv is None:  # first delivery of this product to this warehouse -> new stock location
            inv = InventoryItem(product_id=item.product_id, warehouse=po.warehouse, available_stock=0,
                                reserved_stock=0, reorder_level=0, safety_stock=0,
                                lead_time_days=max(1, math.ceil(po.supplier.avg_lead_time_days)), avg_daily_demand=0)
            db.add(inv)
            db.flush()
        stock.receive(db, inv, qty, reference_type="purchase_order", reference_id=po.id,
                      reference_label=po.po_number, key=f"PO{po.id}-L{item.id}-RECEIVE", user_id=user_id,
                      note=f"Received from {po.supplier.name}")
    if total_units == 0:
        raise WorkflowError("Nothing was received - enter at least one quantity, or cancel the purchase order.", 422)
    po.actual_arrival_date, po.received_at, po.status = arrival, _now(), "Received"
    return po


def generate_from_plan(db: Session, user_id: int | None, inventory_ids: list[int] | None = None) -> list[PurchaseOrder]:
    """Turn replenishment recommendations into DRAFT purchase orders, one per (recommended supplier, warehouse).
    Lines that already have a draft PO, or no recommended supplier, are skipped."""
    plans = [p for p in replenishment_plan(db) if p["replenishment_qty"] > 0 and not p["draft_po_qty"]
             and p["recommended_supplier"] and (inventory_ids is None or p["inventory_id"] in inventory_ids)]
    groups: dict = {}
    for p in plans:
        groups.setdefault((p["recommended_supplier"]["supplier_id"], p["warehouse"]), []).append(p)
    created = []
    for (sid, wh), lines in groups.items():
        note = "Generated from reorder recommendations: " + "; ".join(
            f"{l['product_name']} ({l['stockout_risk']} stockout risk, cover {l['days_of_cover']} d)" for l in lines)
        created.append(create_po(db, sid, wh, [(l["product_id"], l["replenishment_qty"], None) for l in lines],
                                 user_id, notes=note, source="reorder_recommendation"))
    return created


def inbound_state(po: PurchaseOrder) -> dict:
    """Observed inbound delay: received after the expected date, or still not received after it."""
    if po.expected_arrival_date is None or po.status in ("Draft", "Approved", "Cancelled"):
        return {"is_delayed": False, "days_late": 0}
    ref = po.actual_arrival_date or today()
    days = (ref - po.expected_arrival_date).days
    return {"is_delayed": days > 0, "days_late": max(days, 0)}


def serialize_po(po: PurchaseOrder, detail: bool = False) -> dict:
    d = {"id": po.id, "po_number": po.po_number, "status": po.status, "source": po.source,
         "supplier_id": po.supplier_id, "supplier_name": po.supplier.name, "supplier_code": po.supplier.supplier_code,
         "supplier_risk_level": po.supplier.risk_level, "supplier_risk_score": po.supplier.risk_score,
         "warehouse": po.warehouse, "line_count": len(po.items), "units": sum(i.quantity for i in po.items),
         "received_units": sum(i.received_quantity for i in po.items), "total_amount": po.total_amount,
         "expected_arrival_date": po.expected_arrival_date, "actual_arrival_date": po.actual_arrival_date,
         "approved_at": po.approved_at, "ordered_at": po.ordered_at, "received_at": po.received_at,
         "created_at": po.created_at, "allowed_transitions": TRANSITIONS[po.status], **inbound_state(po)}
    if detail:
        d["notes"] = po.notes
        d["items"] = [{"id": i.id, "product_id": i.product_id, "product_name": i.product.name,
                       "category": i.product.category, "quantity": i.quantity, "received_quantity": i.received_quantity,
                       "unit_cost": i.unit_cost} for i in po.items]
    return d
