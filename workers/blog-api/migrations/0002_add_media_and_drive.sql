-- 0002：媒体库 + 网盘 数据模型
-- 设计：D1 存元数据，R2 存对象；分片上传用 upload_sessions/upload_parts 跟踪。
-- posts 表扩展（additive，向后兼容）

ALTER TABLE posts ADD COLUMN cover_image TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN content_format TEXT NOT NULL DEFAULT 'markdown';

-- 预留用户表（未来账号体系，本期不启用注册/登录）
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                -- uuid
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',        -- 未来 argon2id 哈希
  role          TEXT NOT NULL DEFAULT 'user',    -- admin | editor | user
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 媒体资源元数据（对象在 R2：media/{YYYY}/{MM}/{uuid}.{ext}）
CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,                  -- uuid
  type        TEXT NOT NULL,                     -- image | video | file
  visibility  TEXT NOT NULL DEFAULT 'public',    -- public（博客用）| private
  mime_type   TEXT NOT NULL,
  extension   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,                           -- 图片宽（可选）
  height      INTEGER,                           -- 图片高（可选）
  duration_ms INTEGER,                           -- 视频时长（可选）
  title       TEXT NOT NULL,                     -- 清洗后的原始文件名
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',        -- JSON 数组字符串
  r2_key      TEXT NOT NULL UNIQUE,              -- 服务端生成的存储键
  sha256      TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT 'admin',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_type       ON media(type);
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media(visibility);
CREATE INDEX IF NOT EXISTS idx_media_created    ON media(created_at DESC);

-- 网盘文件元数据（对象在 R2：drive/{uuid}.{ext}）
CREATE TABLE IF NOT EXISTS drive_files (
  id             TEXT PRIMARY KEY,               -- uuid
  r2_key         TEXT NOT NULL UNIQUE,           -- drive/{uuid}.{ext}
  filename       TEXT NOT NULL,                  -- 展示用文件名（清洗后）
  folder         TEXT NOT NULL DEFAULT '/',      -- 逻辑目录，如 /photos/2026
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  mime_type      TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  sha256         TEXT NOT NULL DEFAULT '',
  uploaded_by    TEXT NOT NULL DEFAULT 'owner',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_drive_folder  ON drive_files(folder);
CREATE INDEX IF NOT EXISTS idx_drive_created ON drive_files(created_at DESC);

-- 分片上传会话（R2 multipart 的元数据跟踪，media 与 drive 共用，scope 区分）
CREATE TABLE IF NOT EXISTS upload_sessions (
  upload_id      TEXT PRIMARY KEY,               -- R2 multipart uploadId
  scope          TEXT NOT NULL,                  -- media | drive
  r2_key         TEXT NOT NULL,
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  folder         TEXT NOT NULL DEFAULT '/',      -- drive 用
  visibility     TEXT NOT NULL DEFAULT 'public', -- media 用
  media_type     TEXT NOT NULL DEFAULT 'file',   -- media 用
  title          TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '[]',     -- JSON 数组字符串
  total_bytes    INTEGER NOT NULL DEFAULT 0,
  part_size      INTEGER NOT NULL DEFAULT 5242880,   -- 默认 5 MiB
  expected_parts INTEGER NOT NULL DEFAULT 0,
  uploaded_parts INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',    -- pending|in_progress|completed|aborted|expired
  target_id      TEXT,                           -- complete 后回填 media/drive_files.id
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at     TEXT NOT NULL                    -- now + 24h
);
CREATE INDEX IF NOT EXISTS idx_upload_status ON upload_sessions(status);

-- 分片记录（支持服务端 complete 与断点续传）
CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id   TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  etag        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (upload_id, part_number)
);
