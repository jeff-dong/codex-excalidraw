import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createExecutorRuntime } from './lib/executor-runtime.mjs'

const initialProjectDir = resolve(process.env.CODEX_EXCALIDRAW_PROJECT_DIR ?? process.cwd())
const initialCanvasDir = resolve(process.env.CODEX_EXCALIDRAW_CANVAS_DIR ?? join(initialProjectDir, 'canvas', 'excalidraw'))
const registryFile = resolve(process.env.CODEX_EXCALIDRAW_REGISTRY_FILE ?? join(homedir(), '.codex-excalidraw', 'projects.json'))
let activeProjectDir = initialProjectDir
let activeCanvasDir = initialCanvasDir
let activeApiBaseUrl = process.env.CODEX_EXCALIDRAW_API_URL ?? 'http://127.0.0.1:43218'
const executorCapabilityToken = process.env.CODEX_EXCALIDRAW_EXECUTOR_TOKEN ?? randomUUID()
const sceneEventClients = new Set()
let sceneEventVersion = 0
let nativeElementRequestSeq = 0
const nativeElementRequests = new Map()
const NATIVE_ELEMENT_REQUEST_TTL_MS = 90_000
let viewportRequestSeq = 0
const viewportRequests = new Map()
const VIEWPORT_REQUEST_TTL_MS = 90_000
let visualValidationRequestSeq = 0
const visualValidationRequests = new Map()
const VISUAL_VALIDATION_REQUEST_TTL_MS = 90_000
let shutdownTimer = null

const mimeTypes = new Map([
  ['.apng', 'image/apng'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.excalidraw', 'application/json']
])

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function activePaths() {
  return {
    projectDir: activeProjectDir,
    canvasDir: activeCanvasDir,
    sceneFile: join(activeCanvasDir, 'scene.excalidraw'),
    selectionFile: join(activeCanvasDir, 'selection.json'),
    commentsFile: join(activeCanvasDir, 'comments.json'),
    actionsFile: join(activeCanvasDir, 'actions.json'),
    executorConfigFile: join(activeCanvasDir, 'executor-config.json'),
    executorRunsFile: join(activeCanvasDir, 'executor-runs.json'),
    executorSessionsFile: join(activeCanvasDir, 'executor-sessions.json'),
    sessionFile: join(activeCanvasDir, 'session.json'),
    exportsDir: join(activeCanvasDir, 'exports'),
    assetsDir: join(activeCanvasDir, 'assets'),
    checkpointsDir: join(activeCanvasDir, 'checkpoints')
  }
}

function canvasDirForProject(projectDir) {
  return join(resolve(projectDir), 'canvas', 'excalidraw')
}

function readRequestBody(req, encoding = 'utf8') {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 50 * 1024 * 1024) {
        rejectBody(new Error('Request body is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const buffer = Buffer.concat(chunks)
      resolveBody(encoding === null ? buffer : buffer.toString(encoding))
    })
    req.on('error', rejectBody)
  })
}

function isSafeChildPath(parent, child) {
  const pathToChild = relative(parent, child)
  const [firstSegment] = pathToChild.split(sep)
  return Boolean(pathToChild) && firstSegment !== '..' && !isAbsolute(pathToChild)
}

function isPathInsideOrSame(parent, child) {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  if (normalizedChild === normalizedParent) return true
  const pathToChild = relative(normalizedParent, normalizedChild)
  const [firstSegment] = pathToChild.split(sep)
  return Boolean(pathToChild) && firstSegment !== '..' && !isAbsolute(pathToChild)
}

function isCanvasStoragePath(filePath) {
  const absolutePath = resolve(filePath)
  const paths = activePaths()
  return isPathInsideOrSame(paths.canvasDir, absolutePath) || absolutePath === registryFile
}

function isAllowedFileNameChar(char) {
  const code = char.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === '.' ||
    char === '_' ||
    char === '-'
  )
}

function trimDashes(value) {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '-') start += 1
  while (end > start && value[end - 1] === '-') end -= 1
  return value.slice(start, end)
}

