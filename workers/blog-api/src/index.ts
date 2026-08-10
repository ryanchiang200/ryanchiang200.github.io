/** 博客内容 API —— Cloudflare Worker + Hono（D1 元数据 + R2 对象存储）
 *  文章管理 / 媒体库 / 私人网盘
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth, type Env } from './auth';
import { listPosts, getPost, upsertPost, deletePost } from './db';
import { triggerRebuild } from './rebuild';
import { validate, type ArticleInput } from './article';
import {
  handleSingleUpload,
  listMedia,
  getMediaRow,
  deleteMedia,
  requestOrigin,
  toMedia,
  isAllowedMime,
  extensionFor,
  sanitizeFilename,
  makeMediaKey,
  guessType,
} from './media';
import { streamObject } from './r2';
import * as uploads from './uploads';
import {
  driveLogin,
  requireDriveAuth,
  signFileUrl,
  verifyDriveToken,
  verifySignedFileUrl,
  type DriveTokenPayload,
} from './driveAuth';
import {
  listFolders,
  listFiles,
  getDriveFile,
  renameDriveFile,
  moveDriveFile,
  deleteDriveFile,
  incrementDownloadCount,
  contentDisposition,
  normalizeFolder,
  makeDriveKey,
  toDriveFile,
} from './drive';

const app = new Hono<{ Bindings: Env; Variables: { driveUser: DriveTokenPayload } }>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

/** API 状态说明 */
app.get('/', (c) =>
  c.json({
    name: 'blog-admin-api',
    description: '博客内容 API：文章 + 媒体 + 网盘',
    endpoints: [
      { method: 'GET', path: '/api/public/posts', auth: false, note: '已发布文章（构建时同步用）' },
      { method: 'GET', path: '/api/posts', auth: true, note: '管理端文章列表' },
      { method: 'GET', path: '/api/posts/:slug', auth: true, note: '读取单篇' },
      { method: 'POST', path: '/api/posts', auth: true, note: '创建 / 更新文章' },
      { method: 'DELETE', path: '/api/posts/:slug', auth: true, note: '删除文章' },
      { method: 'GET', path: '/api/media', auth: true, note: '媒体列表' },
      { method: 'GET', path: '/api/media/:id', auth: true, note: '媒体元数据' },
      { method: 'POST', path: '/api/media', auth: true, note: '单次上传' },
      { method: 'POST', path: '/api/media/uploads', auth: true, note: '分片上传初始化' },
      { method: 'GET', path: '/api/media/uploads/:uploadId', auth: true, note: '上传状态' },
      { method: 'POST', path: '/api/media/uploads/:uploadId/parts', auth: true, note: '上传分片' },
      { method: 'POST', path: '/api/media/uploads/:uploadId/complete', auth: true, note: '完成上传' },
      { method: 'POST', path: '/api/media/uploads/:uploadId/abort', auth: true, note: '中止上传' },
      { method: 'GET/HEAD', path: '/api/media/:id/file', auth: '按 visibility', note: '流式输出（支持 Range）' },
      { method: 'DELETE', path: '/api/media/:id', auth: true, note: '删除媒体' },
      { method: 'POST', path: '/api/drive/login', auth: false, note: '网盘密码换 token' },
      { method: 'GET', path: '/api/drive/me', auth: 'drive', note: '网盘会话信息' },
      { method: 'GET', path: '/api/drive/folders', auth: 'drive', note: '网盘目录列表' },
      { method: 'GET', path: '/api/drive/files', auth: 'drive', note: '网盘文件列表' },
      { method: 'GET', path: '/api/drive/files/:id', auth: 'drive', note: '网盘文件元数据' },
      { method: 'POST', path: '/api/drive/files/:id/rename', auth: 'drive', note: '重命名' },
      { method: 'POST', path: '/api/drive/files/:id/move', auth: 'drive', note: '移动目录' },
      { method: 'DELETE', path: '/api/drive/files/:id', auth: 'drive', note: '删除文件' },
      { method: 'POST', path: '/api/drive/files/:id/sign', auth: 'drive', note: '签发签名 URL' },
      { method: 'GET', path: '/api/drive/files/:id/stream', auth: '签名或 Bearer', note: '流式播放（Range）' },
      { method: 'GET', path: '/api/drive/files/:id/download', auth: '签名或 Bearer', note: '下载（计数+1）' },
      { method: 'POST', path: '/api/drive/uploads', auth: 'drive', note: '分片上传初始化' },
      { method: 'GET', path: '/api/drive/uploads/:uploadId', auth: 'drive', note: '上传状态' },
      { method: 'POST', path: '/api/drive/uploads/:uploadId/parts', auth: 'drive', note: '上传分片' },
      { method: 'POST', path: '/api/drive/uploads/:uploadId/complete', auth: 'drive', note: '完成上传' },
      { method: 'POST', path: '/api/drive/uploads/:uploadId/abort', auth: 'drive', note: '中止上传' },
    ],
  })
);

