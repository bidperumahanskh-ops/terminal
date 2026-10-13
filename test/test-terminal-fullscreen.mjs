// Test: tombol expand / fullscreen terminal
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('index.html: tombol btn-term-expand ada', () => {
  const html = read('public/index.html');
  assert.match(html, /id="btn-term-expand"/);
});

test('style.css: #terminal-panel.fullscreen ada styling fixed full viewport', () => {
  const css = read('public/style.css');
  assert.match(css, /#terminal-panel\.fullscreen\s*{[^}]*position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /z-index:\s*100/);
});

test('app.js: handler toggle fullscreen terdaftar dan mengubah class fullscreen', () => {
  const js = read('public/app.js');
  assert.match(js, /btn-term-expand['"]\)\.addEventListener/);
  assert.match(js, /classList\.toggle\(['"]fullscreen['"]\)/);
  assert.match(js, /fitTerminal/);
});
