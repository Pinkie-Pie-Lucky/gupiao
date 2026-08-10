# 泡泡看市 - 阿里云部署指南（方案一：IP:端口，免备案）

> 前后端同机部署到阿里云服务器，通过 `http://<公网IP>:8080` 访问。
> **无需备案**（不绑定域名、不使用 80/443 端口），部署完成即可把网址发给别人访问。

---

## 一、准备工作

| 项目 | 要求 |
|---|---|
| 阿里云服务器 | ECS 或轻量应用服务器，**Ubuntu 22.04/24.04** |
| 配置建议 | 最低 2核2G；推荐 2核4G（paddleocr 依赖较重） |
| 端口 | **8080**（安全组需放行） |
| 公网 IP | 服务器自带（ECS 有公网 IP / 轻量默认有） |

---

## 二、快速部署（两条命令）

### 第 1 步：准备系统环境

SSH 登录服务器后执行（只需一次）：

```bash
sudo apt update && sudo apt install -y git curl
sudo git clone https://github.com/Pinkie-Pie-Lucky/gupiao.git /opt/gupiao
cd /opt/gupiao
sudo bash deploy/aliyun-setup.sh
```

> 会安装：基础依赖 + Node.js 20 + 放行 8080 端口

### 第 2 步：安装依赖并启动

```bash
# 1) 配置 .env（填入你的 DEEPSEEK_API_KEY）
sudo vim /opt/gupiao/.env
#    参考 /opt/gupiao/.env.example，至少要改 DEEPSEEK_API_KEY

# 2) 安装 + 构建 + 启动（耗时较长，paddleocr 安装需几分钟）
sudo bash /opt/gupiao/deploy/aliyun-install.sh
```

---

## 三、阿里云安全组放行 8080（关键，必做）

**不做这一步，别人就打不开你的网址！**

1. 登录阿里云控制台 → 云服务器 ECS（或轻量应用服务器）
2. 进入实例详情 → **安全组** → **配置规则** → **入方向**
3. 点击 **手动添加**：

| 协议 | 端口范围 | 授权对象 | 说明 |
|---|---|---|---|
| TCP | 8080 | 0.0.0.0/0 | 允许所有人访问 |

4. 保存即可

> 轻量应用服务器在「防火墙」页面添加，操作类似。

---

## 四、验证 & 分享

### 自己先验证（非常重要）
用**手机流量（关掉 WiFi）**访问：

```
http://<服务器公网IP>:8080
```

- 能打开 → 可以发给别人
- 打不开 → 检查安全组是否放行 8080

### 发给别人
网址就是 `http://<公网IP>:8080`，可以附带一句提示：
> 浏览器提示"不安全"时，点「高级 → 继续访问」即可进入。

---

## 五、常用运维命令

```bash
pm2 status            # 查看服务状态
pm2 logs gupiao       # 查看日志（tail 实时）
pm2 restart gupiao    # 重启服务
pm2 stop gupiao       # 停止服务
```

---

## 六、常见问题

### Q1：浏览器提示"您的连接不是私密连接"？
正常现象——因为没配 HTTPS。点「高级 → 继续前往」即可，功能完全正常。

### Q2：8080 打不开？
- 90% 是**安全组未放行 8080**（见第三节）
- 检查服务器 `ufw`：`sudo ufw status`，若 active 则 `sudo ufw allow 8080`
- 检查服务是否在跑：`pm2 status`，若异常 `pm2 logs gupiao`

### Q3：数据加载慢 / 个股分析部分模块提示"数据服务暂不可用"？
- 首次访问会实时抓取数据（同花顺/新浪等），需要几秒到几十秒
- 个别数据源（如同花顺 SSL 限流）偶发失败，系统会自动降级，稍后刷新即可
- 持续失败可重启：`pm2 restart gupiao`

### Q4：以后想换域名 + HTTPS？
- 走 ICP 备案（约 1~2 周）后，用 Caddy/Nginx 配域名 + 自动 HTTPS
- 备案完成前，方案一完全够用

---

## 七、端口 / 目录速查

| 项目 | 值 |
|---|---|
| 服务端口 | 8080（`server.ts` 默认 PORT） |
| 应用目录 | `/opt/gupiao` |
| 前端静态文件 | `/opt/gupiao/dist`（构建产物） |
| Python 环境 | `/opt/gupiao/.venv` |
| 环境变量 | `/opt/gupiao/.env` |
| 进程管理 | pm2（服务名 `gupiao`） |

---

## 八、一键重装（可选）

以后代码更新，只需：

```bash
cd /opt/gupiao
sudo git pull
sudo bash deploy/aliyun-install.sh
```

> 脚本会重新安装依赖、重新构建、重启 pm2 进程，幂等安全。
