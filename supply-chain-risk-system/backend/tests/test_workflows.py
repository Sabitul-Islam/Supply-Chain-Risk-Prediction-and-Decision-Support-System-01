"""Tests for the integrated supply chain workflows: orders, stock movements, purchase orders, inbound / outbound
logistics, returns, decision support and the assistant's operational queries.  Run from backend/:  python -m pytest -q
"""
import math
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import InventoryItem, PurchaseOrder
from app.services import inventory_ops

PW = "Secure123"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def h(client):
    r = client.post("/api/auth/register", json={"full_name": "Ops User", "email": "ops@example.com",
                                                "password": PW, "confirm_password": PW})
    if r.status_code == 409:  # already registered by an earlier run in this session
        r = client.post("/api/auth/login", json={"email": "ops@example.com", "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def inv(client, h, inventory_id):
    return next(i for i in client.get("/api/inventory", headers=h).json() if i["id"] == inventory_id)


def stocked_product(client, h, min_available=20, skip=()):
    """A product with enough unreserved stock, plus its inventory record."""
    for p in sorted(client.get("/api/orders/available-products", headers=h).json(), key=lambda x: -x["available"]):
        if p["available"] >= min_available and p["product_id"] not in skip:
            rec = next(i for i in client.get("/api/inventory", headers=h).json()
                       if i["product_id"] == p["product_id"] and i["warehouse"] == p["warehouse"])
            return p, rec
    pytest.skip("no product with enough stock")


def new_order(client, h, items, mode="Standard Class", discount=0.0):
    cust = client.get("/api/customers", headers=h).json()[0]["id"]
    return client.post("/api/orders", headers=h, json={"customer_id": cust, "payment_type": "DEBIT",
                                                       "shipping_mode": mode, "discount_rate": discount,
                                                       "items": items})


def set_status(client, h, oid, status, **extra):
    return client.post(f"/api/orders/{oid}/status", headers=h, json={"status": status, **extra})


# ------------------------------------------------------------------------------------------ security
NEW_ENDPOINTS = ["/api/orders", "/api/orders/available-products", "/api/purchase-orders",
                 "/api/purchase-orders/recommendations", "/api/returns", "/api/customers", "/api/decision/report",
                 "/api/decision/overview", "/api/inventory/transactions", "/api/inventory/warehouses",
                 "/api/shipments/outbound", "/api/suppliers/1"]


@pytest.mark.parametrize("path", NEW_ENDPOINTS)
def test_new_endpoints_require_auth(client, path):
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer not.a.token"}).status_code == 401


def test_write_endpoints_require_auth(client):
    assert client.post("/api/orders", json={}).status_code == 401
    assert client.post("/api/purchase-orders/generate").status_code == 401
    assert client.post("/api/returns", json={}).status_code == 401
    assert client.post("/api/inventory/1/adjust", json={"quantity_change": 5, "reason": "x"}).status_code == 401


# ------------------------------------------------------------------------------------------ customers
def test_customers(client, h):
    seeded = client.get("/api/customers", headers=h).json()
    assert len(seeded) >= 6 and all(c["is_sample"] for c in seeded[:6])
    body = {"name": "Test Customer", "segment": "Consumer", "market": "Europe", "order_region": "Western Europe"}
    c = client.post("/api/customers", headers=h, json=body)
    assert c.status_code == 201 and c.json()["customer_code"].startswith("CUS-")
    assert client.post("/api/customers", headers=h, json={**body, "market": "Mars"}).status_code == 422
    assert client.post("/api/customers", headers=h, json={**body, "order_region": "Canada"}).status_code == 422
    dup = {**body, "customer_code": c.json()["customer_code"]}
    assert client.post("/api/customers", headers=h, json=dup).status_code == 409
    assert client.post("/api/customers", headers=h, json={"segment": "Consumer"}).status_code == 422  # missing fields
    assert client.delete(f"/api/customers/{c.json()['id']}", headers=h).status_code == 200


# ------------------------------------------------------------------------------------------ order validation
def test_order_validation(client, h):
    p, rec = stocked_product(client, h)
    assert new_order(client, h, [{"product_id": 99999999, "quantity": 1}]).status_code == 404  # invalid product
    assert new_order(client, h, [{"product_id": p["product_id"], "quantity": 0}]).status_code == 422  # invalid qty
    assert new_order(client, h, [{"product_id": p["product_id"], "quantity": -3}]).status_code == 422
    assert new_order(client, h, []).status_code == 422  # missing items
    dup = [{"product_id": p["product_id"], "quantity": 1}] * 2
    assert new_order(client, h, dup).status_code == 422  # duplicate line
    too_many = new_order(client, h, [{"product_id": p["product_id"], "quantity": p["available"] + 1}])
    assert too_many.status_code == 409 and "Insufficient stock" in too_many.json()["detail"]
    assert new_order(client, h, [{"product_id": p["product_id"], "quantity": 1}], mode="Teleport").status_code == 422
    assert inv(client, h, rec["id"])["reserved_stock"] == rec["reserved_stock"]  # nothing reserved


def test_order_create_confirm_and_cancel_releases_stock(client, h):
    p, rec = stocked_product(client, h)
    r = new_order(client, h, [{"product_id": p["product_id"], "quantity": 3}], discount=0.1)
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "Pending" and o["order_number"].startswith("SO-")
    assert o["total_amount"] == round(3 * p["price"] * 0.9, 2)
    assert 0 <= o["items"][0]["late_probability"] <= 1
    assert inv(client, h, rec["id"])["reserved_stock"] == rec["reserved_stock"]  # pending = not reserved

    bad = set_status(client, h, o["id"], "Shipped")  # Pending -> Shipped is not allowed
    assert bad.status_code == 409 and "Allowed next status" in bad.json()["detail"]

    c = set_status(client, h, o["id"], "Confirmed").json()
    assert c["status"] == "Confirmed" and c["shipment"]["status"] == "Planned"
    assert c["shipment"]["risk_level"] in {"Low", "Medium", "High"}
    assert inv(client, h, rec["id"])["reserved_stock"] == rec["reserved_stock"] + 3
    txns = client.get(f"/api/inventory/transactions?inventory_id={rec['id']}", headers=h).json()
    assert txns[0]["txn_type"] == "RESERVED" and txns[0]["reference_label"] == o["order_number"]

    x = set_status(client, h, o["id"], "Cancelled", note="Customer changed mind").json()
    assert x["status"] == "Cancelled" and x["shipment"]["status"] == "Cancelled"
    after = inv(client, h, rec["id"])
    assert after["reserved_stock"] == rec["reserved_stock"] and after["available_stock"] == rec["available_stock"]
    assert set_status(client, h, o["id"], "Cancelled").status_code == 409  # final status
    types = [t["txn_type"] for t in client.get(f"/api/inventory/transactions?inventory_id={rec['id']}",
                                               headers=h).json()[:2]]
    assert types == ["RELEASED", "RESERVED"]


def test_full_fulfilment_and_outbound_tracking(client, h):
    p, rec = stocked_product(client, h)
    o = new_order(client, h, [{"product_id": p["product_id"], "quantity": 2}]).json()
    for s in ["Confirmed", "Processing", "Ready for Shipment"]:
        assert set_status(client, h, o["id"], s).status_code == 200
    # preventive action: change shipping mode before dispatch -> re-scored by the model
    m = client.post(f"/api/orders/{o['id']}/shipping-mode", headers=h, json={"shipping_mode": "First Class"}).json()
    assert m["shipping_mode"] == "First Class" and m["scheduled_shipping_days"] == 1
    assert any("Shipping mode changed" in e["note"] for e in m["shipment"]["events"])

    shipped = set_status(client, h, o["id"], "Shipped").json()
    assert shipped["shipment"]["status"] == "In Transit" and shipped["shipment"]["expected_delivery_date"]
    after = inv(client, h, rec["id"])
    assert after["available_stock"] == rec["available_stock"] - 2  # stock deducted at dispatch
    assert after["reserved_stock"] == rec["reserved_stock"]  # reservation consumed
    assert client.post(f"/api/orders/{o['id']}/shipping-mode", headers=h,
                       json={"shipping_mode": "Standard Class"}).status_code == 409  # too late
    assert set_status(client, h, o["id"], "Cancelled").status_code == 409  # cannot cancel after shipment

    future = (date.today() + timedelta(days=30)).isoformat()
    assert set_status(client, h, o["id"], "Delivered", delivery_date=future).status_code == 422
    d = set_status(client, h, o["id"], "Delivered").json()
    assert d["status"] == "Delivered" and d["shipment"]["actual_delivery_date"] == date.today().isoformat()
    assert isinstance(d["shipment"]["delivered_late"], bool)
    assert [e["status"] for e in d["shipment"]["events"]][-1] == "Delivered"

    out = client.get("/api/shipments/outbound", headers=h).json()
    assert any(r["order_number"] == o["order_number"] and r["status"] == "Delivered" for r in out["items"])
    stats = client.get("/api/shipments/stats", headers=h).json()
    assert stats["by_source"]["order"] >= 1 and stats["by_source"]["dataco"] == 800


def test_confirm_is_all_or_nothing(client, h):
    """A multi-line order whose 2nd line no longer has stock must not leave the 1st line reserved."""
    p1, r1 = stocked_product(client, h)
    p2, r2 = stocked_product(client, h, skip=(p1["product_id"],))
    o = new_order(client, h, [{"product_id": p1["product_id"], "quantity": 1},
                              {"product_id": p2["product_id"], "quantity": 5}]).json()
    # stock of product 2 drops before confirmation (e.g. damage found during a stock count)
    net2 = r2["available_stock"] - r2["reserved_stock"]
    adj = client.post(f"/api/inventory/{r2['id']}/adjust", headers=h,
                      json={"quantity_change": -(net2 - 2), "reason": "Damaged units written off"})
    assert adj.status_code == 200, adj.text
    res = set_status(client, h, o["id"], "Confirmed")
    assert res.status_code == 409 and "Insufficient stock" in res.json()["detail"]
    assert inv(client, h, r1["id"])["reserved_stock"] == r1["reserved_stock"]  # rolled back
    assert client.get(f"/api/orders/{o['id']}", headers=h).json()["status"] == "Pending"
    client.post(f"/api/inventory/{r2['id']}/adjust", headers=h, json={"quantity_change": net2 - 2, "reason": "Undo"})


# ------------------------------------------------------------------------------------------ stock movements
def test_stock_adjustments_and_guards(client, h):
    p, rec = stocked_product(client, h)
    assert client.post(f"/api/inventory/{rec['id']}/adjust", headers=h,
                       json={"quantity_change": 0, "reason": "zero"}).status_code == 422
    below = client.post(f"/api/inventory/{rec['id']}/adjust", headers=h,
                        json={"quantity_change": -(rec["available_stock"] + 1), "reason": "too much"})
    assert below.status_code == 409  # can never go negative / below reserved
    ok = client.post(f"/api/inventory/{rec['id']}/adjust", headers=h, json={"quantity_change": 7, "reason": "Count"})
    assert ok.json()["available_stock"] == rec["available_stock"] + 7
    t = client.get(f"/api/inventory/transactions?inventory_id={rec['id']}&txn_type=ADJUSTED", headers=h).json()[0]
    assert t["quantity"] == 7 and t["available_after"] == rec["available_stock"] + 7 and t["note"] == "Count"
    assert client.get("/api/inventory/transactions?txn_type=STOLEN", headers=h).status_code == 422

    # reservations from open orders protect the record
    o = new_order(client, h, [{"product_id": p["product_id"], "quantity": 1}]).json()
    set_status(client, h, o["id"], "Confirmed")
    cur = inv(client, h, rec["id"])
    body = {k: cur[k] for k in ["product_id", "warehouse", "available_stock", "reserved_stock", "reorder_level",
                                "safety_stock", "lead_time_days", "avg_daily_demand"]}
    assert client.put(f"/api/inventory/{rec['id']}", headers=h, json={**body, "reserved_stock": 0}).status_code == 409
    assert client.delete(f"/api/inventory/{rec['id']}", headers=h).status_code == 409
    set_status(client, h, o["id"], "Cancelled")
    wh = client.get("/api/inventory/warehouses", headers=h).json()
    assert sum(w["records"] for w in wh) == len(client.get("/api/inventory", headers=h).json())


def test_duplicate_stock_movement_is_blocked():
    with SessionLocal() as db:
        item = db.query(InventoryItem).first()
        before = item.available_stock
        inventory_ops.receive(db, item, 5, key="TEST-DUPLICATE-KEY", reference_label="test")
        db.commit()
        with pytest.raises(inventory_ops.StockError, match="Duplicate"):
            inventory_ops.receive(db, item, 5, key="TEST-DUPLICATE-KEY", reference_label="test")
        db.rollback()
        db.refresh(item)
        assert item.available_stock == before + 5
        with pytest.raises(inventory_ops.StockError):
            inventory_ops.reserve(db, item, item.available_stock - item.reserved_stock + 1)
        with pytest.raises(inventory_ops.StockError):
            inventory_ops.release(db, item, 0)
        db.rollback()


# ------------------------------------------------------------------------------------------ procurement
def test_replenishment_plan_formula(client, h):
    plans = client.get("/api/purchase-orders/recommendations", headers=h).json()
    assert plans and all(p["stockout_risk"] in ("High", "Medium") for p in plans)
    for p in plans:
        expected = max(0, math.ceil(p["reorder_level"] + p["planning_daily"] * 30 - p["inventory_position"]))
        assert p["replenishment_qty"] == expected
        assert p["planning_daily"] >= p["historical_daily"]
        if p["forecast_daily"] is not None:
            assert p["planning_daily"] == max(p["historical_daily"], p["forecast_daily"])
    withsup = [p for p in plans if p["recommended_supplier"]]
    assert withsup
    for p in withsup:
        ranked = [p["recommended_supplier"]] + p["alternative_suppliers"]
        non_high = [s for s in ranked if s["risk_level"] != "High"]
        assert ranked[:len(non_high)] == non_high  # High-risk suppliers ranked last


def test_supplier_recommend_and_detail(client, h):
    pid = client.get("/api/purchase-orders/recommendations", headers=h).json()[0]["product_id"]
    rec = client.get(f"/api/suppliers/recommend/{pid}", headers=h).json()
    scores = [c["selection_score"] for c in rec["candidates"] if c["risk_level"] != "High"]
    assert scores == sorted(scores, reverse=True)
    c = rec["candidates"][0]
    assert 0 <= c["selection_score"] <= 100
    sid = client.get("/api/suppliers", headers=h).json()[0]["id"]
    d = client.get(f"/api/suppliers/{sid}", headers=h).json()
    assert "products" in d and "purchase_orders" in d and "breakdown" in d
    assert client.get("/api/suppliers/999999", headers=h).status_code == 404
    assert client.get("/api/suppliers/recommend/999999", headers=h).status_code == 404


def test_purchase_order_workflow_and_inbound_receipt(client, h):
    before = client.get("/api/purchase-orders", headers=h).json()["counts"]["Draft"]
    g = client.post("/api/purchase-orders/generate", headers=h, json={})
    assert g.status_code == 201 and g.json()["created"] >= 1
    assert client.post("/api/purchase-orders/generate", headers=h, json={}).json()["created"] == 0  # no duplicates
    lst = client.get("/api/purchase-orders?status=Draft", headers=h).json()
    assert lst["counts"]["Draft"] == before + g.json()["created"]
    po = client.get(f"/api/purchase-orders/{g.json()['purchase_orders'][0]['id']}", headers=h).json()
    assert po["source"] == "reorder_recommendation" and po["items"]
    # drafts are visible as draft quantity on the recommendation
    line = po["items"][0]
    plan = next(p for p in client.get("/api/purchase-orders/recommendations", headers=h).json()
                if p["product_id"] == line["product_id"] and p["warehouse"] == po["warehouse"])
    assert plan["draft_po_qty"] == line["quantity"]

    assert client.post(f"/api/purchase-orders/{po['id']}/status", headers=h,
                       json={"status": "Ordered"}).status_code == 409  # must be approved first
    assert client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h, json={}).status_code == 409
    a = client.post(f"/api/purchase-orders/{po['id']}/status", headers=h, json={"status": "Approved"}).json()
    assert a["status"] == "Approved" and a["approved_at"]
    o = client.post(f"/api/purchase-orders/{po['id']}/status", headers=h, json={"status": "Ordered"}).json()
    lead = math.ceil(next(s for s in client.get("/api/suppliers", headers=h).json()
                          if s["id"] == po["supplier_id"])["avg_lead_time_days"])
    assert o["expected_arrival_date"] == (date.today() + timedelta(days=lead)).isoformat()
    # ordered quantity now counts as "on order" in the inventory position
    plan2 = next(p for p in client.get("/api/purchase-orders/recommendations", headers=h).json()
                 if p["inventory_id"] == plan["inventory_id"])
    assert plan2["on_order"] == line["quantity"] and plan2["draft_po_qty"] == 0

    stock_before = inv(client, h, plan["inventory_id"])["available_stock"]
    too_much = client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h,
                           json={"items": [{"item_id": line["id"], "received_quantity": line["quantity"] + 1}]})
    assert too_much.status_code == 422
    partial = line["quantity"] - 1
    r = client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h,
                    json={"items": [{"item_id": line["id"], "received_quantity": partial}]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Received" and r.json()["actual_arrival_date"] == date.today().isoformat()
    assert r.json()["is_delayed"] is False
    assert inv(client, h, plan["inventory_id"])["available_stock"] == stock_before + partial
    t = client.get(f"/api/inventory/transactions?inventory_id={plan['inventory_id']}", headers=h).json()
    assert any(x["txn_type"] == "RECEIVED" and x["reference_label"] == po["po_number"] for x in t)
    assert client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h, json={}).status_code == 409  # twice
    assert client.post(f"/api/purchase-orders/{po['id']}/status", headers=h,
                       json={"status": "Cancelled"}).status_code == 409
    # suppliers with purchase orders keep their audit trail
    assert client.delete(f"/api/suppliers/{po['supplier_id']}", headers=h).status_code == 409