/** 公开：已发布文章全量（构建时同步用） */
app.get('/api/public/posts', async (c) => {
  try {
    const posts = await listPosts(c.env, { publishedOnly: true });
    return c.json(posts);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 管理：文章列表（含草稿） */
app.get('/api/posts', requireAuth, async (c) => {
  try {
    return c.json(await listPosts(c.env));
  } catch (e) {
    return handleError(c, e);
  }
});

/** 管理：读取单篇 */
app.get('/api/posts/:slug', requireAuth, async (c) => {
  try {
    const post = await getPost(c.env, c.req.param('slug')!);
    if (!post) return c.json({ error: '文章不存在' }, 404);
    return c.json(post);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 管理：创建 / 更新文章（写入 D1 后触发重建） */
app.post('/api/posts', requireAuth, async (c) => {
  try {
    const input = (await c.req.json()) as ArticleInput;
    const err = validate(input);
    if (err) return c.json({ error: err }, 400);

    const { created } = await upsertPost(c.env, {
      slug: input.slug,
      title: input.title,
      description: input.description,
      pubDate: input.pubDate,
      tags: input.tags,
      category: input.category ?? '',
      draft: !!input.draft,
      content: input.content,
    });

    const rebuild = await triggerRebuild(c.env);
    return c.json(
      {
        ok: true,
        slug: input.slug,
        created,
        build: rebuild.message,
      },
      created ? 201 : 200
    );
  } catch (e) {
    return handleError(c, e);
  }
});

/** 管理：删除文章 */
app.delete('/api/posts/:slug', requireAuth, async (c) => {
  try {
    const deleted = await deletePost(c.env, c.req.param('slug')!);
    if (!deleted) return c.json({ error: '文章不存在' }, 404);
    const rebuild = await triggerRebuild(c.env);
    return c.json({ ok: true, build: rebuild.message });
  } catch (e) {
    return handleError(c, e);
  }
});

// ---------------- 媒体库 ----------------

/** 媒体列表（分页 + 过滤） */
app.get('/api/media', requireAuth, async (c) => {
  try {
    const origin = requestOrigin(c.req);
    const data = await listMedia(c.env, {
      page: Number(c.req.query('page')) || undefined,
      pageSize: Number(c.req.query('pageSize')) || undefined,
      type: c.req.query('type'),
      visibility: c.req.query('visibility'),
      tag: c.req.query('tag'),
      q: c.req.query('q'),
    }, origin);
    return c.json(data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 媒体元数据（含引用片段） */
app.get('/api/media/:id', requireAuth, async (c) => {
  try {
    const row = await getMediaRow(c.env, c.req.param('id')!);
    if (!row) return c.json({ error: '媒体不存在' }, 404);
    return c.json(toMedia(row, requestOrigin(c.req)));
  } catch (e) {
    return handleError(c, e);
  }
});

/** 单次上传（multipart） */
app.post('/api/media', requireAuth, async (c) => {
  try {
    const form = await c.req.formData();
    const visibility = String(form.get('visibility') ?? 'public');
    if (!['public', 'private'].includes(visibility)) {
      return c.json({ error: 'visibility 必须是 public / private' }, 400);
    }
    const res = await handleSingleUpload(c.env, form, requestOrigin(c.req), visibility);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data, 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 分片上传：初始化 */
app.post('/api/media/uploads', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      filename?: string;
      mimeType?: string;
      sizeBytes?: number;
      visibility?: string;
      title?: string;
      description?: string;
      tags?: string[];
    }>();
    const mime = body.mimeType ?? '';
    if (!isAllowedMime(mime)) return c.json({ error: `不支持的文件类型：${mime}` }, 415);
    const visibility = body.visibility ?? 'public';
    if (!['public', 'private'].includes(visibility)) return c.json({ error: 'visibility 必须是 public / private' }, 400);
    const sizeBytes = Number(body.sizeBytes) || 0;

    const res = await uploads.initUpload(c.env, {
      scope: 'media',
      r2Key: makeMediaKey(extensionFor(mime)),
      filename: sanitizeFilename(body.filename ?? ''),
      mimeType: mime,
      sizeBytes,
      visibility,
      mediaType: guessType(mime),
      title: body.title,
      description: body.description,
      tags: body.tags,
    });
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data, 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 分片上传：上传单个分片 */
app.post('/api/media/uploads/:uploadId/parts', requireAuth, async (c) => {
  try {
    const partNumber = Number(c.req.query('partNumber'));
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return c.json({ error: 'partNumber 必须是正整数' }, 400);
    }
    const body = await c.req.arrayBuffer();
    const res = await uploads.uploadPart(c.env, c.req.param('uploadId')!, partNumber, body);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 分片上传：完成合并并落库 */
app.post('/api/media/uploads/:uploadId/complete', requireAuth, async (c) => {
  try {
    const res = await uploads.completeUpload(c.env, c.req.param('uploadId')!);
    if (!res.ok) {
      const body: Record<string, unknown> = { error: res.msg };
      if (res.missing) body.missing = res.missing;
      return c.json(body, res.code as any);
    }

    const { session } = res.data;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const ext = session.mime_type.split('/')[1] ?? 'file';
    let tags: string[] = [];
    try { tags = JSON.parse(session.tags); } catch { /* ignore */ }

    await c.env.DB.prepare(
      `INSERT INTO media (id, type, visibility, mime_type, extension, size_bytes, title, description, tags, r2_key, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?)`
    )
      .bind(
        id, session.media_type, session.visibility, session.mime_type, ext,
        session.total_bytes, session.filename, session.description,
        JSON.stringify(tags), session.r2_key, now, now
      )
      .run();
    await c.env.DB.prepare('UPDATE upload_sessions SET target_id = ? WHERE upload_id = ?')
      .bind(id, session.upload_id)
      .run();

    const row = await getMediaRow(c.env, id);
    return c.json(toMedia(row!, requestOrigin(c.req)), 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 分片上传：中止 */
app.post('/api/media/uploads/:uploadId/abort', requireAuth, async (c) => {
  try {
    const res = await uploads.abortUpload(c.env, c.req.param('uploadId')!);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 分片上传：状态（断点续传） */
app.get('/api/media/uploads/:uploadId', requireAuth, async (c) => {
  try {
    const res = await uploads.getUploadStatus(c.env, c.req.param('uploadId')!);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 流式输出：public 免鉴权（长缓存），private 需管理端鉴权 */
async function serveMedia(c: any) {
  try {
    const id = c.req.param('id')!;
    const row = await getMediaRow(c.env, id);
    if (!row) return c.json({ error: '媒体不存在' }, 404);

    if (row.visibility === 'private') {
      const auth = c.req.header('Authorization');
      if (!auth || auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
        return c.json({ error: '未授权' }, 401);
      }
    }

    const isSvg = row.mime_type === 'image/svg+xml';
    const resp = await streamObject(
      c.env,
      row.r2_key,
      c.req.header('Range'),
      row.visibility === 'private' ? { noStore: true } : {}
    );
    if (!resp) return c.json({ error: '媒体不存在' }, 404);
    if (isSvg) resp.headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    return resp;
  } catch (e) {
    return handleError(c, e);
  }
}

app.get('/api/media/:id/file', serveMedia);
app.on('HEAD', '/api/media/:id/file', serveMedia);

/** 删除媒体（被文章引用则 409） */
app.delete('/api/media/:id', requireAuth, async (c) => {
  try {
    const res = await deleteMedia(c.env, c.req.param('id')!);
    if (!res.ok) {
      const body: Record<string, unknown> = { error: res.msg };
      if (res.references) body.references = res.references;
      return c.json(body, res.code as any);
    }
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

// ---------------- 私人网盘 ----------------

/** 网盘登录：密码换会话 token */
app.post('/api/drive/login', async (c) => {
  try {
    const body = await c.req.json<{ password?: string }>();
    const res = await driveLogin(c.env, String(body.password ?? ''));
    if (!res.ok) return c.json({ error: res.error }, 401);
    return c.json({
      token: res.token,
      expiresAt: new Date(res.expiresAt * 1000).toISOString(),
      expiresIn: res.expiresIn,
      user: { sub: 'owner', role: 'owner' },
    });
  } catch (e) {
    return handleError(c, e);
  }
});

/** 登出：客户端自行丢弃 token（服务端无状态） */
app.post('/api/drive/logout', requireDriveAuth, (c) => c.json({ ok: true }));

/** 会话信息 */
app.get('/api/drive/me', requireDriveAuth, (c) =>
  c.json({ ok: true, user: { sub: 'owner', role: 'owner' }, exp: c.var.driveUser.exp })
);

/** 目录列表 */
app.get('/api/drive/folders', requireDriveAuth, async (c) => {
  try {
    return c.json({ folders: await listFolders(c.env) });
  } catch (e) {
    return handleError(c, e);
  }
});

/** 文件列表（分页 + 目录/搜索/排序） */
app.get('/api/drive/files', requireDriveAuth, async (c) => {
  try {
    const data = await listFiles(c.env, {
      folder: c.req.query('folder'),
      q: c.req.query('q'),
      page: Number(c.req.query('page')) || undefined,
      pageSize: Number(c.req.query('pageSize')) || undefined,
      sort: (c.req.query('sort') as 'created' | 'name' | 'size' | 'downloads') || undefined,
    });
    return c.json(data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 文件元数据 */
app.get('/api/drive/files/:id', requireDriveAuth, async (c) => {
  try {
    const row = await getDriveFile(c.env, c.req.param('id')!);
    if (!row) return c.json({ error: '文件不存在' }, 404);
    return c.json(toDriveFile(row));
  } catch (e) {
    return handleError(c, e);
  }
});

/** 重命名 */
app.post('/api/drive/files/:id/rename', requireDriveAuth, async (c) => {
  try {
    const { filename } = await c.req.json<{ filename?: string }>();
    const res = await renameDriveFile(c.env, c.req.param('id')!, filename ?? '');
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 移动目录 */
app.post('/api/drive/files/:id/move', requireDriveAuth, async (c) => {
  try {
    const { folder } = await c.req.json<{ folder?: string }>();
    const res = await moveDriveFile(c.env, c.req.param('id')!, folder ?? '/');
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 删除文件 */
app.delete('/api/drive/files/:id', requireDriveAuth, async (c) => {
  try {
    const res = await deleteDriveFile(c.env, c.req.param('id')!);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 签发短时效签名 URL（stream 15min / download 5min） */
app.post('/api/drive/files/:id/sign', requireDriveAuth, async (c) => {
  try {
    const id = c.req.param('id')!;
    const row = await getDriveFile(c.env, id);
    if (!row) return c.json({ error: '文件不存在' }, 404);
    const { action } = await c.req.json<{ action?: 'stream' | 'download' }>();
    if (!action || !['stream', 'download'].includes(action)) {
      return c.json({ error: 'action 必须是 stream / download' }, 400);
    }
    const origin = requestOrigin(c.req);
    const signed = await signFileUrl(c.env, id, action, origin);
    return c.json({
      url: signed.url,
      expiresAt: new Date(signed.expiresAt * 1000).toISOString(),
      filename: row.filename,
      mimeType: row.mime_type,
    });
  } catch (e) {
    return handleError(c, e);
  }
});

/** 网盘文件鉴权：Bearer drive token 或签名 URL 二选一 */
async function driveFileAuthOk(c: any, id: string, action: 'stream' | 'download'): Promise<boolean> {
  const auth = c.req.header('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const payload = await verifyDriveToken(c.env, auth.slice(7));
    if (payload) return true;
  }
  return verifySignedFileUrl(c.env, id, action, c.req.query('exp'), c.req.query('sig'));
}

/** 流式播放（视频 seek 用 Range）；或下载（attachment + 计数） */
async function serveDriveFile(c: any, action: 'stream' | 'download') {
  try {
    const id = c.req.param('id')!;
    if (!(await driveFileAuthOk(c, id, action))) return c.json({ error: '未授权或链接已过期' }, 401);

    const row = await getDriveFile(c.env, id);
    if (!row) return c.json({ error: '文件不存在' }, 404);

    if (action === 'download') await incrementDownloadCount(c.env, id);

    const resp = await streamObject(
      c.env,
      row.r2_key,
      c.req.header('Range'),
      {
        noStore: true,
        contentType: row.mime_type,
        contentDisposition: action === 'download'
          ? contentDisposition(row.filename, true)
          : contentDisposition(row.filename, false),
      }
    );
    if (!resp) return c.json({ error: '文件不存在' }, 404);

    // 私有网盘中的 HTML/SVG 严禁脚本执行（防 XSS）
    if (row.mime_type === 'text/html' || row.mime_type === 'image/svg+xml') {
      resp.headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    }
    return resp;
  } catch (e) {
    return handleError(c, e);
  }
}

app.get('/api/drive/files/:id/stream', (c) => serveDriveFile(c, 'stream'));
app.on('HEAD', '/api/drive/files/:id/stream', (c) => serveDriveFile(c, 'stream'));
app.get('/api/drive/files/:id/download', (c) => serveDriveFile(c, 'download'));

/** 网盘分片上传：初始化（目录 + 文件名 → drive/{uuid}.{ext}） */
app.post('/api/drive/uploads', requireDriveAuth, async (c) => {
  try {
    const body = await c.req.json<{
      filename?: string;
      mimeType?: string;
      sizeBytes?: number;
      folder?: string;
    }>();
    const filename = sanitizeFilename(body.filename ?? '');
    if (!filename) return c.json({ error: '缺少文件名' }, 400);
    const sizeBytes = Number(body.sizeBytes) || 0;

    const res = await uploads.initUpload(c.env, {
      scope: 'drive',
      r2Key: makeDriveKey(filename),
      filename,
      mimeType: body.mimeType || 'application/octet-stream',
      sizeBytes,
      folder: normalizeFolder(body.folder),
    });
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data, 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 网盘分片上传：上传单个分片 */
app.post('/api/drive/uploads/:uploadId/parts', requireDriveAuth, async (c) => {
  try {
    const partNumber = Number(c.req.query('partNumber'));
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return c.json({ error: 'partNumber 必须是正整数' }, 400);
    }
    const body = await c.req.arrayBuffer();
    const res = await uploads.uploadPart(c.env, c.req.param('uploadId')!, partNumber, body);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 网盘分片上传：完成合并 → drive_files 落库 */
app.post('/api/drive/uploads/:uploadId/complete', requireDriveAuth, async (c) => {
  try {
    const res = await uploads.completeUpload(c.env, c.req.param('uploadId')!);
    if (!res.ok) {
      const body: Record<string, unknown> = { error: res.msg };
      if (res.missing) body.missing = res.missing;
      return c.json(body, res.code as any);
    }

    const { session } = res.data;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO drive_files (id, r2_key, filename, folder, size_bytes, mime_type, download_count, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'owner', ?, ?)`
    )
      .bind(id, session.r2_key, session.filename, session.folder, session.total_bytes, session.mime_type, now, now)
      .run();
    await c.env.DB.prepare('UPDATE upload_sessions SET target_id = ? WHERE upload_id = ?')
      .bind(id, session.upload_id)
      .run();

    const row = await getDriveFile(c.env, id);
    return c.json(toDriveFile(row!), 201);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 网盘分片上传：中止 */
app.post('/api/drive/uploads/:uploadId/abort', requireDriveAuth, async (c) => {
  try {
    const res = await uploads.abortUpload(c.env, c.req.param('uploadId')!);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 网盘分片上传：状态（断点续传） */
app.get('/api/drive/uploads/:uploadId', requireDriveAuth, async (c) => {
  try {
    const res = await uploads.getUploadStatus(c.env, c.req.param('uploadId')!);
    if (!res.ok) return jsonErr(c, res.msg, res.code);
    return c.json(res.data);
  } catch (e) {
    return handleError(c, e);
  }
});

function handleError(c: any, e: unknown) {
  console.error(e);
  return c.json(
    { error: e instanceof Error ? e.message : '服务器内部错误' },
    500
  );
}

/** 统一错误响应 */
function jsonErr(c: any, msg: string, code: number) {
  return c.json({ error: msg }, code as any);
}

export default app;
