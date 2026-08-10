/** 网盘认证：共享密码换 HMAC 会话 token；另提供流媒体签名 URL。
 *  token 格式：dv1.<base64url(payload)>.<base64url(HMAC_SHA256(secret, payload))>
 *  payload: { scope:'drive', sub, iat, exp, jti }
 *  无状态、可离线校验；scope 防越权（drive token 不可调 admin 接口）。
 */
import type { Next } from 'hono';
import type { Env } from './auth';
import { timingSafeEqualStr, driveTokenTtlSeconds } from './auth';

// ---------- base64url ----------

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

// ---------- 会话 token ----------

export interface DriveTokenPayload {
  scope: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export async function signDriveToken(env: Env, payload: DriveTokenPayload): Promise<string> {
  const p64 = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = bytesToBase64url(await hmacSha256(env.DRIVE_TOKEN_SECRET ?? '', p64));
  return `dv1.${p64}.${sig}`;
}

/** 校验 token，返回 payload；无效/过期返回 null */
export async function verifyDriveToken(env: Env, token: string): Promise<DriveTokenPayload | null> {
  if (!env.DRIVE_TOKEN_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'dv1') return null;
  const [, p64, sig] = parts;
  const expected = bytesToBase64url(await hmacSha256(env.DRIVE_TOKEN_SECRET, p64));
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(p64))) as DriveTokenPayload;
    if (payload.scope !== 'drive') return null;
    if (typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 密码登录：常数时间比较 DRIVE_PASSWORD，成功后签发 token */
export async function driveLogin(
  env: Env,
  password: string
): Promise<{ ok: true; token: string; expiresAt: number; expiresIn: number } | { ok: false; error: string }> {
  if (!env.DRIVE_PASSWORD || !env.DRIVE_TOKEN_SECRET) {
    return { ok: false, error: '网盘未配置（缺少 DRIVE_PASSWORD / DRIVE_TOKEN_SECRET）' };
  }
  if (!timingSafeEqualStr(String(password ?? ''), env.DRIVE_PASSWORD)) {
    return { ok: false, error: '密码错误' };
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = driveTokenTtlSeconds(env);
  const token = await signDriveToken(env, {
    scope: 'drive',
    sub: 'owner',
    iat: now,
    exp: now + ttl,
    jti: crypto.randomUUID(),
  });
  return { ok: true, token, expiresAt: now + ttl, expiresIn: ttl };
}

/** drive Bearer 认证中间件（c: any 兼容 Hono 泛型 Variables 不匹配问题） */
export async function requireDriveAuth(c: any, next: Next) {
  const env = c.env as Env;
  const auth = c.req.header('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const payload = await verifyDriveToken(env, auth.slice(7));
    if (payload) {
      c.set('driveUser', payload);
      return next();
    }
  }
  return c.json({ error: '未授权或令牌无效' }, 401);
}

// ---------- 流媒体签名 URL ----------

export type DriveAction = 'stream' | 'download';

const ACTION_TTL: Record<DriveAction, number> = { stream: 900, download: 300 }; // 15min / 5min

/** 签发短时效签名 URL（解决浏览器 <video>/<a> 无法附加 Authorization 头的问题） */
export async function signFileUrl(
  env: Env,
  fileId: string,
  action: DriveAction,
  origin: string
): Promise<{ url: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACTION_TTL[action];
  const sig = bytesToBase64url(await hmacSha256(env.DRIVE_TOKEN_SECRET ?? '', `${fileId}.${action}.${exp}`));
  const path = action === 'stream' ? 'stream' : 'download';
  return {
    url: `${origin}/api/drive/files/${fileId}/${path}?exp=${exp}&sig=${encodeURIComponent(sig)}`,
    expiresAt: exp,
  };
}

/** 校验签名 URL（id + action + exp 均匹配且未过期） */
export async function verifySignedFileUrl(
  env: Env,
  fileId: string,
  action: DriveAction,
  exp: string | undefined,
  sig: string | undefined
): Promise<boolean> {
  if (!env.DRIVE_TOKEN_SECRET || !exp || !sig) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = bytesToBase64url(await hmacSha256(env.DRIVE_TOKEN_SECRET, `${fileId}.${action}.${exp}`));
  return timingSafeEqualStr(sig, expected);
}