def test_manual_po_validation_and_inbound_delay(client, h):
    sup = client.get("/api/suppliers", headers=h).json()[-1]
    pid = client.get("/api/products", headers=h).json()[0]["id"]
    base = {"supplier_id": sup["id"], "warehouse": "Central DC", "items": [{"product_id": pid, "quantity": 10,
                                                                          "unit_cost": 2.5}]}
    assert client.post("/api/purchase-orders", headers=h, json={**base, "supplier_id": 999999}).status_code == 404
    assert client.post("/api/purchase-orders", headers=h, json={**base, "items": []}).status_code == 422
    assert client.post("/api/purchase-orders", headers=h,
                       json={**base, "items": [{"product_id": pid, "quantity": 0}]}).status_code == 422
    past = (date.today() - timedelta(days=3)).isoformat()
    assert client.post("/api/purchase-orders", headers=h, json={**base, "expected_arrival_date": past}).status_code == 422
    po = client.post("/api/purchase-orders", headers=h, json=base).json()
    assert po["total_amount"] == 25.0
    client.post(f"/api/purchase-orders/{po['id']}/status", headers=h, json={"status": "Approved"})
    client.post(f"/api/purchase-orders/{po['id']}/status", headers=h, json={"status": "Ordered"})
    with SessionLocal() as db:  # simulate time passing: the delivery is now 2 days overdue
        db.get(PurchaseOrder, po["id"]).expected_arrival_date = date.today() - timedelta(days=2)
        db.commit()
    got = client.get(f"/api/purchase-orders/{po['id']}", headers=h).json()
    assert got["is_delayed"] and got["days_late"] == 2
    report = client.get("/api/decision/report", headers=h).json()
    assert any(x["po_number"] == po["po_number"] for x in report["shipment_delay"]["inbound"])
    assert client.get("/api/dashboard/summary", headers=h).json()["cards"]["inbound_delayed"] >= 1
    ans = client.post("/api/assistant/ask", headers=h, json={"question": "Which purchase orders are awaiting receipt?"}).json()
    assert ans["type"] == "live_data" and po["po_number"] in ans["answer"] and "LATE" in ans["answer"]
    c = client.post(f"/api/purchase-orders/{po['id']}/status", headers=h, json={"status": "Cancelled"})
    assert c.json()["status"] == "Cancelled"


