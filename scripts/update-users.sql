BEGIN;
ALTER TABLE parts_app.users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
UPDATE parts_app.users SET active=false WHERE active AND lower(username) IN ('juso','almin');
DELETE FROM parts_app.sessions WHERE user_id IN (SELECT id FROM parts_app.users WHERE lower(username) IN ('juso','almin'));
INSERT INTO parts_app.users(username,password,must_change) VALUES
  ('Irnes', 'd8d27e67afc21a55bebdb8e66e8fdf42:89e3896612d40e23c6cb8a201c08ae5376c5a73d1bfe87e2f0f7d9c795e2a75aaed75e942548ceb4e4eb5bd82e58e0eee5e790e5e22e44d2da3942a451484ff5', true),
  ('Alen', '235d8e1b6214bc5ba5ec26ffe3546d05:ae5c6ee778da2aabc70b204cd5fa426471ca121152c18665013e7a5b27b3b0fa83290bd8aaa4378aa3d6ad21f8166defa340aaf0dccc5c247653be02e8b0889c', true)
ON CONFLICT DO NOTHING;
COMMIT;
