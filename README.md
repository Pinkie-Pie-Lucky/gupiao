# 泡泡 Web 端代码清单（独立整理版）

> 本文件夹从原仓库 `gupiao` 中**单独抽取出「Web 端（桌面版）」相关的全部源码与配置文件**，用于和移动端 H5 代码做清晰区分。
> 抽取时间：2026-07-18｜源分支：`preview/web`｜当前仓库整体入口本身即在运行 Web 端。

---

## 一、这份清单包含什么 / 不包含什么

| 范围 | 是否纳入 | 说明 |
|------|---------|------|
| Web 页面与组件（`src/web/*`） | ✅ 纳入 | 今日大盘、AI泡泡、市场地图、账户、自选、登录注册等 |
| Web 入口（`src/main.tsx` `src/App.tsx` `src/index.css` `index.html`） | ✅ 纳入 | 整个 App 入口直接渲染 `WebApp` 外壳 |
| 共享类型与数据（`src/types.ts` `src/data.ts`） | ✅ 纳入 | Web 与移动端共用，Web 端强依赖 |
| 后端服务（`server.ts`） | ✅ 纳入 | 托管 `dist/` 并提供 `/api/*` 真实行情接口 |
| 构建配置（`vite.config.ts` `tsconfig.json` `package.json`） | ✅ 纳入 | Web 构建与运行依赖 |
| 移动端 H5（`src/components/*`、`src/App.tsx` 旧移动入口等） | ❌ **不纳入** | 属于移动端 H5，未被当前入口挂载 |
| 构建产物（`dist/`） | ❌ 不纳入 | 由 `npm run build` 生成，非源码 |

> ⚠️ 区分要点：**当前 `src/App.tsx` 注释明确写明「Web 端（桌面）统一渲染 WebApp 外壳」**，直接 `import { WebApp } from './web/WebApp'`。
> 仓库里虽有 `src/components/`（移动端 H5 组件）和它们的 `/api` 调用，但**当前 Web 入口并未挂载它们**，所以移动端代码不在本清单内。

---

## 二、目录树

```
web-code/
├── README.md                  ← 本索引文档
├── index.html                 ← HTML 模板（挂载点 #root）
├── package.json               ← 依赖与脚本（dev/build/start）
├── vite.config.ts             ← Vite 构建配置
├── tsconfig.json              ← TypeScript 配置
├── server.ts                  ← 后端：托管 dist + 真实行情 /api 接口（1734 行）
└── src/
    ├── main.tsx               ← 入口：createRoot → <App/>
    ├── App.tsx                ← 入口：渲染 <WebApp/>（Web 外壳）
    ├── index.css              ← 全局样式（Tailwind 指令 + 基础变量）
    ├── types.ts               ← 全局类型（MarketIndex/StockSector/StockItem/...）
    ├── data.ts                ← 共享静态数据（initialIndices/initialSectors/UserProfile）
    └── web/
        ├── WebApp.tsx         ← Web 外壳：侧边栏 + 顶栏 + 路由 + 登录态（212 行）
        ├── TodayMarketPage.tsx← 今日大盘：指数卡 + 故事 + 板块热力 + 涨跌榜（637 行）
        ├── AiBubblePage.tsx    ← AI泡泡：智能投研问答（离线 mock 应答）（549 行）
        ├── MarketMapPage.tsx   ← 市场地图：板块热力网格 + 详情 + 自选（1095 行）
        ├── AccountPage.tsx     ← 账户页：资料/设置/安全绑定（502 行）
        ├── WatchlistPage.tsx   ← 我的关注：自选股列表（303 行）
        ├── AuthContext.tsx     ← 登录态全局 Context（localStorage 持久化）（151 行）
        ├── AuthModal.tsx       ← 登录/注册弹窗（手机号+密码+验证码）（201 行）
        ├── BrainMark.tsx       ← 品牌 Logo 组件（33 行）
        └── mockWebData.ts      ← Web 端 Mock 数据层（指数/温度/故事/板块派生）（约 500 行）
```