# ------------------------------------------------------------------------------------------ returns
def _delivered_order(client, h, qty=3):
    p, rec = stocked_product(client, h)
    o = new_order(client, h, [{"product_id": p["product_id"], "quantity": qty}]).json()
    for s in ["Confirmed", "Processing", "Ready for Shipment", "Shipped", "Delivered"]:
        assert set_status(client, h, o["id"], s).status_code == 200
    return client.get(f"/api/orders/{o['id']}", headers=h).json(), rec


def test_returns_workflow_and_restock(client, h):
    o, rec = _delivered_order(client, h, qty=3)
    line = o["items"][0]
    assert line["returnable_quantity"] == 3
    undelivered = new_order(client, h, [{"product_id": line["product_id"], "quantity": 1}]).json()
    assert client.post("/api/returns", headers=h, json={"sales_order_id": undelivered["id"], "reason": "Broken",
                                                        "items": [{"order_item_id": undelivered["items"][0]["id"],
                                                                   "quantity": 1}]}).status_code == 409
    body = {"sales_order_id": o["id"], "reason": "Wrong size", "items": [{"order_item_id": line["id"], "quantity": 4}]}
    assert client.post("/api/returns", headers=h, json=body).status_code == 422  # more than delivered
    assert client.post("/api/returns", headers=h, json={**body, "reason": ""}).status_code == 422  # missing reason
    body["items"][0]["quantity"] = 2
    r = client.post("/api/returns", headers=h, json=body)
    assert r.status_code == 201 and r.json()["status"] == "Requested" and r.json()["rma_number"].startswith("RMA-")
    rid = r.json()["id"]
    # only 1 unit left to return now
    body["items"][0]["quantity"] = 2
    assert client.post("/api/returns", headers=h, json=body).status_code == 422
    assert client.post(f"/api/returns/{rid}/status", headers=h, json={"status": "Restocked"}).status_code == 409
    for s in ["Approved", "Received"]:
        assert client.post(f"/api/returns/{rid}/status", headers=h, json={"status": s}).status_code == 200
    assert client.post(f"/api/returns/{rid}/status", headers=h, json={"status": "Inspected"}).status_code == 422
    insp = client.post(f"/api/returns/{rid}/status", headers=h,
                       json={"status": "Inspected", "inspection_outcome": "Restock", "notes": "Unused, tags on"})
    assert insp.json()["allowed_transitions"] == ["Restocked"]
    stock_before = inv(client, h, rec["id"])["available_stock"]
    done = client.post(f"/api/returns/{rid}/status", headers=h, json={"status": "Restocked"}).json()
    assert done["status"] == "Restocked" and done["restocked_units"] == 2
    assert inv(client, h, rec["id"])["available_stock"] == stock_before + 2
    t = client.get(f"/api/inventory/transactions?inventory_id={rec['id']}&txn_type=RETURNED", headers=h).json()
    assert t[0]["reference_label"] == done["rma_number"]


