# dsh-custom-style

English | [中文](./README.md)

Inject your own CSS into the **DeepSeek Harness** web GUI — dialog width, font sizes, colors, spacing, anything —
by editing plain `*.css` files under `$DSH_HOME/dsh-custom-style/`. Saving a file takes effect in about two seconds:
no app patching, no rebuild, no restart.

It also adds a **Custom CSS section inside the DSH settings dialog**, where you can list, edit, create and delete those
files, set dialog width, navigation width, body text size and six other numbers, and open the style folder — so you
never have to leave the app to tune the UI.

- Host half (`index.js`): concatenates `$DSH_HOME/dsh-custom-style/*.css` in filename order and serves it at
  `GET /dsh-custom-style/all.css`. The directory and a starter stylesheet are created on first run; existing files are
  never overwritten. It also serves the settings panel's file API (`/files`, `/file`, `/file/delete`, `/reveal`).
- Browser half (`client.js`): injects that stylesheet into its own `<style data-plugin-css="dsh-custom-style">` element
  and re-fetches it every 2 seconds (paused while the page is hidden), so an edit shows up without a reload. The
  settings section is registered through the client slot API.
- No third-party runtime dependencies: the host half uses `node:` built-ins only, the browser half uses DOM, `fetch`
  and the platform-provided React only. A harness update therefore cannot break it, and user CSS lives outside the
  package so reinstalling never loses it.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Usage](#usage)
- [Stable selectors](#stable-selectors)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Compatibility](#compatibility)
- [License](#license)

## Requirements

- DeepSeek Harness with the web/desktop client (`dsh` 0.2.x). Verified on `0.2.0-rc.2`.
- Node.js `^22.19.0 || >=24.0.0` (only for the optional local installer and the test suites).

## Install

**A. From the plugin catalog / npm** (once this repository is listed):

```sh
dsh plugin add dsh-custom-style
```

There is no build step — `client.js` is hand-written, not bundled — so installing straight from this repository's
source works as well.

**B. From this checkout, for the machine you are on** (what this repository's own installer does):

```powershell
node install.mjs            # preview only (dry run)
node install.mjs --apply    # install into $DSH_HOME/profiles/desktop
```

It registers the plugin in a DSH profile idempotently:

| Location | What it becomes |
|---|---|
| `<profile>/local-plugins/dsh-custom-style` | directory junction → this repository (single source of truth); `--copy` copies files instead |
| `<profile>/node_modules/dsh-custom-style` | directory junction → the entry above |
| `<profile>/package.json` | `dependencies["dsh-custom-style"] = "link:./local-plugins/dsh-custom-style"` plus a `dsh.profile.bundles` entry (backed up first) |
| `$DSH_HOME/dsh-custom-style/00-starter.css` | your stylesheet — written **only** when missing |

Use `--profile web` for a browser-side DSH profile, `--dsh-home <path>` for a non-default `DSH_HOME`.
After installing, **quit and reopen DSH once** (the host half registers its route at startup). Editing CSS never needs a restart again.

## Usage

Open **Settings → Custom CSS**. The section gives you:

| In the panel | What it does |
|---|---|
| Style directory | Shows the folder; “Open folder” launches your file manager (Windows: `explorer`) |
| Style files | Lists every `*.css` with its size; create a new one or delete the selected one |
| Editor | Loads the selected file into a textarea — **Save** writes it and reloads the styles at once |
| Quick settings | Nine numbers — dialog width / height / side margin, nav width, body text size, code size, corner radius, scrollbar width, content centering width — plus **Roomy / Compact / Stock** presets; **Apply** writes `20-quick-settings.css`, and the panel reads those values back when it is reopened |
| Selector reference | Thirteen verified selectors, each with what it controls and an **Insert** button that drops a ready snippet into the editor |
| Reload | Fetches and re-applies the stylesheet immediately instead of waiting for the poll |

Prefer plain files? Edit any `*.css` under `%DSH_HOME%\dsh-custom-style\`
(default `C:\Users\<you>\.dsh\dsh-custom-style\`) — both routes reach the same directory:

```css
/* 01-my-tweaks.css — effective about two seconds after saving */
[data-shortcut-modal="settings"] { width: 1200px !important; }    /* settings dialog width (800px stock) */
[data-shortcut-modal="settings"] nav { width: 220px !important; } /* its left navigation width (188px stock) */
body { --dsh-content-font-size: 15px !important; }                /* conversation body text size */
```

- Filename order decides concatenation order (`00-` first, `99-` last); later rules of equal specificity win.
- `!important` is only needed where a stock rule has the same specificity (the dialog width is one such case).
- Adding, renaming and deleting files all show up on the next poll (≤2 s).
- To keep your styles somewhere else, set `DSH_CUSTOM_STYLE_DIR` to an absolute path — the host half reads that directory instead.

## Stable selectors

Stock class names are build-time hashes (`.wCInkW_panel` today, something else after an update), so prefer hooks that survive.
The same list is inside the settings panel, where **Insert** writes the snippet into the file you are editing.

| Target | Stable selector | Example |
|---|---|---|
| Settings dialog (size, radius, background) | `[data-shortcut-modal="settings"]` | `width: 1200px !important;` |
| Its left navigation | `[data-shortcut-modal="settings"] nav` | `width: 220px !important;` |
| One navigation row | `[data-shortcut-modal="settings"] nav button` | `height: 44px !important;` |
| Any modal (fallback) | `div[role="dialog"][aria-modal="true"]` | `border-radius: 14px !important;` |
| Body text size | token on `body` | `--dsh-content-font-size: 15px !important;` |
| Colors, radii, strokes | `--dsw-*` tokens on `body` | `--dsw-radius-panel: 14px !important;` |
| Dark-mode canvas | `body[data-ds-dark-theme]` | `background: #0f1114 !important;` |
| Scrollbars | `::-webkit-scrollbar` | `width: 10px;` |
| Code blocks and inline code | `pre, code` | `font-size: 12.5px !important;` |
| Other overlays carrying the marker | `[data-shortcut-modal="dialog"]`, `…="shortcut-edit"` | `border-radius: 12px !important;` |
| This plugin's own stylesheet | `style[data-plugin-css="dsh-custom-style"]` | locate your rules in DevTools |

For anything else: pick the element in DevTools → *Copy selector*, and prefer a variant built from `data-*`, `aria-*` or `role`
over one built from hashed class names.

The dialog keeps its own `max-width: calc(100vw - 48px)`, so a wide setting never overflows a narrow window. The flip side:
in a window narrower than *your width + 48 px*, the dialog is already as wide as it can get — widen the DSH window, or shrink
that inset yourself (the panel's **side margin** field does exactly this):

```css
[data-shortcut-modal="settings"] { max-width: calc(100vw - 16px) !important; }
```

### Why some pages still leave the right side empty

The dialog width is only half of it. The shell's content column has no cap of its own (`.…_content{flex:1;min-width:0}`),
but **individual pages cap their own content**, and that cap is what leaves the blank right side. From the shipped bundles
(15 `max-width` rules across the ten `@deepseek-ai/dsh-client-ui-settings-*` packages):

| Page | Capped element | Cap |
|---|---|---|
| Built-in plugins | `.amjGKq_section` | 760px |
| Plugin market tab | `.RotMhW_section` | 760px |
| Models | `._3nPmjq_section` | 720px |
| Our Free Model (third party) | `.ofm_root` / `.ofm_shell` | 1080px / 1120px |
| Pet settings (third party) | inline | 720px |

Two facts decide the fix. First, the shell structure (from the shipped `ui-settings-general` source):

```
div[data-shortcut-modal="settings"]
├─ nav
└─ div.content                 display:flex; flex-direction:column
   ├─ div.header               (actions + close)
   └─ div.options              flex:1; overflow-y:auto; padding:0 24px 24px   ← an ordinary block box
      └─ …                     the slot render layer, then the page's own container
```

`.options` is a plain block box, so `margin-inline: auto` on a capped container splits the leftover space evenly — the
content sits centered instead of hugging the left — and the rule is a no-op for anything not capped. Second, the capped
element is **not** a direct child of `.options` (the slot layer wraps it) and its class name is a build-time hash, so match it
by the stable *suffix*: `_section` for official pages, `_root` / `_shell` / `_wrap` for third-party ones. That is what the
panel's **content centering** field writes: `0` keeps every page's own width and only centers it; a number sets them all to
that width and centers it.

```css
[data-shortcut-modal="settings"] [class*="_options"] > *,
[data-shortcut-modal="settings"] [class*="_section"],
[data-shortcut-modal="settings"] [class*="_root"],
[data-shortcut-modal="settings"] [class*="_shell"],
[data-shortcut-modal="settings"] [class*="_wrap"],
[data-shortcut-modal="settings"] [style*="max-width"] { margin-inline: auto !important; }
```

If you would rather have the content *fill* the dialog than be centered, the reference list in the panel carries a second,
opt-in snippet that adds `max-width: none` to the same selector set. That stretches pages designed around a narrower column
(card grids spreading edge to edge, long lines of text), which is why it is not the default.

## How it works

```
$DSH_HOME/dsh-custom-style/*.css
        │  filename order, one "/* ===== name ===== */" banner per file
        ▼
index.js  (host half)  ──GET /dsh-custom-style/all.css──▶  client.js (browser half)
        │                                                      │
        └─ auto-creates the directory, seeds 00-starter.css     └─ <style data-plugin-css="dsh-custom-style">, polled every 2 s
```

- Route surface: `GET /dsh-custom-style/all.css` (concatenated CSS, `Cache-Control: no-store`),
  `GET /dsh-custom-style/status` and `/files` (JSON: directory, file list, byte count),
  `POST /dsh-custom-style/file` and `/file/delete` (write/delete one `*.css`),
  `POST /dsh-custom-style/reveal` (open the folder), `HEAD` supported, `404`/`405`/`413` otherwise.
- Only `*.css` files directly inside that one directory are read or written; a name must match
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.css` — no caller-supplied paths, so there is no traversal surface. Writes are atomic
  (temp file + rename) and capped at 256 KiB per file.
- The browser half removes its `<style>` element and clears its interval when the plugin is disposed; the settings section
  comes from the client slot API (`settings.section`), so the harness owns its frame, navigation and lifecycle.

## Troubleshooting

- See the concatenated stylesheet: open `/dsh-custom-style/all.css`; file list and sizes: `/dsh-custom-style/status`.
- `Ctrl+Shift+I` → search `data-plugin-css="dsh-custom-style"` for the injected sheet; `[dsh-custom-style]` console lines report
  what was applied or why fetching failed.
- Rule has no effect: check the element the selector actually matches (DevTools → Inspect) and whether `!important` is needed.
- Route 404: the host half is not loaded — confirm `dsh-custom-style` is in `<profile>/package.json` → `dsh.profile.bundles`,
  then restart DSH.

## Development

```powershell
node test-host.mjs                        # host half: 44 assertions (fake ctx / req / res, temporary DSH_HOME)
node test-client.mjs                      # browser half: 59 assertions (fake ModuleLoader / DOM / fetch / React / slots)
npm test                                  # run both suites
node tools/local-preview.mjs              # local preview server (no DSH needed), see below
```

### Preview styles without restarting DSH

```powershell
node tools/local-preview.mjs                                            # temporary style dir, dialog starts at 1200px
node tools/local-preview.mjs --css-dir "$env:USERPROFILE\.dsh\dsh-custom-style"   # preview your real styles
node tools/local-preview.mjs --width 1400 --port 7799
```

It serves a mock settings dialog at `http://127.0.0.1:7788/` and drives **the real halves**: the host half concatenates
your styles and serves `/dsh-custom-style/all.css`, the page loads the real `client.js`, which injects and polls.
`GET /__set?w=1400` rewrites the preview stylesheet so you can watch the two-second reload. Nothing leaves the machine,
and DSH itself is not involved.

The preview page has no DSH services, so it exercises the stylesheet only: the settings section needs the real harness
(the console prints a `slots` unavailable warning there, which is the intended graceful degradation).

### Development tools

- `tools/asar/` — reads and patches the shipped `app.asar` for changes that genuinely cannot be done with CSS;
  `patch_panel_width.py` edits the settings-dialog width in place with a length-preserving rewrite and can `--revert` it.
  `scan-all-maxwidth.py` lists every `max-width` rule inside the shipped settings bundles (each entry seeks independently —
  reading the filtered entries back-to-back produces false negatives). Set `ASAR_PATH` to your `app.asar` first.

The tools are development aids and are not part of the installed plugin (`files` keeps them out of the npm package).

## Compatibility

| DSH release | Status |
|---|---|
| `0.2.0-rc.2` | compatible — the version this plugin is developed and tested against |

Declared in `package.json` under `dsh.compatibility.dshReleases`.

## License

MIT — see [LICENSE](LICENSE).
