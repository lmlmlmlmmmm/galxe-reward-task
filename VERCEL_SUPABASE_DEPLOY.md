# Vercel + Supabase 部署说明

## 1. 数据表设计

当前版本使用三张表：

- `tasks`
- `evm_address`
- `sol_address`

初始化 SQL 在 [supabase/init.sql](C:/Users/Administrator/Desktop/galxe-reward-task/supabase/init.sql)。

## 2. Supabase 初始化

在 Supabase SQL Editor 执行 [supabase/init.sql](C:/Users/Administrator/Desktop/galxe-reward-task/supabase/init.sql)。

表结构说明：

- `tasks`
  结构化保存任务，不再把整份 TXT 直接存在数据库
- `evm_address`
  一行一个 EVM 地址，使用 `wallet_index` 保留原始顺序
- `sol_address`
  一行一个 SOL 地址，使用 `wallet_index` 保留原始顺序

## 3. 导入现有数据

本地配置好环境变量后，运行：

```bash
npm run import:supabase
```

这个脚本会读取：

- [data/tasks.txt](C:/Users/Administrator/Desktop/galxe-reward-task/data/tasks.txt)
- [data/evm_address.txt](C:/Users/Administrator/Desktop/galxe-reward-task/data/evm_address.txt)
- [data/sol_address.txt](C:/Users/Administrator/Desktop/galxe-reward-task/data/sol_address.txt)

然后分别写入三张表。

导入脚本位置：

- [scripts/import_supabase.js](C:/Users/Administrator/Desktop/galxe-reward-task/scripts/import_supabase.js)

## 4. Vercel 环境变量

在 Vercel Project Settings -> Environment Variables 配置：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TASKS_TABLE`
- `SUPABASE_EVM_ADDRESS_TABLE`
- `SUPABASE_SOL_ADDRESS_TABLE`

默认值分别是：

- `tasks`
- `evm_address`
- `sol_address`

如果你表名没改，可以直接用默认值。

`SUPABASE_SERVICE_ROLE_KEY` 是服务端密钥，只能配置在 Vercel，不能给前端。

如果前端和 API 不在同一个域名，还可以配置：

- `VITE_API_BASE_URL`

## 5. 当前 API

- `/api/tasks`
  读取或保存任务
- `/api/winners`
  查询中奖结果

说明：

- 前端已经直接按结构化 `taskMap` 读写
- `/api/tasks` 仍保留 `rawText` 输出，便于兼容导出或排查
- 地址匹配直接读取 `evm_address` 和 `sol_address`

这样数据库和前端传输都已经是结构化存储。

## 6. Supabase 权限建议

这个项目当前是：

- 浏览器只请求 Vercel API
- Vercel API 使用 `SUPABASE_SERVICE_ROLE_KEY` 访问 Supabase

所以最简单、最稳的做法是：

1. 三张表都不开给前端直连
2. 前端不要使用 Supabase anon key
3. 所有数据库操作都只走 Vercel API

如果你想更严格一点，建议：

- 打开 RLS（行级安全，Row Level Security）
- 不写任何允许 `anon` / `authenticated` 的 policy
- 只让服务端通过 `service_role` 访问

因为 `service_role` 会绕过 RLS，所以这种模式下：

- 即使表开了 RLS
- 前端也无法直接查表
- 只有你的 Vercel API 能访问

这对你这种后台任务面板更合适。

## 7. 本地开发

这个版本本地只跑 `vite` 不够，因为 `/api/*` 由 Vercel 提供。

建议本地开发时使用 Vercel 本地模式，或者自己提供同路径 API。
