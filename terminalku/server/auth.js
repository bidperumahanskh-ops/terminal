// Audit log + helper sesi.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, stmt } from './db.js';

export function audit(userId, action, target, ip) {
  try { stmt.audit.run(userId ?? null, action, target ?? null, ip ?? null); } catch { /* jangan gagalkan request */ }
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString();
  stmt.createSession.run(userId, token, expires);
  return token;
}

export function getUserFromToken(token) {
  if (!token) return null;
  stmt.deleteExpiredSessions.run();
  const row = stmt.sessionByToken.get(token);
  return row ? { id: row.user_id, username: row.username, role: row.role, token } : null;
}

export function destroySession(token) {
  if (token) stmt.deleteSession.run(token);
}