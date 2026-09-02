import json
import math
import re
import sys

import akshare as ak


sys.stdout.reconfigure(encoding="utf-8")


def normalize_period(value):
    text = str(value or "").strip().split(" ")[0]
    match = re.search(r"(\d{4})[-/]?(\d{2})[-/]?(\d{2})", text)
    return "-".join(match.groups()) if match else ""


def parse_value(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if not math.isfinite(float(value)) else float(value)
    text = str(value).replace(",", "").replace(" ", "").strip()
    if not text or text.lower() in {"false", "none", "nan", "--", "-"}:
        return None
    if text.endswith("%"):
        try:
            return float(text[:-1]) / 100
        except ValueError:
            return None
    multipliers = (("万亿", 1e12), ("亿", 1e8), ("万", 1e4), ("元", 1.0))
    for suffix, multiplier in multipliers:
        if text.endswith(suffix):
            text = text[:-len(suffix)]
            try:
                return float(text) * multiplier
            except ValueError:
                return None
    try:
        return float(text)
    except ValueError:
        return None


def rows_by_period(frame):
    rows = {}
    for row in frame.to_dict(orient="records"):
        period = normalize_period(row.get("报告期"))
        if period:
            rows[period] = row
    return rows


def first_metric(row, names):
    for name in names:
        if name in row:
            value = parse_value(row.get(name))
            if value is not None:
                return value
    return None


def metric(row, names):
    return first_metric(row or {}, names)


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r"\d{6}", sys.argv[1]):
        raise ValueError("symbol 应为 6 位证券代码")
    symbol = sys.argv[1]
    abstract = ak.stock_financial_abstract_ths(symbol=symbol, indicator="按报告期")
    benefit = ak.stock_financial_benefit_ths(symbol=symbol, indicator="按报告期")
    debt = ak.stock_financial_debt_ths(symbol=symbol, indicator="按报告期")
    cash = ak.stock_financial_cash_ths(symbol=symbol, indicator="按报告期")

    abstract_rows = rows_by_period(abstract)
    benefit_rows = rows_by_period(benefit)
    debt_rows = rows_by_period(debt)
    cash_rows = rows_by_period(cash)
    # 保留足够长的报告期：近 5 个完整年度与最近季度序列需要同时存在。
    # 后续由 Node 端分别构造年度值和“单季度”值，不能把累计季报直接连成趋势。
    periods = sorted(set(abstract_rows) | set(benefit_rows) | set(debt_rows) | set(cash_rows), reverse=True)[:24]
    reports = []
    for period in periods:
        a, b, d, c = (abstract_rows.get(period, {}), benefit_rows.get(period, {}), debt_rows.get(period, {}), cash_rows.get(period, {}))
        metrics = {
            "revenue": metric(b, ["*营业总收入", "营业总收入"]) or metric(a, ["营业总收入"]),
            "netProfit": metric(b, ["*归属于母公司所有者的净利润", "归属于母公司所有者的净利润", "*净利润", "净利润"]) or metric(a, ["净利润"]),
            "adjustedNetProfit": metric(b, ["*扣除非经常性损益后的净利润", "扣除非经常性损益后的净利润"]) or metric(a, ["扣非净利润"]),
            "operatingProfit": metric(b, ["营业利润", "三、营业利润"]),
            "operatingCost": metric(b, ["*营业成本", "营业成本", "减：营业成本"]),
            "financialExpense": metric(b, ["财务费用", "*财务费用"]),
            "interestExpense": metric(b, ["利息费用", "利息支出", "财务费用:利息费用", "其中：利息费用"]),
            "profitBeforeTax": metric(b, ["利润总额", "四、利润总额"]),
            "incomeTaxExpense": metric(b, ["所得税费用"]),
            "interestNetIncome": metric(b, ["利息净收入"]),
            "feeNetIncome": metric(b, ["手续费及佣金净收入"]),
            "creditImpairment": metric(b, ["信用减值损失"]),
            "assets": metric(d, ["*资产合计", "资产合计"]),
            "liabilities": metric(d, ["*负债合计", "负债合计"]),
            "currentAssets": metric(d, ["*流动资产合计", "流动资产合计"]),
            "currentLiabilities": metric(d, ["*流动负债合计", "流动负债合计"]),
            "equity": metric(d, ["*归属于母公司所有者权益合计", "归属于母公司所有者权益合计", "*所有者权益（或股东权益）合计", "所有者权益（或股东权益）合计"]),
            "loans": metric(d, ["发放贷款及垫款"]),
            "deposits": metric(d, ["吸收存款"]),
            "goodwill": metric(d, ["商誉"]),
            "cashAndCashEquivalents": metric(d, ["货币资金", "*货币资金", "现金及现金等价物"]),
            "accountsReceivable": metric(d, ["应收账款", "应收票据及应收账款"]),
            "inventory": metric(d, ["存货"]),
            "shortTermBorrowings": metric(d, ["短期借款", "*短期借款"]),
            "currentPortionOfNonCurrentDebt": metric(d, ["一年内到期的非流动负债"]),
            "longTermBorrowings": metric(d, ["长期借款"]),
            "bondsPayable": metric(d, ["应付债券"]),
            "leaseLiabilities": metric(d, ["租赁负债"]),
            "operatingCashFlow": metric(c, ["*经营活动产生的现金流量净额", "经营活动产生的现金流量净额"]),
            "investingCashFlow": metric(c, ["*投资活动产生的现金流量净额", "投资活动产生的现金流量净额"]),
            "financingCashFlow": metric(c, ["*筹资活动产生的现金流量净额", "筹资活动产生的现金流量净额"]),
            "capex": metric(c, ["购建固定资产、无形资产和其他长期资产支付的现金"]),
            "eps": metric(a, ["基本每股收益"]),
            "roe": metric(a, ["净资产收益率-摊薄", "净资产收益率"]),
            "netMargin": metric(a, ["销售净利率"]),
        }
        reports.append({"period": period, "unit": "CNY", "source": "ths_financial_statements", "metrics": metrics})

    latest = reports[0]["metrics"] if reports else {}
    template = "bank" if latest.get("interestNetIncome") is not None or (latest.get("loans") is not None and latest.get("deposits") is not None) else "non_financial"
    print(json.dumps({
        "reports": reports,
        "template": template,
        "metricSource": "ths_financial_statements",
        "unit": "CNY",
        "normalization": "金额已统一为人民币元；比例已统一为小数；报告期为 YYYY-MM-DD",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
