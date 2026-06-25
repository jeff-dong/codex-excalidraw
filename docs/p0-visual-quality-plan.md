# P0 Visual Quality Upgrade Plan

## Scope

P0 improves the reliability of existing Codex Excalidraw drawing paths. It does
not add new diagram kinds. The upgrade must make generated diagrams easier to
validate, safer to repair, and easier to regression-test before production use
or sensitive-data workflows.

## Production-Like Use Cases

### 1. Structured Flowchart Creation

- Path: `insert_excalidraw_diagram` with `kind: "flowchart"`.
- Scenario: 5-7 service nodes, one decision, grouped details, and edge labels.
- Acceptance:
  - Diagram inserts through live API when a canvas is open.
  - `layoutValidation.issueCount` is low and does not report high-risk overlap.
  - `qualityReport.status` is `pass` or `warn`, not `fail`.
  - Export/visual validation writes a local preview artifact under
    `canvas/excalidraw/exports/`.
  - The preview artifact has non-zero size and stays inside the project canvas
    directory.

### 2. Sequence Diagram Creation

- Path: `insert_excalidraw_diagram` with `kind: "sequence"`.
- Scenario: 4 participants, 6 messages, one note, one gate.
- Acceptance:
  - Lane spacing is stable.
  - Message labels remain at readable size.
  - Visual validation reports enough visible elements and no empty preview.
  - Existing project-local scene data is preserved.

### 3. Free-Form Hand-Drawn Explanation

- Path: `insert_excalidraw_elements`.
- Scenario: title, 6-10 nodes, arrows, callouts, and one large background zone.
- Acceptance:
  - Large zones marked as background/container/zone do not trigger destructive
    overlap repairs.
  - If many foreground elements overlap, the report requests redraw or section
    splitting instead of silently shifting the drawing into a broken layout.
  - Text and labels meet minimum readable sizes.

### 4. Dense / Bad Input Stress Case

- Path: `insert_excalidraw_elements`.
- Scenario: intentionally overlapping nodes, tiny labels, low contrast, and
  absolute-coordinate arrow points.
- Acceptance:
  - Deterministic structural repairs still happen for small dimensions, text
    width, contrast, and absolute line points.
  - High-risk overlap is diagnosed with `needsRedraw: true`.
  - The validator does not perform large cascading Y shifts.
  - The agent receives actionable risk codes for retry.

### 5. Existing Diagram Modification

- Path: `update_excalidraw_elements` or comment/action patching after insertion.
- Scenario: resize or relabel an existing node using selected ids, comment ids,
  or semantic ids.
- Acceptance:
  - Targeting remains structural.
  - Unrelated elements and element ids are preserved.
  - A follow-up visual validation can be run against the modified scene.

## Risk Matrix

| Risk | Impact | Required Control |
| --- | --- | --- |
| Cascading overlap repair breaks layout | High | Diagnose high-risk overlap and request redraw instead of large automatic shifts |
| Renderer unavailable | Medium | Return a clear degraded validation result without claiming visual pass |
| Preview/export path escape | High | Force preview artifacts under project-local `exports/` |
| File-backed write used for visible workflows | High | Keep live-canvas requirement and report source mode |
| Text-based routing for layout choice | High | Use explicit `kind`, `pattern`, `role`, or `layoutRole` fields only |
| Large diagrams exceed viewport or become unreadable | Medium | Quality report includes density, font-size, and bounding-box warnings |
| Sensitive data uploaded externally | High | P0 visual validation stays local-only |

## Reproducible Errors Found

### E1: Dense Free-Form Drawings Are Broken By Overlap Repair

- Repro: insert a large explanatory drawing containing section containers,
  badges, nodes, labels, and arrows in one batch.
- Observed: `repairOverlaps` shifts many foreground elements downward because
  it scans elements in order and only repairs by increasing `y`.
- Root cause: overlap repair is global, order-dependent, and blind to intended
  local composition. It treats many valid nearby elements as collision risks and
  tries to fix layout instead of asking for a sectioned redraw.
- Expected fix: keep deterministic local repairs, but convert high-risk
  overlap into diagnostics and quality warnings instead of destructive
  cascading shifts.

## Regression Requirements

- `npm test` passes.
- New layout-quality tests pass.
- Browser E2E should pass in an environment with Chrome available.
- Any visual validation artifact created by tests must be project-local and
  should not require network access.
