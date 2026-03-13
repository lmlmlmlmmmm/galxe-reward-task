# galxe-task

基于 `Vue 3 + Element Plus + Vercel API + Supabase` 的 Galxe 任务管理面板。

## 当前架构

- 前端：Vite + Vue 3
- 接口：Vercel Serverless Functions（无服务器函数）
- 数据库：Supabase
- 数据表：
  - `tasks`
  - `evm_address`
  - `sol_address`

前端不会直接连接 Supabase，而是统一请求：

- `/api/tasks`
- `/api/winners`

这样敏感数据和服务端密钥不会暴露到浏览器。

## 功能

- 按日期查看任务
- 从 Galxe 抓取指定日期任务
- 修改任务排序
- 修改任务序号
- 修改“做 / 不做 / 待定”
- 修改备注
- 删除任务
- 自动保存到 Supabase
- 查询中奖结果

## 数据表设计

### `tasks`

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

初始化 SQL：

- [supabase/init.sql](C:/Users/Administrator/Desktop/galxe-reward-task/supabase/init.sql)

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
npm run import:supabase
```

导入脚本会读取：

- [data/tasks.txt](C:/Users/Administrator/Desktop/galxe-reward-task/data/tasks.txt)
- [data/evm_address.txt](C:/Users/Administrator/Desktop/galxe-reward-task/data/evm_address.txt)
- [data/sol_address.txt](C:/Users/Administrator/Desktop/galxe-reward-task/data/sol_address.txt)

并写入对应三张表。

导入脚本：

- [scripts/import_supabase.js](C:/Users/Administrator/Desktop/galxe-reward-task/scripts/import_supabase.js)

## 部署

完整部署说明：

- [VERCEL_SUPABASE_DEPLOY.md](C:/Users/Administrator/Desktop/galxe-reward-task/VERCEL_SUPABASE_DEPLOY.md)

环境变量样例：

- [.env.example](C:/Users/Administrator/Desktop/galxe-reward-task/.env.example)

认证相关环境变量：

- `APP_LOGIN_USERNAME`
- `APP_LOGIN_PASSWORD`
- `AUTH_SESSION_SECRET`

Vercel 配置：

- [vercel.json](C:/Users/Administrator/Desktop/galxe-reward-task/vercel.json)

## 权限建议

建议使用：

- 浏览器只访问 Vercel API
- Vercel API 使用 `SUPABASE_SERVICE_ROLE_KEY`
- Supabase 三张表开启 RLS
- 不给 `anon` / `authenticated` 直接表权限

RLS SQL：

- [supabase/rls.sql](C:/Users/Administrator/Desktop/galxe-reward-task/supabase/rls.sql)
