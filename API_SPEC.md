# 博客内容 API 规格（API_SPEC）

本文档描述 `blog-admin-api`（Cloudflare Worker + Hono）对外暴露的全部 HTTP 接口，覆盖文章管理、媒体库、私人网盘三大模块。

- **基地址**（生产）：`https://blog-admin-api.chiangkh06.workers.dev`
- **本地开发**：`http://127.0.0.1:8787`（`wrangler dev --local`，配合 `workers/blog-api/.dev.vars`）
- 所有 `/api/*` 路由均启用 CORS（`Access-Control-Allow-Origin: *`，允许 `Content-Type` / `Authorization` 头）。
- 错误响应统一为 `{ "error": string }`，部分场景附额外字段。

---

## 1. 认证体系

| 身份 | 凭证 | 适用接口 | 说明 |
|---|---|---|---|
| 管理员 | `Authorization: Bearer <ADMIN_TOKEN>` | `/api/posts*`、`/api/media*`、`/api/drive/folders/secret` | 唯一拥有全部写权限的凭证 |
| 网盘全局用户 | `POST /api/drive/login` 换取 token（scope=`drive`） | `/api/drive/*` 写操作 + 文件夹密码管理 | 有效期默认 12h |
| 网盘文件夹用户 | `POST /api/drive/unlock` 换取 token（scope=`folder`） | 该文件夹及其子文件夹**只读** | 有效期 2h |
| 匿名 | 无 | 公开文章 / 媒体（public）/ 未加密网盘目录 | 加密目录返回 403 |

### 1.1 网盘会话 token

格式：`dv1.<base64url(payload)>.<base64url(HMAC-SHA256(secret, payload))>`

```jsonc
// payload
{
  "scope": "drive" | "folder",   // drive=全局可写；folder=仅读指定文件夹树
  "sub": "owner" | "folder:/x",
  "iat": 1710000000,
  "exp": 17100043200,
  "jti": "<uuid>",
  "folder": "/x"                  // 仅 scope='folder' 存在
}
```

- 无状态，可离线校验；校验使用常数时间比较（`timingSafeEqualStr`），防时序攻击。
- **scope 越权防护**：文件夹 token 不能调用写接口（重命名/移动/删除/上传）；全局 token 才可写。

### 1.2 流媒体签名 URL

浏览器 `<video>` / `<a>` 无法附加 `Authorization` 头，故由服务端签发短时效签名 URL：

```
GET /api/drive/files/:id/stream?exp=<epoch>&sig=<hmac>
GET /api/drive/files/:id/download?exp=<epoch>&sig=<hmac>
```

签名内容：`HMAC-SHA256(DRIVE_TOKEN_SECRET, "{fileId}.{action}.{exp}")`。

| action | 时效 | 用途 |
|---|---|---|
| `stream` | 900s（15 分钟） | 在线播放 |
| `download` | 300s（5 分钟） | 下载 |

---

## 2. 文章（6 个）

> 请求/响应中的文章字段：`slug, title, description, pubDate(YYYY-MM-DD), tags[], category, draft(boolean), content`。
> 数据库另有 `cover_image`、`content_format`（`markdown`/`html`）两列，已建好、按增量扩展保留（见 §6 数据模型）。

### 2.1 `GET /api/public/posts` — 公开文章全量

- 认证：无
- 返回：已发布文章（`draft=0`）数组，按 `pub_date` 倒序。**构建时同步用**，向后兼容。

### 2.2 `GET /api/posts` — 管理端文章列表

- 认证：admin
- 返回：全部文章（含草稿）数组。

### 2.3 `GET /api/posts/:slug` — 读取单篇

- 认证：admin
- 404：文章不存在

### 2.4 `POST /api/posts` — 创建 / 更新文章

- 认证：admin
- 请求体：