def test_damaged_return_is_not_restocked(client, h):
    o, rec = _delivered_order(client, h, qty=1)
    r = client.post("/api/returns", headers=h, json={"sales_order_id": o["id"], "reason": "Arrived damaged",
                                                     "items": [{"order_item_id": o["items"][0]["id"], "quantity": 1}]}).json()
    for s in ["Approved", "Received"]:
        client.post(f"/api/returns/{r['id']}/status", headers=h, json={"status": s})
    stock_before = inv(client, h, rec["id"])["available_stock"]
    insp = client.post(f"/api/returns/{r['id']}/status", headers=h,
                       json={"status": "Inspected", "inspection_outcome": "Dispose - damaged"}).json()
    assert insp["allowed_transitions"] == []
    assert client.post(f"/api/returns/{r['id']}/status", headers=h, json={"status": "Restocked"}).status_code == 409
    assert inv(client, h, rec["id"])["available_stock"] == stock_before
    eligible = client.get("/api/returns/eligible-orders", headers=h).json()
    assert all(x["id"] != o["id"] for x in eligible)  # nothing left to return


# ------------------------------------------------------------------------------------------ decision support
def test_decision_report(client, h):
    rep = client.get("/api/decision/report", headers=h).json()
    ov = rep["overview"]
    assert [d["key"] for d in ov["domains"]] == ["supplier", "inventory", "production", "transportation", "demand"]
    suppliers = client.get("/api/suppliers", headers=h).json()
    sd = ov["domains"][0]
    hi = sum(s["risk_level"] == "High" for s in suppliers)
    med = sum(s["risk_level"] == "Medium" for s in suppliers)
    assert sd["score"] == round((hi + 0.5 * med) / len(suppliers) * 100, 1)  # documented formula
    scored = [d["score"] for d in ov["domains"] if d["score"] is not None]
    assert ov["overall"]["score"] == round(sum(scored) / len(scored), 1)
    assert all(d["basis"] for d in ov["domains"])
    assert all(i["stockout_risk"] != "Low" for i in rep["inventory_shortage"]["items"])
    assert all(s["risk_level"] == "High" for s in rep["supplier_risk"]["suppliers"])
    for s in rep["supplier_risk"]["suppliers"]:
        assert all(a["risk_level"] != "High" for a in s["alternatives"])
    assert all(m["risk_level"] in ("High", "Medium") for m in rep["equipment"]["machines"])
    assert "not quantified" in rep["equipment"]["note"]
    assert rep["actions"] and rep["actions"][0]["priority"] == "High"
    assert {"overall", "domains"} <= set(client.get("/api/decision/overview", headers=h).json())


