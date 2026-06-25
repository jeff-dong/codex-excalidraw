import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateSync } from 'node:zlib'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const TEST_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg=='
const TEST_PORTRAIT_PNG_DATA_URL = makeTestPngDataUrl(64, 128)

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function makeTestPngDataUrl(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    row[0] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4
      const isDiagonal = Math.abs(x - y / 2) < 3
      const isTop = y < height / 2
      row[offset] = isDiagonal ? 255 : isTop ? 255 : 0
      row[offset + 1] = isDiagonal ? 214 : isTop ? 0 : 190
      row[offset + 2] = isDiagonal ? 10 : isTop ? 190 : 255
      row[offset + 3] = 255
    }
    rows.push(row)
  }
  const idat = deflateSync(Buffer.concat(rows))
  return `data:image/png;base64,${Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]).toString('base64')}`
}

function assertPathInside(parent, child, message) {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  const relativePath = relative(normalizedParent, normalizedChild)
  const [firstSegment] = relativePath.split(sep)
  assert.ok(relativePath && firstSegment !== '..' && !isAbsolute(relativePath), message)
}

function assertPathInsideOrSame(parent, child, message) {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  if (normalizedParent === normalizedChild) return
  assertPathInside(normalizedParent, normalizedChild, message)
}

function pngBufferFromTestDataUrl() {
  const commaIndex = TEST_PNG_DATA_URL.indexOf(',')
  assert.ok(commaIndex > 0)
  return Buffer.from(TEST_PNG_DATA_URL.slice(commaIndex + 1), 'base64')
}

async function listRelativeFiles(rootDir) {
  if (!existsSync(rootDir)) return []
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      for (const nested of await listRelativeFiles(absolutePath)) {
        files.push(join(entry.name, nested))
      }
    } else if (entry.isFile()) {
      files.push(entry.name)
    }
  }
  return files.sort()
}

async function assertRejectsTool(call, expectedMessagePart) {
  let failed = false
  try {
    await call()
  } catch (error) {
    failed = true
    if (expectedMessagePart) {
      assert.ok(error.message.includes(expectedMessagePart), `Expected error to include "${expectedMessagePart}", got "${error.message}"`)
    }
  }
  assert.equal(failed, true, 'Expected MCP tool call to fail.')
}

class McpClient {
  constructor(env = {}) {
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ''
    this.child = spawn(process.execPath, ['./mcp/server.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.rl.on('line', (line) => this.handleLine(line))
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString()
    })
    this.child.on('exit', (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP server exited with ${code}. ${this.stderr}`))
      }
      this.pending.clear()
    })
  }

  handleLine(line) {
    const message = JSON.parse(line)
    if (!message.id || !this.pending.has(message.id)) return
    const { resolve, reject } = this.pending.get(message.id)
    this.pending.delete(message.id)
    if (message.error) {
      reject(new Error(message.error.message))
      return
    }
    resolve(message.result)
  }

  request(method, params = {}) {
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      this.child.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  }

  callTool(name, args = {}) {
    return this.request('tools/call', {
      name,
      arguments: args
    })
  }

  async close() {
    this.rl.close()
    this.child.kill('SIGTERM')
    await sleep(100)
  }
}

async function readScene(projectDir) {
  return JSON.parse(await readFile(join(projectDir, 'canvas', 'excalidraw', 'scene.excalidraw'), 'utf8'))
}

async function readComments(projectDir) {
  return JSON.parse(await readFile(join(projectDir, 'canvas', 'excalidraw', 'comments.json'), 'utf8'))
}

async function readActions(projectDir) {
  return JSON.parse(await readFile(join(projectDir, 'canvas', 'excalidraw', 'actions.json'), 'utf8'))
}

async function writeActions(projectDir, actions) {
  const actionsFile = join(projectDir, 'canvas', 'excalidraw', 'actions.json')
  await mkdir(dirname(actionsFile), { recursive: true })
  await writeFile(actionsFile, `${JSON.stringify(actions, null, 2)}\n`)
}

async function writeSelection(projectDir, element) {
  const selectionFile = join(projectDir, 'canvas', 'excalidraw', 'selection.json')
  await mkdir(dirname(selectionFile), { recursive: true })
  await writeFile(
    selectionFile,
    `${JSON.stringify(
      {
        selectedElementIds: [element.id],
        selectedElements: [
          {
            id: element.id,
            type: element.type,
            x: Math.round(element.x),
            y: Math.round(element.y),
            width: Math.round(element.width ?? 0),
            height: Math.round(element.height ?? 0),
            customData: element.customData ?? null
          }
        ],
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  )
}

function findBySemantic(scene, semanticId) {
  return scene.elements.find((element) => !element.isDeleted && element.customData?.codex?.semanticId === semanticId)
}

async function runFileBackedScenario(projectDir) {
  const client = new McpClient()
  try {
    const seededCanvasDir = join(projectDir, 'canvas', 'excalidraw')
    await mkdir(seededCanvasDir, { recursive: true })
    await writeFile(
      join(seededCanvasDir, 'scene.excalidraw'),
      `${JSON.stringify(
        {
          type: 'excalidraw',
          version: 2,
          source: 'theme-seed',
          elements: [],
          appState: {
            viewBackgroundColor: '#fbfbfa',
            currentItemFontFamily: 1,
            theme: 'dark'
          },
          files: {}
        },
        null,
        2
      )}\n`
    )
    await client.request('initialize', { protocolVersion: '2025-11-25' })
    const listed = await client.request('tools/list')
    const toolNames = listed.tools.map((tool) => tool.name)
    assert.ok(toolNames.includes('read_excalidraw_drawing_guide'))
    assert.ok(toolNames.includes('open_excalidraw_canvas'))
    assert.ok(toolNames.includes('insert_excalidraw_elements'))
    assert.ok(toolNames.includes('insert_excalidraw_diagram'))
    assert.ok(toolNames.includes('apply_excalidraw_comment_patch'))
    assert.ok(toolNames.includes('insert_excalidraw_image'))
    assert.ok(toolNames.includes('save_excalidraw_checkpoint'))
    assert.ok(toolNames.includes('list_excalidraw_checkpoints'))
    assert.ok(toolNames.includes('restore_excalidraw_checkpoint'))
    assert.ok(toolNames.includes('focus_excalidraw_viewport'))
    assert.ok(toolNames.includes('visual_validate_excalidraw'))
    const insertToolSchema = listed.tools.find((tool) => tool.name === 'insert_excalidraw_elements')?.inputSchema
    assert.equal(Object.prototype.hasOwnProperty.call(insertToolSchema?.properties ?? {}, 'preferApi'), false)
    const guide = await client.callTool('read_excalidraw_drawing_guide')
    assert.ok(guide.content[0].text.includes('cameraUpdate'))
    assert.ok(guide.content[0].text.includes('save_excalidraw_checkpoint'))
    assert.ok(guide.content[0].text.includes('visual_validate_excalidraw'))

    const baseArgs = { projectDir, preferApi: false }
    const insert = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'test_architecture_round_1',
      elements: [
        {
          type: 'text',
          semanticId: 'diagram_title',
          x: 0,
          y: -80,
          text: 'Codex Excalidraw data flow',
          fontSize: 30,
          style: { strokeColor: '#111827' }
        },
        {
          type: 'rectangle',
          semanticId: 'codex_request',
          x: 0,
          y: 20,
          width: 220,
          height: 104,
          label: 'Codex request',
          style: { backgroundColor: '#dff1ff' }
        },
        {
          type: 'rectangle',
          semanticId: 'planner',
          x: 320,
          y: 20,
          width: 240,
          height: 104,
          label: 'Canvas planner',
          style: { backgroundColor: '#eee7ff' }
        },
        {
          type: 'arrow',
          semanticId: 'request_to_planner',
          x: 230,
          y: 72,
          width: 80,
          height: 0,
          label: 'structured tool call'
        }
      ]
    })
    assert.equal(insert.structuredContent.sourceMode, 'file')
    assert.equal(insert.structuredContent.nativeConversion, false)

    let scene = await readScene(projectDir)
    assert.equal(Object.prototype.hasOwnProperty.call(scene.appState ?? {}, 'theme'), false, 'MCP writes must strip persisted appState.theme.')
    const planner = findBySemantic(scene, 'planner')
    assert.ok(planner, 'planner element should be inserted')

    const layoutRepaired = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'layout_repair_file_backed',
      elements: [
        {
          id: 'layout_repair_node',
          type: 'rectangle',
          semanticId: 'layout_repair_node',
          x: 0,
          y: 20,
          width: 32,
          height: 20,
          label: { text: 'Readable repaired layout node', fontSize: 10 },
          style: { backgroundColor: '#dbeafe', strokeColor: '#dbeafe' }
        }
      ]
    })
    assert.equal(layoutRepaired.structuredContent.layoutValidation.repaired, true)
    assert.ok(layoutRepaired.structuredContent.layoutValidation.repairCount >= 2)
    scene = await readScene(projectDir)
    const repairedNode = scene.elements.find((element) => element.id === 'layout_repair_node')
    assert.ok(repairedNode.width >= 120)
    assert.ok(repairedNode.height >= 60)
    assert.notEqual(repairedNode.strokeColor, repairedNode.backgroundColor)

    const linearRepair = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'linear_absolute_points_repair',
      elements: [
        {
          id: 'absolute_points_arrow',
          type: 'arrow',
          semanticId: 'absolute_points_arrow',
          x: 640,
          y: 180,
          width: -280,
          height: 0,
          points: [[640, 180], [360, 180]],
          label: { text: 'absolute points become local', fontSize: 12 },
          style: { strokeColor: '#2563eb' }
        }
      ]
    })
    assert.equal(linearRepair.structuredContent.layoutValidation.repaired, true)
    assert.ok(linearRepair.structuredContent.layoutValidation.repairs.some((repair) => repair.code === 'line-points-normalized-to-relative'))
    scene = await readScene(projectDir)
    const repairedArrow = scene.elements.find((element) => element.id === 'absolute_points_arrow')
    assert.equal(repairedArrow.x, 360)
    assert.equal(repairedArrow.y, 180)
    assert.deepEqual(repairedArrow.points, [[280, 0], [0, 0]])
    assert.equal(repairedArrow.width, 280)
    assert.equal(repairedArrow.height, 0)

