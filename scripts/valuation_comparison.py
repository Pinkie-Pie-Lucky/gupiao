import datetime as dt
import json
import re
import sys


sys.stdout.reconfigure(encoding="utf-8")


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        numeric = float(str(value).replace(",", ""))
        return numeric if numeric == numeric else None
    except (TypeError, ValueError):
        return None


def first(row, keys):
    for key in keys:
        if key in row and row.get(key) not in (None, "", "-"):
            return row.get(key)
    return None


def percentile(values, current):
    values = sorted(value for value in values if value is not None and value > 0)
    if current is None or not values:
        return None
    return round(sum(value <= current for value in values) / len(values) * 100, 2)


def historical(symbol):
    import akshare as ak
    frame = ak.stock_value_em(symbol=symbol)
    columns = list(frame.columns)
    if frame.empty or len(columns) < 13:
        raise RuntimeError("单股历史估值数据不足")
    rows = frame.to_dict(orient="records")
    clean = []
    for row in rows:
        clean.append({
            "date": str(row.get(columns[0]))[:10],
            "pe": number(row.get(columns[7])),
            "pb": number(row.get(columns[-1])),
            "ps": None,
        })
    clean = [row for row in clean if row["date"] and any(value is not None and value > 0 for value in row.values() if isinstance(value, (int, float)))]
    clean.sort(key=lambda row: row["date"])
    result = {}
    for metric in ("pe", "pb", "ps"):
        values = [row[metric] for row in clean if row[metric] is not None and row[metric] > 0]
        current = values[-1] if values else None
        result[metric] = {"current": current, "percentile": percentile(values, current), "sampleCount": len(values), "lastDate": clean[-1]["date"] if clean else None}
    return result


def peers(symbol, peer_symbols):
    import akshare as ak
    frame = ak.stock_zh_a_spot_em()
    code_column = "代码" if "代码" in frame.columns else "code"
    wanted = set(peer_symbols) | {symbol}
    rows = []
    for raw in frame.to_dict(orient="records"):
        code = str(raw.get(code_column, "")).zfill(6)
        if code not in wanted:
            continue
        rows.append({
            "symbol": code,
            "name": first(raw, ["名称", "name"]),
            "pe": number(first(raw, ["市盈率-动态", "动态市盈率", "PE(动)"])),
            "pb": number(first(raw, ["市净率", "PB"])),
            "ps": number(first(raw, ["市销率", "PS"])),
        })
    result = {}
    target = next((row for row in rows if row["symbol"] == symbol), None)
    for metric in ("pe", "pb", "ps"):
        peer_values = [row[metric] for row in rows if row["symbol"] != symbol and row[metric] is not None and row[metric] > 0]
        target_value = target.get(metric) if target else None
        result[metric] = {"target": target_value, "peerMedian": sorted(peer_values)[len(peer_values) // 2] if peer_values else None, "peerPercentile": percentile(peer_values, target_value), "peerCount": len(peer_values)}
    return result, len(rows)


def main():
    if len(sys.argv) != 3 or not re.fullmatch(r"\d{6}", sys.argv[1]):
        raise ValueError("用法：valuation_comparison.py <6位代码> <同行代码逗号列表>")
    symbol = sys.argv[1]
    peer_symbols = [item for item in sys.argv[2].split(",") if re.fullmatch(r"\d{6}", item)]
    history_result = historical(symbol)
    errors = []
    try:
        peer_result, matched_count = peers(symbol, peer_symbols)
    except Exception as exc:
        errors.append(f"peers: {type(exc).__name__}: {str(exc)[:160]}")
        peer_result = {metric: {"target": None, "peerMedian": None, "peerPercentile": None, "peerCount": 0} for metric in ("pe", "pb", "ps")}
        matched_count = 0
    print(json.dumps({"symbol": symbol, "history": history_result, "peers": peer_result, "matchedCount": matched_count, "sourceMeta": {"source": "akshare_stock_value_em", "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "freshness": "delayed", "confidence": "market", "errors": errors}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
