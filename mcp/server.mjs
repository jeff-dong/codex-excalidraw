import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addComment,
  canvasPaths,
  claimAction,
  collectTargetElementIds,
  completeAction,
  deleteElements,
  emptyActions,
  emptyComments,
  emptySelection,
  exportScene,
  insertElementSpecs,
  insertImageSpec,
  listCheckpoints,
  nonEmptyString,
  pendingActions,
  readCheckpoint,
  readActionsFile,
  readCommentsFile,
  readJsonFile,
  readSceneFile,
  readSelectionFile,
  resolveCanvasDir,
  resolveComment,
  restoreCheckpoint,
  saveCheckpoint,
  splitElementSpecsAndDirectives,
  summarizeScene,
  updateElements,
  writeActionsFile,
  writeCommentsFile,
  writeSceneFile
} from '../lib/excalidraw-data.mjs'
import { layoutDiagram, layoutSequenceDiagram } from '../lib/excalidraw-diagrams.mjs'
import { qualityReportForElements, qualityReportForScene } from '../lib/excalidraw-quality.mjs'

const SERVER_NAME = 'Codex Excalidraw MCP'
const SERVER_VERSION = '0.1.0'
const DEFAULT_API_TIMEOUT_MS = 650

const Tools = {
  READ_DRAWING_GUIDE: 'read_excalidraw_drawing_guide',
  OPEN_CANVAS: 'open_excalidraw_canvas',
  GET_SELECTION: 'get_excalidraw_selection',
  GET_SCENE: 'get_excalidraw_scene',
  GET_COMMENTS: 'get_excalidraw_comments',
  GET_PENDING_ACTIONS: 'get_pending_excalidraw_actions',
  CLAIM_ACTION: 'claim_excalidraw_action',
  COMPLETE_ACTION: 'complete_excalidraw_action',
  GET_SESSION: 'get_excalidraw_session',
  SWITCH_PROJECT: 'switch_excalidraw_project',
  INSERT_ELEMENTS: 'insert_excalidraw_elements',
  INSERT_DIAGRAM: 'insert_excalidraw_diagram',
  INSERT_IMAGE: 'insert_excalidraw_image',
  UPDATE_ELEMENTS: 'update_excalidraw_elements',
  DELETE_ELEMENTS: 'delete_excalidraw_elements',
  ADD_COMMENT: 'add_excalidraw_comment',
  RESOLVE_COMMENT: 'resolve_excalidraw_comment',
  APPLY_COMMENT_PATCH: 'apply_excalidraw_comment_patch',
  SAVE_CHECKPOINT: 'save_excalidraw_checkpoint',
  LIST_CHECKPOINTS: 'list_excalidraw_checkpoints',
  RESTORE_CHECKPOINT: 'restore_excalidraw_checkpoint',
  FOCUS_VIEWPORT: 'focus_excalidraw_viewport',
  VISUAL_VALIDATE: 'visual_validate_excalidraw',
  EXPORT_SCENE: 'export_excalidraw_scene'
}

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const START_CANVAS_SCRIPT = resolve(PLUGIN_ROOT, 'scripts', 'start-canvas.sh')
const START_CANVAS_PREFIX = 'Codex Excalidraw canvas: '
const START_CANVAS_TIMEOUT_MS = 120_000
const VISIBLE_CANVAS_RUNTIME_REQUIRED_MESSAGE =
  'Visible Excalidraw canvas runtime is required before drawing. Call open_excalidraw_canvas, open the returned URL in the Codex App in-app browser, then retry insert_excalidraw_elements or insert_excalidraw_diagram. For explicit headless workflows and automated tests only, use the internal preferApi: false path.'

const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602
}

const DRAWING_GUIDE = `# Codex Excalidraw Drawing Guide

Call this once before substantial diagram creation. Then use insert_excalidraw_elements for free-form drawings or insert_excalidraw_diagram for supported structured diagrams.

## Core element specs

- Use rectangle, ellipse, diamond, text, arrow, and line.
- Prefer labeled shapes with label: { text, fontSize } instead of separate text when the label belongs inside a shape.
- Keep body fontSize >= 16 and headings >= 20.
- Keep labeled shapes at least 120x60 with 20-30px gaps.
- Use customData.codex.semanticId for every durable concept you may edit later.
- Draw in reading order: background zone, local node, label, connector, then next node.
- For arrow and line elements, points must be local coordinates relative to x/y. Example: x=100, y=200, points=[[0,0],[300,0]], not [[100,200],[400,200]].
- For flowcharts, use rows or columns with stable spacing. Keep sibling nodes aligned on the same x or y coordinate.
- For charts, reserve a title band, plot area, axis labels, and legend area. Do not mix chart marks with explanatory notes in the same area.
- For dense diagrams, split into sections and add cameraUpdate entries before each section.
- Prefer fewer large elements over many small elements. If a concept needs long text, widen the node instead of shrinking the font.
- Use rendering: { "mode": "progressive" } for user-visible creation when the drawing should appear step by step.
- Targets must stay structural: selected ids, explicit elementIds, comment targets, action targets, or semanticIds.
- For production-like or user-facing diagrams, call visual_validate_excalidraw after insertion to get a local rendered preview and qualityReport.

## Structured sequence diagrams

Use insert_excalidraw_diagram with kind: "sequence" for sequence diagrams, handoff timelines, cross-system message flows, and other lane-based process drawings. Provide structured data instead of hand-placing every x/y coordinate:

- participants: ordered lanes with stable id and label.
- messages: ordered arrows with id, from, to, label, and optional rowGap.
- notes: rectangular annotations attached by afterMessageId, or by lane/from/to.
- gates: diamond decision nodes attached by afterMessageId, or by lane/from/to.

The sequence layout engine computes lane spacing, lifelines, local arrow points, readable text sizes, attachment placement, viewport focus, and semantic ids. Do not use this tool for unrelated free-form diagrams.

## Recommended palette

- Primary blue: #4a9eed
- Amber: #f59e0b
- Green: #22c55e
- Red: #ef4444
- Purple: #8b5cf6
- Light blue fill: #a5d8ff
- Light green fill: #b2f2bb
- Light orange fill: #ffd8a8
- Light purple fill: #d0bfff
- Light yellow fill: #fff3bf
- Light teal fill: #c3fae8

## Structured pseudo elements

These are accepted inside insert_excalidraw_elements.elements and are not drawn.

- cameraUpdate: { "type": "cameraUpdate", "x": 0, "y": 0, "width": 800, "height": 600 }
  Use 4:3 sizes such as 400x300, 600x450, 800x600, 1200x900, or 1600x1200. The live canvas will focus that scene area.

- delete: { "type": "delete", "elementIds": ["element_id"] }
  Removes elements by structural ids and also removes bound labels whose containerId is targeted.

- restoreCheckpoint: { "type": "restoreCheckpoint", "checkpointId": "checkpoint_id" }
  Restores a project-local checkpoint before appending new elements. Use save_excalidraw_checkpoint or list_excalidraw_checkpoints to manage checkpoints.

## Checkpoint workflow

1. Save a checkpoint before risky edits.
2. Restore the checkpoint when the user asks to revise from the prior state.
3. Append new elements instead of re-sending an entire large diagram.

## Layout validation

The live canvas validates and repairs common layout problems before inserting elements:

- labels that would overflow their shape
- text or label font sizes that are too small
- shape dimensions below readable minimums
- low contrast between stroke and fill
- line or arrow points accidentally supplied as absolute canvas coordinates
- overlapping node/text boxes

Read the layoutValidation field returned by insert_excalidraw_elements. If issueCount is high, simplify the diagram or redraw it in sections instead of adding more small elements.
If layoutValidation.needsRedraw is true, do not keep patching the broken batch. Split the drawing into smaller sections or use insert_excalidraw_diagram with an explicit kind.
Read qualityReport for readability, density, and overlap risk. A fail status means the scene should be fixed before user delivery.

## Boundaries

- Do not infer intent from text labels.
- Do not use browser-control clicking as the data path.
- Keep generated files in the active project canvas directory unless the user explicitly exports.
- Use insert_excalidraw_image for generated imagery so image files and Excalidraw file records stay synchronized.`

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function textResult(text, structuredContent = {}) {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

function canvasArgs() {
  return {
    projectDir: {
      type: 'string',
      description: 'Absolute project directory. The tool reads <projectDir>/canvas/excalidraw/.'
    },
    canvasDir: {
      type: 'string',
      description: 'Absolute canvas directory. If provided, this takes precedence over projectDir.'
    },
    apiBaseUrl: {
      type: 'string',
      description: 'Optional local canvas API base URL, for example http://127.0.0.1:43218. If omitted, the MCP tries canvas/excalidraw/session.json and then falls back to files.'
    }
  }
}

function styleSchema() {
  return {
    type: 'object',
    properties: {
      strokeColor: { type: 'string' },
      backgroundColor: { type: 'string' },
      fillStyle: { type: 'string' },
      strokeWidth: { type: 'number' },
      strokeStyle: { type: 'string' },
      roughness: { type: 'number' },
      opacity: { type: 'number' },
      fontSize: { type: 'number' }
    },
    additionalProperties: false
  }
}

function targetSchema() {
  return {
    type: 'object',
    properties: {
      selected: { type: 'boolean' },
      elementIds: { type: 'array', items: { type: 'string' } },
      semanticIds: { type: 'array', items: { type: 'string' } },
      commentId: { type: 'string' }
    },
    additionalProperties: false
  }
}

function sequenceDiagramSchema() {
  const attachmentProperties = {
    id: { type: 'string' },
    text: { type: 'string' },
    lane: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    afterMessageId: { type: 'string' },
    color: { type: 'string' },
    backgroundColor: { type: 'string' }
  }
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      layout: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          laneGap: { type: 'number' },
          participantMinWidth: { type: 'number' },
          participantMaxWidth: { type: 'number' },
          participantHeight: { type: 'number' },
          rowGap: { type: 'number' },
          noteMaxWidth: { type: 'number' },
          gateWidth: { type: 'number' },
          gateHeight: { type: 'number' }
        },
        additionalProperties: false
      },
      participants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            color: { type: 'string' }
          },
          required: ['id', 'label'],
          additionalProperties: false
        }
      },
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            label: { type: 'string' },
            color: { type: 'string' },
            rowGap: { type: 'number' }
          },
          required: ['id', 'from', 'to', 'label'],
          additionalProperties: false
        }
      },
      notes: {
        type: 'array',
        items: {
          type: 'object',
          properties: attachmentProperties,
          required: ['id', 'text'],
          additionalProperties: false
        }
      },
      gates: {
        type: 'array',
        items: {
          type: 'object',
          properties: attachmentProperties,
          required: ['id', 'text'],
          additionalProperties: false
        }
      }
    },
    required: ['participants', 'messages'],
    additionalProperties: false
  }
}

