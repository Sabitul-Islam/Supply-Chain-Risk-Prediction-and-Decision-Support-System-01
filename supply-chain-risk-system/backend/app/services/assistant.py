"""Lightweight project assistant.

* Operational questions ("which suppliers are high risk?", "how many shipment alerts?") are answered
  from live database queries.
* Conceptual questions ("how is supplier risk calculated?") are answered by retrieving the most relevant
  documentation section with TF-IDF cosine similarity (scikit-learn). No external API or LLM is used.
"""
import re
from functools import lru_cache

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..ml.predictor import load_metrics
from ..models import (Machine, PredictionHistory, ProductReturn, PurchaseOrder, SalesOrder, Shipment, Supplier,
                      User)

KB = [
    ("System overview",
     "The Supply Chain Risk Prediction and Decision Support System combines rule-based risk scoring and machine "
     "learning. Modules: Overview dashboard, Decision Support, Orders, Procurement (supplier risk), Purchase Orders, "
     "Production (machine failure prediction), Inventory (stockout risk, reorder, stock movements), Transportation "
     "(late delivery prediction, outbound and inbound tracking), Returns, Demand Analysis and Forecasting, AI "
     "Assistant and Prediction History. Backend FastAPI with SQLite and SQLAlchemy, frontend React Vite Tailwind Recharts."),
    ("Supplier risk calculation",
     "Supplier risk is rule based, score 0 to 100 where higher means riskier. Five factors are converted to 0-100 "
     "sub-scores: delivery = (100 - on-time delivery %) x 2.5, weight 30%; quality = defect rate % x 12.5, weight 25%; "
     "lead time = variability / average lead time x 200, weight 15%; fulfillment = (100 - fulfillment %) x 4, weight "
     "15%; financial = (5 - stability rating) / 4 x 100, weight 15%. Score below 35 is Low risk, 35 to 60 Medium, "
     "60 or more High. The largest sub-score determines the recommendation."),
    ("Inventory stockout risk and reorder calculation",
     "Net stock = available stock - reserved stock. Days of cover = net stock / average daily demand. High stockout "
     "risk if net stock is at or below safety stock or days of cover is less than the lead time. Medium risk if net "
     "stock is at or below the reorder level. Otherwise Low. Recommended order quantity = reorder level + average "
     "daily demand x 30 day review period - net stock. Safety stock = 1.65 x standard deviation of daily demand x "
     "square root of lead time (95% service level). Reorder level (reorder point) = average daily demand x lead time "
     "+ safety stock. Average daily demand and its variability come from real DataCo order history."),
    ("Machine failure prediction model",
     "The machine failure model is trained on the AI4I 2020 Predictive Maintenance dataset (10,000 records, about "
     "3.4% failures). Inputs: machine type L M H, air temperature K, process temperature K, rotational speed rpm, "
     "torque Nm, tool wear min, plus engineered temperature difference and mechanical power. The failure-mode "
     "columns TWF HDF PWF OSF RNF are excluded because they describe the failure itself (target leakage); UDI and "
     "Product ID are identifiers and are excluded. A Random Forest classifier with balanced class weights is used in "
     "the application and compared with Logistic Regression on a stratified 80/20 split."),
    ("Machine risk levels and maintenance recommendations",
     "Failure probability below 0.20 is Low risk, 0.20 to 0.50 Medium, 0.50 or more High and predicted as failure. "
     "High risk: schedule immediate maintenance. Medium: plan preventive maintenance within the next shift. Low: "
     "routine monitoring. Extra checks are added when tool wear is above 200 minutes, the process-air temperature "
     "gap is below 8.6 K, power is outside 3.5-9 kW, or torque is above 60 Nm."),
    ("Late delivery prediction model",
     "The late delivery model is trained on the DataCo Smart Supply Chain dataset (180,519 order lines). Target "
     "Late_delivery_risk. Inputs known at order time: payment type, shipping mode, scheduled shipping days, market, "
     "order region, product category, department, customer segment, quantity, product price, discount rate, sales, "
     "order month, weekday and hour. Excluded to prevent target leakage: actual days for shipping, delivery status, "
     "shipping date, order status and realised profit. Personal data such as customer names, email, password, street "
     "and zipcode is removed. The split groups by Order Id so items of one order are never in both train and test. "
     "Random Forest is used and compared with Logistic Regression."),
    ("Shipment risk levels and actions",
     "Late delivery probability below 0.40 is Low risk, 0.40 to 0.60 Medium, 0.60 or more High. High risk: upgrade "
     "the shipping mode or notify the customer and prioritise the order. Medium: monitor and confirm carrier pickup. "
     "Low: no action needed."),
    ("Demand analysis",
     "Demand analysis uses real DataCo order records aggregated by month, product and category (cancelled and "
     "suspected fraud orders excluded). The trend is a least-squares linear slope over the last 12 months, expressed "
     "as percent of mean demand per month: above +2% Increasing, below -2% Decreasing, otherwise Stable. A 3-month "
     "moving average is shown. The DataCo data has far fewer order lines from October 2017, so the consistent period "
     "January 2015 to September 2017 is the default for trend analysis."),
    ("Demand forecasting method",
     "The demand forecast uses simple exponential smoothing (SES), a statistical method, not a trained machine "
     "learning model. level = alpha x demand + (1 - alpha) x previous level; the forecast for the next 1-6 months is "
     "the last level. alpha between 0.1 and 0.9 is chosen per series by minimising one-step-ahead error. The 80% "
     "range is forecast plus or minus 1.28 x residual standard deviation. A back-test compares the forecast of the "
     "last 3 known months with a 3-month average baseline. At least 8 months of history are needed."),
    ("Inventory planning with the forecast",
     "Forecast results feed inventory planning. Planning demand rate = the higher of the historical average daily "
     "demand and the next-month forecast divided by 30.4 days. Demand-plan gap = (forecast rate - historical rate) "
     "/ historical rate: above +20% is High demand risk, above +5% Medium. Replenishment quantity = reorder level + "
     "planning rate x 30 days - (net stock + open purchase order quantity), only when stockout risk is Medium or High."),
    ("Supplier selection and purchase orders",
     "When stock falls to the reorder level the system identifies the product, calculates the replenishment "
     "quantity, finds suppliers of the product's department and ranks them: selection score = 0.7 x (100 - supplier "
     "risk score) + 0.3 x lead-time score, where lead-time score = 100 x shortest lead time / supplier lead time. "
     "High-risk suppliers are ranked last. Generate draft POs creates one draft purchase order per supplier and "
     "warehouse. Purchase order statuses: Draft, Approved, Ordered, Received, Cancelled. When ordered, the expected "
     "arrival date is the order date plus the supplier's average lead time. Receiving adds the received quantity to "
     "stock and records the actual arrival date, so late inbound deliveries are observed."),
    ("Customer order management, order statuses and fulfilment",
     "Customer orders contain one or more products and quantities. The total is quantity x product price x (1 - "
     "discount). Statuses: Pending, Confirmed, Processing, Ready for Shipment, Shipped, Delivered, Cancelled. An "
     "order larger than the unreserved stock is rejected. Confirming reserves stock and creates an outbound "
     "shipment scored by the late-delivery model (highest probability of the order lines). Cancelling before "
     "shipment releases the reservation. Shipping deducts the stock (dispatch). Delivery records the actual date; "
     "expected delivery = order date + scheduled shipping days. The shipping mode can be changed before dispatch "
     "and the order is re-scored."),
    ("Inventory transactions and stock movements",
     "All stock changes are recorded in the inventory transaction table: RECEIVED (purchase order receipt), "
     "RESERVED (order confirmed), RELEASED (order cancelled), DISPATCHED (order shipped), RETURNED (return "
     "restocked) and ADJUSTED (manual correction or record edit). Each movement stores the stock after the change. "
     "Updates are atomic conditional database updates, so stock can never go negative or be over-reserved, and a "
     "unique key prevents the same event from moving stock twice."),
    ("Returns and reverse logistics",
     "Returns can be registered for delivered orders only, up to the delivered quantity. Statuses: Requested, "
     "Approved, Received, Inspected, Restocked, Rejected. Inspection outcome is Restock, Dispose - damaged or "
     "Return to supplier - defective. Only returns inspected as Restock are added back to stock."),
    ("Decision support and integrated risk overview",
     "The decision support engine combines all modules into scenarios: inventory shortage, supplier risk exposure, "
     "shipment and inbound delay, production equipment failure, and an overall supply chain risk overview. Domain "
     "risk index = (High items + 0.5 x Medium items) / items assessed x 100. Overall index = average of the domain "
     "indices. Below 20 Low, 20 to 40 Medium, 40 or more High. Each result is labelled as ML prediction, rule-based "
     "assessment, statistical forecast, observed fact or sample data. Priority actions are ranked High, Medium, Low."),
    ("Data sources and sample data",
     "ai4i2020.csv and DataCoSupplyChainDataset.csv are the real datasets. suppliers.csv and inventory.csv were not "
     "provided, so sample templates were generated: supplier performance values are simulated, inventory stock "
     "quantities are simulated but demand rates come from real DataCo history. You can replace them by uploading "
     "your own CSV files on the Procurement and Inventory pages."),
    ("CSV upload",
     "CSV uploads are available on Procurement (suppliers), Inventory, Production (machine readings, predicted in "
     "batch) and Transportation (shipments, predicted in batch). Download the template button to get the required "
     "columns. Files must be .csv, at most 5 MB and 5000 rows. Each row is validated; invalid rows are rejected with "
     "the row number and reason while valid rows are saved."),
    ("Authentication and security",
     "Users sign up with full name, a valid email and a password of at least 8 characters with a letter and a number, "
     "confirmed twice. Duplicate emails are rejected. Passwords are hashed with bcrypt and never stored in plain text. "
     "Sign in returns a JWT access token (HS256) which protects every API route. The secret key is read from the .env "
     "file. Logout is enforced on the server: the token id is stored in a revoked tokens table and rejected."),
    ("Prediction history",
     "Every machine failure and late delivery prediction made by a user, manually or by CSV upload, is saved in the "
     "prediction history table with inputs, probability, risk level, recommendation and timestamp. Users can filter, "
     "delete single entries or clear their history."),
]

