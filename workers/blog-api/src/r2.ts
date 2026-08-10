/** R2 对象存储封装：put/get/delete/head + multipart + Range 流式输出 */
import type { Env } from './auth';

/** 单对象写入（httpMetadata 记录 Content-Type，输出时用 writeHttpMetadata 还原） */
export async function putObject(
  env: Env,
  key: string,
  body: ArrayBuffer | string,
  contentType: string
) {
  return env.MEDIA.put(key, body, { httpMetadata: { contentType } });
}

/** 读取对象元数据，不存在返回 null */
export async function headObject(env: Env, key: string) {
  return env.MEDIA.head(key);
}

/** 删除对象（幂等，不存在也不报错） */
export async function deleteObject(env: Env, key: string) {
  await env.MEDIA.delete(key);
}

// ---------- 分片上传 ----------

const MIN_PART_BYTES = 5 * 1024 * 1024; // R2 单片下限 5 MiB（末片除外）
const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024; // 单片上限 5 GiB

/** 创建 multipart 上传，返回 uploadId */
export async function createMultipart(env: Env, key: string): Promise<string> {
  const mup = await env.MEDIA.createMultipartUpload(key);
  return mup.uploadId;
}

/** 上传单个分片（幂等：同一 partNumber 后传覆盖先传），返回 etag */
export async function uploadPart(
  env: Env,
  key: string,
  uploadId: string,
  partNumber: number,
  body: ArrayBuffer
): Promise<string> {
  const mup = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await mup.uploadPart(partNumber, body);
  return part.etag;
}

export { MIN_PART_BYTES, MAX_PART_BYTES };

/** 校验分片大小：除已知末片外，其余分片须 ≥ 5 MiB */
export function isValidPartSize(
  partNumber: number,
  bytes: number,
  expectedParts: number,
  partSize: number
): string | null {
  if (bytes < 1) return '分片不能为空';
  if (bytes > MAX_PART_BYTES) return '分片超过单片上限（5 GiB）';
  if (expectedParts > 0) {
    if (partNumber > expectedParts) return `partNumber 超出范围（最大 ${expectedParts}）`;
    const isLast = partNumber === expectedParts;
    if (!isLast && bytes < MIN_PART_BYTES) return '非末分片不得小于 5 MiB';
    if (!isLast && bytes !== partSize) return `分片大小应与 partSize（${partSize}）一致`;
    if (isLast && bytes > partSize) return '末片大小超出 partSize';
  } else if (bytes < MIN_PART_BYTES) {
    // expectedParts 未知时无法判定末片，统一要求 ≥ 5 MiB
    return '分片不得小于 5 MiB';
  }
  return null;
}

/** 合并分片；parts 需按 partNumber 升序 */
export async function completeMultipart(
  env: Env,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
) {
  const mup = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await mup.complete(sorted.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
}

/** 中止 multipart 上传 */
export async function abortMultipart(env: Env, key: string, uploadId: string) {
  const mup = env.MEDIA.resumeMultipartUpload(key, uploadId);
  await mup.abort();
}

// ---------- 流式输出 ----------

export interface StreamOptions {
  /** Content-Disposition 值，如 `attachment; filename="x.mp4"`（下载用） */
  contentDisposition?: string;
  /** 私密/网盘内容：不缓存 */
  noStore?: boolean;
  /** 显式 Content-Type（multipart 上传的对象未存 httpMetadata，视频播放必须有） */
  contentType?: string;
}

/** 手动解析 Range 头（兼容真实 R2 与 Miniflare 模拟），返回偏移/长度；'invalid' → 416；'full' → 整段 200 */
function parseRange(header: string, size: number): { offset: number; length: number } | 'invalid' | 'full' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid'; // 多段或其他单位：不可满足
  const [, startS, endS] = m;
  if (startS === '' && endS === '') return 'invalid';
  if (startS === '') {
    // bytes=-N：末尾 N 字节
    const n = parseInt(endS, 10);
    if (n === 0 || n >= size) return 'full';
    return { offset: size - n, length: n };
  }
  const start = parseInt(startS, 10);
  if (start >= size) return 'invalid';
  const end = endS === '' ? size - 1 : Math.min(parseInt(endS, 10), size - 1);
  if (end < start) return 'invalid';
  return { offset: start, length: end - start + 1 };
}

/**
 * 从 R2 流式输出对象，支持 HTTP Range（视频 seek）。
 * 返回 null 表示对象不存在（调用方返回 404）。
 * Range 不可满足时返回 416。
 */
export async function streamObject(
  env: Env,
  key: string,
  rangeHeader: string | undefined,
  opts: StreamOptions = {}
): Promise<Response | null> {
  const headers = new Headers();
  headers.set('Accept-Ranges', 'bytes');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', opts.noStore ? 'no-store, private' : 'public, max-age=31536000, immutable');
  if (opts.contentType) headers.set('Content-Type', opts.contentType);
  if (opts.contentDisposition) headers.set('Content-Disposition', opts.contentDisposition);

  if (rangeHeader) {
    const head = await env.MEDIA.head(key);
    if (!head) return null;
    const size = head.size;
    headers.set('etag', head.httpEtag);
    const parsed = parseRange(rangeHeader, size);
    if (parsed === 'invalid') {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (parsed === 'full') {
      const obj = await env.MEDIA.get(key);
      if (!obj) return null;
      obj.writeHttpMetadata(headers);
      headers.set('Content-Length', String(size));
      return new Response(obj.body, { status: 200, headers });
    }
    const obj = await env.MEDIA.get(key, { range: { offset: parsed.offset, length: parsed.length } });
    if (!obj) return null;
    obj.writeHttpMetadata(headers);
    headers.set('Content-Range', `bytes ${parsed.offset}-${parsed.offset + parsed.length - 1}/${size}`);
    headers.set('Content-Length', String(parsed.length));
    return new Response(obj.body, { status: 206, headers });
  }

  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
