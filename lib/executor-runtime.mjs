import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  canvasPaths,
  claimAction,
  completeAction,
  emptyActions,
  emptyComments,
  normalizeActions,
  readJsonFile,
  readSceneFile,
  resolveComment,
  writeJsonAtomic
} from './excalidraw-data.mjs'

const EXECUTOR_STATUSES = new Set(['idle', 'checking', 'available', 'warning', 'unavailable'])
const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'canceled'])
const DEFAULT_EXECUTOR_ID = 'codex-cli'
const RUN_EVENT_LIMIT = 80
const SPAWN_TIMEOUT_MS = 1_200_000
const USER_EVENT_DATA = { audience: 'user' }
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'canceled'])
const TERMINAL_ACTION_STATUSES = new Set(['completed', 'failed', 'canceled'])

function nowIso() {
  return new Date().toISOString()
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function trimTrailingCarriageReturn(value) {
  if (value.endsWith('\r')) return value.slice(0, value.length - 1)
  return value
}

function truncateText(value, limit = 480) {
  const text = String(value ?? '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function normalizeRunStatus(status) {
  return RUN_STATUSES.has(status) ? status : 'queued'
}

function normalizeExecutorStatus(status) {
  return EXECUTOR_STATUSES.has(status) ? status : 'unavailable'
}

function emptyExecutorConfig() {
  return {
    version: 1,
    defaultExecutorId: DEFAULT_EXECUTOR_ID,
    runMode: 'local',
    model: null,
    updatedAt: null
  }
}

function emptyExecutorRuns() {
  return {
    version: 1,
    runs: []
  }
}

function emptyExecutorSessions() {
  return {
    version: 1,
    sessions: []
  }
}

function normalizeExecutorConfig(config) {
  const fallback = emptyExecutorConfig()
  return {
    version: 1,
    defaultExecutorId: nonEmptyString(config?.defaultExecutorId) ?? fallback.defaultExecutorId,
    runMode: config?.runMode === 'copy' ? 'copy' : 'local',
    model: nonEmptyString(config?.model),
    updatedAt: nonEmptyString(config?.updatedAt)
  }
}

function normalizeExecutorRuns(runs) {
  return {
    version: 1,
    runs: Array.isArray(runs?.runs)
      ? runs.runs
          .filter((run) => run && typeof run === 'object')
          .map((run) => ({
            id: nonEmptyString(run.id) ?? `run_${randomUUID()}`,
            actionId: nonEmptyString(run.actionId),
            executorId: nonEmptyString(run.executorId) ?? DEFAULT_EXECUTOR_ID,
            status: normalizeRunStatus(run.status),
            projectDir: nonEmptyString(run.projectDir),
            canvasDir: nonEmptyString(run.canvasDir),
            providerSessionId: nonEmptyString(run.providerSessionId),
            command: run.command && typeof run.command === 'object' ? run.command : null,
            events: Array.isArray(run.events) ? run.events.slice(-RUN_EVENT_LIMIT) : [],
            error: nonEmptyString(run.error),
            result: run.result ?? null,
            createdAt: nonEmptyString(run.createdAt) ?? nowIso(),
            updatedAt: nonEmptyString(run.updatedAt) ?? nowIso(),
            startedAt: nonEmptyString(run.startedAt),
            completedAt: nonEmptyString(run.completedAt)
          }))
      : []
  }
}

function normalizeExecutorSessions(sessions) {
  return {
    version: 1,
    sessions: Array.isArray(sessions?.sessions)
      ? sessions.sessions
          .filter((session) => session && typeof session === 'object')
          .map((session) => ({
            executorId: nonEmptyString(session.executorId) ?? DEFAULT_EXECUTOR_ID,
            canvasDir: nonEmptyString(session.canvasDir),
            projectDir: nonEmptyString(session.projectDir),
            providerSessionId: nonEmptyString(session.providerSessionId),
            createdAt: nonEmptyString(session.createdAt) ?? nowIso(),
            updatedAt: nonEmptyString(session.updatedAt) ?? nowIso()
          }))
      : []
  }
}

function appendRunEvent(run, event) {
  const nextEvent = {
    at: nowIso(),
    level: nonEmptyString(event.level) ?? 'info',
    message: truncateText(event.message ?? ''),
    data: event.data ?? null
  }
  return {
    ...run,
    updatedAt: nextEvent.at,
    events: [...(run.events ?? []), nextEvent].slice(-RUN_EVENT_LIMIT)
  }
}

function findRun(runs, runId) {
  return runs.runs.find((run) => run.id === runId)
}

function updateRun(runs, runId, updater) {
  let updatedRun = null
  const nextRuns = normalizeExecutorRuns(runs).runs.map((run) => {
    if (run.id !== runId) return run
    updatedRun = updater(run)
    return updatedRun
  })
  if (!updatedRun) throw new Error(`Executor run not found: ${runId}`)
  return {
    runs: { version: 1, runs: nextRuns },
    run: updatedRun
  }
}

function upsertExecutorSession(sessions, input) {
  const normalized = normalizeExecutorSessions(sessions)
  const executorId = nonEmptyString(input.executorId) ?? DEFAULT_EXECUTOR_ID
  const canvasDir = nonEmptyString(input.canvasDir)
  const projectDir = nonEmptyString(input.projectDir)
  const providerSessionId = nonEmptyString(input.providerSessionId)
  if (!canvasDir || !projectDir || !providerSessionId) return normalized
  const now = nowIso()
  const nextSession = {
    executorId,
    canvasDir,
    projectDir,
    providerSessionId,
    createdAt: now,
    updatedAt: now
  }
  return {
    version: 1,
    sessions: [
      nextSession,
      ...normalized.sessions.filter((session) => !(session.executorId === executorId && session.canvasDir === canvasDir))
    ].slice(0, 24)
  }
}

function sessionForExecutor(sessions, executorId, canvasDir) {
  return normalizeExecutorSessions(sessions).sessions.find(
    (session) => session.executorId === executorId && session.canvasDir === canvasDir && session.providerSessionId
  )
}

function limitedList(values, limit) {
  return Array.isArray(values) ? values.slice(0, limit) : []
}

async function executableExists(filePath) {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findExecutable(commandName, env = process.env) {
  const pathValue = env.PATH ?? ''
  for (const entry of String(pathValue).split(delimiter)) {
    if (!entry) continue
    const candidate = join(entry, commandName)
    if (await executableExists(candidate)) return candidate
  }
  return null
}

function collectProcessLines(stream, onLine) {
  let buffered = ''
  stream.on('data', (chunk) => {
    buffered += chunk.toString()
    let lineEnd = buffered.indexOf('\n')
    while (lineEnd >= 0) {
      const line = trimTrailingCarriageReturn(buffered.slice(0, lineEnd))
      buffered = buffered.slice(lineEnd + 1)
      onLine(line)
      lineEnd = buffered.indexOf('\n')
    }
  })
  stream.on('end', () => {
    const line = trimTrailingCarriageReturn(buffered)
    if (line) onLine(line)
  })
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolveCommand({ ok: false, code: null, stdout, stderr, error: 'Timed out.' })
    }, options.timeoutMs ?? 3500)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveCommand({ ok: false, code: null, stdout, stderr, error: error.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveCommand({ ok: code === 0, code, stdout, stderr, error: code === 0 ? null : stderr || stdout })
    })
  })
}

