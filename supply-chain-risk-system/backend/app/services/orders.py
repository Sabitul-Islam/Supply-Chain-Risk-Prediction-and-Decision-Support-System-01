"""Order Management and Fulfilment workflow.

    Pending -> Confirmed -> Processing -> Ready for Shipment -> Shipped -> Delivered
       \\________\\____________\\_______________\\-> Cancelled   (any time before shipment)

Inventory effects (see services/inventory_ops.py):
    create      stock is CHECKED (an order larger than the unreserved stock is rejected) but not reserved
    Confirmed   stock RESERVED from one warehouse per line, outbound shipment created and scored by the ML model
    Cancelled   reservations RELEASED (only if the order had been confirmed), shipment cancelled
    Shipped     reserved stock DISPATCHED (deducted from on-hand stock), shipment In Transit
    Delivered   actual delivery date recorded, compared with the expected date (order date + scheduled days)

Late-delivery prediction: the DataCo Random Forest scores every order line with the information it was trained on
(payment type, shipping mode, scheduled days, market, region, category, department, customer segment, quantity,
price, discount, sales, order date). The lines of an order travel together, so the shipment takes the HIGHEST line
probability (a conservative choice). The model predicts the probability of late delivery only - nothing else.
"""
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..ml.features import SHIPMENT_THRESHOLDS, risk_level, shipment_recommendation
from ..ml.predictor import ModelNotAvailable, predict_shipments, shipment_options
from ..models import InventoryItem, Product, SalesOrder, SalesOrderItem, Shipment, ShipmentEvent
from . import inventory_ops as stock
from .errors import WorkflowError

log = logging.getLogger(__name__)

STATUSES = ["Pending", "Confirmed", "Processing", "Ready for Shipment", "Shipped", "Delivered", "Cancelled"]
TRANSITIONS = {
    "Pending": ["Confirmed", "Cancelled"],
    "Confirmed": ["Processing", "Cancelled"],
    "Processing": ["Ready for Shipment", "Cancelled"],
    "Ready for Shipment": ["Shipped", "Cancelled"],
    "Shipped": ["Delivered"],
    "Delivered": [],
    "Cancelled": [],
}
RESERVED_STATUSES = ("Confirmed", "Processing", "Ready for Shipment")  # stock is reserved in these states
OPEN_STATUSES = ("Pending", "Confirmed", "Processing", "Ready for Shipment", "Shipped")
DEFAULT_SCHEDULED_DAYS = {"Standard Class": 4, "Second Class": 2, "First Class": 1, "Same Day": 0}


def today() -> date:
    return datetime.now(timezone.utc).date()


def scheduled_days(mode: str) -> int:
    days = shipment_options().get("scheduled_days_by_mode", {}).get(mode)
    return int(days[0]) if days else DEFAULT_SCHEDULED_DAYS.get(mode, 4)


def validate_shipping(payment_type: str, shipping_mode: str):
    opts = shipment_options()
    for key, value in (("payment_type", payment_type), ("shipping_mode", shipping_mode)):
        allowed = opts.get(key) or (list(DEFAULT_SCHEDULED_DAYS) if key == "shipping_mode" else None)
        if allowed and value not in allowed:
            raise WorkflowError(f"{key.replace('_', ' ')} '{value}' is not valid. Allowed: {', '.join(allowed)}", 422)


def pick_inventory(db: Session, product_id: int, quantity: int) -> InventoryItem:
    """Fulfil each line from the single warehouse with the most unreserved stock."""
    items = db.query(InventoryItem).filter(InventoryItem.product_id == product_id).all()
    if not items:
        raise WorkflowError(f"Product {product_id} is not stocked in any warehouse.", 409)
    best = max(items, key=lambda i: i.available_stock - i.reserved_stock)
    net = best.available_stock - best.reserved_stock
    if net < quantity:
        raise WorkflowError(f"Insufficient stock for '{best.product.name}': requested {quantity}, "
                            f"only {max(net, 0)} unreserved units available ({best.warehouse}).", 409)
    return best


