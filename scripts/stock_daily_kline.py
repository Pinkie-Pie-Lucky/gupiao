import datetime as dt
import json
import re
import sys

import akshare as ak


sys.stdout.reconfigure(encoding="utf-8")


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r"\d{6}", sys.argv[1]):
        raise ValueError("symbol 应为 6 位证券代码")
    symbol = sys.argv[1]
    exchange_prefix = "sh" if symbol.startswith(("5", "6", "9")) else "sz"
    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=560)
    frame = ak.stock_zh_a_daily(
        symbol=f"{exchange_prefix}{symbol}",
        start_date=start_date.strftime("%Y%m%d"),
        end_date=end_date.strftime("%Y%m%d"),
        adjust="qfq",
    )
    if frame.empty:
        raise RuntimeError("未获取到个股日线")
    rows = []
    for row in frame.tail(320).to_dict(orient="records"):
        date = row.get("date")
        rows.append({
            "date": str(date)[:10],
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
            "amount": float(row["amount"]),
        })
    print(json.dumps({"bars": rows, "source": "akshare_stock_zh_a_daily", "adjust": "qfq"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
