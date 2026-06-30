# Excalidraw Native Capability Map

This project should use Excalidraw native capabilities first, then add Codex-specific MCP/API behavior only where the host integration needs structured automation.

## Current Package

- Package: `@excalidraw/excalidraw`
- Local version: `0.18.1`
- Official capability areas:
  - component props and callbacks
  - `UIOptions`
  - imperative `excalidrawAPI`
  - utility exports
  - constants
  - element skeleton conversion
  - restore/import helpers
  - library helpers
  - children components and sidebar integration
  - geometry and coordinate helpers

References:

- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/constants
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton

## Capability Matrix

| Area | Native Excalidraw capability | Project usage | Status |
| --- | --- | --- | --- |
| Canvas render | `<Excalidraw />` React component | Main infinite canvas | Implemented |
| Initial scene | `initialData` | Load active project scene | Implemented |
| Autosave | `onChange(elements, appState, files)` | Debounced project-local persistence | Implemented |
| Selection bridge | `appState.selectedElementIds` from `onChange` | Save structured selection for MCP | Implemented |
| Deleted-element fidelity | `getSceneElementsIncludingDeleted` | Preserve Excalidraw deletion/history semantics in saved scene payloads | Implemented |
| Theme | `theme`, `THEME`, `UIOptions.canvasActions.toggleTheme` | App settings control native theme; native toggle syncs back through `onChange` | Implemented |
| Language | `langCode` | Chinese/English shell plus Excalidraw locale | Implemented |
| Native image tool | `UIOptions.tools.image` and `generateIdForFile` | Keep Excalidraw image tool visible; stable file ids for user-added images | Implemented |
| Programmatic image placement | Excalidraw image element `crop` | `insert_excalidraw_image` supports `contain`, `cover`, and `stretch`; `cover` fills structured target bounds without distortion by writing native crop metadata | Implemented |
| Export from browser | `exportToBlob`, `exportToSvg`, `serializeAsJSON` | PNG/SVG/browser JSON export from rendered scene | Implemented |
| Clipboard export | `exportToClipboard` | Future copy-as-PNG/SVG/JSON action from top Export menu | Planned |
| Remote scene update | `excalidrawAPI.addFiles`, `updateScene` | Apply MCP/API scene changes without browser clicking | Implemented |
| User feedback | `excalidrawAPI.scrollToContent`, `setToast` | Focus and notify when Codex updates scene | Implemented |
| Scene inspection | `getSceneElements`, `getAppState`, `getFiles` | Build current payload for save/export/action queue | Implemented |
| Programmatic drawing | `convertToExcalidrawElements` from skeletons | MCP submits native element requests to the open canvas; browser runtime converts skeletons, updates scene, and reports inserted ids | Implemented |
| Structured diagram IR | Project-owned diagram schema plus layout adapters | The agent selects an internal route from the user's communication goal, then calls `insert_excalidraw_diagram` with structured IR; lane flows, curated architecture visuals, and node-edge diagrams share the Excalidraw renderer | Implemented |
| Viewport guidance | `excalidrawAPI.scrollToContent` | `cameraUpdate` pseudo elements and `focus_excalidraw_viewport` queue project a scene rectangle into the visible canvas | Implemented |
| Progressive rendering | `excalidrawAPI.updateScene` | Browser runtime reveals generated elements in ordered chunks before the final save, preserving editable Excalidraw elements | Implemented |
| Layout validation | Pure structured spec validation before conversion | Repairs small shapes, low contrast, likely text overflow, absolute line/arrow points, and overlapping node/text boxes without using label text for intent routing | Implemented |
| Capture semantics | `CaptureUpdateAction` | Remote updates are marked as immediate history updates and local saves avoid refresh loops | Implemented |
| Active tool | `setActiveTool` | Optional future affordance for custom toolbar shortcuts | Planned |
| Cursor affordance | `setCursor`, `resetCursor` | Future transient annotation or target-pick mode | Not in MVP |
| Native sidebar | `toggleSidebar`, `Sidebar`, `DefaultSidebar` | Candidate if we later move comments into an Excalidraw-native sidebar shell | Not in MVP |
| Reset and history | `resetScene`, `history.clear` | Intentionally not exposed in MVP to avoid accidental destructive project changes | Not in MVP |
| Frame rendering | `updateFrameRendering` | Candidate for read-only presentation/export mode | Not in MVP |
| Library | `updateLibrary`, `onLibraryChange`, `useHandleLibrary` | Future reusable diagrams/stencils | Not in MVP |
| Paste/drop | `onPaste` | Future import guards or Codex attachment handling | Not in MVP |
| Duplicate hook | `onDuplicate` | Future propagation of `customData.codex` when users duplicate generated blocks | Planned |
| Links/embeds | `generateLinkForSelection`, `onLinkOpen`, `validateEmbeddable`, `renderEmbeddable` | Future element deep-links and embed governance | Not in MVP |
| Pointer/scroll events | `onPointerUpdate`, `onPointerDown`, `onScrollChange`, `refresh` | Future contextual annotation positioning | Not in MVP |
| Geometry utilities | `getCommonBounds`, bbox helpers | Candidate for target-area calculations when moved into browser runtime | Planned |
| Restore utilities | Excalidraw scene shape plus project-local snapshots | `save_excalidraw_checkpoint`, `list_excalidraw_checkpoints`, and `restore_excalidraw_checkpoint` provide local checkpoint/restore without uploading to external services | Implemented |
| Coordinate utilities | `sceneCoordsToViewportCoords`, `viewportCoordsToSceneCoords` | Candidate for annotation pin overlays if we need viewport-accurate markers | Planned |
| Custom top/right UI | `renderTopRightUI`, `renderCustomStats`, children components | Avoid for now because host UI lives outside Excalidraw to keep the canvas native and uncluttered | Not in MVP |
| Collaboration | `isCollaborating`, collaborator state, live collaboration trigger | Out of scope for local-first Codex project canvas | Not in MVP |