```jsonc
{
  "slug": "my-post",          // 必填，仅小写字母/数字/连字符
  "title": "标题",             // 必填
  "description": "简介",       // 必填
  "pubDate": "2026-08-10",     // 必填，YYYY-MM-DD
  "tags": ["astro", "教程"],
  "category": "tech",          // 可选：tech | hiking | essay
  "draft": false,
  "content": "正文…"
}
```

- 校验失败 → 400（见 `workers/blog-api/src/article.ts`）。
- 成功：以 `slug` 为 key 插入或更新；随后触发 GitHub Actions 重建（`triggerRebuild`）。
- 返回 `{ ok, slug, created, build }`；**新建 201 / 更新 200**。

### 2.5 `DELETE /api/posts/:slug` — 删除文章

- 认证：admin
- 404：不存在；成功：`{ ok, build }`，触发重建。

---

## 3. 媒体库（10 个）

> 媒体对象存 R2（`media/{YYYY}/{MM}/{uuid}.{ext}`），D1 只存元数据。媒体**绝不进入 GitHub**。

### 3.1 `GET /api/media` — 列表

- 认证：admin
- 查询参数：`page`（默认 1）、`pageSize`（默认 20，上限 100）、`type`（image/video/file）、`visibility`（public/private）、`q`（标题/简介模糊搜索）
- 返回：`{ items: Media[], total, page, pageSize }`

### 3.2 `GET /api/media/:id` — 元数据（含引用片段）

- 认证：admin
- 返回：`Media` 对象，含 `url`、`markdown`（`![title](<url>)`）、`html`（`<img ...>`）引用片段，便于粘贴进正文。

### 3.3 `POST /api/media` — 单次上传（multipart）

- 认证：admin
- multipart 字段：`file`（必填）、`visibility`（public/private，默认 public）、`title`、`description`、`tags`
- 大小上限：50 MB（`MEDIA_SINGLE_MAX_BYTES`，超限 413，提示改用分片）
- MIME 白名单外 → 415；文件为空 → 400
- 成功：计算 SHA-256，写入 R2 + D1，返回 `Media`（**201**）

### 3.4 `POST /api/media/uploads` — 分片上传初始化

- 认证：admin
- 请求体：`{ filename, mimeType, sizeBytes, visibility?, title?, description?, tags? }`
- MIME 白名单外 → 415；总大小超 5 GiB → 413
- 返回（**201**）：`{ uploadId, r2Key, partSize(5 MiB), expectedParts, expiresAt(24h) }`

### 3.5 `GET /api/media/uploads/:uploadId` — 上传状态（断点续传）

- 认证：admin
- 返回会话与已传分片列表（`parts: [{partNumber, etag, sizeBytes}]`）

### 3.6 `POST /api/media/uploads/:uploadId/parts?partNumber=N` — 上传分片

- 认证：admin
- 请求体：裸二进制（`Content-Type: application/octet-stream`）
- 幂等（同 partNumber 覆盖）；大小不合规 → 422（非末片须恰好 `partSize` 且 ≥5 MiB）
- 返回：`{ partNumber, etag, sizeBytes }`

### 3.7 `POST /api/media/uploads/:uploadId/complete` — 完成合并

- 认证：admin
- 分片缺失 → 409 + `{ missing: [n] }`；成功：合并 R2 分片、写入 `media` 表、回填 `target_id`，返回 `Media`（**201**）

### 3.8 `POST /api/media/uploads/:uploadId/abort` — 中止上传

- 认证：admin
- 成功：`{ ok: true }`

### 3.9 `GET / HEAD /api/media/:id/file` — 流式输出

- 认证：**按 visibility**——public 免鉴权（长缓存 `public, max-age=31536000, immutable`）；private 需 admin Bearer（`no-store`）
- 支持 HTTP Range（视频 seek）：206 / 416
- SVG 输出附加 `Content-Security-Policy: default-src 'none'; sandbox`
- 404：媒体不存在

### 3.10 `DELETE /api/media/:id` — 删除媒体