function graphDiagramSchema() {
  const stringArray = {
    type: 'array',
    items: { type: 'string' }
  }
  const sectionSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      items: stringArray
    },
    additionalProperties: false
  }
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      layout: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          algorithm: { type: 'string', enum: ['layered', 'stress', 'mrtree', 'force'] },
          direction: { type: 'string', enum: ['RIGHT', 'LEFT', 'DOWN', 'UP'] },
          nodeSpacing: { type: 'number' },
          layerSpacing: { type: 'number' },
          minNodeWidth: { type: 'number' },
          minNodeHeight: { type: 'number' },
          maxNodeWidth: { type: 'number' }
        },
        additionalProperties: false
      },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            shape: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond'] },
            color: { type: 'string' },
            strokeColor: { type: 'string' },
            role: { type: 'string' },
            details: stringArray,
            fields: stringArray,
            attributes: stringArray,
            sections: {
              type: 'array',
              items: sectionSchema
            },
            metadata: { type: 'object', additionalProperties: true }
          },
          required: ['id', 'label'],
          additionalProperties: false
        }
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            label: { type: 'string' },
            color: { type: 'string' },
            dashed: { type: 'boolean' },
            role: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true }
          },
          required: ['id', 'from', 'to'],
          additionalProperties: false
        }
      },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['nodes', 'edges'],
    additionalProperties: false
  }
}

function diagramSchema() {
  return {
    oneOf: [
      sequenceDiagramSchema(),
      graphDiagramSchema()
    ]
  }
}

function annotations(readOnly = false) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: readOnly,
    openWorldHint: false
  }
}

