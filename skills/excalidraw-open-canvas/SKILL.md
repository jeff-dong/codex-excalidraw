---
name: excalidraw-open-canvas
description: Open the Codex Excalidraw local web service, an Excalidraw-powered infinite canvas intended to run inside Codex App.
---

# Excalidraw Open Canvas

Use this skill when the user asks to open, launch, view, or work in the Codex Excalidraw canvas.
Also use this skill as the first step for any user-visible Excalidraw drawing
request, including "draw a hand-drawn architecture diagram", even if the user
does not explicitly say "open the canvas".

Before acting, read `../RUNTIME_BOUNDARIES.md` and apply its universal
preflight. This skill owns the visible live-canvas path for the other
Excalidraw skills.

## Boundary Contract

- Opening a canvas means a local service is started or reused for the requested
  project and the user receives the exact URL. Creating `scene.excalidraw`
  alone is not an opened canvas.
- Use the active workspace or explicit user path as `projectDir`. Do not use the
  plugin repository as the project unless the user explicitly asks to open this
  plugin repository's own canvas.
- If a usable live session exists for the requested project, reuse it and return
  its `apiBaseUrl`.
- If a live session exists for a different project, switch it with
  `switch_excalidraw_project` when available. If switching fails or the session
  is stale, start a fresh service for the requested project.
- If `canvas/excalidraw/` is missing, let the startup script create it.
- If `scene.excalidraw` already exists, preserve it. Opening must not reset,
  replace, or rewrite the scene.
- Do not silently fall back to file-only operation for this skill. If the
  service cannot start, report the startup failure and the project path.
- Do not use file-backed MCP writes as a substitute for opening the visible
  canvas when the user asked to draw or inspect the result.

## Workflow

1. Resolve the user's project directory.
2. Call `open_excalidraw_canvas` with that `projectDir`. This single MCP tool
   checks or switches the current live session, starts the local service if
   needed, and returns the exact local URL.
3. Open the resulting local URL in Codex App's in-app browser if that browser
   tool is available.

Use the `browser:control-in-app-browser` skill for this one presentation step:

- connect to the `iab` browser
- navigate to the local canvas URL
- set browser visibility to true

Do not run macOS `open`, `xdg-open`, `start`, or any shell command that launches
the system default browser. If the in-app browser tool is not available, return
the URL and let the user open it manually.

4. In the final response, include the project directory, canvas directory, exact
   URL, and whether the in-app browser was opened or the URL must be opened
   manually.

The startup script writes:

```text
canvas/excalidraw/session.json
```

The MCP server uses that session file to verify the live local API belongs to
the same project before it writes scene changes.

Do not use browser-control automation to operate the canvas. Browser control is
token-expensive and fragile for this product. The browser or Codex App window is
only the user-facing surface; Codex should interact with the canvas through MCP
tools and saved scene state.

Opening the page in the in-app browser is allowed only as a one-time display
action. It is not the control path for drawing, modifying, selecting, or reading
canvas state.

The default URL is:

```text
http://127.0.0.1:43218/
```

If the service prints a different URL, use that actual URL.

## Failure Handling

- Missing Node.js, npm, package install failure, or Vite startup failure: report
  the exact command and error. Do not claim the canvas is open.
- Port busy: rely on the startup script's selected URL and report that URL.
- Stale `session.json`: do not trust it as live; start the service again or use
  a successfully switched live API.
- Browser tool unavailable: this is a presentation limitation, not a canvas
  startup failure. Return the URL.

## Interaction Model

- User draws, selects elements, and adds comments in the canvas window.
- User can click `Run with Codex` on an open comment to create a pending
  action for Codex and copy the exact execution prompt.
- User asks Codex for AI operations in the Codex chat input.
- User can switch the active canvas project from the compact project dropdown in
  the top title bar when reusing previous project whiteboards.
- Codex reads `selection.json`, comments, and scene data through MCP.
- Codex reads pending action data through `get_pending_excalidraw_actions`,
  claims it with `claim_excalidraw_action`, and closes it with
  `complete_excalidraw_action`.
- Codex can call `get_excalidraw_session` to inspect the active project and
  `switch_excalidraw_project` to switch the live canvas service to another
  project.
- Codex writes structured scene updates through MCP/API.
- Codex must not visually inspect the browser repeatedly just to decide what is
  selected or where to click.

## Storage

Canvas data is project-local:

```text
canvas/excalidraw/scene.excalidraw
canvas/excalidraw/selection.json
canvas/excalidraw/comments.json
canvas/excalidraw/actions.json
canvas/excalidraw/assets/
canvas/excalidraw/exports/
```