_LIVE_HINT = re.compile(r"\b(how many|which|list|show|top|current|currently|now|today|riskiest|highest|worst|alerts?|"
                        r"count|status|summary|any)\b")
_CONCEPT_HINT = re.compile(r"\b(calculat\w*|formula|how (is|are|does|do)|why|what is|what are|explain|define|meaning)\b")


@lru_cache(maxsize=1)
def _index():
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
    mat = vec.fit_transform([f"{t}. {t}. {body}" for t, body in KB])
    return vec, mat


def _retrieve(q: str):
    vec, mat = _index()
    sims = cosine_similarity(vec.transform([q]), mat)[0]
    order = sims.argsort()[::-1]
    return [(KB[i][0], KB[i][1], float(sims[i])) for i in order[:2]]


def _fmt_pct(x):
    return f"{x * 100:.1f}%"


# ------------------------------------------------------------------------------------------------------------
# Predefined operational queries. Each handler runs fixed, read-only ORM queries - the question text is only used
# to choose a handler, never to build SQL, so arbitrary database access is impossible.
# ------------------------------------------------------------------------------------------------------------
def _q_inventory(db, q):
    from ..routers.inventory import all_items
    items = all_items(db)
    below = [i for i in items if i["net_stock"] <= i["reorder_level"]]
    high = [i for i in items if i["stockout_risk"] == "High"]
    txt = (f"{len(below)} of {len(items)} inventory records are at or below their reorder level; {len(high)} have "
           "High stockout risk (net stock at or below safety stock, or days of cover shorter than the lead time).")
    if high:
        txt += "\nMost likely to stock out: " + "; ".join(
            f"{i['product_name']} ({i['warehouse']}: net {i['net_stock']}, cover {i['days_of_cover']} d vs lead time "
            f"{i['lead_time_days']} d)" for i in high[:5]) + "."
    rest = [i for i in below if i["stockout_risk"] != "High"]
    if rest:
        txt += "\nAlso below reorder level: " + ", ".join(
            f"{i['product_name']} (net {i['net_stock']} / reorder {i['reorder_level']})" for i in rest[:5]) + "."
    return txt + "\n(Rule-based assessment; stock levels are sample data.)"


