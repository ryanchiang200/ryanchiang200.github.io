/** 内置的极简管理页：登录 token + 写文章 + 文章列表 + 删除 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>博客文章管理</title>
<style>
  :root {
    --bg: #fefcf8; --card: #fff; --border: #ece4d6;
    --text: #2b2117; --muted: #8a7a66; --accent: #d4844a; --accent-d: #b9682f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; line-height: 1.6; }
  header { background: var(--card); border-bottom: 1px solid var(--border); padding: 16px 0; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 20px; }
  h1 { font-size: 18px; margin: 0; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
  main { padding: 24px 0 60px; }
  .grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
  label { display: block; font-size: 13px; color: var(--muted); margin: 12px 0 4px; }
  input, textarea, select { width: 100%; border: 1px solid var(--border); border-radius: 8px;
         padding: 9px 11px; font-size: 14px; background: #fff; color: var(--text);
         font-family: inherit; }
  textarea { resize: vertical; }
  input:focus, textarea:focus, select:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  @media (max-width: 600px) { .row, .row3 { grid-template-columns: 1fr; } }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .check input { width: auto; }
  button { border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px;
           cursor: pointer; font-family: inherit; }
  .primary { background: var(--accent); color: #fff; }
  .primary:hover { background: var(--accent-d); }
  .ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  .ghost:hover { background: rgba(212,132,74,.1); }
  .danger { background: transparent; color: #c0392b; border: 1px solid #c0392b; }
  .actions { margin-top: 16px; display: flex; gap: 10px; }
  #status { margin-top: 10px; font-size: 13px; min-height: 18px; }
  #status.ok { color: #2e7d32; } #status.err { color: #c0392b; }
  .list { margin-top: 8px; }
  .item { display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .item:hover { background: #f7f1e8; }
  .item .t { font-size: 14px; }
  .item .d { font-size: 12px; color: var(--muted); }
  .item .ops { display: flex; gap: 6px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #f3e6d6; color: var(--accent-d); }
  .empty { color: var(--muted); font-size: 13px; padding: 12px 4px; }
  .tag { font-size: 12px; color: var(--muted); }
  .token-box { display: flex; gap: 8px; margin-bottom: 16px; }
  .token-box input { flex: 1; }
</style>
</head>
<body>
<header><div class="wrap">
  <h1>博客文章管理</h1>
  <div class="sub">写入 GitHub 仓库 <code>src/content/blog/</code>，提交后自动触发构建发布</div>
</div></header>

<main class="wrap">
  <div class="card token-box">
    <input id="token" type="password" placeholder="管理密钥（ADMIN_TOKEN）" />
    <button class="primary" onclick="saveToken()">保存</button>
  </div>

  <div class="grid">
    <div class="card">
      <h2 id="form-title" style="font-size:16px;margin-top:0">写文章</h2>
      <form id="editor">
        <div class="row3">
          <div>
            <label>slug（URL 标识）</label>
            <input id="slug" required pattern="[a-z0-9-]+" placeholder="my-post" />
          </div>
          <div>
            <label>发布日期</label>
            <input id="pubDate" type="date" required />
          </div>
          <div>
            <label>分类</label>
            <select id="category">
              <option value="">（无）</option>
              <option value="tech">技术</option>
              <option value="hiking">登山</option>
              <option value="essay">随笔</option>
            </select>
          </div>
        </div>
        <label>标题</label>
        <input id="title" required placeholder="文章标题" />
        <label>简介</label>
        <textarea id="description" rows="2" required placeholder="一两句话介绍这篇文章"></textarea>
        <label>标签（逗号分隔）</label>
        <input id="tags" placeholder="Astro, 教程" />
        <label>正文（Markdown）</label>
        <textarea id="content" rows="14" required placeholder="## 标题&#10;&#10;正文内容…"></textarea>
        <div class="check">
          <input id="draft" type="checkbox" />
          <label for="draft" style="margin:0">存为草稿（draft）</label>
        </div>
        <div class="actions">
          <button class="primary" type="submit">发布 / 更新</button>
          <button class="ghost" type="button" onclick="resetForm()">清空</button>
        </div>
        <div id="status"></div>
      </form>
    </div>

    <div class="card">
      <h2 style="font-size:16px;margin-top:0">文章列表</h2>
      <div id="list" class="list"><div class="empty">加载中…</div></div>
    </div>
  </div>
</main>

<script>
const API = '';
let currentSlug = '';

function token() { return document.getElementById('token').value; }
function saveToken() {
  localStorage.setItem('admin_token', token());
  status('已保存管理密钥', true);
  loadList();
}
function headers() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() };
}
function status(msg, ok) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
}

async function loadList() {
  const box = document.getElementById('list');
  try {
    const res = await fetch(API + '/api/posts', { headers: headers() });
    if (res.status === 401) { box.innerHTML = '<div class="empty">请先填写管理密钥</div>'; return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const posts = await res.json();
    if (posts.length === 0) { box.innerHTML = '<div class="empty">还没有文章</div>'; return; }
    box.innerHTML = posts.map(p =>
      '<div class="item" onclick="edit(\'' + p.slug + '\')">' +
        '<div><div class="t">' + esc(p.title) + '</div>' +
        '<div class="d">' + p.pubDate + (p.draft ? ' <span class="badge">草稿</span>' : '') + '</div></div>' +
        '<div class="ops">' +
        '<button class="danger" type="button" onclick="event.stopPropagation();del(\'' + p.slug + '\')">删除</button>' +
        '</div>' +
      '</div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
  }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function edit(slug) {
  const res = await fetch(API + '/api/posts/' + slug, { headers: headers() });
  if (!res.ok) { status('读取失败：HTTP ' + res.status, false); return; }
  const data = await res.json();
  currentSlug = data.slug;
  document.getElementById('slug').value = data.slug;
  document.getElementById('title').value = data.title || '';
  document.getElementById('description').value = data.description || '';
  document.getElementById('pubDate').value = data.pubDate || '';
  document.getElementById('tags').value = (data.tags || []).join(', ');
  document.getElementById('category').value = data.category || '';
  document.getElementById('draft').checked = !!data.draft;
  document.getElementById('content').value = data.content || '';
  document.getElementById('form-title').textContent = '编辑文章：' + data.slug;
  window.scrollTo(0, 0);
}

function resetForm() {
  currentSlug = '';
  document.getElementById('editor').reset();
  document.getElementById('slug').value = '';
  document.getElementById('form-title').textContent = '写文章';
  document.getElementById('slug').disabled = false;
}

document.getElementById('editor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    slug: document.getElementById('slug').value.trim(),
    title: document.getElementById('title').value.trim(),
    description: document.getElementById('description').value.trim(),
    pubDate: document.getElementById('pubDate').value,
    tags: document.getElementById('tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    category: document.getElementById('category').value,
    draft: document.getElementById('draft').checked,
    content: document.getElementById('content').value,
  };
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const res = await fetch(API + '/api/posts', {
      method: 'POST', headers: headers(), body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { status(data.error || '提交失败', false); return; }
    status('已发布：' + data.slug, true);
    loadList();
  } catch (err) {
    status('请求失败：' + err.message, false);
  } finally {
    btn.disabled = false;
  }
});

async function del(slug) {
  if (!confirm('确定删除 ' + slug + ' 吗？')) return;
  const res = await fetch(API + '/api/posts/' + slug, {
    method: 'DELETE', headers: headers(),
  });
  if (!res.ok) { status('删除失败：HTTP ' + res.status, false); return; }
  status('已删除：' + slug, true);
  if (currentSlug === slug) resetForm();
  loadList();
}

// 初始化
(function init() {
  const t = localStorage.getItem('admin_token');
  if (t) { document.getElementById('token').value = t; loadList(); }
  document.getElementById('pubDate').value = new Date().toISOString().slice(0, 10);
})();
</script>
</body>
</html>`;
