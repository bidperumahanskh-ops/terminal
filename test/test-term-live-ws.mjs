// Test: live WebSocket terminal session via container (tersedia node_modules ws)
import { execSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('live terminal WS: login, buka shell pty, kirim dir & hermes --version', () => {
  const script = `
const WebSocket = require('ws');

async function run() {
  const pass = process.env.ADMIN_PASSWORD || 'terminalku123';
  const res = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) {
    const text = await res.text();
    throw new Error('gagal login: ' + res.status + ' ' + text);
  }

  const ws = new WebSocket('ws://127.0.0.1:3000/api/terminal', {
    headers: { Cookie: cookie },
  });

  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout. output: ' + output));
    }, 7000);

    ws.on('open', () => {
      setTimeout(() => ws.send(JSON.stringify({ type: 'input', data: 'dir\\r\\n' })), 300);
      setTimeout(() => ws.send(JSON.stringify({ type: 'input', data: 'hermes --version\\r\\n' })), 1200);
      setTimeout(() => ws.send(JSON.stringify({ type: 'input', data: 'exit\\r\\n' })), 2500);
    });

    ws.on('message', (msg) => {
      output += msg.toString();
      if (output.includes('Hermes Agent') && output.includes('new_sipuruh')) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
  });

  console.log('WS_TEST_OK');
}

run().catch(e => { console.error(e); process.exit(1); });
`;

  const out = execSync(`docker exec terminalku node -e "${script.replace(/"/g, '\\"')}"`).toString();
  assert.match(out, /WS_TEST_OK/);
});