def _q_forecast(db, q):
    from . import demand
    try:
        f = demand.total_forecast(3)
    except demand.DemandDataMissing as e:
        return str(e)
    if not f.get("available"):
        return f"The demand forecast is not available: {f.get('reason')}"
    rows = "; ".join(f"{r['month']}: {r['forecast']:,} units (80% range {r['lower']:,}-{r['upper']:,})"
                     for r in f["forecast"])
    b = f["backtest"]
    return (f"Forecast of total monthly demand (all products) for the 3 months after the last consistent DataCo "
            f"month {f['last_actual_month']}: {rows}. Method: simple exponential smoothing (alpha {f['alpha']}), a "
            f"statistical forecast, not a trained ML model. Back-test MAE {b['mae']:,} units vs baseline "
            f"{b['naive_mae']:,}.")


def _q_shipments_top(db, q):
    active = (db.query(Shipment).filter(Shipment.source == "order", Shipment.status.in_(("Planned", "In Transit")))
              .order_by(Shipment.late_probability.desc()).limit(5).all())
    txt = ""
    if active:
        txt = "Active order shipments with the highest predicted late-delivery probability: " + "; ".join(
            f"{s.order_id} ({s.shipping_mode}, {s.status}) {_fmt_pct(s.late_probability or 0)} - {s.risk_level}"
            for s in active) + ".\n"
    top = db.query(Shipment).filter(Shipment.late_probability.isnot(None)) \
        .order_by(Shipment.late_probability.desc()).limit(5).all()
    if not active:
        txt = "No active order shipments at the moment.\n"
    txt += "Highest predicted late-delivery probability across all shipment records: " + "; ".join(
        f"order {s.order_id} ({s.shipping_mode}) {_fmt_pct(s.late_probability)}" for s in top) + "."
    return txt + "\n(Random Forest prediction trained on DataCo.)"


