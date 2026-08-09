// 构建时同步：从 D1 公开 API 拉取已发布文章，写入 src/content/blog/*.md
// 合并策略：D1 里存在的 slug 覆盖本地文件；本地独有 slug 保留（如示例文章）
//
// 用法：CONTENT_API_URL=https://blog-admin-api.xxx.workers.dev npm run sync
// 未设置 CONTENT_API_URL 时跳过（本地构建不受影响）；
// 设置后拉取失败则退出非零（避免发布空/旧内容）。

import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'src', 'content', 'blog');
const API_URL = process.env.CONTENT_API_URL;

// 单引号转义，防止 frontmatter 被注入
function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildMarkdown(post) {
  const tags = Array.isArray(post.tags)
    ? post.tags.map((t) => `'${esc(t)}'`).join(', ')
    : '';
  return [
    '---',
    `title: '${esc(post.title)}'`,
    `description: '${esc(post.description)}'`,
    `pubDate: ${post.pubDate}`,
    `tags: [${tags}]`,
    post.category ? `category: '${post.category}'` : 'category:',
    'draft: false',
    '---',
    '',
    (post.content ?? '').trim(),
    '',
  ].join('\n');
}

if (!API_URL) {
  console.warn('[sync] 未设置 CONTENT_API_URL，跳过同步（保留现有文章）。');
  process.exit(0);
}

try {
  const resp = await fetch(`${API_URL.replace(/\/+$/, '')}/api/public/posts`);
  if (!resp.ok) {
    console.error(`[sync] 拉取文章失败：HTTP ${resp.status}`);
    process.exit(1);
  }
  const posts = await resp.json();

  const localFiles = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));
  let written = 0;
  for (const post of posts) {
    const slug = String(post.slug ?? '');
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      console.warn(`[sync] 跳过非法 slug：${slug}`);
      continue;
    }
    writeFileSync(join(BLOG_DIR, `${slug}.md`), buildMarkdown(post), 'utf8');
    written++;
  }

  console.log(
    `[sync] 完成：写入 D1 文章 ${written} 篇；本地原有 ${localFiles.length} 个文件（本地独有保留）。`
  );
} catch (e) {
  console.error('[sync] 同步失败：', e instanceof Error ? e.message : e);
  process.exit(1);
}
