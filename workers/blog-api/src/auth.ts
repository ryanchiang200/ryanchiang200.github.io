/** 管理端认证：请求头 Authorization: Bearer <ADMIN_TOKEN> */
import type { Context, Next } from 'hono';

export interface Env {
  ADMIN_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  WORKFLOW_FILE: string;
  DB: D1Database;
}

export async function requireAuth(c: Context, next: Next) {
  const env = c.env as Env;
  const auth = c.req.header('Authorization');
  if (!auth || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return c.json({ error: '未授权' }, 401);
  }
  await next();
}
