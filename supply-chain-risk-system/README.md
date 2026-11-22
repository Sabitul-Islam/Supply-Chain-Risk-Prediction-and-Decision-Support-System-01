# Supply Chain Risk Prediction and Decision Support System Using Machine Learning

An undergraduate capstone project: a lightweight full-stack web application that combines rule-based risk scoring and
machine learning to support supply chain decisions in procurement, production, inventory, transportation and demand.

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, Tailwind CSS v4, Recharts, React Router |
| Backend | Python, FastAPI, SQLAlchemy 2, SQLite |
| Machine learning | pandas, scikit-learn (Random Forest vs Logistic Regression), joblib |
| Authentication | JWT (PyJWT, HS256) + bcrypt password hashing |

---

## 1. Features

| Module | What it does | Method |
|---|---|---|
| **Sign up / Sign in / Logout** | Email validation, password confirmation, password strength rules, duplicate-email prevention, protected routes | bcrypt + JWT |
| **Overview** | Totals (suppliers, products, shipments, machines), high-risk suppliers, machine failure alerts, shipment delay alerts, inventory alerts, charts and alert lists. Every number comes from the database. | Aggregation |
| **Procurement** | Supplier records with add / edit / delete, CSV upload, risk score 0-100, Low/Medium/High, factor breakdown and recommendation | Rule-based |
| **Production** | Machine measurements, failure probability, risk level, maintenance recommendation, single and batch (CSV) prediction, RF vs LR comparison | **Random Forest** (AI4I 2020) |
| **Inventory** | Available / reserved / net stock, reorder level, safety stock, days of cover, stockout risk, recommended order quantity, CRUD, CSV upload | Rule-based |
| **Transportation** | Shipment records, late-delivery probability, risk level, recommended action, single and batch (CSV) prediction, RF vs LR comparison | **Random Forest** (DataCo) |
| **Demand Analysis** | Monthly demand per product and category, 3-month moving average, linear trend (Increasing / Stable / Decreasing) | Aggregation + least-squares slope |
| **AI Assistant** | Answers questions about the system, calculations and models (TF-IDF retrieval over project documentation) and live operational questions (database queries). No external AI service or API key needed. | TF-IDF + SQL |
| **Prediction History** | Every prediction a user makes (manual or CSV) with inputs, probability, risk level and recommendation. Filter, view details, delete or clear. | Database |

---

## 2. Project structure

```
supply-chain-risk-system/
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app, startup (create tables + seed)
│   │   ├── config.py            Settings from backend/.env, data paths
│   │   ├── database.py          SQLAlchemy engine / session (SQLite)
│   │   ├── models.py            Tables: users, suppliers, products, inventory, machines, shipments, prediction_history
│   │   ├── schemas.py           Pydantic validation (email, password, ranges)
│   │   ├── auth.py              bcrypt hashing, JWT creation / verification
│   │   ├── seed.py              Loads data/operational/*.csv into empty tables
│   │   ├── routers/             auth, dashboard, suppliers, inventory, production, transportation,
│   │   │                        demand, assistant, history, models_info
│   │   ├── services/            risk.py (rules), demand.py, assistant.py, csv_utils.py, history.py
│   │   └── ml/
│   │       ├── features.py      Feature lists, leakage exclusions, risk thresholds, recommendations
│   │       ├── prepare_data.py  Demand aggregates, product catalogue, sample supplier/inventory templates
│   │       ├── train.py         Trains & evaluates RF and LR for both tasks, saves models + metrics.json
│   │       └── predictor.py     Loads joblib models, produces predictions
│   ├── tests/test_app.py        Automated API tests (pytest)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/          Layout (sidebar), UI kit, charts, CSV upload, model metrics
│   │   ├── pages/               Login, Register, Overview, Procurement, Production, Inventory,
│   │   │                        Transportation, Demand, Assistant, History
│   │   ├── services/            api.js (fetch + JWT), auth.jsx (context), useApi.js
│   │   ├── App.jsx, main.jsx, index.css
│   ├── index.html, vite.config.js, package.json
├── data/
│   ├── raw/                     ai4i2020.csv, DataCoSupplyChainDataset.csv (your downloaded datasets)
│   ├── operational/             suppliers.csv, inventory.csv, products.csv, machines.csv, shipments.csv
│   ├── processed/               Monthly demand aggregates and product demand statistics
│   └── models/                  *.joblib models, metrics.json, shipment_options.json
├── setup_windows.bat, start_backend.bat, start_frontend.bat
├── README.md
└── .gitignore
```

