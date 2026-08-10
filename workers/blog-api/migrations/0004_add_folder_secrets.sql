-- 网盘文件夹级加密：folder_secrets
-- 只存储 PBKDF2-SHA256 哈希 + 盐 + 迭代次数，绝不存明文密码。
-- failed_attempts / locked_until 用于防爆破限速（错误密码尝试冷却）。
-- 本迁移仅建表，不包含任何种子数据（密码仅经 API 设置，绝不落 git）。

CREATE TABLE IF NOT EXISTS folder_secrets (
  folder          TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  salt            TEXT NOT NULL,
  iterations      INTEGER NOT NULL DEFAULT 100000,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