- 认证：admin
- 被文章引用（正文含其 url 或封面图）→ **409** + `{ error, references: [slug] }`
- 成功：删除 R2 对象 + D1 记录，返回 `{ ok: true }`

### Media 对象结构

```jsonc
{
  "id": "uuid", "type": "image|video|file", "visibility": "public|private",
  "mimeType": "image/png", "extension": "png", "sizeBytes": 1234,
  "width": null, "height": null, "durationMs": null,
  "title": "原始文件名", "description": "", "tags": [],
  "createdAt": "ISO", "updatedAt": "ISO",
  "url": "…/api/media/<id>/file", "markdown": "![…]", "html": "<img …>"
}
```

---

## 4. 私人网盘（17 个）

> 网盘文件存 R2（`drive/{uuid}.{ext}`），`/drive` 页面不出现在导航 / sitemap / 首页。
> 访问模型：**匿名可浏览未加密目录**；加密目录需文件夹 token（只读）或全局 token；写操作需全局 token 或 admin。

### 4.1 `POST /api/drive/login` — 全局密码登录

- 认证：无
- 请求体：`{ password }`
- 成功：`{ token, expiresAt, expiresIn, user: {sub:'owner', role:'owner'} }`
- 密码错误 / 未配置 → 401

### 4.2 `POST /api/drive/logout` — 登出

- 认证：drive（全局）
- 服务端无状态，返回 `{ ok: true }`，客户端自行丢弃 token

### 4.3 `GET /api/drive/me` — 会话信息

- 认证：drive（全局）
- 返回：`{ ok: true, user: {sub, role}, exp }`

### 4.4 `GET /api/drive/folders` — 目录树（公开）

- 认证：无
- 返回：`{ folders: [{ path: "/x", locked: boolean }] }`
- 目录由现有文件 + 已加密文件夹推导（空加密文件夹也会出现）；**绝不泄漏 hash/salt**；加密文件夹名称可见、内容受密码保护

### 4.5 `GET /api/drive/files` — 文件列表

- 认证：按文件夹（见下）
- 查询参数：`folder`（精确目录）、`q`（文件名搜索）、`page`、`pageSize`（默认 20 上限 100）、`sort`（created|name|size|downloads，默认 created）
- **权限规则**：
  - 指定 `folder`：该文件夹加密且无覆盖 token → **403** `{ error, locked: true }`
  - 未指定 `folder`（全局浏览/搜索）：匿名或文件夹 token 自动排除未授权的加密目录；全局 token 可见全部
- 返回：`{ items: DriveFile[], total, page, pageSize }`

### 4.6 `GET /api/drive/files/:id` — 文件元数据

- 认证：按文件夹
- 加密目录无 token → 403；返回 `DriveFile`

### 4.7 `POST /api/drive/unlock` — 解锁加密文件夹

- 认证：无
- 请求体：`{ folder, password }`（密码仅经 POST body，**绝不入 URL/日志**）
- 成功：`{ token, folder, expiresAt, expiresIn }`（文件夹 token，2h）
- 错误：401 密码错误；404 未加密；400 根目录；**429 防爆破冷却**
- **防爆破**：连续 5 次错误密码 → 锁定 300s，返回 `{ error, retryAfter }`；成功后清零计数

### 4.8 `POST /api/drive/folders/secret` — 设置 / 清除文件夹密码

- 认证：**admin 或网盘全局 token**（`requireAdminOrDrive`）
- 请求体：`{ folder, password }`；`password` 为空字符串 = 清除
- 根目录加密 → 400；密码长度须 4–200 → 400
- 只存 PBKDF2-SHA256（100k 次迭代，随机 16B 盐）哈希；**明文密码绝不落 git / 日志**
- 成功：`{ ok: true }`

### 4.9 `DELETE /api/drive/folders/secret?folder=/x` — 清除文件夹密码

- 认证：admin 或网盘全局 token
- 成功：`{ ok: true }`

