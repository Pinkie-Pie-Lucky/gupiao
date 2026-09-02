import json
import re
import sys
from urllib.parse import urlparse

from ddgs import DDGS

sys.stdout.reconfigure(encoding="utf-8")


def normalized_symbol(value: str) -> str:
    code = re.sub(r"\D", "", value or "")
    if not re.fullmatch(r"\d{6}", code):
        raise ValueError("symbol 应为 6 位证券代码")
    return code


def is_stock_page(url: str, code: str) -> bool:
    try:
        parsed = urlparse(url)
        if not parsed.hostname or not parsed.hostname.lower().endswith("xueqiu.com"):
            return False
        return bool(re.search(rf"/S/(?:SZ|SH){code}(?:/|$)", parsed.path, flags=re.I))
    except Exception:
        return False


def main() -> None:
    code = normalized_symbol(sys.argv[1] if len(sys.argv) > 1 else "")
    company_name = str(sys.argv[2] if len(sys.argv) > 2 else "").strip()
    exchange_symbol = f"{'SH' if code.startswith(('5', '6', '9')) else 'SZ'}{code}"
    query = f"site:xueqiu.com/S/{exchange_symbol} {company_name or code}"
    try:
        results = DDGS(timeout=20).text(query, region="cn-zh", safesearch="moderate", max_results=12)
    except Exception as error:
        raise RuntimeError(f"雪球公开索引检索失败：{str(error)[:180]}") from error
    items = []
    for item in results:
        href = str(item.get("href") or item.get("url") or "").strip()
        if not is_stock_page(href, code):
            continue
        items.append({
            "title": str(item.get("title") or "").strip(),
            "body": str(item.get("body") or item.get("snippet") or "").strip(),
            "href": href,
            "date": item.get("date") or item.get("published") or None,
        })
    print(json.dumps({"query": query, "items": items[:12]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