---

## 三、文件清单与作用

### 1. 入口层（决定「跑的是 Web 还是移动端」）

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/main.tsx` | 10 | React 入口，`createRoot(document.getElementById('root')).render(<App/>)` |
| `src/App.tsx` | 13 | **关键分界点**：注释「Web 端统一渲染 WebApp 外壳」，`return <WebApp/>` |
| `index.html` | 13 | 页面模板，提供 `#root` 挂载点 |
| `src/index.css` | 49 | 全局样式（Tailwind + 设计变量） |

### 2. Web 页面与组件（`src/web/`）

| 文件 | 行数 | 作用 | 数据来源 |
|------|------|------|----------|
| `WebApp.tsx` | 212 | Web 外壳：深底侧边栏 + 顶栏 + 页面路由 + 全局登录态 | `AuthContext` |
| `TodayMarketPage.tsx` | 637 | 今日大盘：4 张指数卡 +「今天发生了什么」故事 + 板块热力 + 涨跌榜 | `mockWebData`（**当前为写死 mock**） |
| `AiBubblePage.tsx` | 549 | AI泡泡 智能投研问答；板块上下文来自 `heatSectors` | `mockWebData`（应答为离线 mock） |
| `MarketMapPage.tsx` | 1095 | 市场地图：板块热力网格 + 板块详情 + 领涨/领跌 + 自选（localStorage） | `mockWebData`（**当前为写死 mock**） |
| `AccountPage.tsx` | 502 | 账户：个人资料 / 设置 / 安全绑定（已注释微信、邮箱绑定） | `mockWebData` + `AuthContext` |
| `WatchlistPage.tsx` | 303 | 我的关注：自选股列表、预警（不含总资产/持仓，符合产品约束） | `mockWebData` |
| `AuthContext.tsx` | 151 | 登录态全局 Context：手机号注册/登录/登出，localStorage 持久化 | 离线 mock（无真实短信） |
| `AuthModal.tsx` | 201 | 登录/注册双标签弹窗：手机号 + 密码 + 验证码（演示码直接返回） | `AuthContext` |
| `BrainMark.tsx` | 33 | 品牌 Logo | — |
| `mockWebData.ts` | ~500 | **Web 端 mock 数据层**：指数、市场温度、一句话综述、故事、板块派生 | 写死常量 |

