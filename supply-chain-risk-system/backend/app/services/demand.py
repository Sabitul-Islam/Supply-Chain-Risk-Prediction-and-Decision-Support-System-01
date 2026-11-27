"""Demand analysis on real DataCo order lines (pre-aggregated by app.ml.prepare_data)."""
from functools import lru_cache

import numpy as np
import pandas as pd

from ..config import PROCESSED_DIR

# From Oct 2017 the DataCo dataset contains ~80 % fewer order lines and a different product mix.
# The "consistent" period excludes these months so that trends are not distorted by this data artefact.
CONSISTENT_END = "2017-09"


class DemandDataMissing(RuntimeError):
    pass


@lru_cache(maxsize=None)
def _load(name: str) -> pd.DataFrame:
    path = PROCESSED_DIR / name
    if not path.exists():
        raise DemandDataMissing("Demand data not found. Run: python -m app.ml.train")
    return pd.read_csv(path)


def clear_cache():
    _load.cache_clear()


def _filter(df: pd.DataFrame, period: str) -> pd.DataFrame:
    return df[df["month"] <= CONSISTENT_END] if period == "consistent" else df


def trend(series: pd.Series, months: int = 12) -> dict:
    """Least-squares linear trend over the last `months` points, expressed as % of the mean per month."""
    s = series.tail(months).astype(float)
    if len(s) < 3 or s.mean() == 0:
        return {"direction": "Insufficient data", "slope_per_month": 0.0, "pct_per_month": 0.0, "months": len(s)}
    slope = float(np.polyfit(np.arange(len(s)), s.values, 1)[0])
    pct = slope / float(s.mean()) * 100
    direction = "Increasing" if pct > 2 else ("Decreasing" if pct < -2 else "Stable")
    return {"direction": direction, "slope_per_month": round(slope, 2), "pct_per_month": round(pct, 2), "months": len(s)}


def _series(df: pd.DataFrame) -> list[dict]:
    df = df.sort_values("month").copy()
    df["moving_avg_3m"] = df["quantity"].rolling(3, min_periods=1).mean().round(1)
    return df.to_dict("records")


def overview(period: str) -> dict:
    total = _filter(_load("demand_monthly_total.csv"), period)
    stats = _load("product_demand_stats.csv")
    prod = _filter(_load("demand_monthly_product.csv"), period)
    cat = _filter(_load("demand_monthly_category.csv"), period)
    top = (prod.groupby("product_id").agg(quantity=("quantity", "sum"), sales=("sales", "sum")).reset_index()
              .merge(stats[["product_id", "name", "category"]], on="product_id")
              .sort_values("quantity", ascending=False).head(10))
    cats = cat.groupby("category").agg(quantity=("quantity", "sum"), sales=("sales", "sum")).reset_index() \
        .sort_values("sales", ascending=False).head(10)
    return {"period": period, "months": _series(total), "trend": trend(total.sort_values("month")["quantity"]),
            "totals": {"quantity": int(total["quantity"].sum()), "sales": round(float(total["sales"].sum()), 2),
                       "orders": int(total["orders"].sum())},
            "top_products": top.round(2).to_dict("records"), "categories": cats.round(2).to_dict("records"),
            "note": "From Oct 2017 the DataCo dataset contains far fewer order lines. Use the 'Consistent period' "
                    "(Jan 2015 - Sep 2017) for trend analysis."}


def products(period: str) -> list[dict]:
    stats = _load("product_demand_stats.csv")
    prod = _filter(_load("demand_monthly_product.csv"), period)
    out = []
    for pid, g in prod.groupby("product_id"):
        g = g.sort_values("month")
        out.append({"product_id": int(pid), "quantity": int(g["quantity"].sum()), "sales": round(float(g["sales"].sum()), 2),
                    "active_months": len(g), "last_month": g["month"].iloc[-1], "trend": trend(g["quantity"])["direction"]})
    df = pd.DataFrame(out).merge(stats[["product_id", "name", "category", "department", "avg_daily_demand"]], on="product_id")
    return df.sort_values("quantity", ascending=False).to_dict("records")


def product_detail(product_id: int, period: str) -> dict | None:
    stats = _load("product_demand_stats.csv")
    row = stats[stats["product_id"] == product_id]
    if row.empty:
        return None
    g = _filter(_load("demand_monthly_product.csv"), period)
    g = g[g["product_id"] == product_id]
    return {"product": row.iloc[0].to_dict(), "months": _series(g), "trend": trend(g.sort_values("month")["quantity"])}


