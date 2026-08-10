// 私人网盘主界面：密码登录 + 目录浏览 + 文件操作 + 上传 + 播放
// token 存 localStorage（带过期时间），会话有效期内免重复登录
import { useCallback, useEffect, useRef, useState } from 'react';
import { driveApi } from './driveApi';
import type { DriveApi, DriveFile, DriveFileList } from './driveApi';
import Uploader from './Uploader';
import Player from './Player';

const TOKEN_KEY = 'drive_token';
const PAGE_SIZE = 20;

interface StoredToken {
  token: string;
  exp: number; // ms 时间戳
}

function loadToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    if (!t.token || typeof t.exp !== 'number' || t.exp <= Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fileIcon(mime: string): string {
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📦';
}

function crumbSegments(folder: string): { label: string; path: string }[] {
  const parts = folder.split('/').filter(Boolean);
  const segs = [{ label: '根目录', path: '/' }];
  let acc = '';
  for (const p of parts) {
    acc += `/${p}`;
    segs.push({ label: p, path: acc });
  }
  return segs;
}

export default function DriveApp() {
  const [token, setToken] = useState<StoredToken | null>(loadToken);
  const [checking, setChecking] = useState(!!loadToken());
  const [loginPwd, setLoginPwd] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [folder, setFolder] = useState('/');
  const [folders, setFolders] = useState<string[]>(['/']);
  const [list, setList] = useState<DriveFileList>({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState('');

  const [playing, setPlaying] = useState<DriveFile | null>(null);
  const [moveTarget, setMoveTarget] = useState<DriveFile | null>(null);

  const apiRef = useRef<DriveApi | null>(null);
  if (token && !apiRef.current) apiRef.current = driveApi(token.token);
  const api = apiRef.current;

  const flash = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(''), 4000);
  };

  // ---------- 数据加载 ----------
  const loadFiles = useCallback(
    async (api: DriveApi, folder: string, q: string, sort: string, page: number) => {
      setLoading(true);
      try {
        const data = await api.files({ folder, q: q || undefined, sort, page, pageSize: PAGE_SIZE });
        setList(data);
      } catch (e) {
        flash(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadAll = useCallback(
    async (api: DriveApi) => {
      const [foldersRes] = await Promise.all([
        api.folders(),
        loadFiles(api, folder, q, sort, list.page).catch(() => {}),
      ]);
      if (foldersRes?.folders?.length) setFolders(foldersRes.folders);
    },
    [folder, q, sort, list.page, loadFiles]
  );

  // ---------- 会话校验（挂载时） ----------
  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    const api = driveApi(token.token);
    api
      .me()
      .then(() => {
        apiRef.current = api;
        setChecking(false);
        void loadAll(api);
      })
      .catch(() => {
        // token 失效或网络错误 → 回到登录
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        apiRef.current = null;
        setChecking(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 登录 ----------
  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginPwd || loginBusy) return;
    setLoginBusy(true);
    setLoginError('');
    try {
      const res = await driveApi('').login(loginPwd);
      const t = { token: res.token, exp: Date.parse(res.expiresAt) };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
      apiRef.current = driveApi(res.token);
      setToken(t);
      setLoginPwd('');
      void loadAll(apiRef.current);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoginBusy(false);
    }
  }

  function onLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    apiRef.current = null;
    setFolder('/');
    setQ('');
    setSort('created');
  }

  // ---------- 列表操作 ----------
  function navigateTo(path: string) {
    setFolder(path);
    if (api) void loadFiles(api, path, q, sort, 1);
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (api) void loadFiles(api, folder, q, sort, 1);
  }

  function onSortChange(v: string) {
    setSort(v);
    if (api) void loadFiles(api, folder, q, v, 1);
  }

  function goPage(p: number) {
    if (api) void loadFiles(api, folder, q, sort, p);
  }

  function onDone() {
    if (api) void loadAll(api);
  }

  async function onDownload(f: DriveFile) {
    if (!api) return;
    try {
      const { url } = await api.sign(f.id, 'download');
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      flash(e instanceof Error ? e.message : '下载失败');
    }
  }

  async function onCopyLink(f: DriveFile) {
    if (!api) return;
    try {
      const { url } = await api.sign(f.id, 'download');
      await navigator.clipboard.writeText(url);
      flash('链接已复制（5 分钟内有效）');
    } catch (e) {
      flash(e instanceof Error ? e.message : '复制失败');
    }
  }

  async function onRename(f: DriveFile) {
    if (!api) return;
    const name = window.prompt('新文件名：', f.filename);
    if (!name || name === f.filename) return;
    try {
      await api.rename(f.id, name);
      void loadAll(api);
    } catch (e) {
      flash(e instanceof Error ? e.message : '重命名失败');
    }
  }

  async function onMove(f: DriveFile, target: string) {
    if (!api) return;
    try {
      await api.move(f.id, target);
      setMoveTarget(null);
      void loadAll(api);
    } catch (e) {
      flash(e instanceof Error ? e.message : '移动失败');
    }
  }

  async function onDelete(f: DriveFile) {
    if (!api) return;
    if (!window.confirm(`确定删除「${f.filename}」吗？此操作不可恢复。`)) return;
    try {
      await api.remove(f.id);
      void loadAll(api);
    } catch (e) {
      flash(e instanceof Error ? e.message : '删除失败');
    }
  }

  // ---------- 渲染 ----------
  if (checking) {
    return <p className="py-16 text-center text-sm text-warm-800/40">会话校验中…</p>;
  }

  if (!token || !api) {
    return (
      <div className="max-w-sm mx-auto py-16">
        <h2 className="font-serif text-2xl font-bold text-warm-900 text-center">私人网盘</h2>
        <p className="mt-2 text-center text-sm text-warm-800/50">输入密码进入私人空间</p>
        <form onSubmit={onLogin} className="mt-8 space-y-3">
          <input
            type="password"
            value={loginPwd}
            onChange={(e) => setLoginPwd(e.target.value)}
            placeholder="访问密码"
            autoFocus
            className="w-full rounded-2xl border border-warm-200 bg-warm-100 px-5 py-3.5 text-base text-warm-800 placeholder:text-warm-800/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
          />
          <button
            type="submit"
            disabled={loginBusy}
            className="w-full px-5 py-3 rounded-2xl bg-accent text-white text-base font-medium hover:bg-accent-hover transition-colors disabled:opacity-60"
          >
            {loginBusy ? '登录中…' : '进入网盘'}
          </button>
          {loginError && <p className="text-sm text-red-500 text-center">{loginError}</p>}
        </form>
      </div>
    );
  }

  const crumbs = crumbSegments(folder);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      {/* 顶栏：当前用户 + 退出 */}
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl font-bold text-warm-900">私人网盘</h2>
        <button onClick={onLogout} className="text-sm text-warm-800/50 hover:text-warm-900 transition-colors">
          退出登录
        </button>
      </div>

      {banner && (
        <div className="rounded-xl border border-warm-200 bg-warm-100 px-4 py-3 text-sm text-warm-800">{banner}</div>
      )}

      {/* 工具栏：面包屑 + 搜索 + 排序 + 上传 */}
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-warm-800/30">/</span>}
              <button
                onClick={() => navigateTo(c.path)}
                className={
                  i === crumbs.length - 1
                    ? 'text-warm-900 font-medium'
                    : 'text-warm-800/50 hover:text-accent transition-colors'
                }
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex-1" />
        <form onSubmit={onSearch} className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文件名…"
            className="w-44 rounded-xl border border-warm-200 bg-warm-100 px-3 py-2 text-sm text-warm-800 placeholder:text-warm-800/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
          />
        </form>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="rounded-xl border border-warm-200 bg-warm-100 px-3 py-2 text-sm text-warm-800 focus:outline-none focus:border-accent transition-colors"
        >
          <option value="created">最近上传</option>
          <option value="name">文件名</option>
          <option value="size">文件大小</option>
          <option value="downloads">下载次数</option>
        </select>
        <Uploader api={api} folder={folder} onDone={onDone} />
      </div>

      {/* 移动目标选择 */}
      {moveTarget && (
        <div className="rounded-xl border border-accent/40 bg-warm-100 p-4">
          <p className="text-sm text-warm-800 mb-3">
            将「{moveTarget.filename}」移动到：
          </p>
          <div className="flex flex-wrap gap-2">
            {folders.map((f) => (
              <button
                key={f}
                onClick={() => void onMove(moveTarget, f)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  f === folder
                    ? 'bg-accent/15 text-accent'
                    : 'bg-warm-200/60 text-warm-800 hover:bg-warm-200'
                }`}
              >
                {f === '/' ? '根目录' : f}
              </button>
            ))}
            <button
              onClick={() => setMoveTarget(null)}
              className="px-3 py-1.5 rounded-lg text-sm text-warm-800/50 hover:text-warm-900 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 文件列表 */}
      {loading && list.items.length === 0 ? (
        <p className="py-16 text-center text-sm text-warm-800/40">加载中…</p>
      ) : list.items.length === 0 ? (
        <p className="py-16 text-center text-sm text-warm-800/40">此目录为空</p>
      ) : (
        <ul className="divide-y divide-warm-200 rounded-2xl border border-warm-200 bg-warm-50 overflow-hidden">
          {list.items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-warm-100 transition-colors">
              <span className="text-xl shrink-0">{fileIcon(f.mimeType)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-warm-800 truncate">{f.filename}</p>
                <p className="text-xs text-warm-800/40">
                  {fmtBytes(f.sizeBytes)} · {fmtDate(f.createdAt)} · 下载 {f.downloadCount}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(f.mimeType.startsWith('video/') || f.mimeType.startsWith('audio/')) && (
                  <button
                    onClick={() => setPlaying(f)}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-warm-800/70 hover:bg-warm-200 hover:text-accent transition-colors"
                  >
                    播放
                  </button>
                )}
                <button
                  onClick={() => void onDownload(f)}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-warm-800/70 hover:bg-warm-200 hover:text-accent transition-colors"
                >
                  下载
                </button>
                <button
                  onClick={() => void onCopyLink(f)}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-warm-800/70 hover:bg-warm-200 hover:text-accent transition-colors"
                >
                  复制链接
                </button>
                <button
                  onClick={() => void onRename(f)}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-warm-800/70 hover:bg-warm-200 hover:text-accent transition-colors"
                >
                  重命名
                </button>
                <button
                  onClick={() => setMoveTarget(f)}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-warm-800/70 hover:bg-warm-200 hover:text-accent transition-colors"
                >
                  移动
                </button>
                <button
                  onClick={() => void onDelete(f)}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-warm-200 transition-colors"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 分页 */}
      {list.total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 text-sm">
          <button
            onClick={() => goPage(list.page - 1)}
            disabled={list.page <= 1}
            className="px-3 py-1.5 rounded-lg border border-warm-200 text-warm-800/70 hover:bg-warm-100 transition-colors disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-warm-800/50 tabular-nums">
            第 {list.page} / {totalPages} 页 · 共 {list.total} 个文件
          </span>
          <button
            onClick={() => goPage(list.page + 1)}
            disabled={list.page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-warm-200 text-warm-800/70 hover:bg-warm-100 transition-colors disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      {playing && <Player file={playing} api={api} onClose={() => setPlaying(null)} />}
    </div>
  );
}
