// Test: kemampuan eksekusi hermes dan fitur copy/blok terminal
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('routes-terminal.js: PATH menyertakan ~/.local/bin dan cwd di /home/adminsipuruh', () => {
  const code = read('server/routes-terminal.js');
  assert.match(code, /\.local\/bin/);
  assert.match(code, /homeDir/);
});

test('container terminalku: hermes dapat dieksekusi dan mengembalikan help', () => {
  const res = execSync(`docker exec terminalku node -e "
import('node-pty').then(pty => {
  const p = pty.spawn('/bin/bash', ['-l'], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: '/home/adminsipuruh',
    env: { ...process.env, PATH: '/home/adminsipuruh/.local/bin:' + process.env.PATH, HOME: '/home/adminsipuruh', USER: 'adminsipuruh' }
  });
  let out = '';
  p.onData(d => out += d);
  p.write('hermes --version\\\\r\\\\n');
  setTimeout(() => {
    p.write('exit\\\\r\\\\n');
    setTimeout(() => {
      process.stdout.write(out);
      process.exit(out.includes('Hermes Agent') ? 0 : 1);
    }, 500);
  }, 1000);
});
"`).toString();
  assert.ok(res.includes('Hermes Agent'));
});

test('app.js & style.css: user-select text dan handler clipboard aktif di xterm', () => {
  const js = read('public/app.js');
  const css = read('public/style.css');
  assert.match(css, /user-select:\s*text/);
  assert.match(js, /hasSelection\(\)/);
  assert.match(js, /getSelection\(\)/);
  assert.match(js, /navigator\.clipboard\.writeText/);
});