# ---------------------------------------------------------------------------
# Demand forecasting: simple exponential smoothing (SES), plain numpy
# ---------------------------------------------------------------------------
#   level_t = alpha * demand_t + (1 - alpha) * level_{t-1}      forecast for every future month = last level
# alpha (0.1 .. 0.9) is chosen per series by minimising the one-step-ahead squared error on its history.
# Why SES and not a trend model: a rolling back-test over 55 series (385 windows, 3-month horizon) gave a mean
# relative error of 26.3 % for SES, versus 29.0 % for the 3-month average and 30-33 % for Holt trend models.
# DataCo demand is noisy with little real trend, so the simplest model wins. (The trend is still reported
# separately by trend() above.)
# Forecasts always use the consistent period (Jan 2015 - Sep 2017); the Oct 2017+ volume drop is a dataset artefact.
HOLDOUT_MONTHS = 3
MIN_HISTORY = 8  # months needed to fit + back-test
Z80 = 1.28       # z-value for an ~80 % prediction interval


def _ses_level(y: np.ndarray, alpha: float):
    """Run SES over y. Returns (final level, one-step-ahead predictions)."""
    level = y[0]
    preds = [y[0]]
    for v in y[1:]:
        preds.append(level)
        level = alpha * v + (1 - alpha) * level
    return level, np.array(preds)


def _ses_fit(y: np.ndarray):
    """Pick alpha by grid search. Returns (alpha, level, residual std)."""
    best_alpha, best_sse = 0.5, float("inf")
    for alpha in np.arange(0.1, 1.0, 0.1):
        _, preds = _ses_level(y, float(alpha))
        sse = float(np.sum((y[1:] - preds[1:]) ** 2))
        if sse < best_sse:
            best_alpha, best_sse = float(alpha), sse
    level, preds = _ses_level(y, best_alpha)
    return best_alpha, float(level), float(np.std(y[1:] - preds[1:]))


def _full_months(df: pd.DataFrame) -> pd.Series:
    """Monthly quantity with missing months filled with 0 (a month with no orders = zero demand)."""
    s = df.set_index("month")["quantity"].astype(float)
    idx = pd.period_range(s.index.min(), s.index.max(), freq="M").astype(str)
    return s.reindex(idx, fill_value=0.0)


def forecast(df: pd.DataFrame, horizon: int = 3) -> dict:
    """Forecast the next `horizon` months and back-test the method on the last 3 known months."""
    if df.empty:
        return {"available": False, "reason": "No orders for this selection in the consistent period."}
    s = _full_months(df.sort_values("month"))
    if len(s) < MIN_HISTORY:
        return {"available": False, "reason": f"At least {MIN_HISTORY} months of history are needed (found {len(s)})."}
    y = s.values

    # Back-test: fit on everything except the last 3 months, then compare with what really happened.
    train, actual = y[:-HOLDOUT_MONTHS], y[-HOLDOUT_MONTHS:]
    _, bt_level, _ = _ses_fit(train)
    bt_fc = np.full(HOLDOUT_MONTHS, bt_level)
    naive = np.full(HOLDOUT_MONTHS, train[-3:].mean())  # baseline: average of the 3 months before
    mae = float(np.mean(np.abs(actual - bt_fc)))
    naive_mae = float(np.mean(np.abs(actual - naive)))
    mape = float(np.mean(np.abs(actual - bt_fc) / actual) * 100) if (actual > 0).all() else None

    # Final forecast uses all the history. The interval widens slightly with the horizon.
    alpha, level, sigma = _ses_fit(y)
    months = pd.period_range(s.index[-1], periods=horizon + 1, freq="M").astype(str)[1:]
    rows = []
    for h, m in enumerate(months, start=1):
        band = Z80 * sigma * float(np.sqrt(1 + (h - 1) * alpha ** 2))
        rows.append({"month": m, "forecast": round(level), "lower": round(max(level - band, 0)), "upper": round(level + band)})
    return {
        "available": True,
        "method": "Simple exponential smoothing",
        "alpha": round(alpha, 1),
        "history_months": len(s),
        "last_actual_month": s.index[-1],
        "forecast": rows,
        "backtest": {"months": HOLDOUT_MONTHS, "mae": round(mae, 1), "naive_mae": round(naive_mae, 1),
                     "mape_pct": None if mape is None else round(mape, 1), "beats_baseline": bool(mae < naive_mae)},
    }


def total_forecast(horizon: int) -> dict:
    res = forecast(_filter(_load("demand_monthly_total.csv"), "consistent"), horizon)
    res["scope"] = "All products"
    return res


def product_forecast(product_id: int, horizon: int) -> dict | None:
    stats = _load("product_demand_stats.csv")
    row = stats[stats["product_id"] == product_id]
    if row.empty:
        return None
    df = _filter(_load("demand_monthly_product.csv"), "consistent")
    res = forecast(df[df["product_id"] == product_id], horizon)
    res["scope"] = row.iloc[0]["name"]
    return res
