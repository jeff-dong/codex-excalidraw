import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const REAL_EXECUTOR_TIMEOUT_MS = Number(process.env.CODEX_EXCALIDRAW_REAL_EXECUTOR_TIMEOUT_MS ?? 600000)

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function assertPathInside(parent, child, message) {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  const relativePath = relative(normalizedParent, normalizedChild)
  const [firstSegment] = relativePath.split(sep)
  assert.ok(relativePath && firstSegment !== '..' && !isAbsolute(relativePath), message)
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
  throw new Error('No Chrome executable found. Set PLAYWRIGHT_CHROME_EXECUTABLE to run real executor E2E.')
}

async function waitFor(condition, label, timeoutMs = 8000, intervalMs = 150) {
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
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${text}`)
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

async function readExecutorSessions(projectDir) {
  return JSON.parse(await readFile(join(projectDir, 'canvas', 'excalidraw', 'executor-sessions.json'), 'utf8'))
}

function visibleElements(scene) {
  return (scene.elements ?? []).filter((element) => !element.isDeleted)
}

function startCanvas(projectDir, requestedPort) {
  const prefix = 'Codex Excalidraw canvas: '
  const child = spawn('./scripts/start-canvas.sh', [projectDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_EXCALIDRAW_PORT: String(requestedPort),
      CODEX_EXCALIDRAW_EXECUTOR_ADAPTER: ''
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
      if (line.startsWith(prefix)) resolveUrl(line.slice(prefix.length).trim())
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

async function createNativeElements(apiBaseUrl, elements, batchId) {
  const createPayload = await fetchJson(apiBaseUrl, '/api/native-elements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batchId, elements })
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
  return completed.result.insertedElementIds
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

async function launchBrowser() {
  return chromium.launch({
    executablePath: chromeExecutablePath(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run']
  })
}

async function main() {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'codex-excalidraw-real-executor-'))
  const projectDir = join(tmpRoot, 'real executor project')
  const screenshotsDir = join(tmpRoot, 'screenshots')
  await mkdir(projectDir, { recursive: true })
  await mkdir(screenshotsDir, { recursive: true })

  const repoCanvasBefore = await listRelativeFiles(join(repoRoot, 'canvas', 'excalidraw'))
  const requestedPort = 46880 + Math.floor(Math.random() * 600)
  const server = startCanvas(projectDir, requestedPort)
  let browser

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
    await waitFor(async () => {
      const payload = await fetchJson(apiBaseUrl, '/api/executors')
      return payload.selectedExecutorId === 'codex-cli' ? payload : null
    }, 'real codex executor selected', 15000)

    await createNativeElements(
      apiBaseUrl,
      [
        {
          id: 'real_executor_target_rect',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 260,
          height: 150,
          label: { text: 'Real executor target' },
          semanticId: 'real_executor_target',
          style: {
            backgroundColor: '#dbeafe',
            strokeColor: '#1d4ed8',
            roughness: 1
          }
        }
      ],
      'real_executor_target_batch'
    )
    await waitFor(async () => {
      const scene = await readScene(projectDir)
      return visibleElements(scene).some((element) => element.id === 'real_executor_target_rect') ? scene : null
    }, 'target rectangle inserted')

    const canvasBox = await page.locator('[data-testid="canvas-shell"] canvas').last().boundingBox()
    assert.ok(canvasBox, 'Canvas should be measurable.')
    await page.keyboard.press('v')
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
    await waitFor(async () => {
      const payload = await fetchJson(apiBaseUrl, '/api/selection')
      return payload.selection.selectedElementIds?.includes('real_executor_target_rect') ? payload.selection : null
    }, 'target selected in browser')

    await fillTestId(
      page,
      'comment-input',
      'Use update_excalidraw_elements on this action targetElementIds only. Set the target rectangle backgroundColor to #bbf7d0 and strokeColor to #15803d. Complete the action when done.'
    )
    await clickTestId(page, 'add-comment-button')
    const comments = await waitFor(async () => {
      const payload = await readComments(projectDir)
      return payload.comments?.length === 1 ? payload : null
    }, 'comment created')
    const commentId = comments.comments[0].id

    await clickTestId(page, 'run-comment-button')
    await page.getByTestId('executor-run-card').waitFor({ state: 'visible' })
    await waitFor(async () => !(await page.getByTestId('app-status').isVisible().catch(() => false)), 'no loading screen during real executor run')
    await page.screenshot({ path: join(screenshotsDir, '01-real-executor-running.png'), fullPage: true })

    const completedRun = await waitFor(async () => {
      const runs = await readExecutorRuns(projectDir)
      const run = runs.runs?.find((item) => item.executorId === 'codex-cli')
      if (!run) return null
      if (run.status === 'failed' || run.status === 'canceled') {
        throw new Error(JSON.stringify({ status: run.status, error: run.error, events: run.events }))
      }
      return run.status === 'completed' ? run : null
    }, 'real Codex CLI executor completed', REAL_EXECUTOR_TIMEOUT_MS, 1000)
    assert.ok(completedRun.result?.providerSessionId, 'Real Codex executor must report a provider session id.')

    const persistedExecutorSession = await waitFor(async () => {
      const sessions = await readExecutorSessions(projectDir)
      return sessions.sessions?.find((item) =>
        item.executorId === 'codex-cli' &&
        item.canvasDir === join(projectDir, 'canvas', 'excalidraw') &&
        item.providerSessionId === completedRun.result.providerSessionId
      ) ?? null
    }, 'real Codex CLI provider session persisted', 30000)
    assert.equal(persistedExecutorSession.projectDir, projectDir)

    const completedState = await waitFor(async () => {
      const scene = await readScene(projectDir)
      const actions = await readActions(projectDir)
      const latestComments = await readComments(projectDir)
      const target = visibleElements(scene).find((element) => element.id === 'real_executor_target_rect')
      const action = actions.actions?.find((item) => item.commentId === commentId)
      const comment = latestComments.comments?.find((item) => item.id === commentId)
      return target?.backgroundColor === '#bbf7d0' && action?.status === 'completed' && comment?.status === 'resolved'
        ? { target, action, comment }
        : null
    }, 'real executor scene/action/comment persisted', 30000)
    assert.equal(completedState.target.strokeColor, '#15803d')
    assert.equal(completedState.action.executorRunId, completedRun.id)
    assert.equal(completedState.action.executorId, 'codex-cli')
    assert.equal(completedState.action.error, null)
    assert.equal(completedState.action.result?.executor?.exitCode, 0)
    await page.screenshot({ path: join(screenshotsDir, '02-real-executor-completed.png'), fullPage: true })

    const repoCanvasAfter = await listRelativeFiles(join(repoRoot, 'canvas', 'excalidraw'))
    assert.deepEqual(repoCanvasAfter, repoCanvasBefore, 'Real executor E2E must not write artifacts into plugin repo canvas.')
    assertPathInside(projectDir, join(projectDir, 'canvas', 'excalidraw', 'scene.excalidraw'), 'Scene must stay inside real executor project.')
    assert.deepEqual(consoleErrors, [], `Browser console/page errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      url,
      projectDir,
      screenshotsDir,
      runId: completedRun.id,
      checks: [
        'real-codex-cli-selected',
        'browser-comment-created',
        'real-run-progress-visible',
        'no-loading-screen-during-real-run',
        'real-provider-session-persisted',
        'real-codex-cli-updated-scene',
        'action-comment-state-sync',
        'artifact-boundary',
        'screenshots-kept'
      ]
    }, null, 2))
  } finally {
    if (browser) await browser.close()
    await stopProcess(server.child)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
