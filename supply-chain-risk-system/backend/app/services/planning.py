"""Inventory planning: connects Demand Forecasting -> Inventory -> Procurement (supplier selection).

All rules are transparent and documented here and in the README.

1. Planning demand rate (units/day) for an inventory record
       historical rate = avg_daily_demand on the inventory record (real DataCo order history)
       forecast rate   = next-month SES forecast for the product / 30.4 days (services/demand.py)
       planning rate   = max(historical rate, forecast rate)      -> never plans below either estimate
   If no forecast is available (short history), the historical rate is used.

2. Demand-plan gap = (forecast rate - historical rate) / historical rate x 100
       > +20 %  High   (demand is expected to run well above the rate the reorder level was set with)
       > +5 %   Medium
       else     Low

3. Replenishment quantity (only when the stockout risk from services/risk.py is Medium or High)
       inventory position = net stock + open purchase-order quantity (Approved / Ordered, not yet received)
       quantity = max(0, ceil(reorder level + planning rate x 30-day review period - inventory position))

4. Supplier selection score (0-100, higher is better) among suppliers of the product's department
       selection = 0.7 x (100 - supplier risk score) + 0.3 x lead-time score
       lead-time score = 100 x shortest candidate lead time / this supplier's lead time
   High-risk suppliers are ranked after all Low/Medium suppliers.
"""
import math
from functools import lru_cache

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..models import InventoryItem, Product, PurchaseOrder, PurchaseOrderItem, Supplier
from . import demand
from .risk import REVIEW_PERIOD_DAYS, inventory_risk

DAYS_PER_MONTH = 30.4
SELECTION_WEIGHTS = {"risk": 0.7, "lead_time": 0.3}
GAP_THRESHOLDS = (5, 20)
OPEN_PO_STATUSES = ("Approved", "Ordered")
ACTIVE_PO_STATUSES = ("Draft", "Approved", "Ordered")


@lru_cache(maxsize=512)
def _product_forecast(product_id: int):
    """Next-month forecast (cached: the demand data is static between restarts)."""
    try:
        res = demand.product_forecast(product_id, 3)
    except demand.DemandDataMissing:
        return None
    return res if res and res.get("available") else None


def clear_cache():
    _product_forecast.cache_clear()


def demand_rates(item: InventoryItem) -> dict:
    fc = _product_forecast(item.product_id)
    hist = float(item.avg_daily_demand or 0)
    if fc is None:
        return {"historical_daily": hist, "forecast_daily": None, "planning_daily": hist, "gap_pct": None,
                "demand_risk": None, "forecast_months": None, "forecast_method": None}
    f_daily = round(fc["forecast"][0]["forecast"] / DAYS_PER_MONTH, 2)
    gap = round((f_daily - hist) / hist * 100, 1) if hist > 0 else None
    lo, hi = GAP_THRESHOLDS
    level = None if gap is None else ("High" if gap > hi else "Medium" if gap > lo else "Low")
    return {"historical_daily": hist, "forecast_daily": f_daily, "planning_daily": max(hist, f_daily),
            "gap_pct": gap, "demand_risk": level,
            "forecast_months": [{"month": r["month"], "forecast": r["forecast"], "lower": r["lower"],
                                 "upper": r["upper"]} for r in fc["forecast"]],
            "forecast_method": fc["method"]}


def po_quantities(db: Session) -> dict:
    """{(product_id, warehouse): {"on_order": units in Approved/Ordered POs, "draft": units in Draft POs}}"""
    rows = (db.query(PurchaseOrderItem.product_id, PurchaseOrder.warehouse, PurchaseOrder.status,
                     func.sum(PurchaseOrderItem.quantity - PurchaseOrderItem.received_quantity))
            .join(PurchaseOrder).filter(PurchaseOrder.status.in_(ACTIVE_PO_STATUSES))
            .group_by(PurchaseOrderItem.product_id, PurchaseOrder.warehouse, PurchaseOrder.status).all())
    out: dict = {}
    for pid, wh, status, qty in rows:
        d = out.setdefault((pid, wh), {"on_order": 0, "draft": 0})
        d["draft" if status == "Draft" else "on_order"] += int(qty or 0)
    return out