    const sequenceDiagram = await client.callTool('insert_excalidraw_diagram', {
      ...baseArgs,
      batchId: 'sequence_layout_case',
      kind: 'sequence',
      diagram: {
        title: 'Asset registration workflow',
        subtitle: 'Structured sequence layout keeps lanes, messages, notes, and gates stable.',
        participants: [
          { id: 'user', label: 'User or business request' },
          { id: 'agent', label: 'Registration Agent' },
          { id: 'catalog', label: 'Data catalog and contracts' },
          { id: 'validation', label: 'Validation and evals' }
        ],
        messages: [
          {
            id: 'submit_requirement',
            from: 'user',
            to: 'agent',
            label: 'Submit governed asset requirement'
          },
          {
            id: 'inspect_contract',
            from: 'agent',
            to: 'catalog',
            label: 'Inspect domain contract and capability index'
          },
          {
            id: 'project_list',
            from: 'catalog',
            to: 'user',
            label: 'Ask user to choose a concrete project'
          },
          {
            id: 'validate_asset',
            from: 'agent',
            to: 'validation',
            label: 'Profile, register, and validate the asset'
          }
        ],
        notes: [
          {
            id: 'contract_note',
            afterMessageId: 'inspect_contract',
            from: 'agent',
            to: 'catalog',
            text: 'Use structural contract data; do not infer from display labels.'
          }
        ],
        gates: [
          {
            id: 'project_gate',
            afterMessageId: 'project_list',
            lane: 'user',
            text: 'Project selected?'
          }
        ]
      }
    })
    assert.equal(sequenceDiagram.structuredContent.sourceMode, 'file')
    assert.equal(sequenceDiagram.structuredContent.nativeConversion, false)
    assert.equal(sequenceDiagram.structuredContent.kind, 'sequence')
    assert.equal(sequenceDiagram.structuredContent.diagramLayout.participantCount, 4)
    assert.equal(sequenceDiagram.structuredContent.diagramLayout.messageCount, 4)
    assert.equal(sequenceDiagram.structuredContent.diagramLayout.noteCount, 1)
    assert.equal(sequenceDiagram.structuredContent.diagramLayout.gateCount, 1)
    scene = await readScene(projectDir)
    assert.ok(findBySemantic(scene, 'seq_participant_user'))
    assert.ok(findBySemantic(scene, 'seq_participant_agent'))
    assert.ok(findBySemantic(scene, 'seq_note_contract_note'))
    assert.ok(findBySemantic(scene, 'seq_gate_project_gate'))
    const reverseSequenceArrow = findBySemantic(scene, 'seq_message_project_list')
    assert.ok(reverseSequenceArrow, 'sequence layout should insert the reverse project-list message arrow.')
    assert.deepEqual(reverseSequenceArrow.points, [[reverseSequenceArrow.width, 0], [0, 0]])
    assert.ok(reverseSequenceArrow.width > 0)
    assert.equal(reverseSequenceArrow.height, 0)

