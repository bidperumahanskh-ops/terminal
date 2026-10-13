// Test: ketersediaan coreutils dan shell environment terminalku
import { execSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('container terminalku: binary dir (GNU coreutils) tersedia', () => {
  const out = execSync('docker exec terminalku which dir').toString().trim();
  assert.equal(out, '/usr/bin/dir');
});

test('container terminalku: utilitas standar lengkap (vdir, curl, git, file, nano)', () => {
  const tools = ['vdir', 'curl', 'git', 'file', 'nano'];
  for (const t of tools) {
    const out = execSync(`docker exec terminalku which ${t}`).toString().trim();
    assert.match(out, new RegExp(`/bin/${t}`));
  }
});

test('container terminalku: pty dapat mengeksekusi dir', () => {
  const res = execSync(`docker exec terminalku node -e "
import('node-pty').then(pty => {
  const p = pty.spawn('/bin/bash', ['-l'], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: '/host/home',
    env: { ...process.env, TERM: 'xterm-256color', HOME: '/host/home', USER: 'adminsipuruh' }
  });
  let out = '';
  p.onData(d => out += d);
  p.write('dir\\r\\n');
  setTimeout(() => {
    p.write('exit\\r\\n');
    setTimeout(() => {
      process.stdout.write(out);
      process.exit(out.includes('backup') || out.includes('new_sipuruh') ? 0 : 1);
    }, 300);
  }, 500);
});
"`).toString();
  assert.ok(res.includes('backup') || res.includes('new_sipuruh'));
});
