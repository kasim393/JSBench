# Lightweight JavaScript Editor

## Goal

Build a very small, fast Windows desktop app for writing and running JavaScript.

The app should feel like a lightweight version of RunJS, but with a proper local file/folder manager.

DSA practice is one *example* of what the app is used for — see "Phase 8" — but
the product itself is a general-purpose JavaScript editor, not a DSA-specific tool.

## Tech Stack

- **Tauri 2**
- **Rust** — native/backend functionality
- **Vanilla HTML/CSS/JavaScript** — UI
- **CodeMirror 6** — code editor
- **Node.js** — execute JavaScript files

Do NOT use React, Electron, Monaco, Redux, Tailwind, or other unnecessary frameworks/dependencies.

---

## Core UI

Create a simple dark IDE-like layout:

```text
┌─────────────────────────────────────────────┐
│  JSBench                                 │
├──────────────┬──────────────────────────────┤
│ FILES        │ problem-01.js                │
│              ├──────────────────────────────┤
│ 📁 Arrays    │ 1  const nums = [1,2,3];    │
│   📄 max.js  │ 2                            │
│   📄 sum.js  │ 3  console.log(nums);       │
│              │                              │
│ 📁 Strings   │                              │
│              │                              │
├──────────────┴──────────────────────────────┤
│ ▶ Run    💾 Save                            │
├─────────────────────────────────────────────┤
│ OUTPUT                                      │
│ [1, 2, 3]                                   │
└─────────────────────────────────────────────┘
```

Keep the UI minimal.

---

# Phase 1 — Project Setup

Create a Tauri 2 Windows application.

Requirements:

- Rust backend
- Vanilla JS frontend
- CodeMirror 6
- Development and production builds
- Windows `.exe` installer/build

Verify that the application launches quickly.

---

# Phase 2 — Code Editor

Integrate CodeMirror 6.

Support:

- JavaScript syntax highlighting
- Line numbers
- Bracket matching
- Auto indentation
- Basic autocomplete
- Search
- Keyboard shortcuts
- Dark theme
- Tab indentation

The editor should be the main focus of the application.

---

# Phase 3 — File Explorer

Create a local workspace.

Example — a DSA practice folder (any folder of `.js` files works the same way):

```text
DSA/
├── arrays/
│   ├── max.js
│   ├── min.js
│   └── reverse.js
├── strings/
│   └── palindrome.js
└── README.md
```

Support:

- Open workspace/folder
- Create file
- Create folder
- Rename file
- Delete file
- Open file
- Save file
- Save As
- Refresh file tree

Only allow normal local filesystem operations.

Do not build Git functionality.

---

# Phase 4 — Running JavaScript

When the user clicks **Run**:

1. Save the current file.
2. Execute it using the installed Node.js executable.
3. Capture stdout.
4. Capture stderr.
5. Display the result in the Output panel.

Example:

```js
const nums = [10, 20, 30];

console.log(nums);
```

Output:

```text
[ 10, 20, 30 ]
```

Errors should be clearly displayed:

```text
ReferenceError: x is not defined
```

Use Rust/Tauri to manage the Node.js child process.

---

# Phase 5 — Process Controls

Add:

- Run
- Stop
- Clear output

The Run button should not freeze the UI.

Handle:

- Infinite loops
- Long-running programs
- Process termination
- Node.js errors

Initially use a reasonable execution timeout.

Example:

```text
Run timeout: 10 seconds
```

Make the timeout configurable later.

---

# Phase 6 — Tabs

Add simple editor tabs.

Example:

```text
[max.js] [reverse.js] [sum.js]
```

Requirements:

- Open multiple files
- Switch between files
- Close tab
- Show unsaved indicator

Example:

```text
max.js *
```

`*` means unsaved changes.

---

# Phase 7 — Persistence

Remember:

- Last opened workspace
- Last opened files
- Window size
- Window position
- Selected theme
- Editor settings

Use a small local configuration file.

No database is required.

---

# Phase 8 — Quick Run & Convenience Features

Add small features that make the write → run → read-output loop fast. DSA
practice is the motivating example here, but everything below is useful for
any JavaScript work:

### Quick Run

Keyboard shortcut:

```text
Ctrl + Enter
```

Run current file.

### Format

Implemented with Prettier (standalone build, runs in the webview):

- **Format on save** — enabled by default, toggled from the status bar
  (`Fmt: On/Off`), remembered between launches.
- **Format now** — `Alt + Shift+F` formats the buffer without saving.
- On a syntax error the file is saved unformatted and a warning appears
  in the output panel; formatting never blocks saving.
- Only `.js` files are formatted.

### Input

Eventually support:

```text
INPUT
5
1 2 3 4 5
```

and make it available to the Node.js program through stdin.

Do NOT implement this in the first MVP unless it is easy.

---

# Phase 9 — Portable Mode

The final application should ideally support:

```text
JSBench/
├── jsbench.exe
├── config/
└── workspace/
```

Allow the application to run without requiring installation if practical.

Do not bundle Node.js initially.

Instead:

- Detect installed Node.js.
- Show a clear message if Node.js is missing.
- Allow the user to configure the Node.js executable path.

---

# Important Design Rules

## Keep it lightweight

Avoid:

- React
- Electron
- Monaco
- Redux
- large UI libraries
- database
- Git integration
- extensions/plugins
- terminal emulator
- AI features
- built-in browser
- project build systems

This is NOT supposed to become VS Code.

## Architecture

```text
                Tauri
                  │
        ┌─────────┴─────────┐
        │                   │
      Rust             Web Frontend
        │                   │
        │              HTML/CSS/JS
        │                   │
        │              CodeMirror
        │
   ┌────┴─────────────┐
   │                  │
Filesystem          Node.js
   │                  │
   └────────┬─────────┘
            │
         Output
```

Rust should mainly handle:

- filesystem operations
- spawning Node.js
- process termination
- configuration
- native Windows functionality

The frontend should handle:

- UI
- file tree rendering
- editor
- tabs
- output display
- keyboard shortcuts

---

# Development Order

Build in this exact order:

1. Tauri project
2. Basic UI
3. CodeMirror
4. Open/edit/save `.js`
5. File explorer
6. Run with Node.js
7. Output/error panel
8. Stop process
9. Tabs
10. Persistence
11. Polish
12. Portable Windows build

After every phase, keep the application runnable.

Do not implement future features before the current phase works.

---

# MVP Definition

The MVP is complete when I can:

1. Open the app.
2. Select my workspace folder.
3. See my folders/files.
4. Create a `.js` file.
5. Write JavaScript.
6. Save it.
7. Press `Ctrl + Enter`.
8. See `console.log()` output.
9. See JavaScript errors.
10. Stop an infinite/long-running program.
11. Close and reopen the app and continue where I left off.

Everything else is secondary.
