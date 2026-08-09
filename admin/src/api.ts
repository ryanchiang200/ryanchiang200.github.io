// API 封装：指向 blog-admin-api Worker
// 本地 dev：VITE_API_URL=http://127.0.0.1:8787；部署时设为 Worker 公开地址

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8787';

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

export interface SaveResult {
  ok: boolean;
  slug: string;
  created: boolean;
  build: string;
}

export function createApi(token: string) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  return {
    async list(): Promise<Post[]> {
      const res = await fetch(`${API_URL}/api/posts`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    async get(slug: string): Promise<Post> {
      const res = await fetch(`${API_URL}/api/posts/${slug}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    async save(post: Post): Promise<SaveResult> {
      const res = await fetch(`${API_URL}/api/posts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(post),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      return data as SaveResult;
    },

    async remove(slug: string): Promise<void> {
      const res = await fetch(`${API_URL}/api/posts/${slug}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  };
}
