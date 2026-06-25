---
name: excalidraw-optimize-sketch
description: Optimize selected hand-drawn or rough Excalidraw content into a cleaner editable diagram while preserving the original sketch.
---

# Excalidraw Optimize Sketch

Use this skill when the user asks Codex to clean up, organize, redraw, beautify,
or optimize selected hand-drawn Excalidraw content.

Before acting, read `../RUNTIME_BOUNDARIES.md`.

## Guardrails

- Start from structural context: call `get_excalidraw_selection` and use the
  selected element ids as the source sketch.
- A visible live canvas and valid selection are required. If there is no live
  session or no selected source elements, open or return the canvas URL and ask
  the user to select the rough sketch first.
- Do not overwrite or delete the original sketch by default.
- Create the optimized version as editable Excalidraw elements with
  `insert_excalidraw_elements`, placed beside the original content.
- Add `customData.codex.semanticId` values for important generated elements.
- If relationships are uncertain, add structured comments to the relevant
  generated elements instead of guessing silently.
- Do not infer edit targets by matching text labels. Text in selected elements
  may inform the diagram plan, but target selection must come from selected ids,
  comment/action target ids, explicit ids, or semantic ids.

## Workflow

1. Call `get_excalidraw_selection`.
2. If there is no selection, ask the user to select the rough sketch first.
3. Read enough scene context with `get_excalidraw_scene` to understand the
   selected elements and nearby layout.
4. Produce a structured cleanup plan that preserves the user's original intent.
5. Call `insert_excalidraw_elements` to create the optimized editable version
   to the right of, below, or near the selected sketch.
6. Add structured comments for uncertain relationships if needed.
7. Report that the original sketch was preserved and list the inserted element
   count or important semantic ids.
