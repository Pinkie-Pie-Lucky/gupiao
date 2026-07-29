# 泡泡看市 — 开发状态快照 (2026-07-21)

## 启动方式
```
cd /d l:\gupiao-main\gupiao-main && npx tsx server.ts
```
访问 http://localhost:3000

## 分支状态

| 分支 | 内容 | 状态 |
|------|------|------|
| `main` | 初始版，市场地图已改 API | 已推送 |
| `fix/chat-error` | AI泡泡 role: model→assistant | 已推送 |
| `feature/warmer-tone` | 泡泡老师人格 + 因果链箭头 + 一句话成长 | 已推送 |
| `feat/market-stories` | Prompt改造 + 反馈组件(FeedbackModal) | **当前分支，有未提交改动(stash)** |

## 关键修复
1. Yahoo Finance → 东方财富 HTTP API
2. 板块 API HTTPS→HTTP
3. MarketMapTab: 移除 cancelled 保护（v4版，修复React StrictMode问题）
4. Chat: `model`→`assistant`

## 已知问题
- 市场地图有时仍显示"暂无可用板块"（Vite缓存问题，删`.vite`目录后重启可解）
- 首页数据只展示3个板块（可能也是缓存）
- AiTeacherTab第91行仍有`role:'model'`需要改成`'assistant'`

## 当前会话关键对话
- 首页数据、反馈Agent都没集成完
- 用户要求先把数据修稳定再开发新功能
- 当前 main 分支的 MarketMapTab 有 v4 完整API调用但用户看不到效果（缓存占位）
- 新对话恢复上下文路径: `l:\gupiao-main\gupiao-main\DEV-SUMMARY.md`