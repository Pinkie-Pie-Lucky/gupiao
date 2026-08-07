import contextlib
import datetime as dt
import io
import json
import os
import re
import sys


sys.stdout.reconfigure(encoding="utf-8")

MAX_BARS = 320
PYTDX_SERVERS = [("60.12.136.250", 7709), ("115.238.56.198", 7709), ("180.153.18.170", 7709)]


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def valid_bars(rows):
    clean = []
    for row in rows:
        if not row.get("date") or any(number(row.get(key)) is None for key in ("open", "high", "low", "close", "volume")):
            continue
        clean.append({
            "date": str(row["date"])[:10], "open": number(row["open"]), "high": number(row["high"]),
            "low": number(row["low"]), "close": number(row["close"]), "volume": number(row["volume"]),
            "amount": number(row.get("amount")), "turnover": number(row.get("turnover")),
        })
    return sorted(clean, key=lambda row: row["date"])[-MAX_BARS:]


def fetch_akshare(kind, symbol, start_date, end_date):
    import akshare as ak
    if kind == "stock":
        exchange = "sh" if symbol.startswith(("5", "6", "9")) else "sz"
        frame = ak.stock_zh_a_daily(symbol=f"{exchange}{symbol}", start_date=start_date, end_date=end_date, adjust="qfq")
        source, adjust = "akshare_stock_zh_a_daily", "qfq"
    else:
        if symbol != "000001":
            raise ValueError("当前指数适配仅支持 000001（上证指数）")
        frame = ak.stock_zh_index_daily(symbol="sh000001")
        source, adjust = "akshare_stock_zh_index_daily", "none"
        frame = frame[frame["date"].astype(str).str[:10] >= f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}"]
    rows = []
    for row in frame.to_dict(orient="records"):
        rows.append({"date": row.get("date"), "open": row.get("open"), "high": row.get("high"), "low": row.get("low"), "close": row.get("close"), "volume": row.get("volume"), "amount": row.get("amount"), "turnover": row.get("turnover")})
    return valid_bars(rows), source, adjust


def fetch_tickflow(kind, symbol, _start_date, _end_date):
    import tickflow
    with contextlib.redirect_stdout(io.StringIO()):
        client = tickflow.TickFlow.free()
        full_symbol = f"{symbol}.SH" if kind == "stock" and symbol.startswith(("5", "6", "9")) else f"{symbol}.SZ" if kind == "stock" else "000001.SH"
        frame = client.klines.get(full_symbol, period="1d", count=MAX_BARS, adjust="forward", as_dataframe=True)
    rows = []
    for row in frame.to_dict(orient="records"):
        rows.append({"date": row.get("trade_date"), "open": row.get("open"), "high": row.get("high"), "low": row.get("low"), "close": row.get("close"), "volume": row.get("volume"), "amount": row.get("amount"), "turnover": None})
    return valid_bars(rows), "tickflow_free_daily", "qfq"


def fetch_baostock(kind, symbol, start_date, end_date):
    import baostock as bs
    code = f"sh.{symbol}" if kind == "stock" and symbol.startswith(("5", "6", "9")) else f"sz.{symbol}" if kind == "stock" else "sh.000001"
    with contextlib.redirect_stdout(io.StringIO()):
        login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(login.error_msg)
    try:
        fields = "date,open,high,low,close,volume,amount,turn"
        with contextlib.redirect_stdout(io.StringIO()):
            result = bs.query_history_k_data_plus(code, fields, start_date=f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}", end_date=f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:]}", frequency="d", adjustflag="2")
        if result.error_code != "0":
            raise RuntimeError(result.error_msg)
        rows = []
        while result.next():
            date, open_, high, low, close, volume, amount, turnover = result.get_row_data()
            rows.append({"date": date, "open": open_, "high": high, "low": low, "close": close, "volume": volume, "amount": amount, "turnover": number(turnover) / 100 if number(turnover) is not None else None})
        return valid_bars(rows), "baostock_daily", "qfq"
    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()


def fetch_pytdx(kind, symbol, _start_date, _end_date):
    from pytdx.hq import TdxHq_API
    market = 1 if kind == "index" or symbol.startswith(("5", "6", "9")) else 0
    last_error = ""
    for host, port in PYTDX_SERVERS:
        api = TdxHq_API()
        try:
            if not api.connect(host, port, time_out=8):
                last_error = f"{host}:{port} connect failed"
                continue
            raw = api.get_index_bars(9, market, symbol, 0, MAX_BARS) if kind == "index" else api.get_security_bars(9, market, symbol, 0, MAX_BARS)
            if not raw:
                last_error = f"{host}:{port} returned no bars"
                continue
            rows = [{"date": row.get("datetime"), "open": row.get("open"), "high": row.get("high"), "low": row.get("low"), "close": row.get("close"), "volume": row.get("vol"), "amount": row.get("amount"), "turnover": None} for row in raw]
            return valid_bars(rows), "pytdx_daily", "none"
        except Exception as exc:
            last_error = f"{host}:{port} {type(exc).__name__}: {str(exc)[:120]}"
        finally:
            try:
                api.disconnect()
            except Exception:
                pass
    raise RuntimeError(last_error or "Pytdx 无可用服务器")


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"stock", "index"} or not re.fullmatch(r"\d{6}", sys.argv[2]):
        raise ValueError("用法：market_daily_kline.py <stock|index> <6位代码>")
    kind, symbol = sys.argv[1], sys.argv[2]
    end_date = dt.date.today().strftime("%Y%m%d")
    start_date = (dt.date.today() - dt.timedelta(days=560)).strftime("%Y%m%d")
    providers = [("akshare", fetch_akshare), ("tickflow", fetch_tickflow), ("baostock", fetch_baostock), ("pytdx", fetch_pytdx)]
    skipped = {item.strip().lower() for item in os.environ.get("MARKET_DAILY_KLINE_SKIP", "").split(",") if item.strip()}
    errors = []
    for level, (name, provider) in enumerate(providers):
        if name in skipped:
            errors.append({"source": name, "error": "skipped by MARKET_DAILY_KLINE_SKIP"})
            continue
        try:
            bars, source, adjust = provider(kind, symbol, start_date, end_date)
            if len(bars) < 60:
                raise RuntimeError(f"仅返回 {len(bars)} 根有效日线")
            print(json.dumps({"kind": kind, "symbol": symbol, "bars": bars, "sourceMeta": {"source": source, "fallbackLevel": level, "adjust": adjust, "barInterval": "1d", "lastTradingDate": bars[-1]["date"], "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat()}}, ensure_ascii=False))
            return
        except Exception as exc:
            errors.append({"source": name, "error": f"{type(exc).__name__}: {str(exc)[:240]}"})
    raise RuntimeError(json.dumps({"message": "所有日线来源均不可用", "errors": errors}, ensure_ascii=False))


if __name__ == "__main__":
    main()
