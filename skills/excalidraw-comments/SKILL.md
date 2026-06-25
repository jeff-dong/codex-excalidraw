---
name: excalidraw-comments
description: Add, inspect, resolve, or apply structured comments on the Codex Excalidraw canvas.
---

# Excalidraw Comments

Use this skill when the user asks to comment on selected canvas content, process a whiteboard comment, or apply a comment as an edit.

Before acting, read `../RUNTIME_BOUNDARIES.md`.

## Guardrails

Comments must bind to `targetElementIds`. Do not create floating
natural-language notes as the source of truth for AI edits.
Do not infer edit targets by matching comment body text to element text. Use the
action/comment `targetElementIds` or explicit semantic ids.

## Runtime Boundaries

- Adding a comment to the current selection requires a visible live canvas and a
  saved selection. If there is no live session or selection, open the canvas or
  return the URL and ask the user to select elements first.
- Processing `Run with Codex` actions requires `get_pending_excalidraw_actions`
  and `claim_excalidraw_action`. Do not execute unclaimed actions.
- If an action is already completed or claimed by another run, report that state
  instead of applying it again.
- Applying a comment as an edit must use the comment id or action target ids.
  Do not route edits by comment text.
- Resolving a comment without editing is allowed when the user explicitly asks
  to close or resolve it.

## Workflow

- To add a comment to the user's current selection, call `add_excalidraw_comment` with `target: { "selected": true }`.
- To list comments, call `get_excalidraw_comments`.
- If the user clicked `Run with Codex` in the canvas page, call `get_pending_excalidraw_actions`, then `claim_excalidraw_action` before editing.
- To apply a comment as a direct edit, call `apply_excalidraw_comment_patch` with the comment id and a structured patch.
- For comment actions that need more than a simple patch, execute the action with structural tools such as `update_excalidraw_elements`, `delete_excalidraw_elements`, `insert_excalidraw_elements`, or `insert_excalidraw_image`, then call `complete_excalidraw_action`.
- To only close a comment, call `resolve_excalidraw_comment`.
