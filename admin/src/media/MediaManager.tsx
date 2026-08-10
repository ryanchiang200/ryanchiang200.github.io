import { useCallback, useEffect, useRef, useState } from 'react';
import { createApi, type Media } from '../api';

const PAGE_SIZE = 20;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN');
}

const TYPE_LABEL: Record<string, string> = { image: '图片', video: '视频', file: '文件' };

export default function MediaManager({ token }: { token: string }) {
  const api = useCallback(() => createApi(token), [token]);
  const [items, setItems] = useState<Media[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api().mediaList({
        page,
        pageSize: PAGE_SIZE,
        type: type || undefined,
        visibility: visibility || undefined,
      });
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [api, page, type, visibility]);

  useEffect(() => { void load(); }, [load]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        setUploading({ name: file.name, percent: 0 });
        await api().mediaUploadFile(
          file,
          { visibility, title: file.name },
          (p) => setUploading({ name: file.name, percent: p })
        );
      }
      setUploading(null);
      await load();
    } catch (e) {
      setUploading(null);
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert(`已复制${label}到剪贴板`);
    } catch {
      // 部分环境剪贴板不可用
      window.prompt(`复制${label}：`, text);
    }
  }

  async function remove(m: Media) {
    if (!window.confirm(`确定删除 ${m.title} 吗？`)) return;
    try {
      await api().mediaDelete(m.id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-warm-900">媒体库</h2>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-warm-800/60">类型</label>
          <select className="input !w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">全部</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
            <option value="file">文件</option>
          </select>
          <select className="input !w-auto" value={visibility} onChange={(e) => { setVisibility(e.target.value); setPage(1); }}>
            <option value="public">公开</option>
            <option value="private">私密</option>
          </select>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
          <button disabled={busy} className="btn-primary" onClick={() => fileRef.current?.click()}>
            {busy ? '上传中…' : '+ 上传'}
          </button>
        </div>
      </div>

      {uploading && (
        <div className="mt-4 rounded-xl bg-accent/10 px-4 py-2 text-sm text-warm-800">
          上传中：{uploading.name} {uploading.percent}%
          <div className="mt-1 h-1.5 rounded-full bg-accent/20">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${uploading.percent}%` }} />
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((m) => (
          <div key={m.id} className="border border-warm-200 rounded-2xl overflow-hidden bg-white">
            <div className="aspect-video bg-warm-100 flex items-center justify-center overflow-hidden">
              {m.type === 'image' ? (
                <img src={m.url} alt={m.title} className="w-full h-full object-cover" loading="lazy" />
              ) : m.type === 'video' ? (
                <video src={m.url} className="w-full h-full object-cover" preload="metadata" muted />
              ) : (
                <span className="text-3xl">📄</span>
              )}
            </div>
            <div className="p-3">
              <p className="text-sm text-warm-800 truncate" title={m.title}>{m.title}</p>
              <p className="text-xs text-warm-800/40 mt-1">
                {TYPE_LABEL[m.type] ?? m.type} · {formatBytes(m.sizeBytes)} · {formatDate(m.createdAt)}
                {m.visibility === 'private' && <span className="ml-1 text-accent">私密</span>}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void copy(m.markdown, 'Markdown')}>
                  MD
                </button>
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void copy(m.html, 'HTML')}>
                  HTML
                </button>
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void copy(m.url, 'URL')}>
                  URL
                </button>
                <button className="text-xs text-red-500 hover:text-red-700 ml-auto" onClick={() => void remove(m)}>
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && !error && (
        <p className="mt-6 text-sm text-warm-800/40 text-center py-10">还没有媒体，点击右上角上传</p>
      )}

      <div className="mt-5 flex items-center justify-between text-sm text-warm-800/60">
        <span>共 {total} 项 · 第 {page}/{totalPages} 页</span>
        <div className="flex gap-2">
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← 上一页
          </button>
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页 →
          </button>
        </div>
      </div>
    </div>
  );
}
