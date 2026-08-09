/** GitHub Contents API 封装：在仓库 src/content/blog/ 下读写 Markdown 文章 */
import type { Env } from './auth';

const API = 'https://api.github.com';

interface ContentEntry {
  name: string;
  path: string;
  sha: string;
  type: string;
  download_url?: string | null;
}

interface ContentFile extends ContentEntry {
  type: 'file';
  content: string; // base64
}

function base64Encode(s: string): string {
  return btoa(s);
}
function base64Decode(s: string): string {
  return atob(s);
}

async function ghFetch(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'blog-admin-api',
      ...(init.headers ?? {}),
    },
  });
}

/** 列出博客目录下的所有 .md 文件 */
export async function listPostFiles(env: Env): Promise<ContentEntry[]> {
  const res = await ghFetch(
    env,
    `/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO}/contents/${env.BLOG_DIR}?ref=${env.GITHUB_BRANCH}`
  );
  if (!res.ok) throw new ApiError('无法列出文章目录', res.status);
  const items = (await res.json()) as ContentEntry[];
  return items.filter((i) => i.type === 'file' && i.name.endsWith('.md'));
}

/** 读取单篇文章的 markdown 原文（找不到返回 null） */
export async function readPost(env: Env, slug: string): Promise<string | null> {
  const res = await ghFetch(
    env,
    `/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO}/contents/${env.BLOG_DIR}/${slug}.md?ref=${env.GITHUB_BRANCH}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError('无法读取文章', res.status);
  const file = (await res.json()) as ContentFile;
  return base64Decode(file.content);
}

/** 创建或更新文章。已有文件时用 sha 进行覆盖更新。 */
export async function upsertPost(
  env: Env,
  slug: string,
  markdown: string,
  { replace = true }: { replace?: boolean } = {}
): Promise<{ created: boolean }> {
  const path = `${env.BLOG_DIR}/${slug}.md`;
  const baseUrl = `/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO}/contents/${path}`;

  // 已存在时获取 sha（用于更新）
  const existing = await ghFetch(
    env,
    `${baseUrl}?ref=${env.GITHUB_BRANCH}`
  );
  const exists = existing.status === 200;

  if (exists && !replace) {
    throw new ApiError('文章已存在', 409);
  }

  const sha = exists ? ((await existing.json()) as ContentFile).sha : undefined;
  const body: Record<string, unknown> = {
    message: exists
      ? `blog: 更新文章 ${slug}`
      : `blog: 新增文章 ${slug}`,
    content: base64Encode(markdown),
    branch: env.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await ghFetch(baseUrl, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError('提交文章到 GitHub 失败', res.status);
  return { created: !exists };
}

/** 删除文章（需要先取得 sha） */
export async function deletePost(env: Env, slug: string): Promise<boolean> {
  const path = `${env.BLOG_DIR}/${slug}.md`;
  const baseUrl = `/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const existing = await ghFetch(env, `${baseUrl}?ref=${env.GITHUB_BRANCH}`);
  if (existing.status === 404) return false;
  if (!existing.ok) throw new ApiError('无法读取文章信息', existing.status);
  const sha = ((await existing.json()) as ContentFile).sha;

  const res = await ghFetch(baseUrl, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `blog: 删除文章 ${slug}`,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!res.ok) throw new ApiError('删除文章失败', res.status);
  return true;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