def _q_maintenance(db, q):
    ms = db.query(Machine).filter(Machine.risk_level.in_(("High", "Medium"))) \
        .order_by(Machine.failure_probability.desc()).all()
    if not ms:
        return "No machine currently has Medium or High predicted failure risk."
    hi = [m for m in ms if m.risk_level == "High"]
    txt = (f"{len(hi)} machine(s) need immediate maintenance (High risk) and {len(ms) - len(hi)} need planned "
           "preventive maintenance (Medium risk).")
    txt += "\n" + "\n".join(f"- {m.machine_code}: {_fmt_pct(m.failure_probability)} - {m.recommendation}"
                             for m in ms[:5])
    return txt


def _q_delayed_orders(db, q):
    from .orders import shipment_delay_state
    open_orders = db.query(SalesOrder).filter(SalesOrder.status.notin_(("Delivered", "Cancelled"))).all()
    if not open_orders:
        return "There are no open customer orders, so no order is currently delayed."
    delayed, risky = [], []
    for o in open_orders:
        s = o.shipments[0] if o.shipments else None
        if s and shipment_delay_state(s)["is_delayed"]:
            delayed.append((o, shipment_delay_state(s)["days_late"]))
        elif s and s.risk_level == "High":
            risky.append((o, s.late_probability))
    txt = f"{len(open_orders)} open orders. {len(delayed)} are delayed (past their expected delivery date)"
    if delayed:
        txt += ": " + ", ".join(f"{o.order_number} ({d} day(s) late, {o.status})" for o, d in delayed[:8])
    txt += "."
    if risky:
        txt += f" {len(risky)} more have a High predicted late-delivery risk: " + ", ".join(
            f"{o.order_number} ({_fmt_pct(p)})" for o, p in risky[:8]) + "."
    return txt


