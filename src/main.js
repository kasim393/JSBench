import { invoke } from "@tauri-apps/api/core";
import { EditorState } from "@codemirror/state";
import { createEditor, baseExtensions, setHandlers } from "./editor.js";

const $ = (id) => document.getElementById(id);
const editorEl = $("editor");
const outputEl = $("output");
const treeEl = $("tree");
const tabsEl = $("tabs");

// ---------- state ----------
let view; // CodeMirror instance
let workspace = null;
let tabs = []; // { path, name, dirty, state }
let activeTab = -1;
let running = false;
let currentRunId = null;

function activeFile() {
  return activeTab >= 0 ? tabs[activeTab] : null;
}

// ---------- output ----------
function appendOutput(text, cls = "ok") {
  const span = document.createElement("span");
  span.className = cls;
  span.textContent = text;
  outputEl.appendChild(span);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function clearOutput() {
  outputEl.innerHTML = "";
}

// ---------- run / stop ----------
async function runCurrent() {
  const tab = activeFile();
  if (!tab || running) return;
  await saveCurrent(false);
  appendOutput(`▸ Running ${tab.name}...\n`, "sys");
  running = true;
  $("btn-run").disabled = true;
  $("btn-stop").disabled = false;
  try {
    currentRunId = await invoke("run_js", { path: tab.path, timeoutMs: 10000 });
  } catch (e) {
    appendOutput(`${e}\n`, "err");
    running = false;
    $("btn-run").disabled = false;
    $("btn-stop").disabled = true;
  }
}

async function stopRun() {
  try {
    await invoke("stop_js");
    appendOutput("▸ Stop requested.\n", "sys");
  } catch (e) {
    appendOutput(`${e}\n`, "err");
  }
}

// streaming events (Phase 5)
async function setupRunEvents() {
  const { listen } = await import("@tauri-apps/api/event");
  await listen("run-output", (event) => {
    const { stream, text } = event.payload;
    appendOutput(text, stream === "stderr" ? "err" : "ok");
  });
  await listen("run-exit", (event) => {
    const { code, duration_ms, timed_out } = event.payload;
    if (timed_out) {
      appendOutput(`▸ Timeout: process killed after ${(duration_ms / 1000).toFixed(1)}s\n`, "err");
    } else if (code === -2) {
      appendOutput("▸ Stopped by user.\n", "sys");
    } else {
      appendOutput(`▸ Exited with code ${code ?? 0} (${duration_ms}ms)\n`, "sys");
    }
    running = false;
    currentRunId = null;
    $("btn-run").disabled = false;
    $("btn-stop").disabled = true;
  });
}

// ---------- tabs ----------
function renderTabs() {
  tabsEl.innerHTML = "";
  tabs.forEach((tab, i) => {
    const el = document.createElement("div");
    el.className = "tab" + (i === activeTab ? " active" : "");
    const label = document.createElement("span");
    label.textContent = tab.name + (tab.dirty ? " *" : "");
    el.appendChild(label);
    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "×";
    close.onclick = (e) => { e.stopPropagation(); closeTab(i); };
    el.appendChild(close);
    el.onclick = () => switchTab(i);
    tabsEl.appendChild(el);
  });
}

async function openFile(path) {
  const existing = tabs.findIndex((t) => t.path === path);
  if (existing >= 0) { switchTab(existing); return; }
  const content = await invoke("read_file", { path });
  const name = path.split(/[\\/]/).pop();
  const state = EditorState.create({ doc: content, extensions: baseExtensions() });
  tabs.push({ path, name, dirty: false, state });
  switchTab(tabs.length - 1);
  saveSession();
}

function switchTab(i) {
  // stash current state (scroll, selection, history preserved by CM state)
  const cur = activeFile();
  if (cur) cur.state = view.state;
  activeTab = i;
  view.setState(tabs[i].state);
  view.focus();
  renderTabs();
}

function closeTab(i) {
  tabs.splice(i, 1);
  if (activeTab >= tabs.length) activeTab = tabs.length - 1;
  const cur = tabs[activeTab];
  if (cur) switchTab(activeTab);
  else {
    activeTab = -1;
    view.setState(EditorState.create({ doc: "", extensions: baseExtensions() }));
  }
  renderTabs();
  saveSession();
}

// ---------- save ----------
async function saveCurrent(refresh = true) {
  const tab = activeFile();
  if (!tab) return;
  const content = view.state.doc.toString();
  await invoke("write_file", { path: tab.path, content });
  tab.dirty = false;
  renderTabs();
  if (refresh) appendOutput(`▸ Saved ${tab.name}\n`, "sys");
}

// ---------- file tree (VS Code style) ----------
const expanded = new Set(); // normalized paths of expanded folders
let sidebarWidth = 260;

const ICONS = {
  folderClosed: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#d7a55b" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 3.5c0-.6.4-1 1-1h3l1.2 1.4H13c.6 0 1 .4 1 1v5.6c0 .6-.4 1-1 1h-10.5c-.6 0-1-.4-1-1v-7z"/></svg>`,
  folderOpen: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#d7a55b" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5c0-.6.4-1 1-1h3l1.2 1.4H13c.6 0 1 .4 1 1v1H1.5v-2.4z" fill="#d7a55b" fill-opacity="0.25"/><path d="M1.5 6.4h12.5l-1 4.2c-.1.5-.5.9-1 .9H3c-.6 0-1-.4-1-1l-.5-4.1z"/></svg>`,
  file: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#f0db4f" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5L12.5 5v9.5H4z"/><path d="M9 1.5V5h3.5"/></svg>`,
};

// chevron-right: rotates 90° via CSS when the folder is expanded
const ICON_TWISTY = `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>`;

// swap the folder icon between closed/open glyphs
function setFolderIcon(el, open) {
  const icon = el.querySelector(":scope > .row .icon");
  if (icon) icon.innerHTML = open ? ICONS.folderOpen : ICONS.folderClosed;
}
function joinPath(dir, name) {
  return dir.replace(/[\\/]+$/, "") + "\\" + name;
}
function autofitSidebar(force = false) {
  const panel = document.getElementById("file-tree");
  if (!panel || panel.classList.contains("hidden")) return;
  if (panel.dataset.manual === "1" && !force) return;
  const tree = document.getElementById("tree");
  // temporarily remove ellipsis so rows measure to their full filename width
  tree.classList.add("measuring");
  const rows = [...tree.querySelectorAll(".row")];
  let widest = 0;
  for (const r of rows) {
    // row width with its current indent + full filename
    const w = r.offsetLeft + r.scrollWidth;
    if (w > widest) widest = w;
  }
  tree.classList.remove("measuring");
  const need = Math.min(520, Math.max(180, widest + 18));
  sidebarWidth = need;
  panel.style.width = need + "px";
}


function normPath(p) {
  return (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function rowDepth(path) {
  const ws = normPath(workspace);
  const rel = normPath(path).slice(ws.length).replace(/^\/+/, "");
  return Math.max(0, rel.split("/").filter(Boolean).length - 1);
}

async function ensureExpanded(el, path) {
  // tolerate stale DOM (nodes rendered before the children-container change):
  // make sure a .children container exists, then fill + show it
  if (!el.querySelector(":scope > .children")) {
    const fresh = document.createElement("div");
    fresh.className = "children";
    el.appendChild(fresh);
  }
  return toggleFolder(el, path, true);
}

async function toggleFolder(el, path, expandOnly = false) {
  const wrap = el.querySelector(":scope > .children");
  const show = async (w) => {
    el.classList.add("expanded");
    expanded.add(normPath(el.dataset.path));
    setFolderIcon(el, true);
    if (!w.dataset.loaded) {
      try {
        const entries = await invoke("list_dir", { path });
        entries.sort((x, y) => {
          const xd = x.isDir ?? x.is_dir ?? false;
          const yd = y.isDir ?? y.is_dir ?? false;
          if (xd !== yd) return xd ? -1 : 1;
          return x.name.toLowerCase().localeCompare(y.name.toLowerCase());
        });
        entries.forEach((item) => makeItem(item, w));
        w.dataset.loaded = "1";
      } catch (e) { appendOutput(e + "\n", "err"); }
    }
    autofitSidebar(false);
  };
  if (wrap) {
    if (el.classList.contains("expanded") && !expandOnly) {
      el.classList.remove("expanded");
      expanded.delete(normPath(el.dataset.path));
      setFolderIcon(el, false);
      autofitSidebar(false);
    } else { await show(wrap); }
    return wrap;
  }
  return null;
}
function makeItem(item, parent) {
  const isDir = item.isDir ?? item.is_dir ?? false;
  const el = document.createElement("div");
  el.className = "node" + (isDir ? " folder" : " file");
  el.dataset.path = item.path;
  const row = document.createElement("div");
  row.className = "row";
  row.style.paddingLeft = (rowDepth(item.path) * 12 + 6) + "px";
  const twisty = document.createElement("span");
  twisty.className = "twisty";
  twisty.innerHTML = isDir ? ICON_TWISTY : "";
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.innerHTML = isDir ? ICONS.folderClosed : ICONS.file;
  const fname = document.createElement("span");
  fname.className = "fname";
  fname.textContent = item.name;
  if (!isDir) fname.title = item.path;
  row.append(twisty, icon, fname);
  el.appendChild(row);
  if (isDir) {
    const kids = document.createElement("div");
    kids.className = "children";
    el.appendChild(kids);
  }
  row.onclick = (e) => {
    e.stopPropagation();
    if (isDir) { toggleFolder(el, item.path); }
    else {
      treeEl.querySelectorAll(".row").forEach((x) => x.classList.remove("selected"));
      row.classList.add("selected");
      openFile(item.path);
    }
  };
  row.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showCtxMenu(e.clientX, e.clientY, { ...item, isDir });
  };
  parent.appendChild(el);
  return el;
}
function showCtxMenu(x, y, item) {
  closeCtxMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  const mk = (label, fn, danger = false) => {
    const it = document.createElement("div");
    it.className = "ctx-item" + (danger ? " danger" : "");
    it.textContent = label;
    it.onclick = () => { closeCtxMenu(); fn(); };
    menu.appendChild(it);
  };
  if (!item.isDir) mk("Open", () => openFile(item.path));
  if (item.isDir) {
    mk("New file here", () => promptNew("file", item.path));
    mk("New folder here", () => promptNew("folder", item.path));
  }
  mk("Rename", () => renameEntry(item));
  mk("Delete", () => deleteEntry(item), true);
  document.body.appendChild(menu);
  menu.style.left = Math.min(x, window.innerWidth - 140) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 120) + "px";
  setTimeout(() => document.addEventListener("click", closeCtxMenu, { once: true }), 0);
}

function closeCtxMenu() {
  document.querySelectorAll(".ctx-menu").forEach((m) => m.remove());
}

async function renameEntry(item) {
  const newName = prompt("New name:", item.name);
  if (!newName || newName === item.name) return;
  const parentDir = item.path.slice(0, item.path.length - item.name.length);
  try {
    await invoke("rename_entry", { oldPath: item.path, newPath: joinPath(parentDir, newName) });
    // retarget any open tab
    const tab = tabs.find((t) => t.path === item.path);
    if (tab) {
      tab.path = joinPath(parentDir, newName);
      tab.name = newName;
      renderTabs();
      if (activeTab >= 0 && tabs[activeTab] === tab) switchTab(activeTab);
    }
    refreshTree();
  } catch (e) {
    appendOutput(`${e}\n`, "err");
  }
}

async function deleteEntry(item) {
  if (!confirm(`Delete ${item.isDir ? "folder" : "file"} "${item.name}"?`)) return;
  try {
    await invoke("delete_entry", { path: item.path });
    // close any open tab pointing to it
    for (let i = tabs.length - 1; i >= 0; i--) {
      if (tabs[i].path === item.path || tabs[i].path.startsWith(item.path + "\\")) closeTab(i);
    }
    refreshTree();
  } catch (e) {
    appendOutput(`${e}\n`, "err");
  }
}

async function promptNew(type, parentDir = null) {
  const dir = parentDir ?? workspace;
  if (!dir) { appendOutput("▸ Open a folder first.\n", "sys"); return; }
  const existing = treeEl.querySelector(".new-input");
  if (existing) existing.remove();

  const input = document.createElement("input");
  input.className = "new-input";
  input.placeholder = type === "file" ? "name.js" : "folder-name";
  // If creating inside a subfolder, expand it and place input under it
  let holder = treeEl;
  if (parentDir) {
    const hostEl = treeEl.querySelector('.node[data-path="' + CSS.escape(dir) + '"]');
    if (hostEl) holder = (await ensureExpanded(hostEl, dir)) ?? treeEl;
  }
  (holder ?? treeEl).prepend(input);

  let settled = false; // guards against blur removing input during commit

  const commit = async () => {
    if (settled) return;
    settled = true;
    const name = input.value.trim();
    input.remove();
    if (!name) return;
    try {
      if (type === "file") await invoke("create_file", { path: joinPath(dir, name) });
      else await invoke("create_folder", { path: joinPath(dir, name) });
      appendOutput(`▸ Created ${name}\n`, "sys");
      refreshTree();
      if (type === "file") openFile(joinPath(dir, name));
    } catch (e) {
      appendOutput(`${e}\n`, "err");
    }
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    input.remove();
  };

  input.onkeydown = (e) => {
    e.stopPropagation(); // keep CM/global shortcuts from eating the keystroke
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") cancel();
  };
  // only treat as cancel if focus moved elsewhere while still editing
  input.onblur = () => { if (!settled && document.activeElement !== input) setTimeout(() => { if (!settled) cancel(); }, 100); };

  // focus after layout settles (WebView2 steals the first focus)
  requestAnimationFrame(() => input.focus());
}

async function refreshTree() {
  if (!workspace) return;
  treeEl.innerHTML = "";
  try {
    const entries = await invoke("list_dir", { path: workspace });
    entries.sort((x, y) => {
      const xd = x.isDir ?? x.is_dir ?? false;
      const yd = y.isDir ?? y.is_dir ?? false;
      if (xd !== yd) return xd ? -1 : 1;
      return x.name.toLowerCase().localeCompare(y.name.toLowerCase());
    });
    entries.forEach((item) => makeItem(item, treeEl));
    for (const p of [...expanded]) {
      const nodes = [...treeEl.querySelectorAll(".node.folder")];
      const el = nodes.find((n) => normPath(n.dataset.path) === p);
      if (el) await ensureExpanded(el, el.dataset.path);
    }
    autofitSidebar(true);
  } catch (e) {
    appendOutput(e + "\n", "err");
  }
}
function saveSession() {
  if (!workspace) return;
  invoke("save_session", {
    openFiles: tabs.map((t) => t.path),
    activeFile: activeFile()?.path ?? "",
  }).catch(() => {});
}

// ---------- global shortcuts (VS Code style) ----------
const BASE_EDITOR_FONT = 13.5; // px — matches :root default in style.css
const BASE_OUTPUT_FONT = 12;   // px — matches :root default in style.css
const FONT_SCALE_MIN = 0.6;
const FONT_SCALE_MAX = 2.4;
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_KEY = "jsbench.fontScale";

let fontScale = 1;
try {
  const saved = parseFloat(localStorage.getItem(FONT_SCALE_KEY));
  if (Number.isFinite(saved)) fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, saved));
} catch { /* storage unavailable */ }

