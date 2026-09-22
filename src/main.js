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

// ---------- file tree ----------
function joinPath(dir, name) {
  return dir.replace(/[\\/]+$/, "") + "\\" + name;
}

async function ensureExpanded(el, path) {
  let wrap = el.querySelector(":scope > .children");
  if (!wrap) {
    const entries = await invoke("list_dir", { path });
    wrap = document.createElement("div");
    wrap.className = "children";
    entries.forEach((item) => makeItem(item, wrap));
    el.appendChild(wrap);
    el.classList.add("expanded");
    const label = el.querySelector("span");
    if (label) label.textContent = "▾ " + label.textContent.replace(/^[▸▾] /, "");
  }
  return wrap;
}

async function toggleFolder(el, path) {
  const existing = el.querySelector(":scope > .children");
  if (existing) { existing.remove(); el.classList.remove("expanded"); return; }
  el.classList.add("expanded");
  const entries = await invoke("list_dir", { path });
  const wrap = document.createElement("div");
  wrap.className = "children";
  entries.forEach((item) => makeItem(item, wrap));
  el.appendChild(wrap);
}

function makeItem(item, parent) {
  const el = document.createElement("div");
  el.className = "item" + (item.isDir ? " folder" : "");
  const label = document.createElement("span");
  label.textContent = (item.isDir ? "▸ " : "📄 ") + item.name;
  el.appendChild(label);
  el.dataset.path = item.path;
  el.onclick = (e) => {
    e.stopPropagation();
    if (item.isDir) {
      toggleFolder(el, item.path);
      label.textContent = (el.classList.contains("expanded") ? "▾ " : "▸ ") + item.name;
    } else {
      document.querySelectorAll(".tree > .item").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      openFile(item.path);
    }
  };
  el.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showCtxMenu(e.clientX, e.clientY, item);
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

function promptNew(type, parentDir = null) {
  const dir = parentDir ?? workspace;
  if (!dir) { appendOutput("▸ Open a folder first.\n", "sys"); return; }
  const existing = treeEl.querySelector(".new-input");
  if (existing) existing.remove();

  const input = document.createElement("input");
  input.className = "new-input";
  input.placeholder = type === "file" ? "name.js" : "folder-name";
  // If creating inside a subfolder, expand it and place input under it
  const hostEl = parentDir
    ? (document.querySelector(`.item[data-path="${CSS.escape(dir)}"]`) ?? treeEl)
    : treeEl;
  const childrenWrap = parentDir ? ensureExpanded(hostEl, dir) : treeEl;
  childrenWrap.appendChild(input);

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
    entries.forEach((item) => makeItem(item, treeEl));
  } catch (e) {
    appendOutput(`${e}\n`, "err");
  }
}

// ---------- session persistence (Phase 7) ----------
function saveSession() {
  if (!workspace) return;
  invoke("save_session", {
    openFiles: tabs.map((t) => t.path),
    activeFile: activeFile()?.path ?? "",
  }).catch(() => {});
}

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
  $("btn-clear").onclick = () => (outputEl.innerHTML = "");
  $("btn-new-file").onclick = () => promptNew("file");
  $("btn-new-folder").onclick = () => promptNew("folder");
  $("btn-refresh").onclick = refreshTree;
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

