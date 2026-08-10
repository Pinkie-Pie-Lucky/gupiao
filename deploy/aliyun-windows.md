# 泡泡看市 - 阿里云 Windows Server 部署指南

> 适用于：**Windows Server 2022 数据中心版**（您的服务器）
> 部署方式：远程桌面（RDP）+ Windows 命令行，前后端同机，通过 `http://<公网IP>:8080` 访问
> **无需备案**（不绑定域名、不用 80/443）

---

## 一、总体流程

```
远程桌面登录服务器
→ 安装 Node.js
→ 安装 Python 3
→ 拉取/上传代码
→ 创建 .venv + 安装 Python 依赖
→ npm install + npm run build
→ 启动服务
→ 防火墙 + 阿里云安全组放行 8080
→ 手机验证网址
```

---

## 二、远程桌面登录（只做一次）

1. 本机按 `Win + R` → 输入 `mstsc` → 回车
2. 计算机栏输入服务器公网 IP：`101.37.85.112`
3. 点「连接」→ 输入用户名 `Administrator` + 服务器密码
4. 出现证书提示点「是」→ 进入**服务器桌面**

> 登录后，您看到的是一个 Windows 桌面，和我们自己的电脑很相似。

---

## 三、安装 Node.js（LTS 版本）

1. 在服务器桌面打开浏览器（Edge），访问：<https://nodejs.org/zh-cn>
2. 下载 **LTS** 版 Windows 安装包（`node-v20.x.x-x64.msi`）
3. 双击安装，一路「下一步」，**勾选 "Add to PATH"**（默认已勾选，确认即可）
4. 安装完成后，验证：
   - 按 `Win + R` → 输入 `cmd` → 回车
   - 输入：
     ```
     node -v
     npm -v
     ```
   - 显示版本号（如 `v20.xx.x` / `10.x.x`）即成功

---

## 四、安装 Python 3.11

1. 打开浏览器访问：<https://www.python.org/downloads/>
2. 下载 **Python 3.11**（或 3.12）Windows 安装包
3. 双击安装，**务必勾选底部 "Add python.exe to PATH"**，再点 "Install Now"
4. 验证：重新打开 cmd，输入：
   ```
   python --version
   ```
   显示 `Python 3.11.x` 即成功

---

## 五、获取代码（二选一）

### 方式 A：Git 拉取（推荐）
1. 服务器 cmd 里安装 Git（若没有）：
   - 浏览器下载：<https://git-scm.com/download/win>，默认安装即可
2. 然后在 cmd 里执行：
   ```
   cd C:\
   git clone https://github.com/Pinkie-Pie-Lucky/gupiao.git
   cd gupiao
   ```

### 方式 B：本机打包上传
1. 在您自己的电脑上，把项目压缩成 zip（**不要包含 node_modules、.venv、work**）
   - 或用 Git：`git archive` 或直接拷贝源码目录
2. 通过远程桌面「复制 → 粘贴」或网盘传到服务器 `C:\gupiao`

---

## 六、配置 .env

在代码目录（如 `C:\gupiao`）找到 `.env.example`，复制一份命名为 `.env`：

```
cd C:\gupiao
copy .env.example .env
notepad .env
```

在记事本里把这一行改成您的真实 Key（可问 AI 平台获取）：
```
DEEPSEEK_API_KEY="你的key"
```
保存关闭。

---

## 七、安装 Python 数据依赖（耗时较长）

在代码目录打开 cmd（`cd C:\gupiao`），执行：

```powershell
# 创建 Python 虚拟环境
python -m venv .venv

# 激活虚拟环境
.venv\Scripts\activate

# 升级 pip
python -m pip install --upgrade pip

# 安装数据依赖（akshare/pandas/paddleocr 等，需几分钟到十几分钟）
pip install -r requirements-stock-data.txt
```

> 看到 `Successfully installed ...` 即成功。

---

## 八、安装 Node 依赖 + 构建

继续在 cmd 中（确认在 `C:\gupiao` 目录）：

```powershell
# 安装前端/后端依赖
npm install

# 构建（生成 dist 前端 + dist/server.cjs 后端）
npm run build
```

看到 `✓ built in ...` 和生成 `dist\server.cjs` 即成功。

