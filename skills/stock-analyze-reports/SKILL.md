---
name: stock-analyze-reports
description: 使用 stock_analyze 生成可分享的个股分析或今日市场热点 HTML 报告；适用于用户明确要求报告、链接、归档或打印，不用于给出买卖建议。
---

# stock_analyze HTML 报告

当用户明确说“使用 stock_analyze 对某只股票进行分析并生成报告”时：

1. 用户只给名称时，先调用 `search_stock` 确认唯一证券代码；不要猜测同名证券。
2. 已知 6 位代码后，调用 `generate_stock_analysis_html_report`。
3. 返回工具的 `url`，并说明报告是生成时的研究快照；保留 `dataGaps`、报告到期时间和“非投资建议”边界。

示例：

> 使用 stock_analyze 对 159530 进行分析，并生成 HTML 报告。

当用户说“捕捉今日热点”“生成市场热点报告”或“每日板块精选报告”时，调用 `generate_market_hotspots_html_report`：

- “今日热点”使用 `focus: "hotspots"`；
- “每日板块精选”使用 `focus: "daily_sector_picks"`，其中也包含首页市场概览和市场地图。

报告中的数据只反映生成时已取得的市场/个股事实、程序信号、来源和数据缺口。不得将报告中的状态解释为买入、卖出、收益承诺或价格预测。
