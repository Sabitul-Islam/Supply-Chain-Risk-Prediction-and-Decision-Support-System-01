"""Integrated decision-support engine.

Combines the outputs of every module into five scenarios and one overall risk overview. Everything is computed from
database records with transparent rules; every block says what KIND of evidence it is based on:

    "ML prediction"         Random Forest models (machine failure, late delivery)
    "Rule-based assessment" documented formulas (supplier score, stockout risk, replenishment)
    "Statistical forecast"  simple exponential smoothing on real DataCo demand
    "Observed"              facts recorded in the system (e.g. a PO that arrived after its expected date)
    "Sample data"           simulated supplier / stock records (no real data was available)

Domain risk index (0-100) = (number of High items + 0.5 x number of Medium items) / items assessed x 100
Overall index            = average of the domain indices that have data (equal weights)
Index level              = Low below 20, Medium 20 to < 40, High 40 or more
"""
from sqlalchemy.orm import Session, joinedload

from ..models import (InventoryItem, Machine, Product, ProductReturn, PurchaseOrder, SalesOrder, Shipment, Supplier)
from .orders import serialize_shipment, shipment_delay_state, today
from .planning import plan_item, po_quantities, rank_suppliers
from .purchasing import inbound_state

INDEX_THRESHOLDS = (20, 40)
LEVELS = ("High", "Medium", "Low")
BASIS = {
    "supplier": "Rule-based assessment on simulated sample supplier records",
    "inventory": "Rule-based assessment: sample stock levels, demand rates from real DataCo orders",
    "production": "ML prediction: Random Forest trained on AI4I 2020 (machine readings are dataset records)",
    "transportation": "ML prediction: Random Forest trained on DataCo (late-delivery probability)",
    "demand": "Statistical forecast (exponential smoothing on real DataCo demand) compared with the inventory plan",
}


def _index(counts: dict) -> dict:
    total = sum(counts.get(k, 0) for k in LEVELS)
    if total == 0:
        return {"score": None, "level": None, "assessed": 0, "counts": {k: 0 for k in LEVELS}}
    score = round((counts.get("High", 0) + 0.5 * counts.get("Medium", 0)) / total * 100, 1)
    lo, hi = INDEX_THRESHOLDS
    return {"score": score, "level": "Low" if score < lo else "Medium" if score < hi else "High",
            "assessed": total, "counts": {k: counts.get(k, 0) for k in LEVELS}}


def _count(values) -> dict:
    out: dict = {}
    for v in values:
        if v:
            out[v] = out.get(v, 0) + 1
    return out


# ------------------------------------------------------------------------------------------ data loading
def _plans(db: Session) -> list[dict]:
    items = db.query(InventoryItem).options(joinedload(InventoryItem.product).joinedload(Product.supplier)).all()
    po_qty = po_quantities(db)
    return [plan_item(db, i, po_qty) for i in items]


def _active_order_shipments(db: Session) -> list[Shipment]:
    return (db.query(Shipment).filter(Shipment.source == "order", Shipment.status.in_(("Planned", "In Transit")))
            .options(joinedload(Shipment.sales_order).joinedload(SalesOrder.items)).all())


# ------------------------------------------------------------------------------------------ scenarios
def inventory_shortage(plans: list[dict]) -> dict:
    """Scenario 1: low stock -> forecast -> replenishment requirement -> supplier risk -> procurement action."""
    rows = sorted([p for p in plans if p["stockout_risk"] != "Low"],
                  key=lambda p: ({"High": 0, "Medium": 1}[p["stockout_risk"]], p["days_of_cover"] or 0))
    return {"basis": "Rule-based stockout assessment + statistical demand forecast + rule-based supplier selection",
            "items": rows, "high": sum(p["stockout_risk"] == "High" for p in rows), "total": len(rows),
            "units_to_order": sum(p["replenishment_qty"] for p in rows)}


