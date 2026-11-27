"""Lightweight, additive schema migration for existing SQLite databases.

The project has no Alembic. On every start, `Base.metadata.create_all` creates *new* tables, and this module adds any
*new columns* to tables that already exist (SQLite supports ALTER TABLE ... ADD COLUMN). Nothing is ever dropped or
rewritten, so existing users, suppliers, inventory and prediction history are preserved when upgrading.
"""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

log = logging.getLogger("migrations")

# table -> [(column, SQL type + default)]. Only nullable / defaulted columns can be added safely.
ADDED_COLUMNS = {
    "shipments": [
        ("source", "VARCHAR(20)"),
        ("sales_order_id", "INTEGER REFERENCES sales_orders(id) ON DELETE SET NULL"),
        ("status", "VARCHAR(20)"),
        ("shipped_at", "DATETIME"),
        ("expected_delivery_date", "DATE"),
        ("actual_delivery_date", "DATE"),
    ],
}


def upgrade(engine: Engine) -> list[str]:
    """Add missing columns. Returns a list of 'table.column' that were added."""
    added = []
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in ADDED_COLUMNS.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                    added.append(f"{table}.{name}")
        if "shipments.source" in added:
            # Classify rows that existed before the upgrade: seeded hold-out records carry the real DataCo outcome.
            conn.execute(text("UPDATE shipments SET source = CASE WHEN actual_late IS NOT NULL THEN 'dataco' "
                              "ELSE 'manual' END WHERE source IS NULL"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_shipments_sales_order_id ON shipments (sales_order_id)"))
    if added:
        log.info("Database upgraded, added columns: %s", ", ".join(added))
    return added
