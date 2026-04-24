# galxe-task

基于 `Vue 3 + Element Plus + Vercel API + SQLite` 的 Galxe 任务管理面板。

## 当前架构

- 前端：Vite + Vue 3
- 接口：Vercel Serverless Functions（无服务器函数）
- 数据库：SQLite
- 数据表：
  - `tasks`
  - `evm_address`
  - `sol_address`

前端不会直接连接数据库，而是统一请求：

- `/api/tasks`
- `/api/winners`

这样敏感数据和服务端逻辑不会暴露到浏览器。

## 功能

- 按日期查看任务
- 从 Galxe 抓取指定日期任务
- 修改任务排序
- 修改任务序号
- 修改“做 / 不做 / 待定”
- 修改备注
- 删除任务
- 自动保存到 SQLite
- 查询中奖结果

## 数据表设计

### `tasks`

- `id`
- `task_date`
- `sort_order`
- `task_time`
- `url`
- `campaign_id`
- `sequence_values`
- `need_create`
- `remark`

### `evm_address`

- `wallet_index`
- `address`
- `remark`
- `is_active`

### `sol_address`

- `wallet_index`
- `address`
- `remark`
- `is_active`

SQLite 会在首次访问时自动初始化数据库和表结构。

## 本地开发

安装依赖：

```bash
npm install
```

启动前端：

```bash
npm run dev
```

说明：

- 这个项目的 `/api/*` 由 Vercel 提供
- 只运行 `vite` 只能看前端页面
- 如果要完整联调，建议使用 Vercel 本地开发模式

## 导入现有数据

先配置环境变量，然后执行：

```bash
npm run import:sqlite
```

导入脚本会读取：

- [data/tasks.txt](data/tasks.txt)
- [data/evm_address.txt](data/evm_address.txt)
- [data/sol_address.txt](data/sol_address.txt)

并写入对应三张表。

导入脚本：

- [scripts/import_sqlite.js](scripts/import_sqlite.js)

## 部署

服务器部署文档：

- [DEPLOY_SERVER.md](DEPLOY_SERVER.md)

环境变量样例：

- [.env.example](.env.example)

认证相关环境变量：

- `APP_LOGIN_USERNAME`
- `APP_LOGIN_PASSWORD`
- `AUTH_SESSION_SECRET`

SQLite 相关环境变量：

- `SQLITE_FILE`
- `SQLITE_TASKS_TABLE`
- `SQLITE_EVM_ADDRESS_TABLE`
- `SQLITE_SOL_ADDRESS_TABLE`

默认值分别是：

- `data/app.db`
- `tasks`
- `evm_address`
- `sol_address`

注意事项：

- Vercel Serverless 环境通常不适合持久化本地 SQLite 文件
- 更适合部署在可写磁盘的 Node.js 服务环境中
- 如果仍然部署到 Vercel，重启或实例切换后本地数据库文件可能丢失