# ---------------------------------------------------------------- ML scoring
def _feature_row(order: SalesOrder, item: SalesOrderItem) -> dict:
    return {"order_date": order.order_date, "payment_type": order.payment_type, "shipping_mode": order.shipping_mode,
            "scheduled_shipping_days": order.scheduled_shipping_days, "market": order.customer.market,
            "order_region": order.customer.order_region, "category_name": item.product.category,
            "department_name": item.product.department, "customer_segment": order.customer.segment,
            "quantity": item.quantity, "product_price": item.unit_price, "discount_rate": order.discount_rate,
            "sales": round(item.quantity * item.unit_price, 2)}


def score_order(order: SalesOrder) -> list[dict] | None:
    """Late-delivery probability for every order line (None if the model file is missing)."""
    try:
        res = predict_shipments([_feature_row(order, i) for i in order.items])
    except ModelNotAvailable as e:
        log.warning("Order %s not scored: %s", order.order_number, e)
        for i in order.items:
            i.late_probability = None
        return None
    for i, r in zip(order.items, res):
        i.late_probability = r["probability"]
    return res


def _apply_prediction(order: SalesOrder, shipment: Shipment):
    res = score_order(order)
    worst = max(order.items, key=lambda i: i.late_probability or 0)
    row = _feature_row(order, worst)
    shipment.product_id, shipment.category_name, shipment.department_name = (worst.product_id, row["category_name"],
                                                                             row["department_name"])
    shipment.shipping_mode, shipment.scheduled_shipping_days = order.shipping_mode, order.scheduled_shipping_days
    shipment.quantity = sum(i.quantity for i in order.items)
    shipment.product_price = worst.unit_price
    shipment.sales = round(sum(i.quantity * i.unit_price for i in order.items), 2)
    shipment.expected_delivery_date = order.order_date.date() + timedelta(days=order.scheduled_shipping_days)
    if res is None:
        shipment.late_probability = shipment.predicted_late = shipment.risk_level = None
        shipment.recommendation = "Late-delivery model not available - run python -m app.ml.train."
        return
    p = max(r["probability"] for r in res)
    level = risk_level(p, SHIPMENT_THRESHOLDS)
    shipment.late_probability, shipment.predicted_late, shipment.risk_level = p, p >= 0.5, level
    note = f" (highest of {len(res)} order lines)" if len(res) > 1 else ""
    shipment.recommendation = shipment_recommendation(level, row) + note


def _event(db, shipment, status, note, user_id):
    db.add(ShipmentEvent(shipment=shipment, status=status, note=note, created_by=user_id))


def order_shipment(order: SalesOrder) -> Shipment | None:
    return order.shipments[0] if order.shipments else None


# ---------------------------------------------------------------- create / status / shipping mode
def create_order(db: Session, data, user_id: int | None) -> SalesOrder:
    from ..models import Customer
    customer = db.get(Customer, data.customer_id)
    if not customer:
        raise WorkflowError(f"Customer {data.customer_id} does not exist.", 404)
    validate_shipping(data.payment_type, data.shipping_mode)
    ids = [i.product_id for i in data.items]
    if len(ids) != len(set(ids)):
        raise WorkflowError("Each product can appear only once per order - combine the quantities into one line.", 422)
    order = SalesOrder(customer=customer, status="Pending",
                       order_date=(data.order_date or datetime.now(timezone.utc)).replace(tzinfo=None, microsecond=0),
                       payment_type=data.payment_type, shipping_mode=data.shipping_mode,
                       scheduled_shipping_days=scheduled_days(data.shipping_mode), discount_rate=data.discount_rate,
                       notes=data.notes, created_by=user_id, order_number="PENDING")
    total = 0.0
    for line in data.items:
        product = db.get(Product, line.product_id)
        if not product:
            raise WorkflowError(f"Product {line.product_id} does not exist.", 404)
        pick_inventory(db, product.id, line.quantity)  # availability check only - reservation happens on confirm
        price = round(float(product.price), 2)
        line_total = round(line.quantity * price * (1 - data.discount_rate), 2)
        order.items.append(SalesOrderItem(product=product, quantity=line.quantity, unit_price=price,
                                          line_total=line_total))
        total += line_total
    order.total_amount = round(total, 2)
    db.add(order)
    db.flush()
    order.order_number = f"SO-{order.id:06d}"
    score_order(order)
    return order


