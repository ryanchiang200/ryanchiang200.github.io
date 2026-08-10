/** 网盘认证：密码换 HMAC 会话 token；另提供流媒体签名 URL 与文件夹级加密。
 *  token 格式：dv1.<base64url(payload)>.<base64url(HMAC_SHA256(secret, payload))>
 *  payload: { scope:'drive'|'folder', sub, iat, exp, jti, folder? }
 *  无状态、可离线校验；scope 防越权：
 *   - scope='drive'（全局密码换得）：可读写全部，含写操作
 *   - scope='folder'（某文件夹密码换得）：仅可读该文件夹及其子文件夹
 *  文件夹密码以 PBKDF2-SHA256 哈希存储（salt + iterations 入库），常数时间比较；
 *  密码绝不落 git / 日志 / URL，仅经 POST body 传输。
 */
import type { Next } from 'hono';
import type { Env } from './auth';
import { timingSafeEqualStr, driveTokenTtlSeconds } from './auth';

// ---------- base64url / hex ----------

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

function bytesToHex(bytes: Uint8Array): string {
  let h = '';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return h;
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
  /** 仅 scope='folder' 时存在：该 token 可访问的文件夹路径 */
  folder?: string;
}

export async function signDriveToken(env: Env, payload: DriveTokenPayload): Promise<string> {
  const p64 = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = bytesToBase64url(await hmacSha256(env.DRIVE_TOKEN_SECRET ?? '', p64));
  return `dv1.${p64}.${sig}`;
}

/** 校验签名与过期，返回 payload（不校验 scope；scope 由调用方按需判定） */
export async function parseDriveToken(env: Env, token: string): Promise<DriveTokenPayload | null> {
  if (!env.DRIVE_TOKEN_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'dv1') return null;
  const [, p64, sig] = parts;
  const expected = bytesToBase64url(await hmacSha256(env.DRIVE_TOKEN_SECRET, p64));
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(p64))) as DriveTokenPayload;
    if (typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 校验全局（scope='drive'）token */
export async function verifyDriveToken(env: Env, token: string): Promise<DriveTokenPayload | null> {
  const p = await parseDriveToken(env, token);
  return p && p.scope === 'drive' ? p : null;
}

/** 校验文件夹（scope='folder'）token 且覆盖目标文件夹 */
export async function verifyFolderToken(env: Env, token: string, folder: string): Promise<DriveTokenPayload | null> {
  const p = await parseDriveToken(env, token);
  if (!p || p.scope !== 'folder' || typeof p.folder !== 'string') return null;
  return folderCovers(p.folder, folder) ? p : null;
}

/** a 是否为 b 的祖先（含自身）。a/b 均为已归一化路径（/x/y）。 */
export function folderCovers(a: string, b: string): boolean {
  if (a === '/' || a === '') return true;
  return b === a || b.startsWith(a + '/');
}

/** 全局密码登录：常数时间比较 DRIVE_PASSWORD，成功后签发全局 token */
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

/** 文件夹会话 token（2h），用于解锁某个加密文件夹后浏览/播放 */
export async function signFolderToken(env: Env, folder: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signDriveToken(env, {
    scope: 'folder',
    sub: `folder:${folder}`,
    folder,
    iat: now,
    exp: now + FOLDER_TOKEN_TTL,
    jti: crypto.randomUUID(),
  });
}

export const FOLDER_TOKEN_TTL = 7200; // 2h

/** drive 全局 Bearer 认证中间件（仅接受 scope='drive'；文件夹 token 不可用于写操作） */
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

// ---------- 文件夹密码（PBKDF2-SHA256） ----------

const PBKDF2_ITERATIONS = 100000;

export function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return bytesToBase64url(b);
}

async function deriveFolderKey(password: string, salt: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64urlToBytes(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

/** 为新密码生成哈希（每次设置换新盐；仅返回哈希/盐/迭代次数，绝不返回明文） */
export async function hashFolderPassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = randomSalt();
  const hash = await deriveFolderKey(password, salt, PBKDF2_ITERATIONS);
  return { hash, salt, iterations: PBKDF2_ITERATIONS };
}

/** 常数时间校验文件夹密码 */
export async function verifyFolderPassword(
  password: string,
  hash: string,
  salt: string,
  iterations: number
): Promise<boolean> {
  const derived = await deriveFolderKey(password, salt, iterations);
  return timingSafeEqualStr(derived, hash);
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
