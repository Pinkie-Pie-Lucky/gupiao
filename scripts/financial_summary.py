import json
import sys

import akshare as ak


sys.stdout.reconfigure(encoding="utf-8")

METRICS = {
    "营业总收入": "revenue",
    "归母净利润": "netProfit",
    "扣非净利润": "netProfitExcludingNonRecurring",
    "经营现金流量净额": "operatingCashFlow",
    "股东权益合计(净资产)": "equity",
}


def clean(value):
    try:
        return None if value != value else float(value)
    except (TypeError, ValueError):
        return None


def main() -> None:
    symbol = sys.argv[1]
    frame = ak.stock_financial_abstract(symbol=symbol)
    periods = [column for column in frame.columns if str(column).isdigit() and len(str(column)) == 8][:8]
    by_metric = {str(row.get("指标", "")): row for row in frame.to_dict(orient="records")}
    reports = []
    for period in periods:
        metrics = {key: clean(by_metric.get(label, {}).get(period)) for label, key in METRICS.items()}
        reports.append({"period": str(period), "unit": "CNY", "source": "sina_financial_summary", "metrics": metrics})
    print(json.dumps({"reports": reports, "metricSource": "sina_financial_summary"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