def change_status(db: Session, order: SalesOrder, new_status: str, user_id: int | None, note: str | None = None,
                  delivery_date: date | None = None) -> SalesOrder:
    old = order.status
    if new_status not in STATUSES:
        raise WorkflowError(f"Unknown status '{new_status}'.", 422)
    if new_status not in TRANSITIONS[old]:
        allowed = ", ".join(TRANSITIONS[old]) or "none (final status)"
        raise WorkflowError(f"Cannot change order {order.order_number} from {old} to {new_status}. "
                            f"Allowed next status: {allowed}.")
    ref = lambda i, suffix: {"reference_type": "sales_order", "reference_id": order.id,  # noqa: E731
                             "reference_label": order.order_number, "user_id": user_id,
                             "key": f"SO{order.id}-L{i.id}-{suffix}"}
    shipment = order_shipment(order)

    if new_status == "Confirmed":
        for i in order.items:
            inv = pick_inventory(db, i.product_id, i.quantity)
            i.inventory_id = inv.id
            stock.reserve(db, inv, i.quantity, **ref(i, "RESERVE"))
        shipment = Shipment(order_id=order.order_number, order_date=order.order_date, source="order",
                            sales_order=order, status="Planned", market=order.customer.market,
                            order_region=order.customer.order_region, customer_segment=order.customer.segment,
                            payment_type=order.payment_type, discount_rate=order.discount_rate,
                            category_name="", department_name="", shipping_mode=order.shipping_mode,
                            scheduled_shipping_days=order.scheduled_shipping_days, quantity=0, product_price=0, sales=0)
        db.add(shipment)
        _apply_prediction(order, shipment)
        _event(db, shipment, "Planned", f"Order confirmed, stock reserved. Predicted late-delivery probability "
               f"{_pct(shipment.late_probability)} ({shipment.risk_level or 'n/a'} risk).", user_id)

    elif new_status == "Cancelled":
        if old in RESERVED_STATUSES:
            for i in order.items:
                if i.inventory is None:
                    raise WorkflowError(f"Stock location of line {i.product.name} no longer exists - "
                                        "adjust stock manually.")
                stock.release(db, i.inventory, i.quantity, **ref(i, "RELEASE"))
        order.cancel_reason = note
        if shipment:
            shipment.status = "Cancelled"
            _event(db, shipment, "Cancelled", note or "Order cancelled.", user_id)

    elif new_status == "Shipped":
        for i in order.items:
            if i.inventory is None:
                raise WorkflowError(f"Stock location of line {i.product.name} no longer exists.")
            stock.dispatch(db, i.inventory, i.quantity, **ref(i, "DISPATCH"))
        shipment.status, shipment.shipped_at = "In Transit", datetime.now(timezone.utc).replace(tzinfo=None)
        _event(db, shipment, "In Transit", note or f"Dispatched via {order.shipping_mode}. Expected delivery "
               f"{shipment.expected_delivery_date}.", user_id)

    elif new_status == "Delivered":
        d = delivery_date or today()
        if d < order.order_date.date():
            raise WorkflowError("Delivery date cannot be before the order date.", 422)
        if d > today():
            raise WorkflowError("Delivery date cannot be in the future.", 422)
        shipment.status, shipment.actual_delivery_date = "Delivered", d
        shipment.actual_late = d > shipment.expected_delivery_date
        _event(db, shipment, "Delivered", (note or "") + (" Delivered late." if shipment.actual_late
                                                          else " Delivered on time."), user_id)
    else:  # Processing / Ready for Shipment
        if shipment:
            _event(db, shipment, new_status, note or f"Order is {new_status.lower()}.", user_id)

    order.status = new_status
    return order


def change_shipping_mode(db: Session, order: SalesOrder, mode: str, user_id: int | None) -> SalesOrder:
    """Preventive action: change the shipping mode before dispatch and re-score the order with the model."""
    if order.status not in ("Pending",) + RESERVED_STATUSES:
        raise WorkflowError(f"The shipping mode can only be changed before shipment (order is {order.status}).")
    validate_shipping(order.payment_type, mode)
    shipment = order_shipment(order)
    before = shipment.late_probability if shipment else None
    old = order.shipping_mode
    order.shipping_mode, order.scheduled_shipping_days = mode, scheduled_days(mode)
    if shipment:
        _apply_prediction(order, shipment)
        _event(db, shipment, shipment.status, f"Shipping mode changed from {old} to {mode}. Late-delivery "
               f"probability {_pct(before)} -> {_pct(shipment.late_probability)}.", user_id)
    else:
        score_order(order)
    return order


