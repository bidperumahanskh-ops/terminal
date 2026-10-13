// Test: splitter antar panel (explorer | editor | terminal) bisa digeser user.
// Statis (baca sumber) + fungsional (clamp helper di VM) + live HTTP (aset tersaji).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'terminalku');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const BASE = process.env.TERMINALKU_URL || 'http://100.97.161.68:8364';

// --- ekstraksi blok clamp helper + initSplitters (untuk uji perilaku drag) ---
const SP_START = '// ---------- splitter helper (murni, tanpa DOM) ----------';
const SP_END = '// ---------- akhir splitter helper ----------';
function loadSplitHelpers() {
  const src = read('public/app.js');
  const a = src.indexOf(SP_START);
  const b = src.indexOf(SP_END);
  assert.ok(a >= 0 && b > a, 'blok splitter helper tidak ditemukan di app.js');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src.slice(a, b) + '\nthis.__h = { clampSplitW, clampSplitH, SPLIT_MIN_W, SPLIT_MIN_H };', sandbox);
  return sandbox.__h;
}

// --- harness DOM palsu: cukup untuk menjalankan initSplitters + drag sintetis ---
function makeEl(id) {
  const el = {
    id,
    _ls: {},
    clientHeight: 220,
    _rect: { left: 0, top: 0, width: 300, height: 100 },
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
      getPropertyValue(k) { return this._p[k] || ''; },
    },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._s.has(c) : !!force;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
    },
    addEventListener(t, f) { (this._ls[t] ||= []).push(f); },
    removeEventListener(t, f) { this._ls[t] = (this._ls[t] || []).filter((x) => x !== f); },
    dispatch(t, ev) { (this._ls[t] || []).slice().forEach((f) => f(ev)); },
    setPointerCapture() { throw new Error('InvalidPointerId'); }, // harus ditangkap try/catch app.js
    getBoundingClientRect() { return this._rect; },
  };
  return el;
}

