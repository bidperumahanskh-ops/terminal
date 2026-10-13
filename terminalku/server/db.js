// Inisialisasi SQLite (better-sqlite3) + skema + seed admin awal.
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed admin awal bila tabel users kosong
const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (count === 0) {
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(config.adminUsername, hash, config.adminRole);
  console.log(`[db] user admin awal dibuat: ${config.adminUsername} (${config.adminRole})`);
}

export const stmt = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?'),
  firstAdmin: db.prepare('SELECT * FROM users WHERE role = \'admin\' ORDER BY id LIMIT 1'),
  createSession: db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'),
  sessionByToken: db.prepare('SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')'),
  audit: db.prepare('INSERT INTO audit_logs (user_id, action, target, ip) VALUES (?, ?, ?, ?)'),
  recentFails: db.prepare(`SELECT COUNT(*) AS c FROM login_attempts
    WHERE username = ? AND success = 0 AND created_at > datetime('now', ?)`),
  recentFailsByIp: db.prepare(`SELECT COUNT(*) AS c FROM login_attempts
    WHERE ip = ? AND success = 0 AND created_at > datetime('now', ?)`),
  recordAttempt: db.prepare('INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)'),
};