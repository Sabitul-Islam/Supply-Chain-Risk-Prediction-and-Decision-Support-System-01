"""Customer master data (needed by orders; market / region / segment feed the late-delivery model)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..ml.predictor import shipment_options
from ..models import Customer, SalesOrder
from ..schemas import CustomerIn

router = APIRouter(prefix="/api/customers", tags=["customers"], dependencies=[Depends(get_current_user)])


def serialize(c: Customer, order_count: int = 0) -> dict:
    return {"id": c.id, "customer_code": c.customer_code, "name": c.name, "email": c.email, "segment": c.segment,
            "market": c.market, "order_region": c.order_region, "is_sample": c.is_sample,
            "order_count": order_count, "created_at": c.created_at}


def _validate(data: CustomerIn):
    """The model only understands DataCo values, so customers must use them."""
    opts = shipment_options()
    if not opts:
        return
    if data.segment not in opts["customer_segment"]:
        raise HTTPException(422, f"segment must be one of: {', '.join(opts['customer_segment'])}")
    if data.market not in opts["market"]:
        raise HTTPException(422, f"market must be one of: {', '.join(opts['market'])}")
    if data.order_region not in opts["region_by_market"].get(data.market, []):
        raise HTTPException(422, f"order_region '{data.order_region}' is not a region of market {data.market}.")


@router.get("")
def list_customers(db: Session = Depends(get_db)):
    counts = dict(db.query(SalesOrder.customer_id, func.count()).group_by(SalesOrder.customer_id).all())
    return [serialize(c, counts.get(c.id, 0)) for c in db.query(Customer).order_by(Customer.name).all()]


@router.post("", status_code=201)
def create(data: CustomerIn, db: Session = Depends(get_db)):
    _validate(data)
    if data.customer_code and db.query(Customer).filter(Customer.customer_code == data.customer_code).first():
        raise HTTPException(409, f"Customer code {data.customer_code} already exists.")
    c = Customer(**data.model_dump(exclude={"customer_code"}), customer_code=data.customer_code or "PENDING")
    db.add(c)
    db.flush()
    if not data.customer_code:
        c.customer_code = f"CUS-{c.id:04d}"
    db.commit()
    return serialize(c)


@router.put("/{customer_id}")
def update(customer_id: int, data: CustomerIn, db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Customer not found.")
    _validate(data)
    code = data.customer_code or c.customer_code
    if db.query(Customer).filter(Customer.customer_code == code, Customer.id != c.id).first():
        raise HTTPException(409, f"Customer code {code} already exists.")
    for k, v in data.model_dump(exclude={"customer_code"}).items():
        setattr(c, k, v)
    c.customer_code = code
    db.commit()
    return serialize(c, db.query(SalesOrder).filter(SalesOrder.customer_id == c.id).count())


@router.delete("/{customer_id}")
def delete(customer_id: int, db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Customer not found.")
    if db.query(SalesOrder).filter(SalesOrder.customer_id == c.id).count():
        raise HTTPException(409, "This customer has orders and cannot be deleted.")
    db.delete(c)
    db.commit()
    return {"detail": "Customer deleted"}
