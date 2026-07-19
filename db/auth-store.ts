type DbValue = string | number | bigint | Uint8Array | null;
type QueryResult = { changes: number };

type AuthDatabase = {
  first<T>(sql: string, params?: DbValue[]): Promise<T | null>;
  run(sql: string, params?: DbValue[]): Promise<QueryResult>;
};

type StoredUser = {
  id: number;
  username: string;
  username_key: string;
  password_hash: string;
  created_at: number;
};

export type AuthenticatedUser = {
  id: number;
  username: string;
};

const CREATE_USERS_SQL = `
  CREATE TABLE IF NOT EXISTS auth_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

const CREATE_SESSIONS_SQL = `
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
  )
`;

const CREATE_SESSION_EXPIRY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON auth_sessions (expires_at)
`;

let databasePromise: Promise<AuthDatabase> | undefined;

function localDatabasePath() {
  return typeof process !== "undefined"
    ? process.env.ZHANGDAN_DB_PATH?.trim()
    : undefined;
}

async function createLocalDatabase(path: string): Promise<AuthDatabase> {
  if (path !== ":memory:") {
    const [{ mkdir }, { dirname }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  }
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec(CREATE_USERS_SQL);
  sqlite.exec(CREATE_SESSIONS_SQL);
  sqlite.exec(CREATE_SESSION_EXPIRY_INDEX_SQL);

  return {
    async first<T>(sql: string, params: DbValue[] = []) {
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async run(sql: string, params: DbValue[] = []) {
      const result = sqlite.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
  };
}

async function createD1Database(): Promise<AuthDatabase> {
  const { env } = await import("cloudflare:workers");
  const d1 = (env as { DB?: D1Database }).DB;
  if (!d1) {
    throw new Error(
      "认证数据库不可用：腾讯云运行时需设置 ZHANGDAN_DB_PATH，Sites 运行时需绑定 D1 DB。",
    );
  }

  await d1.batch([
    d1.prepare(CREATE_USERS_SQL),
    d1.prepare(CREATE_SESSIONS_SQL),
    d1.prepare(CREATE_SESSION_EXPIRY_INDEX_SQL),
  ]);

  return {
    async first<T>(sql: string, params: DbValue[] = []) {
      return d1
        .prepare(sql)
        .bind(...params)
        .first<T>();
    },
    async run(sql: string, params: DbValue[] = []) {
      const result = await d1
        .prepare(sql)
        .bind(...params)
        .run();
      return { changes: Number(result.meta.changes ?? 0) };
    },
  };
}

async function getAuthDatabase() {
  databasePromise ??= localDatabasePath()
    ? createLocalDatabase(localDatabasePath()!)
    : createD1Database();
  return databasePromise;
}

export async function hasAdminUser() {
  const database = await getAuthDatabase();
  const row = await database.first<{ count: number }>(
    "SELECT COUNT(*) AS count FROM auth_users",
  );
  return Number(row?.count ?? 0) > 0;
}

export async function createAdminUser(input: {
  username: string;
  usernameKey: string;
  passwordHash: string;
  createdAt: number;
}) {
  const database = await getAuthDatabase();
  const result = await database.run(
    `INSERT INTO auth_users (username, username_key, password_hash, created_at)
     SELECT ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM auth_users)`,
    [input.username, input.usernameKey, input.passwordHash, input.createdAt],
  );
  if (result.changes !== 1) return null;
  return database.first<StoredUser>(
    "SELECT id, username, username_key, password_hash, created_at FROM auth_users WHERE username_key = ?",
    [input.usernameKey],
  );
}

export async function findUserByUsernameKey(usernameKey: string) {
  const database = await getAuthDatabase();
  return database.first<StoredUser>(
    "SELECT id, username, username_key, password_hash, created_at FROM auth_users WHERE username_key = ?",
    [usernameKey],
  );
}

export async function createSession(input: {
  tokenHash: string;
  userId: number;
  createdAt: number;
  expiresAt: number;
}) {
  const database = await getAuthDatabase();
  await database.run(
    `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
    [input.tokenHash, input.userId, input.createdAt, input.expiresAt],
  );
}

export async function findSessionUser(tokenHash: string, now: number) {
  const database = await getAuthDatabase();
  await database.run("DELETE FROM auth_sessions WHERE expires_at <= ?", [now]);
  return database.first<AuthenticatedUser>(
    `SELECT auth_users.id AS id, auth_users.username AS username
     FROM auth_sessions
     INNER JOIN auth_users ON auth_users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?`,
    [tokenHash, now],
  );
}

export async function deleteSession(tokenHash: string) {
  const database = await getAuthDatabase();
  await database.run("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
}