def _q_purchase_orders(db, q):
    from .purchasing import inbound_state
    pos = db.query(PurchaseOrder).all()
    if not pos:
        return ("There are no purchase orders yet. Generate drafts from the reorder recommendations on the Purchase "
                "Orders page.")
    counts = {}
    for p in pos:
        counts[p.status] = counts.get(p.status, 0) + 1
    awaiting = [p for p in pos if p.status == "Ordered"]
    txt = "Purchase orders by status: " + ", ".join(f"{k} {v}" for k, v in counts.items()) + "."
    if awaiting:
        txt += f"\nAwaiting receipt ({len(awaiting)}): " + "; ".join(
            f"{p.po_number} from {p.supplier.name}, expected {p.expected_arrival_date}"
            + (f" - {inbound_state(p)['days_late']} day(s) LATE" if inbound_state(p)["is_delayed"] else "")
            for p in awaiting[:8]) + "."
    else:
        txt += "\nNo purchase order is currently awaiting receipt."
    drafts = [p for p in pos if p.status in ("Draft", "Approved")]
    if drafts:
        txt += f"\n{len(drafts)} draft/approved purchase order(s) have not been sent to suppliers yet."
    return txt


def _q_returns(db, q):
    rs = db.query(ProductReturn).all()
    if not rs:
        return "No product returns have been registered."
    counts = {}
    for r in rs:
        counts[r.status] = counts.get(r.status, 0) + 1
    return ("Returns by status: " + ", ".join(f"{k} {v}" for k, v in counts.items())
            + f". Units restocked so far: {sum(i.restocked_quantity for r in rs for i in r.items)}.")


def _q_orders(db, q):
    orders = db.query(SalesOrder).all()
    if not orders:
        return "No customer orders have been created yet (Orders page)."
    counts = {}
    for o in orders:
        counts[o.status] = counts.get(o.status, 0) + 1
    value = sum(o.total_amount for o in orders if o.status != "Cancelled")
    return (f"{len(orders)} customer orders: " + ", ".join(f"{k} {v}" for k, v in counts.items())
            + f". Value of non-cancelled orders: {value:,.2f}.")


def _q_risks(db, q):
    from .decision import _plans, risk_overview
    ov = risk_overview(db, _plans(db))
    o = ov["overall"]
    lines = [f"Overall supply chain risk index: {o['score']} ({o['level']})."]
    for d in sorted(ov["domains"], key=lambda d: -(d["score"] if d["score"] is not None else -1)):
        if d["score"] is None:
            lines.append(f"- {d['label']}: no data")
        else:
            c = d["counts"]
            lines.append(f"- {d['label']}: {d['score']} ({d['level']}) - {c['High']} High / {c['Medium']} Medium of "
                         f"{d['assessed']} {d['scope']}")
    return "\n".join(lines) + "\n" + ov["formula"]


def _q_actions(db, q):
    from .decision import _plans, priority_actions
    acts = priority_actions(db, _plans(db), limit=7)
    if not acts:
        return "No urgent actions: all monitored risks are Low."
    return "Recommended priorities (highest first):\n" + "\n".join(
        f"{n}. [{a['priority']}] {a['domain']}: {a['title']} - {a['detail']} ({a['basis']})"
        for n, a in enumerate(acts, 1))


