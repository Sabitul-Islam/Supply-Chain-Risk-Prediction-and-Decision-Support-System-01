from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..ml.predictor import ModelNotAvailable, predict_shipments, shipment_options
from ..models import Product, Shipment, User
from ..schemas import ShipmentIn
from ..services.csv_utils import read_csv_upload, validate_rows
from ..services.history import record
from ..services.orders import serialize_shipment

router = APIRouter(prefix="/api/shipments", tags=["transportation"])
FEATURES = ["order_date", "payment_type", "shipping_mode", "scheduled_shipping_days", "market", "order_region",
            "category_name", "department_name", "customer_segment", "quantity", "product_price", "discount_rate"]


def serialize(s: Shipment) -> dict:
    d = {c.name: getattr(s, c.name) for c in Shipment.__table__.columns}
    d["product_name"] = s.product.name if s.product else None
    return d


def _inputs(data: ShipmentIn) -> dict:
    d = data.model_dump(exclude={"save_to_records"})
    if d["sales"] is None:
        d["sales"] = round(d["product_price"] * d["quantity"], 2)
    return d


def _validate_categories(d: dict):
    opts = shipment_options()
    for key in ["payment_type", "shipping_mode", "market", "order_region", "category_name", "department_name",
                "customer_segment"]:
        if opts.get(key) and d[key] not in opts[key]:
            raise ValueError(f"{key} '{d[key]}' is not a known value. Allowed: {', '.join(opts[key][:12])}"
                             + (" ..." if len(opts[key]) > 12 else ""))


def _predict(rows):
    try:
        return predict_shipments(rows)
    except ModelNotAvailable as e:
        raise HTTPException(503, str(e))


def _save(db, d, res):
    product_id = d.get("product_id") if d.get("product_id") and db.get(Product, d["product_id"]) else None
    s = Shipment(order_id=d.get("order_id") or f"NEW-{db.query(Shipment).count() + 1:05d}", source="manual",
                 order_date=d["order_date"], product_id=product_id,
                 **{k: d[k] for k in FEATURES if k != "order_date"}, sales=d["sales"],
                 late_probability=res["probability"], predicted_late=res["prediction"],
                 risk_level=res["risk_level"], recommendation=res["recommendation"])
    db.add(s)
    return s


@router.get("/options")
def options(user: User = Depends(get_current_user)):
    opts = shipment_options()
    if not opts:
        raise HTTPException(503, "Model options not found. Run: python -m app.ml.train")
    return opts


@router.get("")
def list_shipments(risk: str | None = Query(None, pattern="^(Low|Medium|High)$"), page: int = Query(1, ge=1),
                   page_size: int = Query(25, ge=1, le=200),
                   source: str | None = Query(None, pattern="^(dataco|manual|order)$"),
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Shipment)
    if risk:
        q = q.filter(Shipment.risk_level == risk)
    if source:
        q = q.filter(Shipment.source == source)
    total = q.count()
    items = q.order_by(Shipment.late_probability.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "page": page, "page_size": page_size, "items": [serialize(s) for s in items]}


@router.get("/outbound")
def outbound(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Outbound logistics: shipments created from customer orders, with status, dates and predicted delay risk."""
    rows = db.query(Shipment).filter(Shipment.source == "order").order_by(Shipment.id.desc()).all()
    out = []
    for s in rows:
        o = s.sales_order
        out.append({**serialize_shipment(s), "order_id": o.id if o else None,
                    "order_number": o.order_number if o else s.order_id,
                    "order_status": o.status if o else None, "customer_name": o.customer.name if o else None,
                    "market": s.market, "order_region": s.order_region, "units": s.quantity})
    active = [r for r in out if r["status"] in ("Planned", "In Transit")]
    return {"items": out, "summary": {"total": len(out), "active": len(active),
                                      "in_transit": sum(r["status"] == "In Transit" for r in out),
                                      "delivered": sum(r["status"] == "Delivered" for r in out),
                                      "delayed": sum(r["is_delayed"] for r in active),
                                      "delivered_late": sum(bool(r["delivered_late"]) for r in out),
                                      "high_risk_active": sum(r["risk_level"] == "High" for r in active)}}


@router.get("/stats")
def stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    by_mode = db.query(Shipment.shipping_mode, func.count(), func.avg(Shipment.late_probability),
                       func.sum(case((Shipment.predicted_late.is_(True), 1), else_=0))) \
        .group_by(Shipment.shipping_mode).all()
    by_risk = dict(db.query(Shipment.risk_level, func.count()).group_by(Shipment.risk_level).all())
    # model check only on DataCo hold-out records (their outcome is the real dataset label)
    labelled = db.query(Shipment).filter(Shipment.actual_late.isnot(None), Shipment.source == "dataco").all()
    by_source = dict(db.query(Shipment.source, func.count()).group_by(Shipment.source).all())
    correct = sum(1 for s in labelled if s.actual_late == s.predicted_late)
    return {"by_mode": [{"shipping_mode": m, "shipments": n, "avg_late_probability": round(p or 0, 3),
                         "predicted_late": int(pl or 0)} for m, n, p, pl in by_mode],
            "by_risk": {k: by_risk.get(k, 0) for k in ["Low", "Medium", "High"]},
            "by_source": {k: by_source.get(k, 0) for k in ["dataco", "manual", "order"]},
            "records_with_known_outcome": len(labelled),
            "accuracy_on_records": round(correct / len(labelled), 4) if labelled else None}


@router.post("/predict")
def predict(data: ShipmentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = _inputs(data)
    try:
        _validate_categories(d)
    except ValueError as e:
        raise HTTPException(422, str(e))
    res = _predict([d])[0]
    record(db, user.id, "late_delivery", "manual", d, res)
    if data.save_to_records:
        _save(db, d, res)
    db.commit()
    return {"input": d, **res}


@router.get("/template", response_class=PlainTextResponse)
def template(user: User = Depends(get_current_user)):
    return ("order_id," + ",".join(FEATURES) + "\n"
            "ORD-1,2018-01-15 10:30,DEBIT,Second Class,2,Europe,Western Europe,Cleats,Apparel,Consumer,2,59.99,0.05\n"
            "ORD-2,2018-01-16 14:00,CASH,Standard Class,4,LATAM,South America,Fishing,Fan Shop,Corporate,1,399.98,0.1\n")


@router.post("/upload")
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    df = await read_csv_upload(file, FEATURES)
    cols = FEATURES + [c for c in ["order_id", "sales", "product_id"] if c in df.columns]
    if "order_id" in df.columns:
        df["order_id"] = df["order_id"].astype(str)
    valid, errors = validate_rows(df, ShipmentIn, cols)
    rows = []
    for v in valid:
        d = _inputs(v)
        try:
            _validate_categories(d)
            rows.append(d)
        except ValueError as e:
            errors.append({"row": d.get("order_id") or "-", "error": str(e)})
    if not rows:
        return {"processed": 0, "rejected": len(errors), "errors": errors[:25], "results": []}
    results = _predict(rows)
    out = []
    for d, res in zip(rows, results):
        record(db, user.id, "late_delivery", "csv", d, res)
        s = _save(db, d, res)
        out.append({"order_id": s.order_id, "shipping_mode": d["shipping_mode"], **res})
    db.commit()
    return {"processed": len(out), "rejected": len(errors), "errors": errors[:25], "results": out[:200]}
