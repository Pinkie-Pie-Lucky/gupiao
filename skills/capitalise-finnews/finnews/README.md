# FinNews Skill

金融新闻中文资讯查询 Skill —— 用自然语言获取全球金融市场每日要闻、个股动态和宏观政策。

## 功能

- **全球财经头条**：商业新闻、市场动态、宏观政策
- **美股个股新闻**：AAPL、TSLA、NVDA 等热门股票最新资讯
- **A 股公告查询**：上市公司公告、复牌、财报、调研活动
- **主题搜索**：美联储、黄金原油、加密货币、财报季等
- **市场概览**：多资产聚合简报

## 数据源

| 数据源 | 配置 | 网络 | 覆盖 |
|---|---|---|---|
| NewsAPI | 需免费注册 Key | 全球可用 | 国际财经新闻（含摘要） |
| Yahoo Finance | 免 Key | 海外/代理可用 | 美股个股新闻、全球市场 |
| 东方财富 | 免 Key | 中国大陆可用 | A 股公告、实时行情 |

## 快速开始

### 1. 安装

无需安装，Skill 文件已放入 `~/.claude/skills/finnews/`。Claude Code 会自动识别。

### 2. 配置 NewsAPI（推荐，2 分钟）

```bash
# 1. 到 https://newsapi.org/register 免费注册
# 2. 获取 API Key 后设置环境变量
export NEWS_API_KEY="your_key_here"

# 建议加入 shell 配置文件（~/.zshrc 或 ~/.bashrc）
echo 'export NEWS_API_KEY="your_key_here"' >> ~/.zshrc
```

### 3. 试用

直接对 Claude 说：

- "今天财经有什么大事"
- "AAPL 有什么新闻"
- "最近美联储有什么动态"
- "看一下 A 股公告"
- "黄金市场最新消息"

## 网络环境说明

- **有 NewsAPI Key + 海外网络**：三源全开，体验最佳
- **有 NewsAPI Key + 中国大陆网络**：NewsAPI + 东方财富，覆盖国际新闻 + A 股
- **无 Key + 海外网络**：Yahoo Finance + 东方财富，个股新闻 + A 股
- **无 Key + 中国大陆网络**：仅东方财富 A 股公告（功能受限，建议注册 NewsAPI）

## 文件结构

```
~/.claude/skills/finnews/
├── SKILL.md      # Skill 定义（路由规则、API 端点、工作流、输出格式）
└── README.md     # 本文件
```

## 触发词

"今天股市有什么新闻"、"财经日报"、"金融新闻"、"美股动态"、"A股新闻"、"最近有什么财经大事"、"美联储"、"财报季"、"宏观经济"、"黄金/原油"、"加密货币"、"特斯拉/苹果新闻"、"finance news today"、"今天股市怎么样"、"财经热点"...

## 注意事项

- NewsAPI 免费版：100 requests/天，可查最近 1 个月新闻，限非商业用途
- Yahoo Finance 为非官方 API，字段结构可能微调
- 东方财富 API 主要覆盖 A 股公告，不含市场新闻评论
- 所有 API 调用都应串行执行，避免并发猛拉

## 相关 Skill

- [stock-analysis](../stock-analysis/) — 股票分析和投资组合管理（需同一目录下）
