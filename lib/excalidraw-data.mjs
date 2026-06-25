import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { normalizeElementSpecsForLayout } from './excalidraw-layout.mjs'
import { qualityReportForElements } from './excalidraw-quality.mjs'

export const SCENE_SOURCE = 'codex-excalidraw-canvas'

export const DEFAULT_APP_STATE = {
  viewBackgroundColor: '#fbfbfa',
  currentItemFontFamily: 1
}

const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const LINE_TYPES = new Set(['arrow', 'line'])
const STYLE_FIELDS = [
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity'
]
const ELEMENT_FIELDS = ['x', 'y', 'width', 'height', 'angle', 'locked']

export function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function uniqueNonEmptyStrings(values) {
  const seen = new Set()
  const result = []
  for (const value of Array.isArray(values) ? values : []) {
    const text = nonEmptyString(value)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

export function resolveCanvasDir(args = {}, env = process.env, cwd = process.cwd()) {
  const explicitCanvasDir = nonEmptyString(args.canvasDir)
  if (explicitCanvasDir) return resolve(explicitCanvasDir)

  const explicitProjectDir = nonEmptyString(args.projectDir)
  if (explicitProjectDir) return join(resolve(explicitProjectDir), 'canvas', 'excalidraw')

  const envCanvasDir = nonEmptyString(env.CODEX_EXCALIDRAW_CANVAS_DIR)
  if (envCanvasDir) return resolve(envCanvasDir)

  const envProjectDir = nonEmptyString(env.CODEX_EXCALIDRAW_PROJECT_DIR)
  if (envProjectDir) return join(resolve(envProjectDir), 'canvas', 'excalidraw')

  return join(cwd, 'canvas', 'excalidraw')
}

export function canvasPaths(canvasDir) {
  return {
    canvasDir,
    sceneFile: join(canvasDir, 'scene.excalidraw'),
    selectionFile: join(canvasDir, 'selection.json'),
    commentsFile: join(canvasDir, 'comments.json'),
    actionsFile: join(canvasDir, 'actions.json'),
    executorConfigFile: join(canvasDir, 'executor-config.json'),
    executorRunsFile: join(canvasDir, 'executor-runs.json'),
    executorSessionsFile: join(canvasDir, 'executor-sessions.json'),
    sessionFile: join(canvasDir, 'session.json'),
    assetsDir: join(canvasDir, 'assets'),
    exportsDir: join(canvasDir, 'exports'),
    checkpointsDir: join(canvasDir, 'checkpoints')
  }
}

export function emptyScene() {
  return {
    type: 'excalidraw',
    version: 2,
    source: SCENE_SOURCE,
    elements: [],
    appState: { ...DEFAULT_APP_STATE },
    files: {}
  }
}

export function emptySelection() {
  return {
    selectedElementIds: [],
    selectedElements: [],
    updatedAt: null
  }
}

export function emptyComments() {
  return {
    version: 1,
    comments: []
  }
}

export function emptyActions() {
  return {
    version: 1,
    actions: []
  }
}

function imageScale(value) {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]]
  }
  return [1, 1]
}

function imageCrop(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = ['x', 'y', 'width', 'height', 'naturalWidth', 'naturalHeight']
  const crop = {}
  for (const field of fields) {
    if (!Number.isFinite(value[field])) return null
    crop[field] = value[field]
  }
  return crop
}

function imageStatus(value, fileId) {
  if (value === 'pending' || value === 'saved' || value === 'error') return value
  return fileId ? 'saved' : 'pending'
}

function normalizeElementForExcalidraw(element) {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return element
  if (element.type !== 'image') return element
  const fileId = element.fileId ?? null
  return {
    ...element,
    fileId,
    status: imageStatus(element.status, fileId),
    scale: imageScale(element.scale),
    crop: imageCrop(element.crop)
  }
}

export async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tempFile, filePath)
}

export function normalizeScene(scene) {
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.elements)) {
    return emptyScene()
  }
  const appState = {
    ...DEFAULT_APP_STATE,
    ...(scene.appState && typeof scene.appState === 'object' ? scene.appState : {})
  }
  delete appState.theme

  return {
    type: 'excalidraw',
    version: Number.isFinite(scene.version) ? scene.version : 2,
    source: nonEmptyString(scene.source) ?? SCENE_SOURCE,
    elements: Array.isArray(scene.elements) ? scene.elements.map(normalizeElementForExcalidraw) : [],
    appState,
    files: scene.files && typeof scene.files === 'object' ? scene.files : {}
  }
}

export async function readSceneFile(canvasDir) {
  const { sceneFile } = canvasPaths(canvasDir)
  return normalizeScene(await readJsonFile(sceneFile, emptyScene()))
}

export async function writeSceneFile(canvasDir, scene) {
  const { sceneFile } = canvasPaths(canvasDir)
  const normalized = normalizeScene(scene)
  await writeJsonAtomic(sceneFile, normalized)
  return { scene: normalized, sceneFile }
}

function safeCheckpointId(value) {
  const text = nonEmptyString(value)
  if (!text) return null
  for (const char of text) {
    if (!isSafeIdChar(char)) return null
  }
  return text
}

function checkpointIdFromName(name) {
  const extension = extname(name)
  if (extension !== '.json') return null
  const id = name.slice(0, name.length - extension.length)
  return safeCheckpointId(id)
}

function checkpointFilePath(canvasDir, checkpointId) {
  const id = safeCheckpointId(checkpointId)
  if (!id) throw new Error('checkpointId must use letters, numbers, underscore, or dash.')
  const { checkpointsDir } = canvasPaths(canvasDir)
  return join(checkpointsDir, `${id}.json`)
}

export async function saveCheckpoint(canvasDir, scene, options = {}) {
  const checkpointId = safeCheckpointId(options.checkpointId) ?? makeId('checkpoint')
  const normalized = normalizeScene(scene)
  const { checkpointsDir } = canvasPaths(canvasDir)
  const checkpointFile = checkpointFilePath(canvasDir, checkpointId)
  const createdAt = new Date().toISOString()
  const checkpoint = {
    version: 1,
    checkpointId,
    label: nonEmptyString(options.label),
    createdAt,
    scene: normalized,
    summary: summarizeScene(normalized)
  }
  await mkdir(checkpointsDir, { recursive: true })
  await writeJsonAtomic(checkpointFile, checkpoint)
  return { checkpoint, checkpointFile, checkpointsDir }
}

