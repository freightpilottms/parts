BEGIN;
ALTER TABLE parts_app.users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
UPDATE parts_app.users SET active=false WHERE active AND lower(username) IN ('juso','almin');
DELETE FROM parts_app.sessions WHERE user_id IN (SELECT id FROM parts_app.users WHERE lower(username) IN ('juso','almin'));
INSERT INTO parts_app.users(username,password,must_change) VALUES
  ('Irnes', 'fe644479e322880eedbd786da04f2499:5d4177c12e129d73ba1127a563207f607ed0ba48e14d9a198130ef60341861501d69b1cff6687bdcc1fff40873a87877751476f4d01f4683466228845b161fc7', true),
  ('Alen', 'a506e95d94e5a28ce45716328fae6beb:cd32414ee5c5a24d9e37faf73855a3337aa9ecb7f78eaf3f3f67c70f81cc98d640fc1bd3c160dafc93a40365cfd8f5b69e71ba2159e979316b0f03fb8d1924f4', true)
ON CONFLICT (lower(username)) DO UPDATE SET
  password=CASE WHEN parts_app.users.must_change THEN excluded.password ELSE parts_app.users.password END,
  active=true
WHERE parts_app.users.must_change OR NOT parts_app.users.active;
ALTER TABLE parts_app.photos ADD COLUMN IF NOT EXISTS thumbnail bytea;
COMMIT;