def test_dashboard_numbers_match_records(client, h):
    d = client.get("/api/dashboard/summary", headers=h).json()
    orders = client.get("/api/orders", headers=h).json()
    pos = client.get("/api/purchase-orders", headers=h).json()
    assert d["cards"]["total_orders"] == len(orders["items"])
    assert d["cards"]["open_purchase_orders"] == sum(pos["counts"][s] for s in ["Draft", "Approved", "Ordered"])
    assert d["cards"]["total_suppliers"] == len(client.get("/api/suppliers", headers=h).json())
    assert sum(x["count"] for x in d["charts"]["order_status"]) == d["cards"]["total_orders"]
    assert d["risk_overview"]["overall"]["score"] is not None and d["actions"]


# ------------------------------------------------------------------------------------------ assistant
@pytest.mark.parametrize("question,expect", [
    ("Which suppliers have the highest risk?", "suppliers"),
    ("Which products are below reorder level?", "reorder level"),
    ("Which products may experience stockouts?", "stockout"),
    ("What is the predicted demand for the next three months?", "exponential smoothing"),
    ("Which shipments have the highest delay probability?", "late-delivery probability"),
    ("Which machines require maintenance?", "maintenance"),
    ("Which orders are currently delayed?", "open orders"),
    ("Which purchase orders are awaiting receipt?", "Purchase orders by status"),
    ("What are the major current supply chain risks?", "Overall supply chain risk index"),
    ("What actions should management prioritize?", "Recommended priorities"),
    ("How many returns are there?", "Returns by status"),
])
def test_assistant_operational_questions(client, h, question, expect):
    a = client.post("/api/assistant/ask", headers=h, json={"question": question}).json()
    assert a["type"] == "live_data", a
    assert expect.lower() in a["answer"].lower(), a["answer"]


def test_assistant_concept_questions_still_use_docs(client, h):
    for q, src in [("How is the replenishment quantity calculated?", "Inventory planning with the forecast"),
                   ("How is the demand forecast calculated?", "Demand forecasting method"),
                   ("Explain the order statuses", "Customer order management, order statuses and fulfilment")]:
        a = client.post("/api/assistant/ask", headers=h, json={"question": q}).json()
        assert a["type"] == "documentation" and src in a["sources"], (q, a)
