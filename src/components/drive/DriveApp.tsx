// 私人网盘主界面 v2：公开浏览 + 文件夹级加密 + 写操作需全局登录
// - 进入页面无需密码，浏览目录树
// - 加密文件夹：进入（看内容）需该文件夹密码，换取 2h 文件夹 token（仅存内存）
// - 未加密文件夹：内容可公开浏览/播放/下载
// - 上传/改名/移动/删除等写操作：需全局密码登录
// 文件夹 token 不持久化（刷新即失效，需重新输密码），密码绝不落 localStorage。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { driveApi } from './driveApi';
import type { DriveApi, DriveFile, DriveFileList, DriveFolderInfo } from './driveApi';
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

/** token 的文件夹是否覆盖目标（祖先或自身） */
function tokenCovers(tokenFolder: string, target: string): boolean {
  if (tokenFolder === '/' || tokenFolder === '') return true;
  return target === tokenFolder || target.startsWith(tokenFolder + '/');
}

/** 当前文件夹的直接子目录 */
function childFolders(all: DriveFolderInfo[], folder: string): DriveFolderInfo[] {
  const prefix = folder === '/' ? '/' : folder + '/';
  return all
    .filter((f) => f.path !== folder && f.path.startsWith(prefix))
    .filter((f) => {
      const rest = f.path.slice(prefix.length);
      return rest && !rest.includes('/');
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

export default function DriveApp() {
  const [globalToken, setGlobalToken] = useState<StoredToken | null>(loadToken);
  const [folderTokens, setFolderTokens] = useState<Record<string, string>>({});
  const [folders, setFolders] = useState<DriveFolderInfo[]>([]);
  const [curFolder, setCurFolder] = useState('/');
  const [list, setList] = useState<DriveFileList>({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState('');

  // 登录/解锁弹层
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPwd, setLoginPwd] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);

  const [playing, setPlaying] = useState<{ file: DriveFile; api: DriveApi } | null>(null);
  const [moveTarget, setMoveTarget] = useState<DriveFile | null>(null);

  const loggedIn = !!globalToken;

  /** 读取某文件夹应携带的 token：优先全局，其次最长匹配的文件夹 token */
  const authFor = useCallback(
    (folder: string): string => {
      if (globalToken) return globalToken.token;
      let best = '';
      let bestLen = -1;
      for (const [p, t] of Object.entries(folderTokens)) {
        if (tokenCovers(p, folder) && p.length > bestLen) {
          best = t;
          bestLen = p.length;
        }
      }
      return best;
    },
    [globalToken, folderTokens]
  );

  const readApi = useCallback((folder: string) => driveApi(authFor(folder)), [authFor]);
  const writeApi = useMemo(() => driveApi(globalToken?.token ?? ''), [globalToken]);

  const flash = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(''), 4000);
  };

  // ---------- 数据加载 ----------
  const loadFiles = useCallback(
    async (folder: string, page = 1) => {
      setLoading(true);
      try {
        const data = await readApi(folder).files(
          q ? { folder, q, sort, page, pageSize: PAGE_SIZE } : { folder, sort, page, pageSize: PAGE_SIZE }
        );
        setList(data);
        setCurFolder(folder);
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 403) {
          // token 失效或缺失 → 要求输入文件夹密码
          setUnlockTarget(folder);
          setUnlockError('');
        } else {
          flash(err.message || '加载失败');
        }
      } finally {
        setLoading(false);
      }
    },
    [readApi, q, sort]
  );

  const loadFolders = useCallback(async () => {
    try {
      const res = await driveApi('').folders();
      setFolders(res.folders);
    } catch {
      /* 目录树加载失败不阻塞浏览 */
    }
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    void loadFolders();
    void loadFiles('/');
  }, [loadFolders, loadFiles]);

  // ---------- 全局登录（写操作） ----------
  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginPwd || loginBusy) return;
    setLoginBusy(true);
    setLoginError('');
    try {
      const res = await driveApi('').login(loginPwd);
      const t = { token: res.token, exp: Date.parse(res.expiresAt) };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
      setGlobalToken(t);
      setLoginPwd('');
      setLoginOpen(false);
      void loadFolders();
      void loadFiles(curFolder);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoginBusy(false);
    }
  }

  function onLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setGlobalToken(null);
    setFolderTokens({});
    void loadFiles(curFolder);
  }

  // ---------- 文件夹解锁 ----------
  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!unlockTarget || !unlockPwd || unlockBusy) return;
    setUnlockBusy(true);
    setUnlockError('');
    try {
      const res = await driveApi('').unlock(unlockTarget, unlockPwd);
      setFolderTokens((m) => ({ ...m, [res.folder]: res.token }));
      setUnlockTarget(null);
      setUnlockPwd('');
      void loadFiles(res.folder, 1);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : '解锁失败');
    } finally {
      setUnlockBusy(false);
    }
  }

  // ---------- 导航 ----------
  function enterFolder(path: string) {
    const info = folders.find((f) => f.path === path);
    if (info?.locked && !authFor(path)) {
      setUnlockTarget(path);
      setUnlockError('');
      return;
    }
    void loadFiles(path, 1);
  }

  // ---------- 列表操作 ----------
  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    void loadFiles(curFolder, 1);
  }

  function onSortChange(v: string) {
    setSort(v);
    void loadFiles(curFolder, 1);
  }

  function goPage(p: number) {
    void loadFiles(curFolder, p);
  }

  function onDone() {
    void loadFolders();
    void loadFiles(curFolder);
  }

  function openPlayer(f: DriveFile) {
    setPlaying({ file: f, api: readApi(f.folder) });
  }

  async function onDownload(f: DriveFile) {
    try {
      const { url } = await readApi(f.folder).sign(f.id, 'download');
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
    try {
      const { url } = await readApi(f.folder).sign(f.id, 'download');
      await navigator.clipboard.writeText(url);
      flash('链接已复制（5 分钟内有效）');
    } catch (e) {
      flash(e instanceof Error ? e.message : '复制失败');
    }
  }

  async function onRename(f: DriveFile) {
    const name = window.prompt('新文件名：', f.filename);
    if (!name || name === f.filename) return;
    try {
      await writeApi.rename(f.id, name);
      void loadFiles(curFolder);
    } catch (e) {
      flash(e instanceof Error ? e.message : '重命名失败');
    }
  }

  async function onMove(f: DriveFile, target: string) {
    try {
      await writeApi.move(f.id, target);
      setMoveTarget(null);
      void loadFolders();
      void loadFiles(curFolder);
    } catch (e) {
      flash(e instanceof Error ? e.message : '移动失败');
    }
  }

  async function onDelete(f: DriveFile) {
    if (!window.confirm(`确定删除「${f.filename}」吗？此操作不可恢复。`)) return;
    try {
      await writeApi.remove(f.id);
      void loadFolders();
      void loadFiles(curFolder);
    } catch (e) {
      flash(e instanceof Error ? e.message : '删除失败');
    }
  }

  // ---------- 渲染 ----------
  const crumbs = crumbSegments(curFolder);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const children = childFolders(folders, curFolder);

  return (
    <div className="space-y-5">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-xl font-bold text-warm-900">私人网盘</h2>
        {loggedIn ? (
          <button onClick={onLogout} className="text-sm text-warm-800/50 hover:text-warm-900 transition-colors">
            退出登录
          </button>
        ) : (
          <button
            onClick={() => setLoginOpen(true)}
            className="px-3.5 py-1.5 rounded-lg border border-warm-200 text-sm text-warm-800/70 hover:bg-warm-100 transition-colors"
          >
            登录（上传/管理）
          </button>
        )}
      </div>

      {banner && (
        <div className="rounded-xl border border-warm-200 bg-warm-100 px-4 py-3 text-sm text-warm-800">{banner}</div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-warm-800/30">/</span>}
              <button
                onClick={() => enterFolder(c.path)}
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
            placeholder="搜索当前目录…"
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
        {loggedIn && <Uploader api={writeApi} folder={curFolder} onDone={onDone} />}
      </div>

      {!loggedIn && (
        <p className="text-xs text-warm-800/40">
          浏览模式：未加密内容可直接查看；加密文件夹需输入其密码。上传/改名/删除等操作请先登录。
        </p>
      )}

      {/* 子目录卡片 */}
      {children.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {children.map((f) => (
            <button
              key={f.path}
              onClick={() => enterFolder(f.path)}
              className="group flex items-center gap-3 rounded-xl border border-warm-200 bg-warm-50 px-4 py-3 text-left transition-colors hover:bg-warm-100"
            >
              <span className="text-lg shrink-0">{f.locked ? '🔒' : '📁'}</span>
              <span className="text-sm text-warm-800 truncate flex-1">
                {f.path.split('/').filter(Boolean).pop()}
              </span>
              {f.locked && (
                <span className="text-xs text-warm-800/40 shrink-0 group-hover:text-accent transition-colors">
                  需要密码
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 移动目标选择 */}
      {moveTarget && (
        <div className="rounded-xl border border-accent/40 bg-warm-100 p-4">
          <p className="text-sm text-warm-800 mb-3">
            将「{moveTarget.filename}」移动到：
          </p>
          <div className="flex flex-wrap gap-2">
            {folders.map((f) => (
              <button
                key={f.path}
                onClick={() => void onMove(moveTarget, f.path)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  f.path === curFolder
                    ? 'bg-accent/15 text-accent'
                    : 'bg-warm-200/60 text-warm-800 hover:bg-warm-200'
                }`}
              >
                {f.locked && '🔒 '}
                {f.path === '/' ? '根目录' : f.path}
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
      ) : list.items.length === 0 && children.length === 0 ? (
        <p className="py-16 text-center text-sm text-warm-800/40">
          {curFolder === '/' ? '网盘为空' : '此目录为空'}
          {!loggedIn && '（登录后可上传文件）'}
        </p>
      ) : (
        list.items.length > 0 && (
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
                <div className="flex items-center gap-1 shrink-0 flex-wrap">
                  {(f.mimeType.startsWith('video/') || f.mimeType.startsWith('audio/')) && (
                    <button
                      onClick={() => openPlayer(f)}
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
                  {loggedIn && (
                    <>
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
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
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

      {/* 全局登录弹层 */}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-warm-900/70 backdrop-blur-sm p-4" onClick={() => setLoginOpen(false)}>
          <form
            onSubmit={onLogin}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-warm-50 border border-warm-200 shadow-2xl p-6 space-y-3"
          >
            <h3 className="font-serif text-lg font-bold text-warm-900">登录以管理</h3>
            <p className="text-xs text-warm-800/50">输入全局密码后可上传、改名、移动、删除文件</p>
            <input
              type="password"
              value={loginPwd}
              onChange={(e) => setLoginPwd(e.target.value)}
              placeholder="全局密码"
              autoFocus
              className="w-full rounded-xl border border-warm-200 bg-warm-100 px-4 py-2.5 text-sm text-warm-800 placeholder:text-warm-800/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
            />
            {loginError && <p className="text-xs text-red-500">{loginError}</p>}
            <button
              type="submit"
              disabled={loginBusy}
              className="w-full px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {loginBusy ? '登录中…' : '登录'}
            </button>
          </form>
        </div>
      )}

      {/* 文件夹解锁弹层 */}
      {unlockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-warm-900/70 backdrop-blur-sm p-4" onClick={() => setUnlockTarget(null)}>
          <form
            onSubmit={onUnlock}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-warm-50 border border-warm-200 shadow-2xl p-6 space-y-3"
          >
            <h3 className="font-serif text-lg font-bold text-warm-900">🔒 {unlockTarget}</h3>
            <p className="text-xs text-warm-800/50">此文件夹已加密，输入密码后即可查看并播放其中的内容</p>
            <input
              type="password"
              value={unlockPwd}
              onChange={(e) => setUnlockPwd(e.target.value)}
              placeholder="文件夹密码"
              autoFocus
              className="w-full rounded-xl border border-warm-200 bg-warm-100 px-4 py-2.5 text-sm text-warm-800 placeholder:text-warm-800/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
            />
            {unlockError && <p className="text-xs text-red-500">{unlockError}</p>}
            <button
              type="submit"
              disabled={unlockBusy}
              className="w-full px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {unlockBusy ? '解锁中…' : '解锁'}
            </button>
          </form>
        </div>
      )}

      {playing && <Player file={playing.file} api={playing.api} onClose={() => setPlaying(null)} />}
    </div>
  );
}
