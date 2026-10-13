// Terminal interaktif via WebSocket (xterm.js ↔ node-pty).
import { spawn } from 'node-pty';
import { config } from './config.js';
import { audit } from './auth.js';

const sessions = new Map(); // token -> { pty, user }

export function terminalWs(app) {
  app.get('/api/terminal', { websocket: true }, (socket, req) => {
    const user = req.user;
    if (!user) { socket.close(4401, 'unauthorized'); return; }
    if (user.role !== 'admin') { socket.close(4403, 'forbidden: butuh role admin'); return; }
    if (sessions.size >= config.termMaxSessions) { socket.close(4429, 'terlalu banyak sesi terminal'); return; }

    const homeDir = '/home/adminsipuruh';
    const userPath = [
      `${homeDir}/.local/bin`,
      `${homeDir}/.hermes/hermes-agent/.hermes/bin`,
      '/usr/local/sbin',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
    ].join(':');

    // Spawn shell host via nsenter agar berada langsung di namespace PID & mount host VPS asli!
    // Ini memberikan shell interaktif adminsipuruh di host (bisa sudo, tailscale, docker, dll)
    const shellArgs = [
      '-t', '1',
      '-m', '-u', '-i', '-n', '-p',
      '--',
      '/bin/su', '-', 'adminsipuruh'
    ];

    const pty = spawn('nsenter', shellArgs, {
      name: 'xterm-256color',
      cols: 80, rows: 24,
      cwd: homeDir,
      env: {
        ...process.env,
        PATH: userPath,
        HOME: homeDir,
        USER: 'adminsipuruh',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const id = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(id, { pty, user });
    audit(user.id, 'terminal.open', id, req.ip);

    pty.onData((data) => { try { socket.send(data); } catch { /* socket tutup */ } });
    pty.onExit(() => { try { socket.close(); } catch { /* sudah tutup */ } sessions.delete(id); });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') pty.write(msg.data ?? '');
        else if (msg.type === 'resize') pty.resize(msg.cols ?? 80, msg.rows ?? 24);
      } catch { /* abaikan pesan tak valid */ }
    });

    socket.on('close', () => {
      try { pty.kill(); } catch { /* sudah mati */ }
      sessions.delete(id);
      audit(user.id, 'terminal.close', id, req.ip);
    });
  });
}