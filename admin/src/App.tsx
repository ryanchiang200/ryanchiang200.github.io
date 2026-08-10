import { useCallback, useEffect, useState } from 'react';
import { createApi, API_URL, type Post } from './api';
import MediaManager from './media/MediaManager';
import FolderSecurity from './drive/FolderSecurity';

const EMPTY: Post = {
  slug: '',
  title: '',
  description: '',
  pubDate: new Date().toISOString().slice(0, 10),
  tags: [],
  category: '',
  draft: false,
  content: '',
};

const CATEGORIES: [string, string][] = [
  ['', '（无分类）'],
  ['tech', '技术'],
  ['hiking', '登山'],
  ['essay', '随笔'],
];

function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem('admin_token') ?? '');

  if (!token) return <Login onLogin={setToken} />;
  return <Dashboard token={token} onLogout={() => { localStorage.removeItem('admin_token'); setToken(''); }} />;
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setBusy(true);
    setErr('');
    try {
      await createApi(t).list(); // 用列表请求验证 token 是否有效
      localStorage.setItem('admin_token', t);
      onLogin(t);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-warm-50 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm card">
        <h1 className="font-serif text-2xl font-bold text-warm-900">博客管理</h1>
        <p className="mt-1 text-sm text-warm-800/50">接口：{API_URL}</p>
        <label className="block mt-6 text-sm text-warm-800/60">管理密钥</label>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ADMIN_TOKEN"
          className="mt-1 w-full input"
          autoFocus
        />
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <button disabled={busy} className="btn-primary mt-6 w-full">
          {busy ? '验证中…' : '登录'}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const api = useCallback(() => createApi(token), [token]);
  const [tab, setTab] = useState<'posts' | 'media' | 'drive'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Post>(EMPTY);
  const [isEdit, setIsEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      setPosts(await api().list());
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  function startEdit(post: Post) {
    setEditing(post);
    setIsEdit(true);
  }

  function startNew() {
    setEditing(EMPTY);
    setIsEdit(false);
  }

  return (
    <div className="min-h-screen bg-warm-50">
      <header className="bg-white border-b border-warm-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-lg font-bold text-warm-900">博客内容管理</h1>
            <p className="text-xs text-warm-800/50">
              写入 Cloudflare D1，提交后自动触发构建发布
            </p>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex gap-1">
              {(
                [
                  ['posts', '文章'],
                  ['media', '媒体库'],
                  ['drive', '网盘加密'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    tab === key
                      ? 'bg-accent text-white'
                      : 'text-warm-800/60 hover:text-accent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
            <button onClick={onLogout} className="text-sm text-warm-800/60 hover:text-accent">
              退出
            </button>
          </div>
        </div>
      </header>

      {tab === 'media' ? (
        <main className="max-w-6xl mx-auto px-6 py-8">
          <MediaManager token={token} />
        </main>
      ) : tab === 'drive' ? (
        <main className="max-w-6xl mx-auto px-6 py-8">
          <FolderSecurity token={token} />
        </main>
      ) : (
        <main className="max-w-6xl mx-auto px-6 py-8 grid lg:grid-cols-[1fr_340px] gap-8">
          <Editor
            post={editing}
            isEdit={isEdit}
            api={api()}
            onSaved={(msg) => { setError(''); void load(); setEditing(EMPTY); setIsEdit(false); alert(msg); }}
          />

          <aside>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-warm-900">文章列表</h2>
              <button onClick={startNew} className="btn-ghost text-sm">+ 新建</button>
            </div>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="card divide-y divide-warm-200">
              {posts.length === 0 ? (
                <p className="p-4 text-sm text-warm-800/40">还没有文章</p>
              ) : (
                posts.map((p) => (
                  <div key={p.slug} className="flex items-center justify-between gap-2 p-3">
                    <button onClick={() => startEdit(p)} className="text-left min-w-0 group">
                      <span className="block text-sm text-warm-800 truncate group-hover:text-accent">
                        {p.title || p.slug}
                      </span>
                      <span className="block text-xs text-warm-800/40 tabular-nums">
                        {p.pubDate}
                        {p.draft && <span className="ml-2 text-accent">草稿</span>}
                      </span>
                    </button>
                    <button
                      onClick={() => void removePost(api(), p.slug, load)}
                      className="text-xs text-red-500 hover:text-red-700 shrink-0"
                      title="删除"
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

async function removePost(api: ReturnType<typeof createApi>, slug: string, reload: () => void) {
  if (!window.confirm(`确定删除 ${slug} 吗？`)) return;
  try {
    await api.remove(slug);
    reload();
  } catch (e) {
    alert(e instanceof Error ? e.message : '删除失败');
  }
}

function Editor({
  post,
  isEdit,
  api,
  onSaved,
}: {
  post: Post;
  isEdit: boolean;
  api: ReturnType<typeof createApi>;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState<Post>(post);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setForm(post); setError(''); }, [post]);

  const set = <K extends keyof Post>(key: K, value: Post[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.save(form);
      onSaved(`已${res.created ? '发布' : '更新'}：${res.slug}\n${res.build}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-warm-900">{isEdit ? `编辑：${post.slug}` : '写文章'}</h2>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div>
          <label className="label">slug（URL 标识）</label>
          <input className="input" required pattern="[a-z0-9-]+" value={form.slug}
            onChange={(e) => set('slug', e.target.value)} placeholder="my-post" />
        </div>
        <div>
          <label className="label">发布日期</label>
          <input className="input" type="date" required value={form.pubDate}
            onChange={(e) => set('pubDate', e.target.value)} />
        </div>
        <div>
          <label className="label">分类</label>
          <select className="input" value={form.category}
            onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="label">标题</label>
      <input className="input" required value={form.title}
        onChange={(e) => set('title', e.target.value)} placeholder="文章标题" />

      <label className="label">简介</label>
      <textarea className="input" rows={2} required value={form.description}
        onChange={(e) => set('description', e.target.value)} placeholder="一两句话介绍这篇文章" />

      <label className="label">标签（逗号分隔）</label>
      <input className="input" value={form.tags.join(', ')}
        onChange={(e) => set('tags', e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))}
        placeholder="Astro, 教程" />

      <label className="label">正文（Markdown）</label>
      <textarea className="input font-mono text-sm" rows={14} required value={form.content}
        onChange={(e) => set('content', e.target.value)} placeholder="## 标题&#10;&#10;正文内容…" />

      <label className="mt-4 flex items-center gap-2 text-sm text-warm-800/70 cursor-pointer">
        <input type="checkbox" checked={form.draft}
          onChange={(e) => set('draft', e.target.checked)} />
        存为草稿（draft，不对外发布）
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex gap-3">
        <button disabled={busy} className="btn-primary">{busy ? '提交中…' : '发布 / 更新'}</button>
      </div>
    </form>
  );
}

export default App;
