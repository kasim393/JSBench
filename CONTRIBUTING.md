# Contributing to JSBench

Thanks for your interest! JSBench is intentionally tiny. The best contributions
are ones that respect its scope.

## Philosophy

JSBench is a **lightweight JavaScript editor and runner** — not a VS Code clone.
Before proposing a feature, check `docs/SPEC.md` "Important Design Rules".
Things that will likely be rejected: Git integration, plugins/extensions,
terminal emulator, AI features, built-in browser, large UI frameworks.

## Stack

- Tauri 2 + Rust (backend: fs, processes, config)
- Vanilla HTML/CSS/JS frontend — **no frameworks**
- CodeMirror 6 (bundled with Vite)

## Setup

```bash
git clone <repo>
cd JSBench
npm install
npm run tauri dev     # requires Rust (MSVC) + Node.js
```

## Guidelines

- Keep the release binary small; avoid new dependencies unless necessary
- Rust owns filesystem/process operations; the webview owns UI only
- Every PR must leave the app runnable (`npm run tauri dev`)
- Run `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml`
  before submitting — both must pass without warnings

## Reporting bugs

Include: OS version, Node version, steps to reproduce, and any DevTools console
errors (right-click → Inspect in dev mode).
