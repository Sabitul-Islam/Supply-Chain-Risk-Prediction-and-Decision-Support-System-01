"""Returns management (reverse logistics).

    Requested -> Approved -> Received -> Inspected -> Restocked
        \\__________\\_________\\-> Rejected

* A return can only be raised for a Delivered order, for at most the delivered quantity minus units already in
  other (non-rejected) returns.
* Inspection records an outcome. Only the outcome "Restock" allows the final Restocked status, which adds the units
  back to the warehouse they were shipped from (RETURNED stock movement). Other outcomes end at Inspected.
"""
from sqlalchemy.orm import Session

from ..models import InventoryItem, ProductReturn, ReturnItem, SalesOrder, SalesOrderItem
from . import inventory_ops as stock
from .errors import WorkflowError
from .orders import returned_quantities

STATUSES = ["Requested", "Approved", "Received", "Inspected", "Restocked", "Rejected"]
TRANSITIONS = {"Requested": ["Approved", "Rejected"], "Approved": ["Received", "Rejected"],
               "Received": ["Inspected", "Rejected"], "Inspected": ["Restocked"], "Restocked": [], "Rejected": []}
OUTCOMES = ["Restock", "Dispose - damaged", "Return to supplier - defective"]


def create_return(db: Session, order_id: int, reason: str, lines: list[tuple[int, int]],
                  user_id: int | None) -> ProductReturn:
    order = db.get(SalesOrder, order_id)
    if not order:
        raise WorkflowError(f"Order {order_id} does not exist.", 404)
    if order.status != "Delivered":
        raise WorkflowError(f"Returns can only be registered for delivered orders ({order.order_number} is "
                            f"{order.status}).")
    if not lines:
        raise WorkflowError("Select at least one product to return.", 422)
    ids = [i for i, _ in lines]
    if len(ids) != len(set(ids)):
        raise WorkflowError("Each order line can appear only once per return.", 422)
    already = returned_quantities(order)
    r = ProductReturn(rma_number="PENDING", sales_order=order, reason=reason.strip(), status="Requested",
                      created_by=user_id)
    for item_id, qty in lines:
        oi = db.get(SalesOrderItem, item_id)
        if not oi or oi.order_id != order.id:
            raise WorkflowError(f"Order line {item_id} does not belong to {order.order_number}.", 422)
        returnable = oi.quantity - already.get(oi.id, 0)
        if qty <= 0 or qty > returnable:
            raise WorkflowError(f"Return quantity for {oi.product.name} must be between 1 and {returnable} "
                                f"(delivered {oi.quantity}, already returned {already.get(oi.id, 0)}).", 422)
        r.items.append(ReturnItem(order_item=oi, product_id=oi.product_id, quantity=qty))
    db.add(r)
    db.flush()
    r.rma_number = f"RMA-{r.id:06d}"
    return r


def change_status(db: Session, r: ProductReturn, new_status: str, user_id: int | None, outcome: str | None = None,
                  notes: str | None = None) -> ProductReturn:
    if new_status not in STATUSES:
        raise WorkflowError(f"Unknown status '{new_status}'.", 422)
    if new_status not in TRANSITIONS[r.status]:
        allowed = ", ".join(TRANSITIONS[r.status]) or "none (final status)"
        raise WorkflowError(f"Cannot change {r.rma_number} from {r.status} to {new_status}. Allowed: {allowed}.")
    if new_status == "Inspected":
        if outcome not in OUTCOMES:
            raise WorkflowError(f"An inspection outcome is required: {', '.join(OUTCOMES)}.", 422)
        r.inspection_outcome = outcome
    if notes:
        r.inspection_notes = notes
    if new_status == "Restocked":
        if r.inspection_outcome != "Restock":
            raise WorkflowError(f"Only returns inspected as 'Restock' can be restocked (outcome: "
                                f"{r.inspection_outcome}).")
        for ri in r.items:
            inv = ri.order_item.inventory or db.query(InventoryItem).filter(
                InventoryItem.product_id == ri.product_id).first()
            if inv is None:
                raise WorkflowError(f"No stock location exists for {ri.product.name}.")
            stock.restock_return(db, inv, ri.quantity, reference_type="return", reference_id=r.id,
                                 reference_label=r.rma_number, key=f"RMA{r.id}-L{ri.id}-RESTOCK", user_id=user_id,
                                 note=f"Return from {r.sales_order.order_number}")
            ri.restocked_quantity = ri.quantity
    r.status = new_status
    return r


def serialize_return(r: ProductReturn, detail: bool = False) -> dict:
    d = {"id": r.id, "rma_number": r.rma_number, "status": r.status, "reason": r.reason,
         "sales_order_id": r.sales_order_id, "order_number": r.sales_order.order_number,
         "customer_name": r.sales_order.customer.name, "units": sum(i.quantity for i in r.items),
         "restocked_units": sum(i.restocked_quantity for i in r.items), "inspection_outcome": r.inspection_outcome,
         "inspection_notes": r.inspection_notes, "created_at": r.created_at, "updated_at": r.updated_at,
         "allowed_transitions": [t for t in TRANSITIONS[r.status]
                                 if t != "Restocked" or r.inspection_outcome == "Restock"]}
    if detail:
        d["items"] = [{"id": i.id, "order_item_id": i.order_item_id, "product_id": i.product_id,
                       "product_name": i.product.name, "quantity": i.quantity,
                       "restocked_quantity": i.restocked_quantity,
                       "warehouse": i.order_item.inventory.warehouse if i.order_item.inventory else None}
                      for i in r.items]
    return d