---

## 九、启动服务（生产模式）

```powershell
# 设置生产环境并启动（8080 端口）
set NODE_ENV=production
set PORT=8080
node dist\server.cjs
```

看到日志：
```
[Paopao Server] Running at http://localhost:8080 in production mode
```
即启动成功。

> 注意：这个 cmd 窗口要**保持打开**，关掉服务就停了。长期运行用第十步的方式。

---

## 十、设置开机自启 + 后台运行（推荐）

用 Windows 自带的「任务计划程序」让服务开机自动启动：

1. 在代码目录创建启动脚本 `C:\gupiao\start-server.bat`：
   ```bat
   @echo off
   cd /d C:\gupiao
   set NODE_ENV=production
   set PORT=8080
   node dist\server.cjs
   ```
2. `Win + R` → 输入 `taskschd.msc` → 回车，打开任务计划程序
3. 右侧「创建任务」：
   - **常规**：名称填 `gupiao-server`，勾选「使用最高权限运行」
   - **触发器**：新建 → 开始任务选「启动时」
   - **操作**：新建 → 程序填 `C:\gupiao\start-server.bat`
   - 确定保存
4. 以后服务器重启也会自动启动

---

## 十一、放行 8080 端口（两步，缺一不可）

### 第 1 步：Windows 防火墙
服务器 cmd（管理员）执行：
```powershell
netsh advfirewall firewall add rule name="gupiao-8080" dir=in action=allow protocol=TCP localport=8080
```
看到 `确定` 即成功。

### 第 2 步：阿里云安全组
1. 浏览器打开 [阿里云控制台](https://ecs.console.aliyun.com/)
2. 云服务器 ECS → 实例 → **安全组** → 配置规则 → 入方向
3. **手动添加**：

| 协议 | 端口范围 | 授权对象 |
|---|---|---|
| TCP | 8080 | 0.0.0.0/0 |

4. 保存

---

## 十二、验证 & 分享

### 自己验证
用**手机流量（关 WiFi）**访问：
```
http://101.37.85.112:8080
```
能打开即成功。浏览器提示"不安全"点「继续访问」即可。

### 发给别人
网址：`http://101.37.85.112:8080`
可附带说明：浏览器提示不安全时点「高级 → 继续访问」。

---

## 十三、运维命令速查

| 操作 | 命令 |
|---|---|
| 手动启动 | 双击 `C:\gupiao\start-server.bat` |
| 查看进程 | 任务管理器 → 找 `node.exe` |
| 停止服务 | 任务管理器结束 `node.exe` / 或关闭运行窗口 |
| 查看日志 | 启动窗口里滚动的输出即为日志 |
| 更新代码 | `cd C:\gupiao && git pull && npm run build` 后重启 |

---

## 十四、常见问题

### Q1：`npm run build` 报错？
- 确认在 `C:\gupiao` 目录下执行
- 确认 Node 版本 ≥ 18：`node -v`
- 报错信息发给我

### Q2：`pip install` 报错？
- 确认 `.venv\Scripts\activate` 已激活（命令行开头有 `(.venv)`）
- paddleocr 安装慢属正常，耐心等待

### Q3：8080 打不开？
- 确认启动窗口显示 Running
- 确认 Windows 防火墙命令执行成功（第十一步第1步）
- 确认阿里云安全组放行 8080（第十一步第2步）
- 手机用流量再试一次（自己电脑访问可能受缓存影响）

### Q4：个股分析部分模块显示"数据服务暂不可用"？
- 首次访问需实时抓数据，等几秒
- 同花顺等数据源偶发限流，会自动降级，稍后刷新
- 持续失败：重启服务后重试

---

## 十五、最终文件清单（服务器 C:\gupiao 下）

```
C:\gupiao\
├── .env                 # 密钥配置（手动创建）
├── .venv\               # Python 虚拟环境（第七步生成）
├── node_modules\        # Node 依赖（第八步生成）
├── dist\
│   ├── index.html       # 前端页面（构建产物）
│   └── server.cjs       # 后端服务（构建产物）
├── scripts\*.py         # Python 数据脚本
└── start-server.bat     # 启动脚本（第十步创建）
```
