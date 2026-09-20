ALTER TABLE chat_session ADD COLUMN workflow_type TEXT NOT NULL DEFAULT 'free_chat';
ALTER TABLE chat_session ADD COLUMN target_chapter_id TEXT REFERENCES chapter(id) ON DELETE SET NULL;
ALTER TABLE chat_session ADD COLUMN stage TEXT;
ALTER TABLE chat_session ADD COLUMN outline_id TEXT;
ALTER TABLE chat_session ADD COLUMN outline_version INTEGER;