    const flowchartDiagram = await client.callTool('insert_excalidraw_diagram', {
      ...baseArgs,
      batchId: 'flowchart_ir_case',
      sourceFormat: 'ir',
      kind: 'flowchart',
      diagram: {
        title: 'Unified diagram pipeline',
        subtitle: 'Structured IR selects layout; shared renderer controls Excalidraw styling.',
        layout: { x: 0, y: 1240, direction: 'RIGHT' },
        nodes: [
          { id: 'intent', label: 'User intent', shape: 'ellipse' },
          { id: 'ir', label: 'Diagram IR', details: ['kind', 'nodes', 'edges'] },
          { id: 'layout', label: 'Layout engine', details: ['ELK for node-edge graphs'] },
          { id: 'renderer', label: 'Shared renderer', details: ['style tokens', 'semantic ids'] },
          { id: 'scene', label: 'Editable scene', shape: 'ellipse' }
        ],
        edges: [
          { id: 'intent_to_ir', from: 'intent', to: 'ir', label: 'normalize' },
          { id: 'ir_to_layout', from: 'ir', to: 'layout', label: 'compute boxes' },
          { id: 'layout_to_renderer', from: 'layout', to: 'renderer', label: 'apply coordinates' },
          { id: 'renderer_to_scene', from: 'renderer', to: 'scene', label: 'convert skeletons' }
        ]
      }
    })
    assert.equal(flowchartDiagram.structuredContent.kind, 'flowchart')
    assert.equal(flowchartDiagram.structuredContent.sourceFormat, 'ir')
    assert.equal(flowchartDiagram.structuredContent.diagramLayout.engine, 'elk')
    assert.equal(flowchartDiagram.structuredContent.diagramLayout.algorithm, 'layered')
    assert.equal(flowchartDiagram.structuredContent.diagramLayout.nodeCount, 5)
    assert.equal(flowchartDiagram.structuredContent.diagramLayout.edgeCount, 4)
    scene = await readScene(projectDir)
    assert.ok(findBySemantic(scene, 'flowchart_node_intent'))
    assert.ok(findBySemantic(scene, 'flowchart_node_renderer'))
    assert.ok(findBySemantic(scene, 'flowchart_edge_renderer_to_scene'))

    const classDiagram = await client.callTool('insert_excalidraw_diagram', {
      ...baseArgs,
      batchId: 'class_ir_case',
      sourceFormat: 'ir',
      kind: 'class',
      diagram: {
        title: 'Canvas runtime contracts',
        layout: { x: 0, y: 1720, direction: 'DOWN' },
        nodes: [
          {
            id: 'DiagramRequest',
            label: 'DiagramRequest',
            sections: [
              { title: 'fields', items: ['kind', 'sourceFormat', 'diagram'] }
            ]
          },
          {
            id: 'DiagramIR',
            label: 'DiagramIR',
            sections: [
              { title: 'fields', items: ['nodes', 'edges', 'layout'] }
            ]
          },
          {
            id: 'Renderer',
            label: 'Renderer',
            sections: [
              { title: 'methods', items: ['toElementSpecs()', 'semanticData()'] }
            ]
          }
        ],
        edges: [
          { id: 'request_to_ir', from: 'DiagramRequest', to: 'DiagramIR', label: 'normalizes' },
          { id: 'ir_to_renderer', from: 'DiagramIR', to: 'Renderer', label: 'feeds' }
        ]
      }
    })
    assert.equal(classDiagram.structuredContent.kind, 'class')
    assert.equal(classDiagram.structuredContent.diagramLayout.engine, 'elk')
    scene = await readScene(projectDir)
    assert.ok(findBySemantic(scene, 'class_node_DiagramIR'))
    assert.ok(findBySemantic(scene, 'class_edge_ir_to_renderer'))

    const stateDiagram = await client.callTool('insert_excalidraw_diagram', {
      ...baseArgs,
      batchId: 'state_ir_case',
      sourceFormat: 'ir',
      kind: 'state',
      diagram: {
        title: 'Canvas action lifecycle',
        layout: { x: 980, y: 1720, direction: 'RIGHT' },
        nodes: [
          { id: 'queued', label: 'Queued', shape: 'ellipse' },
          { id: 'running', label: 'Running' },
          { id: 'completed', label: 'Completed', shape: 'ellipse' },
          { id: 'failed', label: 'Failed', shape: 'diamond' }
        ],
        edges: [
          { id: 'claim', from: 'queued', to: 'running', label: 'claim' },
          { id: 'finish', from: 'running', to: 'completed', label: 'complete' },
          { id: 'error', from: 'running', to: 'failed', label: 'error', dashed: true }
        ]
      }
    })
    assert.equal(stateDiagram.structuredContent.kind, 'state')
    assert.equal(stateDiagram.structuredContent.diagramLayout.engine, 'elk')
    scene = await readScene(projectDir)
    assert.ok(findBySemantic(scene, 'state_node_running'))
    assert.ok(findBySemantic(scene, 'state_edge_error'))

    await writeSelection(projectDir, planner)
    const update = await client.callTool('update_excalidraw_elements', {
      ...baseArgs,
      target: { selected: true },
      patch: {
        backgroundColor: '#e5f7dc',
        labelText: 'Canvas planner\nmulti-turn edit',
        customData: { codex: { lastOperation: 'selection-update' } }
      }
    })
    assert.ok(update.structuredContent.updatedElementIds.includes(planner.id))

    scene = await readScene(projectDir)
    const updatedPlanner = scene.elements.find((element) => element.id === planner.id)
    const plannerLabel = scene.elements.find((element) => element.containerId === planner.id)
    assert.equal(updatedPlanner.backgroundColor, '#e5f7dc')
    assert.equal(plannerLabel.text, 'Canvas planner\nmulti-turn edit')

