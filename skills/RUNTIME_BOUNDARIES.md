# Codex Excalidraw Runtime Boundaries

Use this file as the shared preflight for every Codex Excalidraw skill before
creating, modifying, commenting on, inserting images into, optimizing, or
exporting a canvas.

## Terms

- Plugin repository: the repository that contains `scripts/start-canvas.sh`,
  `scripts/start-mcp.sh`, `skills/`, `mcp/`, and the web app source.
- Project directory: the user's active workspace or the explicit path supplied
  by the user. Do not use the plugin repository as the project directory unless
  the user explicitly asks to whiteboard this plugin repository.
- Canvas directory: `<projectDir>/canvas/excalidraw`.
- Live canvas API: the local Vite API reported by `session.json` or by the
  startup script, usually `http://127.0.0.1:<port>`.
- Browser surface: the Codex App in-app browser. It is only a user-facing
  display surface, not the AI control path.
- MCP data path: structured Excalidraw MCP tools and the local canvas API.
- Local executor: the browser-triggered service path that starts Codex CLI for
  a queued action. It must still use MCP/API data paths and structural target
  ids; the browser only renders run status.

## Universal Preflight

Run this preflight for any user request that affects a canvas.

1. Resolve `projectDir` from the active workspace or the explicit user path. If
   multiple candidate projects are plausible, ask the user to choose. Never
   infer project identity from repository names, natural language text, or UI
   labels alone.
2. Verify the plugin runtime exists. The plugin repository must contain
   `scripts/start-canvas.sh`, `scripts/start-mcp.sh`, and `package.json`. If
   these files are missing, report that the plugin install is incomplete and do
   not claim the canvas is open or editable.
3. Inspect the canvas state through `get_excalidraw_session` when available.
   Treat missing `session.json`, a stale API URL, or a session pointing at a
   different project as "no usable live canvas" for visible workflows.
4. Decide whether this request requires a visible live canvas:
   - Required: open, launch, view, work in canvas, create a visible editable
     drawing, draw into an existing visible canvas, modify the current
     selection, insert into a selected region, optimize a selected sketch, use
     PNG export, use official Excalidraw SVG export, or anything where the user
     expects to inspect the result immediately.
   - Required: first-turn plugin requests such as `@codex-excalidraw draw...`,
     "draw a hand-drawn architecture diagram", or "make an Excalidraw diagram"
     even when the user did not explicitly say "open the canvas".
   - Optional: headless `.excalidraw`, JSON, or basic SVG export from an
     existing scene, or a deliberate file-backed maintenance task.
5. If a visible live canvas is required and no usable session exists, start the
   service by calling `open_excalidraw_canvas` before writing scene data. The
   tool owns session reuse, project switching, dependency bootstrap, startup,
   and port selection.
6. If a live API exists for the wrong project, use `switch_excalidraw_project`
   when available. If switching is not available or fails because the API is
   stale, start the canvas for the requested project.
7. If the startup script prints a URL, use that exact URL. Do not hard-code
   `43218`; the script may select a different port.
8. Open the URL in Codex App's in-app browser when the browser tool is
   available. If the tool is not available, return the URL prominently and tell
   the user the canvas is ready to open manually.
9. Never call `open`, `xdg-open`, `start`, or any command that launches the
   system default browser.
10. The drawing tool is expected to fail fast if the browser page runtime is
    not connected. After any MCP write, still read the tool result. If
    `sourceMode` is `file` for a request that required a visible live canvas,
    treat that as a degraded result: start or reopen the live canvas, return the
    URL, and explicitly say the write was file-backed instead of claiming the
    visible canvas was updated.

## Dependency Handling

- Do not pre-install dependencies by hand as the default path. Let
  `open_excalidraw_canvas` run the repository's dependency bootstrap through
  the startup script.
- If startup fails because Node.js, npm, package installation, or Vite is
  unavailable, report the exact failing command and error. Do not continue to
  file-backed drawing unless the user explicitly accepts a headless fallback.
- If MCP tools are unavailable, do not hand-edit raw scene JSON for normal user
  canvas operations. Fix the plugin/MCP setup or report the missing capability.