_STRICT_CONCEPT = re.compile(r"\b(calculat\w*|formula|how (is|are|does|do)|why|explain|define|meaning|method\w*)\b")
STRONG_INTENTS = [  # checked in this order, only when the question is not conceptual
    (re.compile(r"purchase orders?|\bpos\b|awaiting receipt|inbound"), _q_purchase_orders),
    (re.compile(r"\breturns?\b|\brma\b|reverse logistics"), _q_returns),
    (re.compile(r"\borders?\b.*\b(delay\w*|late|overdue)\b|\b(delay\w*|late|overdue) orders?\b"), _q_delayed_orders),
    (re.compile(r"prioriti[sz]\w*|priority|what actions|actions? should|what should (we|i|management)"), _q_actions),
    (re.compile(r"\b(major|main|biggest|key|overall|current|top)\b.*\brisks\b|supply chain risks?|risk overview"),
     _q_risks),
    (re.compile(r"(predicted|forecast\w*|expected|future|next).{0,30}demand|demand.{0,30}(forecast|next|predict)"),
     _q_forecast),
    (re.compile(r"stock ?outs?|below (the |their )?reorder|reorder (level|point)|run(ning)? out|low stock"),
     _q_inventory),
    (re.compile(r"(requir|need)\w* maintenance|maintenance (is )?(needed|required)"), _q_maintenance),
    (re.compile(r"(highest|top|most|largest).{0,25}(delay|late)|delay probabilit"), _q_shipments_top),
]


def _live(q: str, db: Session, user: User):
    if not _STRICT_CONCEPT.search(q):
        for pattern, handler in STRONG_INTENTS:
            if pattern.search(q):
                return handler(db, q)
    code = re.search(r"sup-\d{3}", q)
    if code:
        s = db.query(Supplier).filter(func.lower(Supplier.supplier_code) == code.group(0)).first()
        if not s:
            return f"No supplier with code {code.group(0).upper()} was found."
        return (f"{s.supplier_code} {s.name} ({s.country}) has a risk score of {s.risk_score} - {s.risk_level} risk. "
                f"On-time delivery {s.on_time_delivery_rate}%, defect rate {s.defect_rate}%, fulfilment "
                f"{s.fulfillment_rate}%, lead time {s.avg_lead_time_days} +/- {s.lead_time_variability_days} days, "
                f"financial stability {s.financial_stability}/5.")
    if not _LIVE_HINT.search(q) or _CONCEPT_HINT.search(q):
        if not re.search(r"\b(accuracy|metrics?|performance|f1|precision|recall|auc)\b", q):
            return None
    if re.search(r"\b(accuracy|metrics?|performance|f1|precision|recall|auc|compare|comparison)\b", q):
        m = load_metrics()
        if not m:
            return "The models have not been trained yet. Run python -m app.ml.train."
        lines = []
        for key, label in [("machine_failure", "Machine failure"), ("late_delivery", "Late delivery")]:
            for model, r in m[key]["models"].items():
                lines.append(f"{label} - {model.replace('_', ' ')}: accuracy {_fmt_pct(r['accuracy'])}, precision "
                             f"{_fmt_pct(r['precision'])}, recall {_fmt_pct(r['recall'])}, F1 {r['f1']:.3f}, "
                             f"ROC-AUC {r['roc_auc']:.3f}")
        return "Hold-out test results from the last training run:\n" + "\n".join(lines)
    if re.search(r"suppliers?|procurement|vendor", q):
        counts = dict(db.query(Supplier.risk_level, func.count()).group_by(Supplier.risk_level).all())
        high = db.query(Supplier).filter(Supplier.risk_level == "High").order_by(Supplier.risk_score.desc()).limit(5).all()
        txt = (f"There are {sum(counts.values())} suppliers: {counts.get('High', 0)} High, {counts.get('Medium', 0)} "
               f"Medium and {counts.get('Low', 0)} Low risk.")
        if high:
            txt += " Highest risk: " + ", ".join(f"{s.name} ({s.risk_score})" for s in high) + "."
        return txt
    if re.search(r"machines?|production|maintenance|failures?", q):
        counts = dict(db.query(Machine.risk_level, func.count()).group_by(Machine.risk_level).all())
        top = db.query(Machine).filter(Machine.risk_level == "High").order_by(Machine.failure_probability.desc()).limit(5).all()
        txt = (f"{sum(counts.values())} machines are monitored: {counts.get('High', 0)} High, {counts.get('Medium', 0)} "
               f"Medium and {counts.get('Low', 0)} Low failure risk.")
        if top:
            txt += " Machine failure alerts: " + ", ".join(f"{m.machine_code} ({_fmt_pct(m.failure_probability)})" for m in top) + "."
        return txt
    if re.search(r"\borders?\b", q) and not re.search(r"shipments?|deliver\w*", q):
        return _q_orders(db, q)
    if re.search(r"shipments?|deliver\w*|late|delay\w*|transport\w*", q):
        counts = dict(db.query(Shipment.risk_level, func.count()).group_by(Shipment.risk_level).all())
        modes = db.query(Shipment.shipping_mode, func.avg(Shipment.late_probability)).group_by(Shipment.shipping_mode) \
            .order_by(func.avg(Shipment.late_probability).desc()).all()
        txt = (f"{sum(counts.values())} shipments are tracked: {counts.get('High', 0)} High, {counts.get('Medium', 0)} "
               f"Medium and {counts.get('Low', 0)} Low late-delivery risk.")
        if modes:
            txt += " Average late probability by mode: " + ", ".join(f"{m} {_fmt_pct(p)}" for m, p in modes) + "."
        return txt
    if re.search(r"inventory|stock\w*|reorder|warehouse", q):
        from ..routers.inventory import all_items
        items = all_items(db)
        alerts = [i for i in items if i["stockout_risk"] != "Low"]
        txt = (f"{len(items)} inventory records: {sum(i['stockout_risk'] == 'High' for i in items)} High and "
               f"{sum(i['stockout_risk'] == 'Medium' for i in items)} Medium stockout risk.")
        if alerts:
            txt += " Reorder now: " + ", ".join(f"{i['product_name']} ({i['recommended_order_qty']} units)" for i in alerts[:5]) + "."
        return txt
    if re.search(r"\b(my )?(predictions?|history)\b", q):
        n = db.query(PredictionHistory).filter(PredictionHistory.user_id == user.id).count()
        hi = db.query(PredictionHistory).filter(PredictionHistory.user_id == user.id,
                                                PredictionHistory.risk_level == "High").count()
        return f"You have made {n} predictions, {hi} of them classified as High risk."
    if re.search(r"summary|status|overview", q):
        return " ".join(filter(None, [_live(f"how many {w}", db, user) for w in ["suppliers", "machines", "shipments",
                                                                                "inventory", "orders"]]))
    return None