---

## 3. Requirements

* **Windows 11**
* **Python 3.11, 3.12 or 3.13** (64-bit). Install from python.org and tick **"Add python.exe to PATH"**.
* **Node.js 20.19+ or 22 LTS** (includes npm) from nodejs.org.

Check them in a new Command Prompt:

```bash
python --version
```

```bash
node --version
```

---

## 4. Installation and running (Windows 11)

Unzip the project, e.g. to `C:\Projects\supply-chain-risk-system`.

### Option A: helper scripts (double-click)

1. `setup_windows.bat`: one-time setup. Creates the virtual environment, installs packages, trains both models and installs the frontend packages (about 2-5 minutes).
2. `start_backend.bat`: starts the API at http://127.0.0.1:8000
3. `start_frontend.bat`: starts the web app at http://localhost:5173 (run it in a second window)

Then open **http://localhost:5173**, click **Create one** and register an account.

### Option B: manual commands (Command Prompt)

**Terminal 1: backend**

```bash
cd C:\Projects\supply-chain-risk-system\backend
```

```bash
python -m venv .venv
```

```bash
.venv\Scripts\activate
```

```bash
pip install -r requirements.txt
```

```bash
copy .env.example .env
```

```bash
python -m app.ml.train
```

```bash
uvicorn app.main:app --reload --port 8000
```

> PowerShell users: activate with `.venv\Scripts\Activate.ps1`. If scripts are blocked, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or simply use Command Prompt.

**Terminal 2: frontend**

```bash
cd C:\Projects\supply-chain-risk-system\frontend
```

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:5173**. Interactive API documentation is available at **http://127.0.0.1:8000/docs**.

### Configuration and database

* `backend/.env` holds `SECRET_KEY`, token lifetime and database location. If `SECRET_KEY` is empty, the backend
  generates a random 256-bit key on first start and saves it to `backend/.env`. No secret is hardcoded in the source.
* The SQLite database `backend/supply_chain.db` is created automatically on first start, and empty tables are filled
  from `data/operational/*.csv`. Machines and shipments are seeded **with real model predictions**.
* **Reset the database:** stop the backend, delete `backend\supply_chain.db`, start the backend again.
* **Retrain the models:** `python -m app.ml.train` (then delete the database so seeded predictions are refreshed).

### Run the automated tests

```bash
cd C:\Projects\supply-chain-risk-system\backend
```

```bash
.venv\Scripts\activate
```

```bash
python -m pytest -q
```

The tests cover registration validation, duplicate emails, bcrypt hashing, login, JWT-protected routes, the supplier
and inventory formulas, both ML prediction endpoints, CSV upload validation, CRUD, history, demand and the assistant.
They use a temporary database, so your data is not touched.

---

## 5. Datasets

| File | Source | Status | Used for |
|---|---|---|---|
| `data/raw/ai4i2020.csv` | AI4I 2020 Predictive Maintenance Dataset (UCI) | **Provided by you** (10,000 rows, 14 columns) | Machine failure model |
| `data/raw/DataCoSupplyChainDataset.csv` | DataCo Smart Supply Chain (Mendeley / Kaggle) | **Provided by you** (180,519 rows, 53 columns, ISO-8859-1) | Late-delivery model, products, demand |
| `data/operational/suppliers.csv` | Not included in your downloads | **Generated sample template** (20 fictional suppliers) | Procurement |
| `data/operational/inventory.csv` | Not included in your downloads | **Generated sample template** (60 records for the top-selling DataCo products) | Inventory |

**What is missing and how it was handled:** you did not provide supplier or inventory files, and public supply chain
datasets do not contain them for the DataCo products. `app/ml/prepare_data.py` therefore creates small sample templates:

* **Suppliers:** performance values (on-time %, defect %, lead time, fulfilment %, financial rating) are *simulated*
  with a fixed random seed. Supplier names are fictional. Each DataCo department is assigned to a supplier.
* **Inventory:** average daily demand and its standard deviation are **computed from real DataCo order lines**. Safety
  stock and reorder level use the standard formulas (below). Only the current stock quantities are simulated.
