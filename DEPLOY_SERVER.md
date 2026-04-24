# 服务器部署说明

本文档说明如何将当前项目部署到普通 Linux 服务器，并使用 SQLite 持久化数据。

## 适用场景

当前项目已改为 SQLite 存储，适合部署到：
- Ubuntu / Debian VPS
- 带持久化磁盘的云主机
- 自建 Docker 宿主机

不建议部署方式：
- 纯 Vercel Serverless 持久化 SQLite
- 临时文件系统环境

原因是 SQLite 依赖本地磁盘文件持久化，数据库文件默认位于：
- [`data/app.db`](data/app.db:1)

## 推荐部署架构

推荐使用：
- Nginx
- Node.js 20+
- PM2
- SQLite

推荐目录：
```bash
/var/www/galxe-task
```

## 一、安装运行环境

```bash
sudo apt update
sudo apt install -y nginx curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

安装完成后检查版本：

```bash
node -v
npm -v
pm2 -v
```

## 二、上传项目

将项目上传到服务器，例如：

```bash
/var/www/galxe-task
```

进入项目目录：

```bash
cd /var/www/galxe-task
```

## 三、配置环境变量

参考 [`.env.example`](.env.example:1) 创建 `.env` 文件：

```env
SQLITE_FILE=data/app.db
SQLITE_TASKS_TABLE=tasks
SQLITE_EVM_ADDRESS_TABLE=evm_address
SQLITE_SOL_ADDRESS_TABLE=sol_address
APP_LOGIN_USERNAME=admin
APP_LOGIN_PASSWORD=你的后台密码
AUTH_SESSION_SECRET=请替换为长随机字符串
VITE_API_BASE_URL=
```

### 环境变量说明

- `SQLITE_FILE`：SQLite 数据库文件路径
- `APP_LOGIN_USERNAME`：后台登录账号
- `APP_LOGIN_PASSWORD`：后台登录密码
- `AUTH_SESSION_SECRET`：登录态签名密钥

建议把数据库文件放到独立持久化目录，例如：

```env
SQLITE_FILE=/var/lib/galxe-task/app.db
```

这样可以避免代码升级时误覆盖数据库。

## 四、安装依赖

```bash
npm install
```

项目依赖中包含 [`better-sqlite3`](package.json:15)，部署机器需要支持 Node 原生模块运行。

## 五、准备导入数据

将以下文件放到 [`data`](data:1) 目录：
- [`data/tasks.txt`](data/tasks.txt:1)
- [`data/evm_address.txt`](data/evm_address.txt:1)
- [`data/sol_address.txt`](data/sol_address.txt:1)

地址文件格式要求：
- 一行一个地址
- 空行会自动忽略
- 不要加额外说明文字

例如：

`data/evm_address.txt`
```txt
0x123...
0x456...
0x789...
```

`data/sol_address.txt`
```txt
So11111111111111111111111111111111111111112
9xQeWvG816bUx9EPjHmaT23yvVMxVd5gbFQxP4mR3cY
```

## 六、导入 SQLite 数据

执行：

```bash
npm run import:sqlite
```

该命令会调用 [`scripts/import_sqlite.js`](scripts/import_sqlite.js:1)，将 TXT 数据导入 SQLite。

导入后数据库会写入：
- 默认 [`data/app.db`](data/app.db:1)
- 或你在 `SQLITE_FILE` 中指定的位置

注意：
- 导入是覆盖写入，不是追加写入
- 任务和地址表都会被重新写入

## 七、当前项目的部署限制

当前仓库的接口位于：
- [`api/tasks.js`](api/tasks.js:1)
- [`api/winners.js`](api/winners.js:1)
- [`api/auth/login.js`](api/auth/login.js:1)
- [`api/auth/logout.js`](api/auth/logout.js:1)
- [`api/auth/session.js`](api/auth/session.js:1)

这套结构本质上是 **Vercel 风格的 Serverless API**。

也就是说，当前仓库：
- 已有 API handler
- 已有 SQLite 存储层 [`lib/sqlite.js`](lib/sqlite.js:1)
- 但**还没有普通 VPS 可直接 `node server.js` 启动的服务入口**

如果你要正式部署到 VPS，推荐下一步补一个：
- `server.js`

它负责：
- 托管前端静态资源
- 转发 `/api/*` 请求到现有 handler
- 提供一个可被 PM2 管理的 Node 进程

## 八、补齐服务入口后的启动方式

如果后续增加了 `server.js`，启动方式通常是：

```bash
pm2 start server.js --name galxe-task
pm2 save
pm2 startup
```

## 九、Nginx 反向代理示例

假设 Node 服务监听 `3000` 端口：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

应用配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 十、备份建议

SQLite 最重要的是数据库文件备份。

建议定期备份：
- [`data/app.db`](data/app.db:1)
- 或你自定义的数据库路径文件

例如：

```bash
cp /var/lib/galxe-task/app.db /var/backups/galxe-task-app-$(date +%F).db
```

## 十一、当前最推荐的下一步

如果你的目标是“直接部署到 VPS 可用”，最合理的动作是：
1. 保留当前 SQLite 方案
2. 新增一个 `server.js`
3. 用 PM2 托管
4. 用 Nginx 反代

目前这个仓库已经完成了 SQLite 存储改造，但距离 VPS 一键运行，还差一个服务入口层。