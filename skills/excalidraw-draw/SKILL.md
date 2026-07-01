---
name: excalidraw-draw
description: Generate or modify editable Excalidraw elements on the Codex Excalidraw canvas from a user request.
---

# Excalidraw Draw

Use this skill when the user asks Codex to draw, modify, or rearrange content on
the Codex Excalidraw canvas. If the user specifically asks to clean up or
optimize a rough hand-drawn selection, use the `excalidraw-optimize-sketch`
skill.

Before acting, read `../RUNTIME_BOUNDARIES.md`. This skill must not treat
file-backed scene writes as equivalent to an opened, visible canvas.

## First Action For User-Visible Drawing

If the user asks to draw, create, sketch, diagram, or make a hand-drawn
architecture view with Codex Excalidraw, the first successful runtime outcome
must be a visible canvas session:

1. Resolve the target project directory.
2. Call `open_excalidraw_canvas` or use the `excalidraw-open-canvas` workflow
   to start or reuse the local canvas service.
3. Open the local URL in the Codex App in-app browser when available, or return
   the URL prominently if the browser tool is unavailable.
4. Call `read_excalidraw_drawing_guide` once for substantial diagram creation
   or when the current conversation has not already loaded the drawing guide.
5. Only then choose the drawing path. For any complete architecture, system,
   process, workflow, data/code structure, or README/slide-friendly diagram,
   call `insert_excalidraw_diagram` and let the diagram engine compute layout,
   connectors, containers, labels, legend, and viewport. Use
   `insert_excalidraw_elements` only for partial edits, annotations, small
   visual compositions, or unsupported shapes.

Do not call drawing tools with `preferApi: false` for normal user requests. That
flag is an internal test/headless escape hatch and bypasses the visible canvas
runtime.

## Guardrails

- Prefer structural targets: selected element ids, comment target ids, or element `customData`.
- When a canvas-page action exists, prefer its `targetElementIds` and `instruction`.
- Do not rely on fuzzy text matching to decide which elements to edit.
- If the target is unclear, ask the user to select the relevant elements before applying destructive changes.
- Generated diagrams should be editable Excalidraw elements, not a flattened bitmap.
- Treat diagram route names as internal implementation details. Users should
  describe their audience, subject, and desired outcome; do not ask them to
  choose route names such as flowchart, fireworks, or sequence.
- Use one unified presentation visual language for complete diagrams:
  fireworks-style spacing, short labels, semantic arrow colors, readable
  containers, legend discipline, and post-render validation. Keep specialized
  layout engines internal when the structure requires lanes, UML/ER/state
  semantics, mind maps, or dense node-edge layout.
- For `arrow` and `line` specs, `points` are local to `x/y`. Use
  `x=100, y=200, points=[[0,0],[300,0]]`, not absolute canvas points such as
  `[[100,200],[400,200]]`.
- Choose the structured route internally from the communication goal:
  lane-based handoff timelines and cross-system message flows use structured
  participants/messages/notes/gates; presentation-grade system architecture or
  README/slide-friendly visuals use containers, short labels, sublabels, routed
  connectors, and legends; formal data/code/state/mind-map views use structured
  nodes and edges. Use free-form elements when the diagram shape is unsupported
  or the user is asking for a visual composition rather than a structured
  diagram. All structured routes should preserve the unified fireworks-style
  visual language unless the user explicitly requests a different look.
- Do not hand-place a full diagram as a large batch of rectangles, text, lines,
  and arrows. That bypasses the layout engine and usually causes overlap,
  uneven spacing, weak hierarchy, and unreadable labels.
- Mermaid text is not the primary drawing path yet. If a user provides Mermaid,
  preserve the declared diagram semantics and convert them into diagram IR
  before drawing. Do not route by matching Mermaid keywords or natural-language
  text.
- If the user explicitly asks to insert a generated bitmap/image/photo, use the `excalidraw-image` skill and `insert_excalidraw_image`.
- Use `cameraUpdate` pseudo elements or `focus_excalidraw_viewport` to guide the
  visible canvas after large drawings.
- For substantial user-visible creation, pass `rendering: { "mode": "progressive" }`
  unless the user explicitly asks for an immediate update.