    const imageInsert = await client.callTool('insert_excalidraw_image', {
      ...baseArgs,
      batchId: 'test_image_insert',
      semanticId: 'planner_generated_image',
      target: { elementIds: [updatedPlanner.id] },
      image: {
        dataURL: TEST_PNG_DATA_URL,
        name: 'tiny-test-image.png'
      },
      placement: {
        margin: 8,
        fit: 'contain'
      }
    })
    assert.equal(imageInsert.structuredContent.sourceMode, 'file')
    assert.ok(imageInsert.structuredContent.imageElementId)
    assert.ok(existsSync(imageInsert.structuredContent.assetPath))
    scene = await readScene(projectDir)
    const insertedImage = scene.elements.find((element) => element.id === imageInsert.structuredContent.imageElementId)
    assert.equal(insertedImage.type, 'image')
    assert.equal(insertedImage.crop, null)
    assert.deepEqual(insertedImage.scale, [1, 1])
    assert.ok(scene.files[insertedImage.fileId].dataURL.startsWith('data:image/png;base64,'))
    assert.ok(insertedImage.x >= updatedPlanner.x + 8)
    assert.ok(insertedImage.y >= updatedPlanner.y + 8)

    const coverImageInsert = await client.callTool('insert_excalidraw_image', {
      ...baseArgs,
      batchId: 'test_image_cover_insert',
      semanticId: 'planner_generated_image_cover',
      target: { elementIds: [updatedPlanner.id] },
      image: {
        dataURL: TEST_PORTRAIT_PNG_DATA_URL,
        name: 'portrait-cover-test-image.png'
      },
      placement: {
        margin: 8,
        fit: 'cover',
        alignX: 'center',
        alignY: 'center'
      }
    })
    assert.equal(coverImageInsert.structuredContent.placement.fit, 'cover')
    assert.equal(coverImageInsert.structuredContent.placement.crop.naturalWidth, 64)
    assert.equal(coverImageInsert.structuredContent.placement.crop.naturalHeight, 128)
    scene = await readScene(projectDir)
    const coverImage = scene.elements.find((element) => element.id === coverImageInsert.structuredContent.imageElementId)
    assert.equal(coverImage.type, 'image')
    assert.equal(coverImage.width, updatedPlanner.width - 16)
    assert.equal(coverImage.height, updatedPlanner.height - 16)
    assert.equal(coverImage.crop.naturalWidth, 64)
    assert.equal(coverImage.crop.naturalHeight, 128)
    assert.ok(coverImage.crop.height < 128, 'cover should crop tall source images to target aspect ratio.')