function mockExecutorStepDelayMs() {
  const value = Number(process.env.CODEX_EXCALIDRAW_MOCK_EXECUTOR_STEP_DELAY_MS)
  return Number.isFinite(value) && value >= 0 ? value : 220
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function eventMessageFromJson(value) {
  if (!value || typeof value !== 'object') return null
  const candidates = [
    value.message,
    value.text,
    value.type,
    value.event,
    value.status
  ]
  for (const candidate of candidates) {
    const text = nonEmptyString(candidate)
    if (text) return text
  }
  return null
}

const SESSION_EVENT_TYPES = new Set(['session.started', 'session_meta', 'thread.started', 'thread.created'])

function sessionIdCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return (
    nonEmptyString(value.sessionId) ??
    nonEmptyString(value.session_id) ??
    nonEmptyString(value.conversationId) ??
    nonEmptyString(value.conversation_id) ??
    nonEmptyString(value.threadId) ??
    nonEmptyString(value.thread_id)
  )
}

function sessionIdFromJson(value) {
  if (!value || typeof value !== 'object') return null
  const direct = sessionIdCandidate(value)
  if (direct) return direct

  const eventType = nonEmptyString(value.type)
  if (eventType && !SESSION_EVENT_TYPES.has(eventType)) return null

  const eventScopedId = nonEmptyString(value.id)
  if (eventScopedId) return eventScopedId

  const nested = value.session && typeof value.session === 'object' ? value.session : null
  const thread = value.thread && typeof value.thread === 'object' ? value.thread : null
  const payload = value.payload && typeof value.payload === 'object' ? value.payload : null
  return (
    sessionIdCandidate(nested) ??
    nonEmptyString(nested?.id) ??
    sessionIdCandidate(thread) ??
    nonEmptyString(thread?.id) ??
    sessionIdCandidate(payload) ??
    nonEmptyString(payload?.id) ??
    null
  )
}

