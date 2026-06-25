---
name: excalidraw-export
description: Export the current Codex Excalidraw canvas as Excalidraw, JSON, PNG, or SVG.
---

# Excalidraw Export

Use this skill when the user asks to export the Codex Excalidraw canvas.

Before acting, read `../RUNTIME_BOUNDARIES.md`.

## Supported Formats

- `.excalidraw`
- `.json`
- `.svg`
- `.png` from the canvas page top Export dropdown, rendered through Excalidraw's browser export utilities

Exports are saved under:

```text
canvas/excalidraw/exports/
```

Use `export_excalidraw_scene` for `.excalidraw`, JSON, and basic SVG from
Codex. Use the canvas page top Export dropdown for pixel-perfect PNG and
official Excalidraw SVG output when the user is operating the visible canvas. Do
not use browser-control clicking to export unless the user explicitly asks for a
one-off visual automation.

## Runtime Boundaries

- `.excalidraw`, JSON, and basic SVG can be exported headlessly from an existing
  `scene.excalidraw`.
- If no scene exists, do not create an empty export silently. Report that the
  project has no canvas scene yet and offer to open/create one.
- PNG requires the browser renderer. Ensure a visible live canvas through
  `excalidraw-open-canvas`, then ask the user to use the page Export dropdown
  unless they explicitly asked Codex to perform one-off browser automation.
- Official Excalidraw SVG also requires the browser renderer. Offer basic SVG
  through MCP only when the user accepts that it is not the official browser
  renderer output.
- If the requested export path already exists, use the MCP tool's safe naming or
  ask before overwriting. Do not delete previous exports unless asked.
- Final responses must include the exported file path, format, source mode when
  known, and the local URL when a browser-rendered export is required.