    const roughSketch = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'rough_sketch_source',
      elements: [
        {
          type: 'rectangle',
          semanticId: 'rough_sketch_step_1',
          x: -360,
          y: 240,
          width: 150,
          height: 80,
          label: 'rough idea',
          style: { backgroundColor: '#fff7ed', roughness: 2.8 }
        },
        {
          type: 'arrow',
          semanticId: 'rough_sketch_arrow',
          x: -190,
          y: 280,
          width: 120,
          height: 18,
          label: 'then'
        },
        {
          type: 'rectangle',
          semanticId: 'rough_sketch_step_2',
          x: -40,
          y: 236,
          width: 160,
          height: 88,
          label: 'local api?',
          style: { backgroundColor: '#fef3c7', roughness: 2.8 }
        }
      ]
    })
    scene = await readScene(projectDir)
    const roughSourceIds = roughSketch.structuredContent.insertedElementIds
    for (const id of roughSourceIds) {
      assert.equal(scene.elements.find((element) => element.id === id)?.isDeleted, false, 'Rough sketch source must exist before optimization.')
    }
    const optimized = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'rough_sketch_optimized',
      elements: [
        {
          type: 'rectangle',
          semanticId: 'optimized_step_collect',
          x: 220,
          y: 240,
          width: 190,
          height: 88,
          label: 'Collect intent',
          style: { backgroundColor: '#dbeafe', roughness: 1.4 }
        },
        {
          type: 'arrow',
          semanticId: 'optimized_arrow_plan',
          x: 430,
          y: 284,
          width: 90,
          height: 0,
          label: 'plan'
        },
        {
          type: 'rectangle',
          semanticId: 'optimized_step_apply',
          x: 540,
          y: 240,
          width: 190,
          height: 88,
          label: 'Apply structured edit',
          style: { backgroundColor: '#dcfce7', roughness: 1.4 }
        }
      ]
    })
    scene = await readScene(projectDir)
    for (const id of roughSourceIds) {
      assert.equal(scene.elements.find((element) => element.id === id)?.isDeleted, false, 'Sketch optimization must preserve original source elements.')
    }
    const optimizedElements = optimized.structuredContent.insertedElementIds
      .map((id) => scene.elements.find((element) => element.id === id))
      .filter(Boolean)
    assert.ok(optimizedElements.length >= 3)
    assert.equal(optimizedElements.some((element) => element.type === 'image'), false, 'Optimized sketch output must remain editable elements, not a bitmap.')
    assert.ok(optimizedElements.some((element) => element.customData?.codex?.semanticId === 'optimized_step_apply'))

    const outsideSourceImage = join(dirname(projectDir), 'source-image-outside-project.png')
    await writeFile(outsideSourceImage, pngBufferFromTestDataUrl())
    const imageBoundary = await client.callTool('insert_excalidraw_image', {
      ...baseArgs,
      batchId: 'test_image_boundary_insert',
      semanticId: 'planner_boundary_image',
      target: { elementIds: [updatedPlanner.id] },
      image: {
        filePath: outsideSourceImage,
        name: '../../escaped-image.png'
      },
      placement: {
        margin: 4,
        fit: 'contain'
      }
    })
    const assetsDir = join(projectDir, 'canvas', 'excalidraw', 'assets')
    assertPathInside(assetsDir, imageBoundary.structuredContent.assetPath, 'Image asset must be written inside active canvas assets.')
    assert.equal(existsSync(join(projectDir, 'escaped-image.png')), false, 'Image insertion must not create files in the project root.')
    assert.equal(existsSync(join(dirname(projectDir), 'escaped-image.png')), false, 'Image insertion must not create sibling overflow files.')

    const checkpoint = await client.callTool('save_excalidraw_checkpoint', {
      ...baseArgs,
      checkpointId: 'before_temp_directives',
      label: 'Before structured pseudo element test'
    })
    assert.equal(checkpoint.structuredContent.checkpoint.checkpointId, 'before_temp_directives')
    const viewportOnly = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'viewport_only',
      elements: [
        { type: 'cameraUpdate', x: -420, y: 180, width: 800, height: 600 }
      ]
    })
    assert.equal(viewportOnly.structuredContent.insertedElementIds.length, 0)
    assert.equal(viewportOnly.structuredContent.viewport.width, 800)
    const tempDirective = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'directive_insert',
      elements: [
        { type: 'cameraUpdate', x: 760, y: 180, width: 600, height: 450 },
        {
          id: 'temp_directive_node',
          type: 'rectangle',
          semanticId: 'temp_directive_node',
          x: 820,
          y: 240,
          width: 150,
          height: 80,
          label: 'temporary',
          style: { backgroundColor: '#fff3bf' }
        }
      ]
    })
    assert.equal(tempDirective.structuredContent.viewport.height, 450)
    assert.ok(tempDirective.structuredContent.insertedElementIds.includes('temp_directive_node'))
    const directiveDelete = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'directive_delete',
      elements: [
        { type: 'delete', elementIds: ['temp_directive_node'] }
      ]
    })
    assert.ok(directiveDelete.structuredContent.deletedElementIds.includes('temp_directive_node'))
    scene = await readScene(projectDir)
    assert.equal(scene.elements.find((element) => element.id === 'temp_directive_node').isDeleted, true)
    const checkpoints = await client.callTool('list_excalidraw_checkpoints', baseArgs)
    assert.ok(checkpoints.structuredContent.checkpoints.some((item) => item.checkpointId === 'before_temp_directives'))
    const restoredCheckpoint = await client.callTool('restore_excalidraw_checkpoint', {
      ...baseArgs,
      checkpointId: 'before_temp_directives'
    })
    assert.equal(restoredCheckpoint.structuredContent.checkpointId, 'before_temp_directives')
    scene = await readScene(projectDir)
    assert.equal(scene.elements.some((element) => element.id === 'temp_directive_node'), false)

    const comment = await client.callTool('add_excalidraw_comment', {
      ...baseArgs,
      target: { selected: true },
      body: 'Make the planner node look reviewed.',
      createdBy: 'test-user'
    })
    const commentId = comment.structuredContent.comment.id
    assert.ok(commentId)

    const commentPatch = await client.callTool('apply_excalidraw_comment_patch', {
      ...baseArgs,
      commentId,
      patch: {
        backgroundColor: '#fff4c2',
        customData: { codex: { reviewed: true } }
      }
    })
    assert.equal(commentPatch.structuredContent.commentStatus, 'resolved')

    const comments = await readComments(projectDir)
    assert.equal(comments.comments.find((item) => item.id === commentId).status, 'resolved')

    const actionComment = await client.callTool('add_excalidraw_comment', {
      ...baseArgs,
      targetElementIds: [updatedPlanner.id, updatedPlanner.id],
      body: 'Use the action queue to mark this planner node as reviewed.',
      createdBy: 'test-user'
    })
    const actionCommentId = actionComment.structuredContent.comment.id
    assert.deepEqual(actionComment.structuredContent.comment.targetElementIds, [updatedPlanner.id])
    await writeActions(projectDir, {
      version: 1,
      actions: [
        {
          id: 'action_file_backed_review',
          type: 'comment',
          status: 'queued',
          commentId: actionCommentId,
          targetElementIds: [updatedPlanner.id, updatedPlanner.id],
          instruction: 'Use the action queue to mark this planner node as reviewed.',
          source: 'canvas-comment',
          projectDir,
          canvasDir: join(projectDir, 'canvas', 'excalidraw'),
          sceneFingerprint: null,
          selectionSnapshot: null,
          createdBy: 'user',
          claimedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          result: null,
          error: null
        }
      ]
    })

    const pendingActions = await client.callTool('get_pending_excalidraw_actions', baseArgs)
    assert.equal(pendingActions.structuredContent.actions.actions.length, 1)
    assert.equal(pendingActions.structuredContent.actions.actions[0].commentId, actionCommentId)
    assert.deepEqual(pendingActions.structuredContent.actions.actions[0].targetElementIds, [updatedPlanner.id])

    const claimedAction = await client.callTool('claim_excalidraw_action', {
      ...baseArgs,
      actionId: 'action_file_backed_review',
      claimedBy: 'test-suite'
    })
    assert.equal(claimedAction.structuredContent.action.status, 'running')

    const actionUpdate = await client.callTool('update_excalidraw_elements', {
      ...baseArgs,
      target: { commentId: actionCommentId },
      patch: {
        backgroundColor: '#dbeafe',
        customData: { codex: { actionReviewed: true } }
      }
    })
    assert.ok(actionUpdate.structuredContent.updatedElementIds.includes(updatedPlanner.id))

    const completedAction = await client.callTool('complete_excalidraw_action', {
      ...baseArgs,
      actionId: 'action_file_backed_review',
      result: { updatedElementIds: actionUpdate.structuredContent.updatedElementIds }
    })
    assert.equal(completedAction.structuredContent.action.status, 'completed')
    assert.equal(completedAction.structuredContent.commentStatus, 'resolved')
    const actions = await readActions(projectDir)
    assert.equal(actions.actions.find((item) => item.id === 'action_file_backed_review').status, 'completed')

    const deleteComment = await client.callTool('add_excalidraw_comment', {
      ...baseArgs,
      targetElementIds: [updatedPlanner.id],
      body: 'Delete this planner node.',
      createdBy: 'test-user'
    })
    const deleteCommentId = deleteComment.structuredContent.comment.id
    const deleted = await client.callTool('delete_excalidraw_elements', {
      ...baseArgs,
      target: { commentId: deleteCommentId }
    })
    assert.equal(deleted.structuredContent.commentStatus, 'resolved')
    scene = await readScene(projectDir)
    assert.equal(scene.elements.find((element) => element.id === updatedPlanner.id).isDeleted, true)
    assert.equal(scene.elements.find((element) => element.containerId === updatedPlanner.id).isDeleted, true)

    const exported = await client.callTool('export_excalidraw_scene', {
      ...baseArgs,
      formats: ['excalidraw', 'json', 'svg', 'png'],
      fileNameBase: '../real-user-flow'
    })
    assert.equal(exported.structuredContent.exported.length, 3)
    assert.equal(exported.structuredContent.unsupported.length, 1)
    const exportsDir = join(projectDir, 'canvas', 'excalidraw', 'exports')
    for (const file of exported.structuredContent.exported) {
      assert.ok(existsSync(file.filePath), `${file.filePath} should exist`)
      assertPathInside(exportsDir, file.filePath, 'Exported files must stay inside active canvas exports.')
    }
    assert.equal(existsSync(join(projectDir, 'real-user-flow.excalidraw')), false, 'Export must not create files in the project root.')

    const visualValidation = await client.callTool('visual_validate_excalidraw', {
      ...baseArgs,
      elementIds: flowchartDiagram.structuredContent.insertedElementIds,
      fileNameBase: '../visual-validation-overflow'
    })
    assert.equal(visualValidation.structuredContent.degraded, true)
    assert.equal(visualValidation.structuredContent.renderer, 'basic-svg')
    assert.ok(existsSync(visualValidation.structuredContent.filePath), 'File-backed visual validation should write a preview SVG.')
    assertPathInside(exportsDir, visualValidation.structuredContent.filePath, 'Visual validation preview must stay inside active canvas exports.')
    assert.equal(visualValidation.structuredContent.qualityReport.status === 'pass' || visualValidation.structuredContent.qualityReport.status === 'warn', true)
    assert.equal(existsSync(join(projectDir, 'visual-validation-overflow.svg')), false)

    const summary = await client.callTool('get_excalidraw_scene', baseArgs)
    assert.equal(summary.structuredContent.fileCount, 3)
    assert.ok(summary.structuredContent.visibleElementCount >= 5)
  } finally {
    await client.close()
  }
}

