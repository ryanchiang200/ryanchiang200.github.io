// 网盘 API 客户端：直接请求 blog-admin-api Worker（CORS 已放开）
// 本地构建可设 PUBLIC_DRIVE_API_URL 覆盖；默认指向线上 Worker

export const DRIVE_API =
  (import.meta.env.PUBLIC_DRIVE_API_URL as string | undefined) ??
  'https://blog-admin-api.chiangkh06.workers.dev';

export interface DriveFile {
  id: string;
  filename: string;
  folder: string;
  sizeBytes: number;
  mimeType: string;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DriveFileList {
  items: DriveFile[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DriveLoginResult {
  token: string;
  expiresAt: string;
  expiresIn: number;
  user: { sub: string; role: string };
}

export interface DriveFolderInfo {
  path: string;
  locked: boolean;
}

export interface DriveUnlockResult {
  token: string;
  folder: string;
  expiresAt: string;
  expiresIn: number;
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
  status: string;
  totalBytes: number;
  partSize: number;
  expectedParts: number;
  uploadedParts: number;
  parts: { partNumber: number; etag: string; sizeBytes: number }[];
}

async function parseError(res: Response): Promise<Error> {
  let msg = `HTTP ${res.status}`;
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') msg = data.error;
    if (data && Array.isArray(data.missing)) msg = `${msg}（缺少分片：${data.missing.join(', ')}）`;
  } catch {
    /* 非 JSON */
  }
  const err = new Error(msg) as Error & { status?: number };
  err.status = res.status;
  return err;
}

export function driveApi(token: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request<T>(method: string, path: string, opts: { body?: unknown; raw?: BodyInit } = {}): Promise<T> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (opts.raw) {
      init.body = opts.raw;
    } else if (opts.body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${DRIVE_API}${path}`, init);
    if (!res.ok) throw await parseError(res);
    return res.json() as Promise<T>;
  }

  return {
    async login(password: string): Promise<DriveLoginResult> {
      return request('POST', '/api/drive/login', { body: { password } });
    },
    me: () => request<{ ok: boolean; user: { sub: string; role: string }; exp: number }>('GET', '/api/drive/me'),
    folders: () => request<{ folders: DriveFolderInfo[] }>('GET', '/api/drive/folders'),
    unlock: (folder: string, password: string) =>
      request<DriveUnlockResult>('POST', '/api/drive/unlock', { body: { folder, password } }),
    setFolderSecret: (folder: string, password: string) =>
      request<{ ok: boolean }>('POST', '/api/drive/folders/secret', { body: { folder, password } }),
    clearFolderSecret: (folder: string) =>
      request<{ ok: boolean }>('DELETE', `/api/drive/folders/secret?folder=${encodeURIComponent(folder)}`),
    files: (p: { folder?: string; q?: string; page?: number; pageSize?: number; sort?: string } = {}): Promise<DriveFileList> => {
      const qs = new URLSearchParams();
      if (p.folder) qs.set('folder', p.folder);
      if (p.q) qs.set('q', p.q);
      if (p.page) qs.set('page', String(p.page));
      if (p.pageSize) qs.set('pageSize', String(p.pageSize));
      if (p.sort) qs.set('sort', p.sort);
      return request('GET', `/api/drive/files?${qs.toString()}`);
    },
    file: (id: string) => request<DriveFile>('GET', `/api/drive/files/${id}`),
    rename: (id: string, filename: string) => request<DriveFile>('POST', `/api/drive/files/${id}/rename`, { body: { filename } }),
    move: (id: string, folder: string) => request<DriveFile>('POST', `/api/drive/files/${id}/move`, { body: { folder } }),
    remove: (id: string) => request<{ ok: boolean }>('DELETE', `/api/drive/files/${id}`),
    sign: (id: string, action: 'stream' | 'download') =>
      request<{ url: string; expiresAt: string; filename: string; mimeType: string }>(
        'POST', `/api/drive/files/${id}/sign`, { body: { action } }
      ),
    uploadInit: (p: { filename: string; mimeType: string; sizeBytes: number; folder: string }) =>
      request<UploadInitResult>('POST', '/api/drive/uploads', { body: p }),
    uploadPart: (uploadId: string, partNumber: number, blob: Blob) =>
      request<{ partNumber: number; etag: string; sizeBytes: number }>(
        'POST', `/api/drive/uploads/${uploadId}/parts?partNumber=${partNumber}`, { raw: blob }
      ),
    uploadComplete: (uploadId: string) => request<DriveFile>('POST', `/api/drive/uploads/${uploadId}/complete`, { body: {} }),
    uploadAbort: (uploadId: string) => request<{ ok: boolean }>('POST', `/api/drive/uploads/${uploadId}/abort`, { body: {} }),
    uploadStatus: (uploadId: string) => request<UploadStatus>('GET', `/api/drive/uploads/${uploadId}`),
  };
}

export type DriveApi = ReturnType<typeof driveApi>;