export async function readCheckpoint(canvasDir, checkpointId) {
  const checkpointFile = checkpointFilePath(canvasDir, checkpointId)
  const checkpoint = await readJsonFile(checkpointFile, null)
  if (!checkpoint || typeof checkpoint !== 'object' || !checkpoint.scene) {
    throw new Error(`Checkpoint not found: ${checkpointId}`)
  }
  const scene = normalizeScene(checkpoint.scene)
  return {
    checkpoint: {
      ...checkpoint,
      scene,
      summary: checkpoint.summary ?? summarizeScene(scene)
    },
    checkpointFile
  }
}

export async function listCheckpoints(canvasDir) {
  const { checkpointsDir } = canvasPaths(canvasDir)
  let entries = []
  try {
    entries = await readdir(checkpointsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return { checkpoints: [], checkpointsDir }
    throw error
  }

  const checkpoints = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const checkpointId = checkpointIdFromName(entry.name)
    if (!checkpointId) continue
    try {
      const { checkpoint } = await readCheckpoint(canvasDir, checkpointId)
      checkpoints.push({
        checkpointId,
        label: checkpoint.label ?? null,
        createdAt: checkpoint.createdAt ?? null,
        summary: checkpoint.summary ?? summarizeScene(checkpoint.scene)
      })
    } catch {
      // Ignore malformed checkpoint files without failing the whole project list.
    }
  }

  checkpoints.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
  return { checkpoints, checkpointsDir }
}

export async function restoreCheckpoint(canvasDir, checkpointId) {
  const { checkpoint, checkpointFile } = await readCheckpoint(canvasDir, checkpointId)
  const result = await writeSceneFile(canvasDir, checkpoint.scene)
  return {
    checkpoint,
    checkpointFile,
    scene: result.scene,
    sceneFile: result.sceneFile
  }
}

export async function readSelectionFile(canvasDir) {
  const { selectionFile } = canvasPaths(canvasDir)
  const selection = await readJsonFile(selectionFile, emptySelection())
  return {
    ...emptySelection(),
    ...(selection && typeof selection === 'object' ? selection : {}),
    selectedElementIds: Array.isArray(selection?.selectedElementIds) ? selection.selectedElementIds : [],
    selectedElements: Array.isArray(selection?.selectedElements) ? selection.selectedElements : []
  }
}

export async function writeSelectionFile(canvasDir, selection) {
  const { selectionFile } = canvasPaths(canvasDir)
  await writeJsonAtomic(selectionFile, selection)
  return { selectionFile }
}

export async function readCommentsFile(canvasDir) {
  const { commentsFile } = canvasPaths(canvasDir)
  const comments = await readJsonFile(commentsFile, emptyComments())
  return {
    version: Number.isFinite(comments?.version) ? comments.version : 1,
    comments: Array.isArray(comments?.comments) ? comments.comments : []
  }
}

export async function writeCommentsFile(canvasDir, comments) {
  const { commentsFile } = canvasPaths(canvasDir)
  await writeJsonAtomic(commentsFile, comments)
  return { commentsFile }
}

export async function readActionsFile(canvasDir) {
  const { actionsFile } = canvasPaths(canvasDir)
  return normalizeActions(await readJsonFile(actionsFile, emptyActions()))
}

export async function writeActionsFile(canvasDir, actions) {
  const { actionsFile } = canvasPaths(canvasDir)
  const normalized = normalizeActions(actions)
  await writeJsonAtomic(actionsFile, normalized)
  return { actionsFile }
}

