# blog-admin-api 接口文档

博客文章上传存储 API。部署在 Cloudflare Workers（Hono），数据存储在 Cloudflare D1。

- **Base URL（线上）**：`https://blog-admin-api.chiangkh06.workers.dev`
- **Base URL（本地开发）**：`http://127.0.0.1:8787`（`wrangler dev --local`）

---

## 1. 总览

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/` | 无 | API 状态与接口列表说明 |
| GET | `/api/public/posts` | 无 | 已发布文章全量（构建时同步用） |
| GET | `/api/posts` | Bearer | 文章列表（含草稿） |
| GET | `/api/posts/:slug` | Bearer | 读取单篇文章 |
| POST | `/api/posts` | Bearer | 创建 / 更新文章（slug 为唯一键） |
| DELETE | `/api/posts/:slug` | Bearer | 删除文章 |

写 / 删成功后，Worker 会自动触发 GitHub Actions 重建博客（`workflow_dispatch`）。

---

## 2. 认证

管理类接口（`/api/posts*`）需要请求头：

```
Authorization: Bearer <ADMIN_TOKEN>
```

`ADMIN_TOKEN` 通过 `wrangler secret put ADMIN_TOKEN` 设置。未认证或令牌错误返回 `401`。

---

## 3. 通用数据结构

### 文章对象（Post）

| 字段 | 类型 | 说明 |
|---|---|---|
| `slug` | string | URL 标识，小写字母/数字/连字符，唯一 |
| `title` | string | 标题 |
| `description` | string | 简介 / 摘要 |
| `pubDate` | string | 发布日期，`YYYY-MM-DD` |
| `tags` | string[] | 标签数组 |
| `category` | string | 分类：`tech` 技术 / `hiking` 登山 / `essay` 随笔，可空字符串 |
| `draft` | boolean | `true` 草稿（不对外发布）/ `false` 已发布 |
| `content` | string | Markdown 正文 |

### 错误响应（统一格式）

```json
{ "error": "错误描述" }
```

HTTP 状态码：
- `400` 参数校验失败
- `401` 未认证 / 令牌错误
- `404` 文章不存在
- `500` 服务器内部错误

---

## 4. 接口详情

### 4.1 GET `/` —— API 状态说明

返回 API 的名称、描述与接口列表。

**认证**：无

**响应** `200`

```json
{
  "name": "blog-admin-api",
  "description": "博客文章上传存储 API",
  "endpoints": [
    { "method": "GET", "path": "/api/public/posts", "auth": false, "note": "已发布文章（构建时同步用）" },
    { "method": "GET", "path": "/api/posts", "auth": true, "note": "管理端文章列表" },
    { "method": "GET", "path": "/api/posts/:slug", "auth": true, "note": "读取单篇" },
    { "method": "POST", "path": "/api/posts", "auth": true, "note": "创建 / 更新文章" },
    { "method": "DELETE", "path": "/api/posts/:slug", "auth": true, "note": "删除文章" }
  ]
}
```

---

### 4.2 GET `/api/public/posts` —— 已发布文章全量

**用途**：构建时同步（`scripts/sync-content.mjs`）从本接口拉取所有 `draft=false` 的文章生成静态页。**无需认证，任何人可访问。**

**认证**：无

**响应** `200` —— Post 数组，按 `pubDate` 倒序：

```json
[
  {
    "slug": "my-first-post",
    "title": "我的第一篇文章",
    "description": "这是一篇示例文章。",
    "pubDate": "2026-08-10",
    "tags": ["Astro", "教程"],
    "category": "tech",
    "draft": false,
    "content": "## 标题\n\n正文内容……"
  }
]
```

---

### 4.3 GET `/api/posts` —— 文章列表（含草稿）

**认证**：Bearer

**响应** `200` —— 全部文章（含 `draft=true`），按 `pubDate` 倒序：

```json
[
  {
    "slug": "draft-post",
    "title": "未写完的文章",
    "description": "……",
    "pubDate": "2026-08-09",
    "tags": [],
    "category": "",
    "draft": true,
    "content": "## 标题\n\n……"
  }
]
```

---

### 4.4 GET `/api/posts/:slug` —— 读取单篇

**认证**：Bearer

**响应** `200`

```json
{
  "slug": "my-first-post",
  "title": "我的第一篇文章",
  "description": "这是一篇示例文章。",
  "pubDate": "2026-08-10",
  "tags": ["Astro"],
  "category": "tech",
  "draft": false,
  "content": "## 标题\n\n正文内容……"
}
```

**响应** `404`

```json
{ "error": "文章不存在" }
```

---

### 4.5 POST `/api/posts` —— 创建 / 更新文章

**用途**：以 `slug` 为唯一键，存在则更新，不存在则创建。写成功后自动触发 GitHub Actions 重建。

**认证**：Bearer

**请求体**（JSON）：

```json
{
  "slug": "my-first-post",
  "title": "我的第一篇文章",
  "description": "这是一篇示例文章。",
  "pubDate": "2026-08-10",
  "tags": ["Astro", "教程"],
  "category": "tech",
  "draft": false,
  "content": "## 标题\n\n正文内容……"
}
```

**字段校验规则**：

| 字段 | 规则 |
|---|---|
| `slug` | 必填，小写字母 / 数字 / 连字符（正则 `^[a-z0-9]+(?:-[a-z0-9]+)*$`） |
| `title` | 必填，非空 |
| `description` | 必填，非空 |
| `pubDate` | 必填，格式 `YYYY-MM-DD` |
| `tags` | 必填，字符串数组 |
| `category` | 可选，`tech` / `hiking` / `essay` 之一，或空串 |
| `draft` | 可选，布尔值 |
| `content` | 必填，非空（Markdown） |

**响应** `201`（创建成功）或 `200`（更新成功）：

```json
{
  "ok": true,
  "slug": "my-first-post",
  "created": true,
  "build": "已触发构建"
}
```

- `created`：`true` 新建 / `false` 更新
- `build`：重建触发结果。若为「构建触发失败（HTTP xxx）」，说明文章已保存但博客暂未更新，需检查 `GITHUB_TOKEN`

**响应** `400`（校验失败）：

```json
{ "error": "slug 只能包含小写字母、数字和连字符" }
```

---

### 4.6 DELETE `/api/posts/:slug` —— 删除文章

**认证**：Bearer

**响应** `200`：

```json
{ "ok": true, "build": "已触发构建" }
```

**响应** `404`：

```json
{ "error": "文章不存在" }
```

---

## 5. 调用示例

### curl

```bash
# 写文章
curl -X POST https://blog-admin-api.chiangkh06.workers.dev/api/posts \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"slug":"hello","title":"你好","description":"介绍","pubDate":"2026-08-10","tags":[],"category":"essay","draft":false,"content":"## 你好\n\n正文"}'