async function waitForApi(apiBaseUrl) {
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/scene`)
      if (response.ok) return
    } catch {
      // Keep waiting until Vite is ready.
    }
    await sleep(125)
  }
  throw new Error(`Timed out waiting for ${apiBaseUrl}`)
}

async function runApiBackedScenario(projectDir) {
  const port = 43228
  const apiBaseUrl = `http://127.0.0.1:${port}`
  const switchedProjectDir = join(dirname(projectDir), 'api-switched-project')
  const server = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_EXCALIDRAW_PROJECT_DIR: projectDir,
      CODEX_EXCALIDRAW_CANVAS_DIR: join(projectDir, 'canvas', 'excalidraw')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const client = new McpClient()
  try {
    await mkdir(switchedProjectDir, { recursive: true })
    await waitForApi(apiBaseUrl)
    const seededApiScene = {
      type: 'excalidraw',
      version: 2,
      source: 'theme-seed',
      elements: [],
      appState: {
        viewBackgroundColor: '#fbfbfa',
        currentItemFontFamily: 1,
        theme: 'dark'
      },
      files: {}
    }
    const seedThemeResponse = await fetch(`${apiBaseUrl}/api/scene`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seededApiScene)
    })
    assert.equal(seedThemeResponse.ok, true)
    const seedThemeRead = await fetch(`${apiBaseUrl}/api/scene`)
    const seedThemePayload = await seedThemeRead.json()
    assert.equal(Object.prototype.hasOwnProperty.call(seedThemePayload.scene.appState ?? {}, 'theme'), false, 'API scene storage must strip persisted appState.theme.')
    const nativePendingWithoutBrowser = await fetch(`${apiBaseUrl}/api/native-elements`)
    assert.equal(nativePendingWithoutBrowser.ok, true)
    const nativePendingPayload = await nativePendingWithoutBrowser.json()
    assert.equal(nativePendingPayload.requests.length, 0)
    const nativeCreateWithoutBrowser = await fetch(`${apiBaseUrl}/api/native-elements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        elements: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 60 }]
      })
    })
    assert.equal(nativeCreateWithoutBrowser.status, 409)
    const viewportCreateWithoutBrowser = await fetch(`${apiBaseUrl}/api/viewport`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        viewport: { x: 0, y: 0, width: 800, height: 600 }
      })
    })
    assert.equal(viewportCreateWithoutBrowser.status, 409)

    await client.request('initialize', { protocolVersion: '2025-11-25' })
    const opened = await client.callTool('open_excalidraw_canvas', {
      projectDir,
      apiBaseUrl,
      name: 'API backed MCP test project'
    })
    assert.equal(opened.structuredContent.sourceMode, 'api')
    assert.equal(opened.structuredContent.started, false)
    assert.equal(opened.structuredContent.status, 'reused')
    assert.equal(opened.structuredContent.session.projectDir, projectDir)
    assert.equal(opened.structuredContent.apiBaseUrl, apiBaseUrl)

    const session = await client.callTool('get_excalidraw_session', {
      projectDir,
      apiBaseUrl
    })
    assert.equal(session.structuredContent.session.projectDir, projectDir)

    const focusWithoutBrowser = await client.callTool('focus_excalidraw_viewport', {
      projectDir,
      apiBaseUrl,
      viewport: { x: 0, y: 0, width: 800, height: 600 }
    })
    assert.equal(focusWithoutBrowser.structuredContent.viewportFocus, null)

    await assertRejectsTool(
      () => client.callTool('insert_excalidraw_elements', {
        projectDir,
        apiBaseUrl,
        elements: [
          {
            type: 'rectangle',
            semanticId: 'api_synced_node_requires_browser',
            x: 40,
            y: 40,
            width: 260,
            height: 112,
            label: 'Requires browser runtime',
            style: { backgroundColor: '#e5f7dc' }
          }
        ]
      }),
      'Visible Excalidraw canvas runtime is required before drawing'
    )

    const inserted = await client.callTool('insert_excalidraw_elements', {
      projectDir,
      apiBaseUrl,
      preferApi: false,
      elements: [
        {
          type: 'rectangle',
          semanticId: 'api_synced_node',
          x: 40,
          y: 40,
          width: 260,
          height: 112,
          label: 'API synced node',
          style: { backgroundColor: '#e5f7dc' }
        }
      ]
    })
    assert.equal(inserted.structuredContent.sourceMode, 'file')
    assert.equal(inserted.structuredContent.nativeConversion, false)

    const response = await fetch(`${apiBaseUrl}/api/scene`)
    const payload = await response.json()
    assert.ok(findBySemantic(payload.scene, 'api_synced_node'))

    const apiImage = await client.callTool('insert_excalidraw_image', {
      projectDir,
      apiBaseUrl,
      batchId: 'api_image_insert',
      semanticId: 'api_synced_image',
      target: { elementIds: [inserted.structuredContent.insertedElementIds[0]] },
      image: {
        dataURL: TEST_PNG_DATA_URL,
        name: 'api-test-image.png'
      },
      placement: {
        margin: 10,
        fit: 'contain'
      }
    })
    assert.equal(apiImage.structuredContent.sourceMode, 'api')
    assert.ok(existsSync(apiImage.structuredContent.assetPath))
    const imageResponse = await fetch(`${apiBaseUrl}/api/scene`)
    const imagePayload = await imageResponse.json()
    const apiImageElement = imagePayload.scene.elements.find((element) => element.id === apiImage.structuredContent.imageElementId)
    assert.equal(apiImageElement.type, 'image')
    assert.equal(apiImageElement.crop, null)
    assert.deepEqual(apiImageElement.scale, [1, 1])
    assert.ok(imagePayload.scene.files[apiImageElement.fileId].dataURL.startsWith('data:image/png;base64,'))

    const comment = await client.callTool('add_excalidraw_comment', {
      projectDir,
      apiBaseUrl,
      target: { semanticIds: ['api_synced_node'] },
      body: 'API comment path should persist through local server.'
    })
    assert.equal(comment.structuredContent.sourceMode, 'api')

    const commentsResponse = await fetch(`${apiBaseUrl}/api/comments`)
    const commentsPayload = await commentsResponse.json()
    assert.equal(commentsPayload.comments.comments.length, 1)
    const apiCommentId = comment.structuredContent.comment.id

    const apiAction = {
      id: 'action_api_backed_review',
      type: 'comment',
      status: 'queued',
      commentId: apiCommentId,
      targetElementIds: comment.structuredContent.comment.targetElementIds,
      instruction: 'API action path should be claimable by Codex.',
      source: 'canvas-comment',
      projectDir,
      canvasDir: join(projectDir, 'canvas', 'excalidraw'),
      sceneFingerprint: null,
      selectionSnapshot: null,
      createdBy: 'user',
      claimedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    }
    const putActions = await fetch(`${apiBaseUrl}/api/actions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, actions: [apiAction] })
    })
    assert.equal(putActions.ok, true)

    const apiPendingActions = await client.callTool('get_pending_excalidraw_actions', {
      projectDir,
      apiBaseUrl
    })
    assert.equal(apiPendingActions.structuredContent.sourceMode, 'api')
    assert.equal(apiPendingActions.structuredContent.actions.actions[0].id, apiAction.id)

    const apiClaimedAction = await client.callTool('claim_excalidraw_action', {
      projectDir,
      apiBaseUrl,
      actionId: apiAction.id,
      claimedBy: 'test-suite'
    })
    assert.equal(apiClaimedAction.structuredContent.sourceMode, 'api')
    assert.equal(apiClaimedAction.structuredContent.action.status, 'running')

    const apiFailedAction = await client.callTool('complete_excalidraw_action', {
      projectDir,
      apiBaseUrl,
      actionId: apiAction.id,
      status: 'failed',
      error: 'test failure'
    })
    assert.equal(apiFailedAction.structuredContent.action.status, 'failed')
    assert.equal(apiFailedAction.structuredContent.commentStatus, null)

    const apiActionsResponse = await fetch(`${apiBaseUrl}/api/actions`)
    const apiActionsPayload = await apiActionsResponse.json()
    assert.equal(apiActionsPayload.actions.actions.find((item) => item.id === apiAction.id).status, 'failed')

    const switched = await client.callTool('switch_excalidraw_project', {
      projectDir: switchedProjectDir,
      apiBaseUrl,
      name: 'Switched Project'
    })
    assert.equal(switched.structuredContent.session.projectDir, switchedProjectDir)

    const switchedSessionResponse = await fetch(`${apiBaseUrl}/api/session`)
    const switchedSession = await switchedSessionResponse.json()
    assert.equal(switchedSession.session.projectDir, switchedProjectDir)
    assert.ok(switchedSession.projects.some((project) => project.projectDir === projectDir))
    assert.ok(switchedSession.projects.some((project) => project.projectDir === switchedProjectDir))

    const switchedInsert = await client.callTool('insert_excalidraw_elements', {
      projectDir: switchedProjectDir,
      apiBaseUrl,
      preferApi: false,
      elements: [
        {
          type: 'rectangle',
          semanticId: 'switched_project_node',
          x: 80,
          y: 80,
          width: 260,
          height: 112,
          label: 'Switched project node',
          style: { backgroundColor: '#fff4c2' }
        }
      ]
    })
    assert.equal(switchedInsert.structuredContent.sourceMode, 'file')
    assert.equal(switchedInsert.structuredContent.nativeConversion, false)

    const switchedSceneResponse = await fetch(`${apiBaseUrl}/api/scene`)
    const switchedScenePayload = await switchedSceneResponse.json()
    assert.ok(findBySemantic(switchedScenePayload.scene, 'switched_project_node'))
    assert.ok(!findBySemantic(switchedScenePayload.scene, 'api_synced_node'))

    await assertRejectsTool(
      () => client.callTool('insert_excalidraw_elements', {
        projectDir,
        apiBaseUrl,
        elements: [
          {
            type: 'rectangle',
            semanticId: 'must_not_write_to_inactive_project',
            x: 10,
            y: 10,
            width: 100,
            height: 80
          }
        ]
      }),
      'Canvas API points at'
    )
    const originalScene = await readScene(projectDir)
    assert.equal(Boolean(findBySemantic(originalScene, 'must_not_write_to_inactive_project')), false)

    const traversalResponse = await fetch(`${apiBaseUrl}/exports/%2e%2e%2fscene.excalidraw`)
    assert.equal(traversalResponse.status, 403)
    const activeSessionResponse = await fetch(`${apiBaseUrl}/api/session`)
    const activeSessionPayload = await activeSessionResponse.json()
    assertPathInsideOrSame(
      activeSessionPayload.session.canvasDir,
      join(activeSessionPayload.session.canvasDir, 'exports'),
      'Active exports directory should remain under the active canvas dir.'
    )
  } finally {
    await client.close()
    server.kill('SIGTERM')
    await sleep(250)
    if (server.exitCode && server.exitCode !== 0 && server.exitCode !== 143 && server.exitCode !== null) {
      throw new Error(`Vite exited with ${server.exitCode}. ${stderr}`)
    }
  }
}