def answer(question: str, db: Session, user: User) -> dict:
    q = question.lower().strip()
    live = _live(q, db, user)
    if live:
        return {"answer": live, "type": "live_data", "sources": ["Live database query"]}
    hits = _retrieve(q)
    if hits[0][2] < 0.08:
        return {"answer": "I could not find that in the project documentation. Try asking about supplier risk, "
                          "machine failure prediction, late delivery prediction, inventory reorder rules, demand "
                          "trends, model accuracy, CSV uploads or security - or ask a live question such as "
                          "'Which suppliers are high risk?'.", "type": "fallback", "sources": []}
    text = hits[0][1]
    sources = [hits[0][0]]
    if hits[1][2] > 0.6 * hits[0][2] and hits[1][2] > 0.12:
        text += "\n\n" + hits[1][1]
        sources.append(hits[1][0])
    return {"answer": text, "type": "documentation", "sources": sources}


SUGGESTIONS = ["What are the major current supply chain risks?", "What actions should management prioritize?",
               "Which suppliers have the highest risk?", "Which products are below reorder level?",
               "Which products may experience stockouts?", "What is the predicted demand for the next three months?",
               "Which shipments have the highest delay probability?", "Which machines require maintenance?",
               "Which orders are currently delayed?", "Which purchase orders are awaiting receipt?",
               "How is the replenishment quantity calculated?", "What is the model accuracy?",
               "How is supplier risk calculated?", "How are passwords stored?"]