## Integration Rules

1. The canvas page owns native interaction: drawing tools, image tool, dark/light toggle, Excalidraw shortcuts, and manual selection.
2. Codex owns structured automation through MCP tools: read scene, read selection, process comments/actions, insert/update/delete/export, checkpoint, and viewport focus.
3. Browser-control clicking must not be the data path. It is only acceptable for visual validation during development.
4. Targets must be structural: selected element ids, explicit element ids, comment target ids, action target ids, or `customData.codex.semanticId`.
5. The MCP layer must not infer intent through fuzzy text matching, regex routing, or label search.
6. Files generated by Codex must remain under the active project `canvas/excalidraw` directory unless the user explicitly exports/downloads through the browser.
7. Theme is controlled by the host shell and local settings, not by persisted scene data. Strip `appState.theme` from saved scene payloads so stale project data cannot fight the controlled Excalidraw `theme` prop.
8. Diagram routing must use explicit `kind` and `sourceFormat` fields. Sequence diagrams use structured participants/messages/notes/gates. Flowchart, class, ER, state, mindmap, and generic graph diagrams use structured nodes and edges.
9. Generated images for bounded targets must read target geometry before generation. Use the target aspect ratio in the prompt and `placement.fit: "cover"` for fill-with-crop placement unless the user explicitly asks to preserve the full image.

## Diagram Architecture

Programmatic diagrams use one data path:

```text
Codex MCP args
  -> Diagram IR
  -> layout adapter
     - sequence: lane/order rules
     - node-edge: ELK
  -> shared Excalidraw element specs
  -> browser native skeleton conversion
```

The final render is always controlled by this project so shape choices, roughness, colors, labels, semantic ids, and `customData.codex` remain consistent. Mermaid is a future import/source format, not the current final renderer. A Mermaid integration must preserve the explicit diagram `kind` and convert into IR instead of routing by text patterns.

## Important Boundary

`convertToExcalidrawElements` is exported by the browser package and is used by the open canvas runtime through `/api/native-elements`. The MCP server is a Node process, and the current Excalidraw production bundle imports browser/rendering dependencies that are not stable as a direct Node-side dependency. For normal user-visible drawing, no browser canvas runtime means the MCP tool fails fast and asks Codex to call `open_excalidraw_canvas` and open the returned URL in the Codex App in-app browser. The small validated scene writer remains available only for explicit headless workflows and automated tests.

The native conversion flow is:

1. MCP calls `POST /api/native-elements` with structured element specs.
2. The local API returns 409 immediately if no browser canvas runtime is connected, and the MCP drawing tool returns a visible-runtime-required error instead of silently writing a file-backed scene.
3. The open canvas receives the `native-elements-requested` event, fetches pending requests, maps specs to Excalidraw skeletons, and calls `convertToExcalidrawElements`.
4. The page appends converted elements with `updateScene`, saves through `/api/scene`, focuses the new content with `scrollToContent`, and reports completion back to `/api/native-elements/<id>`.
5. MCP polls the request and returns inserted element ids with `nativeConversion: true`.

The official Excalidraw MCP uses `cameraUpdate`, `delete`, and `restoreCheckpoint` pseudo elements. This project keeps the same product idea but uses structured local fields:

1. `cameraUpdate` requests are translated to `/api/viewport` and consumed by the open page through `scrollToContent`.
2. `delete` uses `elementIds: []` instead of comma-separated text so target routing stays structural.
3. `restoreCheckpoint` uses project-local checkpoint files under `canvas/excalidraw/checkpoints/` instead of remote or shared storage.