- For substantial user-visible diagrams, call `visual_validate_excalidraw` after
  insertion. Treat a failed or high-risk `qualityReport` as unfinished work:
  simplify, redraw with the structured route, or split the diagram before
  delivery.
- Read `layoutValidation` from the insert result. If it reports many repairs,
  simplify the next drawing pass into fewer larger elements or split the diagram
  into sections with `cameraUpdate`.
- Read `routeRecommendation` from `insert_excalidraw_elements`. If it warns
  that a free-form batch structurally looks like a full diagram, stop adding
  primitive elements and redraw with `insert_excalidraw_diagram`.
- Use `save_excalidraw_checkpoint` before risky multi-step edits, and
  `restore_excalidraw_checkpoint` when the user asks to return to a prior state.
- For pseudo-element deletion, use structured `elementIds`; do not pass
  comma-separated text as the target.
- Do not use browser-control clicking as the drawing or editing mechanism.
- Do not overwrite or clear an existing `scene.excalidraw` unless the user
  explicitly asks to replace/reset the canvas and confirms destructive behavior.
- Do not hard-code paths, ports, or intent branches. Runtime decisions must come
  from the active workspace, explicit user path, session data, and MCP results.

## Runtime Boundaries

- New visible drawing request: if there is no usable live canvas session for the
  target project, first use the `excalidraw-open-canvas` workflow to start or
  reuse the service and open or return the URL. Then insert elements through MCP.
- Existing scene: append the new drawing as editable elements in a new group or
  empty area. Preserve unrelated elements.
- Missing canvas directory: acceptable for a create/draw request; the open
  workflow or MCP write may create it.
- MCP write result `sourceMode: "api"`: report that the live canvas was updated.
- MCP write result `sourceMode: "file"` for a visible drawing request: treat as
  degraded. Start or reopen the canvas, return the URL, and explicitly say the
  write landed file-backed instead of claiming the visible canvas was updated.
- MCP tools unavailable: do not hand-edit raw scene JSON for normal drawing
  requests. Report the missing MCP capability or fix the plugin setup.
- Dependency/startup failure: stop and report the exact failure. Do not continue
  with headless file writes unless the user explicitly accepts that fallback.

## Workflow

For new drawings:

1. Resolve `projectDir` and inspect session state.
2. Ensure a visible live canvas path with `open_excalidraw_canvas` unless the
   user explicitly requested a headless file artifact.
3. Call `read_excalidraw_drawing_guide` if the current conversation has not
   already loaded it.
4. Convert complete diagrams into a structured `insert_excalidraw_diagram`
   payload using the best internal route for the user's communication goal.
   Convert to direct Excalidraw element specs only for local edits, small
   annotations, or unsupported visual compositions. Include `cameraUpdate` when
   useful for free-form element drawings.
5. Call the drawing tool with progressive rendering for visible diagrams.
6. For substantial diagrams, call `visual_validate_excalidraw` against the new
   batch or scene and review its `qualityReport`.
7. Read the tool result and report inserted count, important semantic ids,
   layoutValidation summary, source mode, canvas directory, and local URL when
   available.

When the canvas page is open and connected to the same project, the MCP tool
routes those specs through the page runtime so Excalidraw's native
`convertToExcalidrawElements` and `updateScene` APIs create the final editable
elements. When no page runtime is connected, normal user-visible drawing must
fail fast and reopen or return the live canvas URL. The validated file-backed
writer is reserved for explicit headless workflows and automated tests.

For follow-up edits:

1. If the user says "selected" or "this part", call `get_excalidraw_selection`.
2. If there is no live session or no valid selection, ask the user to open the
   canvas and select the target elements; offer the local URL when available.
3. If there is a valid selection, call `update_excalidraw_elements` with `target: { "selected": true }`.
4. If the user refers to a previous generated block, use known `customData.codex.semanticId`.
5. If the user refers to a comment, use `apply_excalidraw_comment_patch`.
6. If the user asks to execute a queued canvas action, call `get_pending_excalidraw_actions`, `claim_excalidraw_action`, execute with structural tools, then `complete_excalidraw_action`.

The canvas page exposes export and annotation controls as user-facing complements to Codex. Treat MCP/API calls as the AI control path.