function sanitizeFileName(name, fallbackName) {
  const rawName = basename(String(name || fallbackName || 'export'))
  const ext = extname(rawName)
  let base = ''
  for (const char of rawName.slice(0, rawName.length - ext.length)) {
    base += isAllowedFileNameChar(char) ? char : '-'
  }
  base = trimDashes(base)
  return `${base || 'export'}${ext || extname(fallbackName) || '.bin'}`
}

function safeProjectName(projectDir, explicitName) {
  const cleanName = typeof explicitName === 'string' && explicitName.trim() ? explicitName.trim() : basename(projectDir)
  return cleanName || projectDir
}

function isScene(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.type === 'excalidraw' &&
    Array.isArray(value.elements) &&
    value.appState &&
    typeof value.appState === 'object' &&
    value.files &&
    typeof value.files === 'object'
  )
}

function emptyScene() {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'codex-excalidraw-canvas',
    elements: [],
    appState: {
      viewBackgroundColor: '#fbfbfa',
      currentItemFontFamily: 1
    },
    files: {}
  }
}

function sceneForStorage(scene) {
  const appState = scene?.appState && typeof scene.appState === 'object' ? { ...scene.appState } : {}
  delete appState.theme
  return {
    ...scene,
    appState
  }
}

function emptyActions() {
  return {
    version: 1,
    actions: []
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tempFile, filePath)
}

async function readProjectRegistry() {
  const registry = await readJsonFile(registryFile, { version: 1, projects: [] })
  return {
    version: 1,
    projects: Array.isArray(registry.projects) ? registry.projects : []
  }
}

async function writeProjectRegistry(registry) {
  await writeJsonAtomic(registryFile, registry)
}

async function upsertProjectRegistry(projectDir, name) {
  const normalizedProjectDir = resolve(projectDir)
  const registry = await readProjectRegistry()
  const now = new Date().toISOString()
  const entry = {
    projectDir: normalizedProjectDir,
    canvasDir: canvasDirForProject(normalizedProjectDir),
    name: safeProjectName(normalizedProjectDir, name),
    lastOpenedAt: now
  }
  const projects = [
    entry,
    ...registry.projects.filter((project) => resolve(project.projectDir) !== normalizedProjectDir)
  ].slice(0, 24)
  await writeProjectRegistry({ version: 1, projects })
  return { version: 1, projects }
}

function sessionPayload(projects = []) {
  const paths = activePaths()
  return {
    session: {
      apiBaseUrl: activeApiBaseUrl,
      projectDir: paths.projectDir,
      canvasDir: paths.canvasDir,
      sceneFile: paths.sceneFile,
      selectionFile: paths.selectionFile,
      commentsFile: paths.commentsFile,
      actionsFile: paths.actionsFile,
      sessionFile: paths.sessionFile,
      exportsDir: paths.exportsDir,
      executorConfigFile: paths.executorConfigFile,
      executorRunsFile: paths.executorRunsFile,
      executorSessionsFile: paths.executorSessionsFile,
      executorToken: executorCapabilityToken,
      updatedAt: new Date().toISOString()
    },
    projects
  }
}

async function writeActiveSessionFile() {
  const { sessionFile } = activePaths()
  await writeJsonAtomic(sessionFile, sessionPayload().session)
}

async function activateProject(projectDir, name) {
  const normalizedProjectDir = resolve(projectDir)
  activeProjectDir = normalizedProjectDir
  activeCanvasDir = canvasDirForProject(normalizedProjectDir)
  await mkdir(activeCanvasDir, { recursive: true })
  const registry = await upsertProjectRegistry(normalizedProjectDir, name)
  await writeActiveSessionFile()
  return sessionPayload(registry.projects)
}

async function getSessionPayload() {
  const registry = await upsertProjectRegistry(activeProjectDir, safeProjectName(activeProjectDir))
  await writeActiveSessionFile()
  return sessionPayload(registry.projects)
}

