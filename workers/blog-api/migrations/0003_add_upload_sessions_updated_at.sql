-- 0003：upload_sessions 补 updated_at 列
-- 0002 建表时遗漏，uploadPart/complete/abort 均需更新该列（media 与 drive 分片上传共用）
ALTER TABLE upload_sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
