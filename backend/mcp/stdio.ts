/**
 * 本地 stdio MCP 入口：适用于 Claude Desktop、Codex、Cherry Studio 等。
 * 与 HTTP MCP 复用同一套工具定义；不输出日志到 stdout，以免破坏 MCP 协议流。
 */
import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMxScreenerClient } from '../lib/mxScreenerClient.js';
import { createMcpServer } from './server.js';

// stdio MCP 的 stdout 专属于协议消息；环境加载提示只能静默处理。
dotenv.config({ quiet: true });

async function main() {
  const screener = createMxScreenerClient({ apiKey: process.env.MX_APIKEY });
  const server = createMcpServer({
    screenStocks: (query, forceRefresh) => screener.screen(query, forceRefresh),
  });
  await server.connect(new StdioServerTransport());
  console.error('[paopao-mcp] stdio 已启动；日志只写 stderr。');
}

main().catch((error) => {
  console.error('[paopao-mcp] 启动失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