def supplier_exposure(db: Session, plans: list[dict]) -> dict:
    """Scenario 2: high-risk suppliers -> affected products -> inventory exposure -> alternative suppliers."""
    by_product: dict = {}
    for p in plans:
        by_product.setdefault(p["product_id"], []).append(p)
    out = []
    for s in db.query(Supplier).filter(Supplier.risk_level == "High").order_by(Supplier.risk_score.desc()).all():
        products = db.query(Product).filter(Product.supplier_id == s.id).all()
        stocked = [pl for pr in products for pl in by_product.get(pr.id, [])]
        open_pos = db.query(PurchaseOrder).filter(PurchaseOrder.supplier_id == s.id,
                                                  PurchaseOrder.status.in_(("Draft", "Approved", "Ordered"))).all()
        alternatives = []
        if products:
            alternatives = [a for a in rank_suppliers(db, products[0]) if a["supplier_id"] != s.id
                            and a["risk_level"] != "High"][:3]
        at_risk = [pl for pl in stocked if pl["stockout_risk"] != "Low"]
        rec = ("Qualify an alternative supplier" + (f" - best candidate {alternatives[0]['name']} "
                                                    f"(risk {alternatives[0]['risk_score']})" if alternatives else
                                                    " (no lower-risk supplier in this category)") + ".")
        if at_risk:
            rec += f" {len(at_risk)} stocked product(s) from this supplier are already at stockout risk - avoid " \
                   "single-sourcing their replenishment."
        if open_pos:
            rec += f" {len(open_pos)} open purchase order(s) depend on this supplier - monitor them closely."
        out.append({"supplier_id": s.id, "supplier_code": s.supplier_code, "name": s.name, "country": s.country,
                    "category": s.category, "risk_score": s.risk_score, "risk_level": s.risk_level,
                    "product_count": len(products), "stocked_records": len(stocked),
                    "net_units_in_stock": sum(pl["net_stock"] for pl in stocked),
                    "products_at_stockout_risk": [{"product_name": pl["product_name"], "warehouse": pl["warehouse"],
                                                   "stockout_risk": pl["stockout_risk"],
                                                   "days_of_cover": pl["days_of_cover"]} for pl in at_risk],
                    "open_purchase_orders": [{"id": po.id, "po_number": po.po_number, "status": po.status}
                                             for po in open_pos],
                    "alternatives": alternatives, "recommendation": rec})
    return {"basis": BASIS["supplier"], "suppliers": out}


def shipment_delay(db: Session, plans: list[dict]) -> dict:
    """Scenario 3: high-risk / delayed shipments -> affected orders, products, customers -> preventive actions.
    Also inbound: delayed purchase orders and the stock records that depend on them."""
    outbound = []
    for s in _active_order_shipments(db):
        state = shipment_delay_state(s)
        if s.risk_level not in ("High", "Medium") and not state["is_delayed"]:
            continue
        o = s.sales_order
        actions = []
        if state["is_delayed"]:
            actions.append(f"Overdue by {state['days_late']} day(s): contact the carrier and inform "
                           f"{o.customer.name}.")
        if s.status == "Planned" and s.risk_level == "High":
            actions.append("Not yet dispatched: consider a slower but more reliable mode (re-score it on the order), "
                           "prioritise picking, and set a realistic delivery promise.")
        if s.recommendation:
            actions.append(s.recommendation)
        outbound.append({"shipment": serialize_shipment(s), "order_id": o.id, "order_number": o.order_number,
                         "order_status": o.status, "customer_name": o.customer.name, "order_value": o.total_amount,
                         "products": [f"{i.product.name} x{i.quantity}" for i in o.items],
                         "impact": f"{sum(i.quantity for i in o.items)} units / {o.total_amount:,.2f} order value; "
                                   + ("stock is reserved until dispatch." if s.status == "Planned"
                                      else "stock already dispatched."),
                         "actions": actions})
    outbound.sort(key=lambda x: (not x["shipment"]["is_delayed"], -(x["shipment"]["late_probability"] or 0)))

    plan_by_loc = {(p["product_id"], p["warehouse"]): p for p in plans}
    inbound = []
    for po in db.query(PurchaseOrder).filter(PurchaseOrder.status == "Ordered").all():
        state = inbound_state(po)
        days_to_arrival = (po.expected_arrival_date - today()).days if po.expected_arrival_date else None
        affected = []
        for it in po.items:
            p = plan_by_loc.get((it.product_id, po.warehouse))
            if p and p["stockout_risk"] != "Low":
                runs_out = p["days_of_cover"] is not None and days_to_arrival is not None and \
                    p["days_of_cover"] < max(days_to_arrival, 0)
                affected.append({"product_name": p["product_name"], "stockout_risk": p["stockout_risk"],
                                 "days_of_cover": p["days_of_cover"], "runs_out_before_arrival": runs_out})
        if state["is_delayed"] or any(a["runs_out_before_arrival"] for a in affected):
            inbound.append({"po_id": po.id, "po_number": po.po_number, "supplier_name": po.supplier.name,
                            "supplier_risk_level": po.supplier.risk_level, "warehouse": po.warehouse,
                            "expected_arrival_date": po.expected_arrival_date, **state, "affected_stock": affected,
                            "action": ("Expedite with the supplier or split the order with an alternative supplier."
                                       if state["is_delayed"] else
                                       "Stock is expected to run out before this delivery arrives - expedite.")})
    historical_high = db.query(Shipment).filter(Shipment.source == "dataco", Shipment.risk_level == "High").count()
    return {"basis": BASIS["transportation"] + "; delays are observed from expected vs actual dates",
            "outbound": outbound, "inbound": inbound, "historical_high_risk_records": historical_high}


