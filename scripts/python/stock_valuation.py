import datetime as dt
import json
import re
import sys
import urllib.request


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


def fetch_spot_em(symbol):
    import akshare as ak
    frame = ak.stock_zh_a_spot_em()
    code_column = "代码" if "代码" in frame.columns else "code"
    matched = frame[frame[code_column].astype(str).str.zfill(6) == symbol]
    if matched.empty:
        raise RuntimeError("东方财富 A 股实时行情未找到该股票")
    row = matched.iloc[0].to_dict()
    return {
        "name": first(row, ["名称", "股票简称", "name"]),
        "price": number(first(row, ["最新价", "最新", "price"])),
        "marketCap": number(first(row, ["总市值", "总市值-元"])),
        "floatMarketCap": number(first(row, ["流通市值", "流通市值-元"])),
        "peDynamic": number(first(row, ["市盈率-动态", "动态市盈率", "PE(动)"])),
        "peStatic": number(first(row, ["市盈率-静态", "静态市盈率", "PE(静)"])),
        "pb": number(first(row, ["市净率", "PB"])),
        "source": "eastmoney_stock_zh_a_spot_em",
    }


def fetch_spot_tencent(symbol):
    market = "sh" if symbol.startswith(("5", "6", "9")) else "sz"
    url = f"https://qt.gtimg.cn/q={market}{symbol}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(request, timeout=12).read().decode("gbk", "ignore")
    match = re.search(r'="(.*)"', raw)
    if not match:
        raise RuntimeError("腾讯行情未返回有效数据")
    fields = match.group(1).split("~")
    if len(fields) < 5 or not number(fields[3]):
        raise RuntimeError("腾讯行情缺少最新价")
    return {
        "name": fields[1] or symbol,
        "price": number(fields[3]),
        "marketCap": None,
        "floatMarketCap": None,
        "peDynamic": None,
        "peStatic": None,
        "pb": None,
        "source": "tencent_quote_fallback",
    }


def fetch_value_em(symbol):
    import akshare as ak
    frame = ak.stock_value_em(symbol=symbol)
    if frame.empty or len(frame.columns) < 13:
        raise RuntimeError("东方财富单股估值历史未返回有效数据")
    row = frame.iloc[-1]
    columns = list(frame.columns)
    return {
        "name": symbol,
        "price": number(row[columns[1]]),
        "marketCap": number(row[columns[3]]),
        "floatMarketCap": number(row[columns[4]]),
        "peDynamic": number(row[columns[7]]),
        "peStatic": number(row[columns[8]]),
        "pb": number(row[columns[-1]]),
        "source": "eastmoney_stock_value_em",
    }


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"\d{6}", sys.argv[1]):
        raise ValueError("用法：stock_valuation.py <6位代码>")
    symbol = sys.argv[1]
    errors = []
    valuation = None
    for provider in (fetch_spot_em, fetch_value_em, fetch_spot_tencent):
        try:
            valuation = provider(symbol)
            break
        except Exception as exc:
            errors.append(f"{provider.__name__}: {type(exc).__name__}: {str(exc)[:160]}")
    if valuation is None:
        raise RuntimeError("；".join(errors) or "实时估值数据不可用")
    print(json.dumps({
        "symbol": symbol,
        "valuation": valuation,
        "sourceMeta": {"source": valuation.pop("source"), "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "freshness": "realtime", "confidence": "market", "fallbackLevel": 0 if valuation.get("peDynamic") is not None else 1, "errors": errors},
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