# 读列表
curl https://blog-admin-api.chiangkh06.workers.dev/api/posts \
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# 删文章
curl -X DELETE https://blog-admin-api.chiangkh06.workers.dev/api/posts/hello \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### PowerShell

```powershell
$token = "<ADMIN_TOKEN>"

# 写文章（UTF-8 编码避免中文乱码）
$body = '{"slug":"hello","title":"你好","description":"介绍","pubDate":"2026-08-10","tags":[],"category":"essay","draft":false,"content":"## 你好"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$req = [System.Net.HttpWebRequest]::Create("https://blog-admin-api.chiangkh06.workers.dev/api/posts")
$req.Method = "POST"
$req.ContentType = "application/json; charset=utf-8"
$req.Headers.Add("Authorization", "Bearer $token")
$req.ContentLength = $bytes.Length
$req.GetRequestStream().Write($bytes, 0, $bytes.Length)
$resp = $req.GetResponse()
[System.IO.StreamReader]::new($resp.GetResponseStream(), [System.Text.Encoding]::UTF8).ReadToEnd()
```

---

## 6. 触发重建说明

POST 创建 / 更新 或 DELETE 成功后会调用：

```
POST https://api.github.com/repos/ryanchiang200/ryanchiang200.github.io/actions/workflows/deploy.yml/dispatches
body: { "ref": "main" }
```

- 需要 `GITHUB_TOKEN`（GitHub classic PAT，scope `repo` + `workflow`）
- 触发失败**不影响**文章保存，但响应中 `build` 字段会提示，需及时修复
- 重建完成（约 2-3 分钟）后博客更新
