BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS sanoted_notes (
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    search_text TEXT NOT NULL,
    mutation TEXT,
    PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS sanoted_folders (
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    mutation TEXT,
    PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS sanoted_assets (
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    id TEXT NOT NULL,
    storage_id TEXT NOT NULL UNIQUE,
    ext TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    PRIMARY KEY (owner, note, id)
);
PRAGMA user_version = 23;
COMMIT;