function sanitizeExecutorView(executor) {
  return {
    id: executor.id,
    label: executor.label,
    status: normalizeExecutorStatus(executor.status),
    available: executor.available === true,
    version: executor.version ?? null,
    command: executor.command ?? null,
    capabilities: Array.isArray(executor.capabilities) ? executor.capabilities : [],
    warnings: Array.isArray(executor.warnings) ? executor.warnings : [],
    checkedAt: executor.checkedAt ?? null
  }
}

function actionContextEntry(action) {
  return {
    id: action.id,
    status: action.status,
    commentId: action.commentId ?? null,
    targetElementIds: action.targetElementIds ?? [],
    instruction: action.instruction,
    result: action.result ?? null,
    error: action.error ?? null,
    createdAt: action.createdAt ?? null,
    completedAt: action.completedAt ?? null
  }
}

function commentContextEntry(comment) {
  return {
    id: comment.id,
    status: comment.status,
    targetElementIds: comment.targetElementIds ?? [],
    body: comment.body,
    createdAt: comment.createdAt ?? null,
    resolvedAt: comment.resolvedAt ?? null
  }
}

function buildActionContextEnvelope(action, input) {
  const actions = normalizeActions(input.actions)
  const comments = input.comments && typeof input.comments === 'object' ? input.comments : emptyComments()
  const currentTargets = new Set(action.targetElementIds ?? [])
  const relatedComments = Array.isArray(comments.comments)
    ? comments.comments
        .filter((comment) => comment && typeof comment === 'object')
        .filter((comment) => {
          if (comment.id === action.commentId) return true
          return (comment.targetElementIds ?? []).some((id) => currentTargets.has(id))
        })
        .map(commentContextEntry)
    : []
  const recentActions = actions.actions
    .filter((item) => item.id !== action.id)
    .filter((item) => item.canvasDir === action.canvasDir || !item.canvasDir || !action.canvasDir)
    .map(actionContextEntry)

  return {
    action: actionContextEntry(action),
    canvas: {
      projectDir: input.projectDir,
      canvasDir: input.canvasDir,
      sceneFingerprint: action.sceneFingerprint ?? null,
      selectionSnapshot: limitedList(action.selectionSnapshot, 32)
    },
    continuity: {
      providerSessionId: input.previousSession?.providerSessionId ?? null,
      willResumeProviderSession: Boolean(input.previousSession?.providerSessionId),
      recentActions: limitedList(recentActions, 6),
      relatedComments: limitedList(relatedComments, 8)
    }
  }
}

function buildActionPrompt(action, session, contextEnvelope) {
  return [
    `Execute Excalidraw action ${action.id}.`,
    `Project directory: ${session.projectDir}.`,
    `Canvas directory: ${session.canvasDir}.`,
    'First call get_pending_excalidraw_actions to read this action.',
    'Claim the action before editing.',
    'Only modify the action targetElementIds, comment target ids, or explicit semantic ids returned by MCP.',
    'Do not infer targets by matching element text, comment text, or labels.',
    'Use the structured context envelope below for continuity across browser-submitted comments.',
    'If the action asks for generated imagery or bitmap/photo output, prefer the Excalidraw image insertion tool path over approximating it with vector primitives.',
    'For generated imagery inside a bounded target, read the target geometry before generation, include the target aspect ratio in the image prompt, and use placement.fit="cover" unless the user explicitly asks to preserve the whole image.',
    'After the canvas edit is complete, call complete_excalidraw_action with this action id.',
    'Structured context envelope:',
    JSON.stringify(contextEnvelope, null, 2),
    `Action instruction: ${action.instruction}`
  ].join('\n')
}