def rank_suppliers(db: Session, product: Product, days_of_cover: float | None = None) -> list[dict]:
    """Candidate suppliers for a product, best first (see rule 4 in the module docstring)."""
    cands = {s.id: s for s in db.query(Supplier).filter(Supplier.category == product.department).all()}
    if product.supplier:
        cands[product.supplier.id] = product.supplier
    if not cands:
        return []
    shortest = min(s.avg_lead_time_days for s in cands.values())
    out = []
    for s in cands.values():
        lead_score = 100 * shortest / s.avg_lead_time_days if s.avg_lead_time_days else 0
        score = round(SELECTION_WEIGHTS["risk"] * (100 - s.risk_score) + SELECTION_WEIGHTS["lead_time"] * lead_score, 1)
        warnings = []
        if s.risk_level == "High":
            warnings.append("High supplier risk")
        if days_of_cover is not None and s.avg_lead_time_days > days_of_cover:
            warnings.append(f"Lead time {s.avg_lead_time_days:g} d exceeds current cover {days_of_cover:g} d")
        out.append({"supplier_id": s.id, "supplier_code": s.supplier_code, "name": s.name, "country": s.country,
                    "risk_score": s.risk_score, "risk_level": s.risk_level, "avg_lead_time_days": s.avg_lead_time_days,
                    "on_time_delivery_rate": s.on_time_delivery_rate, "defect_rate": s.defect_rate,
                    "selection_score": score, "is_current_supplier": product.supplier_id == s.id,
                    "warnings": warnings})
    out.sort(key=lambda x: (x["risk_level"] == "High", -x["selection_score"]))
    return out


def plan_item(db: Session, item: InventoryItem, po_qty: dict | None = None) -> dict:
    """Replenishment plan for one inventory record (rules 1-4)."""
    po_qty = po_qty if po_qty is not None else po_quantities(db)
    q = po_qty.get((item.product_id, item.warehouse), {"on_order": 0, "draft": 0})
    risk = inventory_risk(item.available_stock, item.reserved_stock, item.reorder_level, item.safety_stock,
                          item.lead_time_days, item.avg_daily_demand)
    rates = demand_rates(item)
    position = risk["net_stock"] + q["on_order"]
    qty = 0
    if risk["stockout_risk"] != "Low":
        qty = max(0, math.ceil(item.reorder_level + rates["planning_daily"] * REVIEW_PERIOD_DAYS - position))
    suppliers = rank_suppliers(db, item.product, risk["days_of_cover"]) if qty > 0 else []
    if risk["stockout_risk"] == "Low":
        action = "No replenishment needed."
    elif qty == 0:
        action = f"Open purchase orders ({q['on_order']} units) already cover the requirement - track inbound delivery."
    elif q["draft"]:
        action = f"A draft purchase order for {q['draft']} units exists - review and approve it."
    elif suppliers:
        action = f"Create a purchase order for {qty} units from {suppliers[0]['name']}."
    else:
        action = f"Order {qty} units - no supplier is linked to this product's department."
    return {"inventory_id": item.id, "product_id": item.product_id, "product_name": item.product.name,
            "category": item.product.category, "department": item.product.department, "warehouse": item.warehouse,
            "available_stock": item.available_stock, "reserved_stock": item.reserved_stock,
            "net_stock": risk["net_stock"], "reorder_level": item.reorder_level, "safety_stock": item.safety_stock,
            "lead_time_days": item.lead_time_days, "days_of_cover": risk["days_of_cover"],
            "stockout_risk": risk["stockout_risk"], "on_order": q["on_order"], "draft_po_qty": q["draft"],
            "inventory_position": position, **rates, "replenishment_qty": qty,
            "recommended_supplier": suppliers[0] if suppliers else None, "alternative_suppliers": suppliers[1:3],
            "action": action}


def replenishment_plan(db: Session, only_needed: bool = True) -> list[dict]:
    items = db.query(InventoryItem).options(joinedload(InventoryItem.product).joinedload(Product.supplier)).all()
    po_qty = po_quantities(db)
    plans = [plan_item(db, i, po_qty) for i in items]
    if only_needed:
        plans = [p for p in plans if p["stockout_risk"] != "Low"]
    order = {"High": 0, "Medium": 1, "Low": 2}
    return sorted(plans, key=lambda p: (order[p["stockout_risk"]], p["days_of_cover"] or 0))