# ---------------------------------------------------------------- read models
def _pct(p):
    return "n/a" if p is None else f"{p * 100:.1f}%"


def shipment_delay_state(s: Shipment | None) -> dict:
    """Observed delay (not a prediction): delivered after the expected date, or still open after it."""
    if s is None or s.expected_delivery_date is None:
        return {"is_delayed": False, "days_late": 0}
    if s.status == "Cancelled":
        return {"is_delayed": False, "days_late": 0}
    ref_day = s.actual_delivery_date or today()
    days = (ref_day - s.expected_delivery_date).days
    return {"is_delayed": days > 0, "days_late": max(days, 0)}


def serialize_shipment(s: Shipment | None, with_events: bool = False) -> dict | None:
    if s is None:
        return None
    d = {"id": s.id, "shipment_code": f"SHP-{s.id:06d}", "status": s.status, "shipping_mode": s.shipping_mode,
         "scheduled_shipping_days": s.scheduled_shipping_days, "late_probability": s.late_probability,
         "predicted_late": s.predicted_late, "risk_level": s.risk_level, "recommendation": s.recommendation,
         "shipped_at": s.shipped_at, "expected_delivery_date": s.expected_delivery_date,
         "actual_delivery_date": s.actual_delivery_date, "delivered_late": s.actual_late if s.status == "Delivered" else None,
         **shipment_delay_state(s)}
    if with_events:
        d["events"] = [{"status": e.status, "note": e.note, "created_at": e.created_at} for e in s.events]
    return d


def returned_quantities(order: SalesOrder) -> dict:
    """{order_item_id: units in non-rejected returns}"""
    out: dict = {}
    for r in order.returns:
        if r.status == "Rejected":
            continue
        for ri in r.items:
            out[ri.order_item_id] = out.get(ri.order_item_id, 0) + ri.quantity
    return out


def serialize_order(o: SalesOrder, detail: bool = False) -> dict:
    s = order_shipment(o)
    d = {"id": o.id, "order_number": o.order_number, "status": o.status, "order_date": o.order_date,
         "customer_id": o.customer_id, "customer_name": o.customer.name, "customer_segment": o.customer.segment,
         "market": o.customer.market, "order_region": o.customer.order_region, "payment_type": o.payment_type,
         "shipping_mode": o.shipping_mode, "scheduled_shipping_days": o.scheduled_shipping_days,
         "discount_rate": o.discount_rate, "total_amount": o.total_amount,
         "item_count": len(o.items), "units": sum(i.quantity for i in o.items),
         "late_probability": max((i.late_probability for i in o.items if i.late_probability is not None),
                                 default=None),
         "shipment": serialize_shipment(s, with_events=detail), "allowed_transitions": TRANSITIONS[o.status],
         "can_change_shipping_mode": o.status in ("Pending",) + RESERVED_STATUSES,
         "created_at": o.created_at}
    d["risk_level"] = (s.risk_level if s else None) or (risk_level(d["late_probability"], SHIPMENT_THRESHOLDS)
                                                       if d["late_probability"] is not None else None)
    if detail:
        returned = returned_quantities(o)
        d.update({"notes": o.notes, "cancel_reason": o.cancel_reason,
                  "items": [{"id": i.id, "product_id": i.product_id, "product_name": i.product.name,
                             "category": i.product.category, "quantity": i.quantity, "unit_price": i.unit_price,
                             "line_total": i.line_total, "late_probability": i.late_probability,
                             "warehouse": i.inventory.warehouse if i.inventory else None,
                             "returned_quantity": returned.get(i.id, 0),
                             "returnable_quantity": (i.quantity - returned.get(i.id, 0)) if o.status == "Delivered"
                             else 0} for i in o.items],
                  "returns": [{"id": r.id, "rma_number": r.rma_number, "status": r.status} for r in o.returns]})
    return d