function loadSplitRuntime(preset = {}) {
  const src = read('public/app.js');
  const a = src.indexOf(SP_START);
  const b = src.indexOf('// ---------- Terminal ----------');
  assert.ok(a >= 0 && b > a, 'blok splitter runtime tidak ditemukan di app.js');

  const els = {
    'split-v': makeEl('split-v'),
    'split-h': makeEl('split-h'),
    'terminal-panel': makeEl('terminal-panel'),
    explorer: makeEl('explorer'),
    main: makeEl('main'),
  };
  const store = new Map(Object.entries(preset));
  const calls = { fit: 0, refresh: 0 };
  const sandbox = {
    state: {
      fitTerminal: () => { calls.fit++; },
      editor: { refresh: () => { calls.refresh++; } },
    },
    document: {
      documentElement: makeEl('html'),
      body: makeEl('body'),
    },
    window: { innerWidth: 1200, innerHeight: 900, addEventListener() {} },
    getComputedStyle: () => ({ width: '300px' }),
    requestAnimationFrame: (fn) => fn(),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  sandbox.$ = (sel) => els[String(sel).replace(/^#/, '')];
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(src.slice(a, b) + '\nthis.__r = { initSplitters };', sandbox);
  sandbox.__r.initSplitters();
  return { els, store, calls, sandbox };
}

// pointer event sintetis (button 0 + pointerType mouse agar lolos guard app.js)
const pev = (type, x, y) => ({ type, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, preventDefault() {} });
const drag = (el, from, to) => {
  el.dispatch('pointerdown', pev('pointerdown', from.x, from.y));
  el.dispatch('pointermove', pev('pointermove', to.x, to.y));
  el.dispatch('pointerup', pev('pointerup', to.x, to.y));
};

// ---------- statis: markup ----------
test('index.html: #split-v di dalam main, antara explorer dan editor-panel', () => {
  const html = read('public/index.html');
  assert.match(html, /id="split-v"/);
  const mainStart = html.indexOf('<main>');
  const mainEnd = html.indexOf('</main>', mainStart);
  const main = html.slice(mainStart, mainEnd);
  const v = main.indexOf('id="split-v"');
  assert.ok(v > main.indexOf('id="explorer"'), 'split-v harus setelah #explorer');
  assert.ok(v < main.indexOf('id="editor-panel"'), 'split-v harus sebelum #editor-panel');
});

test('index.html: #split-h di antara main dan panel terminal', () => {
  const html = read('public/index.html');
  assert.match(html, /id="split-h"/);
  assert.ok(html.indexOf('id="split-h"') > html.indexOf('</main>'), 'split-h harus setelah </main>');
  assert.ok(html.indexOf('id="split-h"') < html.indexOf('id="terminal-panel"'), 'split-h harus sebelum #terminal-panel');
});

// ---------- statis: gaya ----------
test('style.css: kolom explorer memakai variabel --explorer-w + gaya splitter', () => {
  const css = read('public/style.css');
  assert.match(css, /grid-template-columns:\s*var\(--explorer-w,\s*300px\)\s+6px\s+1fr/);
  assert.match(css, /\.splitter\s*{[^}]*touch-action:\s*none/);
  assert.match(css, /\.splitter-v\s*{[^}]*cursor:\s*col-resize/);
  assert.match(css, /\.splitter-h\s*{[^}]*cursor:\s*row-resize/);
  assert.match(css, /\.splitter\.dragging/);
  assert.match(css, /body\.split-drag #terminal-panel\s*{\s*transition:\s*none/);
});

// ---------- statis: logika drag ----------
test('app.js: initSplitters dipanggil saat init + drag via pointer events', () => {
  const js = read('public/app.js');
  assert.match(js, /function initSplitters\(/);
  assert.match(js, /init\(\)\s*{[\s\S]{0,120}initSplitters\(\)/);
  assert.match(js, /addEventListener\('pointerdown'/);
  assert.match(js, /setPointerCapture\(/);
  assert.match(js, /bindDrag\(\$\('#split-v'\),\s*'x'/);
  assert.match(js, /bindDrag\(\$\('#split-h'\),\s*'h'/);
  assert.match(js, /addEventListener\('dblclick'/);
});

test('app.js: ukuran panel disimpan di localStorage + dihitung ulang saat geser', () => {
  const js = read('public/app.js');
  assert.match(js, /terminalku\.explorerW/);
  assert.match(js, /terminalku\.termH/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /state\.fitTerminal = fitTerminal/);
  assert.match(js, /state\.editor\.refresh\(\)/);
});

test('app.js: ukuran hasil geser & preset ⇕ tidak saling menimpa', () => {
  const js = read('public/app.js');
  // geser = hapus class .tall + set tinggi inline
  const applyH = js.slice(js.indexOf('function applyH(h, save)'), js.indexOf('// xterm (jumlah kolom/baris)'));
  assert.match(applyH, /classList\.remove\('tall'\)/);
  assert.match(applyH, /panel\.style\.height = lastH \+ 'px'/);
  // tombol ⇕ = lepas tinggi inline agar preset CSS (220px / 60vh) berlaku lagi
  const btn = js.slice(js.indexOf("$('#btn-term-size')"), js.indexOf("window.addEventListener('resize', () => {\n      if ($('#terminal-panel')"));
  assert.match(btn, /classList\.toggle\('tall'/);
  assert.match(btn, /panel\.style\.height = ''/);
});

test('app.js: splitter disembunyikan saat terminal fullscreen', () => {
  const js = read('public/app.js');
  assert.match(js, /\$\('#split-h'\)\.classList\.toggle\('hidden', isFull\)/);
});

// ---------- fungsional: clamp ----------
test('helper: clampSplitW menjaga explorer 160px..(viewport-240)', () => {
  const h = loadSplitHelpers();
  assert.equal(h.clampSplitW(10, 1200), 160, 'di bawah minimum → 160');
  assert.equal(h.clampSplitW(400, 1200), 400, 'nilai wajar dibiarkan');
  assert.equal(h.clampSplitW(9999, 1200), 960, 'maksimum = viewport-240');
  assert.equal(h.clampSplitW(500, 300), 160, 'viewport sempit → minimum, tidak negatif');
  assert.equal(h.clampSplitW(300.4, 1200), 300, 'dibulatkan');
});

test('helper: clampSplitH menjaga terminal 80px..(viewport-160)', () => {
  const h = loadSplitHelpers();
  assert.equal(h.clampSplitH(10, 900), 80, 'di bawah minimum → 80');
  assert.equal(h.clampSplitH(300, 900), 300, 'nilai wajar dibiarkan');
  assert.equal(h.clampSplitH(5000, 900), 740, 'maksimum = viewport-160');
  assert.equal(h.clampSplitH(200, 200), 80, 'viewport sempit → minimum');
});

// ---------- fungsional: perilaku drag (harness DOM palsu) ----------
test('drag #split-v: lebar explorer mengikuti pointer + tersimpan di localStorage', () => {
  const r = loadSplitRuntime();
  drag(r.els['split-v'], { x: 300, y: 50 }, { x: 480, y: 50 });
  assert.equal(r.sandbox.document.documentElement.style.getPropertyValue('--explorer-w'), '480px');
  assert.equal(r.store.get('terminalku.explorerW'), '480');
  // digeser sangat kiri → dijepit ke minimum 160px
  drag(r.els['split-v'], { x: 480, y: 50 }, { x: 40, y: 50 });
  assert.equal(r.sandbox.document.documentElement.style.getPropertyValue('--explorer-w'), '160px');
  assert.equal(r.store.get('terminalku.explorerW'), '160');
});

test('drag #split-h: tinggi terminal mengikuti pointer, lepas preset .tall', () => {
  const r = loadSplitRuntime();
  r.els['terminal-panel'].classList.add('tall');
  drag(r.els['split-h'], { x: 500, y: 680 }, { x: 500, y: 550 }); // 900-550 = 350px
  assert.equal(r.els['terminal-panel'].style.height, '350px');
  assert.equal(r.store.get('terminalku.termH'), '350');
  assert.equal(r.els['terminal-panel'].classList.contains('tall'), false, 'preset .tall harus dilepas');
  // digeser ke bawah melewati batas → dijepit ke minimum 80px
  drag(r.els['split-h'], { x: 500, y: 550 }, { x: 500, y: 895 });
  assert.equal(r.els['terminal-panel'].style.height, '80px');
});

test('drag memicu hitung ulang xterm + refresh CodeMirror', () => {
  const r = loadSplitRuntime();
  assert.equal(r.calls.fit, 0);
  drag(r.els['split-v'], { x: 300, y: 50 }, { x: 420, y: 50 });
  drag(r.els['split-h'], { x: 500, y: 680 }, { x: 500, y: 600 });
  assert.ok(r.calls.fit >= 2, 'fitTerminal dipanggil saat geser');
  assert.ok(r.calls.refresh >= 2, 'editor.refresh dipanggil saat geser');
});

test('ukuran tersimpan dipulihkan saat halaman dibuka lagi', () => {
  const r = loadSplitRuntime({ 'terminalku.explorerW': '420', 'terminalku.termH': '260' });
  assert.equal(r.sandbox.document.documentElement.style.getPropertyValue('--explorer-w'), '420px');
  assert.equal(r.els['terminal-panel'].style.height, '260px');
});

test('klik 2x pada splitter mengembalikan ukuran default', () => {
  const r = loadSplitRuntime({ 'terminalku.explorerW': '420', 'terminalku.termH': '260' });
  r.els['split-v'].dispatch('dblclick', {});
  assert.equal(r.sandbox.document.documentElement.style.getPropertyValue('--explorer-w'), '');
  assert.equal(r.store.has('terminalku.explorerW'), false);
  r.els['split-h'].dispatch('dblclick', {});
  assert.equal(r.els['terminal-panel'].style.height, '');
  assert.equal(r.store.has('terminalku.termH'), false);
});

test('setPointerCapture yang melempar tidak mematikan drag', () => {
  const r = loadSplitRuntime(); // harness selalu melempar InvalidPointerId
  drag(r.els['split-v'], { x: 300, y: 50 }, { x: 500, y: 50 });
  assert.equal(r.sandbox.document.documentElement.style.getPropertyValue('--explorer-w'), '500px');
  assert.equal(r.sandbox.document.body.classList.contains('split-drag'), false, 'kelas drag dibersihkan setelah selesai');
});

// ---------- live: aset yang disajikan server (butuh image sudah di-rebuild) ----------
test('live: halaman tersaji memuat splitter + logika drag', async (t) => {
  let res;
  try { res = await fetch(BASE + '/'); } catch (e) { t.skip('server tidak terjangkau (' + BASE + '): ' + e.message); return; }
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="split-v"/);
  assert.match(html, /id="split-h"/);
  const css = await (await fetch(BASE + '/style.css')).text();
  assert.match(css, /var\(--explorer-w,\s*300px\)/);
  const js = await (await fetch(BASE + '/app.js')).text();
  assert.match(js, /function initSplitters\(/);
});