* Both can be replaced at any time through **CSV upload** in the app, or by replacing the files in
  `data/operational/` and resetting the database.

Your zip also contained `train.csv`, `test.csv` and `sample_submission.csv` (Kaggle *Store Item Demand Forecasting*).
They are not one of the required datasets: the brief specifies DataCo order records for demand analysis. So they
are not used, which keeps the project to two ML models.

### Data preparation

* **Duplicates:** exact duplicate rows are removed (none were found in either dataset).
* **Missing values:** the features used have no missing values. The pipelines still include `SimpleImputer`
  (median / most frequent), so uploaded CSVs with gaps are handled. Rows with a missing target are dropped.
* **Personal information removed (DataCo):** customer email, first/last name, password, street, zipcode, customer IDs,
  latitude/longitude, order zipcode, product image URL and description.
* **Demand:** cancelled and suspected-fraud orders are excluded. Note that from **October 2017** the DataCo file
  contains about 80% fewer order lines and a different product mix. This comes from the dataset itself, so trend
  analysis defaults to the *consistent period* January 2015 to September 2017. The full period can be selected in the UI.

---

## 6. Machine learning models

Both tasks train a **Random Forest Classifier** (used by the application) and a **Logistic Regression** baseline
(with standard scaling and balanced class weights). Both are evaluated on the same hold-out test set. The pipelines
(preprocessing + model) are saved with joblib in `data/models/`. The metrics shown in the app are read from
`data/models/metrics.json`, which the training script writes. Nothing is hardcoded.

### 6.1 Machine failure: AI4I 2020

* **Target:** `Machine failure` (3.39% positive, so it is imbalanced: RF uses `class_weight="balanced_subsample"`)
* **Inputs:** `Type` (L/M/H), air temperature, process temperature, rotational speed, torque, tool wear, plus
  engineered `temp_diff_k` (process − air) and `power_w` (torque × ω). These are derived from inputs only.
* **Excluded (target leakage):** `TWF`, `HDF`, `PWF`, `OSF`, `RNF`. These failure-mode flags describe the failure itself.
  **Excluded (identifiers):** `UDI`, `Product ID`.
* **Split:** stratified 80/20, `random_state=42` (8,000 train / 2,000 test)

Results on the 2,000-row test set (from the training run included in this package):

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| **Random Forest** | 0.990 | 0.912 | 0.765 | **0.832** | **0.970** |
| Logistic Regression | 0.859 | 0.177 | 0.868 | 0.294 | 0.934 |

RF confusion matrix: TN 1,927 · FP 5 · FN 16 · TP 52. Logistic Regression finds slightly more failures, but it raises
274 false alarms, so its F1 is much lower. Random Forest is the better operational choice. The most important
features are torque, tool wear, rotational speed and power.

**Risk levels:** failure probability < 0.20 Low, 0.20-0.50 Medium, ≥ 0.50 High (predicted failure).
Maintenance recommendations add specific checks for tool wear > 200 min, temperature gap < 8.6 K, power outside
3.5-9 kW and torque > 60 Nm.

### 6.2 Late delivery: DataCo Smart Supply Chain

* **Target:** `Late_delivery_risk` (54.8% positive)
* **Inputs (all known when the order is placed):** payment type, shipping mode, scheduled shipping days, market, order
  region, category, department, customer segment, quantity, product price, discount rate, sales, order month,
  weekday and hour.
* **Excluded (post-shipment information / leakage):** `Days for shipping (real)`, `Delivery Status`,
  `shipping date (DateOrders)`, `Order Status`, `Benefit per order`, `Order Profit Per Order`, `Order Item Profit Ratio`.
* **Split:** 80/20 `GroupShuffleSplit` by `Order Id` (144,650 train / 35,869 test rows). Items of the same order share
  the same shipment, so grouping prevents the same order from appearing in both train and test.

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| **Random Forest** | 0.716 | 0.852 | 0.584 | **0.693** | **0.768** |
| Logistic Regression | 0.696 | 0.846 | 0.544 | 0.662 | 0.741 |

These scores are lower than the ~97% often reported online for this dataset. That is expected: those results
usually include `Days for shipping (real)` or `Delivery Status`, which leak the answer. Without leakage, the
strongest predictors are scheduled shipping days and shipping mode. First Class orders are late about 95% of the
time in this data.

