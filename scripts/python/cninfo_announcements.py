import json
import sys

import akshare as ak


sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    symbol = sys.argv[1]
    start_date = sys.argv[2]
    end_date = sys.argv[3]
    category = sys.argv[4] if len(sys.argv) > 4 else ""
    frame = ak.stock_zh_a_disclosure_report_cninfo(
        symbol=symbol,
        market="沪深京",
        category=category,
        start_date=start_date,
        end_date=end_date,
    )
    announcements = [
        {
            "code": str(row.get("代码", "")),
            "name": str(row.get("简称", "")),
            "title": str(row.get("公告标题", "")),
            "publishedAt": str(row.get("公告时间", "")),
            "url": str(row.get("公告链接", "")),
        }
        for row in frame.to_dict(orient="records")
    ]
    print(json.dumps({"announcements": announcements}, ensure_ascii=False))


if __name__ == "__main__":
    main()
