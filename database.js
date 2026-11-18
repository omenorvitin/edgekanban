import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    scrum_enabled INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS board_members (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (board_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS board_invites (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('EDITOR', 'VIEWER')),
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    accepted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS board_columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    wip_limit INTEGER,
    UNIQUE (board_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#18d8e6',
    UNIQUE (board_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS sprints (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    state TEXT NOT NULL CHECK (state IN ('PLANNED', 'ACTIVE', 'COMPLETED')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL REFERENCES board_columns(id),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    due_date TEXT,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    story_points REAL,
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    definition_of_done TEXT NOT NULL DEFAULT '',
    sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS task_labels (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    actor_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_ai_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active_provider TEXT NOT NULL,
    provider_configs TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS board_members_user_idx ON board_members(user_id)',
  'CREATE INDEX IF NOT EXISTS tasks_board_idx ON tasks(board_id)',
  'CREATE INDEX IF NOT EXISTS comments_task_idx ON comments(task_id)',
  'CREATE INDEX IF NOT EXISTS activity_board_idx ON activity_log(board_id, created_at)'
];

let sqlite;
let pool;

export async function initializeDatabase() {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });
    await pool.query('SELECT 1');
    for (const statement of schema) await pool.query(statement);
    return;
  }

  const dataDirectory = process.env.DATA_DIR || path.join(ROOT, 'data');
  const databasePath = process.env.DATABASE_PATH || path.join(dataDirectory, 'edgekanban.sqlite');
  mkdirSync(path.dirname(databasePath), { recursive: true });
  sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const statement of schema) sqlite.exec(statement);
}

function postgresPlaceholders(statement) {
  let index = 0;
  return statement.replace(/\?/g, () => `$${++index}`);
}

export async function query(statement, parameters = []) {
  if (pool) {
    const result = await pool.query(postgresPlaceholders(statement), parameters);
    return { rows: result.rows, changes: result.rowCount || 0 };
  }

  const result = sqlite.prepare(statement).all(...parameters);
  return { rows: result, changes: 0 };
}

export async function get(statement, parameters = []) {
  if (pool) {
    const result = await pool.query(postgresPlaceholders(statement), parameters);
    return result.rows[0] || null;
  }
  return sqlite.prepare(statement).get(...parameters) || null;
}

export async function run(statement, parameters = []) {
  if (pool) {
    const result = await pool.query(postgresPlaceholders(statement), parameters);
    return { changes: result.rowCount || 0 };
  }
  const result = sqlite.prepare(statement).run(...parameters);
  return { changes: Number(result.changes) };
}

export async function closeDatabase() {
  if (pool) await pool.end();
  if (sqlite) sqlite.close();
}