def equipment(db: Session) -> dict:
    """Scenario 4: machines with high predicted failure risk -> maintenance + operational implications.
    There is no production schedule or capacity data, so the impact on output is described, not quantified."""
    rows = []
    for m in (db.query(Machine).filter(Machine.risk_level.in_(("High", "Medium")))
              .order_by(Machine.failure_probability.desc()).all()):
        implication = ("Elevated probability of an imminent failure: unplanned downtime could interrupt production "
                       "of the items made on this machine and delay replenishment of finished-goods stock."
                       if m.risk_level == "High" else
                       "Moderate failure risk: plan maintenance in a low-utilisation window to avoid disruption.")
        rows.append({"id": m.id, "machine_code": m.machine_code, "machine_type": m.machine_type,
                     "failure_probability": m.failure_probability, "risk_level": m.risk_level,
                     "tool_wear_min": m.tool_wear_min, "recommendation": m.recommendation,
                     "implication": implication})
    return {"basis": BASIS["production"],
            "note": "No production schedule or capacity data exists in the datasets, so output impact is not "
                    "quantified.", "machines": rows,
            "high": sum(r["risk_level"] == "High" for r in rows), "medium": sum(r["risk_level"] == "Medium" for r in rows)}


# ------------------------------------------------------------------------------------------ overview + actions
def risk_overview(db: Session, plans: list[dict]) -> dict:
    active = _active_order_shipments(db)
    if active:
        ship_levels, ship_scope = [s.risk_level for s in active], f"{len(active)} active order shipments"
    else:
        ship_levels = [r[0] for r in db.query(Shipment.risk_level).all()]
        ship_scope = "all shipment records (no active order shipments yet)"
    domains = [
        ("supplier", "Supplier risk", _count(r[0] for r in db.query(Supplier.risk_level).all()), "suppliers"),
        ("inventory", "Inventory risk", _count(p["stockout_risk"] for p in plans), "inventory records"),
        ("production", "Production equipment risk", _count(r[0] for r in db.query(Machine.risk_level).all()),
         "machines"),
        ("transportation", "Transportation risk", _count(ship_levels), ship_scope),
        ("demand", "Demand-related risk", _count(p["demand_risk"] for p in plans),
         "inventory records with a demand forecast"),
    ]
    out = []
    for key, label, counts, scope in domains:
        idx = _index(counts)
        out.append({"key": key, "label": label, "basis": BASIS[key], "scope": scope, **idx})
    scored = [d["score"] for d in out if d["score"] is not None]
    overall = round(sum(scored) / len(scored), 1) if scored else None
    lo, hi = INDEX_THRESHOLDS
    return {"overall": {"score": overall, "level": None if overall is None else
                        ("Low" if overall < lo else "Medium" if overall < hi else "High")},
            "domains": out,
            "formula": "Domain index = (High + 0.5 x Medium) / items assessed x 100. Overall = average of domain "
                       "indices. Low < 20, Medium 20-40, High >= 40."}