function applyFontScale() {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-size", parseFloat((BASE_EDITOR_FONT * fontScale).toFixed(2)) + "px");
  root.style.setProperty("--output-font-size", parseFloat((BASE_OUTPUT_FONT * fontScale).toFixed(2)) + "px");
}

let fontScaleSaveTimer = 0;
function changeFontScale(delta) {
  fontScale = Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, fontScale + delta)) * 10) / 10;
  applyFontScale();
  // debounce so holding the key doesn't spam storage writes
  clearTimeout(fontScaleSaveTimer);
  fontScaleSaveTimer = setTimeout(() => {
    try { localStorage.setItem(FONT_SCALE_KEY, String(fontScale)); } catch { /* ignore */ }
  }, 300);
}

function resetFontScale() {
  fontScale = 1;
  applyFontScale();
  try { localStorage.setItem(FONT_SCALE_KEY, "1"); } catch { /* ignore */ }
}

applyFontScale(); // apply persisted size before the editor is created

function toggleSidebar() {
  $("file-tree").classList.toggle("hidden");
  const resizer = $("sidebar-resizer");
  if (resizer) resizer.classList.toggle("hidden");
}

// registered in the capture phase so these win over CodeMirror's own keymap
window.addEventListener("keydown", (e) => {
  if (e.isComposing || e.altKey || (!e.ctrlKey && !e.metaKey)) return;
  const key = e.key.toLowerCase(); // "+" / "-" / "=" unaffected; handles CapsLock
  let handled = true;
  if (key === "b") toggleSidebar();                                          // Ctrl+B — toggle sidebar
  else if (key === "j") clearOutput();                                       // Ctrl+J — clear output
  else if (key === "+" || key === "=") changeFontScale(FONT_SCALE_STEP);     // Ctrl+= / Ctrl++ — bigger font
  else if (key === "-" || key === "_") changeFontScale(-FONT_SCALE_STEP);    // Ctrl+- — smaller font
  else if (key === "0") resetFontScale();                                    // Ctrl+0 — reset font size
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

// ---------- init ----------
async function init() {
  await setupRunEvents();

  view = createEditor(editorEl, {
    onRun: runCurrent,
    onSave: () => saveCurrent(),
    onChange: () => {
      const tab = activeFile();
      if (tab && !tab.dirty) { tab.dirty = true; renderTabs(); }
    },
  });

  $("btn-run").onclick = runCurrent;
  $("btn-stop").onclick = stopRun;
  $("btn-save").onclick = () => saveCurrent();
  $("btn-clear").onclick = clearOutput;
  $("btn-new-file").onclick = () => promptNew("file");
  $("btn-new-folder").onclick = () => promptNew("folder");
  $("btn-refresh").onclick = refreshTree;
  const panel = $("file-tree");
  const resizer = $("sidebar-resizer");
  panel.style.width = sidebarWidth + "px";
  $("btn-sidebar").onclick = toggleSidebar;
  if (resizer) {
    resizer.onmousedown = (e) => {
      e.preventDefault();
      panel.dataset.manual = "1";
      const startX = e.clientX, startW = panel.offsetWidth;
      const move = (ev) => {
        sidebarWidth = Math.min(520, Math.max(160, startW + ev.clientX - startX));
        panel.style.width = sidebarWidth + "px";
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    resizer.ondblclick = () => { delete panel.dataset.manual; autofitSidebar(true); };
  }
  $("btn-open-folder").onclick = async () => {
    try {
      const dir = await invoke("open_workspace_dialog");
      if (dir) {
        workspace = dir;
        await invoke("set_workspace", { path: dir });
        appendOutput(`▸ Workspace: ${dir}\n`, "sys");
        refreshTree();
      }
    } catch (e) {
      if (String(e) !== "cancelled") appendOutput(`${e}\n`, "err");
    }
  };

  try {
    const status = await invoke("node_status");
    $("node-status").textContent = status.ok ? `Node: ${status.version}` : "Node.js not found!";
    if (!status.ok) appendOutput("⚠ Node.js not detected. Install Node.js or set its path in config.\n", "err");
  } catch (e) {
    $("node-status").textContent = "Node status unknown";
  }

  try {
    workspace = await invoke("get_workspace");
    if (workspace) {
      appendOutput(`▸ Workspace: ${workspace}\n`, "sys");
      refreshTree();
      // restore session: previously open tabs
      const session = await invoke("get_session");
      const openFiles = session?.open_files ?? [];
      const activeFile = session?.active_file ?? "";
      let restoredActive = -1;
      for (const p of openFiles) {
        try {
          await openFile(p);
          if (p === activeFile) restoredActive = tabs.length - 1;
        } catch { /* file may have been deleted */ }
      }
      if (restoredActive >= 0) switchTab(restoredActive);
      if (openFiles.length) appendOutput(`▸ Restored ${openFiles.length} tab(s)\n`, "sys");
    } else {
      appendOutput("▸ No workspace configured. Click 📂 to open a folder.\n", "sys");
    }
  } catch (e) {
    appendOutput(`${e}\n`, "err");
  }

  appendOutput("▸ Ready. Write JS and press Ctrl+Enter to run.\n", "sys");
}

init();

