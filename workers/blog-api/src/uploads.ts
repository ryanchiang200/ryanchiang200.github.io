/** 统一分片上传协议：init / part / complete / abort / status
 *  media 与 drive 共用 upload_sessions / upload_parts 表，scope 区分。
 *  底层 R2 multipart：单片 ≥5MiB（末片除外），最多 10000 片。
 */
import type { Env } from './auth';
import { uploadMaxBytes } from './auth';
import { createMultipart, uploadPart as r2UploadPart, completeMultipart, abortMultipart, isValidPartSize, MIN_PART_BYTES } from './r2';

export type UploadScope = 'media' | 'drive';

/** 统一失败结果 */
export type Fail = { ok: false; code: number; msg: string };

export interface UploadInitParams {
  scope: UploadScope;
  r2Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folder?: string;
  visibility?: string;
  mediaType?: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface UploadPartRow {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

interface SessionRow {
  upload_id: string;
  scope: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  folder: string;
  visibility: string;
  media_type: string;
  title: string;
  description: string;
  tags: string;
  total_bytes: number;
  part_size: number;
  expected_parts: number;
  uploaded_parts: number;
  uploaded_bytes: number;
  status: string;
  target_id: string | null;
  created_at: string;
  expires_at: string;
}

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** 计算分片大小与片数：默认单片 5 MiB */
function computeParts(sizeBytes: number): { partSize: number; expectedParts: number } {
  const partSize = MIN_PART_BYTES;
  if (sizeBytes > 0) {
    return { partSize, expectedParts: Math.ceil(sizeBytes / partSize) };
  }
  return { partSize, expectedParts: 0 }; // 未知大小（不建议）
}

/** 初始化分片上传 */
export async function initUpload(
  env: Env,
  p: UploadInitParams
): Promise<Fail | { ok: true; data: { uploadId: string; r2Key: string; partSize: number; expectedParts: number; expiresAt: string } }> {
  if (p.sizeBytes > 0 && p.sizeBytes > uploadMaxBytes(env)) {
    return { ok: false, code: 413, msg: `文件超过上传上限（${Math.round(uploadMaxBytes(env) / 1024 / 1024)} MB）` };
  }
  const { partSize, expectedParts } = computeParts(p.sizeBytes);
  const uploadId = await createMultipart(env, p.r2Key);
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO upload_sessions
      (upload_id, scope, r2_key, filename, mime_type, folder, visibility, media_type, title, description, tags,
       total_bytes, part_size, expected_parts, uploaded_parts, uploaded_bytes, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', ?)`
  )
    .bind(
      uploadId,
      p.scope,
      p.r2Key,
      p.filename,
      p.mimeType,
      p.folder ?? '/',
      p.visibility ?? 'public',
      p.mediaType ?? 'file',
      p.title ?? '',
      p.description ?? '',
      JSON.stringify(p.tags ?? []),
      p.sizeBytes,
      partSize,
      expectedParts,
      expiresAt
    )
    .run();

  return {
    ok: true,
    data: {
      uploadId,
      r2Key: p.r2Key,
      partSize,
      expectedParts,
      expiresAt,
    },
  };
}

async function getSession(env: Env, uploadId: string): Promise<SessionRow | null> {
  return env.DB.prepare('SELECT * FROM upload_sessions WHERE upload_id = ?')
    .bind(uploadId)
    .first<SessionRow>();
}

async function getParts(env: Env, uploadId: string): Promise<UploadPartRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT part_number, etag, size_bytes FROM upload_parts WHERE upload_id = ? ORDER BY part_number ASC'
  )
    .bind(uploadId)
    .all<{ part_number: number; etag: string; size_bytes: number }>();
  return results.map((r) => ({ partNumber: r.part_number, etag: r.etag, sizeBytes: r.size_bytes }));
}

/** 校验上传会话可用（存在、未过期、未完成） */
function sessionError(session: SessionRow | null): string | null {
  if (!session) return '上传会话不存在';
  if (session.status === 'completed') return '上传已完成';
  if (session.status === 'aborted') return '上传已中止';
  if (new Date(session.expires_at).getTime() < Date.now()) return '上传会话已过期';
  return null;
}

