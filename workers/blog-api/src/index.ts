/** 博客文章上传存储 API —— Cloudflare Worker + Hono（D1 存储） */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth, type Env } from './auth';
import { listPosts, getPost, upsertPost, deletePost } from './db';
import { triggerRebuild } from './rebuild';
import { validate, type ArticleInput } from './article';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'DELETE'],
  })
);

/** API 状态说明 */
app.get('/', (c) =>
  c.json({
    name: 'blog-admin-api',
    description: '博客文章上传存储 API',
    endpoints: [
      { method: 'GET', path: '/api/public/posts', auth: false, note: '已发布文章（构建时同步用）' },
      { method: 'GET', path: '/api/posts', auth: true, note: '管理端文章列表' },
      { method: 'GET', path: '/api/posts/:slug', auth: true, note: '读取单篇' },
      { method: 'POST', path: '/api/posts', auth: true, note: '创建 / 更新文章' },
      { method: 'DELETE', path: '/api/posts/:slug', auth: true, note: '删除文章' },
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

function handleError(c: any, e: unknown) {
  console.error(e);
  return c.json(
    { error: e instanceof Error ? e.message : '服务器内部错误' },
    500
  );
}

export default app;
