import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const TEST_PNG_DATA_URL = makeTestPngDataUrl(96, 64)
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
      const isDiagonal = Math.abs(x - y) < 5
      const isLeft = x < width / 2
      row[offset] = isDiagonal ? 255 : isLeft ? 255 : 0
      row[offset + 1] = isDiagonal ? 214 : isLeft ? 0 : 190
      row[offset + 2] = isDiagonal ? 10 : isLeft ? 190 : 255
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

function chromeExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('No Chrome executable found. Set PLAYWRIGHT_CHROME_EXECUTABLE to run browser E2E tests.')
}

async function waitFor(condition, label, timeoutMs = 8000, intervalMs = 120) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await condition()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

async function fetchJson(apiBaseUrl, path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, options)
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${text}`)
  }
  return body
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

async function readExecutorRuns(projectDir) {
  return JSON.parse(await readFile(join(projectDir, 'canvas', 'excalidraw', 'executor-runs.json'), 'utf8'))
}

function visibleElements(scene) {
  return (scene.elements ?? []).filter((element) => !element.isDeleted)
}

function findBySemantic(scene, semanticId) {
  return visibleElements(scene).find((element) => element.customData?.codex?.semanticId === semanticId)
}

function startCanvas(projectDir, requestedPort) {
  const prefix = 'Codex Excalidraw canvas: '
  const child = spawn('./scripts/start-canvas.sh', [projectDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_EXCALIDRAW_PORT: String(requestedPort),
      CODEX_EXCALIDRAW_EXECUTOR_ADAPTER: 'mock',
      CODEX_EXCALIDRAW_MOCK_EXECUTOR_STEP_DELAY_MS: '800'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const urlReady = new Promise((resolveUrl, rejectUrl) => {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (line.startsWith(prefix)) {
        resolveUrl(line.slice(prefix.length).trim())
      }
    })
    child.on('exit', (code) => {
      rejectUrl(new Error(`Canvas server exited with ${code}. ${stderr}`))
    })
  })

  return { child, urlReady }
}

async function stopProcess(child) {
  if (!child || child.killed) return
  child.kill('SIGTERM')
  await sleep(250)
  if (!child.killed) child.kill('SIGKILL')
}

class McpClient {
  constructor() {
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ''
    this.child = spawn(process.execPath, ['./mcp/server.mjs'], {
      cwd: repoRoot,
      env: process.env,
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
    const { resolve: resolveRequest, reject } = this.pending.get(message.id)
    this.pending.delete(message.id)
    if (message.error) {
      reject(new Error(message.error.message))
      return
    }
    resolveRequest(message.result)
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

async function createNativeElementsResult(apiBaseUrl, elements, batchId, rendering) {
  const createPayload = await fetchJson(apiBaseUrl, '/api/native-elements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batchId, elements, rendering })
  })
  const requestId = createPayload.request.id
  const completed = await waitFor(
    async () => {
      const payload = await fetchJson(apiBaseUrl, `/api/native-elements/${encodeURIComponent(requestId)}`)
      return payload.request.status === 'completed' ? payload.request : null
    },
    `native browser conversion ${requestId}`,
    10000
  )
  return completed.result
}

async function createNativeElements(apiBaseUrl, elements, batchId) {
  const result = await createNativeElementsResult(apiBaseUrl, elements, batchId)
  return result.insertedElementIds
}

async function focusViewport(apiBaseUrl, viewport, message) {
  const createPayload = await fetchJson(apiBaseUrl, '/api/viewport', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ viewport, message })
  })
  const requestId = createPayload.request.id
  const completed = await waitFor(
    async () => {
      const payload = await fetchJson(apiBaseUrl, `/api/viewport/${encodeURIComponent(requestId)}`)
      return payload.request.status === 'completed' ? payload.request : null
    },
    `viewport focus ${requestId}`,
    10000
  )
  return completed
}

async function createVisualValidation(apiBaseUrl, payload) {
  const createPayload = await fetchJson(apiBaseUrl, '/api/visual-validation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const requestId = createPayload.request.id
  const completed = await waitFor(
    async () => {
      const response = await fetchJson(apiBaseUrl, `/api/visual-validation/${encodeURIComponent(requestId)}`)
      return response.request.status === 'completed' ? response.request : null
    },
    `visual validation ${requestId}`,
    10000
  )
  return completed.result
}

function expandViewport(viewport, scale) {
  const safeScale = Number.isFinite(scale) && scale > 1 ? scale : 1.4
  const width = Math.max(1, viewport.width * safeScale)
  const height = Math.max(1, viewport.height * safeScale)
  return {
    x: viewport.x - (width - viewport.width) / 2,
    y: viewport.y - (height - viewport.height) / 2,
    width,
    height
  }
}

async function focusExpandedViewport(apiBaseUrl, viewport, message, scale = 1.55) {
  await focusViewport(apiBaseUrl, expandViewport(viewport, scale), message)
  await sleep(420)
}

async function clickTestId(page, testId) {
  const locator = page.getByTestId(testId)
  await assert.equal(await locator.count(), 1, `${testId} should resolve to one element`)
  await locator.click()
}

async function fillTestId(page, testId, value) {
  const locator = page.getByTestId(testId)
  await assert.equal(await locator.count(), 1, `${testId} should resolve to one element`)
  await locator.fill(value)
}

async function exportFromMenu(page, optionTestId) {
  await clickTestId(page, 'export-menu-trigger')
  await page.getByTestId('export-dropdown').waitFor({ state: 'visible' })
  await clickTestId(page, optionTestId)
}

async function ensureSidePanelVisible(page) {
  const visible = await page.getByTestId('side-panel').isVisible().catch(() => false)
  if (visible) return
  await clickTestId(page, 'side-panel-toggle')
  await page.getByTestId('side-panel').waitFor({ state: 'visible' })
}

async function ensureSidePanelHidden(page) {
  const visible = await page.getByTestId('side-panel').isVisible().catch(() => false)
  if (!visible) return
  await clickTestId(page, 'side-panel-toggle')
  await waitFor(async () => !(await page.getByTestId('side-panel').isVisible().catch(() => false)), 'side panel hidden')
}

async function clearCanvasSelectionForScreenshot(page) {
  const canvasShell = await page.getByTestId('canvas-shell').boundingBox()
  if (canvasShell) {
    await page.mouse.click(canvasShell.x + canvasShell.width - 96, canvasShell.y + 140)
  }
  await page.keyboard.press('Escape')
  await sleep(180)
}

async function countGeneratedImagePixels(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')]
      .map((canvas) => ({
        canvas,
        area: canvas.width * canvas.height
      }))
      .sort((left, right) => right.area - left.area)
    const target = canvases[0]?.canvas
    if (!target) return 0
    const context = target.getContext('2d')
    if (!context) return 0
    const data = context.getImageData(0, 0, target.width, target.height).data
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      const alpha = data[index + 3]
      const magenta = red > 220 && green < 70 && blue > 150
      const cyan = red < 70 && green > 150 && blue > 220
      const yellow = red > 220 && green > 170 && blue < 80
      if (alpha > 220 && (magenta || cyan || yellow)) count += 1
    }
    return count
  })
}

async function generatedImagePixelBounds(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')]
      .map((canvas) => ({
        canvas,
        area: canvas.width * canvas.height
      }))
      .sort((left, right) => right.area - left.area)
    const target = canvases[0]?.canvas
    if (!target) return null
    const context = target.getContext('2d')
    if (!context) return null
    const data = context.getImageData(0, 0, target.width, target.height).data
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let count = 0
    for (let y = 0; y < target.height; y += 1) {
      for (let x = 0; x < target.width; x += 1) {
        const index = (y * target.width + x) * 4
        const red = data[index]
        const green = data[index + 1]
        const blue = data[index + 2]
        const alpha = data[index + 3]
        const magenta = red > 220 && green < 70 && blue > 150
        const cyan = red < 70 && green > 150 && blue > 220
        const yellow = red > 220 && green > 170 && blue < 80
        if (alpha > 220 && (magenta || cyan || yellow)) {
          count += 1
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
    if (count <= 100) return null
    const rect = target.getBoundingClientRect()
    const left = rect.left + (minX / target.width) * rect.width
    const top = rect.top + (minY / target.height) * rect.height
    const right = rect.left + (maxX / target.width) * rect.width
    const bottom = rect.top + (maxY / target.height) * rect.height
    return {
      count,
      left,
      top,
      right,
      bottom,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2
    }
  })
}

async function launchBrowser() {
  const executablePath = chromeExecutablePath()
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await chromium.launch({
        executablePath,
        headless: true,
        args: ['--disable-gpu', '--no-first-run']
      })
    } catch (error) {
      lastError = error
      await sleep(500 * attempt)
    }
  }
  throw lastError
}

async function main() {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'codex-excalidraw-browser-e2e-'))
  const projectA = join(tmpRoot, 'project A with spaces')
  const projectB = join(tmpRoot, 'project B with spaces')
  const outsideDir = join(tmpRoot, 'outside artifacts')
  const screenshotsDir = join(tmpRoot, 'screenshots')
  await mkdir(projectA, { recursive: true })
  await mkdir(projectB, { recursive: true })
  await mkdir(outsideDir, { recursive: true })
  await mkdir(screenshotsDir, { recursive: true })

  const repoCanvasBefore = await listRelativeFiles(join(repoRoot, 'canvas', 'excalidraw'))
  const requestedPort = 45818 + Math.floor(Math.random() * 1000)
  const server = startCanvas(projectA, requestedPort)
  let browser
  let mcp

  try {
    const url = await server.urlReady
    const apiBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url
    await waitFor(() => fetchJson(apiBaseUrl, '/api/session'), 'canvas session endpoint')

    browser = await launchBrowser()
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1366, height: 900 }
    })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message)
    })

    await page.goto(url)
    await page.getByTestId('app-shell').waitFor({ state: 'visible' })
    assert.equal(await page.title(), 'Codex Excalidraw Canvas')
    assert.equal(await page.getByTestId('side-panel').isVisible(), true)
    await page.screenshot({ path: join(screenshotsDir, '01-initial.png') })

    const sessionA = await fetchJson(apiBaseUrl, '/api/session')
    assert.equal(sessionA.session.projectDir, projectA)
    assertPathInsideOrSame(projectA, sessionA.session.canvasDir, 'Session canvasDir must be inside project A.')

    const nativeInitialResult = await createNativeElementsResult(
      apiBaseUrl,
      [
        {
          id: 'browser_e2e_rect_a',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 84,
          height: 40,
          label: { text: 'Browser E2E chart', fontSize: 12 },
          semanticId: 'browser_e2e_chart',
          style: {
            backgroundColor: '#dbeafe',
            strokeColor: '#dbeafe',
            roughness: 1
          }
        },
        {
          id: 'browser_e2e_text_a',
          type: 'text',
          x: 32,
          y: 180,
          text: 'Generated from browser runtime',
          semanticId: 'browser_e2e_caption',
          fontSize: 22
        },
        {
          id: 'browser_e2e_abs_arrow',
          type: 'arrow',
          x: 420,
          y: 60,
          width: -180,
          height: 0,
          points: [[420, 60], [240, 60]],
          semanticId: 'browser_e2e_abs_arrow',
          style: { strokeColor: '#2563eb' }
        }
      ],
      'browser_e2e_initial_chart',
      { mode: 'progressive', stepDelayMs: 20, maxSteps: 8 }
    )
    const insertedIds = nativeInitialResult.insertedElementIds
    assert.ok(insertedIds.includes('browser_e2e_rect_a'))
    assert.equal(nativeInitialResult.rendering.mode, 'progressive')
    assert.equal(nativeInitialResult.layoutValidation.repaired, true)
    assert.ok(nativeInitialResult.layoutValidation.repairCount >= 2)

    let sceneA = await waitFor(async () => {
      const scene = await readScene(projectA)
      return visibleElements(scene).length >= 2 ? scene : null
    }, 'project A scene after native browser insert')
    assert.equal(Object.prototype.hasOwnProperty.call(sceneA.appState ?? {}, 'theme'), false)
    const repairedBrowserNode = sceneA.elements.find((element) => element.id === 'browser_e2e_rect_a')
    assert.ok(repairedBrowserNode.width >= 120)
    assert.ok(repairedBrowserNode.height >= 60)
    assert.notEqual(repairedBrowserNode.strokeColor, repairedBrowserNode.backgroundColor)
    const repairedBrowserArrow = sceneA.elements.find((element) => element.id === 'browser_e2e_abs_arrow')
    assert.ok(repairedBrowserArrow)
    assert.equal(Math.round(repairedBrowserArrow.x), 240)
    assert.equal(Math.round(repairedBrowserArrow.width), 180)
    assert.ok(repairedBrowserArrow.points.every((point) => Math.abs(point[0]) <= 1 && Math.abs(point[1]) <= 1))

    await page.waitForTimeout(700)
    const persistedAfterDelay = await readScene(projectA)
    assert.equal(visibleElements(persistedAfterDelay).length >= 2, true, 'Native browser insert should not be cleared by autosave.')
    await page.screenshot({ path: join(screenshotsDir, '02-native-insert.png') })

    const canvasBox = await page.locator('[data-testid="canvas-shell"] canvas').last().boundingBox()
    assert.ok(canvasBox, 'Canvas should be measurable.')
    await page.keyboard.press('v')
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
    await page.keyboard.press('ControlOrMeta+A')
    const selection = await waitFor(async () => {
      const payload = await fetchJson(apiBaseUrl, '/api/selection')
      return payload.selection.selectedElementIds?.length > 0 ? payload.selection : null
    }, 'selection written after real canvas keyboard selection')
    assert.ok(selection.selectedElementIds.includes('browser_e2e_rect_a'))

    const viewportFocus = await focusViewport(
      apiBaseUrl,
      { x: -120, y: -80, width: 800, height: 600 },
      'Browser E2E viewport focus'
    )
    assert.equal(viewportFocus.status, 'completed')

    await page.getByTestId('comment-input').waitFor({ state: 'visible' })
    await fillTestId(page, 'comment-input', '请把这个节点标记为已验证，并保留结构化目标。')
    await clickTestId(page, 'run-draft-comment-button')
    const commentsA = await waitFor(async () => {
      const comments = await readComments(projectA)
      return comments.comments?.length === 1 ? comments : null
    }, 'comment created from browser UI')
    const commentId = commentsA.comments[0].id
    assert.deepEqual(commentsA.comments[0].targetElementIds, selection.selectedElementIds)
    assert.equal(await page.getByTestId('comment-item').count(), 1)

    const actionsA = await waitFor(async () => {
      const actions = await readActions(projectA)
      return actions.actions?.length === 1 ? actions : null
    }, 'Run with Codex browser action created')
    assert.equal(actionsA.actions[0].commentId, commentId)
    assert.deepEqual(actionsA.actions[0].targetElementIds, selection.selectedElementIds)
    const actionId = actionsA.actions[0].id
    await page.getByTestId('executor-run-card').waitFor({ state: 'visible' })
    assert.equal(await page.getByTestId('app-shell').isVisible(), true, 'App shell must remain visible while executor runs.')
    assert.equal(await page.getByTestId('canvas-shell').isVisible(), true, 'Canvas must remain visible while executor runs.')
    assert.equal(await page.getByTestId('app-status').isVisible().catch(() => false), false, 'Executor run must not return the app to a loading screen.')
    await waitFor(async () => {
      const text = await page.getByTestId('executor-run-card').textContent()
      return text && text.length > 0 ? true : null
    }, 'executor progress card rendered with content')
    const completedRun = await waitFor(async () => {
      const runs = await readExecutorRuns(projectA)
      return runs.runs?.find((run) => run.actionId === actionId && run.status === 'completed') ?? null
    }, 'local executor run completed')
    assert.equal(completedRun.executorId, 'mock-codex')
    const completedActionState = await waitFor(async () => {
      const actions = await readActions(projectA)
      const comments = await readComments(projectA)
      const action = actions.actions?.find((item) => item.id === actionId)
      const comment = comments.comments?.find((item) => item.id === commentId)
      return action?.status === 'completed' && comment?.status === 'resolved' ? { action, comment } : null
    }, 'executor completion reflected in action and comment state')
    assert.deepEqual(completedActionState.action.targetElementIds, selection.selectedElementIds)
    sceneA = await readScene(projectA)
    const executorUpdatedElement = visibleElements(sceneA).find((element) => element.id === 'browser_e2e_rect_a')
    assert.equal(executorUpdatedElement?.customData?.codex?.executorRunId, completedRun.id)
    assert.equal(executorUpdatedElement?.customData?.codex?.executorStatus, 'completed')
    await page.screenshot({ path: join(screenshotsDir, '03-executor-run.png') })

    const cancelAction = {
      id: 'browser_e2e_cancel_action',
      type: 'comment',
      status: 'queued',
      commentId: null,
      targetElementIds: ['browser_e2e_rect_a'],
      instruction: 'Cancel this executor run before applying additional canvas changes.',
      source: 'browser-e2e',
      projectDir: projectA,
      canvasDir: sessionA.session.canvasDir,
      sceneFingerprint: null,
      selectionSnapshot: null,
      createdBy: 'test',
      claimedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    }
    const actionsBeforeCancel = await readActions(projectA)
    await fetchJson(apiBaseUrl, '/api/actions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, actions: [cancelAction, ...actionsBeforeCancel.actions] })
    })
    const executorRequestHeaders = {
      'content-type': 'application/json',
      'x-codex-excalidraw-executor-token': sessionA.session.executorToken
    }
    const cancelRunStart = await fetchJson(apiBaseUrl, '/api/executor-runs', {
      method: 'POST',
      headers: executorRequestHeaders,
      body: JSON.stringify({ actionId: cancelAction.id, executorId: 'mock-codex' })
    })
    const cancelRunResponse = await fetchJson(apiBaseUrl, `/api/executor-runs/${encodeURIComponent(cancelRunStart.run.id)}/cancel`, {
      method: 'POST',
      headers: executorRequestHeaders,
      body: JSON.stringify({})
    })
    assert.equal(cancelRunResponse.run.status, 'canceled')
    await sleep(1900)
    const canceledRuns = await readExecutorRuns(projectA)
    const canceledRun = canceledRuns.runs.find((run) => run.id === cancelRunStart.run.id)
    assert.equal(canceledRun?.status, 'canceled')
    const canceledActions = await readActions(projectA)
    const canceledAction = canceledActions.actions.find((action) => action.id === cancelAction.id)
    assert.equal(canceledAction?.status, 'canceled')
    assert.equal(canceledAction?.executorRunId, cancelRunStart.run.id)

    mcp = new McpClient()
    await ensureSidePanelHidden(page)
    await page.keyboard.press('Escape')
    const sequenceDiagram = await mcp.callTool('insert_excalidraw_diagram', {
      projectDir: projectA,
      apiBaseUrl,
      batchId: 'browser_e2e_sequence_ir',
      sourceFormat: 'ir',
      kind: 'sequence',
      rendering: { mode: 'progressive', stepDelayMs: 25, maxSteps: 12 },
      diagram: {
        title: 'Asset registration workflow',
        subtitle: 'Browser E2E verifies the lane layout through native Excalidraw conversion.',
        layout: { x: -240, y: 760 },
        participants: [
          { id: 'user', label: 'User request' },
          { id: 'agent', label: 'Registration Agent' },
          { id: 'catalog', label: 'Catalog contracts' },
          { id: 'validation', label: 'Validation and evals' }
        ],
        messages: [
          { id: 'submit', from: 'user', to: 'agent', label: 'Submit governed asset requirement' },
          { id: 'inspect', from: 'agent', to: 'catalog', label: 'Inspect contract and capability index' },
          { id: 'project', from: 'catalog', to: 'user', label: 'Ask for explicit project' },
          { id: 'validate', from: 'agent', to: 'validation', label: 'Profile, register, and validate' }
        ],
        notes: [
          {
            id: 'contract',
            afterMessageId: 'inspect',
            from: 'agent',
            to: 'catalog',
            text: 'Use structural contract data; do not infer from display labels.'
          }
        ],
        gates: [
          {
            id: 'project_gate',
            afterMessageId: 'project',
            lane: 'user',
            text: 'Project selected?'
          }
        ]
      }
    })
    assert.equal(sequenceDiagram.structuredContent.sourceMode, 'api')
    assert.equal(sequenceDiagram.structuredContent.nativeConversion, true)
    assert.equal(sequenceDiagram.structuredContent.kind, 'sequence')
    assert.equal(sequenceDiagram.structuredContent.rendering.mode, 'progressive')
    sceneA = await waitFor(async () => {
      const scene = await readScene(projectA)
      return findBySemantic(scene, 'seq_gate_project_gate') ? scene : null
    }, 'sequence diagram persisted through MCP native conversion')
    assert.ok(findBySemantic(sceneA, 'seq_participant_agent'))
    await focusExpandedViewport(apiBaseUrl, sequenceDiagram.structuredContent.viewport, 'Browser E2E sequence diagram overview', 1.65)
    await clearCanvasSelectionForScreenshot(page)
    await page.screenshot({ path: join(screenshotsDir, '03-sequence-diagram.png') })

    const flowchartDiagram = await mcp.callTool('insert_excalidraw_diagram', {
      projectDir: projectA,
      apiBaseUrl,
      batchId: 'browser_e2e_flowchart_ir',
      sourceFormat: 'ir',
      kind: 'flowchart',
      rendering: { mode: 'progressive', stepDelayMs: 25, maxSteps: 10 },
      diagram: {
        title: 'Unified diagram pipeline',
        subtitle: 'ELK computes node-edge layout; shared renderer owns visual style.',
        layout: { x: -80, y: 1760, direction: 'RIGHT' },
        nodes: [
          { id: 'intent', label: 'User intent', shape: 'ellipse' },
          { id: 'ir', label: 'Diagram IR', details: ['kind', 'nodes', 'edges'] },
          { id: 'layout', label: 'Layout adapter', details: ['ELK layered'] },
          { id: 'renderer', label: 'Shared renderer', details: ['style tokens', 'semantic ids'] },
          { id: 'scene', label: 'Editable scene', shape: 'ellipse' }
        ],
        edges: [
          { id: 'intent_to_ir', from: 'intent', to: 'ir', label: 'normalize' },
          { id: 'ir_to_layout', from: 'ir', to: 'layout', label: 'place' },
          { id: 'layout_to_renderer', from: 'layout', to: 'renderer', label: 'coordinates' },
          { id: 'renderer_to_scene', from: 'renderer', to: 'scene', label: 'skeletons' }
        ]
      }
    })
    assert.equal(flowchartDiagram.structuredContent.sourceMode, 'api')
    assert.equal(flowchartDiagram.structuredContent.nativeConversion, true)
    assert.equal(flowchartDiagram.structuredContent.kind, 'flowchart')
    assert.equal(flowchartDiagram.structuredContent.diagramLayout.engine, 'elk')
    sceneA = await waitFor(async () => {
      const scene = await readScene(projectA)
      return findBySemantic(scene, 'flowchart_node_renderer') ? scene : null
    }, 'flowchart diagram persisted through MCP native conversion')
    assert.ok(findBySemantic(sceneA, 'flowchart_edge_renderer_to_scene'))
    await focusExpandedViewport(apiBaseUrl, flowchartDiagram.structuredContent.viewport, 'Browser E2E flowchart overview', 1.75)
    const flowchartVisual = await createVisualValidation(apiBaseUrl, {
      batchId: 'browser_e2e_flowchart_ir',
      elementIds: flowchartDiagram.structuredContent.insertedElementIds,
      fileNameBase: 'browser-e2e-flowchart-visual'
    })
    assert.equal(flowchartVisual.renderer, 'excalidraw-exportToSvg')
    assert.notEqual(flowchartVisual.qualityReport.status, 'fail')
    assert.equal(flowchartVisual.degraded, undefined)
    const visualExportsDirA = join(projectA, 'canvas', 'excalidraw', 'exports')
    assert.ok(existsSync(flowchartVisual.filePath), 'Live visual validation should write an official SVG preview.')
    assertPathInside(visualExportsDirA, flowchartVisual.filePath, 'Live visual validation preview must stay inside project A exports.')
    await clearCanvasSelectionForScreenshot(page)
    await page.screenshot({ path: join(screenshotsDir, '04-flowchart-diagram.png') })

    const erDiagram = await mcp.callTool('insert_excalidraw_diagram', {
      projectDir: projectA,
      apiBaseUrl,
      batchId: 'browser_e2e_er_ir',
      sourceFormat: 'ir',
      kind: 'er',
      rendering: { mode: 'progressive', stepDelayMs: 20, maxSteps: 14 },
      diagram: {
        title: 'Commerce data model',
        subtitle: 'Complex node-edge IR with fields and labeled relationships.',
        layout: { x: -120, y: 2320, direction: 'RIGHT', layerSpacing: 140, nodeSpacing: 90 },
        nodes: [
          { id: 'customer', label: 'Customer', fields: ['customer_id PK', 'name', 'segment'] },
          { id: 'order', label: 'Order', fields: ['order_id PK', 'customer_id FK', 'status', 'created_at'] },
          { id: 'order_item', label: 'OrderItem', fields: ['order_id FK', 'sku_id FK', 'quantity', 'unit_price'] },
          { id: 'product', label: 'Product', fields: ['sku_id PK', 'category', 'active_flag'] },
          { id: 'payment', label: 'Payment', fields: ['payment_id PK', 'order_id FK', 'amount', 'state'] },
          { id: 'shipment', label: 'Shipment', fields: ['shipment_id PK', 'order_id FK', 'carrier', 'delivered_at'] }
        ],
        edges: [
          { id: 'customer_order', from: 'customer', to: 'order', label: 'places' },
          { id: 'order_item_rel', from: 'order', to: 'order_item', label: 'contains' },
          { id: 'item_product', from: 'order_item', to: 'product', label: 'references' },
          { id: 'order_payment', from: 'order', to: 'payment', label: 'paid by' },
          { id: 'order_shipment', from: 'order', to: 'shipment', label: 'fulfilled by' },
          { id: 'payment_retry', from: 'payment', to: 'order', label: 'updates status', dashed: true }
        ]
      }
    })
    assert.equal(erDiagram.structuredContent.sourceMode, 'api')
    assert.equal(erDiagram.structuredContent.nativeConversion, true)
    assert.equal(erDiagram.structuredContent.kind, 'er')
    sceneA = await waitFor(async () => {
      const scene = await readScene(projectA)
      return findBySemantic(scene, 'er_node_order_item') ? scene : null
    }, 'complex ER diagram persisted through MCP native conversion')
    assert.ok(findBySemantic(sceneA, 'er_edge_order_payment'))
    await focusExpandedViewport(apiBaseUrl, erDiagram.structuredContent.viewport, 'Browser E2E ER diagram overview', 1.8)
    await clearCanvasSelectionForScreenshot(page)
    await page.screenshot({ path: join(screenshotsDir, '05-er-diagram.png') })

    const imageInsert = await mcp.callTool('insert_excalidraw_image', {
      projectDir: projectA,
      apiBaseUrl,
      batchId: 'browser_e2e_image_insert',
      semanticId: 'browser_e2e_generated_image',
      target: { elementIds: ['browser_e2e_rect_a'] },
      image: {
        dataURL: TEST_PORTRAIT_PNG_DATA_URL,
        name: '../../browser-e2e-overflow.png'
      },
      placement: {
        fit: 'cover',
        margin: 8,
        alignX: 'center',
        alignY: 'center'
      }
    })
    assert.equal(imageInsert.structuredContent.sourceMode, 'api')
    assert.equal(imageInsert.structuredContent.placement.fit, 'cover')
    assert.equal(imageInsert.structuredContent.placement.crop.naturalWidth, 64)
    assert.equal(imageInsert.structuredContent.placement.crop.naturalHeight, 128)
    assertPathInside(join(projectA, 'canvas', 'excalidraw', 'assets'), imageInsert.structuredContent.assetPath, 'Image asset must stay inside project A assets.')
    assert.equal(existsSync(join(projectA, 'browser-e2e-overflow.png')), false)
    assert.equal(existsSync(join(tmpRoot, 'browser-e2e-overflow.png')), false)
    sceneA = await waitFor(async () => {
      const scene = await readScene(projectA)
      return visibleElements(scene).some((element) => element.type === 'image') ? scene : null
    }, 'image element persisted through MCP/API path')
    assert.ok(Object.keys(sceneA.files ?? {}).length > 0)
    const insertedImageId = imageInsert.structuredContent.imageElementId
    const insertedImageBeforeDrag = visibleElements(sceneA).find((element) => element.id === insertedImageId)
    assert.equal(insertedImageBeforeDrag?.type, 'image')
    assert.equal(insertedImageBeforeDrag.width, repairedBrowserNode.width - 16)
    assert.equal(insertedImageBeforeDrag.height, repairedBrowserNode.height - 16)
    assert.equal(insertedImageBeforeDrag.crop.naturalWidth, 64)
    assert.equal(insertedImageBeforeDrag.crop.naturalHeight, 128)
    assert.deepEqual(insertedImageBeforeDrag.scale, [1, 1])
    const renderedImagePixels = await waitFor(async () => {
      const count = await countGeneratedImagePixels(page)
      return count > 100 ? count : null
    }, 'generated image pixels rendered on Excalidraw canvas')
    assert.ok(renderedImagePixels > 100)
    const imagePixelBounds = await waitFor(
      () => generatedImagePixelBounds(page),
      'generated image pixel bounds available'
    )
    await page.mouse.click(imagePixelBounds.centerX, imagePixelBounds.centerY)
    const imageSelection = await waitFor(async () => {
      const payload = await fetchJson(apiBaseUrl, '/api/selection')
      return payload.selection.selectedElementIds?.includes(insertedImageId) ? payload.selection : null
    }, 'inserted image can be selected from the canvas')
    assert.ok(imageSelection.selectedElements.some((element) => element.id === insertedImageId && element.type === 'image'))
    await page.mouse.move(imagePixelBounds.centerX, imagePixelBounds.centerY)
    await page.mouse.down()
    await page.mouse.move(imagePixelBounds.centerX + 42, imagePixelBounds.centerY + 24, { steps: 8 })
    await page.mouse.up()
    sceneA = await waitFor(async () => {
      const scene = await readScene(projectA)
      const movedImage = visibleElements(scene).find((element) => element.id === insertedImageId)
      if (!movedImage) return null
      const movedX = Math.abs(movedImage.x - insertedImageBeforeDrag.x) > 1
      const movedY = Math.abs(movedImage.y - insertedImageBeforeDrag.y) > 1
      return movedX || movedY ? scene : null
    }, 'inserted image can be dragged on the canvas')
    await page.screenshot({ path: join(screenshotsDir, '03-image-and-comment.png') })

    await ensureSidePanelVisible(page)
    await clickTestId(page, 'settings-button')
    await page.getByTestId('settings-drawer').waitFor({ state: 'visible' })
    await page.getByTestId('runtime-settings-section').waitFor({ state: 'visible' })
    await page.getByTestId('stop-local-canvas-button').waitFor({ state: 'visible' })
    await page.getByTestId('executor-settings-section').waitFor({ state: 'visible' })
    await page.getByTestId('executor-option-mock-codex').waitFor({ state: 'visible' })
    const localModeClass = await page.getByTestId('executor-mode-local-button').getAttribute('class')
    assert.ok(localModeClass.includes('segment-option--active'), 'Local executor mode should be active by default in mock E2E.')
    await clickTestId(page, 'executor-scan-button')
    await waitFor(
      async () => !(await page.getByTestId('executor-scan-button').isDisabled()),
      'executor scan button re-enabled'
    )
    await waitFor(async () => {
      const payload = await fetchJson(apiBaseUrl, '/api/executors')
      return payload.selectedExecutorId === 'mock-codex' ? payload : null
    }, 'executor scan keeps mock executor selected')
    await clickTestId(page, 'language-en-button')
    await page.getByText('Annotations', { exact: true }).waitFor({ state: 'visible' })
    await clickTestId(page, 'theme-dark-button')
    await waitFor(
      async () => page.evaluate(() => document.querySelector('[data-testid="app-shell"]')?.classList.contains('app-shell--dark')),
      'dark theme on app shell'
    )
    assert.equal(await page.evaluate(() => window.localStorage.getItem('codex-excalidraw-theme')), 'dark')
    await page.screenshot({ path: join(screenshotsDir, '04-dark-settings.png') })
    await clickTestId(page, 'settings-close-button')
    await page.getByTestId('settings-drawer').waitFor({ state: 'hidden' })

    await ensureSidePanelVisible(page)
    await clickTestId(page, 'side-panel-toggle')
    await waitFor(async () => !(await page.getByTestId('side-panel').isVisible().catch(() => false)), 'side panel collapsed')
    await clickTestId(page, 'side-panel-toggle')
    await page.getByTestId('side-panel').waitFor({ state: 'visible' })
    const widthBeforeResize = await page.getByTestId('side-panel').boundingBox()
    const resizerBox = await page.getByTestId('panel-resizer').boundingBox()
    assert.ok(widthBeforeResize && resizerBox)
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 40)
    await page.mouse.down()
    await page.mouse.move(resizerBox.x - 460, resizerBox.y + 40)
    await page.mouse.up()
    const widthAfterResize = await page.getByTestId('side-panel').boundingBox()
    assert.ok(widthAfterResize.width > widthBeforeResize.width, 'Panel resize should increase width when dragging left.')
    assert.ok(widthAfterResize.width > 700, 'Panel resize should support widths beyond the previous fixed max.')

    await exportFromMenu(page, 'export-option-json')
    await exportFromMenu(page, 'export-option-svg')
    await exportFromMenu(page, 'export-option-png')
    const exportsDirA = join(projectA, 'canvas', 'excalidraw', 'exports')
    await waitFor(async () => {
      const files = await listRelativeFiles(exportsDirA)
      return files.some((file) => file.endsWith('.json')) && files.some((file) => file.endsWith('.svg')) && files.some((file) => file.endsWith('.png'))
    }, 'browser exports written in project A')

    await clickTestId(page, 'project-menu-trigger')
    await page.getByTestId('project-dropdown').waitFor({ state: 'visible' })
    const projectDropdownBox = await page.getByTestId('project-dropdown').boundingBox()
    assert.ok(projectDropdownBox?.width >= 600, 'Project dropdown should use the wider topbar space.')
    await clickTestId(page, 'project-copy-path-button')
    await page.getByText('Project path copied', { exact: true }).waitFor({ state: 'visible' })
    await page.screenshot({ path: join(screenshotsDir, '04-project-dropdown.png') })
    await fillTestId(page, 'project-input', projectB)
    await clickTestId(page, 'project-open-button')
    await waitFor(async () => {
      const session = await fetchJson(apiBaseUrl, '/api/session')
      return session.session.projectDir === projectB ? session : null
    }, 'project B activated through browser project menu')
    await page.getByTestId('app-shell').waitFor({ state: 'visible' })
    await ensureSidePanelVisible(page)

    await createNativeElements(
      apiBaseUrl,
      [
        {
          id: 'browser_e2e_rect_b',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 210,
          height: 120,
          label: { text: 'Project B retained' },
          semanticId: 'browser_e2e_project_b',
          style: { backgroundColor: '#dcfce7', strokeColor: '#15803d' }
        }
      ],
      'browser_e2e_project_b_chart'
    )
    const sceneB = await waitFor(async () => {
      const scene = await readScene(projectB)
      return visibleElements(scene).some((element) => element.id === 'browser_e2e_rect_b') ? scene : null
    }, 'project B scene after native insert')
    assert.equal(visibleElements(sceneB).some((element) => element.id === 'browser_e2e_rect_a'), false)

    await clickTestId(page, 'project-menu-trigger')
    await page.getByTestId('project-dropdown').waitFor({ state: 'visible' })
    await page.getByTestId('project-select').selectOption(projectA)
    await waitFor(async () => {
      const session = await fetchJson(apiBaseUrl, '/api/session')
      return session.session.projectDir === projectA ? session : null
    }, 'project A reactivated through recent project select')
    await page.getByTestId('app-shell').waitFor({ state: 'visible' })
    const restoredSceneA = await readScene(projectA)
    assert.ok(visibleElements(restoredSceneA).some((element) => element.id === 'browser_e2e_rect_a'))
    assert.equal(visibleElements(restoredSceneA).some((element) => element.id === 'browser_e2e_rect_b'), false)

    await page.reload()
    await page.getByTestId('app-shell').waitFor({ state: 'visible' })
    await waitFor(async () => {
      const comments = await readComments(projectA)
      const scene = await readScene(projectA)
      return comments.comments?.some((comment) => comment.id === commentId) && visibleElements(scene).some((element) => element.type === 'image')
    }, 'project A persisted through browser reload')
    await clickTestId(page, 'delete-comment-button')
    await waitFor(async () => {
      const comments = await readComments(projectA)
      const actions = await readActions(projectA)
      const commentDeleted = !comments.comments?.some((comment) => comment.id === commentId)
      const actionDeleted = !actions.actions?.some((action) => action.commentId === commentId)
      return commentDeleted && actionDeleted ? { comments, actions } : null
    }, 'comment deletion persisted and removed linked action')
    assert.equal(await page.getByTestId('comment-item').count(), 0)

    const mobilePage = await context.newPage()
    await mobilePage.setViewportSize({ width: 390, height: 844 })
    await mobilePage.goto(url)
    await mobilePage.getByTestId('app-shell').waitFor({ state: 'visible' })
    await mobilePage.screenshot({ path: join(screenshotsDir, '05-mobile-load.png') })
    await mobilePage.close()

    assert.deepEqual(await listRelativeFiles(outsideDir), [], 'Outside artifacts directory must remain empty.')
    const repoCanvasAfter = await listRelativeFiles(join(repoRoot, 'canvas', 'excalidraw'))
    assert.deepEqual(repoCanvasAfter, repoCanvasBefore, 'Browser E2E must not write artifacts into the plugin repo canvas.')
    assertPathInsideOrSame(projectA, join(projectA, 'canvas', 'excalidraw', 'scene.excalidraw'), 'Project A scene must stay inside project A.')
    assertPathInsideOrSame(projectB, join(projectB, 'canvas', 'excalidraw', 'scene.excalidraw'), 'Project B scene must stay inside project B.')

    assert.deepEqual(consoleErrors, [], `Browser console/page errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      url,
      projectA,
      projectB,
      screenshotsDir,
      checks: [
        'app-load',
        'native-browser-draw',
        'viewport-focus-runtime',
        'real-canvas-selection',
        'comment-run-with-codex',
        'local-executor-run-progress-no-blank',
        'executor-action-comment-state-sync',
        'executor-cancel-state-stable',
        'mcp-sequence-diagram-native-conversion',
        'mcp-flowchart-diagram-native-conversion',
        'live-visual-validation-official-svg',
        'mcp-complex-er-diagram-native-conversion',
        'executor-settings-scan',
        'mcp-image-insert-visible-runtime',
        'mcp-image-select-drag-runtime',
        'settings-language-theme',
        'panel-collapse-resize',
        'browser-export-json-svg-png',
        'multi-project-switch-restore',
        'reload-persistence',
        'mobile-load',
        'artifact-boundary'
      ]
    }, null, 2))
  } finally {
    if (mcp) await mcp.close()
    if (browser) await browser.close()
    await stopProcess(server.child)
    if (process.env.CODEX_EXCALIDRAW_KEEP_E2E !== '1') {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
