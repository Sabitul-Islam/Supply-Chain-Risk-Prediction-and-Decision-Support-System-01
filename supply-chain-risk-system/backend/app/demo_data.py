"""OPTIONAL: create a small demonstration scenario through the real workflow services.

    python -m app.demo_data

Creates a few sample orders in different statuses, draft purchase orders from the reorder recommendations (one of
them approved and sent to the supplier) and one return request. Every record is labelled "DEMO" in its notes and uses
the fictional sample customers - nothing here is real-world data. It runs only when there are no orders yet, and it
uses the same business rules as the app (stock is reserved / dispatched / logged exactly as in normal use).
"""
import logging

from .database import Base, SessionLocal, engine
from .migrations import upgrade
from .models import Customer, InventoryItem, SalesOrder
from .schemas import OrderCreate
from .seed import seed_database
from .services import orders, purchasing, returns

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("demo")
NOTE = "DEMO scenario record (sample data created by python -m app.demo_data)"


def main():
    Base.metadata.create_all(bind=engine)
    upgrade(engine)
    with SessionLocal() as db:
        seed_database(db)
        if db.query(SalesOrder).count():
            log.info("Orders already exist - demo data not created (it only runs on an empty order book).")
            return
        customers = db.query(Customer).filter(Customer.is_sample.is_(True)).order_by(Customer.id).all()
        stock = sorted(db.query(InventoryItem).all(), key=lambda i: -(i.available_stock - i.reserved_stock))[:6]
        if len(customers) < 4 or len(stock) < 6:
            log.info("Not enough sample customers / stock records to build the demo.")
            return

        def make(cust, mode, lines, path):
            o = orders.create_order(db, OrderCreate(customer_id=cust.id, payment_type="DEBIT", shipping_mode=mode,
                                                    notes=NOTE, items=[{"product_id": i.product_id, "quantity": q}
                                                                       for i, q in lines]), None)
            for status in path:
                orders.change_status(db, o, status, None, note="DEMO")
            db.commit()
            log.info("Order %s -> %s (%s)", o.order_number, o.status, mode)
            return o

        delivered = make(customers[0], "Standard Class", [(stock[0], 4), (stock[1], 2)],
                         ["Confirmed", "Processing", "Ready for Shipment", "Shipped", "Delivered"])
        make(customers[1], "Second Class", [(stock[2], 3)], ["Confirmed", "Processing", "Ready for Shipment",
                                                              "Shipped"])
        make(customers[2], "First Class", [(stock[3], 5), (stock[4], 1)], ["Confirmed", "Processing"])
        make(customers[3], "Same Day", [(stock[5], 2)], ["Confirmed"])
        make(customers[0], "Standard Class", [(stock[1], 1)], [])

        r = returns.create_return(db, delivered.id, "DEMO: customer received the wrong size",
                                  [(delivered.items[0].id, 1)], None)
        db.commit()
        log.info("Return %s requested", r.rma_number)

        pos = purchasing.generate_from_plan(db, None)
        db.commit()
        log.info("%d draft purchase orders generated from reorder recommendations", len(pos))
        if pos:
            purchasing.change_status(db, pos[0], "Approved", None)
            purchasing.change_status(db, pos[0], "Ordered", None)
            pos[0].notes = (pos[0].notes or "") + f" | {NOTE}"
            db.commit()
            log.info("%s approved and ordered (expected %s)", pos[0].po_number, pos[0].expected_arrival_date)
    log.info("Demo scenario ready. Start the backend and open the Decision Support page.")


if __name__ == "__main__":
    main()
