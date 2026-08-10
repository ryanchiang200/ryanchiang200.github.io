// 网盘视频播放器：签发短时效签名 URL 后交给 <video>（支持 Range 拖动进度条）
import { useEffect, useState } from 'react';
import type { DriveFile, DriveApi } from './driveApi';

interface Props {
  file: DriveFile;
  api: DriveApi;
  onClose: () => void;
}

export default function Player({ file, api, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .sign(file.id, 'stream')
      .then((r) => { if (alive) setUrl(r.url); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '获取播放地址失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [file.id, api]);

  const isVideo = file.mimeType.startsWith('video/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-warm-900/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-2xl bg-warm-50 border border-warm-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-200 bg-warm-100">
          <p className="text-sm text-warm-800 truncate font-medium">{file.filename}</p>
          <button
            onClick={onClose}
            className="text-warm-800/50 hover:text-warm-900 text-lg leading-none px-2"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="p-4 bg-black">
          {loading && <p className="text-warm-100/60 text-sm py-16 text-center">加载播放地址…</p>}
          {error && <p className="text-red-400 text-sm py-16 text-center">{error}</p>}
          {!loading && !error && url && (
            isVideo ? (
              <video src={url} controls autoPlay className="w-full max-h-[70vh] rounded-lg" />
            ) : (
              <div className="py-16 text-center">
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent-light underline">
                  在新标签页打开
                </a>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
