# 服务器部署说明

本文档说明如何将当前项目部署到普通 Linux 服务器，并使用 SQLite 持久化数据。

## 适用场景

当前项目适合部署到：
- Ubuntu / Debian VPS
- 带持久化磁盘的云主机
- 自建 Docker 宿主机

不建议部署到：
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

当前仓库已补齐：
- 常驻服务入口 [`server.js`](server.js:1)
- 前端构建产物托管 `dist/`
- `/api/*` 到现有 [`api/tasks.js`](api/tasks.js:1)、[`api/winners.js`](api/winners.js:1)、[`api/auth/login.js`](api/auth/login.js:1) 等接口的转发

推荐目录：

```bash
/var/www/galxe-task
```

## 一、修复 Node 环境

如果你之前执行过 `n stable` 后出现：

```bash
-bash: /usr/bin/node: No such file or directory
```

先执行：

```bash
hash -r
export PATH=/usr/local/bin:$PATH
which node
which npm
node -v
npm -v
```

如果还不正常，直接验证绝对路径：

```bash
/usr/local/bin/node -v
/usr/local/bin/npm -v
```

为了永久生效，建议写入 `~/.bashrc`：

```bash
echo 'export PATH=/usr/local/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

建议最终版本：
- Node.js 20 / 22 / 24 LTS

## 二、安装系统依赖

```bash
sudo apt update
sudo apt install -y nginx curl build-essential python3 make g++
```

说明：
- [`better-sqlite3`](package.json:16) 是原生模块，通常需要编译环境
- 如果你的 Node 是通过 `n` 安装的，`npm` 全局命令也会走 `/usr/local/bin`

安装 PM2：

```bash
npm install -g pm2
```

检查版本：

```bash
node -v
npm -v
pm2 -v
```

## 三、上传项目

将项目上传到服务器，例如：

```bash
/var/www/galxe-task
```

进入项目目录：

```bash
cd /var/www/galxe-task
```

## 四、配置环境变量

参考 [`.env.example`](.env.example:1) 创建 `.env` 文件。

[`npm run start:server`](package.json:11) 与 [`npm start`](package.json:10) 启动时会自动读取项目根目录下的 [`.env`](.env:1)；如果系统环境变量里已存在同名配置，则系统环境变量优先，不会被 `.env` 覆盖。

示例：

```env
PORT=3000
NODE_ENV=production
SQLITE_FILE=/var/lib/galxe-task/app.db
SQLITE_TASKS_TABLE=tasks
SQLITE_EVM_ADDRESS_TABLE=evm_address
SQLITE_SOL_ADDRESS_TABLE=sol_address
APP_LOGIN_USERNAME=admin
APP_LOGIN_PASSWORD=你的后台密码
AUTH_SESSION_SECRET=请替换为长随机字符串
VITE_API_BASE_URL=
```

### 环境变量说明

- `PORT`：Node 服务监听端口，默认 `3000`
- `NODE_ENV`：生产环境建议设为 `production`
- `SQLITE_FILE`：SQLite 数据库文件路径
- `APP_LOGIN_USERNAME`：后台登录账号
- `APP_LOGIN_PASSWORD`：后台登录密码
- `AUTH_SESSION_SECRET`：登录态签名密钥

建议先创建数据库目录：

```bash
sudo mkdir -p /var/lib/galxe-task
sudo chown -R $USER:$USER /var/lib/galxe-task
```

## 五、安装依赖

```bash
npm install
```

如果你的机器上 `npm install` 仍然异常，可以直接用绝对路径：

```bash
/usr/local/bin/npm install
```

## 六、构建前端

```bash
npm run build
```

构建后会生成：
- `dist/`

[`server.js`](server.js:1) 会直接托管该目录下的静态文件。

## 七、准备导入数据

将以下文件放到 [`data`](data:1) 目录：
- [`data/tasks.txt`](data/tasks.txt:1)
- [`data/evm_address.txt`](data/evm_address.txt:1)
- [`data/sol_address.txt`](data/sol_address.txt:1)

地址文件格式要求：
- 一行一个地址
- 空行会自动忽略
- 不要加额外说明文字

## 八、导入 SQLite 数据

优先执行：

```bash
npm run import:sqlite
```

如果服务器上仍有 ESM 兼容问题，则执行：

```bash
npm run import:sqlite:cjs
```

该命令会调用 [`scripts/import_sqlite.js`](scripts/import_sqlite.js:1)，将 TXT 数据导入 SQLite。

导入后数据库会写入：
- 你在 `SQLITE_FILE` 中指定的位置
- 例如 `/var/lib/galxe-task/app.db`

注意：
- 导入是覆盖写入，不是追加写入
- 任务和地址表都会被重新写入

## 九、启动服务

### 直接启动

```bash
npm run start
```

或：

```bash
node server.js
```

启动后默认监听：
- `http://127.0.0.1:3000`

### 使用 PM2 常驻

```bash
pm2 start server.js --name galxe-task
pm2 save
pm2 startup
```

如果需要指定环境变量文件，最简单方式是先 `source .env` 再启动，或者使用你自己的 PM2 ecosystem 配置。

常用命令：

```bash
pm2 status
pm2 logs galxe-task
pm2 restart galxe-task
```

## 十、验证接口

服务启动后，至少验证以下地址：

```bash
curl -i http://127.0.0.1:3000/api/auth/session
curl -i http://127.0.0.1:3000/api/tasks
```

说明：
- 未登录时，`/api/auth/session` 返回 `401` 属于正常现象
- `/api/tasks` 也会因为未登录返回 `401`，说明服务路由已通
- 浏览器访问 `/` 应该能打开前端页面

## 十一、Nginx 反向代理示例

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

将配置保存到例如：

```bash
/etc/nginx/sites-available/galxe-task
```

然后启用：

```bash
sudo ln -sf /etc/nginx/sites-available/galxe-task /etc/nginx/sites-enabled/galxe-task
sudo nginx -t
sudo systemctl reload nginx
```

## 十二、完整部署命令顺序

如果你的 Node/npm 已恢复正常，实际部署顺序可直接按下面执行：

```bash
cd /var/www/galxe-task
export PATH=/usr/local/bin:$PATH
npm install
npm run build
npm run import:sqlite
pm2 start server.js --name galxe-task
pm2 save
```

## 十三、备份建议

SQLite 最重要的是数据库文件备份。

建议定期备份你在 `SQLITE_FILE` 中配置的数据库文件，例如：

```bash
cp /var/lib/galxe-task/app.db /var/backups/galxe-task-app-$(date +%F).db
```

## 十四、当前部署结论

当前仓库现在已经可以按下面方式在普通 VPS 上运行：
1. `npm install`
2. `npm run build`
3. `npm run import:sqlite`
4. `npm run start` 或 `pm2 start server.js --name galxe-task`
5. Nginx 反向代理到 `3000` 端口

也就是说，现在不再依赖 Vercel 才能跑接口。 [`server.js`](server.js:1) 已经作为普通 Node 服务入口使用。