export function summarizeElements(elements) {
  const counts = new Map()
  for (const element of elements ?? []) {
    if (element?.isDeleted) continue
    counts.set(element.type, (counts.get(element.type) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

export function summarizeScene(scene) {
  const visibleElements = scene.elements.filter((element) => !element.isDeleted)
  return {
    elementCount: scene.elements.length,
    visibleElementCount: visibleElements.length,
    elementCounts: summarizeElements(scene.elements),
    fileCount: Object.keys(scene.files ?? {}).length,
    source: scene.source,
    version: scene.version
  }
}

function isSafeIdChar(char) {
  const code = char.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === '_' ||
    char === '-'
  )
}

function cleanIdPrefix(prefix, fallback = 'id') {
  let clean = ''
  for (const char of String(prefix || fallback)) {
    clean += isSafeIdChar(char) ? char : '_'
  }
  return clean || fallback
}

function compactUuid(value) {
  let compact = ''
  for (const char of String(value || '')) {
    if (char !== '-') compact += char
  }
  return compact
}

export function makeId(prefix = 'id') {
  return `${cleanIdPrefix(prefix)}_${compactUuid(randomUUID()).slice(0, 16)}`
}

function randomSeed() {
  return Math.floor(Math.random() * 2_000_000_000) + 1
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

function normalizeStyle(style = {}) {
  return {
    strokeColor: stringOr(style.strokeColor, '#1f2937'),
    backgroundColor: stringOr(style.backgroundColor, 'transparent'),
    fillStyle: stringOr(style.fillStyle, 'hachure'),
    strokeWidth: numberOr(style.strokeWidth, 2),
    strokeStyle: stringOr(style.strokeStyle, 'solid'),
    roughness: numberOr(style.roughness, 2),
    opacity: numberOr(style.opacity, 100)
  }
}

function mergePlainObject(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const next = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergePlainObject(next[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

function codexCustomData(spec, batchId, role, extra = {}) {
  const customData = mergePlainObject({}, spec.customData)
  customData.codex = {
    createdBy: 'codex',
    batchId,
    role,
    ...(customData.codex ?? {}),
    ...(spec.codex ?? {}),
    ...extra
  }
  if (nonEmptyString(spec.semanticId)) {
    customData.codex.semanticId = nonEmptyString(spec.semanticId)
  }
  return customData
}

function estimateTextSize(text, fontSize, lineHeight) {
  const lines = String(text || '').split('\n')
  const width = Math.max(1, ...lines.map((line) => Array.from(line).length)) * fontSize * 0.62 + 8
  const height = Math.max(1, lines.length) * fontSize * lineHeight
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

function baseElement(spec, type, batchId, role, index, overrides = {}) {
  const style = normalizeStyle(spec.style)
  const now = Date.now()
  return {
    id: nonEmptyString(spec.id) ?? makeId(type),
    type,
    x: numberOr(spec.x, 0),
    y: numberOr(spec.y, 0),
    width: numberOr(spec.width, 160),
    height: numberOr(spec.height, 90),
    angle: numberOr(spec.angle, 0),
    ...style,
    opacity: numberOr(style.opacity, 100),
    groupIds: Array.isArray(spec.groupIds) ? spec.groupIds : [],
    frameId: null,
    index: `a${String(index).padStart(6, '0')}`,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: randomSeed(),
    version: 1,
    versionNonce: randomSeed(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: boolOr(spec.locked, false),
    customData: codexCustomData(spec, batchId, role),
    ...overrides
  }
}

function textElement(spec, batchId, index, overrides = {}) {
  const text = stringOr(spec.text, '')
  const fontSize = numberOr(spec.fontSize ?? spec.style?.fontSize, 22)
  const lineHeight = numberOr(spec.lineHeight, 1.25)
  const measured = estimateTextSize(text, fontSize, lineHeight)
  const element = baseElement(
    {
      ...spec,
      width: numberOr(spec.width, measured.width),
      height: numberOr(spec.height, measured.height),
      style: {
        ...(spec.style ?? {}),
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        roughness: numberOr(spec.style?.roughness, 1)
      }
    },
    'text',
    batchId,
    overrides.role ?? 'text',
    index,
    {
      roundness: null,
      boundElements: null,
      text,
      fontSize,
      fontFamily: numberOr(spec.fontFamily, 5),
      textAlign: stringOr(spec.textAlign, 'left'),
      verticalAlign: stringOr(spec.verticalAlign, 'top'),
      containerId: overrides.containerId ?? null,
      originalText: text,
      autoResize: true,
      lineHeight,
      customData: codexCustomData(spec, batchId, overrides.role ?? 'text', overrides.codex ?? {})
    }
  )
  delete element.label
  return element
}

function labelElementForContainer(container, labelSpec, batchId, index, role) {
  const labelText = typeof labelSpec === 'string' ? labelSpec : labelSpec?.text
  const fontSize = numberOr(labelSpec?.fontSize, container.type === 'arrow' || container.type === 'line' ? 16 : 22)
  const lineHeight = numberOr(labelSpec?.lineHeight, 1.25)
  const measured = estimateTextSize(labelText, fontSize, lineHeight)
  return textElement(
    {
      id: nonEmptyString(labelSpec?.id) ?? makeId('label'),
      x: container.x + container.width / 2 - measured.width / 2,
      y: container.y + container.height / 2 - measured.height / 2,
      width: measured.width,
      height: measured.height,
      text: labelText,
      fontSize,
      lineHeight,
      textAlign: 'center',
      verticalAlign: 'middle',
      style: {
        strokeColor: container.strokeColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        roughness: 1
      },
      customData: {
        codex: {
          semanticId: nonEmptyString(labelSpec?.semanticId) ?? `${container.customData?.codex?.semanticId ?? container.id}_label`
        }
      }
    },
    batchId,
    index,
    {
      role,
      containerId: container.id,
      codex: {
        parentElementId: container.id
      }
    }
  )
}

function elementSpecsToElements(specs, options = {}) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error('Expected at least one Excalidraw element spec.')
  }

  const batchId = nonEmptyString(options.batchId) ?? makeId('batch')
  const elements = []
  let index = options.startIndex ?? 0

  for (const spec of specs) {
    if (!spec || typeof spec !== 'object') {
      throw new Error('Element spec must be an object.')
    }

    const type = nonEmptyString(spec.type)
    if (SHAPE_TYPES.has(type)) {
      const shape = baseElement(spec, type, batchId, 'shape', index++)
      const labelText = typeof spec.label === 'string' ? spec.label : spec.label?.text ?? spec.text
      if (labelText) {
        const label = labelElementForContainer(shape, { text: labelText, ...(typeof spec.label === 'object' ? spec.label : {}) }, batchId, index++, 'label')
        shape.boundElements = [{ type: 'text', id: label.id }]
        elements.push(shape, label)
      } else {
        elements.push(shape)
      }
      continue
    }

    if (type === 'text') {
      elements.push(textElement(spec, batchId, index++))
      continue
    }

    if (LINE_TYPES.has(type)) {
      const points = Array.isArray(spec.points) && spec.points.length >= 2 ? spec.points : [[0, 0], [numberOr(spec.width, 180), numberOr(spec.height, 0)]]
      const xs = points.map((point) => numberOr(point?.[0], 0))
      const ys = points.map((point) => numberOr(point?.[1], 0))
      const width = Math.max(...xs) - Math.min(...xs)
      const height = Math.max(...ys) - Math.min(...ys)
      const line = baseElement(
        {
          ...spec,
          width: numberOr(spec.width, width),
          height: numberOr(spec.height, height)
        },
        type,
        batchId,
        type,
        index++,
        {
          backgroundColor: 'transparent',
          fillStyle: 'solid',
          roundness: null,
          points,
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: spec.startArrowhead ?? null,
          endArrowhead: type === 'arrow' ? spec.endArrowhead ?? 'arrow' : null,
          elbowed: false
        }
      )
      const labelText = typeof spec.label === 'string' ? spec.label : spec.label?.text
      if (labelText) {
        const label = labelElementForContainer(line, { text: labelText, ...(typeof spec.label === 'object' ? spec.label : {}) }, batchId, index++, 'label')
        line.boundElements = [{ type: 'text', id: label.id }]
        elements.push(line, label)
      } else {
        elements.push(line)
      }
      continue
    }

    throw new Error(`Unsupported element type: ${type}`)
  }

  return { batchId, elements }
}

function reindexElements(elements) {
  return elements.map((element, index) => ({
    ...element,
    index: element.index ?? `a${String(index).padStart(6, '0')}`
  }))
}

function directiveType(value) {
  const type = nonEmptyString(value)
  if (type === 'cameraUpdate' || type === 'delete' || type === 'restoreCheckpoint') return type
  return null
}

function isDirectiveSpec(spec) {
  return Boolean(directiveType(spec?.type))
}

function normalizeViewport(value) {
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
  const ratio = width / height
  const nextSize = Math.abs(ratio - 4 / 3) < 0.01
    ? { width, height }
    : ratio > 4 / 3
      ? { width, height: Math.round(width * 3 / 4) }
      : { width: Math.round(height * 4 / 3), height }

  return {
    type: 'cameraUpdate',
    x: value.x,
    y: value.y,
    width: nextSize.width,
    height: nextSize.height
  }
}

function collectDirectiveEffects(specs = []) {
  const deleteIds = new Set()
  let viewport = null
  let checkpointId = null

  for (const spec of Array.isArray(specs) ? specs : []) {
    const type = directiveType(spec?.type)
    if (type === 'cameraUpdate') {
      viewport = normalizeViewport(spec) ?? viewport
      continue
    }
    if (type === 'restoreCheckpoint') {
      checkpointId = nonEmptyString(spec.checkpointId) ?? nonEmptyString(spec.id) ?? checkpointId
      continue
    }
    if (type === 'delete') {
      for (const deleteId of uniqueNonEmptyStrings(spec.elementIds ?? spec.ids ?? [])) {
        deleteIds.add(deleteId)
      }
    }
  }

  return {
    deleteIds: [...deleteIds],
    viewport,
    checkpointId
  }
}

function deleteElementsByIds(scene, elementIds = []) {
  const deleteIds = new Set(uniqueNonEmptyStrings(elementIds))
  const normalized = normalizeScene(scene)
  if (deleteIds.size === 0) {
    return { scene: normalized, deletedElementIds: [] }
  }

  const deletedElementIds = []
  const nextElements = normalized.elements.map((element) => {
    const shouldDelete = deleteIds.has(element.id) || deleteIds.has(element.containerId)
    if (!shouldDelete || element.isDeleted) return element
    deletedElementIds.push(element.id)
    return touchElement(element, { isDeleted: true })
  })

  return {
    scene: {
      ...normalized,
      elements: reindexElements(nextElements)
    },
    deletedElementIds
  }
}

export function splitElementSpecsAndDirectives(specs) {
  if (!Array.isArray(specs)) {
    return { elementSpecs: [], directives: collectDirectiveEffects([]) }
  }
  return {
    elementSpecs: specs.filter((spec) => !isDirectiveSpec(spec)),
    directives: collectDirectiveEffects(specs)
  }
}

export function insertElementSpecs(scene, specs, options = {}) {
  const normalized = normalizeScene(scene)
  const layout = normalizeElementSpecsForLayout(specs, { mode: 'file-backed' })
  const { elementSpecs, directives } = splitElementSpecsAndDirectives(layout.elements)
  const deleted = deleteElementsByIds(normalized, directives.deleteIds)
  const baseScene = deleted.scene
  if (elementSpecs.length === 0) {
    return {
      scene: baseScene,
      insertedElements: [],
      deletedElementIds: deleted.deletedElementIds,
      viewport: directives.viewport,
      checkpointId: directives.checkpointId,
      layoutValidation: layout.report,
      qualityReport: qualityReportForElements(baseScene.elements, { layoutValidation: layout.report }),
      batchId: nonEmptyString(options.batchId) ?? makeId('batch')
    }
  }

  const { batchId, elements } = elementSpecsToElements(elementSpecs, {
    ...options,
    startIndex: baseScene.elements.length
  })
  const nextScene = {
    ...baseScene,
    elements: reindexElements([...baseScene.elements, ...elements])
  }
  return {
    scene: nextScene,
    insertedElements: elements,
    deletedElementIds: deleted.deletedElementIds,
    viewport: directives.viewport,
    checkpointId: directives.checkpointId,
    layoutValidation: layout.report,
    qualityReport: qualityReportForElements(elements, { layoutValidation: layout.report }),
    batchId
  }
}

function isAllowedAssetChar(char) {
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

function stripExtension(fileName) {
  const extension = extname(fileName)
  if (!extension) return fileName
  return fileName.slice(0, fileName.length - extension.length)
}

function stripLeadingDots(value) {
  let start = 0
  while (start < value.length && value[start] === '.') start += 1
  return value.slice(start)
}

function timestampForFile(date = new Date()) {
  let value = date.toISOString()
  let next = ''
  for (const char of value) {
    next += char === ':' || char === '.' ? '-' : char
  }
  return next
}

function safeAssetFileName(name, fallbackName = 'image.png') {
  const rawName = basename(String(name || fallbackName))
  const fallback = basename(String(fallbackName || 'image.png'))
  let safe = ''
  for (const char of rawName || fallback) {
    safe += isAllowedAssetChar(char) ? char : '-'
  }
  safe = trimDashes(safe)
  const safeExtension = extname(safe)
  if (!safe) return fallback
  if (!safeExtension) return `${safe}${extname(fallback) || '.png'}`
  return safe
}

function mimeTypeForExtension(filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.svg') return 'image/svg+xml'
  return null
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.png'
}

function isPng(buffer) {
  return (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
}

function imageDimensionsFromBuffer(buffer, mimeType) {
  if (mimeType === 'image/png' && isPng(buffer)) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    }
  }

  return { width: null, height: null }
}

function parseDataUrl(dataURL) {
  const value = nonEmptyString(dataURL)
  if (!value || !value.startsWith('data:')) {
    throw new Error('image.dataURL must be a base64 data URL.')
  }

  const commaIndex = value.indexOf(',')
  if (commaIndex < 0) throw new Error('image.dataURL is missing its data separator.')

  const header = value.slice(5, commaIndex)
  const body = value.slice(commaIndex + 1)
  const parts = header.split(';').filter(Boolean)
  const mimeType = parts.find((part) => part.includes('/')) ?? null
  if (!parts.includes('base64')) {
    throw new Error('Only base64 image data URLs are supported.')
  }
  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new Error('image.dataURL must use an image MIME type.')
  }

  return {
    dataURL: value,
    buffer: Buffer.from(body, 'base64'),
    mimeType
  }
}

async function readImageSource(image = {}) {
  const dataURL = nonEmptyString(image.dataURL)
  if (dataURL) {
    const parsed = parseDataUrl(dataURL)
    const mimeType = nonEmptyString(image.mimeType) ?? parsed.mimeType
    if (!mimeType.startsWith('image/')) {
      throw new Error('image.mimeType must be an image MIME type.')
    }
    return {
      ...parsed,
      sourcePath: null,
      sourceName: nonEmptyString(image.name),
      mimeType
    }
  }

  const sourcePath = nonEmptyString(image.filePath)
  if (!sourcePath) {
    throw new Error('image.filePath or image.dataURL is required.')
  }

  const absolutePath = resolve(sourcePath)
  const buffer = await readFile(absolutePath)
  const mimeType = nonEmptyString(image.mimeType) ?? mimeTypeForExtension(absolutePath)
  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new Error('image.mimeType is required for image files with unsupported extensions.')
  }

  return {
    dataURL: `data:${mimeType};base64,${buffer.toString('base64')}`,
    buffer,
    mimeType,
    sourcePath: absolutePath,
    sourceName: nonEmptyString(image.name) ?? basename(absolutePath)
  }
}

function boundsForElements(elements) {
  const visible = elements.filter((element) => element && !element.isDeleted)
  if (visible.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const element of visible) {
    const x = numberOr(element.x, 0)
    const y = numberOr(element.y, 0)
    const width = Math.max(1, numberOr(element.width, 1))
    const height = Math.max(1, numberOr(element.height, 1))
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  }
}

function alignmentOffset(available, used, alignment) {
  if (alignment === 'left' || alignment === 'top') return 0
  if (alignment === 'right' || alignment === 'bottom') return Math.max(0, available - used)
  return Math.max(0, (available - used) / 2)
}

function resolveImageCrop(intrinsicWidth, intrinsicHeight, targetWidth, targetHeight, placement = {}) {
  const naturalWidth = Math.max(1, intrinsicWidth)
  const naturalHeight = Math.max(1, intrinsicHeight)
  const targetRatio = targetWidth > 0 && targetHeight > 0
    ? targetWidth / targetHeight
    : naturalWidth / naturalHeight
  const imageRatio = naturalWidth / naturalHeight

  let cropWidth = naturalWidth
  let cropHeight = naturalHeight
  if (imageRatio > targetRatio) {
    cropWidth = naturalHeight * targetRatio
  } else if (imageRatio < targetRatio) {
    cropHeight = naturalWidth / targetRatio
  }

  return {
    x: alignmentOffset(naturalWidth, cropWidth, placement.alignX),
    y: alignmentOffset(naturalHeight, cropHeight, placement.alignY),
    width: cropWidth,
    height: cropHeight,
    naturalWidth,
    naturalHeight
  }
}

function resolveImagePlacement(bounds, intrinsicWidth, intrinsicHeight, placement = {}) {
  const margin = Math.max(0, numberOr(placement.margin, 0))
  const availableWidth = Math.max(1, numberOr(bounds.width, 1) - margin * 2)
  const availableHeight = Math.max(1, numberOr(bounds.height, 1) - margin * 2)
  const fit = placement.fit === 'stretch' || placement.fit === 'cover' ? placement.fit : 'contain'
  let width = availableWidth
  let height = availableHeight
  let crop = null

  if (fit === 'contain') {
    const imageRatio = intrinsicWidth > 0 && intrinsicHeight > 0
      ? intrinsicWidth / intrinsicHeight
      : availableWidth / availableHeight
    width = availableWidth
    height = width / imageRatio
    if (height > availableHeight) {
      height = availableHeight
      width = height * imageRatio
    }
  } else if (fit === 'cover') {
    crop = resolveImageCrop(intrinsicWidth, intrinsicHeight, availableWidth, availableHeight, placement)
  }

  const x = numberOr(bounds.x, 0) + margin + alignmentOffset(availableWidth, width, placement.alignX)
  const y = numberOr(bounds.y, 0) + margin + alignmentOffset(availableHeight, height, placement.alignY)

  return { x, y, width, height, fit, margin, crop }
}

function explicitPlacementBounds(placement = {}) {
  if (
    Number.isFinite(placement.x) &&
    Number.isFinite(placement.y) &&
    Number.isFinite(placement.width) &&
    Number.isFinite(placement.height)
  ) {
    return {
      x: placement.x,
      y: placement.y,
      width: Math.max(1, placement.width),
      height: Math.max(1, placement.height)
    }
  }
  return null
}

export async function insertImageSpec(scene, input = {}, options = {}) {
  const normalized = normalizeScene(scene)
  const image = input.image && typeof input.image === 'object' ? input.image : null
  if (!image) throw new Error('image object is required.')

  const source = await readImageSource(image)
  const detected = imageDimensionsFromBuffer(source.buffer, source.mimeType)
  const intrinsicWidth = Math.max(1, numberOr(detected.width, numberOr(image.width, 1)))
  const intrinsicHeight = Math.max(1, numberOr(detected.height, numberOr(image.height, 1)))
  const targetElementIds = collectTargetElementIds(
    normalized,
    input.target ?? {},
    options.selection ?? emptySelection(),
    options.comments ?? emptyComments()
  )
  const targetSet = new Set(targetElementIds)
  const targetElements = normalized.elements.filter((element) => targetSet.has(element.id) && !element.isDeleted)
  const bounds = explicitPlacementBounds(input.placement) ?? boundsForElements(targetElements)
  if (!bounds) {
    throw new Error('Image insertion requires explicit placement or structural targets.')
  }

  const placement = resolveImagePlacement(bounds, intrinsicWidth, intrinsicHeight, input.placement ?? {})
  const batchId = nonEmptyString(input.batchId) ?? makeId('image_batch')
  const fileId = nonEmptyString(input.fileId) ?? makeId('image_file')
  const extension = extensionForMimeType(source.mimeType)
  const fallbackAssetName = `${fileId}${extension}`
  const assetName = safeAssetFileName(source.sourceName, fallbackAssetName)
  const { assetsDir } = canvasPaths(options.canvasDir ?? resolveCanvasDir(input))
  await mkdir(assetsDir, { recursive: true })
  const assetPath = join(assetsDir, assetName)
  await writeFile(assetPath, source.buffer)

  const now = Date.now()
  const singleTarget = targetElements.length === 1 ? targetElements[0] : null
  const imageElement = {
    id: nonEmptyString(input.id) ?? makeId('image'),
    type: 'image',
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    angle: numberOr(input.placement?.angle, numberOr(singleTarget?.angle, 0)),
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: numberOr(input.placement?.opacity, 100),
    groupIds: [],
    frameId: singleTarget?.frameId ?? null,
    index: `a${String(normalized.elements.length).padStart(6, '0')}`,
    roundness: null,
    seed: randomSeed(),
    version: 1,
    versionNonce: randomSeed(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: boolOr(input.placement?.locked, false),
    fileId,
    status: 'saved',
    scale: [1, 1],
    crop: placement.crop,
    customData: codexCustomData(input, batchId, 'image', {
      sourceCommentId: nonEmptyString(input.target?.commentId),
      targetElementIds,
      sourceAssetPath: assetPath
    })
  }

  const nextScene = {
    ...normalized,
    elements: reindexElements([...normalized.elements, imageElement]),
    files: {
      ...normalized.files,
      [fileId]: {
        id: fileId,
        mimeType: source.mimeType,
        dataURL: source.dataURL,
        created: now,
        lastRetrieved: now
      }
    }
  }

  return {
    scene: nextScene,
    imageElement,
    fileId,
    assetPath,
    targetElementIds,
    placement,
    sourcePath: source.sourcePath
  }
}

function selectedIdsFromSelection(selection) {
  const ids = new Set()
  for (const id of selection?.selectedElementIds ?? []) {
    if (nonEmptyString(id)) ids.add(id)
  }
  for (const element of selection?.selectedElements ?? []) {
    if (nonEmptyString(element?.id)) ids.add(element.id)
  }
  return ids
}

export function collectTargetElementIds(scene, target = {}, selection = emptySelection(), comments = emptyComments()) {
  const ids = new Set()

  for (const id of target.elementIds ?? []) {
    if (nonEmptyString(id)) ids.add(id)
  }

  if (target.selected === true) {
    for (const id of selectedIdsFromSelection(selection)) ids.add(id)
  }

  for (const semanticId of target.semanticIds ?? []) {
    const cleanSemanticId = nonEmptyString(semanticId)
    if (!cleanSemanticId) continue
    for (const element of scene.elements) {
      if (!element.isDeleted && element.customData?.codex?.semanticId === cleanSemanticId) {
        ids.add(element.id)
      }
    }
  }

  const commentId = nonEmptyString(target.commentId)
  if (commentId) {
    const comment = comments.comments.find((item) => item.id === commentId)
    for (const id of comment?.targetElementIds ?? []) {
      if (nonEmptyString(id)) ids.add(id)
    }
  }

  return [...ids]
}

function touchElement(element, patch = {}) {
  return {
    ...element,
    ...patch,
    version: numberOr(element.version, 1) + 1,
    versionNonce: randomSeed(),
    updated: Date.now()
  }
}

function patchElement(element, patch) {
  const nextPatch = {}
  for (const field of ELEMENT_FIELDS) {
    if (patch[field] !== undefined) nextPatch[field] = patch[field]
  }
  for (const field of STYLE_FIELDS) {
    if (patch[field] !== undefined) nextPatch[field] = patch[field]
  }
  if (patch.customData !== undefined) {
    nextPatch.customData = mergePlainObject(element.customData, patch.customData)
  }
  if (element.type === 'text' && patch.text !== undefined) {
    const text = String(patch.text)
    const measured = estimateTextSize(text, numberOr(patch.fontSize ?? element.fontSize, 22), numberOr(element.lineHeight, 1.25))
    nextPatch.text = text
    nextPatch.originalText = text
    nextPatch.fontSize = numberOr(patch.fontSize ?? element.fontSize, 22)
    nextPatch.width = patch.width ?? measured.width
    nextPatch.height = patch.height ?? measured.height
  }
  return touchElement(element, nextPatch)
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null
}

function targetGeometryPatch(element, patch) {
  const patchX = finiteNumber(patch.x)
  const patchY = finiteNumber(patch.y)
  const patchWidth = finiteNumber(patch.width)
  const patchHeight = finiteNumber(patch.height)
  const currentX = numberOr(element.x, 0)
  const currentY = numberOr(element.y, 0)
  const currentWidth = numberOr(element.width, 0)
  const currentHeight = numberOr(element.height, 0)
  const nextX = patchX ?? currentX
  const nextY = patchY ?? currentY
  const nextWidth = patchWidth ?? currentWidth
  const nextHeight = patchHeight ?? currentHeight

  return {
    moved: patchX !== null || patchY !== null,
    resized: patchWidth !== null || patchHeight !== null,
    dx: nextX - currentX,
    dy: nextY - currentY,
    nextX,
    nextY,
    nextWidth,
    nextHeight
  }
}

function boundTextPatch(element, patch, geometry) {
  const nextPatch = {}
  if (patch.labelText !== undefined) {
    nextPatch.text = String(patch.labelText)
  }
  if (geometry?.moved) {
    nextPatch.x = numberOr(element.x, 0) + geometry.dx
    nextPatch.y = numberOr(element.y, 0) + geometry.dy
  }
  if (geometry?.resized) {
    nextPatch.x = geometry.nextX + geometry.nextWidth / 2 - numberOr(element.width, 0) / 2
    nextPatch.y = geometry.nextY + geometry.nextHeight / 2 - numberOr(element.height, 0) / 2
  }
  return nextPatch
}

export function updateElements(scene, target, patch, selection = emptySelection(), comments = emptyComments()) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Expected patch object.')
  }

  const normalized = normalizeScene(scene)
  const targetElementIds = collectTargetElementIds(normalized, target, selection, comments)
  if (targetElementIds.length === 0) {
    throw new Error('No target elements matched. Select elements or pass explicit elementIds/semanticIds/commentId.')
  }

  const targetSet = new Set(targetElementIds)
  const labelText = patch.labelText !== undefined ? String(patch.labelText) : null
  const targetGeometryById = new Map()
  for (const element of normalized.elements) {
    if (!targetSet.has(element.id)) continue
    const geometry = targetGeometryPatch(element, patch)
    if (geometry.moved || geometry.resized) {
      targetGeometryById.set(element.id, geometry)
    }
  }
  const updatedElementIds = []
  const nextElements = normalized.elements.map((element) => {
    if (targetSet.has(element.id)) {
      updatedElementIds.push(element.id)
      return patchElement(element, patch)
    }

    if (element.type === 'text' && element.containerId && targetSet.has(element.containerId)) {
      const geometry = targetGeometryById.get(element.containerId)
      if (labelText === null && !geometry) return element
      updatedElementIds.push(element.id)
      return patchElement(element, boundTextPatch(element, patch, geometry))
    }

    return element
  })

  return {
    scene: {
      ...normalized,
      elements: nextElements
    },
    updatedElementIds,
    targetElementIds
  }
}

export function deleteElements(scene, target, selection = emptySelection(), comments = emptyComments()) {
  const normalized = normalizeScene(scene)
  const targetElementIds = collectTargetElementIds(normalized, target, selection, comments)
  if (targetElementIds.length === 0) {
    throw new Error('No target elements matched. Select elements or pass explicit elementIds/semanticIds/commentId.')
  }

  const targetSet = new Set(targetElementIds)
  const expandedTargetSet = new Set(targetSet)
  for (const element of normalized.elements) {
    if (targetSet.has(element.id)) {
      for (const boundElement of element.boundElements ?? []) {
        if (nonEmptyString(boundElement?.id)) expandedTargetSet.add(boundElement.id)
      }
    }
    if (element.containerId && targetSet.has(element.containerId)) {
      expandedTargetSet.add(element.id)
    }
  }

  const deletedElementIds = []
  const nextElements = normalized.elements.map((element) => {
    if (!expandedTargetSet.has(element.id) || element.isDeleted) return element
    deletedElementIds.push(element.id)
    return touchElement(element, {
      isDeleted: true,
      boundElements: element.boundElements ?? null,
      customData: mergePlainObject(element.customData, {
        codex: {
          deletedBy: 'codex',
          deletedAt: new Date().toISOString()
        }
      })
    })
  })

  return {
    scene: {
      ...normalized,
      elements: nextElements
    },
    deletedElementIds,
    targetElementIds
  }
}

export function addComment(comments, input = {}) {
  const targetElementIds = uniqueNonEmptyStrings(input.targetElementIds)
  if (targetElementIds.length === 0) throw new Error('At least one target element id is required.')
  const body = nonEmptyString(input.body)
  if (!body) throw new Error('Comment body is required.')
  const comment = {
    id: nonEmptyString(input.id) ?? makeId('comment'),
    targetElementIds,
    body,
    status: 'open',
    createdBy: nonEmptyString(input.createdBy) ?? 'codex',
    createdAt: new Date().toISOString(),
    resolvedAt: null
  }
  return {
    comments: {
      version: 1,
      comments: [comment, ...comments.comments]
    },
    comment
  }
}

export function resolveComment(comments, commentId) {
  const id = nonEmptyString(commentId)
  if (!id) throw new Error('commentId is required.')
  let found = false
  const nextComments = comments.comments.map((comment) => {
    if (comment.id !== id) return comment
    found = true
    return {
      ...comment,
      status: 'resolved',
      resolvedAt: new Date().toISOString()
    }
  })
  if (!found) throw new Error(`Comment not found: ${id}`)
  return { version: 1, comments: nextComments }
}

const ACTION_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'canceled'])

function normalizeActionStatus(status) {
  return ACTION_STATUSES.has(status) ? status : 'queued'
}

export function normalizeActions(actions) {
  const now = new Date().toISOString()
  return {
    version: Number.isFinite(actions?.version) ? actions.version : 1,
    actions: Array.isArray(actions?.actions)
      ? actions.actions
          .filter((action) => action && typeof action === 'object')
          .map((action) => ({
            id: nonEmptyString(action.id) ?? makeId('action'),
            type: nonEmptyString(action.type) ?? 'comment',
            status: normalizeActionStatus(action.status),
            commentId: nonEmptyString(action.commentId),
            targetElementIds: uniqueNonEmptyStrings(action.targetElementIds),
            instruction: nonEmptyString(action.instruction) ?? '',
            source: nonEmptyString(action.source) ?? 'canvas',
            projectDir: nonEmptyString(action.projectDir),
            canvasDir: nonEmptyString(action.canvasDir),
            sceneFingerprint: action.sceneFingerprint ?? null,
            selectionSnapshot: action.selectionSnapshot ?? null,
            createdBy: nonEmptyString(action.createdBy) ?? 'user',
            claimedBy: nonEmptyString(action.claimedBy),
            executorId: nonEmptyString(action.executorId),
            executorRunId: nonEmptyString(action.executorRunId),
            createdAt: nonEmptyString(action.createdAt) ?? now,
            updatedAt: nonEmptyString(action.updatedAt) ?? now,
            startedAt: nonEmptyString(action.startedAt),
            completedAt: nonEmptyString(action.completedAt),
            result: action.result ?? null,
            error: action.error ?? null
          }))
      : []
  }
}

export function queueAction(actions, input = {}) {
  const instruction = nonEmptyString(input.instruction)
  if (!instruction) throw new Error('Action instruction is required.')
  const targetElementIds = uniqueNonEmptyStrings(input.targetElementIds)
  if (targetElementIds.length === 0) throw new Error('At least one target element id is required.')

  const now = new Date().toISOString()
  const action = {
    id: nonEmptyString(input.id) ?? makeId('action'),
    type: nonEmptyString(input.type) ?? 'comment',
    status: 'queued',
    commentId: nonEmptyString(input.commentId),
    targetElementIds,
    instruction,
    source: nonEmptyString(input.source) ?? 'canvas-comment',
    projectDir: nonEmptyString(input.projectDir),
    canvasDir: nonEmptyString(input.canvasDir),
    sceneFingerprint: input.sceneFingerprint ?? null,
    selectionSnapshot: input.selectionSnapshot ?? null,
    createdBy: nonEmptyString(input.createdBy) ?? 'user',
    claimedBy: null,
    executorId: nonEmptyString(input.executorId),
    executorRunId: nonEmptyString(input.executorRunId),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    result: null,
    error: null
  }
  const normalized = normalizeActions(actions)
  return {
    actions: {
      version: 1,
      actions: [action, ...normalized.actions]
    },
    action
  }
}

export function claimAction(actions, actionId, input = {}) {
  const id = nonEmptyString(actionId)
  if (!id) throw new Error('actionId is required.')
  const normalized = normalizeActions(actions)
  let claimed = null
  const now = new Date().toISOString()
  const nextActions = normalized.actions.map((action) => {
    if (action.id !== id) return action
    if (action.status === 'completed' || action.status === 'failed' || action.status === 'canceled') {
      throw new Error(`Action ${id} is already ${action.status}.`)
    }
    claimed = {
      ...action,
      status: 'running',
      claimedBy: nonEmptyString(input.claimedBy) ?? 'codex',
      executorId: nonEmptyString(input.executorId) ?? action.executorId,
      executorRunId: nonEmptyString(input.executorRunId) ?? action.executorRunId,
      updatedAt: now,
      startedAt: action.startedAt ?? now
    }
    return claimed
  })
  if (!claimed) throw new Error(`Action not found: ${id}`)
  return {
    actions: {
      version: 1,
      actions: nextActions
    },
    action: claimed
  }
}

export function completeAction(actions, actionId, input = {}) {
  const id = nonEmptyString(actionId)
  if (!id) throw new Error('actionId is required.')
  const status = normalizeActionStatus(input.status ?? 'completed')
  if (status !== 'completed' && status !== 'failed' && status !== 'canceled') {
    throw new Error('Completion status must be completed, failed, or canceled.')
  }
  const normalized = normalizeActions(actions)
  let completed = null
  const now = new Date().toISOString()
  const nextActions = normalized.actions.map((action) => {
    if (action.id !== id) return action
    completed = {
      ...action,
      status,
      updatedAt: now,
      completedAt: now,
      result: input.result ?? action.result,
      error: status === 'failed' ? nonEmptyString(input.error) ?? 'Action failed.' : input.error ?? null
    }
    return completed
  })
  if (!completed) throw new Error(`Action not found: ${id}`)
  return {
    actions: {
      version: 1,
      actions: nextActions
    },
    action: completed
  }
}

export function pendingActions(actions, options = {}) {
  const normalized = normalizeActions(actions)
  const includeRunning = options.includeRunning !== false
  const includeCompleted = options.includeCompleted === true
  return {
    version: normalized.version,
    actions: normalized.actions.filter((action) => {
      if (action.status === 'queued') return true
      if (includeRunning && action.status === 'running') return true
      if (includeCompleted && (action.status === 'completed' || action.status === 'failed' || action.status === 'canceled')) return true
      return false
    })
  }
}

function sanitizeFileName(name, fallbackName = 'export.bin') {
  const rawName = basename(String(name || fallbackName))
  const ext = extname(rawName)
  let base = ''
  for (const char of rawName.slice(0, rawName.length - ext.length)) {
    base += isAllowedAssetChar(char) ? char : '-'
  }
  base = trimDashes(base)
  return `${base || 'export'}${ext || extname(fallbackName) || '.bin'}`
}

function isPathInsideOrSame(parent, child) {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  if (normalizedChild === normalizedParent) return true
  const pathToChild = relative(normalizedParent, normalizedChild)
  const [firstSegment] = pathToChild.split(sep)
  return Boolean(pathToChild) && firstSegment !== '..' && !isAbsolute(pathToChild)
}

function safeExportPath(exportsDir, fileName) {
  const filePath = resolve(join(exportsDir, fileName))
  if (!isPathInsideOrSame(exportsDir, filePath)) {
    throw new Error(`Unsafe export path: ${filePath}`)
  }
  return filePath
}

function sceneBounds(elements) {
  const visible = elements.filter((element) => !element.isDeleted)
  if (visible.length === 0) return { x: 0, y: 0, width: 800, height: 480 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const element of visible) {
    minX = Math.min(minX, numberOr(element.x, 0))
    minY = Math.min(minY, numberOr(element.y, 0))
    maxX = Math.max(maxX, numberOr(element.x, 0) + numberOr(element.width, 0))
    maxY = Math.max(maxY, numberOr(element.y, 0) + numberOr(element.height, 0))
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function svgForElement(element, files) {
  if (element.isDeleted) return ''
  const stroke = escapeXml(element.strokeColor ?? '#1f2937')
  const fill = element.backgroundColor && element.backgroundColor !== 'transparent' ? escapeXml(element.backgroundColor) : 'none'
  const strokeWidth = numberOr(element.strokeWidth, 2)
  const common = `stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${numberOr(element.opacity, 100) / 100}"`

  if (element.type === 'rectangle') {
    return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="10" fill="${fill}" ${common}/>`
  }
  if (element.type === 'ellipse') {
    return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" fill="${fill}" ${common}/>`
  }
  if (element.type === 'diamond') {
    const points = [
      [element.x + element.width / 2, element.y],
      [element.x + element.width, element.y + element.height / 2],
      [element.x + element.width / 2, element.y + element.height],
      [element.x, element.y + element.height / 2]
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ')
    return `<polygon points="${points}" fill="${fill}" ${common}/>`
  }
  if (element.type === 'arrow' || element.type === 'line') {
    const points = (element.points ?? [[0, 0], [element.width, element.height]])
      .map(([x, y]) => `${element.x + x},${element.y + y}`)
      .join(' ')
    const marker = element.type === 'arrow' ? ' marker-end="url(#arrowhead)"' : ''
    return `<polyline points="${points}" fill="none" ${common}${marker}/>`
  }
  if (element.type === 'text') {
    const lines = String(element.text ?? '').split('\n')
    return `<text x="${element.x}" y="${element.y + numberOr(element.fontSize, 22)}" fill="${stroke}" font-family="Virgil, Arial, sans-serif" font-size="${numberOr(element.fontSize, 22)}">${lines
      .map((line, index) => `<tspan x="${element.x}" dy="${index === 0 ? 0 : numberOr(element.fontSize, 22) * numberOr(element.lineHeight, 1.25)}">${escapeXml(line)}</tspan>`)
      .join('')}</text>`
  }
  if (element.type === 'image') {
    const file = files?.[element.fileId]
    if (!file?.dataURL) return ''
    return `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${escapeXml(file.dataURL)}"/>`
  }
  return ''
}

export function sceneToBasicSvg(scene) {
  const normalized = normalizeScene(scene)
  const padding = 32
  const bounds = sceneBounds(normalized.elements)
  const x = bounds.x - padding
  const y = bounds.y - padding
  const width = Math.max(320, bounds.width + padding * 2)
  const height = Math.max(240, bounds.height + padding * 2)
  const background = escapeXml(normalized.appState?.viewBackgroundColor ?? '#fbfbfa')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="${x} ${y} ${width} ${height}">
<defs>
  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0, 10 3.5, 0 7" fill="#1f2937"/>
  </marker>
</defs>
<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${background}"/>
${normalized.elements.map((element) => svgForElement(element, normalized.files)).join('\n')}
</svg>
`
}

export async function exportScene(canvasDir, scene, options = {}) {
  const formats = Array.isArray(options.formats) && options.formats.length > 0 ? options.formats : ['excalidraw']
  const baseName = stripExtension(
    sanitizeFileName(options.fileNameBase ?? `codex-excalidraw-${timestampForFile()}`, 'codex-excalidraw')
  )
  const { exportsDir } = canvasPaths(canvasDir)
  await mkdir(exportsDir, { recursive: true })
  const exported = []
  const unsupported = []
  const normalized = normalizeScene(scene)
  const sceneText = `${JSON.stringify(normalized, null, 2)}\n`

  for (const rawFormat of formats) {
    const format = stripLeadingDots(String(rawFormat)).toLowerCase()
    if (format === 'excalidraw') {
      const filePath = safeExportPath(exportsDir, `${baseName}.excalidraw`)
      await writeFile(filePath, sceneText)
      exported.push({ format, filePath })
      continue
    }
    if (format === 'json') {
      const filePath = safeExportPath(exportsDir, `${baseName}.json`)
      await writeFile(filePath, sceneText)
      exported.push({ format, filePath })
      continue
    }
    if (format === 'svg') {
      const filePath = safeExportPath(exportsDir, `${baseName}.svg`)
      await writeFile(filePath, sceneToBasicSvg(normalized))
      exported.push({ format, filePath })
      continue
    }
    if (format === 'png') {
      unsupported.push({
        format,
        reason: 'PNG export requires the Excalidraw browser renderer; use the canvas Export PNG button for pixel output.'
      })
      continue
    }
    unsupported.push({ format, reason: 'Unsupported export format.' })
  }

  return { exported, unsupported }
}