function toolDefinitions() {
  const baseArgs = canvasArgs()
  return [
    {
      name: Tools.READ_DRAWING_GUIDE,
      title: 'Read Excalidraw Drawing Guide',
      description: 'Return the Codex Excalidraw drawing format guide, palette, pseudo-element protocol, checkpoint workflow, and project-boundary rules. Call this once before substantial drawing.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.OPEN_CANVAS,
      title: 'Open Excalidraw Canvas',
      description: 'Start or reuse the visible local Codex Excalidraw canvas service for a project and return the live URL. Call this before user-visible drawing, editing, image insertion, selection-based work, or export workflows.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          name: {
            type: 'string',
            description: 'Optional display name for the project in the canvas project switcher.'
          }
        },
        required: ['projectDir'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.GET_SELECTION,
      title: 'Get Excalidraw Selection',
      description: 'Return the current Codex Excalidraw selection saved by the local canvas.',
      inputSchema: {
        type: 'object',
        properties: baseArgs,
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.GET_SCENE,
      title: 'Get Excalidraw Scene',
      description: 'Return a summary of the current Codex Excalidraw scene. Set includeElements to true only when element-level inspection is required.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          includeElements: { type: 'boolean' }
        },
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.GET_COMMENTS,
      title: 'Get Excalidraw Comments',
      description: 'Return structured comments saved for the current canvas.',
      inputSchema: {
        type: 'object',
        properties: baseArgs,
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.GET_PENDING_ACTIONS,
      title: 'Get Pending Excalidraw Actions',
      description: 'Return queued or running actions submitted from the Excalidraw page. Use this after the user clicks Run with Codex on a comment.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          includeRunning: {
            type: 'boolean',
            description: 'Default true. Include actions already claimed as running.'
          },
          includeCompleted: {
            type: 'boolean',
            description: 'Default false. Include completed, failed, or canceled actions for audit.'
          }
        },
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.CLAIM_ACTION,
      title: 'Claim Excalidraw Action',
      description: 'Mark a queued Excalidraw action as running before executing its instruction with structured canvas tools.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          actionId: { type: 'string' },
          claimedBy: { type: 'string' }
        },
        required: ['actionId'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.COMPLETE_ACTION,
      title: 'Complete Excalidraw Action',
      description: 'Mark an Excalidraw action completed, failed, or canceled. Completed comment actions resolve their comment by default.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          actionId: { type: 'string' },
          status: { type: 'string', enum: ['completed', 'failed', 'canceled'] },
          resolveComment: {
            type: 'boolean',
            description: 'Default true for completed actions with a commentId.'
          },
          result: { type: 'object', additionalProperties: true },
          error: { type: 'string' }
        },
        required: ['actionId'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.GET_SESSION,
      title: 'Get Excalidraw Session',
      description: 'Return the active local canvas session, active project, and recent projects when the canvas API is running.',
      inputSchema: {
        type: 'object',
        properties: baseArgs,
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.SWITCH_PROJECT,
      title: 'Switch Excalidraw Project',
      description: 'Switch the live local canvas API to a project directory and return the updated session. Use this before multi-turn work on a previously opened project.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          projectDir: {
            type: 'string',
            description: 'Absolute project directory to activate in the live canvas service.'
          },
          name: {
            type: 'string',
            description: 'Optional display name for the recent project registry.'
          }
        },
        required: ['projectDir'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.INSERT_ELEMENTS,
      title: 'Insert Excalidraw Elements',
      description: 'Insert editable Excalidraw element specs into the scene. This is the primary Codex-to-canvas drawing path.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          batchId: { type: 'string' },
          rendering: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['immediate', 'progressive'] },
              stepDelayMs: { type: 'number' },
              maxSteps: { type: 'number' }
            },
            additionalProperties: false
          },
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line', 'cameraUpdate', 'delete', 'restoreCheckpoint'] },
                semanticId: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
                checkpointId: { type: 'string' },
                elementIds: { type: 'array', items: { type: 'string' } },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
                text: { type: 'string' },
                label: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      properties: {
                        text: { type: 'string' },
                        fontSize: { type: 'number' },
                        semanticId: { type: 'string' }
                      },
                      additionalProperties: false
                    }
                  ]
                },
                style: styleSchema(),
                customData: { type: 'object', additionalProperties: true }
              },
              required: ['type'],
              additionalProperties: false
            }
          }
        },
        required: ['elements'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.INSERT_DIAGRAM,
      title: 'Insert Excalidraw Diagram',
      description: 'Insert a supported structured diagram through a layout engine and shared Excalidraw renderer. Use kind=sequence for lane-based sequence diagrams; use flowchart, graph, class, er, state, or mindmap for node-edge diagrams. Do not hand-place every node or arrow.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          batchId: { type: 'string' },
          sourceFormat: { type: 'string', enum: ['ir'] },
          kind: { type: 'string', enum: ['sequence', 'flowchart', 'graph', 'class', 'er', 'state', 'mindmap'] },
          rendering: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['immediate', 'progressive'] },
              stepDelayMs: { type: 'number' },
              maxSteps: { type: 'number' }
            },
            additionalProperties: false
          },
          diagram: diagramSchema()
        },
        required: ['kind', 'diagram'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.INSERT_IMAGE,
      title: 'Insert Excalidraw Image',
      description: 'Insert a local image file or image data URL as an Excalidraw image element. Targets are selected elements, explicit element ids, semantic ids, or comment target ids.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          batchId: { type: 'string' },
          semanticId: { type: 'string' },
          target: targetSchema(),
          image: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              dataURL: { type: 'string' },
              mimeType: { type: 'string' },
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' }
            },
            additionalProperties: false
          },
          placement: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              angle: { type: 'number' },
              margin: { type: 'number' },
              fit: { type: 'string', enum: ['contain', 'cover', 'stretch'] },
              alignX: { type: 'string', enum: ['left', 'center', 'right'] },
              alignY: { type: 'string', enum: ['top', 'center', 'bottom'] },
              locked: { type: 'boolean' },
              opacity: { type: 'number' }
            },
            additionalProperties: false
          },
          customData: { type: 'object', additionalProperties: true }
        },
        required: ['image'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.UPDATE_ELEMENTS,
      title: 'Update Excalidraw Elements',
      description: 'Patch selected, explicitly named, comment-targeted, or semantic-id-targeted elements. Targets are structural; fuzzy text matching is intentionally unsupported.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          target: targetSchema(),
          patch: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              angle: { type: 'number' },
              locked: { type: 'boolean' },
              strokeColor: { type: 'string' },
              backgroundColor: { type: 'string' },
              fillStyle: { type: 'string' },
              strokeWidth: { type: 'number' },
              strokeStyle: { type: 'string' },
              roughness: { type: 'number' },
              opacity: { type: 'number' },
              text: { type: 'string' },
              labelText: { type: 'string' },
              customData: { type: 'object', additionalProperties: true }
            },
            additionalProperties: false
          }
        },
        required: ['target', 'patch'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.DELETE_ELEMENTS,
      title: 'Delete Excalidraw Elements',
      description: 'Mark selected, explicitly named, comment-targeted, or semantic-id-targeted elements as deleted. Use target.commentId to execute delete comments.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          target: targetSchema(),
          resolveCommentId: {
            type: 'string',
            description: 'Optional comment id to resolve after deleting its targets.'
          }
        },
        required: ['target'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.ADD_COMMENT,
      title: 'Add Excalidraw Comment',
      description: 'Add a structured comment to selected or explicit target elements.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          target: targetSchema(),
          targetElementIds: { type: 'array', items: { type: 'string' } },
          body: { type: 'string' },
          createdBy: { type: 'string' }
        },
        required: ['body'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.RESOLVE_COMMENT,
      title: 'Resolve Excalidraw Comment',
      description: 'Mark a structured canvas comment as resolved.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          commentId: { type: 'string' }
        },
        required: ['commentId'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.APPLY_COMMENT_PATCH,
      title: 'Apply Excalidraw Comment Patch',
      description: 'Patch the elements targeted by a comment and resolve the comment by default.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          commentId: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              strokeColor: { type: 'string' },
              backgroundColor: { type: 'string' },
              text: { type: 'string' },
              labelText: { type: 'string' },
              customData: { type: 'object', additionalProperties: true }
            },
            additionalProperties: false
          },
          resolve: { type: 'boolean' }
        },
        required: ['commentId', 'patch'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.SAVE_CHECKPOINT,
      title: 'Save Excalidraw Checkpoint',
      description: 'Save the current scene as a project-local checkpoint before risky or iterative edits.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          checkpointId: { type: 'string' },
          label: { type: 'string' }
        },
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.LIST_CHECKPOINTS,
      title: 'List Excalidraw Checkpoints',
      description: 'List project-local Excalidraw checkpoints for the active canvas.',
      inputSchema: {
        type: 'object',
        properties: baseArgs,
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.RESTORE_CHECKPOINT,
      title: 'Restore Excalidraw Checkpoint',
      description: 'Restore a project-local Excalidraw checkpoint into the current scene.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          checkpointId: { type: 'string' }
        },
        required: ['checkpointId'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.FOCUS_VIEWPORT,
      title: 'Focus Excalidraw Viewport',
      description: 'Ask the visible canvas to focus a scene rectangle without changing scene content. Use after large drawing operations or when guiding attention.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          viewport: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' }
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false
          },
          message: { type: 'string' }
        },
        required: ['viewport'],
        additionalProperties: false
      },
      annotations: annotations(false)
    },
    {
      name: Tools.VISUAL_VALIDATE,
      title: 'Visual Validate Excalidraw',
      description: 'Render or inspect the current Excalidraw scene and return a local quality report. Uses the live browser renderer when available; otherwise returns degraded file-backed diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          batchId: { type: 'string' },
          fileNameBase: { type: 'string' },
          elementIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional explicit element ids to validate. Omit to validate the current scene.'
          },
          viewport: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' }
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false
          }
        },
        additionalProperties: false
      },
      annotations: annotations(true)
    },
    {
      name: Tools.EXPORT_SCENE,
      title: 'Export Excalidraw Scene',
      description: 'Export the current scene to .excalidraw, JSON, or basic SVG files under canvas/excalidraw/exports. PNG remains a browser-renderer UI export.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseArgs,
          formats: {
            type: 'array',
            items: { type: 'string', enum: ['excalidraw', 'json', 'svg', 'png'] }
          },
          fileNameBase: { type: 'string' }
        },
        additionalProperties: false
      },
      annotations: annotations(false)
    }
  ]
}

