// 网盘分片上传：断点续传 + 每文件进度条
// 复用后端 uploads.ts 协议：init → parts(N) → complete；失败可 abort
import { useRef, useState } from 'react';
import type { DriveApi } from './driveApi';

interface Props {
  api: DriveApi;
  folder: string;
  onDone: () => void;
}

interface Uploading {
  name: string;
  percent: number;
  size: number;
  error?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 上传单个文件（含断点续传：查询已传分片后只补缺口） */
async function uploadOne(api: DriveApi, file: File, folder: string, onProgress: (pct: number) => void): Promise<void> {
  const init = await api.uploadInit({
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    folder,
  });
  const { uploadId, partSize, expectedParts } = init;

  // 续传：查询已有分片，跳过
  const uploaded = new Set<number>();
  let doneBytes = 0;
  try {
    const st = await api.uploadStatus(uploadId);
    for (const p of st.parts) {
      uploaded.add(p.partNumber);
      doneBytes += p.sizeBytes;
    }
  } catch {
    /* 状态查询失败则从 0 开始 */
  }
  onProgress(Math.round((doneBytes / file.size) * 100));

  for (let n = 1; n <= expectedParts; n++) {
    if (uploaded.has(n)) continue;
    const start = (n - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);
    await api.uploadPart(uploadId, n, blob);
    doneBytes += blob.size;
    onProgress(Math.round((doneBytes / file.size) * 100));
  }

  await api.uploadComplete(uploadId);
  onProgress(100);
}

export default function Uploader({ api, folder, onDone }: Props) {
  const [list, setList] = useState<Uploading[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function setPercent(name: string, percent: number) {
    setList((l) => l.map((u) => (u.name === name ? { ...u, percent } : u)));
  }
  function setError(name: string, error: string) {
    setList((l) => l.map((u) => (u.name === name ? { ...u, error } : u)));
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const targets = Array.from(files);
    setList((l) => [
      ...l,
      ...targets.map((f) => ({ name: f.name, percent: 0, size: f.size })),
    ]);
    setBusy(true);
    try {
      for (const f of targets) {
        try {
          await uploadOne(api, f, folder, (pct) => setPercent(f.name, pct));
        } catch (e) {
          setError(f.name, e instanceof Error ? e.message : '上传失败');
        }
      }
      onDone();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      <button
        onClick={() => inputRef.current?.click()}
        className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        disabled={busy}
      >
        {busy ? '上传中…' : '+ 上传'}
      </button>

      {list.length > 0 && (
        <div className="mt-3 space-y-2">
          {list.map((u) => (
            <div key={u.name} className="rounded-xl border border-warm-200 bg-warm-100 px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-warm-800 truncate">{u.name}</span>
                <span className="text-warm-800/40 shrink-0 tabular-nums">{formatBytes(u.size)}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-warm-200/60 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${u.error ? 'bg-red-400' : 'bg-accent'}`}
                  style={{ width: `${u.percent}%` }}
                />
              </div>
              {u.error ? (
                <p className="mt-1 text-xs text-red-500">{u.error}</p>
              ) : (
                <p className="mt-1 text-xs text-warm-800/40">{u.percent}%</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
