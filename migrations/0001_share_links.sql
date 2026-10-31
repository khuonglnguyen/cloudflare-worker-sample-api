-- Public, expiring links to a single R2 object.
CREATE TABLE IF NOT EXISTS share_links (
	id TEXT PRIMARY KEY,
	owner_sub TEXT NOT NULL,
	object_key TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_links_expires_at ON share_links (expires_at);
CREATE INDEX IF NOT EXISTS idx_share_links_owner ON share_links (owner_sub);