def priority_actions(db: Session, plans: list[dict], shortage=None, suppliers=None, delays=None, machines=None,
                     limit: int = 12) -> list[dict]:
    shortage = shortage or inventory_shortage(plans)
    suppliers = suppliers or supplier_exposure(db, plans)
    delays = delays or shipment_delay(db, plans)
    machines = machines or equipment(db)
    acts = []

    def add(priority, domain, title, detail, basis, link):
        acts.append({"priority": priority, "domain": domain, "title": title, "detail": detail, "basis": basis,
                     "link": link})

    for x in delays["outbound"]:
        sh = x["shipment"]
        if sh["is_delayed"] or sh["risk_level"] == "High":
            add("High", "Transportation", f"{x['order_number']}: " + ("overdue shipment" if sh["is_delayed"] else
                f"{round((sh['late_probability'] or 0) * 100)}% predicted late-delivery risk"),
                x["actions"][0] if x["actions"] else "", "Observed" if sh["is_delayed"] else "ML prediction", "/orders")
    for x in delays["inbound"]:
        add("High", "Inbound logistics", f"{x['po_number']} from {x['supplier_name']}: "
            + (f"{x['days_late']} day(s) late" if x["is_delayed"] else "arrives after stock runs out"),
            x["action"], "Observed + rule-based", "/purchase-orders")
    for p in shortage["items"]:
        if p["replenishment_qty"] <= 0:
            continue
        sup = p["recommended_supplier"]
        add("High" if p["stockout_risk"] == "High" else "Medium", "Inventory",
            f"Replenish {p['product_name']} ({p['warehouse']})",
            p["action"] + (f" Supplier risk {sup['risk_level']} ({sup['risk_score']})." if sup else ""),
            "Rule-based + forecast", "/purchase-orders")
    for m in machines["machines"]:
        if m["risk_level"] == "High":
            add("High", "Production", f"Maintain machine {m['machine_code']} "
                f"({round(m['failure_probability'] * 100)}% failure probability)", m["recommendation"],
                "ML prediction", "/production")
    for s in suppliers["suppliers"]:
        add("High" if s["products_at_stockout_risk"] or s["open_purchase_orders"] else "Medium", "Procurement",
            f"High-risk supplier {s['name']} (score {s['risk_score']})", s["recommendation"],
            "Rule-based (sample data)", "/procurement")
    for p in plans:
        if p["demand_risk"] == "High":
            add("Medium", "Demand", f"Review reorder level of {p['product_name']}",
                f"Forecast demand {p['forecast_daily']}/day is {p['gap_pct']}% above the planned "
                f"{p['historical_daily']}/day used for the reorder level.", "Statistical forecast", "/demand")
    waiting = db.query(ProductReturn).filter(ProductReturn.status.in_(("Requested", "Received"))).count()
    if waiting:
        add("Low", "Returns", f"{waiting} return(s) awaiting approval or inspection",
            "Process returns so restockable units become available again.", "Observed", "/returns")
    rank = {"High": 0, "Medium": 1, "Low": 2}
    acts.sort(key=lambda a: rank[a["priority"]])
    return acts[:limit]


def full_report(db: Session) -> dict:
    plans = _plans(db)
    shortage = inventory_shortage(plans)
    suppliers = supplier_exposure(db, plans)
    delays = shipment_delay(db, plans)
    machines = equipment(db)
    return {"generated_for": today(), "overview": risk_overview(db, plans),
            "actions": priority_actions(db, plans, shortage, suppliers, delays, machines),
            "inventory_shortage": shortage, "supplier_risk": suppliers, "shipment_delay": delays,
            "equipment": machines,
            "demand_plan": demand_plan(plans)}


def demand_plan(plans: list[dict]) -> dict:
    """Forecast -> inventory planning link: forecast demand rate vs the rate used for the reorder level."""
    rows = sorted([p for p in plans if p["demand_risk"] is not None], key=lambda p: -(p["gap_pct"] or 0))
    keys = ("inventory_id", "product_id", "product_name", "warehouse", "historical_daily", "forecast_daily",
            "planning_daily", "gap_pct", "demand_risk", "reorder_level", "net_stock", "stockout_risk",
            "replenishment_qty", "forecast_months")
    return {"basis": BASIS["demand"], "items": [{k: p[k] for k in keys} for p in rows],
            "without_forecast": sum(1 for p in plans if p["demand_risk"] is None)}
