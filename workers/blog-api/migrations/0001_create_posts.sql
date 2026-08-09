-- 博客文章表：slug 为主键，文章为源存储
CREATE TABLE IF NOT EXISTS posts (
  slug TEXT PRIMARY KEY,                  -- URL 标识，如 my-post
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL,                 -- 'YYYY-MM-DD'
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON 数组字符串
  category TEXT NOT NULL DEFAULT '',      -- tech | hiking | essay | ''
  draft INTEGER NOT NULL DEFAULT 0,       -- 0 发布 / 1 草稿
  content TEXT NOT NULL DEFAULT '',       -- Markdown 正文
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_pub_date ON posts(pub_date DESC);