### 4.10 `POST /api/drive/files/:id/rename` — 重命名

- 认证：drive（全局）
- 请求体：`{ filename }`；成功返回更新后的 `DriveFile`

### 4.11 `POST /api/drive/files/:id/move` — 移动目录

- 认证：drive（全局）
- 请求体：`{ folder }`；成功返回更新后的 `DriveFile`

### 4.12 `DELETE /api/drive/files/:id` — 删除文件

- 认证：drive（全局）
- 删除 R2 对象 + 元数据；成功：`{ ok: true }`

### 4.13 `POST /api/drive/files/:id/sign` — 签发签名 URL

- 认证：按文件夹（加密目录需文件夹/全局 token）
- 请求体：`{ action: "stream" | "download" }`，非法值 → 400
- 返回：`{ url, expiresAt, filename, mimeType }`（见 §1.2）

### 4.14 `GET / HEAD /api/drive/files/:id/stream` — 在线播放

- 认证：**签名 URL 或 Bearer（全局/文件夹 token）或匿名**（文件在未加密目录时）
- 支持 Range（206/416）；`no-store`；附件名走 RFC 5987（中文安全）
- HTML / SVG 附加 `Content-Security-Policy: default-src 'none'; sandbox`

### 4.15 `GET /api/drive/files/:id/download` — 下载

- 认证：同 4.14
- `Content-Disposition: attachment`，**`download_count` +1**

### 4.16 网盘分片上传（`/api/drive/uploads` 系列）

认证全部为 drive（全局）。协议与 §3.4–3.8 相同，额外参数 `folder`（目录，归一化：去 `..`、控制字符，最长 6 层）。

| 方法 | 路径 | 返回 |
|---|---|---|
| POST | `/api/drive/uploads` | `{ uploadId, r2Key, partSize, expectedParts, expiresAt }`（201） |
| GET | `/api/drive/uploads/:uploadId` | 上传状态 + 已传分片 |
| POST | `/api/drive/uploads/:uploadId/parts?partNumber=N` | `{ partNumber, etag, sizeBytes }` |
| POST | `/api/drive/uploads/:uploadId/complete` | `DriveFile`（201）；分片缺失 → 409+missing |
| POST | `/api/drive/uploads/:uploadId/abort` | `{ ok: true }` |

> 网盘**不限制 MIME 白名单**（可传任意类型），但上传前会校验文件名（去路径分隔符/控制字符）且 R2 key 由服务端 UUID 生成，杜绝目录穿越。

### DriveFile 对象结构

