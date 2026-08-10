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

export interface Media {
  id: string;
  type: 'image' | 'video' | 'file';
  visibility: 'public' | 'private';
  mimeType: string;
  extension: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  markdown: string;
  html: string;
}

export interface MediaList {
  items: Media[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DriveFolderInfo {
  path: string;
  locked: boolean;
}

export interface UploadInitResult {
  uploadId: string;
  r2Key: string;
  partSize: number;
  expectedParts: number;
  expiresAt: string;
}

export interface UploadStatus {
  uploadId: string;
  scope: string;
  r2Key: string;
  filename: string;
  mimeType: string;
  status: string;
  totalBytes: number;
  partSize: number;
  expectedParts: number;
  uploadedParts: number;
  uploadedBytes: number;
  expiresAt: string;
  parts: { partNumber: number; etag: string; sizeBytes: number }[];
}

/** 单次上传上限（与 Worker MEDIA_SINGLE_MAX_BYTES 默认一致：50 MB） */
export const MEDIA_SINGLE_MAX = 50 * 1024 * 1024;

async function parseError(res: Response): Promise<Error> {
  let msg = `HTTP ${res.status}`;
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') msg = data.error;
  } catch {
    /* 非 JSON 响应 */
  }
  return new Error(msg);
}

export function createApi(token: string) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  return {
    // ---------- 文章 ----------
    async list(): Promise<Post[]> {
      const res = await fetch(`${API_URL}/api/posts`, { headers });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    async get(slug: string): Promise<Post> {
      const res = await fetch(`${API_URL}/api/posts/${slug}`, { headers });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    async save(post: Post): Promise<SaveResult> {
      const res = await fetch(`${API_URL}/api/posts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(post),
      });
      if (!res.ok) throw await parseError(res);
      return res.json() as Promise<SaveResult>;
    },

    async remove(slug: string): Promise<void> {
      const res = await fetch(`${API_URL}/api/posts/${slug}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw await parseError(res);
    },

    // ---------- 媒体 ----------
    async mediaList(params: { page?: number; pageSize?: number; type?: string; visibility?: string; q?: string } = {}): Promise<MediaList> {
      const qs = new URLSearchParams();
      if (params.page) qs.set('page', String(params.page));
      if (params.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params.type) qs.set('type', params.type);
      if (params.visibility) qs.set('visibility', params.visibility);
      if (params.q) qs.set('q', params.q);
      const res = await fetch(`${API_URL}/api/media?${qs.toString()}`, { headers });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    async mediaGet(id: string): Promise<Media> {
      const res = await fetch(`${API_URL}/api/media/${id}`, { headers });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    async mediaDelete(id: string): Promise<void> {
      const res = await fetch(`${API_URL}/api/media/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw await parseError(res);
    },

    async mediaInitUpload(opts: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      visibility?: string;
      title?: string;
    }): Promise<UploadInitResult> {
      const res = await fetch(`${API_URL}/api/media/uploads`, {
        method: 'POST',
        headers,
        body: JSON.stringify(opts),
      });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    async mediaUploadPart(uploadId: string, partNumber: number, blob: Blob): Promise<void> {
      const res = await fetch(`${API_URL}/api/media/uploads/${uploadId}/parts?partNumber=${partNumber}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: blob,
      });
      if (!res.ok) throw await parseError(res);
    },

    async mediaCompleteUpload(uploadId: string): Promise<Media> {
      const res = await fetch(`${API_URL}/api/media/uploads/${uploadId}/complete`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    async mediaUploadStatus(uploadId: string): Promise<UploadStatus> {
      const res = await fetch(`${API_URL}/api/media/uploads/${uploadId}`, { headers });
      if (!res.ok) throw await parseError(res);
      return res.json();
    },

    // ---------- 网盘文件夹加密 ----------
    async driveFolders(): Promise<DriveFolderInfo[]> {
      const res = await fetch(`${API_URL}/api/drive/folders`, { headers });
      if (!res.ok) throw await parseError(res);
      const data = (await res.json()) as { folders: DriveFolderInfo[] };
      return data.folders;
    },

    /** 设置文件夹密码（空 password 会走后端清除逻辑，故这里用专用清除方法） */
    async driveSetFolderSecret(folder: string, password: string): Promise<void> {
      const res = await fetch(`${API_URL}/api/drive/folders/secret`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ folder, password }),
      });
      if (!res.ok) throw await parseError(res);
    },

    async driveClearFolderSecret(folder: string): Promise<void> {
      const res = await fetch(`${API_URL}/api/drive/folders/secret?folder=${encodeURIComponent(folder)}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw await parseError(res);
    },

    /**
     * 上传文件：≤50MB 走单次 multipart；更大走分片（断点续传）。
     * onProgress(0-100) 可选进度回调。
     */
    async mediaUploadFile(
      file: File,
      opts: { visibility?: string; title?: string } = {},
      onProgress?: (percent: number) => void
    ): Promise<Media> {
      if (file.size <= MEDIA_SINGLE_MAX) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('visibility', opts.visibility ?? 'public');
        if (opts.title) fd.append('title', opts.title);
        const res = await fetch(`${API_URL}/api/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) throw await parseError(res);
        return res.json();
      }

      // 分片上传
      const init = await this.mediaInitUpload({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        visibility: opts.visibility ?? 'public',
        title: opts.title,
      });
      const { uploadId, partSize, expectedParts } = init;
      let uploaded = 0;
      try {
        for (let n = 1; n <= expectedParts; n++) {
          const start = (n - 1) * partSize;
          const end = Math.min(start + partSize, file.size);
          const blob = file.slice(start, end);
          await this.mediaUploadPart(uploadId, n, blob);
          uploaded += blob.size;
          if (onProgress) onProgress(Math.round((uploaded / file.size) * 100));
        }
        return await this.mediaCompleteUpload(uploadId);
      } catch (e) {
        // 失败时尝试中止，避免遗留分片
        try {
          await fetch(`${API_URL}/api/media/uploads/${uploadId}/abort`, {
            method: 'POST',
            headers,
            body: '{}',
          });
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
  };
}
