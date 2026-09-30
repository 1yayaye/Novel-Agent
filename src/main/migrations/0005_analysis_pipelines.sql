CREATE TABLE instruction_preset_new (id TEXT PRIMARY KEY, task_type TEXT NOT NULL CHECK(task_type IN ('chat','knowledge','report','continue','rewrite','polish','style_distill','book_summary')), name TEXT NOT NULL, instruction TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO instruction_preset_new SELECT id, task_type, name, instruction, version, created_at, updated_at FROM instruction_preset;
DROP TABLE instruction_preset;
ALTER TABLE instruction_preset_new RENAME TO instruction_preset;
CREATE TABLE task_route_new (id TEXT PRIMARY KEY, task_type TEXT NOT NULL UNIQUE CHECK(task_type IN ('chat','knowledge','report','continue','rewrite','polish','style_distill','book_summary')), connection_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1), updated_at INTEGER NOT NULL);
INSERT INTO task_route_new SELECT id, task_type, connection_id, version, updated_at FROM task_route;
DROP TABLE task_route;
ALTER TABLE task_route_new RENAME TO task_route;
