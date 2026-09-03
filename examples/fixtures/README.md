# 离线示例数据

这些文件只用于 CLI、MCP/API 联调和前端开发，不代表真实行情、基本面或任何投资结论。

```bash
npm run cli -- market --offline
npm run cli -- snapshot 000001 --offline
```

真实数据应始终在输出中检查 `sourceMeta`、`generatedAt` 与 `dataGaps`。