**Risk levels:** late probability < 0.40 Low, 0.40-0.60 Medium, ≥ 0.60 High, each with a recommended action.

> If you retrain, numbers may differ slightly between scikit-learn versions. The app always shows the metrics of the
> models actually loaded.

---

## 7. Rule-based calculations

### Supplier risk score (0-100, higher = riskier)

| Factor | Sub-score (capped 0-100) | Weight |
|---|---|---|
| Delivery | (100 − on-time delivery %) × 2.5 | 30% |
| Quality | defect rate % × 12.5 | 25% |
| Lead-time variability | variability ÷ average lead time × 200 | 15% |
| Fulfilment | (100 − fulfilment %) × 4 | 15% |
| Financial | (5 − stability rating) ÷ 4 × 100 | 15% |

Score < 35 **Low**, 35-60 **Medium**, ≥ 60 **High**. The factor with the highest sub-score drives the recommendation.

### Inventory stockout risk

* Net stock = available − reserved, and days of cover = net ÷ average daily demand
* **High:** net ≤ safety stock **or** days of cover < lead time. **Medium:** net ≤ reorder level. **Low:** otherwise.
* Recommended order quantity = reorder level + 30 days of demand − net stock
* Safety stock = 1.65 × σ(daily demand) × √lead time (95% service level)
* Reorder level = average daily demand × lead time + safety stock

### Demand trend

Least-squares slope over the last 12 months of the selected period, expressed as % of mean monthly demand:
> +2% **Increasing**, < −2% **Decreasing**, otherwise **Stable**. A 3-month moving average is also shown.

---

## 8. Security

* Passwords are hashed with **bcrypt** (cost 12, unique salt) and are never stored or returned in plain text.
* Registration requires a valid email, a 8-64 character password with at least one letter and one number, and a
  matching confirmation. Emails are stored lowercase and must be unique (HTTP 409 on duplicates).
* Sign in returns a **JWT** (HS256, 120-minute expiry by default). Every API route except register/login/health
  requires it, and the frontend redirects to the login page when the token is missing or expired.
* Logout removes the token from the browser.
* CSV uploads are limited to `.csv`, 5 MB and 5,000 rows, and every row is validated.

---

## 9. CSV upload formats

Use the **Template** button on each page to download a correctly formatted example.

| Page | Required columns |
|---|---|
| Procurement | `supplier_code,name,country,category,on_time_delivery_rate,defect_rate,avg_lead_time_days,lead_time_variability_days,fulfillment_rate,financial_stability` |
| Inventory | `product_id,warehouse,available_stock,reserved_stock,reorder_level,safety_stock,lead_time_days,avg_daily_demand` |
| Production | `machine_type,air_temperature_k,process_temperature_k,rotational_speed_rpm,torque_nm,tool_wear_min` (+ optional `machine_code`) |
| Transportation | `order_date,payment_type,shipping_mode,scheduled_shipping_days,market,order_region,category_name,department_name,customer_segment,quantity,product_price,discount_rate` (+ optional `order_id,sales,product_id`) |

Invalid rows are rejected with the row number and reason, and valid rows are still processed.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot reach the server` on the login page | The backend is not running. Start it (Terminal 1) on port 8000. |
| `Model file ... not found` | Run `python -m app.ml.train` in `backend` with the venv activated. |
| `'uvicorn' is not recognized` | Activate the virtual environment first: `.venv\Scripts\activate` |
| Port already in use | Close the other program, or change `--port` (and the proxy target in `frontend/vite.config.js`). |
| Warning about scikit-learn version | Retrain: `python -m app.ml.train`, then delete `backend\supply_chain.db`. |
| Want a clean demo | Stop the backend and delete `backend\supply_chain.db`. It is recreated and re-seeded on start. |

---

## 11. Limitations and possible extensions

* Supplier records and inventory stock levels are sample data. Connect real ERP exports via CSV upload.
* DataCo contains historical orders only, so the "live" shipments are unseen hold-out orders from the test split
  (their actual outcome is shown for comparison).
* The assistant is retrieval-based, not a generative language model. It answers from the documentation and database.
* Possible extensions: probability calibration, threshold tuning per business cost, a demand forecasting model,
  role-based access control, and a PostgreSQL database for multi-user deployment.