function normalizeApiBaseUrl(value) {
  const url = nonEmptyString(value)
  if (!url) return null
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end -= 1
  return url.slice(0, end)
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJsonResponse(url, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      payload
    }
  } finally {
    clearTimeout(timeout)
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function appendLimited(current, chunk, limit = 16_000) {
  const next = `${current}${chunk.toString()}`
  return next.length > limit ? next.slice(next.length - limit) : next
}

function canvasDirMatches(session, canvasDir) {
  const sessionCanvasDir = nonEmptyString(session?.canvasDir)
  return Boolean(sessionCanvasDir) && resolve(sessionCanvasDir) === resolve(canvasDir)
}

function projectDirFromOpenArgs(args) {
  const projectDir = nonEmptyString(args.projectDir)
  if (!projectDir) throw new Error('projectDir is required to open a visible Excalidraw canvas.')
  return resolve(projectDir)
}

async function waitForCanvasSession(apiBaseUrl, canvasDir, timeoutMs = START_CANVAS_TIMEOUT_MS) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await fetchJson(`${apiBaseUrl}/api/session`, {}, 1_500)
      if (canvasDirMatches(payload.session, canvasDir)) return payload
      lastError = new Error(`Live canvas is serving ${payload.session?.canvasDir ?? 'an unknown canvas directory'}.`)
    } catch (error) {
      lastError = error
    }
    await sleep(300)
  }
  throw new Error(`Canvas service did not become ready for ${canvasDir}.${lastError ? ` Last error: ${lastError.message}` : ''}`)
}

async function tryOpenViaApi(args, canvasDir, projectDir) {
  const { apiBaseUrl } = await resolveSessionApi(args, canvasDir)
  if (!apiBaseUrl) return null

  try {
    const payload = await fetchJson(`${apiBaseUrl}/api/session`, {}, 1_500)
    if (canvasDirMatches(payload.session, canvasDir)) {
      return { payload, source: 'api', apiBaseUrl, status: 'reused', started: false }
    }
    const switchedPayload = await fetchJson(`${apiBaseUrl}/api/session`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectDir, name: args.name })
    }, 2_500)
    if (canvasDirMatches(switchedPayload.session, canvasDir)) {
      return { payload: switchedPayload, source: 'api', apiBaseUrl, status: 'switched', started: false }
    }
  } catch {
    return null
  }

  return null
}

async function startCanvasService(args, canvasDir, projectDir) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(START_CANVAS_SCRIPT, [projectDir], {
      cwd: PLUGIN_ROOT,
      detached: true,
      env: {
        ...process.env,
        CODEX_EXCALIDRAW_PROJECT_DIR: projectDir,
        CODEX_EXCALIDRAW_CANVAS_DIR: canvasDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      rejectStart(new Error(`Timed out starting Codex Excalidraw canvas. ${stderr || stdout}`))
    }, START_CANVAS_TIMEOUT_MS)

    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    const handleLine = (line) => {
      if (!line.startsWith(START_CANVAS_PREFIX)) return
      const apiBaseUrl = normalizeApiBaseUrl(line.slice(START_CANVAS_PREFIX.length))
      if (!apiBaseUrl) return
      waitForCanvasSession(apiBaseUrl, canvasDir)
        .then((payload) => {
          finish(() => {
            child.unref()
            resolveStart({ payload, source: 'api', apiBaseUrl, status: 'started', started: true, pid: child.pid })
          })
        })
        .catch((error) => {
          finish(() => rejectStart(error))
        })
    }

    child.stdout.on('data', (chunk) => {
      stdout = appendLimited(stdout, chunk)
      lineBuffer += chunk.toString()
      let newlineIndex = lineBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex)
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        handleLine(line.trim())
        newlineIndex = lineBuffer.indexOf('\n')
      }
    })

    child.stderr.on('data', (chunk) => {
      stderr = appendLimited(stderr, chunk)
    })

    child.on('error', (error) => {
      finish(() => rejectStart(error))
    })

    child.on('exit', (code) => {
      if (settled) return
      finish(() => rejectStart(new Error(`Codex Excalidraw canvas exited before becoming ready with code ${code}. ${stderr || stdout}`)))
    })
  })
}

async function openCanvasTarget(args, canvasDir) {
  const projectDir = projectDirFromOpenArgs(args)
  const normalizedCanvasDir = resolve(canvasDir)
  const normalizedArgs = { ...args, projectDir }

  const existing = await tryOpenViaApi(normalizedArgs, normalizedCanvasDir, projectDir)
  if (existing) return { ...existing, canvasDir: normalizedCanvasDir, projectDir }

  const started = await startCanvasService(normalizedArgs, normalizedCanvasDir, projectDir)
  return { ...started, canvasDir: normalizedCanvasDir, projectDir }
}

async function apiCandidates(args, canvasDir) {
  if (args.preferApi === false) return { explicit: false, urls: [] }
  const explicit = normalizeApiBaseUrl(args.apiBaseUrl) ?? normalizeApiBaseUrl(process.env.CODEX_EXCALIDRAW_API_URL)
  if (explicit) return { explicit: true, urls: [explicit] }

  const { sessionFile } = canvasPaths(canvasDir)
  const session = await readJsonFile(sessionFile, null)
  const sessionUrl = normalizeApiBaseUrl(session?.apiBaseUrl)
  return { explicit: false, urls: sessionUrl ? [sessionUrl] : [] }
}

async function resolveSessionApi(args, canvasDir) {
  const { explicit, urls } = await apiCandidates(args, canvasDir)
  if (urls.length > 0) return { apiBaseUrl: urls[0], explicit }
  return { apiBaseUrl: null, explicit }
}

async function readSessionTarget(args, canvasDir) {
  const { apiBaseUrl, explicit } = await resolveSessionApi(args, canvasDir)
  if (apiBaseUrl) {
    try {
      const payload = await fetchJson(`${apiBaseUrl}/api/session`)
      return { payload, source: 'api', apiBaseUrl }
    } catch (error) {
      if (explicit) throw error
    }
  }

  const { sessionFile } = canvasPaths(canvasDir)
  const session = await readJsonFile(sessionFile, null)
  if (session) {
    return {
      payload: {
        session,
        projects: []
      },
      source: 'file',
      apiBaseUrl: session.apiBaseUrl ?? null
    }
  }

  return {
    payload: {
      session: null,
      projects: []
    },
    source: 'none',
    apiBaseUrl: null
  }
}

async function switchProjectTarget(args, canvasDir) {
  const projectDir = nonEmptyString(args.projectDir)
  if (!projectDir) throw new Error('projectDir is required.')
  const { apiBaseUrl } = await resolveSessionApi(args, canvasDir)
  if (!apiBaseUrl) {
    throw new Error('No live canvas API found. Start the canvas first or pass apiBaseUrl.')
  }
  const payload = await fetchJson(`${apiBaseUrl}/api/session`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectDir, name: args.name })
  }, 2_500)
  return { payload, source: 'api', apiBaseUrl }
}

async function resolveLiveApi(args, canvasDir) {
  const { explicit, urls } = await apiCandidates(args, canvasDir)
  for (const apiBaseUrl of urls) {
    try {
      const payload = await fetchJson(`${apiBaseUrl}/api/scene`)
      const payloadCanvasDir = payload?.canvasDir ? resolve(payload.canvasDir) : null
      if (payloadCanvasDir && payloadCanvasDir !== resolve(canvasDir)) {
        if (explicit) {
          throw new Error(`Canvas API points at ${payloadCanvasDir}, not ${resolve(canvasDir)}.`)
        }
        continue
      }
      return { apiBaseUrl, scene: payload.scene }
    } catch (error) {
      if (explicit) throw error
    }
  }
  return null
}

