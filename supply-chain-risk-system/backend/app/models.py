"""Database tables."""
from datetime import date, datetime, timezone

from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    predictions: Mapped[list["PredictionHistory"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150))
    country: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(80))
    on_time_delivery_rate: Mapped[float] = mapped_column(Float)   # %
    defect_rate: Mapped[float] = mapped_column(Float)             # %
    avg_lead_time_days: Mapped[float] = mapped_column(Float)
    lead_time_variability_days: Mapped[float] = mapped_column(Float)
    fulfillment_rate: Mapped[float] = mapped_column(Float)        # %
    financial_stability: Mapped[int] = mapped_column(Integer)     # 1 (weak) .. 5 (strong)
    risk_score: Mapped[float] = mapped_column(Float, default=0)
    risk_level: Mapped[str] = mapped_column(String(10), default="Low")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    products: Mapped[list["Product"]] = relationship(back_populates="supplier")


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # DataCo "Product Card Id"
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(100))
    department: Mapped[str] = mapped_column(String(100))
    price: Mapped[float] = mapped_column(Float)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)

    supplier: Mapped[Supplier | None] = relationship(back_populates="products")
    inventory_items: Mapped[list["InventoryItem"]] = relationship(back_populates="product", cascade="all, delete-orphan")
    shipments: Mapped[list["Shipment"]] = relationship(back_populates="product")


class InventoryItem(Base):
    __tablename__ = "inventory"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    warehouse: Mapped[str] = mapped_column(String(80))
    available_stock: Mapped[int] = mapped_column(Integer)
    reserved_stock: Mapped[int] = mapped_column(Integer)
    reorder_level: Mapped[int] = mapped_column(Integer)
    safety_stock: Mapped[int] = mapped_column(Integer)
    lead_time_days: Mapped[int] = mapped_column(Integer)
    avg_daily_demand: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    product: Mapped[Product] = relationship(back_populates="inventory_items")