function broadcastSceneChanged(paths, eventName = 'scene-changed', metadata = {}) {
  const payload = {
    version: ++sceneEventVersion,
    updatedAt: new Date().toISOString(),
    paths,
    ...metadata
  }

  for (const client of sceneEventClients) {
    if (client.destroyed) {
      sceneEventClients.delete(client)
      continue
    }
    client.write(`event: ${eventName}\n`)
    client.write(`id: ${payload.version}\n`)
    client.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
}

function nativeElementRequestView(request) {
  return {
    id: request.id,
    batchId: request.batchId,
    elements: request.elements,
    rendering: request.rendering,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    result: request.result,
    error: request.error
  }
}

function pruneNativeElementRequests() {
  const now = Date.now()
  for (const [id, request] of nativeElementRequests.entries()) {
    if (request.status === 'queued') continue
    if (now - request.updatedAtMs > NATIVE_ELEMENT_REQUEST_TTL_MS) {
      nativeElementRequests.delete(id)
    }
  }
}

function createNativeElementRequest(payload) {
  const now = new Date()
  const id = `native_elements_${now.getTime().toString(36)}_${nativeElementRequestSeq.toString(36)}`
  nativeElementRequestSeq += 1
  const request = {
    id,
    batchId: typeof payload.batchId === 'string' && payload.batchId.trim() ? payload.batchId.trim() : null,
    elements: payload.elements,
    rendering: payload.rendering && typeof payload.rendering === 'object' && !Array.isArray(payload.rendering) ? payload.rendering : null,
    status: 'queued',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    updatedAtMs: now.getTime(),
    result: null,
    error: null
  }
  nativeElementRequests.set(id, request)
  return request
}

function completeNativeElementRequest(id, payload) {
  const request = nativeElementRequests.get(id)
  if (!request) return null
  const now = new Date()
  const status = payload.status === 'failed' ? 'failed' : 'completed'
  request.status = status
  request.updatedAt = now.toISOString()
  request.updatedAtMs = now.getTime()
  request.result = status === 'completed' ? payload.result ?? null : null
  request.error = status === 'failed' ? String(payload.error ?? 'Native element conversion failed.') : null
  return request
}

function viewportRequestView(request) {
  return {
    id: request.id,
    viewport: request.viewport,
    message: request.message,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    error: request.error
  }
}

function visualValidationRequestView(request) {
  return {
    id: request.id,
    batchId: request.batchId,
    elementIds: request.elementIds,
    viewport: request.viewport,
    fileNameBase: request.fileNameBase,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    result: request.result,
    error: request.error
  }
}

function pruneVisualValidationRequests() {
  const now = Date.now()
  for (const [id, request] of visualValidationRequests.entries()) {
    if (request.status === 'queued') continue
    if (now - request.updatedAtMs > VISUAL_VALIDATION_REQUEST_TTL_MS) {
      visualValidationRequests.delete(id)
    }
  }
}

function pruneViewportRequests() {
  const now = Date.now()
  for (const [id, request] of viewportRequests.entries()) {
    if (request.status === 'queued') continue
    if (now - request.updatedAtMs > VIEWPORT_REQUEST_TTL_MS) {
      viewportRequests.delete(id)
    }
  }
}

function normalizeViewportRequest(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height)
  ) {
    return null
  }
  const width = Math.max(1, value.width)
  const height = Math.max(1, value.height)
  return {
    x: value.x,
    y: value.y,
    width,
    height
  }
}

function normalizeElementIds(value) {
  if (!Array.isArray(value)) return []
  const output = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    output.push(text)
  }
  return output
}

function createVisualValidationRequest(payload) {
  const now = new Date()
  const id = `visual_validation_${now.getTime().toString(36)}_${visualValidationRequestSeq.toString(36)}`
  visualValidationRequestSeq += 1
  const request = {
    id,
    batchId: typeof payload.batchId === 'string' && payload.batchId.trim() ? payload.batchId.trim() : null,
    elementIds: normalizeElementIds(payload.elementIds),
    viewport: normalizeViewportRequest(payload.viewport),
    fileNameBase: typeof payload.fileNameBase === 'string' && payload.fileNameBase.trim() ? payload.fileNameBase.trim() : null,
    status: 'queued',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    updatedAtMs: now.getTime(),
    result: null,
    error: null
  }
  visualValidationRequests.set(id, request)
  return request
}

function completeVisualValidationRequest(id, payload) {
  const request = visualValidationRequests.get(id)
  if (!request) return null
  const now = new Date()
  const status = payload.status === 'failed' ? 'failed' : 'completed'
  request.status = status
  request.updatedAt = now.toISOString()
  request.updatedAtMs = now.getTime()
  request.result = status === 'completed' ? payload.result ?? null : null
  request.error = status === 'failed' ? String(payload.error ?? 'Visual validation failed.') : null
  return request
}

