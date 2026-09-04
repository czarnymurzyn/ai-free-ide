# AI-Free IDE

A modern code editor for Linux that **makes no network connections** and
**contains no AI features**.

Not "AI disabled by default", and not "telemetry you can opt out of" — the
capability is absent, and network egress is structurally impossible rather than
merely unused. That constraint is enforced in code and covered by tests, in a
live renderer, not just promised in a README.

Everything else still works the way a 2026 IDE should: file tree, tabs, split
panes, a real terminal, project-wide search, Git, and language intelligence —
all sourced from your own machine.

---

## What it does

| | |
|---|---|
| **Editor** | Monaco, with syntax highlighting for ~90 languages, multi-cursor, folding, minimap, bracket colouring, sticky scroll |
| **Files** | Tree with create/rename/delete (to trash) and reveal, live-updating from an inotify watcher |
| **Tabs & splits** | Two editor groups, per-file undo history and scroll position preserved across tab switches |
| **Terminal** | Real PTYs running your login shell — `htop`, `vim` and `less` behave normally |
| **Search** | Project-wide find and replace via ripgrep, streamed as it runs |
| **Git** | Status, gutter marks, stage/unstage, diff, commit, amend, branches, log, stash |
| **Intelligence** | Go-to-definition, hover, completion, rename, references, formatting, code actions, diagnostics — from language servers already on your `PATH` |
| **Workbench** | Command palette, quick-open, keybindings, JSON settings, dark and light themes, session restore |

## What it deliberately does not do

No AI or model-backed completion. No chat panel. No telemetry, crash reporting
or auto-updater. No extension marketplace. No `git push`, `pull`, `fetch` or
`clone`. No documentation links that open a browser. No fonts or icons loaded
from a CDN — they are all bundled or drawn inline.

---

## How the offline guarantee is enforced

Four independent layers, each sufficient on its own for most cases. Layer 1 is
the load-bearing one; the rest exist so that a mistake in any single layer does
not silently open a hole.

1. **Request kill-switch** — `session.webRequest.onBeforeRequest` cancels every
   request whose scheme is not `file:`, `devtools:`, `blob:`, `data:` or
   `about:`. A dependency that tries to phone home is stopped here.
2. **Content-Security-Policy** — served on every response and mirrored in the
   HTML: `connect-src 'none'` removes `fetch`, XHR, WebSocket and EventSource.
3. **Chromium switches** — network prediction, DNS prefetch, safe browsing,
   domain reliability, component updates and the crash reporter are all off.
4. **Permissions & navigation** — every permission request is denied, new
   windows are denied, and navigation to any non-local URL is prevented.

Plus, at the process boundary:

- The renderer runs with `contextIsolation: true`, `sandbox: true` and
  `nodeIntegration: false`. Everything it can do to the machine goes through
  the audited IPC surface in [`src/shared/ipc-contract.ts`](src/shared/ipc-contract.ts).
- Every path from the renderer is re-resolved and checked against the open
  workspace before any syscall touches it ([`src/main/workspace/root.ts`](src/main/workspace/root.ts)).
- Git runs through a single guarded invoker with an **allowlist** of local
  subcommands ([`src/main/git/exec.ts`](src/main/git/exec.ts)). `push`, `pull`,
  `fetch`, `clone` and `remote` fail closed, and there is no IPC channel for
  them at all. Arguments are passed as an array, never through a shell.

### Verifying it yourself

```bash
npm run check:offline   # static audit: no network APIs in src/, no new hosts
npm run test:unit       # asserts the request filter and the git allowlist
npm run test:e2e        # asserts fetch/WebSocket fail inside the live renderer
```

With the app running, `ss -tunp | grep -i electron` should show no outbound
connections while you open files, search, and commit.

---

## Requirements

- Linux x64 (developed and tested on Pop!_OS 24.04 / Ubuntu noble)
- Node 22+ and npm, to build
- `git` — optional; the Source Control view is inert without it
- `ripgrep` — optional; search falls back to a slower built-in walker

## Build and run

```bash
npm install
npm run dev             # development, with hot reload
npm run build && npm start
npm run dist            # AppImage + .deb in release/
```

On Wayland compositors (COSMIC, GNOME, KDE) the app requests native Wayland via
`--ozone-platform-hint=auto`, falling back to XWayland automatically.

## Language servers

The IDE looks for servers on your `PATH` when you open a file, and uses
whatever it finds. **It never downloads anything.** Install them however you
normally would:

```bash
# a few examples — use your own package manager
npm  install -g typescript-language-server typescript
pipx install 'python-lsp-server[all]'
apt  install clangd gopls
```

Servers currently recognised: TypeScript/JavaScript, Pyright, pylsp, Ruff,
clangd, rust-analyzer, gopls, lua-language-server, bash-language-server,
JSON, YAML, HTML, CSS, texlab, jdtls, OmniSharp, zls.

Anything else can be wired up by setting an explicit path under
`lsp.serverPaths` in settings. The **Language Servers** view in the activity
bar shows what was found, where, and whether it is running.

> Note: `typescript-language-server` requires TypeScript 5.x. TypeScript 7 is
> the native port and ships only `tsc` — no `tsserver` — so a 7.x install will
> not drive the language server.

## Settings

`Ctrl+,` opens `~/.config/ai-free-ide/settings.json` in the editor itself.

## Keyboard shortcuts

| | | | |
|---|---|---|---|
| `Ctrl+Shift+P` | Command palette | `Ctrl+P` | Go to file |
| `Ctrl+Shift+F` | Find in files | `Ctrl+F` | Find in file |
| `Ctrl+B` | Toggle sidebar | `` Ctrl+` `` | Toggle terminal |
| `Ctrl+\` | Split editor | `Ctrl+W` | Close editor |
| `F12` | Go to definition | `Shift+F12` | Find references |
| `F2` | Rename symbol | `Ctrl+.` | Quick fix |
| `F8` | Next problem | `Ctrl+Shift+M` | Problems panel |

The full list, always current, is in the command palette.

---

## Architecture

```
src/
  main/       Electron main process — the only code with machine access
    offline.ts        the network kill-switch
    git/exec.ts       the guarded git invoker
    ipc/              fs, pty, search, git, lsp, settings handlers
    lsp/              PATH discovery, JSON-RPC transport, supervision
    workspace/        path jail, inotify watcher
  preload/    contextBridge surface — no Node leakage
  shared/     types, IPC contract, language map, LSP coordinate conversion
  renderer/   React + Monaco UI, zustand stores, command registry
```

Two details worth knowing before changing things:

- **LSP is 0-based, Monaco is 1-based**, on both lines and columns. Every
  crossing goes through [`src/shared/lsp-position.ts`](src/shared/lsp-position.ts),
  which is pure and directly tested — an off-by-one there does not crash, it
  just puts every diagnostic one line off.
- **Monaco's workers are bundled locally.** The usual `getWorkerUrl` pattern
  points at a CDN; here that would be cancelled by the guard and the editor
  would silently degrade to plain highlighting.

## Tests

```bash
npm test        # typecheck + unit + offline audit
npm run test:e2e   # 26 Playwright tests against the built Electron app
npm run test:all   # everything
```

The e2e suite covers real behaviour, not mocks: it edits a file and checks the
bytes on disk, commits and reads `git log`, drives a real
`typescript-language-server` to produce and clear a genuine type error, and
asserts from inside the live renderer that `fetch` and `WebSocket` fail.

## License

MIT
