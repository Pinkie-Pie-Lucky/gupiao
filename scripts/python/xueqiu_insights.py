import json
import sys

import akshare as ak

sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    mode = sys.argv[1]
    if mode == "profile":
        symbol = sys.argv[2]
        frame = ak.stock_individual_basic_info_xq(symbol=f"SH{symbol}" if symbol.startswith("6") else f"SZ{symbol}")
        values = {str(row["item"]): row["value"] for _, row in frame.iterrows()}
        keys = ["org_name_cn", "main_operation_business", "legal_representative", "general_manager", "industry"]
        print(json.dumps({"profile": {key: values.get(key) for key in keys}}, ensure_ascii=False, default=str))
        return
    frame = ak.stock_hot_tweet_xq(symbol="最热门")
    rows = frame.head(50).to_dict(orient="records")
    print(json.dumps({"items": rows}, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