## Artifact Boundaries

- If `canvas/excalidraw/` does not exist, startup may create it. This is normal
  for open, create, and draw requests.
- If `scene.excalidraw` already exists, preserve it. Insert new drawings as new
  editable elements in a new group or empty area. Do not overwrite or clear the
  scene unless the user explicitly asks to replace or reset the canvas.
- If the user asks for a "new canvas" and a scene already exists, ask before
  destructive replacement. A new group on the existing canvas is the safe
  default for "create a drawing".
- If `selection.json` is missing or empty for a selection-based request, ask
  the user to select elements or open the canvas first. Do not infer targets by
  matching element text, comment text, or natural-language descriptions.
- If `actions.json` contains pending actions created by the page, claim and
  complete actions through MCP. Do not execute an action twice.
- If `executor-runs.json` shows a running action for the current canvas, report
  that status instead of starting a second executor run. One active run per
  canvas is the safe default.
- Image assets must stay under `<projectDir>/canvas/excalidraw/assets/`.
- Exports must stay under `<projectDir>/canvas/excalidraw/exports/`.

## Intent Boundaries

- Open or launch: start or reuse the service, open or return the URL, and do
  not draw unless the user also asks for drawing.
- Create or draw: ensure the visible live canvas path first, then insert
  editable Excalidraw elements through MCP/API.
- Do not pass `preferApi: false` for normal user-facing create, draw, modify,
  image insertion, or selected-region workflows. It is reserved for explicit
  headless maintenance and automated tests.
- Modify selected/current/this: require a live selection, explicit element ids,
  comment target ids, action target ids, or known `customData.codex.semanticId`.
- Comment: bind comments to structural targets. Do not create floating natural
  language notes as the AI edit source of truth.
- Image insertion: only use image insertion when the user asks for a bitmap,
  image, photo, screenshot, or inherently raster artifact. For generated
  imagery inside a bounded target, read target geometry first, include the
  target aspect ratio in the generation prompt, and use `placement.fit:
  "cover"` unless full-source preservation is explicitly requested.
- Optimize sketch: require selected source elements, preserve the original by
  default, and insert a new editable optimized version nearby.
- Export: use MCP for `.excalidraw`, JSON, and basic SVG. Require the canvas
  page for PNG and official Excalidraw SVG unless the user accepts a non-pixel
  basic SVG fallback.

## UI Boundaries

- The top title bar owns the current project dropdown.
- The top Export dropdown owns export actions.
- The annotation icon next to Export opens or closes the annotation panel.
- The bottom-left Settings menu owns language and theme.
- Settings also owns local executor mode and executor scanning. Local execution
  is allowed only when a usable Codex CLI executor is available; otherwise the
  page should copy a command for Codex Chat.
- Excalidraw's native toolbar owns manual drawing tools and its native image
  tool. Codex uses `insert_excalidraw_image` only for AI-driven image insertion.
- While a local executor run is active, keep the canvas and annotation panel
  visible. Show progress in the comment card instead of blocking the page with
  a loading screen.

## Final Response Contract

Every canvas-affecting response should state the important runtime outcome:

- project directory
- canvas directory or exported file path
- local URL when a service is running
- whether the in-app browser was opened or the URL must be opened manually
- whether MCP wrote through `api` or `file` mode when that is known
- any degraded fallback, stale session, or missing dependency

Never say the canvas is open, live, or visible unless the service was started or
reused and the URL was opened in the in-app browser or returned to the user.

## Anti-Patterns

- Hard-coding user paths, project names, API URLs, ports, or runtime decisions.
- Routing by fuzzy text matching, element text, comment body text, or UI labels.
- Treating `scene.excalidraw` creation as equivalent to opening the canvas.
- Silently using file fallback for a workflow that requires visible editing.
- Using browser screenshots or repeated clicks as the drawing/editing control
  path.
- Treating a successful Codex CLI process exit as enough proof of success
  without verifying the target scene/action/comment state.
- Launching the system default browser.
- Synchronizing code across worktrees with `rsync --relative` against absolute
  paths.
