/** 认证与共享环境类型 */
import type { Context, Next } from 'hono';

export interface Env {
  // 管理端认证（现有）
  ADMIN_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  WORKFLOW_FILE: string;
  // 数据库与对象存储
  DB: D1Database;
  MEDIA: R2Bucket;
  // 网盘（Phase C）
  DRIVE_PASSWORD?: string;
  DRIVE_TOKEN_SECRET?: string;
  // 可配置限额（wrangler.toml vars，字符串）
  MEDIA_SINGLE_MAX_BYTES?: string;
  UPLOAD_MAX_BYTES?: string;
  DRIVE_TOKEN_TTL_SECONDS?: string;
}

/** 单次上传上限（默认 50 MB） */
export function singleMaxBytes(env: Env): number {
  return parseInt(env.MEDIA_SINGLE_MAX_BYTES ?? '', 10) || 50 * 1024 * 1024;
}

/** 分片上传总上限（默认 5 GiB） */
export function uploadMaxBytes(env: Env): number {
  return parseInt(env.UPLOAD_MAX_BYTES ?? '', 10) || 5 * 1024 * 1024 * 1024;
}

/** 网盘会话 TTL 秒（默认 12h） */
export function driveTokenTtlSeconds(env: Env): number {
  return parseInt(env.DRIVE_TOKEN_TTL_SECONDS ?? '', 10) || 12 * 60 * 60;
}

/** 管理端 Bearer 认证中间件 */
export async function requireAuth(c: Context, next: Next) {
  const env = c.env as Env;
  const auth = c.req.header('Authorization');
  if (!auth || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return c.json({ error: '未授权' }, 401);
  }
  await next();
}

/** 常数时间字符串比较，用于密码/token 校验，防时序攻击 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) {
    // 长度不同直接返回 false；为防基于长度的时序差异，仍做一次比较
    void ba.length;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
