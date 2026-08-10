/** 网盘：drive_files 元数据 CRUD / 目录 / 下载计数。
 *  对象在 R2：drive/{uuid}.{ext}，一律经鉴权访问，禁止缓存。
 *  上传复用 uploads.ts（scope='drive'）。
 */
import type { Env } from './auth';
import { sanitizeFilename } from './media';
import { deleteObject } from './r2';

// ---------- 目录清洗 ----------

/** 生成 R2 key：drive/{uuid}.{ext}，扩展名取自文件名（私有网盘不限 MIME 白名单） */
export function makeDriveKey(filename: string): string {
  const ext = filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
  return `drive/${crypto.randomUUID()}.${ext}`;
}

/** 归一化目录路径：必须以 / 开头、无 .. 穿越、去控制字符，最长 6 层 */
export function normalizeFolder(folder: string | null | undefined): string {
  const raw = String(folder ?? '/').trim();
  if (!raw || raw === '/' || raw === '.') return '/';
  const parts = raw
    .split('/')
    .map((p) => p.trim().replace(/[^a-zA-Z0-9一-龥\-_()（）\[\] ]/g, '').slice(0, 60))
    .filter((p) => p && p !== '.' && p !== '..');
  if (parts.length === 0) return '/';
  if (parts.length > 6) parts.length = 6;
  return '/' + parts.join('/');
}

/** 从文件夹路径解析其直接子目录名（用于目录列表，剔除重复） */
export function childFolderNames(folder: string): string[] {
  const norm = normalizeFolder(folder);
  if (norm === '/') return [];
  const parts = norm.split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, i) => '/' + parts.slice(0, i + 1).join('/'));
}

// ---------- 数据映射 ----------

export interface DriveFile {
  id: string;
  filename: string;
  folder: string;
  sizeBytes: number;
  mimeType: string;
  downloadCount: number;
  sha256: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface DriveFileRow {
  id: string;
  r2_key: string;
  filename: string;
  folder: string;
  size_bytes: number;
  mime_type: string;
  download_count: number;
  sha256: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export function toDriveFile(row: DriveFileRow): DriveFile {
  return {
    id: row.id,
    filename: row.filename,
    folder: row.folder,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    downloadCount: row.download_count,
    sha256: row.sha256,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 目录 ----------

/** 全部目录（去重排序，按层级） */
export async function listFolders(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT folder FROM drive_files ORDER BY folder ASC`
  ).all<{ folder: string }>();
  const set = new Set<string>(['/']);
  for (const r of results) {
    const norm = normalizeFolder(r.folder);
    set.add(norm);
    // 补齐祖先目录，保证「/photos」存在时也返回「/」
    childFolderNames(norm).forEach((f) => set.add(f));
    set.add('/' + norm.split('/').filter(Boolean).join('/'));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// ---------- 列表 / 读取 ----------

export type DriveSort = 'created' | 'name' | 'size' | 'downloads';

export interface DriveListParams {
  folder?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: DriveSort;
}

export async function listFiles(env: Env, p: DriveListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, p.pageSize ?? 20));
  const where: string[] = [];
  const args: unknown[] = [];

  if (p.folder) {
    where.push('folder = ?');
    args.push(normalizeFolder(p.folder));
  }
  if (p.q) {
    where.push('filename LIKE ?');
    args.push(`%${p.q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM drive_files ${whereSql}`)
    .bind(...args)
    .first<{ n: number }>();
  const total = countRow?.n ?? 0;

  const orderBy =
    p.sort === 'name' ? 'filename COLLATE NOCASE ASC'
    : p.sort === 'size' ? 'size_bytes DESC'
    : p.sort === 'downloads' ? 'download_count DESC'
    : 'created_at DESC';

  const { results } = await env.DB.prepare(
    `SELECT * FROM drive_files ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  )
    .bind(...args, pageSize, (page - 1) * pageSize)
    .all<DriveFileRow>();

  return { items: results.map(toDriveFile), total, page, pageSize };
}

export async function getDriveFile(env: Env, id: string): Promise<DriveFileRow | null> {
  return env.DB.prepare('SELECT * FROM drive_files WHERE id = ?').bind(id).first<DriveFileRow>();
}

// ---------- 改名 / 移动 / 删除 ----------

export type DriveFileResult =
  | { ok: true; data: DriveFile }
  | { ok: false; code: number; msg: string };

/** 重命名（仅文件名，不含路径分隔符） */
export async function renameDriveFile(env: Env, id: string, filename: string): Promise<DriveFileResult> {
  const row = await getDriveFile(env, id);
  if (!row) return { ok: false, code: 404, msg: '文件不存在' };
  const cleaned = sanitizeFilename(filename).replace(/[/\\]/g, '_');
  if (!cleaned) return { ok: false, code: 400, msg: '文件名无效' };
  await env.DB.prepare('UPDATE drive_files SET filename = ?, updated_at = ? WHERE id = ?')
    .bind(cleaned, new Date().toISOString(), id)
    .run();
  const updated = await getDriveFile(env, id);
  return { ok: true, data: toDriveFile(updated!) };
}

/** 移动目录 */
export async function moveDriveFile(env: Env, id: string, folder: string): Promise<DriveFileResult> {
  const row = await getDriveFile(env, id);
  if (!row) return { ok: false, code: 404, msg: '文件不存在' };
  const norm = normalizeFolder(folder);
  await env.DB.prepare('UPDATE drive_files SET folder = ?, updated_at = ? WHERE id = ?')
    .bind(norm, new Date().toISOString(), id)
    .run();
  const updated = await getDriveFile(env, id);
  return { ok: true, data: toDriveFile(updated!) };
}

/** 删除文件（R2 对象 + 元数据） */
export type DeleteDriveResult =
  | { ok: true; data: { ok: boolean } }
  | { ok: false; code: number; msg: string };

export async function deleteDriveFile(env: Env, id: string): Promise<DeleteDriveResult> {
  const row = await getDriveFile(env, id);
  if (!row) return { ok: false, code: 404, msg: '文件不存在' };
  await deleteObject(env, row.r2_key);
  await env.DB.prepare('DELETE FROM drive_files WHERE id = ?').bind(id).run();
  return { ok: true, data: { ok: true } };
}

// ---------- 下载计数 ----------

export async function incrementDownloadCount(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE drive_files SET download_count = download_count + 1, updated_at = ? WHERE id = ?`
  )
    .bind(new Date().toISOString(), id)
    .run();
}

// ---------- Content-Disposition（RFC 5987，中文文件名） ----------

export function contentDisposition(filename: string, isAttachment: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '\\"');
  const encoded = encodeURIComponent(filename);
  return `${isAttachment ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
