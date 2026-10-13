// Terminalku — frontend logic (vanilla JS, tanpa framework).
(() => {
  const $ = (sel) => document.querySelector(sel);
  const fmtSize = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'G' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
  const fmtTime = (ms) => ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '';

  let state = { user: null, cwd: '/', fsRoot: '', items: [], selPath: null, clipboard: null, editor: null, tabs: [], activeTab: null, term: null, ws: null };

  // ---------- API helper ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const isAdmin = () => state.user?.role === 'admin';

  // ---------- Modal (pengganti prompt/confirm/viewer) ----------
  function modal({ title, input = false, textarea = false, value = '', message = '', okText = 'OK', cancelText = 'Batal' }) {
    return new Promise((resolve) => {
      const m = $('#modal');
      $('#modal-title').textContent = title;
      $('#modal-message').textContent = message;
      $('#modal-message').classList.toggle('hidden', !message);
      const inp = $('#modal-input');
      const txt = $('#modal-textarea');
      inp.classList.toggle('hidden', !input);
      txt.classList.toggle('hidden', !textarea);
      if (input) { inp.value = value; inp.focus(); }
      if (textarea) { txt.value = value; txt.focus(); }
      $('#modal-ok').textContent = okText;
      $('#modal-cancel').textContent = cancelText;
      const done = (val) => { m.classList.add('hidden'); resolve(val); };
      $('#modal-ok').onclick = () => done(input ? inp.value : (textarea ? txt.value : true));
      $('#modal-cancel').onclick = () => done(input || textarea ? null : false);
      m.classList.remove('hidden');
    });
  }

  // ---------- Clipboard teks (dipakai terminal + menu klik kanan) ----------
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) { /* diabaikan */ }
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  // ---------- Login ----------
  async function init() {
    initSplitters(); // ukuran panel dipulihkan sebelum app tampil
    try {
      const me = await api('/api/me');
      if (me.ok && me.user) { state.user = me.user; showApp(); }
      else showLogin();
    } catch { showLogin(); }
  }

  function showLogin() {
    $('#login-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
  }

  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#user-info').textContent = `${state.user.username} (${state.user.role})`;
    // Tombol tulis hanya untuk admin
    const writeBtns = ['#btn-new', '#btn-upload', '#btn-save'];
    writeBtns.forEach((s) => $(s).classList.toggle('hidden', !isAdmin()));
    // Mulai dari root yang diizinkan server
    api('/api/fs/root').then((r) => { state.fsRoot = r.root || '/'; loadDir(r.root); }).catch(() => loadDir('/'));
    initTerminal();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('#login-password').value }),
      });
      state.user = data.user;
      showApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* abaikan */ }
    location.reload();
  });

  // ---------- File explorer ----------
  async function loadDir(path) {
    try {
      const data = await api(`/api/fs/list?path=${encodeURIComponent(path)}`);
      state.cwd = data.path;
      $('#current-path').textContent = data.path;
      renderList(data.items);
    } catch (ex) { alert(ex.message); }
  }

  const itemPath = (it) => `${state.cwd}/${it.name}`;
  const selItem = () => (state.items || []).find((it) => itemPath(it) === state.selPath) || null;

  // Path relatif terhadap FS_ROOT (untuk "Copy Relative Path")
  function relPath(abs) {
    const root = String(state.fsRoot || '').replace(/\/+$/, '');
    if (!root) return String(abs || '').replace(/^\/+/, '');
    if (abs === root) return '';
    return abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs;
  }

  function renderList(items) {
    state.items = items;
    const list = $('#file-list');
    list.innerHTML = '';
    for (const it of items) {
      const div = document.createElement('div');
      div.className = `file-item ${it.type}`;
      div.dataset.path = itemPath(it);
      // Tanpa tombol aksi inline — semua modifikasi lewat menu klik kanan
      div.innerHTML = `
        <span class="icon">${it.type === 'dir' ? '📁' : '📄'}</span>
        <span class="name"></span>
        <span class="meta">${it.type === 'dir' ? '' : fmtSize(it.size)}</span>
      `;
      div.querySelector('.name').textContent = it.name;
      div.title = `${it.name}\n${it.type === 'dir' ? 'direktori' : fmtSize(it.size) + ' · ' + fmtTime(it.mtime)}`;
      if (state.selPath === div.dataset.path) div.classList.add('selected');
      if (state.clipboard && state.clipboard.mode === 'move' && state.clipboard.path === div.dataset.path) div.classList.add('cut');
      div.addEventListener('click', () => {
        state.selPath = div.dataset.path;
        applySelectionStyles();
        if (it.type === 'dir') loadDir(itemPath(it));
        else openFile(itemPath(it));
      });
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        state.selPath = div.dataset.path;
        applySelectionStyles();
        openCtxMenu(e.clientX, e.clientY, it);
      });
      list.appendChild(div);
    }
  }

  // Sinkronkan sorotan tanpa membangun ulang daftar
  function applySelectionStyles() {
    for (const el of document.querySelectorAll('#file-list .file-item')) {
      el.classList.toggle('selected', el.dataset.path === state.selPath);
      el.classList.toggle('cut', !!(state.clipboard && state.clipboard.mode === 'move' && state.clipboard.path === el.dataset.path));
    }
  }

  // ---------- Menu klik kanan ----------
  function openCtxMenu(x, y, it) {
    const menu = $('#ctx-menu');
    menu.innerHTML = '';
    const isDir = !!it && it.type === 'dir';
    const clip = state.clipboard;

    const add = (label, key, action, disabled = false) => {
      const el = document.createElement('div');
      el.className = 'ctx-item' + (disabled ? ' disabled' : '');
      const l = document.createElement('span');
      l.className = 'ctx-label';
      l.textContent = label;
      const k = document.createElement('span');
      k.className = 'ctx-key';
      k.textContent = key || '';
      el.append(l, k);
      if (!disabled) el.addEventListener('click', () => { closeCtxMenu(); action(); });
      menu.appendChild(el);
    };
    const sep = () => {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      menu.appendChild(s);
    };

    if (!it) {
      // Klik kanan di area kosong = folder yang sedang dibuka
      add('New File…', '', () => createItem(state.cwd, 'file'), !isAdmin());
      add('New Folder…', '', () => createItem(state.cwd, 'dir'), !isAdmin());
      sep();
      add('Paste', 'Ctrl+V', () => pasteInto(null), !isAdmin() || !clip);
      sep();
      add('Copy Path', '', () => copyToClipboard(state.cwd));
      add('Copy Relative Path', '', () => copyToClipboard(relPath(state.cwd)));
    } else {
      if (isDir) {
        add('New File…', '', () => createItem(itemPath(it), 'file'), !isAdmin());
        add('New Folder…', '', () => createItem(itemPath(it), 'dir'), !isAdmin());
        sep();
      }
      add('Cut', 'Ctrl+X', () => setClipboard(it, 'move'), !isAdmin());
      add('Copy', 'Ctrl+C', () => setClipboard(it, 'copy'));
      add('Paste', 'Ctrl+V', () => pasteInto(it), !isAdmin() || !clip);
      if (!isDir) add('Download…', '', () => downloadItem(it));
      sep();
      add('Copy Path', 'Shift+Alt+C', () => copyToClipboard(itemPath(it)));
      add('Copy Relative Path', 'Ctrl+K Ctrl+Shift+C', () => copyToClipboard(relPath(itemPath(it))));
      sep();
      add('Rename…', 'F2', () => renameItem(it), !isAdmin());
      add('Delete Permanently', 'Del', () => deleteItem(it), !isAdmin());
    }

    // Tampilkan lalu geser bila melewati tepi layar
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  }

  function closeCtxMenu() {
    const menu = $('#ctx-menu');
    menu.classList.add('hidden');
    menu.innerHTML = '';
  }

  // e.target bisa bukan Element (mis. event di document) → jangan panggil closest() langsung
  const asElement = (t) => (t instanceof Element ? t : null);

  document.addEventListener('click', (e) => {
    const el = asElement(e.target);
    if (!el || !el.closest('#ctx-menu')) closeCtxMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });
  window.addEventListener('resize', closeCtxMenu);
  $('#file-list').addEventListener('scroll', closeCtxMenu, { passive: true });
  // Klik kanan di area kosong daftar berkas
  $('#file-list').addEventListener('contextmenu', (e) => {
    if (asElement(e.target)?.closest('.file-item')) return;
    e.preventDefault();
    openCtxMenu(e.clientX, e.clientY, null);
  });

  // ---------- Clipboard berkas (Cut/Copy/Paste) ----------
  function setClipboard(it, mode) {
    state.clipboard = { path: itemPath(it), mode, name: it.name, isDir: it.type === 'dir' };
    state.selPath = itemPath(it);
    applySelectionStyles();
  }

  async function pasteInto(it) {
    const clip = state.clipboard;
    if (!clip || !isAdmin()) return;
    const destDir = it && it.type === 'dir' ? itemPath(it) : state.cwd;
    try {
      const data = await api('/api/fs/paste', {
        method: 'POST',
        body: JSON.stringify({ src: clip.path, destDir, mode: clip.mode }),
      });
      if (clip.mode === 'move') {
        state.clipboard = null;
        renameOpenTab(clip.path, data.path);
      }
      alert(`${clip.mode === 'move' ? 'Dipindahkan' : 'Disalin'} → ${data.name}`);
      loadDir(state.cwd);
    } catch (ex) { alert(ex.message); }
  }

  // Ikuti nama/path baru agar tab yang terbuka tidak menunjuk berkas lama
  function renameOpenTab(fromPath, toPath) {
    const tab = state.tabs.find((t) => t.id === fromPath);
    if (!tab) return;
    tab.id = toPath;
    tab.path = toPath;
    tab.name = toPath.split('/').pop();
    if (state.activeTab === fromPath) {
      state.activeTab = toPath;
      $('#editor-title').textContent = `${toPath} (${fmtSize(tab.size)})`;
    }
    if (state.selPath === fromPath) state.selPath = toPath;
    renderTabs();
  }

  // Pintasan keyboard explorer (Ctrl+C/X/V, F2, Del) — dilewati saat fokus di editor/terminal
  document.addEventListener('keydown', (e) => {
    const t = asElement(e.target);
    if (t && (t.closest('.CodeMirror') || t.closest('#terminal') || t.closest('#ctx-menu'))) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const it = selItem();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      if (it) { e.preventDefault(); setClipboard(it, 'copy'); }
      return;
    }
    if (mod && !e.shiftKey && (e.key === 'x' || e.key === 'X')) {
      if (it && isAdmin()) { e.preventDefault(); setClipboard(it, 'move'); }
      return;
    }
    if (mod && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      if (state.clipboard && isAdmin()) { e.preventDefault(); pasteInto(it && it.type === 'dir' ? it : null); }
      return;
    }
    if (e.key === 'F2') {
      if (it && isAdmin()) { e.preventDefault(); renameItem(it); }
      return;
    }
    if (e.key === 'Delete') {
      if (it && isAdmin()) { e.preventDefault(); deleteItem(it); }
    }
  });

  function downloadItem(it) {
    const filePath = itemPath(it);
    const a = document.createElement('a');
    a.href = `/api/fs/download?path=${encodeURIComponent(filePath)}`;
    a.download = it.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  $('#btn-up').addEventListener('click', () => {
    const parts = state.cwd.split('/').filter(Boolean);
    parts.pop();
    loadDir('/' + parts.join('/'));
  });
  $('#btn-refresh').addEventListener('click', () => loadDir(state.cwd));

  // ---------- Editor + tab (gaya VS Code) ----------
  // Format tampilan berkas (dropdown kanan atas): text editor / markdown preview / markdown editor
  const MD_EXT = new Set(['md', 'markdown', 'mdx']);
  const fileExt = (name) => String(name || '').split('.').pop().toLowerCase();
  const isMarkdown = (name) => MD_EXT.has(fileExt(name));

  // ---------- tab state helper (murni, tanpa DOM) ----------
  // Blok ini diekstrak & diuji oleh ~/terminal/test/test-tabs.mjs.
  // JANGAN ganti penanda akhir blok di bawah.
  const tabId = (p) => String(p || '');
  function findTabIndex(tabs, path) { return tabs.findIndex((t) => t.id === tabId(path)); }
  // Bandingkan isi dokumen dengan isi terakhir yang tersimpan di server
  function isTabDirty(tab) { return !!tab && tab.doc.getValue() !== tab.savedContent; }
  function anyTabDirty(tabs) { return tabs.some((t) => isTabDirty(t)); }
  // Tab yang harus aktif setelah tab pada `index` ditutup (null bila tidak ada sisa)
  function tabCloseTarget(tabs, index) {
    if (tabs.length <= 1) return null;
    return index > 0 ? tabs[index - 1].id : tabs[index + 1].id;
  }
  // ---------- akhir tab state helper ----------

  const activeTab = () => state.tabs.find((t) => t.id === state.activeTab) || null;

  function ensureEditor() {
    if (state.editor) return state.editor;
    state.editor = CodeMirror.fromTextArea($('#editor'), {
      lineNumbers: true,
      readOnly: !isAdmin(),
      theme: 'dracula',
      mode: 'text/plain',
    });
    return state.editor;
  }

  // Perubahan di editor TIDAK dikirim ke server; hanya menandai tab "belum disimpan".
  // Catatan: event 'change' CodeMirror bersifat deferred (dipanggil tick berikutnya),
  // jadi renderTabs() TIDAK boleh dibatasi hanya untuk tab aktif — kalau tidak,
  // tab yang ditinggalkan sebelum event menyala tidak akan pernah ter-tandai.
  function onDocChange(tab, change) {
    if (change && change.origin === 'setValue') return; // setValue programatik saat membuka berkas
    if (tab.id === state.activeTab && tab.viewMode === 'md-preview') renderPreview();
    renderTabs();
  }

  async function openFile(path) {
    const existing = findTabIndex(state.tabs, path);
    if (existing >= 0) { activateTab(state.tabs[existing].id); return; }
    let data;
    try { data = await api(`/api/fs/read?path=${encodeURIComponent(path)}`); }
    catch (ex) { alert(ex.message); return; }
    const tab = {
      id: tabId(data.path),
      path: data.path,
      name: data.name,
      size: data.size,
      markdown: isMarkdown(data.name),
      viewMode: 'text',
      savedContent: data.content,
      doc: CodeMirror.Doc(data.content, guessMode(data.name)),
    };
    tab.doc.on('change', (d, ch) => onDocChange(tab, ch));
    state.tabs.push(tab);
    activateTab(tab.id);
  }

  function activateTab(id) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab) return;
    state.activeTab = id;
    const editor = ensureEditor();
    if (editor.getDoc() !== tab.doc) editor.swapDoc(tab.doc);
    editor.setOption('readOnly', !isAdmin());
    editor.setOption('theme', 'dracula');
    $('#editor-title').textContent = `${tab.path} (${fmtSize(tab.size)})`;
    $('#editor-actions').classList.remove('hidden');
    $('#view-mode').value = tab.viewMode;
    setupViewSelect();
    renderTabs();
    applyViewMode();
  }

  async function closeTab(id) {
    const index = state.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tab = state.tabs[index];
    if (isTabDirty(tab)) {
      const ok = await modal({
        title: `Tutup "${tab.name}" tanpa menyimpan?`,
        message: 'Perubahan yang belum disimpan akan hilang.',
        okText: 'Tutup tanpa simpan',
        cancelText: 'Batal',
      });
      if (!ok) return;
    }
    removeTabSilently(id);
  }

  // Tutup tab tanpa konfirmasi (dipakai setelah berkas dihapus/dipindah)
  function removeTabSilently(id) {
    const index = state.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const wasActive = state.activeTab === id;
    const nextId = tabCloseTarget(state.tabs, index);
    state.tabs.splice(index, 1);
    if (wasActive) {
      if (nextId) activateTab(nextId);
      else clearEditor();
    }
    renderTabs();
  }

  function clearEditor() {
    state.activeTab = null;
    if (state.editor) state.editor.swapDoc(CodeMirror.Doc('', 'text/plain'));
    $('#editor-title').textContent = 'Pilih file untuk melihat isinya';
    $('#editor-actions').classList.add('hidden');
    $('#view-mode').classList.add('hidden');
    $('#editor-panel').classList.remove('preview-on');
    $('#md-preview').classList.add('hidden');
  }

  function renderTabs() {
    const bar = $('#tabs');
    bar.classList.toggle('hidden', state.tabs.length === 0);
    // Bangun ulang hanya bila susunan tab berubah; selain itu cukup sinkronkan status
    if (bar.children.length !== state.tabs.length) return rebuildTabs();
    for (let i = 0; i < state.tabs.length; i++) {
      const tab = state.tabs[i];
      const el = bar.children[i];
      if (el.dataset.tabId !== tab.id) return rebuildTabs();
      const dirty = isTabDirty(tab);
      el.classList.toggle('active', tab.id === state.activeTab);
      el.classList.toggle('dirty', dirty);
      el.title = `${tab.path}${dirty ? ' • belum disimpan' : ''}`;
    }
  }

  function rebuildTabs() {
    const bar = $('#tabs');
    bar.innerHTML = '';
    bar.classList.toggle('hidden', state.tabs.length === 0);
    for (const tab of state.tabs) {
      const dirty = isTabDirty(tab);
      const el = document.createElement('div');
      el.dataset.tabId = tab.id;
      el.className = 'tab' + (tab.id === state.activeTab ? ' active' : '') + (dirty ? ' dirty' : '');
      el.title = `${tab.path}${dirty ? ' • belum disimpan' : ''}`;
      el.innerHTML = '<span class="tab-name"></span><button class="tab-close" title="Tutup tab"><span class="i-dot">●</span><span class="i-x">✕</span></button>';
      el.querySelector('.tab-name').textContent = tab.name;
      el.addEventListener('click', () => activateTab(tab.id));
      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      bar.appendChild(el);
    }
  }

  // Aktifkan dropdown + nonaktifkan opsi markdown untuk berkas non-markdown
  function setupViewSelect() {
    const sel = $('#view-mode');
    if (!sel) return;
    const tab = activeTab();
    const md = !!(tab && tab.markdown);
    sel.classList.remove('hidden');
    for (const opt of sel.options) {
      const isMdOpt = opt.value === 'md-preview' || opt.value === 'md-editor';
      opt.disabled = isMdOpt && !md;
      opt.title = isMdOpt && !md ? 'Hanya untuk berkas Markdown (.md/.markdown/.mdx)' : '';
    }
    if (tab && !md) tab.viewMode = 'text';
    if (tab) sel.value = tab.viewMode;
    applyViewMode();
  }

  function setViewMode(mode) {
    const tab = activeTab();
    if (!tab) return;
    tab.viewMode = mode;
    const sel = $('#view-mode');
    if (sel) sel.value = mode;
    applyViewMode();
  }

  function applyViewMode() {
    const tab = activeTab();
    const preview = !!tab && tab.viewMode === 'md-preview';
    $('#editor-panel').classList.toggle('preview-on', preview);
    $('#md-preview').classList.toggle('hidden', !preview);
    if (!state.editor) return;
    state.editor.setOption('mode', tab && tab.viewMode === 'md-editor' ? 'markdown' : guessMode(tab && tab.name));
    state.editor.setOption('lineWrapping', !!tab && (tab.viewMode === 'md-editor' || tab.markdown));
    if (preview) {
      renderPreview();
    } else {
      setTimeout(() => state.editor.refresh(), 0); // CodeMirror perlu refresh setelah disembunyikan
    }
  }

  function renderPreview() {
    const el = $('#md-preview');
    const tab = activeTab();
    if (!el || !tab) return;
    el.innerHTML = renderMarkdown(tab.doc.getValue());
    el.scrollTop = 0;
  }

  $('#view-mode').addEventListener('change', (e) => setViewMode(e.target.value));

  // Peringatkan bila ada tab belum disimpan saat halaman ditinggalkan
  window.addEventListener('beforeunload', (e) => {
    if (anyTabDirty(state.tabs)) { e.preventDefault(); e.returnValue = ''; }
  });

  function guessMode(name) {
    const ext = fileExt(name);
    const map = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript',
      py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell',
      html: 'htmlmixed', htm: 'htmlmixed', vue: 'htmlmixed',
      css: 'css', scss: 'css', php: 'php', sql: 'sql',
      md: 'markdown', yml: 'yaml', yaml: 'yaml', json: 'json',
      xml: 'xml', svg: 'xml', java: 'text/x-java', c: 'text/x-csrc',
      cpp: 'text/x-c++src', h: 'text/x-csrc', go: 'text/x-go',
      rb: 'text/x-ruby', rs: 'text/x-rustsrc',
    };
    return map[ext] || 'text/plain';
  }

  // ---------- Markdown renderer (mini, tanpa dependensi) ----------
  // Blok ini diekstrak & diuji oleh ~/terminal/test/test-view-mode.mjs.
  // JANGAN ganti penanda akhir blok di bawah.
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Hanya izinkan skema aman (cegah javascript: / data:)
  const safeUrl = (u) => /^(https?:\/\/|mailto:|\/|#|\.\.?\/)/i.test(String(u || '').trim());

  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
        (m, alt, src) => (safeUrl(src) ? `<img src="${src}" alt="${alt}" loading="lazy">` : m))
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
        (m, txt, href) => (safeUrl(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>` : m))
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  const RE_FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
  const RE_HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const RE_UL = /^(\s*)([-*+])\s+(.*)$/;
  const RE_OL = /^(\s*)(\d+)[.)]\s+(.*)$/;
  const RE_TSEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
  const splitRow = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  // Daftar bersarang: bangun <ul>/<ol> dari indentasi
  function renderMdList(items) {
    let html = '';
    let i = 0;
    while (i < items.length) {
      const first = items[i];
      const tag = first.ordered ? 'ol' : 'ul';
      let inner = '';
      while (i < items.length && items[i].indent === first.indent && items[i].ordered === first.ordered) {
        const cur = items[i];
        let j = i + 1;
        while (j < items.length && items[j].indent > cur.indent) j++;
        const sub = j > i + 1 ? renderMdList(items.slice(i + 1, j)) : '';
        inner += `<li>${inlineMd(esc(cur.text))}${sub}</li>`;
        i = j;
      }
      html += `<${tag}>${inner}</${tag}>`;
    }
    return html;
  }

  function renderMarkdown(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (!para.length) return;
      out.push(`<p>${inlineMd(esc(para.join('\n'))).replace(/\n/g, '<br>')}</p>`);
      para = [];
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Blok kode berpagar
      let m = RE_FENCE.exec(line);
      if (m) {
        flush();
        const fence = m[1];
        const lang = m[2];
        const buf = [];
        i++;
        while (i < lines.length && !new RegExp(`^\\s*${fence}\\s*$`).test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre class="md-code"><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }

      if (!line.trim()) { flush(); i++; continue; }
      if (RE_HR.test(line)) { flush(); out.push('<hr>'); i++; continue; }

      m = RE_HEAD.exec(line);
      if (m) { flush(); const lv = m[1].length; out.push(`<h${lv}>${inlineMd(esc(m[2]))}</h${lv}>`); i++; continue; }

      // Kutipan
      if (/^\s*>/.test(line)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
        continue;
      }

      // Tabel: baris header + baris pemisah (---)
      if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && RE_TSEP.test(lines[i + 1])) {
        flush();
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
        out.push('<table class="md-table"><thead><tr>' + head.map((h) => `<th>${inlineMd(esc(h))}</th>`).join('') +
          '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${inlineMd(esc(c))}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>');
        continue;
      }

      // Daftar (bullet & bernomor, bersarang via indentasi)
      if (RE_UL.test(line) || RE_OL.test(line)) {
        flush();
        const items = [];
        while (i < lines.length) {
          const mu = RE_UL.exec(lines[i]);
          const mo = RE_OL.exec(lines[i]);
          if (mu) items.push({ indent: mu[1].length, ordered: false, text: mu[3] });
          else if (mo) items.push({ indent: mo[1].length, ordered: true, text: mo[3] });
          else if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) items[items.length - 1].text += ' ' + lines[i].trim();
          else break;
          i++;
        }
        out.push(renderMdList(items));
        continue;
      }

      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }
  // ---------- akhir markdown renderer ----------

  // Simpan tab aktif ke server (hanya saat diminta: tombol Simpan / Ctrl+S)
  async function saveFile() {
    const tab = activeTab();
    if (!tab || !isAdmin()) return;
    const content = tab.doc.getValue();
    try {
      const data = await api('/api/fs/write', {
        method: 'POST',
        body: JSON.stringify({ path: tab.path, content }),
      });
      tab.savedContent = content;
      renderTabs();
      alert(data.backup ? `Tersimpan. Backup: ${data.backup.split('/').pop()}` : 'Tersimpan.');
      loadDir(state.cwd);
    } catch (ex) { alert(ex.message); }
  }
  $('#btn-save').addEventListener('click', saveFile);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  });

  // Download tab aktif
  $('#btn-download').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab) return;
    const a = document.createElement('a');
    a.href = `/api/fs/download?path=${encodeURIComponent(tab.path)}`;
    a.download = '';
    a.click();
  });

  // ---------- Buat file/folder ----------
  async function createItem(dirPath, type) {
    const label = type === 'dir' ? 'folder' : 'file';
    const name = await modal({ title: `Nama ${label} baru:`, input: true });
    if (!name) return;
    try {
      await api('/api/fs/create', {
        method: 'POST',
        body: JSON.stringify({ path: dirPath, name, type }),
      });
      loadDir(state.cwd);
    } catch (ex) { alert(ex.message); }
  }

  // Tombol ＋ : tanya jenis dulu, lalu nama
  $('#btn-new').addEventListener('click', async () => {
    const asFolder = await modal({ title: 'Buat baru', message: 'Folder atau file?', okText: 'Folder', cancelText: 'File' });
    createItem(state.cwd, asFolder ? 'dir' : 'file');
  });

  // ---------- Upload ----------
  $('#btn-upload').addEventListener('click', () => $('#file-upload-input').click());
  $('#file-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/api/fs/upload', {
          method: 'POST',
          body: JSON.stringify({ path: state.cwd, name: file.name, content: reader.result }),
        });
        loadDir(state.cwd);
      } catch (ex) { alert(ex.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---------- Rename / Hapus (dipakai menu klik kanan) ----------
  async function renameItem(it) {
    const p = itemPath(it);
    const newName = await modal({ title: 'Nama baru:', input: true, value: it.name });
    if (!newName || newName === it.name) return;
    try {
      const data = await api('/api/fs/rename', {
        method: 'POST',
        body: JSON.stringify({ path: p, newName }),
      });
      renameOpenTab(p, data.path);
      if (state.clipboard && state.clipboard.path === p) state.clipboard = null;
      loadDir(state.cwd);
    } catch (ex) { alert(ex.message); }
  }

  async function deleteItem(it) {
    const p = itemPath(it);
    const ok = await modal({
      title: `Hapus permanen ${it.type === 'dir' ? 'folder' : 'file'} "${it.name}"?`,
      message: 'Berkas dihapus dari disk dan tidak bisa dibatalkan.',
      okText: 'Hapus permanen',
      cancelText: 'Batal',
    });
    if (!ok) return;
    try {
      await api('/api/fs/delete', {
        method: 'POST',
        body: JSON.stringify({ path: p }),
      });
      // Tutup tab yang menunjuk berkas/folder terhapus (tanpa konfirmasi)
      for (const tab of state.tabs.filter((t) => t.id === p || t.id.startsWith(`${p}/`))) removeTabSilently(tab.id);
      if (state.selPath === p) state.selPath = null;
      if (state.clipboard && state.clipboard.path === p) state.clipboard = null;
      loadDir(state.cwd);
    } catch (ex) { alert(ex.message); }
  }

  // ---------- splitter helper (murni, tanpa DOM) ----------
  // Batas geser panel: explorer min 160px (editor sisakan 240px),
  // terminal min 80px (area atas/main sisakan 160px).
  const SPLIT_MIN_W = 160, SPLIT_RESERVE_W = 240, SPLIT_MIN_H = 80, SPLIT_MIN_MAIN_H = 160;
  function clampSplitW(w, viewportW) {
    const max = Math.max(SPLIT_MIN_W, viewportW - SPLIT_RESERVE_W);
    return Math.round(Math.min(Math.max(w, SPLIT_MIN_W), max));
  }
  function clampSplitH(h, viewportH) {
    const max = Math.max(SPLIT_MIN_H, viewportH - SPLIT_MIN_MAIN_H);
    return Math.round(Math.min(Math.max(h, SPLIT_MIN_H), max));
  }
  // ---------- akhir splitter helper ----------

  // ---------- Splitter: atur ukuran panel (explorer / editor / terminal) ----------
  // Ukuran disimpan di localStorage browser (bukan server); klik 2x = ukuran default.
  const LS_W = 'terminalku.explorerW';
  const LS_H = 'terminalku.termH';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* mode privat */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (_) { /* mode privat */ } };

  function initSplitters() {
    const root = document.documentElement;
    const mainEl = $('main');
    const panel = $('#terminal-panel');
    const explorer = $('#explorer');
    let lastW = 300, lastH = 220;

    function applyW(w, save) {
      lastW = clampSplitW(w, window.innerWidth);
      root.style.setProperty('--explorer-w', lastW + 'px');
      if (save) lsSet(LS_W, String(lastW));
    }
    function applyH(h, save) {
      lastH = clampSplitH(h, window.innerHeight);
      panel.classList.remove('tall'); // ukuran hasil geser mengalahkan preset tinggi
      panel.style.height = lastH + 'px';
      if (save) lsSet(LS_H, String(lastH));
    }

    // xterm (jumlah kolom/baris) & CodeMirror perlu dihitung ulang setelah panel berubah
    function syncPanels() {
      if (state.fitTerminal) state.fitTerminal();
      if (state.editor) state.editor.refresh();
    }
    let raf = 0;
    function scheduleSync() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; syncPanels(); });
    }

    // Pulihkan ukuran dari sesi sebelumnya (bila ada & masih masuk batas)
    const sw = parseInt(lsGet(LS_W) || '', 10);
    const sh = parseInt(lsGet(LS_H) || '', 10);
    if (sw > 0) applyW(sw, false);
    if (sh > 0) applyH(sh, false);
    lastW = parseFloat(getComputedStyle(explorer).width) || lastW;
    lastH = panel.clientHeight || lastH;

    // bindDrag: pointer events → jalan untuk mouse maupun sentuh (HP)
    function bindDrag(el, axis, posisi) {
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* pointer sudah lepas */ }
        el.classList.add('dragging');
        document.body.classList.add('split-drag');
        document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
        let moved = false;
        const onMove = (ev) => { moved = true; posisi(ev); scheduleSync(); };
        const onEnd = () => {
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onEnd);
          el.removeEventListener('pointercancel', onEnd);
          el.classList.remove('dragging');
          document.body.classList.remove('split-drag');
          document.body.style.cursor = '';
          if (moved) (axis === 'x' ? applyW(lastW, true) : applyH(lastH, true)); // simpan sekali di akhir
          scheduleSync();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onEnd);
        el.addEventListener('pointercancel', onEnd);
      });

      // Klik 2x = kembalikan ukuran default (300px lebar / 220px tinggi)
      el.addEventListener('dblclick', () => {
        if (axis === 'x') { root.style.removeProperty('--explorer-w'); lsDel(LS_W); lastW = 300; }
        else { panel.classList.remove('tall'); panel.style.height = ''; lsDel(LS_H); lastH = 220; }
        scheduleSync();
      });
    }

    bindDrag($('#split-v'), 'x', (e) => applyW(e.clientX - mainEl.getBoundingClientRect().left, false));
    bindDrag($('#split-h'), 'h', (e) => applyH(window.innerHeight - e.clientY, false));

    // Jendela berubah ukuran → rapatkan kembali ukuran panel yang tersimpan
    window.addEventListener('resize', () => {
      if (root.style.getPropertyValue('--explorer-w')) applyW(parseFloat(getComputedStyle(explorer).width) || lastW, false);
      if (panel.style.height) applyH(parseFloat(panel.style.height) || lastH, false);
      scheduleSync();
    });
  }

  // ---------- Terminal ----------
  function initTerminal() {
    if (!isAdmin()) {
      $('#terminal-panel').classList.toggle('hidden', true);
      return;
    }

    function fitTerminal() {
      if (!state.term) return;
      const h = $('#terminal').clientHeight - 8;
      const w = $('#terminal').clientWidth - 8;
      const rows = Math.max(5, Math.floor(h / 17)); // ~17px per baris
      const cols = Math.max(20, Math.floor(w / 8)); // ~8px per karakter
      state.term.resize(cols, rows);
    }
    state.fitTerminal = fitTerminal; // dipakai splitter untuk hitung ulang kolom/baris

    // Toggle fullscreen / satu layar penuh
    $('#btn-term-expand').addEventListener('click', () => {
      const panel = $('#terminal-panel');
      const isFull = panel.classList.toggle('fullscreen');
      $('#split-h').classList.toggle('hidden', isFull); // splitter tak berlaku saat fullscreen
      $('#btn-term-expand').textContent = isFull ? '🗗' : '⛶';
      $('#btn-term-expand').title = isFull ? 'Kembalikan ukuran' : 'Fullscreen / satu layar penuh';
      setTimeout(fitTerminal, 150);
    });

    // Toggle tinggi terminal (kecil/besar); ukuran hasil geser dilepas
    $('#btn-term-size').addEventListener('click', () => {
      const panel = $('#terminal-panel');
      panel.classList.toggle('tall');
      panel.style.height = '';
      lsDel(LS_H);
      setTimeout(fitTerminal, 200);
    });

    window.addEventListener('resize', () => {
      if ($('#terminal-panel').classList.contains('fullscreen')) fitTerminal();
    });

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 10000,
      theme: { background: '#0b0d12', foreground: '#d7dae2' },
    });
    state.term = term;
    term.open($('#terminal'));

    // Dukungan mouse wheel scroll langsung ke terminal
    $('#terminal').addEventListener('wheel', (e) => {
      if (!state.term) return;
      const lines = e.deltaY > 0 ? 3 : -3;
      state.term.scrollLines(lines);
    }, { passive: true });

    // Helper salin teks ke clipboard (mendukung browser modern & fallback)
    function getAllTerminalText() {
      if (!state.term) return '';
      const buf = state.term.buffer.active;
      const lines = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      // Hapus baris kosong di akhir
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      return lines.join('\n');
    }

    // Tombol Salin di header terminal:
    // - Jika ada teks diseleksi: langsung salin teks tersebut
    // - Jika TIDAK ada seleksi: buka popup dialog berisi seluruh output terminal
    //   sehingga user di HP bisa memilih/blok bagian tertentu secara presisi lalu salin!
    $('#btn-term-copy').addEventListener('click', async () => {
      if (!state.term) return;
      const sel = state.term.getSelection();
      if (sel) {
        copyToClipboard(sel);
        const orig = $('#btn-term-copy').textContent;
        $('#btn-term-copy').textContent = '✅ Disalin!';
        setTimeout(() => { $('#btn-term-copy').textContent = orig; }, 1500);
        return;
      }

      // Mode seleksi sebagian di HP: Tampilkan teks di modal textarea
      const allText = getAllTerminalText();
      if (!allText) return;

      await modal({
        title: '📋 Pilih & Salin Teks Terminal',
        textarea: true,
        value: allText,
        message: 'Tahan/blok bagian teks yang ingin disalin di kotak bawah, atau klik "Salin Semua".',
        okText: 'Salin Semua',
        cancelText: 'Tutup',
      }).then((val) => {
        if (val) {
          copyToClipboard(val);
        }
      });
    });

    // Tombol Paste di header terminal (buka prompt/modal jika clipboard API diblokir)
    $('#btn-term-paste').addEventListener('click', async () => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      let pasted = false;
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText) {
            state.ws.send(JSON.stringify({ type: 'input', data: clipText }));
            pasted = true;
          }
        } catch (_) {}
      }
      if (!pasted) {
        // Fallback untuk browser mobile yang blokir akses clipboard langsung
        modal({
          title: '📥 Paste Perintah ke Terminal',
          input: true,
          value: '',
          message: 'Tempel teks perintah di bawah ini lalu tekan Kirim:',
          okText: 'Kirim',
          cancelText: 'Batal',
        }).then((val) => {
          if (val && state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: 'input', data: val }));
          }
        });
      }
    });

    // Auto-salin saat seleksi teks selesai (drag & lepas mouse)
    $('#terminal').addEventListener('mouseup', () => {
      if (term.hasSelection()) {
        const text = term.getSelection();
        copyToClipboard(text);
      }
    });

    // Handle paste via event 'paste' (Ctrl+V / Cmd+V standar & context menu paste)
    $('#terminal').addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData)?.getData('text');
      if (text && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'input', data: text }));
      }
    });

    // Tangani custom key event untuk copy/paste shortcut
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+C atau Cmd+C: Jika ada teks diseleksi, lakukan COPY (jangan kirim SIGINT ^C)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (term.hasSelection()) {
          if (e.type === 'keydown') {
            copyToClipboard(term.getSelection());
          }
          return false; // Jangan kirim sinyal interrupt ke terminal saat ingin copy
        }
        return true; // Jika tidak ada seleksi, teruskan sebagai Ctrl+C biasa (SIGINT)
      }

      // Ctrl+Insert juga shortcut copy standar
      if ((e.ctrlKey || e.metaKey) && e.key === 'Insert') {
        if (term.hasSelection() && e.type === 'keydown') {
          copyToClipboard(term.getSelection());
        }
        return false;
      }

      // Ctrl+V atau Cmd+V (Shift+Insert juga umum di terminal)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (e.type === 'keydown') {
          if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then((text) => {
              if (text && state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'input', data: text }));
              }
            }).catch(() => {});
          }
        }
        return false; // Jangan kirim karakter raw control ke terminal
      }
      if (e.shiftKey && e.key === 'Insert') {
        if (e.type === 'keydown') {
          if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then((text) => {
              if (text && state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'input', data: text }));
              }
            }).catch(() => {});
          }
        }
        return false;
      }
      return true;
    });

    // Izinkan klik kanan untuk salin teks terpilih atau paste bila tidak ada seleksi
    $('#terminal').addEventListener('contextmenu', async (e) => {
      if (term.hasSelection()) {
        const text = term.getSelection();
        copyToClipboard(text);
      } else {
        // Klik kanan tanpa seleksi = paste seperti terminal modern
        if (navigator.clipboard && navigator.clipboard.readText) {
          try {
            const text = await navigator.clipboard.readText();
            if (text && state.ws && state.ws.readyState === WebSocket.OPEN) {
              state.ws.send(JSON.stringify({ type: 'input', data: text }));
            }
          } catch (_) {}
        }
      }
    });

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/terminal`);
    state.ws = ws;

    ws.onopen = () => term.focus();
    ws.onmessage = (ev) => term.write(ev.data);
    ws.onclose = () => term.write('\r\n\x1b[31m[terminal terputus]\x1b[0m\r\n');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
  }

  $('#btn-term-reset').addEventListener('click', () => {
    if (state.ws) state.ws.close();
    if (state.term) state.term.dispose();
    initTerminal();
  });

  init();
})();
