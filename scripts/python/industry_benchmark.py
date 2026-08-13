import contextlib
import datetime as dt
import io
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import akshare as ak
import pandas as pd
import requests
import baostock as bs


sys.stdout.reconfigure(encoding="utf-8")
DETAIL_URL = "http://q.10jqka.com.cn/thshy/detail/code/{code}/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}


def detail_contains_symbol(board, symbol):
    try:
        response = requests.get(DETAIL_URL.format(code=board["code"]), headers=HEADERS, timeout=15)
        response.raise_for_status()
        text = response.content.decode("gbk", "ignore")
        return board if re.search(rf"(?<!\d){re.escape(symbol)}(?!\d)", text) else None
    except Exception:
        return None


def normalize_code(value):
    try:
        return str(int(float(value))).zfill(6)
    except (TypeError, ValueError):
        return str(value).strip().zfill(6)


def fetch_board_members(board, symbol):
    response = requests.get(DETAIL_URL.format(code=board["code"]), headers=HEADERS, timeout=20)
    response.raise_for_status()
    tables = pd.read_html(io.StringIO(response.content.decode("gbk", "ignore")))
    if not tables:
        raise RuntimeError("同花顺行业详情页未返回成分表")
    table = tables[0]
    members = []
    for row in table.to_dict(orient="records"):
        code = normalize_code(row.get("代码"))
        members.append({"symbol": code, "name": str(row.get("名称") or ""), "isTarget": code == symbol})
    if not any(member["isTarget"] for member in members):
        raise RuntimeError("行业详情页未确认目标股票属于该行业")
    return members


def fetch_baostock_industry_snapshot(symbol):
    """Return the target's CSRC industry together with the full same-industry universe.

    This is deliberately a separate fallback taxonomy.  It may support member-based
    financial percentiles, but must never be combined with a THS industry index.
    """
    exchange_symbol = f"sh.{symbol}" if symbol.startswith(("5", "6", "9")) else f"sz.{symbol}"
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        login = bs.login()
    if login.error_code != "0":
        return None
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = bs.query_stock_industry()
        if result.error_code != "0":
            return None
        rows = []
        while result.next():
            row = dict(zip(result.fields, result.get_row_data()))
            if not row.get("industry"):
                continue
            rows.append(row)
        target = next((row for row in rows if row.get("code") == exchange_symbol), None)
        if not target:
            return None
        industry_name = target.get("industry") or "未分类"
        classification = target.get("industryClassification") or "证监会行业分类"
        members = [
            {"symbol": str(row.get("code", "")).split(".")[-1].zfill(6), "name": row.get("code_name") or "", "isTarget": row.get("code") == exchange_symbol}
            for row in rows
            if row.get("industry") == industry_name and row.get("industryClassification") == classification
        ]
        return {
            "name": industry_name,
            "code": f"baostock:{classification}:{industry_name}",
            "classification": classification,
            "memberCount": len(members),
            "members": members,
            "asOf": target.get("updateDate") or None,
        }
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            bs.logout()


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"\d{6}", sys.argv[1]):
        raise ValueError("symbol 应为 6 位证券代码")
    symbol = sys.argv[1]
    fallback_industry = fetch_baostock_industry_snapshot(symbol)
    matched = None
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            board_frame = ak.stock_board_industry_name_ths()
        boards = [{"name": str(row["name"]), "code": str(row["code"])} for row in board_frame.to_dict(orient="records")]
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(detail_contains_symbol, board, symbol) for board in boards]
            for future in as_completed(futures):
                candidate = future.result()
                if candidate:
                    matched = candidate
                    for pending in futures:
                        pending.cancel()
                    break
    except Exception:
        matched = None
    if not matched:
        if not fallback_industry:
            raise RuntimeError("未能取得股票行业归属")
        print(json.dumps({
            "symbol": symbol, "industry": fallback_industry, "bars": [],
            "sourceMeta": {"mappingSource": "baostock_industry", "membershipAsOf": fallback_industry.get("asOf"), "benchmarkSource": None, "adjust": None, "barInterval": None, "lastTradingDate": None, "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat()},
            "dataGaps": ["未匹配到同花顺行业指数；当前使用 Baostock 证监会行业成员快照，仅可用于同口径成员财务比较，不输出行业指数相对强弱。"],
        }, ensure_ascii=False))
        return
    members = fetch_board_members(matched, symbol)
    end_date = dt.date.today().strftime("%Y%m%d")
    start_date = (dt.date.today() - dt.timedelta(days=560)).strftime("%Y%m%d")
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        frame = ak.stock_board_industry_index_ths(symbol=matched["name"], start_date=start_date, end_date=end_date)
    rows = []
    for row in frame.tail(320).to_dict(orient="records"):
        rows.append({
            "date": str(row.get("日期"))[:10], "open": float(row["开盘价"]), "high": float(row["最高价"]),
            "low": float(row["最低价"]), "close": float(row["收盘价"]), "volume": float(row["成交量"]),
            "amount": float(row["成交额"]), "turnover": None,
        })
    if len(rows) < 60:
        raise RuntimeError("行业指数日线不足 60 根")
    print(json.dumps({
        "symbol": symbol,
        # Do not truncate the canonical industry universe.  Consumers that need a
        # compact response should summarize it themselves, while percentile jobs
        # must see the complete, reproducible membership snapshot.
        "industry": {"name": matched["name"], "code": matched["code"], "classification": "同花顺行业", "memberCount": len(members), "members": members},
        "bars": rows,
        "sourceMeta": {"mappingSource": "ths_industry_member_page", "benchmarkSource": "ths_industry_index", "adjust": "none", "barInterval": "1d", "lastTradingDate": rows[-1]["date"], "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat()},
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