export function createExecutorRuntime(options) {
  const runningProcesses = new Map()
  const mockExecutorEnabled = process.env.CODEX_EXCALIDRAW_EXECUTOR_ADAPTER === 'mock'

  function activePaths() {
    return options.activePaths()
  }

  function broadcast(paths, eventName, metadata = {}) {
    options.broadcast(paths, eventName, metadata)
  }

  async function readConfig() {
    const paths = activePaths()
    return normalizeExecutorConfig(await readJsonFile(paths.executorConfigFile, emptyExecutorConfig()))
  }

  async function writeConfig(config) {
    const paths = activePaths()
    const nextConfig = normalizeExecutorConfig({
      ...config,
      updatedAt: nowIso()
    })
    await writeJsonAtomic(paths.executorConfigFile, nextConfig)
    broadcast([paths.executorConfigFile], 'executor-config-changed')
    return nextConfig
  }

  async function readRuns() {
    const paths = activePaths()
    return normalizeExecutorRuns(await readJsonFile(paths.executorRunsFile, emptyExecutorRuns()))
  }

  async function writeRuns(runs, eventMetadata = {}) {
    const paths = activePaths()
    const normalized = normalizeExecutorRuns(runs)
    await writeJsonAtomic(paths.executorRunsFile, normalized)
    broadcast([paths.executorRunsFile], 'executor-runs-changed', eventMetadata)
    return normalized
  }

  async function readSessions() {
    const paths = activePaths()
    return normalizeExecutorSessions(await readJsonFile(paths.executorSessionsFile, emptyExecutorSessions()))
  }

  async function writeSessions(sessions) {
    const paths = activePaths()
    const normalized = normalizeExecutorSessions(sessions)
    await writeJsonAtomic(paths.executorSessionsFile, normalized)
    return normalized
  }

  async function readActions() {
    const paths = activePaths()
    return normalizeActions(await readJsonFile(paths.actionsFile, emptyActions()))
  }

  async function writeActions(actions) {
    const paths = activePaths()
    const normalized = normalizeActions(actions)
    await writeJsonAtomic(paths.actionsFile, normalized)
    broadcast([paths.actionsFile], 'actions-changed')
    return normalized
  }

  async function scanCodexExecutor() {
    const checkedAt = nowIso()
    const executable = await findExecutable('codex')
    if (!executable) {
      return sanitizeExecutorView({
        id: DEFAULT_EXECUTOR_ID,
        label: 'Codex CLI',
        status: 'unavailable',
        available: false,
        command: 'codex',
        capabilities: [],
        warnings: ['Codex CLI was not found in PATH.'],
        checkedAt
      })
    }
    const version = await runCommand(executable, ['--version'], { timeoutMs: 3500 })
    const help = await runCommand(executable, ['exec', '--help'], { timeoutMs: 3500 })
    const warnings = []
    if (!version.ok) warnings.push(truncateText(version.error ?? 'Version check failed.'))
    if (!help.ok) warnings.push(truncateText(help.error ?? 'exec help check failed.'))
    return sanitizeExecutorView({
      id: DEFAULT_EXECUTOR_ID,
      label: 'Codex CLI',
      status: version.ok && help.ok ? 'available' : 'warning',
      available: true,
      version: version.stdout.trim() || null,
      command: executable,
      capabilities: ['json-events', 'session-resume', 'mcp-tools'],
      warnings,
      checkedAt
    })
  }

  function mockExecutor() {
    return sanitizeExecutorView({
      id: 'mock-codex',
      label: 'Mock Codex Executor',
      status: 'available',
      available: true,
      version: 'test',
      command: 'mock',
      capabilities: ['json-events', 'session-resume', 'mcp-tools', 'test-only'],
      warnings: [],
      checkedAt: nowIso()
    })
  }

  async function scanExecutors() {
    const storedConfig = await readConfig()
    const config = mockExecutorEnabled && !storedConfig.updatedAt
      ? { ...storedConfig, defaultExecutorId: 'mock-codex' }
      : storedConfig
    const executors = [await scanCodexExecutor()]
    if (mockExecutorEnabled) executors.unshift(mockExecutor())
    const selected = executors.find((executor) => executor.id === config.defaultExecutorId && executor.available) ?? executors.find((executor) => executor.available) ?? null
    const nextConfig = selected && selected.id !== config.defaultExecutorId
      ? await writeConfig({ ...config, defaultExecutorId: selected.id })
      : config
    return {
      config: nextConfig,
      executors,
      selectedExecutorId: selected?.id ?? nextConfig.defaultExecutorId
    }
  }

  async function applyMockSceneUpdate(action, run) {
    const paths = activePaths()
    const scene = await readSceneFile(paths.canvasDir)
    const targetIds = new Set(action.targetElementIds ?? [])
    let changed = false
    const elements = scene.elements.map((element) => {
      if (!targetIds.has(element.id) || element.isDeleted) return element
      changed = true
      return {
        ...element,
        strokeColor: element.strokeColor === 'transparent' ? '#16a34a' : element.strokeColor ?? '#16a34a',
        version: Number.isFinite(element.version) ? element.version + 1 : 1,
        updated: Date.now(),
        customData: {
          ...(element.customData ?? {}),
          codex: {
            ...(element.customData?.codex ?? {}),
            executorRunId: run.id,
            executorStatus: 'completed'
          }
        }
      }
    })
    if (!changed) return false
    await writeJsonAtomic(paths.sceneFile, { ...scene, elements })
    broadcast([paths.sceneFile], 'scene-changed')
    return true
  }

  async function updateRunEvent(runId, event) {
    const runs = await readRuns()
    const result = updateRun(runs, runId, (run) => appendRunEvent(run, event))
    await writeRuns(result.runs, { runId })
    return result.run
  }

  async function finishRun(runId, input) {
    const paths = activePaths()
    const runs = await readRuns()
    const existingRun = findRun(runs, runId)
    if (existingRun && TERMINAL_RUN_STATUSES.has(existingRun.status)) return existingRun
    const result = updateRun(runs, runId, (run) => ({
      ...appendRunEvent(run, {
        level: input.status === 'completed' ? 'success' : 'error',
        message: input.message,
        data: USER_EVENT_DATA
      }),
      status: input.status,
      error: input.status === 'failed' ? input.error ?? input.message : null,
      result: input.result ?? null,
      completedAt: nowIso()
    }))
    await writeRuns(result.runs, { runId })

    const actions = await readActions()
    const currentAction = actions.actions.find((action) => action.id === result.run.actionId)
    const mergedResult =
      currentAction?.result && input.result && typeof currentAction.result === 'object' && typeof input.result === 'object'
        ? { ...currentAction.result, executor: input.result }
        : input.result ?? currentAction?.result
    const completed = completeAction(actions, result.run.actionId, {
      status: input.status === 'completed' ? 'completed' : input.status === 'canceled' ? 'canceled' : 'failed',
      result: mergedResult,
      error: input.status === 'failed' ? input.error ?? input.message : null
    })
    const actionsWithExecutor = {
      version: 1,
      actions: completed.actions.actions.map((action) =>
        action.id === completed.action.id
          ? {
              ...action,
              executorId: result.run.executorId,
              executorRunId: result.run.id
            }
          : action
      )
    }
    const completedAction =
      actionsWithExecutor.actions.find((action) => action.id === completed.action.id) ?? completed.action
    await writeActions(actionsWithExecutor)
    const broadcastFiles = [paths.actionsFile, paths.executorRunsFile]
    if (completedAction.commentId && completedAction.status === 'completed') {
      const comments = await readJsonFile(paths.commentsFile, emptyComments())
      const nextComments = resolveComment(comments, completedAction.commentId)
      await writeJsonAtomic(paths.commentsFile, nextComments)
      broadcastFiles.push(paths.commentsFile)
      broadcast([paths.commentsFile], 'comments-changed', { runId, commentId: completedAction.commentId })
    }
    broadcast(broadcastFiles, 'executor-runs-changed', { runId })
    return result.run
  }

  async function runMockExecutor(run, action) {
    const delayMs = mockExecutorStepDelayMs()
    await updateRunEvent(run.id, { message: 'Mock executor connected to the canvas action queue.', data: USER_EVENT_DATA })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
    await updateRunEvent(run.id, { message: 'Reading structural action target ids.', data: USER_EVENT_DATA })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
    const currentRuns = await readRuns()
    const currentRun = findRun(currentRuns, run.id)
    if (!currentRun || TERMINAL_RUN_STATUSES.has(currentRun.status)) return
    await applyMockSceneUpdate(action, run)
    await updateRunEvent(run.id, { message: 'Applied a structural mock canvas update.', data: USER_EVENT_DATA })
    await finishRun(run.id, {
      status: 'completed',
      message: 'Mock Codex execution completed.',
      result: {
        executorId: run.executorId,
        mode: 'mock',
        targetElementIds: action.targetElementIds
      }
    })
  }

  async function runCodexExecutor(run, action) {
    const paths = activePaths()
    const executable = await findExecutable('codex')
    if (!executable) {
      await finishRun(run.id, {
        status: 'failed',
        message: 'Codex CLI is not installed or not available in PATH.',
        error: 'Codex CLI is not available.'
      })
      return
    }
    const config = await readConfig()
    const sessions = await readSessions()
    const previousSession = sessionForExecutor(sessions, run.executorId, paths.canvasDir)
    const actionContext = buildActionContextEnvelope(action, {
      actions: await readActions(),
      comments: await readJsonFile(paths.commentsFile, emptyComments()),
      previousSession,
      projectDir: paths.projectDir,
      canvasDir: paths.canvasDir
    })
    const prompt = buildActionPrompt(action, {
      projectDir: paths.projectDir,
      canvasDir: paths.canvasDir
    }, actionContext)
    const modelArgs = config.model ? ['-m', config.model] : []
    const args = previousSession?.providerSessionId
      ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...modelArgs, previousSession.providerSessionId, prompt]
      : ['exec', '--json', '--skip-git-repo-check', ...modelArgs, '-C', paths.projectDir, prompt]
    const commandView = {
      command: executable,
      args: args.map((arg) => (arg === prompt ? '<prompt>' : arg))
    }
    const runs = await readRuns()
    const withCommand = updateRun(runs, run.id, (current) => ({
      ...appendRunEvent(current, {
        message: previousSession ? 'Resuming Codex CLI session.' : 'Starting Codex CLI session.',
        data: USER_EVENT_DATA
      }),
      command: commandView
    }))
    await writeRuns(withCommand.runs, { runId: run.id })

    const child = spawn(executable, args, {
      cwd: paths.projectDir,
      env: {
        ...process.env,
        CODEX_EXCALIDRAW_PROJECT_DIR: paths.projectDir,
        CODEX_EXCALIDRAW_CANVAS_DIR: paths.canvasDir,
        CODEX_EXCALIDRAW_API_URL: options.apiBaseUrl()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    runningProcesses.set(run.id, child)
    await updateRunEvent(run.id, {
      message: 'Codex CLI is running in the background. The canvas stays available.',
      data: USER_EVENT_DATA
    })
    let providerSessionId = previousSession?.providerSessionId ?? null
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, SPAWN_TIMEOUT_MS)
    collectProcessLines(child.stdout, (line) => {
      const parsed = parseJsonLine(line)
      const nextSessionId = sessionIdFromJson(parsed)
      if (nextSessionId) providerSessionId = nextSessionId
      const message = eventMessageFromJson(parsed) ?? nonEmptyString(line)
      if (message) {
        updateRunEvent(run.id, { message }).catch((error) => {
          console.error(error)
        })
      }
    })
    collectProcessLines(child.stderr, (line) => {
      const message = nonEmptyString(line)
      if (message) {
        updateRunEvent(run.id, { level: 'warning', message }).catch((error) => {
          console.error(error)
        })
      }
    })
    child.on('error', (error) => {
      runningProcesses.delete(run.id)
      clearTimeout(timeout)
      finishRun(run.id, {
        status: 'failed',
        message: 'Codex CLI failed to start.',
        error: error.message
      }).catch((finishError) => {
        console.error(finishError)
      })
    })
    child.on('close', (code) => {
      runningProcesses.delete(run.id)
      clearTimeout(timeout)
      const persistSession = providerSessionId
        ? writeSessions(upsertExecutorSession(sessions, {
            executorId: run.executorId,
            canvasDir: paths.canvasDir,
            projectDir: paths.projectDir,
            providerSessionId
          }))
        : Promise.resolve()
      persistSession
        .then(() => finishRun(run.id, {
          status: code === 0 ? 'completed' : 'failed',
          message: code === 0 ? 'Codex CLI execution completed.' : `Codex CLI exited with code ${code}.`,
          error: code === 0 ? null : `Codex CLI exited with code ${code}.`,
          result: {
            executorId: run.executorId,
            providerSessionId,
            exitCode: code
          }
        }))
        .catch((error) => {
          console.error(error)
        })
    })
  }

  async function startActionRun(input = {}) {
    const paths = activePaths()
    const config = await readConfig()
    if (config.runMode === 'copy') {
      throw new Error('Local executor mode is disabled in settings.')
    }
    const executorId = nonEmptyString(input.executorId) ?? config.defaultExecutorId
    const actions = await readActions()
    const action = actions.actions.find((item) => item.id === input.actionId)
    if (!action) throw new Error(`Action not found: ${input.actionId}`)

    const existingRuns = await readRuns()
    const existingActive = existingRuns.runs.find(
      (run) => run.actionId === action.id && (run.status === 'queued' || run.status === 'running')
    )
    if (existingActive) return existingActive

    const projectRunning = existingRuns.runs.find((run) => run.status === 'running' && run.canvasDir === paths.canvasDir)
    if (projectRunning) {
      throw new Error(`Another executor run is already active: ${projectRunning.id}`)
    }

    const run = {
      id: `run_${randomUUID()}`,
      actionId: action.id,
      executorId,
      status: 'running',
      projectDir: paths.projectDir,
      canvasDir: paths.canvasDir,
      providerSessionId: null,
      command: null,
      events: [
        {
          at: nowIso(),
          level: 'info',
          message: 'Executor run started.',
          data: USER_EVENT_DATA
        }
      ],
      error: null,
      result: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: nowIso(),
      completedAt: null
    }

    const claimed = claimAction(actions, action.id, {
      claimedBy: executorId,
      executorId,
      executorRunId: run.id
    })
    await writeActions(claimed.actions)
    await writeRuns({ version: 1, runs: [run, ...existingRuns.runs] }, { runId: run.id })

    if (executorId === 'mock-codex') {
      runMockExecutor(run, claimed.action).catch((error) => {
        finishRun(run.id, {
          status: 'failed',
          message: 'Mock executor failed.',
          error: error.message
        }).catch((finishError) => console.error(finishError))
      })
    } else {
      runCodexExecutor(run, claimed.action).catch((error) => {
        finishRun(run.id, {
          status: 'failed',
          message: 'Codex executor failed.',
          error: error.message
        }).catch((finishError) => console.error(finishError))
      })
    }

    return run
  }

  async function cancelRun(runId) {
    const runs = await readRuns()
    const run = findRun(runs, runId)
    if (!run) throw new Error(`Executor run not found: ${runId}`)
    if (run.status !== 'queued' && run.status !== 'running') return run
    const actions = await readActions()
    const action = actions.actions.find((item) => item.id === run.actionId)
    if (action && TERMINAL_ACTION_STATUSES.has(action.status)) return run
    const child = runningProcesses.get(runId)
    if (child) {
      child.kill('SIGTERM')
      runningProcesses.delete(runId)
    }
    return finishRun(runId, {
      status: 'canceled',
      message: 'Executor run canceled by user.',
      error: null
    })
  }

  return {
    scanExecutors,
    readConfig,
    writeConfig,
    readRuns,
    startActionRun,
    cancelRun
  }
}