async function runBoundaryProjectScenario(projectDir, outsideDir, explicitCanvasDir, repoCanvasBefore) {
  const client = new McpClient()
  try {
    await mkdir(projectDir, { recursive: true })
    await mkdir(outsideDir, { recursive: true })
    await mkdir(dirname(explicitCanvasDir), { recursive: true })
    await client.request('initialize', { protocolVersion: '2025-11-25' })
    const baseArgs = { projectDir, preferApi: false }

    const inserted = await client.callTool('insert_excalidraw_elements', {
      ...baseArgs,
      batchId: 'boundary_project_draw',
      elements: [
        {
          type: 'rectangle',
          semanticId: 'boundary_node',
          x: 24,
          y: 32,
          width: 220,
          height: 120,
          label: 'Boundary node',
          style: { backgroundColor: '#dff1ff' }
        }
      ]
    })
    assert.equal(inserted.structuredContent.sourceMode, 'file')
    const sceneFile = join(projectDir, 'canvas', 'excalidraw', 'scene.excalidraw')
    assert.equal(existsSync(sceneFile), true, 'Arbitrary nested project should receive its own scene file.')
    let scene = await readScene(projectDir)
    const boundaryNode = findBySemantic(scene, 'boundary_node')
    assert.ok(boundaryNode)

    const outsideSourceImage = join(outsideDir, 'outside source image.png')
    await writeFile(outsideSourceImage, pngBufferFromTestDataUrl())
    const outsideBefore = await listRelativeFiles(outsideDir)
    const imageInsert = await client.callTool('insert_excalidraw_image', {
      ...baseArgs,
      batchId: 'boundary_project_image',
      semanticId: 'boundary_image',
      target: { elementIds: [boundaryNode.id] },
      image: {
        filePath: outsideSourceImage,
        name: '../../../escaped-boundary-image.png'
      },
      placement: { margin: 6, fit: 'contain' }
    })
    const assetsDir = join(projectDir, 'canvas', 'excalidraw', 'assets')
    assertPathInside(assetsDir, imageInsert.structuredContent.assetPath, 'Image asset must stay inside arbitrary project assets dir.')
    assert.equal(existsSync(join(projectDir, 'escaped-boundary-image.png')), false)
    assert.equal(existsSync(join(dirname(projectDir), 'escaped-boundary-image.png')), false)
    assert.deepEqual(await listRelativeFiles(outsideDir), outsideBefore, 'External source directory must not receive generated image outputs.')

    const exported = await client.callTool('export_excalidraw_scene', {
      ...baseArgs,
      formats: ['excalidraw', 'json', 'svg'],
      fileNameBase: '../../escaped-boundary-export'
    })
    const exportsDir = join(projectDir, 'canvas', 'excalidraw', 'exports')
    for (const file of exported.structuredContent.exported) {
      assertPathInside(exportsDir, file.filePath, 'Exports must stay inside arbitrary project exports dir.')
    }
    assert.equal(existsSync(join(projectDir, 'escaped-boundary-export.excalidraw')), false)
    assert.equal(existsSync(join(dirname(projectDir), 'escaped-boundary-export.excalidraw')), false)

    const explicitInsert = await client.callTool('insert_excalidraw_elements', {
      canvasDir: explicitCanvasDir,
      preferApi: false,
      batchId: 'explicit_canvas_draw',
      elements: [
        {
          type: 'rectangle',
          semanticId: 'explicit_canvas_node',
          x: 12,
          y: 18,
          width: 180,
          height: 96,
          label: 'Explicit canvas node'
        }
      ]
    })
    assert.equal(explicitInsert.structuredContent.sourceMode, 'file')
    assert.equal(existsSync(join(explicitCanvasDir, 'scene.excalidraw')), true, 'Explicit arbitrary canvasDir should receive scene data.')

    const explicitImage = await client.callTool('insert_excalidraw_image', {
      canvasDir: explicitCanvasDir,
      preferApi: false,
      batchId: 'explicit_canvas_image',
      semanticId: 'explicit_canvas_image',
      image: {
        dataURL: TEST_PNG_DATA_URL,
        name: '../../explicit-overflow.png'
      },
      placement: {
        x: 20,
        y: 24,
        width: 80,
        height: 60
      }
    })
    assertPathInside(join(explicitCanvasDir, 'assets'), explicitImage.structuredContent.assetPath, 'Explicit canvas image asset must stay inside explicit canvasDir assets.')
    assert.equal(existsSync(join(dirname(explicitCanvasDir), 'explicit-overflow.png')), false)

    const explicitExport = await client.callTool('export_excalidraw_scene', {
      canvasDir: explicitCanvasDir,
      preferApi: false,
      formats: ['json'],
      fileNameBase: '../explicit-export-overflow'
    })
    for (const file of explicitExport.structuredContent.exported) {
      assertPathInside(join(explicitCanvasDir, 'exports'), file.filePath, 'Explicit canvas export must stay inside explicit canvasDir exports.')
    }
    assert.equal(existsSync(join(dirname(explicitCanvasDir), 'explicit-export-overflow.json')), false)

    const repoCanvasAfter = await listRelativeFiles(join(repoRoot, 'canvas', 'excalidraw'))
    assert.deepEqual(repoCanvasAfter, repoCanvasBefore, 'Boundary scenario must not write user canvas artifacts into the plugin repository.')
  } finally {
    await client.close()
  }
}

async function main() {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'codex-excalidraw-test-'))
  const fileProject = join(tmpRoot, 'file-backed-project')
  const apiProject = join(tmpRoot, 'api-backed-project')
  const boundaryProject = join(tmpRoot, 'project with spaces', 'nested project folder')
  const boundaryOutside = join(tmpRoot, 'outside generated outputs')
  const explicitCanvasDir = join(tmpRoot, 'explicit canvas folder with spaces', 'canvas data')
  const repoCanvasBefore = await listRelativeFiles(join(repoRoot, 'canvas', 'excalidraw'))
  try {
    await mkdir(fileProject, { recursive: true })
    await mkdir(apiProject, { recursive: true })
    await runFileBackedScenario(fileProject)
    await runApiBackedScenario(apiProject)
    await runBoundaryProjectScenario(boundaryProject, boundaryOutside, explicitCanvasDir, repoCanvasBefore)
    console.log(JSON.stringify({ ok: true, fileProject, apiProject, boundaryProject, explicitCanvasDir }, null, 2))
  } finally {
    if (process.env.KEEP_CODEX_EXCALIDRAW_TESTS !== '1') {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
