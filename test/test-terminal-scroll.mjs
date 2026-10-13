// Test: fitur scroll/resize terminal panel (style.css, index.html, app.js)
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('style.css: #terminal-panel punya tinggi + transisi', () => {
  const css = read('public/style.css');
  assert.match(css, /#terminal-panel\s*{[^}]*height:\s*220px/);
  assert.match(css, /#terminal-panel\.tall\s*{\s*height:\s*60vh/);
  assert.match(css, /transition:\s*height/);
});

test('style.css: viewport xterm bisa discroll + scrollbar custom', () => {
  const css = read('public/style.css');
  assert.match(css, /\.xterm-viewport\s*{[^}]*overflow-y:\s*scroll/);
  assert.match(css, /scrollbar-width:\s*thin/);
});

test('index.html: tombol btn-term-size ada', () => {
  const html = read('public/index.html');
  assert.match(html, /id="btn-term-size"/);
});

test('app.js: scrollback > 0 + handler toggle btn-term-size', () => {
  const js = read('public/app.js');
  assert.match(js, /scrollback:\s*\d+/);
  assert.match(js, /btn-term-size['"]\)\.addEventListener/);
  assert.match(js, /classList\.toggle\(['"]tall['"]/);
});
