---
name: excalidraw-image
description: Insert a generated or local image into the Codex Excalidraw canvas using structured MCP tools.
---

# Excalidraw Image

Use this skill when the user asks Codex to insert a generated image, local image,
bitmap illustration, screenshot, or rendered visual into the Codex Excalidraw
canvas.

Before acting, read `../RUNTIME_BOUNDARIES.md`.

## Guardrails

- Use `insert_excalidraw_image`; do not hand-edit raw Excalidraw scene JSON.
- Use structural targets only: action `targetElementIds`, comment
  `targetElementIds`, selected element ids, explicit element ids, or
  `customData.codex.semanticId`.
- Do not infer placement targets by matching the comment body, element text, or
  other natural-language strings.
- If a target region is unclear, ask the user to select the region or provide an
  explicit element id before inserting the image.
- Generated architecture diagrams should stay editable Excalidraw elements. Use
  image insertion only when the user explicitly asks for a bitmap/image/photo or
  when the source artifact is inherently an image.
- Do not infer image placement from natural-language region descriptions when
  no structural target exists. Ask for a selection, comment/action target, or
  explicit element id.

## Runtime Boundaries

- Selected-region insertion requires a visible live canvas and a valid
  selection. If no live session exists, first open the canvas or return the URL
  and ask the user to select the region.
- Comment/action insertion can use structural target ids from the saved action
  or comment. Still prefer a live API so the user sees the result immediately.
- If the image file is local, verify it exists before calling
  `insert_excalidraw_image`.
- If the image must be generated and image generation fails, report the failure
  and do not insert a placeholder unless the user asks for one.
- If MCP returns a file-backed write for a visible insertion, reopen or start
  the canvas and report the degraded source mode.
- If `canvas/excalidraw/` or `scene.excalidraw` already exists, preserve the
  scene and insert a new image element only in the targeted region.
- Before generating an image for a bounded target, read the target element
  geometry and include the target aspect ratio in the image-generation prompt.
  Prefer a source image ratio close to the target region when the generated
  image is expected to visually fill that region.

## Placement Policy

- Use `placement.fit: "cover"` when the user's intent is to fill a selected
  region or placeholder without distorting the image. `cover` fills the target
  bounds and uses Excalidraw's native image `crop`.
- Use `placement.fit: "contain"` only when preserving the full image is more
  important than filling the target region, such as logos, screenshots, full
  posters, or user-provided source images that must not be cropped.
- Use `placement.fit: "stretch"` only when the user explicitly accepts
  distortion or the source image is an abstract texture/pattern.
- When a comment/action says to generate an image inside a selected block and
  does not specify full-image preservation, default to `cover` with a small
  margin.

## Workflow

For a queued canvas action:

1. Call `get_pending_excalidraw_actions`.
2. Call `claim_excalidraw_action`.
3. Read the target geometry from the action target ids, then generate or locate
   the image file. For generated images, include the target aspect ratio and
   intended fit mode in the prompt.
4. Call `insert_excalidraw_image` with `target.elementIds` from the claimed
   action and a structural `placement` such as `{ "fit": "cover",
   "margin": 8, "alignX": "center", "alignY": "center" }`.
5. Call `complete_excalidraw_action` with the inserted `imageElementId` and
   `assetPath`.

For a direct comment request:

1. Call `get_excalidraw_comments`.
2. Use `target: { "commentId": "<comment id>" }`.
3. Read the target geometry from the comment `targetElementIds`.
4. Generate or locate the image file. For generated images, include the target
   aspect ratio in the prompt.
5. Call `insert_excalidraw_image` with `placement.fit: "cover"` unless the
   user explicitly asked to preserve the whole image.
6. Call `resolve_excalidraw_comment` after verifying insertion.

For a selected region:

1. Call `get_excalidraw_selection`.
2. If the selection is valid, call `insert_excalidraw_image` with
   `target: { "selected": true }` and the appropriate structured placement.

The canvas page controls are user-facing complements. The Codex data path is the
MCP/API path above.