/** 上传一个分片（幂等：同 partNumber 覆盖） */
export async function uploadPart(
  env: Env,
  uploadId: string,
  partNumber: number,
  body: ArrayBuffer
): Promise<Fail | { ok: true; data: UploadPartRow }> {
  const session = await getSession(env, uploadId);
  const err = sessionError(session);
  if (err) return { ok: false, code: err.includes('不存在') ? 404 : 410, msg: err };
  if (!session) return { ok: false, code: 404, msg: '上传会话不存在' };

  const sizeCheck = isValidPartSize(partNumber, body.byteLength, session.expected_parts, session.part_size);
  if (sizeCheck) return { ok: false, code: 422, msg: sizeCheck };

  const etag = await r2UploadPart(env, session.r2_key, uploadId, partNumber, body);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO upload_parts (upload_id, part_number, etag, size_bytes) VALUES (?, ?, ?, ?)`
  )
    .bind(uploadId, partNumber, etag, body.byteLength)
    .run();

  // 更新计数（不递减：同片覆盖时按最新大小重算）
  const parts = await getParts(env, uploadId);
  const uploadedBytes = parts.reduce((s, p) => s + p.sizeBytes, 0);
  await env.DB.prepare(
    `UPDATE upload_sessions SET uploaded_parts = ?, uploaded_bytes = ?, status = 'in_progress', updated_at = ? WHERE upload_id = ?`
  )
    .bind(parts.length, uploadedBytes, new Date().toISOString(), uploadId)
    .run();

  return { ok: true, data: { partNumber, etag, sizeBytes: body.byteLength } };
}

/** 完成上传；返回会话与全部分片（由调用方按 scope 落 media/drive_files 表） */
export async function completeUpload(
  env: Env,
  uploadId: string
): Promise<(Fail & { missing?: number[] }) | { ok: true; data: { session: SessionRow; parts: UploadPartRow[] } }> {
  const session = await getSession(env, uploadId);
  const err = sessionError(session);
  if (err) return { ok: false, code: err.includes('不存在') ? 404 : 409, msg: err };
  if (!session) return { ok: false, code: 404, msg: '上传会话不存在' };

  const parts = await getParts(env, uploadId);
  if (session.expected_parts > 0 && parts.length < session.expected_parts) {
    const have = new Set(parts.map((p) => p.partNumber));
    const missing: number[] = [];
    for (let n = 1; n <= session.expected_parts; n++) if (!have.has(n)) missing.push(n);
    return { ok: false, code: 409, msg: '缺少分片', missing };
  }

  // 安全兜底：非末片不得 < 5 MiB
  for (const p of parts) {
    if (session.expected_parts > 0 && p.partNumber < session.expected_parts && p.sizeBytes < MIN_PART_BYTES) {
      return { ok: false, code: 422, msg: `分片 ${p.partNumber} 小于 5 MiB` };
    }
  }

  await completeMultipart(env, session.r2_key, uploadId, parts);
  await env.DB.prepare(
    `UPDATE upload_sessions SET status = 'completed', updated_at = ? WHERE upload_id = ?`
  )
    .bind(new Date().toISOString(), uploadId)
    .run();

  return { ok: true, data: { session, parts } };
}

/** 中止上传 */
export async function abortUpload(
  env: Env,
  uploadId: string
): Promise<Fail | { ok: true; data: { ok: boolean } }> {
  const session = await getSession(env, uploadId);
  if (!session) return { ok: false, code: 404, msg: '上传会话不存在' };
  if (session.status === 'completed') return { ok: false, code: 409, msg: '上传已完成' };
  try {
    await abortMultipart(env, session.r2_key, uploadId);
  } catch {
    /* R2 侧已不存在也继续 */
  }
  await env.DB.prepare(`UPDATE upload_sessions SET status = 'aborted', updated_at = ? WHERE upload_id = ?`)
    .bind(new Date().toISOString(), uploadId)
    .run();
  return { ok: true, data: { ok: true } };
}

/** 上传状态（含已传分片，用于断点续传） */
export async function getUploadStatus(
  env: Env,
  uploadId: string
): Promise<Fail | { ok: true; data: Record<string, unknown> }> {
  const session = await getSession(env, uploadId);
  if (!session) return { ok: false, code: 404, msg: '上传会话不存在' };
  const parts = await getParts(env, uploadId);
  return {
    ok: true,
    data: {
      uploadId: session.upload_id,
      scope: session.scope,
      r2Key: session.r2_key,
      filename: session.filename,
      mimeType: session.mime_type,
      status: session.status,
      totalBytes: session.total_bytes,
      partSize: session.part_size,
      expectedParts: session.expected_parts,
      uploadedParts: parts.length,
      uploadedBytes: session.uploaded_bytes,
      expiresAt: session.expires_at,
      parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, sizeBytes: p.sizeBytes })),
    },
  };
}