```jsonc
{
  "id": "uuid", "filename": "示例.mp4", "folder": "/photos/2026",
  "sizeBytes": 12345678, "mimeType": "video/mp4",
  "downloadCount": 0, "sha256": "…", "uploadedBy": "owner",
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

---

## 5. 分片上传通用协议（media 与 drive 共用）

1. **初始化** `POST /<scope>/uploads` → 得 `{ uploadId, partSize, expectedParts }`
2. **循环上传分片** `POST /<scope>/uploads/:uploadId/parts?partNumber=N`（裸二进制 body，从 1 开始）
3. **完成合并** `POST /<scope>/uploads/:uploadId/complete`
   - 支持**断点续传**：`GET /<scope>/uploads/:uploadId` 返回已传分片，续传跳过
4. 异常可用 `POST /<scope>/uploads/:uploadId/abort` 中止

约束：
- 单片 `partSize` = 5 MiB；非末片必须 ≥5 MiB 且等于 `partSize`（末片 ≤ partSize）
- 分片总数上限 10000；总大小上限 5 GiB（`UPLOAD_MAX_BYTES`）
- 会话有效期 24h

---

## 6. 数据模型（D1，Cloudflare D1 `blog-db`）

| 表 | 用途 | 关键字段 |
|---|---|---|
| `posts` | 文章 | slug(PK), title, description, pub_date, tags(JSON), category, draft, content, `cover_image`(默认''), `content_format`(默认'`markdown`') |
| `folder_secrets` | 文件夹加密 | folder(PK), `password_hash`(PBKDF2 hex), `salt`(base64url), iterations(默认100000), failed_attempts, locked_until |
| `media` | 媒体元数据 | id(uuid PK), type, visibility, mime_type, extension, size_bytes, r2_key(UNIQUE), sha256, tags |
| `drive_files` | 网盘文件元数据 | id(uuid PK), r2_key(UNIQUE), filename, folder, size_bytes, mime_type, download_count |
| `upload_sessions` | 分片会话 | upload_id(PK), scope(media/drive), r2_key, status, expected_parts, target_id |
| `upload_parts` | 已传分片 | (upload_id, part_number) PK, etag, size_bytes |
| `users` | 预留账号体系（本期不启用） | id, username, password_hash, role, status |

迁移文件：`workers/blog-api/migrations/0001~0004`。对象存储：R2 桶 `blog-media`（binding `MEDIA`）。

---

## 7. 安全设计

| 项目 | 措施 |
|---|---|
| 密码存储 | 文件夹密码：PBKDF2-SHA256 100k 迭代 + 随机 16B 盐，仅存哈希；网盘全局密码在 Worker secret（`DRIVE_PASSWORD`），常数时间比较 |
| 密码传输 | 仅经 POST body；不出现在 URL、日志、git、错误信息 |
| token | HMAC-SHA256 签名 + exp + jti + scope；scope=drive/folder 防越权；校验用常数时间比较 |
| 签名 URL | 短时效（stream 15min / download 5min），id+action+exp 绑定 |
| 防爆破 | `unlock` 连续 5 次失败 → 429 冷却 300s（D1 持久计数） |
| 上传安全 | 媒体 MIME 白名单 + 文件名清洗 + 服务端 UUID R2 key（防目录穿越）；网盘不限 MIME 但同样清洗文件名 |
| 输出安全 | `X-Content-Type-Options: nosniff`；HTML/SVG 附加 CSP sandbox；私密/网盘 `no-store` |
| 权限 | 一律服务端校验（管理端 `requireAuth`、网盘 `requireDriveAuth`/`requireAdminOrDrive`、按文件夹 `canReadFolder`） |

---

## 8. 错误码汇总

| 状态码 | 含义 |
|---|---|
| 400 | 参数/请求体非法（slug、日期、分类、密码长度、根目录加密等） |
| 401 | 未认证或 token 无效/过期/scope 不足 |
| 403 | 加密文件夹未解锁 |
| 404 | 资源不存在 / 上传会话不存在 / 文件夹未加密 |
| 409 | 冲突（被引用媒体、分片缺失、上传已完成） |
| 410 | 上传会话已中止/过期 |
| 413 | 文件超上限 |
| 415 | MIME 不在白名单 |
| 416 | Range 不可满足 |
| 422 | 分片大小不合规 |
| 429 | 解锁尝试过于频繁（防爆破冷却） |
| 500 | 服务器内部错误 |

---

## 9. 部署相关

- Worker：`wrangler d1 migrations apply blog-db --remote` + `wrangler deploy`（工作目录 `workers/blog-api`）
- 必需 secrets：`ADMIN_TOKEN`、`GITHUB_TOKEN`、`DRIVE_PASSWORD`、`DRIVE_TOKEN_SECRET`
- Vars：`GITHUB_REPO_OWNER`、`GITHUB_REPO`、`GITHUB_BRANCH`、`WORKFLOW_FILE`、`MEDIA_SINGLE_MAX_BYTES`、`UPLOAD_MAX_BYTES`、`DRIVE_TOKEN_TTL_SECONDS`
- 管理端：`npm --prefix admin run deploy`（Cloudflare Pages）
- 部署顺序：**先 Worker 后前端**（新前端依赖 `/api/drive/unlock`、`/api/drive/folders` 路由）
