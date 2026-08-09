# blog-admin-api —— 博客文章上传存储 API

Cloudflare Worker（Hono + TypeScript + D1）。管理端（React）通过本 API 把文章写入 D1，写/删成功后自动触发 GitHub Actions 重建，构建时从公开接口同步文章生成静态页。

## 架构

```
admin/ (React 管理端, Cloudflare Pages)
  → POST /api/posts (Bearer ADMIN_TOKEN)
    → Cloudflare Worker (本目录)
      → D1 posts 表
      → 触发 GitHub Actions workflow_dispatch 重建
        → npm run sync（拉取公开接口 → 写 .md）
          → astro build → GitHub Pages
```

## 本地开发

```bash
npm install
wrangler d1 migrations apply blog-db --local   # 建表
# 编辑 .dev.vars（参考 .dev.vars 示例），写入本地测试 ADMIN_TOKEN
npm run dev      # wrangler dev --local，默认端口 8787
npm run check    # tsc --noEmit
npm run test     # 冒烟测试
```

## API

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/public/posts` | 无 | 已发布文章（构建时同步用） |
| GET | `/api/posts` | Bearer | 文章列表（含草稿） |
| GET | `/api/posts/:slug` | Bearer | 读取单篇 |
| POST | `/api/posts` | Bearer | 创建 / 更新（slug 为 key） |
| DELETE | `/api/posts/:slug` | Bearer | 删除 |

写入/删除成功后触发 `GITHUB_REPO_OWNER/GITHUB_REPO` 仓库的 `WORKFLOW_FILE`（默认 deploy.yml）`workflow_dispatch`。

## 部署（一次性）

以下步骤需要 Cloudflare 账号与 GitHub token，交互式登录需你自己完成：

### 1. 登录 Cloudflare

```bash
wrangler login
```

### 2. 创建 D1 数据库并回填 ID

```bash
wrangler d1 create blog-db
# 输出里的 database_id 填入 wrangler.toml 的 [[d1_databases]].database_id
```

### 3. 应用迁移（远程建表）

```bash
wrangler d1 migrations apply blog-db --remote
```

### 4. 设置 secrets

```bash
wrangler secret put ADMIN_TOKEN    # 管理端登录密钥（自定强随机串）
wrangler secret put GITHUB_TOKEN   # GitHub PAT，权限：repo 的 Actions 写权限（触发重建）
```

### 5. 部署 Worker

```bash
wrangler deploy
# 记下输出的公开 URL，如 https://blog-admin-api.<account>.workers.dev
```

### 6. 配置 GitHub Actions 需要的内容源地址

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

| Secret | 值 |
|---|---|
| `CONTENT_API_URL` | 上一步的 Worker 公开 URL |

### 7. 部署 React 管理端

```bash
cd ../../admin
npm install
VITE_API_URL=https://blog-admin-api.<account>.workers.dev npm run deploy
# 或手工：VITE_API_URL=... npm run build && npx wrangler pages deploy dist --project-name blog-admin
```

管理端首次使用：打开 Cloudflare Pages 分配到的 URL，输入 ADMIN_TOKEN 登录。

## 环境变量 / secrets

| 名称 | 类型 | 说明 |
|---|---|---|
| `ADMIN_TOKEN` | secret | 管理端认证，请求头 `Authorization: Bearer <token>` |
| `GITHUB_TOKEN` | secret | 触发 GitHub Actions 重建 |
| `GITHUB_REPO_OWNER` | var | 仓库所有者 |
| `GITHUB_REPO` | var | 仓库名 |
| `GITHUB_BRANCH` | var | 分支（默认 main） |
| `WORKFLOW_FILE` | var | 工作流文件名（默认 deploy.yml） |

本地开发时上述值写在 `.dev.vars`（已被 gitignore，勿提交真实值）。