class Machine(Base):
    __tablename__ = "machines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_code: Mapped[str] = mapped_column(String(30), index=True)
    machine_type: Mapped[str] = mapped_column(String(1))  # L / M / H quality variant
    air_temperature_k: Mapped[float] = mapped_column(Float)
    process_temperature_k: Mapped[float] = mapped_column(Float)
    rotational_speed_rpm: Mapped[float] = mapped_column(Float)
    torque_nm: Mapped[float] = mapped_column(Float)
    tool_wear_min: Mapped[float] = mapped_column(Float)
    failure_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_failure: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    actual_failure: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # label from dataset, if known
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Shipment(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[str] = mapped_column(String(30), index=True)
    order_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    category_name: Mapped[str] = mapped_column(String(100))
    department_name: Mapped[str] = mapped_column(String(100))
    market: Mapped[str] = mapped_column(String(50))
    order_region: Mapped[str] = mapped_column(String(80))
    customer_segment: Mapped[str] = mapped_column(String(50))
    payment_type: Mapped[str] = mapped_column(String(30))
    shipping_mode: Mapped[str] = mapped_column(String(30))
    scheduled_shipping_days: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    product_price: Mapped[float] = mapped_column(Float)
    discount_rate: Mapped[float] = mapped_column(Float)
    sales: Mapped[float] = mapped_column(Float)
    late_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_late: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    actual_late: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # label from dataset, if known
    # --- Outbound logistics tracking (added in v2; existing databases get these columns via app/migrations.py) ---
    # source: "dataco" = hold-out record from the DataCo test split, "manual" = prediction saved by a user / CSV,
    #         "order" = shipment created by the Order Management workflow
    source: Mapped[str | None] = mapped_column(String(20), nullable=True, default="manual")
    sales_order_id: Mapped[int | None] = mapped_column(ForeignKey("sales_orders.id", ondelete="SET NULL"),
                                                       nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Planned / In Transit / Delivered / Cancelled
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expected_delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    product: Mapped[Product | None] = relationship(back_populates="shipments")
    sales_order: Mapped["SalesOrder | None"] = relationship(back_populates="shipments")
    events: Mapped[list["ShipmentEvent"]] = relationship(back_populates="shipment", cascade="all, delete-orphan",
                                                         order_by="ShipmentEvent.id")


class PredictionHistory(Base):
    __tablename__ = "prediction_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    model_name: Mapped[str] = mapped_column(String(40))  # machine_failure | late_delivery
    source: Mapped[str] = mapped_column(String(20))      # manual | csv
    input_json: Mapped[str] = mapped_column(Text)
    prediction: Mapped[bool] = mapped_column(Boolean)
    probability: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(10))
    recommendation: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped[User] = relationship(back_populates="predictions")


class RevokedToken(Base):
    """JWT ids (jti) of tokens that were logged out. get_current_user rejects any token listed here."""
    __tablename__ = "revoked_tokens"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # after this the JWT is invalid anyway
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# =====================================================================================================
# v2: integrated supply chain workflows (orders, purchasing, stock movements, outbound tracking, returns)
# =====================================================================================================

class Customer(Base):
    """Customer master data. Seeded customers are clearly fictional sample records (is_sample = True)."""
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    segment: Mapped[str] = mapped_column(String(50))       # DataCo customer segment (Consumer / Corporate / Home Office)
    market: Mapped[str] = mapped_column(String(50))        # DataCo market (needed by the late-delivery model)
    order_region: Mapped[str] = mapped_column(String(80))  # DataCo order region
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    orders: Mapped[list["SalesOrder"]] = relationship(back_populates="customer")


class SalesOrder(Base):
    """Customer order. Status flow: Pending -> Confirmed -> Processing -> Ready for Shipment -> Shipped -> Delivered,
    with Cancelled allowed before shipment (see services/orders.py)."""
    __tablename__ = "sales_orders"
    __table_args__ = (CheckConstraint("total_amount >= 0", name="ck_order_total"),
                      CheckConstraint("discount_rate >= 0 AND discount_rate <= 1", name="ck_order_discount"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="Pending", index=True)
    order_date: Mapped[datetime] = mapped_column(DateTime)
    payment_type: Mapped[str] = mapped_column(String(30))
    shipping_mode: Mapped[str] = mapped_column(String(30))
    scheduled_shipping_days: Mapped[int] = mapped_column(Integer)
    discount_rate: Mapped[float] = mapped_column(Float, default=0)
    total_amount: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    customer: Mapped[Customer] = relationship(back_populates="orders")
    items: Mapped[list["SalesOrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan",
                                                         order_by="SalesOrderItem.id")
    shipments: Mapped[list[Shipment]] = relationship(back_populates="sales_order")
    returns: Mapped[list["ProductReturn"]] = relationship(back_populates="sales_order")


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"
    __table_args__ = (UniqueConstraint("order_id", "product_id", name="uq_order_product"),
                      CheckConstraint("quantity > 0", name="ck_order_item_qty"),
                      CheckConstraint("unit_price >= 0", name="ck_order_item_price"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    # stock location the line is reserved / dispatched from (chosen by the server)
    inventory_id: Mapped[int | None] = mapped_column(ForeignKey("inventory.id", ondelete="SET NULL"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Float)
    line_total: Mapped[float] = mapped_column(Float)
    late_probability: Mapped[float | None] = mapped_column(Float, nullable=True)  # DataCo model, per order line

    order: Mapped[SalesOrder] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()
    inventory: Mapped[InventoryItem | None] = relationship()


class ShipmentEvent(Base):
    """Status history of an outbound shipment (audit trail shown on the order / shipment)."""
    __tablename__ = "shipment_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    shipment: Mapped[Shipment] = relationship(back_populates="events")


class PurchaseOrder(Base):
    """Replenishment order to a supplier. Draft -> Approved -> Ordered -> Received, or Cancelled before receipt.
    expected_arrival_date / actual_arrival_date give the inbound-logistics view."""
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    po_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"), index=True)
    warehouse: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="Draft", index=True)
    source: Mapped[str] = mapped_column(String(30), default="manual")  # manual | reorder_recommendation
    expected_arrival_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_arrival_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_amount: Mapped[float | None] = mapped_column(Float, nullable=True)  # only when unit costs are entered
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    supplier: Mapped[Supplier] = relationship()
    items: Mapped[list["PurchaseOrderItem"]] = relationship(back_populates="purchase_order",
                                                            cascade="all, delete-orphan",
                                                            order_by="PurchaseOrderItem.id")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    __table_args__ = (UniqueConstraint("purchase_order_id", "product_id", name="uq_po_product"),
                      CheckConstraint("quantity > 0", name="ck_po_item_qty"),
                      CheckConstraint("received_quantity >= 0", name="ck_po_item_received"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    received_quantity: Mapped[int] = mapped_column(Integer, default=0)
    unit_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    purchase_order: Mapped[PurchaseOrder] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()


class InventoryTransaction(Base):
    """Every stock change (received, reserved, released, dispatched, adjusted, returned) with the stock after it.
    idempotency_key is unique, so the same business event can never move stock twice."""
    __tablename__ = "inventory_transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inventory_id: Mapped[int | None] = mapped_column(ForeignKey("inventory.id", ondelete="SET NULL"),
                                                     nullable=True, index=True)
    product_id: Mapped[int] = mapped_column(Integer, index=True)  # kept even if the inventory record is deleted
    warehouse: Mapped[str] = mapped_column(String(80))
    txn_type: Mapped[str] = mapped_column(String(20), index=True)
    quantity: Mapped[int] = mapped_column(Integer)            # units moved (always positive, except ADJUSTED)
    available_change: Mapped[int] = mapped_column(Integer)    # effect on available (on-hand) stock
    reserved_change: Mapped[int] = mapped_column(Integer)     # effect on reserved stock
    available_after: Mapped[int] = mapped_column(Integer)
    reserved_after: Mapped[int] = mapped_column(Integer)
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)  # sales_order | purchase_order | return | manual
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ProductReturn(Base):
    """Reverse logistics: Requested -> Approved -> Received -> Inspected -> Restocked, or Rejected."""
    __tablename__ = "product_returns"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rma_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    sales_order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="Requested", index=True)
    reason: Mapped[str] = mapped_column(String(300))
    inspection_outcome: Mapped[str | None] = mapped_column(String(40), nullable=True)
    inspection_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    sales_order: Mapped[SalesOrder] = relationship(back_populates="returns")
    items: Mapped[list["ReturnItem"]] = relationship(back_populates="product_return", cascade="all, delete-orphan",
                                                     order_by="ReturnItem.id")


class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (UniqueConstraint("return_id", "order_item_id", name="uq_return_order_item"),
                      CheckConstraint("quantity > 0", name="ck_return_item_qty"),
                      CheckConstraint("restocked_quantity >= 0", name="ck_return_item_restocked"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("product_returns.id", ondelete="CASCADE"), index=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("sales_order_items.id", ondelete="RESTRICT"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    quantity: Mapped[int] = mapped_column(Integer)
    restocked_quantity: Mapped[int] = mapped_column(Integer, default=0)

    product_return: Mapped[ProductReturn] = relationship(back_populates="items")
    order_item: Mapped[SalesOrderItem] = relationship()
    product: Mapped[Product] = relationship()
