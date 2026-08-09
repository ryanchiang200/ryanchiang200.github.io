/** 博客文章上传存储 API —— Cloudflare Worker + Hono */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth, type Env } from './auth';
import { listPostFiles, readPost, upsertPost, deletePost, ApiError } from './github';
import { buildMarkdown, parseFrontmatter, validate, type ArticleInput } from './article';
import { ADMIN_PAGE } from './admin-page';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/api/*',
  cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'DELETE'] })
);

/** 简易管理页（无需认证即可打开，写操作仍需 token） */
app.get('/', (c) => c.html(ADMIN_PAGE));

/** 文章列表：读取所有 .md 的 frontmatter */
app.get('/api/posts', requireAuth, async (c) => {
  try {
    const env = c.env;
    const files = await listPostFiles(env);
    const posts = await Promise.all(
      files.map(async (f) => {
        const slug = f.name.replace(/\.md$/, '');
        const md = await readPost(env, slug);
        const fm = md ? parseFrontmatter(md) : {};
        return {
          slug,
          title: fm.title ?? slug,
          pubDate: fm.pubDate ?? '',
          draft: md?.includes('draft: true') ?? false,
        };
      })
    );
    posts.sort((a, b) => (a.pubDate < b.pubDate ? 1 : a.pubDate > b.pubDate ? -1 : 0));
    return c.json(posts);
  } catch (e) {
    return handleError(c, e);
  }
});

/** 读取单篇文章（含解析后的 frontmatter 与原文） */
app.get('/api/posts/:slug', requireAuth, async (c) => {
  try {
    const env = c.env;
    const slug = c.req.param('slug');
    const md = await readPost(env, slug);
    if (md === null) return c.json({ error: '文章不存在' }, 404);
    const fm = parseFrontmatter(md);
    // 提取正文（去掉 frontmatter）
    const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    return c.json({
      slug,
      title: fm.title ?? '',
      pubDate: fm.pubDate ?? '',
      content: body.trim(),
    });
  } catch (e) {
    return handleError(c, e);
  }
});

/** 创建 / 更新文章 */
app.post('/api/posts', requireAuth, async (c) => {
  try {
    const env = c.env;
    const input = (await c.req.json()) as ArticleInput;

    const err = validate(input);
    if (err) return c.json({ error: err }, 400);

    const markdown = buildMarkdown(input);
    const { created } = await upsertPost(env, input.slug, markdown, { replace: true });

    return c.json(
      {
        ok: true,
        slug: input.slug,
        created,
        note: '已提交到 GitHub，构建发布大约需要 1-2 分钟',
      },
      created ? 201 : 200
    );
  } catch (e) {
    return handleError(c, e);
  }
});

/** 删除文章 */
app.delete('/api/posts/:slug', requireAuth, async (c) => {
  try {
    const env = c.env;
    const slug = c.req.param('slug');
    const deleted = await deletePost(env, slug);
    if (!deleted) return c.json({ error: '文章不存在' }, 404);
    return c.json({ ok: true, slug });
  } catch (e) {
    return handleError(c, e);
  }
});

function handleError(c: any, e: unknown) {
  if (e instanceof ApiError) {
    return c.json({ error: e.message }, e.status >= 500 ? 502 : e.status);
  }
  console.error(e);
  return c.json({ error: '服务器内部错误' }, 500);
}

export default app;
