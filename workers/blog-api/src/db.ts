/** D1 数据访问层：posts 表的增删改查 */
import type { Env } from './auth';

export interface Post {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  tags: string[];
  category: string;
  draft: boolean;
  content: string;
}

interface PostRow {
  slug: string;
  title: string;
  description: string;
  pub_date: string;
  tags: string;
  category: string;
  draft: number;
  content: string;
}

function toPost(row: PostRow): Post {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    /* 忽略损坏的 tags */
  }
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    pubDate: row.pub_date,
    tags,
    category: row.category,
    draft: row.draft === 1,
    content: row.content,
  };
}

/** 文章列表；publishedOnly 时只返回已发布文章 */
export async function listPosts(
  env: Env,
  { publishedOnly = false }: { publishedOnly?: boolean } = {}
): Promise<Post[]> {
  const sql = publishedOnly
    ? 'SELECT * FROM posts WHERE draft = 0 ORDER BY pub_date DESC'
    : 'SELECT * FROM posts ORDER BY pub_date DESC';
  const { results } = await env.DB.prepare(sql).all<PostRow>();
  return results.map(toPost);
}

/** 读取单篇，不存在返回 null */
export async function getPost(env: Env, slug: string): Promise<Post | null> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE slug = ?')
    .bind(slug)
    .first<PostRow>();
  return row ? toPost(row) : null;
}

/** 创建或更新文章（以 slug 为 key） */
export async function upsertPost(
  env: Env,
  post: Post
): Promise<{ created: boolean }> {
  const existing = await getPost(env, post.slug);
  const tagsJson = JSON.stringify(post.tags);
  const draftInt = post.draft ? 1 : 0;

  if (existing) {
    await env.DB.prepare(
      `UPDATE posts SET title = ?, description = ?, pub_date = ?, tags = ?,
              category = ?, draft = ?, content = ?, updated_at = ?
       WHERE slug = ?`
    )
      .bind(
        post.title,
        post.description,
        post.pubDate,
        tagsJson,
        post.category,
        draftInt,
        post.content,
        new Date().toISOString(),
        post.slug
      )
      .run();
    return { created: false };
  }

  await env.DB.prepare(
    `INSERT INTO posts (slug, title, description, pub_date, tags, category, draft, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      post.slug,
      post.title,
      post.description,
      post.pubDate,
      tagsJson,
      post.category,
      draftInt,
      post.content
    )
    .run();
  return { created: true };
}

/** 删除文章，返回是否真的删除了 */
export async function deletePost(env: Env, slug: string): Promise<boolean> {
  const res = await env.DB.prepare('DELETE FROM posts WHERE slug = ?')
    .bind(slug)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
