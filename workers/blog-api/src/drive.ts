/** 网盘：drive_files 元数据 CRUD / 目录 / 下载计数。
 *  对象在 R2：drive/{uuid}.{ext}，一律经鉴权访问，禁止缓存。
 *  上传复用 uploads.ts（scope='drive'）。
 */
import type { Env } from './auth';
import { sanitizeFilename } from './media';
import { deleteObject } from './r2';
import { hashFolderPassword, verifyFolderPassword } from './driveAuth';

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

// ---------- 文件夹加密 ----------

export interface FolderSecretRow {
  folder: string;
  password_hash: string;
  salt: string;
  iterations: number;
  failed_attempts: number;
  locked_until: number;
  created_at: string;
  updated_at: string;
}

/** 该文件夹是否已加密（根目录永不可加密） */
export async function folderLocked(env: Env, folder: string): Promise<boolean> {
  const norm = normalizeFolder(folder);
  if (norm === '/') return false;
  const row = await env.DB.prepare('SELECT 1 FROM folder_secrets WHERE folder = ?').bind(norm).first();
  return !!row;
}

/** 全部已加密文件夹（归一化路径集合） */
export async function lockedFolderSet(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare('SELECT folder FROM folder_secrets').all<{ folder: string }>();
  return new Set(results.map((r) => normalizeFolder(r.folder)));
}

export type FolderSecretResult =
  | { ok: true }
  | { ok: false; code: number; msg: string };

/** 设置/更新文件夹密码（仅存 PBKDF2 哈希，绝不落明文）；password 为空则清除 */
export async function setFolderSecret(env: Env, folder: string, password: string): Promise<FolderSecretResult> {
  const norm = normalizeFolder(folder);
  if (norm === '/') return { ok: false, code: 400, msg: '根目录不可加密' };
  const pwd = String(password ?? '').trim();
  if (!pwd) return clearFolderSecret(env, norm); // 空密码 = 清除加密
  if (pwd.length < 4 || pwd.length > 200) {
    return { ok: false, code: 400, msg: '密码长度需在 4-200 之间' };
  }
  const { hash, salt, iterations } = await hashFolderPassword(pwd);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO folder_secrets (folder, password_hash, salt, iterations, failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(folder) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt,
       iterations = excluded.iterations, failed_attempts = 0, locked_until = 0, updated_at = excluded.updated_at`
  )
    .bind(norm, hash, salt, iterations, now, now)
    .run();
  return { ok: true };
}

/** 清除文件夹密码 */
export async function clearFolderSecret(env: Env, folder: string): Promise<FolderSecretResult> {
  const norm = normalizeFolder(folder);
  await env.DB.prepare('DELETE FROM folder_secrets WHERE folder = ?').bind(norm).run();
  return { ok: true };
}

// ---------- 解锁（防爆破） ----------

const MAX_FAILED_ATTEMPTS = 5; // 连续错误密码达到阈值
const LOCK_SECONDS = 300; // 冷却 5 分钟

export type UnlockResult =
  | { ok: true; folder: string }
  | { ok: false; code: number; msg: string; retryAfter?: number };

/** 校验文件夹密码；连续失败达到阈值则冷却限速 */
export async function unlockFolder(env: Env, folder: string, password: string): Promise<UnlockResult> {
  const norm = normalizeFolder(folder);
  if (norm === '/') return { ok: false, code: 400, msg: '根目录未加密' };
  const row = await env.DB
    .prepare('SELECT * FROM folder_secrets WHERE folder = ?')
    .bind(norm)
    .first<FolderSecretRow>();
  if (!row) return { ok: false, code: 404, msg: '该文件夹未加密' };

  const now = Math.floor(Date.now() / 1000);
  if (row.locked_until > now) {
    return { ok: false, code: 429, msg: '尝试过于频繁，请稍后再试', retryAfter: row.locked_until - now };
  }

  const ok = await verifyFolderPassword(String(password ?? ''), row.password_hash, row.salt, row.iterations);
  if (ok) {
    await env.DB
      .prepare('UPDATE folder_secrets SET failed_attempts = 0, locked_until = 0, updated_at = ? WHERE folder = ?')
      .bind(new Date().toISOString(), norm)
      .run();
    return { ok: true, folder: norm };
  }

  await env.DB
    .prepare('UPDATE folder_secrets SET failed_attempts = failed_attempts + 1 WHERE folder = ?')
    .bind(norm)
    .run();
  const updated = await env.DB
    .prepare('SELECT failed_attempts, locked_until FROM folder_secrets WHERE folder = ?')
    .bind(norm)
    .first<{ failed_attempts: number; locked_until: number }>();
  if (updated && updated.failed_attempts >= MAX_FAILED_ATTEMPTS) {
    const until = now + LOCK_SECONDS;
    await env.DB
      .prepare('UPDATE folder_secrets SET locked_until = ?, failed_attempts = 0 WHERE folder = ?')
      .bind(until, norm)
      .run();
    return { ok: false, code: 429, msg: '尝试过于频繁，已临时锁定，请 5 分钟后再试', retryAfter: LOCK_SECONDS };
  }
  return { ok: false, code: 401, msg: '密码错误' };
}

// ---------- 目录 ----------

export interface DriveFolderInfo {
  path: string;
  locked: boolean;
}

/** 全部目录（去重排序，按层级）+ 是否加密 */
export async function listFolders(env: Env): Promise<DriveFolderInfo[]> {
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
  // 仅配置了密码的空文件夹也应出现在目录树（标记 locked）
  const { results: secrets } = await env.DB.prepare('SELECT folder FROM folder_secrets').all<{ folder: string }>();
  for (const s of secrets) {
    const norm = normalizeFolder(s.folder);
    set.add(norm);
    childFolderNames(norm).forEach((f) => set.add(f));
  }
  const lockedSet = new Set(secrets.map((s) => normalizeFolder(s.folder)));
  return [...set]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((path) => ({ path, locked: lockedSet.has(path) }));
}

// ---------- 列表 / 读取 ----------

export type DriveSort = 'created' | 'name' | 'size' | 'downloads';

export interface DriveListParams {
  folder?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: DriveSort;
  /** 全局搜索时排除未授权的加密文件夹（仅在未指定 folder 时生效） */
  excludeFolders?: string[];
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
  if (!p.folder && p.excludeFolders && p.excludeFolders.length > 0) {
    where.push(`folder NOT IN (${p.excludeFolders.map(() => '?').join(',')})`);
    args.push(...p.excludeFolders);
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
