// Rute autentikasi: login (password saja, rate-limit), logout, me.
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { stmt } from './db.js';
import { audit, createSession, destroySession, getUserFromToken } from './auth.js';

const COOKIE = 'terminalku_session';

export function authRoutes(app) {
  app.post('/api/auth/login', async (req, reply) => {
    const { password } = req.body ?? {};
    const ip = req.ip;
    if (typeof password !== 'string' || !password) {
      return reply.code(400).send({ error: 'password wajib' });
    }

    // Rate-limit per IP: cek kegagalan dalam jendela lock
    const lockWindow = `-${config.loginLockMin} minutes`;
    const fails = stmt.recentFailsByIp.get(ip, lockWindow).c;
    if (fails >= config.loginMaxFail) {
      audit(null, 'login.locked', ip, ip);
      return reply.code(429).send({ error: `terlalu banyak percobaan, coba lagi dalam ${config.loginLockMin} menit` });
    }

    // Cari user admin (user pertama dengan role admin)
    const user = stmt.firstAdmin.get();
    const ok = user && bcrypt.compareSync(password, user.password_hash);
    stmt.recordAttempt.run(ip, ip, ok ? 1 : 0);

    if (!ok) {
      audit(null, 'login.failed', ip, ip);
      return reply.code(401).send({ error: 'password salah' });
    }

    const token = createSession(user.id);
    audit(user.id, 'login.success', user.username, ip);
    reply.setCookie(COOKIE, token, {
      httpOnly: true, sameSite: 'strict', path: '/',
      secure: req.protocol === 'https', maxAge: config.sessionTtlHours * 3600,
    });
    return { ok: true, user: { id: user.id, username: user.username, role: user.role } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const u = getUserFromToken(token);
      destroySession(token);
      audit(u?.id ?? null, 'logout', u?.username ?? null, req.ip);
    }
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const token = req.cookies?.[COOKIE];
    const u = getUserFromToken(token);
    if (!u) return { ok: false, user: null };
    return { ok: true, user: { id: u.id, username: u.username, role: u.role } };
  });
}