async function readSceneTarget(args, canvasDir) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (liveApi?.scene) return { scene: liveApi.scene, source: 'api', apiBaseUrl: liveApi.apiBaseUrl }
  const scene = await readSceneFile(canvasDir)
  return { scene, source: 'file', apiBaseUrl: null }
}

async function writeSceneTarget(args, canvasDir, scene) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (liveApi?.apiBaseUrl) {
    await fetchJson(`${liveApi.apiBaseUrl}/api/scene`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scene)
    }, 2_500)
    const { sceneFile } = canvasPaths(canvasDir)
    return { source: 'api', apiBaseUrl: liveApi.apiBaseUrl, sceneFile }
  }
  return { source: 'file', ...(await writeSceneFile(canvasDir, scene)) }
}

async function insertElementsViaNativeApi(args, canvasDir) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (!liveApi?.apiBaseUrl) return null

  const createResponse = await fetchJsonResponse(`${liveApi.apiBaseUrl}/api/native-elements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      batchId: args.batchId,
      rendering: args.rendering,
      elements: args.elements
    })
  }, 1_500)

  if (createResponse.status === 404 || createResponse.status === 409) {
    return null
  }
  if (!createResponse.ok) {
    const message = createResponse.payload?.error ?? `${createResponse.status} ${createResponse.statusText}`
    throw new Error(`Native Excalidraw conversion request failed: ${message}`)
  }

  const requestId = createResponse.payload?.request?.id
  if (!requestId) throw new Error('Native Excalidraw conversion did not return a request id.')

  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(100)
    const pollResponse = await fetchJsonResponse(`${liveApi.apiBaseUrl}/api/native-elements/${encodeURIComponent(requestId)}`, {}, 1_000)
    if (!pollResponse.ok) {
      const message = pollResponse.payload?.error ?? `${pollResponse.status} ${pollResponse.statusText}`
      throw new Error(`Native Excalidraw conversion poll failed: ${message}`)
    }

    const request = pollResponse.payload?.request
    if (request?.status === 'completed') {
      const { sceneFile } = canvasPaths(canvasDir)
      return {
        batchId: request.result?.batchId ?? args.batchId ?? null,
        insertedElementIds: Array.isArray(request.result?.insertedElementIds) ? request.result.insertedElementIds : [],
        insertedElementTypes: Array.isArray(request.result?.insertedElementTypes) ? request.result.insertedElementTypes : [],
        layoutValidation: request.result?.layoutValidation ?? null,
        qualityReport: request.result?.qualityReport ?? null,
        rendering: request.result?.rendering ?? null,
        source: 'api',
        apiBaseUrl: liveApi.apiBaseUrl,
        sceneFile,
        nativeConversion: true
      }
    }
    if (request?.status === 'failed') {
      throw new Error(`Native Excalidraw conversion failed: ${request.error ?? 'Unknown error.'}`)
    }
  }

  throw new Error(`Native Excalidraw conversion timed out: ${requestId}`)
}

function shouldRequireVisibleCanvasRuntime(args, elementSpecs, directives) {
  if (args.preferApi === false) return false
  if (elementSpecs.length === 0) return false
  return !Boolean(directives.checkpointId) && directives.deleteIds.length === 0
}

async function focusViewportViaApi(args, canvasDir, viewport, message) {
  if (!viewport || typeof viewport !== 'object') return null
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (!liveApi?.apiBaseUrl) return null

  const response = await fetchJsonResponse(`${liveApi.apiBaseUrl}/api/viewport`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ viewport, message })
  }, 1_500)

  if (response.status === 404 || response.status === 409) return null
  if (!response.ok) {
    const errorMessage = response.payload?.error ?? `${response.status} ${response.statusText}`
    throw new Error(`Viewport focus request failed: ${errorMessage}`)
  }
  return {
    source: 'api',
    apiBaseUrl: liveApi.apiBaseUrl,
    request: response.payload?.request ?? null
  }
}

function explicitElementIds(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const output = []
  for (const item of value) {
    const text = nonEmptyString(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    output.push(text)
  }
  return output
}

function scopedElements(scene, elementIds) {
  const ids = explicitElementIds(elementIds)
  if (ids.length === 0) return scene?.elements ?? []
  const wanted = new Set(ids)
  return (scene?.elements ?? []).filter((element) => wanted.has(element.id) || wanted.has(element.containerId))
}

async function visualValidateViaApi(args, canvasDir) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (!liveApi?.apiBaseUrl) return null

  const response = await fetchJsonResponse(`${liveApi.apiBaseUrl}/api/visual-validation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      batchId: args.batchId,
      fileNameBase: args.fileNameBase,
      elementIds: explicitElementIds(args.elementIds),
      viewport: args.viewport
    })
  }, 1_500)

  if (response.status === 404 || response.status === 409) return null
  if (!response.ok) {
    const errorMessage = response.payload?.error ?? `${response.status} ${response.statusText}`
    throw new Error(`Visual validation request failed: ${errorMessage}`)
  }
  const requestId = response.payload?.request?.id
  if (!requestId) throw new Error('Visual validation did not return a request id.')

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(100)
    const pollResponse = await fetchJsonResponse(`${liveApi.apiBaseUrl}/api/visual-validation/${encodeURIComponent(requestId)}`, {}, 1_000)
    if (!pollResponse.ok) {
      const message = pollResponse.payload?.error ?? `${pollResponse.status} ${pollResponse.statusText}`
      throw new Error(`Visual validation poll failed: ${message}`)
    }
    const request = pollResponse.payload?.request
    if (request?.status === 'completed') {
      return {
        ...request.result,
        requestId,
        sourceMode: 'api',
        apiBaseUrl: liveApi.apiBaseUrl,
        degraded: false
      }
    }
    if (request?.status === 'failed') {
      throw new Error(`Visual validation failed: ${request.error ?? 'Unknown error.'}`)
    }
  }

  throw new Error(`Visual validation timed out: ${requestId}`)
}

async function visualValidateFileBacked(args, canvasDir) {
  const scene = await readSceneFile(canvasDir)
  const elements = scopedElements(scene, args.elementIds)
  const qualityReport = explicitElementIds(args.elementIds).length > 0
    ? qualityReportForElements(elements)
    : qualityReportForScene(scene)
  const exportResult = await exportScene(canvasDir, {
    ...scene,
    elements
  }, {
    formats: ['svg'],
    fileNameBase: args.fileNameBase ?? args.batchId ?? `visual-validation-${Date.now().toString(36)}`
  })
  const svgExport = exportResult.exported.find((item) => item.format === 'svg') ?? null
  return {
    renderer: 'basic-svg',
    degraded: true,
    reason: 'Live browser renderer was unavailable; returned file-backed quality diagnostics and a basic SVG preview.',
    filePath: svgExport?.filePath ?? null,
    elementCount: elements.length,
    qualityReport,
    sourceMode: 'file',
    apiBaseUrl: null
  }
}

async function readCommentsTarget(args, canvasDir) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (liveApi?.apiBaseUrl) {
    try {
      const payload = await fetchJson(`${liveApi.apiBaseUrl}/api/comments`)
      return { comments: payload.comments ?? emptyComments(), source: 'api', apiBaseUrl: liveApi.apiBaseUrl }
    } catch {
      // Fall back to files if comments API is unavailable while scene API is live.
    }
  }
  return { comments: await readCommentsFile(canvasDir), source: 'file', apiBaseUrl: null }
}

async function writeCommentsTarget(args, canvasDir, comments) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (liveApi?.apiBaseUrl) {
    await fetchJson(`${liveApi.apiBaseUrl}/api/comments`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(comments)
    }, 2_500)
    const { commentsFile } = canvasPaths(canvasDir)
    return { source: 'api', apiBaseUrl: liveApi.apiBaseUrl, commentsFile }
  }
  return { source: 'file', ...(await writeCommentsFile(canvasDir, comments)) }
}