function createViewportRequest(payload) {
  const viewport = normalizeViewportRequest(payload?.viewport)
  if (!viewport) return null
  const now = new Date()
  const id = `viewport_${now.getTime().toString(36)}_${viewportRequestSeq.toString(36)}`
  viewportRequestSeq += 1
  const request = {
    id,
    viewport,
    message: typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : null,
    status: 'queued',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    updatedAtMs: now.getTime(),
    error: null
  }
  viewportRequests.set(id, request)
  return request
}

function completeViewportRequest(id, payload) {
  const request = viewportRequests.get(id)
  if (!request) return null
  const now = new Date()
  const status = payload.status === 'failed' ? 'failed' : 'completed'
  request.status = status
  request.updatedAt = now.toISOString()
  request.updatedAtMs = now.getTime()
  request.error = status === 'failed' ? String(payload.error ?? 'Viewport request failed.') : null
  return request
}

function nativeElementRequestIdFromUrl(req) {
  const rawUrl = String(req.url || '')
  const queryIndex = rawUrl.indexOf('?')
  const rawPathname = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl
  const [, id] = rawPathname.split('/')
  return id ? decodeURIComponent(id) : null
}

function requestPathSegments(req) {
  const rawUrl = String(req.url || '')
  const queryIndex = rawUrl.indexOf('?')
  const rawPathname = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl
  return rawPathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment))
}

