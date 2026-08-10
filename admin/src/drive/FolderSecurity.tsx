import { useCallback, useEffect, useState } from 'react';
import { createApi, type DriveFolderInfo } from '../api';

/** 网盘文件夹加密管理：列出目录 → 设置 / 清除密码（ADMIN_TOKEN 鉴权） */
export default function FolderSecurity({ token }: { token: string }) {
  const api = useCallback(() => createApi(token), [token]);
  const [folders, setFolders] = useState<DriveFolderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setFolders(await api().driveFolders());
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载目录失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function savePassword(folder: string) {
    if (pwd.length < 4) { setError('密码至少 4 位'); return; }
    if (pwd !== pwd2) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    setError('');
    try {
      await api().driveSetFolderSecret(folder, pwd);
      setEditing(null);
      setPwd('');
      setPwd2('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置失败');
    } finally {
      setBusy(false);
    }
  }

  async function clearPassword(folder: string) {
    if (!window.confirm(`确定清除 ${folder} 的密码吗？清除后该文件夹将公开可访问。`)) return;
    setBusy(true);
    setError('');
    try {
      await api().driveClearFolderSecret(folder);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '清除失败');
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setEditing(null);
    setPwd('');
    setPwd2('');
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-warm-900">网盘文件夹加密</h2>
          <p className="text-sm text-warm-800/50 mt-1">
            给文件夹设置密码后，进入该文件夹需输入密码；根目录 / 不可加密
          </p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => void load()}>刷新</button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 divide-y divide-warm-200">
        {loading ? (
          <p className="py-6 text-sm text-warm-800/40">加载中…</p>
        ) : folders.length === 0 ? (
          <p className="py-6 text-sm text-warm-800/40">还没有目录。先往网盘上传文件即可产生目录。</p>
        ) : (
          folders.map((f) => (
            <div key={f.path} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <span className="font-mono text-sm text-warm-800 truncate">{f.path}</span>
                {f.locked ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent shrink-0">🔒 已加密</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-warm-200 text-warm-800/50 shrink-0">公开</span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {editing === f.path ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); void savePassword(f.path); }}
                  >
                    <input
                      type="password" className="input !w-32" placeholder="密码（≥4位）"
                      value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus
                    />
                    <input
                      type="password" className="input !w-32" placeholder="确认密码"
                      value={pwd2} onChange={(e) => setPwd2(e.target.value)}
                    />
                    <button disabled={busy} className="btn-primary !px-3 !py-1.5 text-sm">
                      {busy ? '保存中…' : '保存'}
                    </button>
                    <button type="button" className="btn-ghost text-sm" onClick={cancelEdit}>取消</button>
                  </form>
                ) : (
                  <>
                    <button
                      className="btn-ghost text-sm"
                      onClick={() => { setEditing(f.path); setPwd(''); setPwd2(''); }}
                    >
                      {f.locked ? '改密码' : '设置密码'}
                    </button>
                    {f.locked && (
                      <button className="text-xs text-red-500 hover:text-red-700" onClick={() => void clearPassword(f.path)}>
                        清除
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