async function readActionsTarget(args, canvasDir) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (liveApi?.apiBaseUrl) {
    try {
      const payload = await fetchJson(`${liveApi.apiBaseUrl}/api/actions`)
      return { actions: payload.actions ?? emptyActions(), source: 'api', apiBaseUrl: liveApi.apiBaseUrl }
    } catch {
      // Fall back to files if actions API is unavailable while scene API is live.
    }
  }
  return { actions: await readActionsFile(canvasDir), source: 'file', apiBaseUrl: null }
}

async function writeActionsTarget(args, canvasDir, actions) {
  const liveApi = await resolveLiveApi(args, canvasDir)
  if (liveApi?.apiBaseUrl) {
    await fetchJson(`${liveApi.apiBaseUrl}/api/actions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(actions)
    }, 2_500)
    const { actionsFile } = canvasPaths(canvasDir)
    return { source: 'api', apiBaseUrl: liveApi.apiBaseUrl, actionsFile }
  }
  return { source: 'file', ...(await writeActionsFile(canvasDir, actions)) }
}

function summarizeSelection(selection) {
  const selectedElements = selection.selectedElements ?? []
  if (selectedElements.length === 0) return 'No Excalidraw elements are currently selected.'
  return selectedElements.map((element) => `${element.id} [${element.type}]`).join('\n')
}

function ensureTarget(args) {
  if (!args.target || typeof args.target !== 'object') {
    throw new Error('target is required. Use selected, elementIds, semanticIds, or commentId.')
  }
  return args.target
}

async function handleToolCall(id, params) {
  const args = params.arguments ?? {}
  const canvasDir = resolveCanvasDir(args)
  const paths = canvasPaths(canvasDir)

  if (params?.name === Tools.READ_DRAWING_GUIDE) {
    sendResult(id, textResult(DRAWING_GUIDE, { guideVersion: 2 }))
    return
  }

  if (params?.name === Tools.OPEN_CANVAS) {
    const result = await openCanvasTarget(args, canvasDir)
    sendResult(
      id,
      textResult(`Codex Excalidraw canvas ${result.status} at ${result.apiBaseUrl}.`, {
        ...result.payload,
        sourceMode: result.source,
        apiBaseUrl: result.apiBaseUrl,
        canvasDir: result.canvasDir,
        projectDir: result.projectDir,
        sessionFile: canvasPaths(result.canvasDir).sessionFile,
        started: result.started,
        status: result.status,
        pid: result.pid ?? null
      })
    )
    return
  }

  if (params?.name === Tools.GET_SELECTION) {
    const selection = await readSelectionFile(canvasDir)
    sendResult(id, textResult(summarizeSelection(selection), { selection, canvasDir, selectionFile: paths.selectionFile }))
    return
  }

  if (params?.name === Tools.GET_SCENE) {
    const { scene, source, apiBaseUrl } = await readSceneTarget(args, canvasDir)
    const summary = summarizeScene(scene)
    const structuredContent = {
      ...summary,
      sourceMode: source,
      apiBaseUrl,
      canvasDir,
      sceneFile: paths.sceneFile
    }
    if (args.includeElements === true) {
      structuredContent.elements = scene.elements
      structuredContent.files = scene.files
    }
    sendResult(id, textResult(`Scene has ${summary.visibleElementCount} visible elements and ${summary.fileCount} files.`, structuredContent))
    return
  }

  if (params?.name === Tools.GET_COMMENTS) {
    const { comments, source, apiBaseUrl } = await readCommentsTarget(args, canvasDir)
    sendResult(id, textResult(`Canvas has ${comments.comments.length} comments.`, { comments, sourceMode: source, apiBaseUrl, canvasDir, commentsFile: paths.commentsFile }))
    return
  }

  if (params?.name === Tools.GET_PENDING_ACTIONS) {
    const { actions, source, apiBaseUrl } = await readActionsTarget(args, canvasDir)
    const filtered = pendingActions(actions, {
      includeRunning: args.includeRunning !== false,
      includeCompleted: args.includeCompleted === true
    })
    const queuedCount = filtered.actions.filter((action) => action.status === 'queued').length
    const runningCount = filtered.actions.filter((action) => action.status === 'running').length
    sendResult(
      id,
      textResult(`Canvas has ${queuedCount} queued actions and ${runningCount} running actions.`, {
        actions: filtered,
        sourceMode: source,
        apiBaseUrl,
        canvasDir,
        actionsFile: paths.actionsFile
      })
    )
    return
  }

  if (params?.name === Tools.CLAIM_ACTION) {
    const actionsTarget = await readActionsTarget(args, canvasDir)
    const result = claimAction(actionsTarget.actions, args.actionId, { claimedBy: args.claimedBy })
    const writeResult = await writeActionsTarget(args, canvasDir, result.actions)
    sendResult(
      id,
      textResult(`Claimed Excalidraw action ${result.action.id}.`, {
        action: result.action,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        actionsFile: paths.actionsFile
      })
    )
    return
  }

  if (params?.name === Tools.COMPLETE_ACTION) {
    const actionsTarget = await readActionsTarget(args, canvasDir)
    const result = completeAction(actionsTarget.actions, args.actionId, {
      status: args.status ?? 'completed',
      result: args.result,
      error: args.error
    })
    const writeResult = await writeActionsTarget(args, canvasDir, result.actions)
    let commentStatus = null
    if (result.action.commentId && result.action.status === 'completed' && args.resolveComment !== false) {
      const commentsTarget = await readCommentsTarget(args, canvasDir)
      const nextComments = resolveComment(commentsTarget.comments, result.action.commentId)
      await writeCommentsTarget(args, canvasDir, nextComments)
      commentStatus = nextComments.comments.find((comment) => comment.id === result.action.commentId)?.status ?? null
    }
    sendResult(
      id,
      textResult(`Completed Excalidraw action ${result.action.id} as ${result.action.status}.`, {
        action: result.action,
        resolvedCommentId: commentStatus ? result.action.commentId : null,
        commentStatus,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        actionsFile: paths.actionsFile,
        commentsFile: paths.commentsFile
      })
    )
    return
  }

  if (params?.name === Tools.GET_SESSION) {
    const { payload, source, apiBaseUrl } = await readSessionTarget(args, canvasDir)
    const projectText = payload.session?.projectDir ? `Active Excalidraw project: ${payload.session.projectDir}` : 'No active Excalidraw session was found.'
    sendResult(id, textResult(projectText, { ...payload, sourceMode: source, apiBaseUrl, canvasDir, sessionFile: paths.sessionFile }))
    return
  }

  if (params?.name === Tools.SWITCH_PROJECT) {
    const { payload, source, apiBaseUrl } = await switchProjectTarget(args, canvasDir)
    sendResult(
      id,
      textResult(`Switched Excalidraw canvas to ${payload.session.projectDir}.`, {
        ...payload,
        sourceMode: source,
        apiBaseUrl
      })
    )
    return
  }

  if (params?.name === Tools.INSERT_ELEMENTS) {
    const { elementSpecs, directives } = splitElementSpecsAndDirectives(args.elements)
    const hasSceneDirectives = Boolean(directives.checkpointId) || directives.deleteIds.length > 0
    const insertArgs = { ...args, elements: elementSpecs }
    const requiresVisibleRuntime = shouldRequireVisibleCanvasRuntime(args, elementSpecs, directives)

    if (directives.checkpointId) {
      const checkpointTarget = await readCheckpoint(canvasDir, directives.checkpointId)
      await writeSceneTarget(args, canvasDir, checkpointTarget.checkpoint.scene)
    }

    const nativeResult = !hasSceneDirectives && elementSpecs.length > 0
      ? await insertElementsViaNativeApi(insertArgs, canvasDir)
      : null
    if (nativeResult) {
      const viewportResult = await focusViewportViaApi(args, canvasDir, directives.viewport, 'Codex focused the requested area.')
      sendResult(
        id,
        textResult(`Inserted ${nativeResult.insertedElementIds.length} Excalidraw elements with native conversion.`, {
          batchId: nativeResult.batchId,
          insertedElementIds: nativeResult.insertedElementIds,
          insertedElementTypes: nativeResult.insertedElementTypes,
          layoutValidation: nativeResult.layoutValidation,
          qualityReport: nativeResult.qualityReport,
          rendering: nativeResult.rendering,
          deletedElementIds: [],
          viewport: directives.viewport,
          viewportFocus: viewportResult,
          restoredCheckpointId: null,
          sourceMode: nativeResult.source,
          apiBaseUrl: nativeResult.apiBaseUrl,
          canvasDir,
          sceneFile: nativeResult.sceneFile,
          nativeConversion: true
        })
      )
      return
    }
    if (requiresVisibleRuntime) {
      throw new Error(VISIBLE_CANVAS_RUNTIME_REQUIRED_MESSAGE)
    }

    const { scene } = await readSceneTarget(args, canvasDir)
    const result = insertElementSpecs(scene, args.elements, { batchId: args.batchId })
    const writeResult = await writeSceneTarget(args, canvasDir, result.scene)
    const viewportResult = await focusViewportViaApi(args, canvasDir, result.viewport, 'Codex focused the requested area.')
    sendResult(
      id,
      textResult(`Inserted ${result.insertedElements.length} Excalidraw elements.`, {
        batchId: result.batchId,
        insertedElementIds: result.insertedElements.map((element) => element.id),
        insertedElementTypes: result.insertedElements.map((element) => element.type),
        deletedElementIds: result.deletedElementIds,
        layoutValidation: result.layoutValidation,
        qualityReport: result.qualityReport,
        viewport: result.viewport,
        viewportFocus: viewportResult,
        restoredCheckpointId: directives.checkpointId ?? null,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        sceneFile: paths.sceneFile,
        nativeConversion: false
      })
    )
    return
  }

  if (params?.name === Tools.INSERT_DIAGRAM) {
    if (args.sourceFormat && args.sourceFormat !== 'ir') {
      throw new Error('insert_excalidraw_diagram currently supports sourceFormat: "ir".')
    }
    const diagram = await layoutDiagram(args.kind, args.diagram, { batchId: args.batchId })
    const insertArgs = { ...args, elements: diagram.elements }
    const requiresVisibleRuntime = shouldRequireVisibleCanvasRuntime(args, diagram.elements, {
      checkpointId: null,
      deleteIds: []
    })
    const nativeResult = diagram.elements.length > 0 ? await insertElementsViaNativeApi(insertArgs, canvasDir) : null
    if (nativeResult) {
      const viewportResult = await focusViewportViaApi(args, canvasDir, diagram.viewport, 'Codex focused the diagram.')
      sendResult(
        id,
        textResult(`Inserted ${nativeResult.insertedElementIds.length} Excalidraw ${diagram.kind} diagram elements with native conversion.`, {
          batchId: nativeResult.batchId,
          kind: diagram.kind,
          sourceFormat: diagram.sourceFormat ?? 'ir',
          diagramLayout: diagram.layout,
          insertedElementIds: nativeResult.insertedElementIds,
          insertedElementTypes: nativeResult.insertedElementTypes,
          layoutValidation: nativeResult.layoutValidation,
          qualityReport: nativeResult.qualityReport,
          rendering: nativeResult.rendering,
          viewport: diagram.viewport,
          viewportFocus: viewportResult,
          sourceMode: nativeResult.source,
          apiBaseUrl: nativeResult.apiBaseUrl,
          canvasDir,
          sceneFile: nativeResult.sceneFile,
          nativeConversion: true
        })
      )
      return
    }
    if (requiresVisibleRuntime) {
      throw new Error(VISIBLE_CANVAS_RUNTIME_REQUIRED_MESSAGE)
    }

    const { scene } = await readSceneTarget(args, canvasDir)
    const result = insertElementSpecs(scene, diagram.elements, { batchId: args.batchId })
    const writeResult = await writeSceneTarget(args, canvasDir, result.scene)
    const viewportResult = await focusViewportViaApi(args, canvasDir, diagram.viewport, 'Codex focused the diagram.')
    sendResult(
      id,
      textResult(`Inserted ${result.insertedElements.length} Excalidraw ${diagram.kind} diagram elements.`, {
        batchId: result.batchId,
        kind: diagram.kind,
        sourceFormat: diagram.sourceFormat ?? 'ir',
        diagramLayout: diagram.layout,
        insertedElementIds: result.insertedElements.map((element) => element.id),
        insertedElementTypes: result.insertedElements.map((element) => element.type),
        layoutValidation: result.layoutValidation,
        qualityReport: result.qualityReport,
        viewport: diagram.viewport,
        viewportFocus: viewportResult,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        sceneFile: paths.sceneFile,
        nativeConversion: false
      })
    )
    return
  }

  if (params?.name === Tools.INSERT_IMAGE) {
    const sceneTarget = await readSceneTarget(args, canvasDir)
    const selection = await readSelectionFile(canvasDir)
    const commentsTarget = await readCommentsTarget(args, canvasDir)
    const result = await insertImageSpec(sceneTarget.scene, args, {
      canvasDir,
      selection,
      comments: commentsTarget.comments
    })
    const writeResult = await writeSceneTarget(args, canvasDir, result.scene)
    sendResult(
      id,
      textResult(`Inserted Excalidraw image ${result.imageElement.id}.`, {
        batchId: result.imageElement.customData?.codex?.batchId ?? null,
        imageElementId: result.imageElement.id,
        fileId: result.fileId,
        assetPath: result.assetPath,
        sourcePath: result.sourcePath,
        targetElementIds: result.targetElementIds,
        placement: result.placement,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        sceneFile: paths.sceneFile
      })
    )
    return
  }

  if (params?.name === Tools.UPDATE_ELEMENTS) {
    const { scene } = await readSceneTarget(args, canvasDir)
    const selection = await readSelectionFile(canvasDir)
    const commentsTarget = await readCommentsTarget(args, canvasDir)
    const result = updateElements(scene, ensureTarget(args), args.patch, selection, commentsTarget.comments)
    const writeResult = await writeSceneTarget(args, canvasDir, result.scene)
    sendResult(
      id,
      textResult(`Updated ${result.updatedElementIds.length} Excalidraw elements.`, {
        updatedElementIds: result.updatedElementIds,
        targetElementIds: result.targetElementIds,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        sceneFile: paths.sceneFile
      })
    )
    return
  }

  if (params?.name === Tools.DELETE_ELEMENTS) {
    const sceneTarget = await readSceneTarget(args, canvasDir)
    const selection = await readSelectionFile(canvasDir)
    const commentsTarget = await readCommentsTarget(args, canvasDir)
    const result = deleteElements(sceneTarget.scene, ensureTarget(args), selection, commentsTarget.comments)
    const writeSceneResult = await writeSceneTarget(args, canvasDir, result.scene)
    let commentStatus = null
    const resolveCommentId = nonEmptyString(args.resolveCommentId) ?? nonEmptyString(args.target?.commentId)
    if (resolveCommentId) {
      const nextComments = resolveComment(commentsTarget.comments, resolveCommentId)
      await writeCommentsTarget(args, canvasDir, nextComments)
      commentStatus = nextComments.comments.find((comment) => comment.id === resolveCommentId)?.status ?? null
    }
    sendResult(
      id,
      textResult(`Deleted ${result.deletedElementIds.length} Excalidraw elements.`, {
        deletedElementIds: result.deletedElementIds,
        targetElementIds: result.targetElementIds,
        resolvedCommentId: resolveCommentId,
        commentStatus,
        sourceMode: writeSceneResult.source,
        apiBaseUrl: writeSceneResult.apiBaseUrl,
        canvasDir,
        sceneFile: paths.sceneFile,
        commentsFile: paths.commentsFile
      })
    )
    return
  }

  if (params?.name === Tools.ADD_COMMENT) {
    const { scene } = await readSceneTarget(args, canvasDir)
    const selection = await readSelectionFile(canvasDir)
    const commentsTarget = await readCommentsTarget(args, canvasDir)
    const targetElementIds = Array.isArray(args.targetElementIds) && args.targetElementIds.length > 0
      ? args.targetElementIds
      : collectTargetElementIds(scene, args.target ?? { selected: true }, selection, commentsTarget.comments)
    const result = addComment(commentsTarget.comments, {
      targetElementIds,
      body: args.body,
      createdBy: args.createdBy
    })
    const writeResult = await writeCommentsTarget(args, canvasDir, result.comments)
    sendResult(
      id,
      textResult(`Added comment ${result.comment.id} for ${targetElementIds.length} elements.`, {
        comment: result.comment,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        commentsFile: paths.commentsFile
      })
    )
    return
  }

  if (params?.name === Tools.RESOLVE_COMMENT) {
    const commentsTarget = await readCommentsTarget(args, canvasDir)
    const comments = resolveComment(commentsTarget.comments, args.commentId)
    const writeResult = await writeCommentsTarget(args, canvasDir, comments)
    sendResult(
      id,
      textResult(`Resolved comment ${args.commentId}.`, {
        commentId: args.commentId,
        sourceMode: writeResult.source,
        apiBaseUrl: writeResult.apiBaseUrl,
        canvasDir,
        commentsFile: paths.commentsFile
      })
    )
    return
  }

  if (params?.name === Tools.APPLY_COMMENT_PATCH) {
    const sceneTarget = await readSceneTarget(args, canvasDir)
    const commentsTarget = await readCommentsTarget(args, canvasDir)
    const result = updateElements(sceneTarget.scene, { commentId: args.commentId }, args.patch, emptySelection(), commentsTarget.comments)
    const writeSceneResult = await writeSceneTarget(args, canvasDir, result.scene)
    let nextComments = commentsTarget.comments
    if (args.resolve !== false) {
      nextComments = resolveComment(commentsTarget.comments, args.commentId)
      await writeCommentsTarget(args, canvasDir, nextComments)
    }
    sendResult(
      id,
      textResult(`Applied comment patch to ${result.updatedElementIds.length} elements.`, {
        commentId: args.commentId,
        updatedElementIds: result.updatedElementIds,
        targetElementIds: result.targetElementIds,
        commentStatus: nextComments.comments.find((comment) => comment.id === args.commentId)?.status ?? null,
        sourceMode: writeSceneResult.source,
        apiBaseUrl: writeSceneResult.apiBaseUrl,
        canvasDir,
        sceneFile: paths.sceneFile,
        commentsFile: paths.commentsFile
      })
    )
    return
  }

  if (params?.name === Tools.SAVE_CHECKPOINT) {
    const { scene, source, apiBaseUrl } = await readSceneTarget(args, canvasDir)
    const result = await saveCheckpoint(canvasDir, scene, {
      checkpointId: args.checkpointId,
      label: args.label
    })
    sendResult(
      id,
      textResult(`Saved Excalidraw checkpoint ${result.checkpoint.checkpointId}.`, {
        checkpoint: {
          checkpointId: result.checkpoint.checkpointId,
          label: result.checkpoint.label,
          createdAt: result.checkpoint.createdAt,
          summary: result.checkpoint.summary
        },
        sourceMode: source,
        apiBaseUrl,
        canvasDir,
        checkpointFile: result.checkpointFile,
        checkpointsDir: result.checkpointsDir
      })
    )
    return
  }

  if (params?.name === Tools.LIST_CHECKPOINTS) {
    const result = await listCheckpoints(canvasDir)
    sendResult(
      id,
      textResult(`Canvas has ${result.checkpoints.length} checkpoints.`, {
        checkpoints: result.checkpoints,
        canvasDir,
        checkpointsDir: result.checkpointsDir
      })
    )
    return
  }

  if (params?.name === Tools.RESTORE_CHECKPOINT) {
    const result = await restoreCheckpoint(canvasDir, args.checkpointId)
    await writeSceneTarget(args, canvasDir, result.scene)
    sendResult(
      id,
      textResult(`Restored Excalidraw checkpoint ${result.checkpoint.checkpointId}.`, {
        checkpointId: result.checkpoint.checkpointId,
        summary: summarizeScene(result.scene),
        canvasDir,
        sceneFile: paths.sceneFile,
        checkpointFile: result.checkpointFile
      })
    )
    return
  }

  if (params?.name === Tools.FOCUS_VIEWPORT) {
    const viewportResult = await focusViewportViaApi(args, canvasDir, args.viewport, args.message)
    sendResult(
      id,
      textResult(viewportResult ? 'Focused the visible Excalidraw viewport.' : 'No live canvas accepted the viewport focus request.', {
        viewport: args.viewport,
        viewportFocus: viewportResult,
        canvasDir
      })
    )
    return
  }

  if (params?.name === Tools.VISUAL_VALIDATE) {
    const apiResult = await visualValidateViaApi(args, canvasDir)
    const result = apiResult ?? await visualValidateFileBacked(args, canvasDir)
    sendResult(
      id,
      textResult(result.degraded ? 'Validated the Excalidraw scene with degraded file-backed diagnostics.' : 'Validated the Excalidraw scene with the live Excalidraw renderer.', {
        ...result,
        canvasDir
      })
    )
    return
  }

  if (params?.name === Tools.EXPORT_SCENE) {
    const { scene } = await readSceneTarget(args, canvasDir)
    const result = await exportScene(canvasDir, scene, {
      formats: args.formats,
      fileNameBase: args.fileNameBase
    })
    sendResult(
      id,
      textResult(`Exported ${result.exported.length} files.`, {
        ...result,
        canvasDir,
        exportsDir: paths.exportsDir
      })
    )
    return
  }

  sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${params?.name ?? ''}`)
}

async function handleRequest(message) {
  const { id, method, params } = message

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION
      },
      instructions:
        'Use structured Codex Excalidraw tools to read and write the canvas. For substantial diagram creation, call read_excalidraw_drawing_guide once. For sequence diagrams and lane-based process drawings, prefer insert_excalidraw_diagram with structured participants, messages, notes, and gates instead of hand-placing arrows. For user-visible drawing, editing, image insertion, selection-based work, or export workflows, call open_excalidraw_canvas first to start or reuse the live local canvas service. Do not use browser-control clicking as the data path. Use get_excalidraw_session when project context is unclear, and prefer selected element ids, comment target ids, action target ids, or customData.codex.semanticId for multi-turn edits. Use project-local checkpoints before risky edits. When the page submits an action, call get_pending_excalidraw_actions, claim_excalidraw_action, execute the requested edit with structured tools, then complete_excalidraw_action.'
    })
    return
  }

  if (method === 'ping') {
    sendResult(id, {})
    return
  }

  if (method === 'tools/list') {
    sendResult(id, { tools: toolDefinitions() })
    return
  }

  if (method === 'tools/call') {
    try {
      await handleToolCall(id, params)
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (id !== undefined) {
    sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`)
  }
}

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
})

lines.on('line', (line) => {
  if (line.trim().length === 0) return

  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  handleRequest(message).catch((error) => {
    if (message.id !== undefined) {
      sendError(message.id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error))
    }
  })
})