### 3. 共享依赖（Web 与移动端共用）

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/types.ts` | 144 | 全局 TS 类型：`MarketIndex` `StockSector` `StockItem` `MarketStory` `UserProfile` 等 |
| `src/data.ts` | 323 | 共享静态数据：`initialIndices` `initialSectors` `mockUserProfile` `formatChineseDate` 等 |

### 4. 后端服务（`server.ts`，1734 行）

Express 服务，**当前入口的依赖**：生产态托管 `dist/`，开发态走 Vite 中间件。已实现接口：

| 接口 | 方法 | 数据真实性 |
|------|------|-----------|
| `/api/chat` | POST | AI 问答（需 `DEEPSEEK_API_KEY`） |
| `/api/market-overview` | GET | **真实**：东方财富/腾讯实时指数、板块广度、市场温度 |
| `/api/sectors` | GET | **真实**：东方财富板块涨跌 |
| `/api/market-map/intelligence` | GET | **真实**：板块信号/异动/重要度 |
| `/api/sector-detail` | GET | **真实**：板块个股（领涨/领跌）、K 线多周期、新闻 |
| `/api/market-report` | POST | ⚠️ **当前 prompt 写死假数**（3026.49 等），待改为真实抓取值 |
| `/api/morning-report` | GET | 早报 |
| `/api/feedback` `/api/feedback-stats` | POST/GET | 反馈收集 |

> ⚠️ **重要现状**：后端真实行情接口**已通且实测可用**（上证实时返回 3804.69 而非 mock 的 3026.49），
> 但 **Web 端页面目前没有调用它们**，全部走 `mockWebData.ts` 的写死值。详见第四节「已知状态」。

### 5. 构建配置

| 文件 | 行数 | 作用 |
|------|------|------|
| `package.json` | — | 依赖与脚本：`dev`=`tsx server.ts`、`build`=`vite build && esbuild server.ts`、`start`=`node dist/server.cjs` |
| `vite.config.ts` | 23 | Vite 构建配置（单配置，未区分 web/mobile） |
| `tsconfig.json` | 26 | TS 编译配置 |

---

## 四、架构与数据流

```
浏览器
  └─ index.html (#root)
       └─ src/main.tsx ──> src/App.tsx ──> src/web/WebApp.tsx
                                        ├─ 侧边栏 / 顶栏（含登录态 AuthContext）
                                        └─ 路由切换到各页面：
                                           ├─ TodayMarketPage   ─┐
                                           ├─ AiBubblePage      ├─ 当前均读 mockWebData.ts（写死）
                                           ├─ MarketMapPage     ─┤   ❌ 未接后端真实接口
                                           ├─ AccountPage       │
                                           └─ WatchlistPage     ─┘
                                           （MarketMapPage 用 localStorage 存自选）
后端 server.ts
  ├─ 托管 dist/（生产）
  └─ /api/* 真实行情接口（东方财富/腾讯）✅ 实测可用，但 Web 端未消费
```

**关键设计约束（产品已确认）**
- 账户页/自选页**绝不展示总资产、持仓、盈亏**（不接入用户真实资产）。
- 所有行情/问答数据**当前为离线 mock**；后端真实接口已具备但 Web 端尚未接线。
- 登录注册为**离线 mock**（手机号 + 密码 + 验证码，演示验证码直接返回，无真实短信）。

---

## 五、如何运行（预览）

```bash
# 1. 安装依赖（在原始仓库根目录，而非本文件夹）
npm install

# 2. 开发预览（热更新，启动 server.ts 同时托管前端）
npm run dev          # = tsx server.ts，监听 http://localhost:8080

# 3. 生产构建 + 启动
npm run build        # vite build + esbuild 打包 server.ts → dist/server.cjs
npm start            # node dist/server.cjs
```

> 本 `web-code/` 文件夹是**源码快照/参考包**，相对路径与原始仓库一致，便于对照阅读；
> 实际运行仍在原仓库 `gupiao` 中进行（需 `node_modules` 与 `DEEPSEEK_API_KEY` 等环境）。

---

## 六、Git 分支说明

| 分支 | 内容 | 是否推送 GitHub |
|------|------|----------------|
| `preview/web` | **整合分支**：合并了以下全部功能，本地预览服务器跑的就是它 | 本地整合专用，**约定不推送** |
| `feature/web` | AI泡泡 + 今日大盘 + 市场地图 | 本地，未推送 |
| `feature/web-account` | 账户页调整 | 本地，未推送 |
| `feature/web-watchlist` | 我的关注（自选页） | 本地，未推送 |
| `feature/web-auth` | 手机号注册/登录 | 本地，未推送 |
| `main` | 主分支（远程有 `origin/main`） | 已推送 |

> 所有 `feature/web-*` 与 `preview/web` 目前**仅在本地**，远程没有对应分支。
> 推送需仓库 Token 或 SSH key。

---

## 七、待办 / 下一步（与「区分」无关，仅备忘）

1. **Web 端接真实行情**：把 `TodayMarketPage`/`AiBubblePage`/`MarketMapPage` 从 `mockWebData` 改为 `fetch` 后端 `/api/market-overview` 等真实接口（后端已实测可用）。
2. **修 `/api/market-report`**：其 prompt 写死假数 3026.49，需改为用真实抓取值。
3. **推送 Web 分支到 GitHub**：补齐凭证后推送 `feature/web-*` 与 `preview/web`。