function isLocalOrigin(value) {
  if (!value) return true
  try {
    const url = new URL(value)
    const apiUrl = new URL(activeApiBaseUrl)
    return url.origin === apiUrl.origin && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

function isExecutorMutationAllowed(req) {
  if (!isLocalOrigin(req.headers.origin)) return false
  if (!isLocalOrigin(`http://${req.headers.host ?? ''}`)) return false
  return req.headers['x-codex-excalidraw-executor-token'] === executorCapabilityToken
}

function isLocalMutationAllowed(req) {
  return isLocalOrigin(req.headers.origin) && isLocalOrigin(`http://${req.headers.host ?? ''}`)
}

function scheduleLocalCanvasShutdown(server) {
  if (shutdownTimer) return false
  shutdownTimer = setTimeout(async () => {
    for (const client of sceneEventClients) {
      try {
        client.end()
      } catch {
        // Ignore stale event streams while the local canvas is shutting down.
      }
    }
    sceneEventClients.clear()
    try {
      await server.close()
    } catch (error) {
      console.error(`Failed to close Codex Excalidraw server cleanly: ${error.message}`)
    } finally {
      setTimeout(() => {
        process.exit(0)
      }, 50)
    }
  }, 120)
  return true
}

async function saveExport(payload) {
  const { exportsDir, projectDir } = activePaths()
  const fileName = sanitizeFileName(payload.fileName, 'export.bin')
  const filePath = resolve(join(exportsDir, fileName))
  if (!isSafeChildPath(exportsDir, filePath)) {
    throw new Error(`Unsafe export path: ${filePath}`)
  }

  const encoding = payload.encoding === 'base64' ? 'base64' : 'utf8'
  const data = typeof payload.data === 'string' ? payload.data : ''
  await mkdir(exportsDir, { recursive: true })
  await writeFile(filePath, Buffer.from(data, encoding))
  return { fileName, filePath, relativePath: relative(projectDir, filePath) }
}

async function serveStaticFile(req, res, next) {
  const rawUrl = String(req.url || '')
  const queryIndex = rawUrl.indexOf('?')
  const rawPathname = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl
  const { exportsDir, assetsDir } = activePaths()
  const staticRoutes = new Map([
    ['exports', exportsDir],
    ['assets', assetsDir]
  ])
  const [, routeSegment, ...requestedSegments] = rawPathname.split('/')
  const staticDir = staticRoutes.get(routeSegment)
  if (!staticDir) {
    next()
    return
  }

  const requestedPath = decodeURIComponent(requestedSegments.join('/'))
  const filePath = resolve(join(staticDir, requestedPath))
  if (!isSafeChildPath(staticDir, filePath)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', mimeTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream')
    res.setHeader('content-length', String(fileStat.size))
    createReadStream(filePath).pipe(res)
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    next(error)
  }
}

const executorRuntime = createExecutorRuntime({
  activePaths,
  apiBaseUrl: () => activeApiBaseUrl,
  broadcast: broadcastSceneChanged
})

function canvasStoragePlugin() {
  return {
    name: 'codex-excalidraw-storage',
    configureServer(server) {
      const configuredPort = server.config.server.port ?? 43218
      activeApiBaseUrl = process.env.CODEX_EXCALIDRAW_API_URL ?? `http://127.0.0.1:${configuredPort}`
      activateProject(activeProjectDir).catch((error) => {
        console.error(`Failed to initialize Codex Excalidraw session: ${error.message}`)
      })

      server.middlewares.use(serveStaticFile)

      server.middlewares.use('/api/scene-events', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.write(`: connected\n\n`)
        sceneEventClients.add(res)
        const heartbeat = setInterval(() => {
          res.write(`: heartbeat ${Date.now()}\n\n`)
        }, 25000)
        req.on('close', () => {
          clearInterval(heartbeat)
          sceneEventClients.delete(res)
        })
      })

      server.middlewares.use('/api/scene', async (req, res) => {
        try {
          const { canvasDir, sceneFile } = activePaths()
          if (req.method === 'GET') {
            const scene = sceneForStorage(await readJsonFile(sceneFile, emptyScene()))
            sendJson(res, 200, { scene, path: sceneFile, canvasDir })
            return
          }

          if (req.method === 'PUT') {
            const scene = JSON.parse(await readRequestBody(req))
            if (!isScene(scene)) {
              sendJson(res, 400, { error: 'Expected an Excalidraw scene.' })
              return
            }
            const nextScene = sceneForStorage(scene)
            await writeJsonAtomic(sceneFile, nextScene)
            const originClientId = typeof req.headers['x-codex-excalidraw-client-id'] === 'string'
              ? req.headers['x-codex-excalidraw-client-id']
              : null
            broadcastSceneChanged([sceneFile], 'scene-changed', originClientId ? { originClientId } : {})
            sendJson(res, 200, { ok: true, path: sceneFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/selection', async (req, res) => {
        try {
          const { selectionFile } = activePaths()
          if (req.method === 'GET') {
            const selection = await readJsonFile(selectionFile, {
              selectedElementIds: [],
              selectedElements: [],
              updatedAt: null
            })
            sendJson(res, 200, { selection, path: selectionFile })
            return
          }

          if (req.method === 'PUT') {
            const selection = JSON.parse(await readRequestBody(req))
            if (!selection || typeof selection !== 'object' || !Array.isArray(selection.selectedElements)) {
              sendJson(res, 400, { error: 'Expected a selection payload.' })
              return
            }
            await writeJsonAtomic(selectionFile, selection)
            sendJson(res, 200, { ok: true, path: selectionFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/comments', async (req, res) => {
        try {
          const { commentsFile } = activePaths()
          if (req.method === 'GET') {
            const comments = await readJsonFile(commentsFile, { version: 1, comments: [] })
            sendJson(res, 200, { comments, path: commentsFile })
            return
          }

          if (req.method === 'PUT') {
            const comments = JSON.parse(await readRequestBody(req))
            if (!comments || typeof comments !== 'object' || !Array.isArray(comments.comments)) {
              sendJson(res, 400, { error: 'Expected a comments payload.' })
              return
            }
            await writeJsonAtomic(commentsFile, comments)
            broadcastSceneChanged([commentsFile], 'comments-changed')
            sendJson(res, 200, { ok: true, path: commentsFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/actions', async (req, res) => {
        try {
          const { actionsFile } = activePaths()
          if (req.method === 'GET') {
            const actions = await readJsonFile(actionsFile, emptyActions())
            sendJson(res, 200, { actions, path: actionsFile })
            return
          }

          if (req.method === 'PUT') {
            const actions = JSON.parse(await readRequestBody(req))
            if (!actions || typeof actions !== 'object' || !Array.isArray(actions.actions)) {
              sendJson(res, 400, { error: 'Expected an actions payload.' })
              return
            }
            await writeJsonAtomic(actionsFile, actions)
            broadcastSceneChanged([actionsFile], 'actions-changed')
            sendJson(res, 200, { ok: true, path: actionsFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/executors', async (req, res) => {
        try {
          const [operation] = requestPathSegments(req)
          if (req.method === 'GET') {
            sendJson(res, 200, await executorRuntime.scanExecutors())
            return
          }

          if (req.method === 'POST' && operation === 'scan') {
            if (!isExecutorMutationAllowed(req)) {
              sendJson(res, 403, { error: 'Executor mutation is not allowed for this request.' })
              return
            }
            sendJson(res, 200, await executorRuntime.scanExecutors())
            return
          }

          if (req.method === 'PUT') {
            if (!isExecutorMutationAllowed(req)) {
              sendJson(res, 403, { error: 'Executor mutation is not allowed for this request.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            const config = await executorRuntime.writeConfig(payload && typeof payload === 'object' ? payload : {})
            sendJson(res, 200, { config })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, POST, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/executor-runs', async (req, res) => {
        try {
          const [runId, operation] = requestPathSegments(req)
          if (req.method === 'GET') {
            sendJson(res, 200, { runs: await executorRuntime.readRuns() })
            return
          }

          if (!isExecutorMutationAllowed(req)) {
            sendJson(res, 403, { error: 'Executor mutation is not allowed for this request.' })
            return
          }

          if (req.method === 'POST' && !runId) {
            const payload = JSON.parse(await readRequestBody(req))
            const run = await executorRuntime.startActionRun(payload && typeof payload === 'object' ? payload : {})
            sendJson(res, 202, { run })
            return
          }

          if (req.method === 'POST' && runId && operation === 'cancel') {
            const run = await executorRuntime.cancelRun(runId)
            sendJson(res, 200, { run })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, POST')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/native-elements', async (req, res) => {
        try {
          pruneNativeElementRequests()

          if (req.method === 'GET') {
            const requestId = nativeElementRequestIdFromUrl(req)
            if (requestId) {
              const request = nativeElementRequests.get(requestId)
              if (!request) {
                sendJson(res, 404, { error: 'Native element request not found.' })
                return
              }
              sendJson(res, 200, { request: nativeElementRequestView(request) })
              return
            }

            const requests = [...nativeElementRequests.values()]
              .filter((request) => request.status === 'queued')
              .map(nativeElementRequestView)
            sendJson(res, 200, { requests })
            return
          }

          if (req.method === 'POST') {
            if (sceneEventClients.size === 0) {
              sendJson(res, 409, { error: 'No active browser canvas runtime is connected.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            if (!payload || typeof payload !== 'object' || !Array.isArray(payload.elements) || payload.elements.length === 0) {
              sendJson(res, 400, { error: 'Expected native element specs.' })
              return
            }
            const request = createNativeElementRequest(payload)
            const { sceneFile } = activePaths()
            broadcastSceneChanged([sceneFile], 'native-elements-requested', { requestId: request.id })
            sendJson(res, 202, { request: nativeElementRequestView(request) })
            return
          }

          if (req.method === 'PUT') {
            const requestId = nativeElementRequestIdFromUrl(req)
            if (!requestId) {
              sendJson(res, 400, { error: 'Native element request id is required.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            const request = completeNativeElementRequest(requestId, payload && typeof payload === 'object' ? payload : {})
            if (!request) {
              sendJson(res, 404, { error: 'Native element request not found.' })
              return
            }
            sendJson(res, 200, { request: nativeElementRequestView(request) })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, POST, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/viewport', async (req, res) => {
        try {
          pruneViewportRequests()

          if (req.method === 'GET') {
            const requestId = nativeElementRequestIdFromUrl(req)
            if (requestId) {
              const request = viewportRequests.get(requestId)
              if (!request) {
                sendJson(res, 404, { error: 'Viewport request not found.' })
                return
              }
              sendJson(res, 200, { request: viewportRequestView(request) })
              return
            }

            const requests = [...viewportRequests.values()]
              .filter((request) => request.status === 'queued')
              .map(viewportRequestView)
            sendJson(res, 200, { requests })
            return
          }

          if (req.method === 'POST') {
            if (sceneEventClients.size === 0) {
              sendJson(res, 409, { error: 'No active browser canvas runtime is connected.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            const request = createViewportRequest(payload && typeof payload === 'object' ? payload : {})
            if (!request) {
              sendJson(res, 400, { error: 'Expected a viewport rectangle.' })
              return
            }
            const { sceneFile } = activePaths()
            broadcastSceneChanged([sceneFile], 'viewport-requested', { requestId: request.id })
            sendJson(res, 202, { request: viewportRequestView(request) })
            return
          }

          if (req.method === 'PUT') {
            const requestId = nativeElementRequestIdFromUrl(req)
            if (!requestId) {
              sendJson(res, 400, { error: 'Viewport request id is required.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            const request = completeViewportRequest(requestId, payload && typeof payload === 'object' ? payload : {})
            if (!request) {
              sendJson(res, 404, { error: 'Viewport request not found.' })
              return
            }
            sendJson(res, 200, { request: viewportRequestView(request) })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, POST, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/visual-validation', async (req, res) => {
        try {
          pruneVisualValidationRequests()

          if (req.method === 'GET') {
            const requestId = nativeElementRequestIdFromUrl(req)
            if (requestId) {
              const request = visualValidationRequests.get(requestId)
              if (!request) {
                sendJson(res, 404, { error: 'Visual validation request not found.' })
                return
              }
              sendJson(res, 200, { request: visualValidationRequestView(request) })
              return
            }

            const requests = [...visualValidationRequests.values()]
              .filter((request) => request.status === 'queued')
              .map(visualValidationRequestView)
            sendJson(res, 200, { requests })
            return
          }

          if (req.method === 'POST') {
            if (sceneEventClients.size === 0) {
              sendJson(res, 409, { error: 'No active browser canvas runtime is connected.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            const request = createVisualValidationRequest(payload && typeof payload === 'object' ? payload : {})
            const { sceneFile } = activePaths()
            broadcastSceneChanged([sceneFile], 'visual-validation-requested', { requestId: request.id })
            sendJson(res, 202, { request: visualValidationRequestView(request) })
            return
          }

          if (req.method === 'PUT') {
            const requestId = nativeElementRequestIdFromUrl(req)
            if (!requestId) {
              sendJson(res, 400, { error: 'Visual validation request id is required.' })
              return
            }
            const payload = JSON.parse(await readRequestBody(req))
            const request = completeVisualValidationRequest(requestId, payload && typeof payload === 'object' ? payload : {})
            if (!request) {
              sendJson(res, 404, { error: 'Visual validation request not found.' })
              return
            }
            sendJson(res, 200, { request: visualValidationRequestView(request) })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, POST, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/export', async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('allow', 'POST')
            res.end()
            return
          }
          const payload = JSON.parse(await readRequestBody(req))
          const result = await saveExport(payload)
          sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/session/stop', async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('allow', 'POST')
            res.end()
            return
          }

          if (!isLocalMutationAllowed(req)) {
            sendJson(res, 403, { error: 'Only same-origin local requests can stop the canvas.' })
            return
          }

          const now = new Date().toISOString()
          const session = {
            ...sessionPayload().session,
            status: 'stopping',
            stoppedAt: now,
            processId: process.pid
          }
          await writeJsonAtomic(activePaths().sessionFile, session)
          const scheduled = scheduleLocalCanvasShutdown(server)
          sendJson(res, 200, {
            ok: true,
            status: scheduled ? 'stopping' : 'already-stopping',
            session
          })
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/session', async (req, res) => {
        try {
          if (req.method === 'GET') {
            sendJson(res, 200, await getSessionPayload())
            return
          }

          if (req.method === 'PUT') {
            const payload = JSON.parse(await readRequestBody(req))
            if (!payload || typeof payload !== 'object' || typeof payload.projectDir !== 'string' || !payload.projectDir.trim()) {
              sendJson(res, 400, { error: 'Expected a projectDir.' })
              return
            }
            const session = await activateProject(payload.projectDir, payload.name)
            broadcastSceneChanged([session.session.sessionFile ?? session.session.canvasDir], 'session-changed')
            sendJson(res, 200, session)
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), canvasStoragePlugin()],
  server: {
    host: '127.0.0.1',
    port: 43218,
    watch: {
      ignored: (filePath) => isCanvasStoragePath(filePath)
    }
  }
})
