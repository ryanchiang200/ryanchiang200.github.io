/** 触发 GitHub Actions workflow_dispatch 重建 GitHub Pages */
import type { Env } from './auth';

const API = 'https://api.github.com';

export interface RebuildResult {
  ok: boolean;
  message: string;
}

export async function triggerRebuild(env: Env): Promise<RebuildResult> {
  const url = `${API}/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'blog-admin-api',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
    });
    if (res.status === 204) {
      return { ok: true, message: '已触发构建' };
    }
    return { ok: false, message: `构建触发失败（HTTP ${res.status}）` };
  } catch (e) {
    return { ok: false, message: `构建触发失败（${e instanceof Error ? e.message : '网络错误'}）` };
  }
}
