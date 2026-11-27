from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Machine, Product, ProductReturn, PurchaseOrder, SalesOrder, Shipment, Supplier
from ..services import decision, demand
from ..services.orders import shipment_delay_state
from ..services.purchasing import inbound_state

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])
LEVELS = ["Low", "Medium", "High"]


def _dist(db, col, *filters):
    counts = dict(db.query(col, func.count()).filter(*filters).group_by(col).all())
    return [{"level": k, "count": counts.get(k, 0)} for k in LEVELS]


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    """Every number comes from database records or a documented calculation (see services/decision.py)."""
    plans = decision._plans(db)  # inventory records with stockout risk + forecast-based planning
    inv_alerts = sorted([p for p in plans if p["stockout_risk"] != "Low"],
                        key=lambda p: ({"High": 0, "Medium": 1}[p["stockout_risk"]], p["days_of_cover"] or 0))
    machine_alerts = db.query(Machine).filter(Machine.risk_level == "High").order_by(Machine.failure_probability.desc()).all()
    ship_alerts_q = db.query(Shipment).filter(Shipment.risk_level == "High")
    high_suppliers = db.query(Supplier).filter(Supplier.risk_level == "High").order_by(Supplier.risk_score.desc()).all()
    orders = db.query(SalesOrder).all()
    open_orders = [o for o in orders if o.status not in ("Delivered", "Cancelled")]
    delayed_orders = [o for o in open_orders if o.shipments and shipment_delay_state(o.shipments[0])["is_delayed"]]
    pos = db.query(PurchaseOrder).all()
    active_ships = db.query(Shipment).filter(Shipment.source == "order",
                                             Shipment.status.in_(("Planned", "In Transit"))).all()
    try:
        months = demand.overview("consistent")["months"][-12:]
        fc = demand.total_forecast(3)
    except demand.DemandDataMissing:
        months, fc = [], {"available": False}
    return {
        "cards": {
            "total_suppliers": db.query(Supplier).count(),
            "total_products": db.query(Product).count(),
            "total_orders": len(orders),
            "open_orders": len(open_orders),
            "delayed_orders": len(delayed_orders),
            "total_shipments": db.query(Shipment).count(),
            "active_shipments": len(active_ships),
            "high_risk_active_shipments": sum(s.risk_level == "High" for s in active_ships),
            "total_machines": db.query(Machine).count(),
            "high_risk_suppliers": len(high_suppliers),
            "machine_failure_alerts": len(machine_alerts),
            "shipment_delay_alerts": ship_alerts_q.count(),
            "inventory_alerts": len(inv_alerts),
            "open_purchase_orders": sum(p.status in ("Draft", "Approved", "Ordered") for p in pos),
            "inbound_delayed": sum(p.status == "Ordered" and inbound_state(p)["is_delayed"] for p in pos),
            "pending_returns": db.query(ProductReturn).filter(
                ProductReturn.status.in_(("Requested", "Approved", "Received", "Inspected"))).count(),
        },
        "charts": {
            "supplier_risk": _dist(db, Supplier.risk_level),
            "machine_risk": _dist(db, Machine.risk_level),
            "shipment_risk": _dist(db, Shipment.risk_level),
            "inventory_risk": [{"level": k, "count": sum(1 for p in plans if p["stockout_risk"] == k)} for k in LEVELS],
            "shipment_by_mode": [{"shipping_mode": m, "avg_late_probability": round(p or 0, 3), "shipments": n}
                                 for m, p, n in db.query(Shipment.shipping_mode, func.avg(Shipment.late_probability),
                                                         func.count()).group_by(Shipment.shipping_mode).all()],
            "monthly_demand": [{"month": r["month"], "quantity": r["quantity"]} for r in months],
            "demand_forecast": fc.get("forecast", []) if fc.get("available") else [],
            "order_status": [{"status": s, "count": sum(o.status == s for o in orders)}
                             for s in ["Pending", "Confirmed", "Processing", "Ready for Shipment", "Shipped",
                                       "Delivered", "Cancelled"]],
        },
        "risk_overview": decision.risk_overview(db, plans),
        "actions": decision.priority_actions(db, plans, limit=6),
        "alerts": {
            "suppliers": [{"id": s.id, "name": s.name, "risk_score": s.risk_score} for s in high_suppliers[:5]],
            "machines": [{"id": m.id, "machine_code": m.machine_code, "failure_probability": m.failure_probability}
                         for m in machine_alerts[:5]],
            "shipments": [{"id": s.id, "order_id": s.order_id, "shipping_mode": s.shipping_mode,
                           "late_probability": s.late_probability}
                          for s in ship_alerts_q.order_by(Shipment.late_probability.desc()).limit(5).all()],
            "inventory": [{"id": i["inventory_id"], "product_name": i["product_name"], "stockout_risk": i["stockout_risk"],
                           "net_stock": i["net_stock"], "reorder_level": i["reorder_level"]} for i in inv_alerts[:5]],
        },
    }
