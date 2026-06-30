import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  THEME
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import {
  ChevronDown,
  CheckCircle2,
  Copy,
  Download,
  FileJson,
  FolderOpen,
  Languages,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  PencilRuler,
  PlayCircle,
  Plus,
  Power,
  RefreshCw,
  Save,
  Settings,
  Sun,
  Moon,
  Trash2,
  X
} from 'lucide-react'
import { normalizeElementSpecsForLayout } from '../lib/excalidraw-layout.mjs'
import { qualityReportForElements } from '../lib/excalidraw-quality.mjs'

const SCENE_ENDPOINT = '/api/scene'
const SELECTION_ENDPOINT = '/api/selection'
const COMMENTS_ENDPOINT = '/api/comments'
const ACTIONS_ENDPOINT = '/api/actions'
const SESSION_ENDPOINT = '/api/session'
const SESSION_STOP_ENDPOINT = '/api/session/stop'
const EXPORT_ENDPOINT = '/api/export'
const EXECUTORS_ENDPOINT = '/api/executors'
const EXECUTOR_RUNS_ENDPOINT = '/api/executor-runs'
const SCENE_EVENTS_ENDPOINT = '/api/scene-events'
const NATIVE_ELEMENTS_ENDPOINT = '/api/native-elements'
const VIEWPORT_ENDPOINT = '/api/viewport'
const VISUAL_VALIDATION_ENDPOINT = '/api/visual-validation'
const SAVE_DEBOUNCE_MS = 650
const SAVE_STATUS_PENDING_DELAY_MS = 450
const COMMENT_COLLAPSE_LIMIT = 4
const DEFAULT_APP_STATE = {
  viewBackgroundColor: '#fbfbfa',
  currentItemFontFamily: 1
}
const SIDE_PANEL_MIN_WIDTH = 320
const SIDE_PANEL_DEFAULT_WIDTH = 372
const SIDE_PANEL_MIN_CANVAS_WIDTH = 320
const SIDE_PANEL_VIEWPORT_MARGIN = 24
const NATIVE_SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const NATIVE_LINEAR_TYPES = new Set(['arrow', 'line'])
const NATIVE_RENDER_MODES = new Set(['immediate', 'progressive'])
const NATIVE_STYLE_FIELDS = [
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity'
]
const NATIVE_GEOMETRY_FIELDS = ['id', 'x', 'y', 'width', 'height', 'angle', 'locked', 'groupIds']

const UI_TEXT = {
  zh: {
    appTitle: 'Codex Excalidraw',
    localWorkspaceScene: '本地工作区画布',
    loading: '正在加载 Codex Excalidraw Canvas',
    loadFailed: '画布加载失败',
    autosaved: '已自动保存',
    saving: '保存中',
    saveError: '保存失败',
    lastSave: '最近保存',
    export: '导出',
    exportFormat: '导出格式',
    exportPng: 'PNG',
    exportPngDesc: '位图，分享预览',
    exportSvg: 'SVG',
    exportSvgDesc: '矢量图，可缩放',
    exportJson: 'JSON',
    exportJsonDesc: 'scene 数据',
    exportExcalidraw: '.excalidraw',
    exportExcalidrawDesc: '原生白板文件',
    collapsePanel: '收起右侧面板',
    expandPanel: '展开右侧面板',
    resizePanel: '拖拽调整右侧面板宽度',
    annotationTitle: '注释',
    annotating: '正在注释',
    projectSession: '项目切换',
    currentProject: '当前项目',
    copyProjectPath: '复制当前项目路径',
    projectPathCopied: '项目路径已复制',
    projectPathCopyFailed: '项目路径复制失败',
    noProjectSelected: '未选择项目',
    recentProjects: '最近项目',
    projectPathPlaceholder: '/absolute/path/to/project',
    open: '打开',
    refresh: '刷新',
    switchingProject: '正在切换项目...',
    projectLoaded: '项目已加载',
    projectSwitchFailed: '项目切换失败',
    refreshingProject: '正在刷新项目...',
    projectRefreshed: '项目已刷新',
    refreshFailed: '刷新失败',
    selection: '当前选择',
    noSelection: '未选择元素',
    oneSelected: '已选择 1 个元素',
    manySelected: (count) => `已选择 ${count} 个元素`,
    elementTargets: (count) => `${count} 个目标元素`,
    annotationTarget: '注释目标',
    annotationTargetReady: (count) => `已绑定 ${count} 个元素`,
    annotationTargetEmpty: '选择画布元素后开始注释',
    annotationTargetHint: '在画布中点选元素，即可针对它们写注释',
    comments: '评论',
    newComment: '新评论',
    readyForComment: '已绑定当前选择',
    selectBeforeComment: '先在画布中选择元素',
    commentPlaceholderNoSelection: '选择画布元素后，可以在这里写修改要求',
    commentPlaceholder: '写清楚希望 Codex 对这些元素做什么，例如：删除、改色、补充说明',
    noComments: '还没有评论。',
    showMoreComments: (count) => `展开 ${count} 条较早评论`,
    showFewerComments: '收起较早评论',
    commentCreatedAt: (time) => `创建 ${time}`,
    commentResolvedAt: (time) => `关闭 ${time}`,
    savingComment: '正在保存评论...',
    savedComment: (id, count) => `已保存 ${id}，绑定 ${count} 个目标`,
    commentSaveFailed: '评论保存失败',
    resolvingComment: '正在关闭评论...',
    resolvedComment: (id) => `已关闭 ${id}`,
    resolveFailed: '关闭失败',
    deletingComment: '正在删除评论...',
    deletedComment: (id) => `已删除评论 ${id}`,
    deleteComment: '删除',
    deleteCommentBlocked: '评论正在执行中，先取消或等待完成后再删除',
    deleteFailed: '删除失败',
    queueingAction: '正在提交给 Codex...',
    actionQueueFailed: '提交失败',
    copiedExistingAction: (id) => `已复制已有 action ${id}`,
    queuedAction: (id) => `已提交 action ${id}，并复制给 Codex`,
    copiedCommand: (id) => `已复制 ${id} 的执行指令`,
    executor: '执行器',
    executorMode: '执行方式',
    executorLocal: '本地执行',
    executorCopy: '复制指令',
    executorModel: '模型',
    executorModelPlaceholder: '默认使用 Codex CLI 配置',
    executorModelHint: '复杂绘图可填更强模型；留空则使用本机 Codex CLI 默认模型。',
    executorScan: '重新扫描',
    executorScanning: '正在扫描执行器...',
    executorScanFailed: '执行器扫描失败',
    executorRunStarted: (id) => `已启动执行器 run ${id}`,
    executorRunFailed: '执行器启动失败，已回退为复制指令',
    executorUnavailable: '没有可用执行器，点击后会复制指令',
    executorReady: '可用',
    executorWarning: '有警告',
    executorMissing: '不可用',
    executorRunningDetail: '浏览器保持可用，Codex 正在后台处理这条注释。',
    executorLastEvent: '最近进度',
    cancelRun: '取消执行',
    runCanceled: '已请求取消执行',
    openStatus: 'OPEN',
    resolvedStatus: 'RESOLVED',
    runWithCodex: '交给 Codex 执行',
    copyAction: '复制 action',
    copyCommand: '复制指令',
    resolve: '关闭',
    queuedForCodex: '等待 Codex',
    runningInCodex: 'Codex 执行中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
    exports: '导出',
    exportsHint: '导出文件会保存到 canvas/excalidraw/exports，并同时下载到本地。',
    savedPath: (path) => `已保存 ${path}`,
    exportedPath: (path) => `已导出 ${path}`,
    settings: '设置',
    language: '语言',
    appearance: '外观',
    light: '浅色',
    dark: '深色',
    runtime: '运行时',
    runtimeUrl: '本地地址',
    runtimeProject: '当前项目',
    stopLocalCanvas: '停止本地画布',
    stoppingLocalCanvas: '正在停止本地画布...',
    localCanvasStopping: '本地画布正在停止，可以关闭这个标签页。',
    localCanvasStopFailed: '停止本地画布失败',
    settingsMore: '更多设置即将到来：背景网格、画布密度、主题强调色等。',
    canvasUpdated: '画布已由 Codex 更新',
    canvasFocused: '已聚焦到 Codex 指定区域',
    drawingProgress: 'Codex 正在分步绘制...',
    chinese: '中文',
    english: 'English'
  },
  en: {
    appTitle: 'Codex Excalidraw',
    localWorkspaceScene: 'Local workspace scene',
    loading: 'Loading Codex Excalidraw Canvas',
    loadFailed: 'Canvas could not be loaded.',
    autosaved: 'Autosaved',
    saving: 'Saving',
    saveError: 'Save error',
    lastSave: 'Last save',
    export: 'Export',
    exportFormat: 'Export format',
    exportPng: 'PNG',
    exportPngDesc: 'Bitmap image',
    exportSvg: 'SVG',
    exportSvgDesc: 'Vector image',
    exportJson: 'JSON',
    exportJsonDesc: 'scene data',
    exportExcalidraw: '.excalidraw',
    exportExcalidrawDesc: 'Native whiteboard file',
    collapsePanel: 'Collapse right panel',
    expandPanel: 'Expand right panel',
    resizePanel: 'Drag to resize the right panel',
    annotationTitle: 'Annotations',
    annotating: 'Annotating',
    projectSession: 'Project switcher',
    currentProject: 'Current project',
    copyProjectPath: 'Copy current project path',
    projectPathCopied: 'Project path copied',
    projectPathCopyFailed: 'Project path copy failed',
    noProjectSelected: 'No project selected',
    recentProjects: 'Recent projects',
    projectPathPlaceholder: '/absolute/path/to/project',
    open: 'Open',
    refresh: 'Refresh',
    switchingProject: 'Switching project...',
    projectLoaded: 'Project loaded',
    projectSwitchFailed: 'Project switch failed',
    refreshingProject: 'Refreshing project...',
    projectRefreshed: 'Project refreshed',
    refreshFailed: 'Refresh failed',
    selection: 'Selection',
    noSelection: 'No selection',
    oneSelected: '1 element selected',
    manySelected: (count) => `${count} elements selected`,
    elementTargets: (count) => `${count} target${count === 1 ? '' : 's'}`,
    annotationTarget: 'Annotation target',
    annotationTargetReady: (count) => `${count} element${count === 1 ? '' : 's'} bound`,
    annotationTargetEmpty: 'Select canvas elements to start annotating',
    annotationTargetHint: 'Pick elements on the canvas to annotate them',
    comments: 'Comments',
    newComment: 'New comment',
    readyForComment: 'Bound to current selection',
    selectBeforeComment: 'Select elements on the canvas first',
    commentPlaceholderNoSelection: 'Select canvas elements, then describe the requested change here',
    commentPlaceholder: 'Describe what Codex should do to the selected elements, such as delete, recolor, or clarify',
    noComments: 'No comments yet.',
    showMoreComments: (count) => `Show ${count} older comment${count === 1 ? '' : 's'}`,
    showFewerComments: 'Hide older comments',
    commentCreatedAt: (time) => `Created ${time}`,
    commentResolvedAt: (time) => `Resolved ${time}`,
    savingComment: 'Saving comment...',
    savedComment: (id, count) => `Saved ${id} for ${count} target${count === 1 ? '' : 's'}`,
    commentSaveFailed: 'Comment save failed',
    resolvingComment: 'Resolving comment...',
    resolvedComment: (id) => `Resolved ${id}`,
    resolveFailed: 'Resolve failed',
    deletingComment: 'Deleting comment...',
    deletedComment: (id) => `Deleted comment ${id}`,
    deleteComment: 'Delete',
    deleteCommentBlocked: 'This comment is running. Cancel it or wait until it finishes before deleting.',
    deleteFailed: 'Delete failed',
    queueingAction: 'Queueing action for Codex...',
    actionQueueFailed: 'Action queue failed',
    copiedExistingAction: (id) => `Copied existing action ${id}`,
    queuedAction: (id) => `Queued action ${id} for Codex`,
    copiedCommand: (id) => `Copied command for ${id}`,
    executor: 'Executor',
    executorMode: 'Execution mode',
    executorLocal: 'Local run',
    executorCopy: 'Copy command',
    executorModel: 'Model',
    executorModelPlaceholder: 'Use Codex CLI default',
    executorModelHint: 'Set a stronger model for complex drawing, or leave blank to use the local Codex CLI default.',
    executorScan: 'Scan again',
    executorScanning: 'Scanning executors...',
    executorScanFailed: 'Executor scan failed',
    executorRunStarted: (id) => `Started executor run ${id}`,
    executorRunFailed: 'Executor start failed; command copied instead',
    executorUnavailable: 'No executor is ready. Clicks will copy the command.',
    executorReady: 'Ready',
    executorWarning: 'Warning',
    executorMissing: 'Unavailable',
    executorRunningDetail: 'The browser stays usable while Codex handles this comment in the background.',
    executorLastEvent: 'Latest progress',
    cancelRun: 'Cancel run',
    runCanceled: 'Cancel requested',
    openStatus: 'OPEN',
    resolvedStatus: 'RESOLVED',
    runWithCodex: 'Run with Codex',
    copyAction: 'Copy action',
    copyCommand: 'Copy command',
    resolve: 'Resolve',
    queuedForCodex: 'Queued for Codex',
    runningInCodex: 'Running in Codex',
    completed: 'Completed',
    failed: 'Failed',
    canceled: 'Canceled',
    exports: 'Exports',
    exportsHint: 'Exports are saved under canvas/excalidraw/exports and downloaded locally.',
    savedPath: (path) => `Saved ${path}`,
    exportedPath: (path) => `Exported ${path}`,
    settings: 'Settings',
    language: 'Language',
    appearance: 'Appearance',
    light: 'Light',
    dark: 'Dark',
    runtime: 'Runtime',
    runtimeUrl: 'Local URL',
    runtimeProject: 'Current project',
    stopLocalCanvas: 'Stop local canvas',
    stoppingLocalCanvas: 'Stopping local canvas...',
    localCanvasStopping: 'Local canvas is stopping. You can close this tab.',
    localCanvasStopFailed: 'Failed to stop local canvas',
    settingsMore: 'More settings coming soon: background grid, canvas density, accent color, and more.',
    canvasUpdated: 'Canvas updated by Codex',
    canvasFocused: 'Focused the Codex viewport',
    drawingProgress: 'Codex is drawing step by step...',
    chinese: '中文',
    english: 'English'
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

async function copyTextToClipboard(text) {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (error) {
      console.error(error)
    }
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textArea)
  }
}

function maxSidePanelWidth() {
  if (typeof window === 'undefined') return SIDE_PANEL_DEFAULT_WIDTH
  const viewportWidth = window.innerWidth
  const maxWidth = viewportWidth > 1100
    ? viewportWidth - SIDE_PANEL_MIN_CANVAS_WIDTH
    : viewportWidth - SIDE_PANEL_VIEWPORT_MARGIN
  return Math.max(SIDE_PANEL_MIN_WIDTH, Math.floor(maxWidth))
}

function nowStamp() {
  const value = new Date()
  const pad = (part) => String(part).padStart(2, '0')
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(
    value.getHours()
  )}${pad(value.getMinutes())}${pad(value.getSeconds())}`
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function generateIdForFile(file) {
  if (window.crypto?.subtle && file?.arrayBuffer) {
    const digest = await window.crypto.subtle.digest('SHA-1', await file.arrayBuffer())
    return `file_${bufferToHex(digest).slice(0, 24)}`
  }
  return makeId('file')
}

function appThemeForExcalidraw(theme) {
  return theme === 'dark' ? THEME.DARK : THEME.LIGHT
}

function localThemeFromExcalidraw(theme) {
  if (theme === THEME.DARK) return 'dark'
  if (theme === THEME.LIGHT) return 'light'
  return null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function uniqueNonEmptyStrings(values) {
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

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
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

function codexCustomDataForNativeSpec(spec, batchId, role) {
  const customData = mergePlainObject({}, spec.customData)
  customData.codex = {
    createdBy: 'codex',
    batchId,
    role,
    ...(customData.codex ?? {}),
    ...(spec.codex ?? {})
  }
  const semanticId = nonEmptyString(spec.semanticId)
  if (semanticId) customData.codex.semanticId = semanticId
  return customData
}

function copyDefinedFields(target, source, fields) {
  for (const field of fields) {
    if (source[field] !== undefined) target[field] = source[field]
  }
}

function labelSkeletonFromSpec(spec, fallbackText) {
  const label = spec.label
  const labelText = typeof label === 'string' ? label : label?.text ?? fallbackText
  if (!labelText) return null
  return {
    ...(label && typeof label === 'object' ? label : {}),
    text: String(labelText)
  }
}

function textLineCount(text) {
  return Math.max(1, String(text ?? '').split('\n').length)
}

function textHeightForFontSize(text, fontSize, lineHeight) {
  return Math.max(1, textLineCount(text) * fontSize * numberOr(lineHeight, 1.25))
}

function nativeTextSkeletonOverridesBySemanticId(skeletons) {
  const textSkeletonsBySemanticId = new Map()
  for (const skeleton of skeletons) {
    const semanticId = nonEmptyString(skeleton?.customData?.codex?.semanticId)
    if (skeleton?.type === 'text' && semanticId) {
      textSkeletonsBySemanticId.set(semanticId, {
        fontSize: numberOr(skeleton.fontSize, null),
        fontFamily: skeleton.fontFamily,
        textAlign: skeleton.textAlign,
        verticalAlign: skeleton.verticalAlign,
        lineHeight: skeleton.lineHeight
      })
    }
  }
  return textSkeletonsBySemanticId
}

function applyNativeTextSkeletonOverrides(convertedElements, textSkeletonsBySemanticId) {
  if (textSkeletonsBySemanticId.size === 0) return convertedElements
  return convertedElements.map((element) => {
    if (element?.type !== 'text') return element
    const semanticId = nonEmptyString(element.customData?.codex?.semanticId)
    const override = semanticId ? textSkeletonsBySemanticId.get(semanticId) : null
    if (!override) return element

    const fontSize = numberOr(override.fontSize, null)
    const lineHeight = numberOr(override.lineHeight, numberOr(element.lineHeight, 1.25))
    let next = element
    if (fontSize !== null && fontSize !== numberOr(element.fontSize, null)) {
      const currentFontSize = Math.max(1, numberOr(element.fontSize, 16))
      const scale = fontSize / currentFontSize
      next = {
        ...next,
        fontSize,
        width: Math.max(1, numberOr(element.width, 1) * scale),
        height: Math.max(
          1,
          numberOr(element.height, 1) * scale,
          textHeightForFontSize(element.text, fontSize, lineHeight)
        )
      }
    }
    if (override.fontFamily !== undefined) next = { ...next, fontFamily: override.fontFamily }
    if (override.textAlign !== undefined) next = { ...next, textAlign: override.textAlign }
    if (override.verticalAlign !== undefined) next = { ...next, verticalAlign: override.verticalAlign }
    if (override.lineHeight !== undefined) next = { ...next, lineHeight: override.lineHeight }
    return next
  })
}

function nativeSkeletonFromSpec(spec, batchId) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Native element spec must be an object.')
  }

  const type = nonEmptyString(spec.type)
  if (!type) throw new Error('Native element spec requires a type.')

  const style = spec.style && typeof spec.style === 'object' ? spec.style : {}
  const role = NATIVE_LINEAR_TYPES.has(type) ? type : type === 'text' ? 'text' : 'shape'
  const skeleton = {
    type,
    x: numberOr(spec.x, 0),
    y: numberOr(spec.y, 0),
    customData: codexCustomDataForNativeSpec(spec, batchId, role)
  }
  copyDefinedFields(skeleton, spec, NATIVE_GEOMETRY_FIELDS)
  copyDefinedFields(skeleton, style, NATIVE_STYLE_FIELDS)

  if (NATIVE_SHAPE_TYPES.has(type)) {
    skeleton.width = numberOr(spec.width, 160)
    skeleton.height = numberOr(spec.height, 90)
    const label = labelSkeletonFromSpec(spec, spec.text)
    if (label) skeleton.label = label
    return skeleton
  }

  if (type === 'text') {
    skeleton.text = String(spec.text ?? '')
    skeleton.fontSize = numberOr(spec.fontSize ?? style.fontSize, 22)
    if (spec.fontFamily !== undefined) skeleton.fontFamily = spec.fontFamily
    if (spec.textAlign !== undefined) skeleton.textAlign = spec.textAlign
    if (spec.verticalAlign !== undefined) skeleton.verticalAlign = spec.verticalAlign
    if (spec.lineHeight !== undefined) skeleton.lineHeight = spec.lineHeight
    return skeleton
  }

  if (NATIVE_LINEAR_TYPES.has(type)) {
    const points = Array.isArray(spec.points) && spec.points.length >= 2
      ? spec.points
      : [[0, 0], [numberOr(spec.width, 180), numberOr(spec.height, 0)]]
    skeleton.points = points
    if (spec.startArrowhead !== undefined) skeleton.startArrowhead = spec.startArrowhead
    if (spec.endArrowhead !== undefined) skeleton.endArrowhead = spec.endArrowhead
    if (type === 'arrow' && skeleton.endArrowhead === undefined) skeleton.endArrowhead = 'arrow'
    const label = labelSkeletonFromSpec(spec)
    if (label) skeleton.label = label
    return skeleton
  }

  throw new Error(`Unsupported native element type: ${type}`)
}

function viewportFocusElement(viewport) {
  if (
    !viewport ||
    typeof viewport !== 'object' ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height)
  ) {
    return null
  }
  return {
    id: makeId('viewport_focus'),
    type: 'rectangle',
    x: viewport.x,
    y: viewport.y,
    width: Math.max(1, viewport.width),
    height: Math.max(1, viewport.height),
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 1,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false
  }
}

function elementsForVisualValidation(elements, elementIds) {
  if (!Array.isArray(elementIds) || elementIds.length === 0) return elements
  const wanted = new Set()
  for (const id of elementIds) {
    if (typeof id !== 'string') continue
    const text = id.trim()
    if (text) wanted.add(text)
  }
  if (wanted.size === 0) return elements
  return elements.filter((element) => wanted.has(element.id) || wanted.has(element.containerId))
}

function visualValidationFileName(request) {
  const base = nonEmptyString(request?.fileNameBase) ??
    nonEmptyString(request?.batchId) ??
    nonEmptyString(request?.id) ??
    `visual-validation-${nowStamp()}`
  return `${base}.svg`
}

function renderingOptionsFromRequest(request, elementCount) {
  const rendering = request?.rendering && typeof request.rendering === 'object' ? request.rendering : {}
  const explicitMode = NATIVE_RENDER_MODES.has(rendering.mode) ? rendering.mode : null
  return {
    mode: explicitMode ?? (elementCount > 1 ? 'progressive' : 'immediate'),
    stepDelayMs: Math.max(0, Math.min(140, numberOr(rendering.stepDelayMs, 44))),
    maxSteps: Math.max(1, Math.min(40, numberOr(rendering.maxSteps, 24)))
  }
}

function groupElementsForProgressiveReveal(elements, maxSteps) {
  const rawGroups = []
  for (const element of elements) {
    const lastGroup = rawGroups[rawGroups.length - 1]
    if (element.containerId && lastGroup?.some((item) => item.id === element.containerId)) {
      lastGroup.push(element)
    } else {
      rawGroups.push([element])
    }
  }
  if (rawGroups.length <= maxSteps) return rawGroups
  const bucketSize = Math.ceil(rawGroups.length / maxSteps)
  const groups = []
  for (let index = 0; index < rawGroups.length; index += bucketSize) {
    groups.push(rawGroups.slice(index, index + bucketSize).flat())
  }
  return groups
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    window.setTimeout(resolveDelay, ms)
  })
}

function reindexSceneElements(elements) {
  return elements.map((element, index) => ({
    ...element,
    index: `a${index.toString(36)}`
  }))
}

function isScene(value) {
  return value && typeof value === 'object' && Array.isArray(value.elements)
}

function toScenePayload(elements, appState, files) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'codex-excalidraw-canvas',
    elements,
    appState: {
      ...DEFAULT_APP_STATE,
      viewBackgroundColor: appState?.viewBackgroundColor ?? DEFAULT_APP_STATE.viewBackgroundColor,
      gridSize: appState?.gridSize,
      name: appState?.name
    },
    files: files ?? {}
  }
}

function appStateForExcalidraw(appState) {
  const nextAppState = {
    ...DEFAULT_APP_STATE,
    ...(appState ?? {})
  }
  delete nextAppState.theme
  return nextAppState
}

function normalizedScenePayload(scene) {
  return toScenePayload(scene?.elements ?? [], scene?.appState ?? DEFAULT_APP_STATE, scene?.files ?? {})
}

function sceneSnapshot(scene) {
  return JSON.stringify(normalizedScenePayload(scene))
}

function selectedElementsFromAppState(elements, appState) {
  const selectedIds = appState?.selectedElementIds ?? {}
  return elements
    .filter((element) => selectedIds[element.id])
    .map((element) => ({
      id: element.id,
      type: element.type,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width ?? 0),
      height: Math.round(element.height ?? 0),
      text: element.text ?? null,
      customData: element.customData ?? null
    }))
}

function getSceneBounds(elements) {
  const visible = elements.filter((element) => !element.isDeleted)
  if (visible.length === 0) {
    return { x: -280, y: -160, width: 560, height: 320 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const element of visible) {
    minX = Math.min(minX, element.x)
    minY = Math.min(minY, element.y)
    maxX = Math.max(maxX, element.x + (element.width ?? 0))
    maxY = Math.max(maxY, element.y + (element.height ?? 0))
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function sceneFingerprint(scene) {
  const elements = scene?.elements ?? []
  const visibleElements = elements.filter((element) => !element.isDeleted)
  const latestElementUpdated = visibleElements.reduce((latest, element) => Math.max(latest, Number(element.updated) || 0), 0)
  return {
    elementCount: elements.length,
    visibleElementCount: visibleElements.length,
    fileCount: Object.keys(scene?.files ?? {}).length,
    latestElementUpdated
  }
}

function selectedSnapshotFromIds(scene, targetElementIds) {
  const targetSet = new Set(targetElementIds)
  return (scene?.elements ?? [])
    .filter((element) => targetSet.has(element.id))
    .map((element) => ({
      id: element.id,
      type: element.type,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width ?? 0),
      height: Math.round(element.height ?? 0),
      text: element.text ?? null,
      customData: element.customData ?? null
    }))
}

function changedVisibleElements(localElements, incomingElements) {
  const localById = new Map()
  for (const element of localElements ?? []) {
    if (element?.id) localById.set(element.id, element)
  }

  const changed = []
  for (const element of incomingElements ?? []) {
    if (!element?.id || element.isDeleted) continue
    const local = localById.get(element.id)
    if (
      !local ||
      local.version !== element.version ||
      local.versionNonce !== element.versionNonce ||
      local.isDeleted !== element.isDeleted
    ) {
      changed.push(element)
    }
  }
  return changed
}

function actionCommand(action, language) {
  if (language === 'en') {
    return `Execute Excalidraw action ${action.id}. First call get_pending_excalidraw_actions to read this action, claim it, only modify its targetElementIds according to instruction, then call complete_excalidraw_action.`
  }
  return `执行 Excalidraw action ${action.id}。先调用 get_pending_excalidraw_actions 读取这个 action，claim 后只处理它的 targetElementIds，按 instruction 修改画布，最后调用 complete_excalidraw_action。`
}

function actionStatusText(action, labels) {
  if (!action) return null
  if (action.status === 'queued') return labels.queuedForCodex
  if (action.status === 'running') return labels.runningInCodex
  if (action.status === 'completed') return labels.completed
  if (action.status === 'failed') return labels.failed
  if (action.status === 'canceled') return labels.canceled
  return action.status
}

function formatCommentTime(value, language) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

async function postJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'PUT',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(payload)
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return response.json()
}

function executorHeaders(session) {
  const token = nonEmptyString(session?.executorToken)
  return token ? { 'x-codex-excalidraw-executor-token': token } : {}
}

function latestExecutorDisplayEvent(events = []) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.data?.audience === 'user') return event
  }
  return events[events.length - 1] ?? null
}

async function saveExport(fileName, data, encoding = 'utf8') {
  const response = await fetch(EXPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName, data, encoding })
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return response.json()
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

function ToolbarButton({ children, icon: Icon, onClick, disabled, variant = 'secondary', title, testId }) {
  return (
    <button
      className={`toolbar-button toolbar-button--${variant}`}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {Icon ? <Icon aria-hidden="true" size={16} strokeWidth={2} /> : null}
      <span>{children}</span>
    </button>
  )
}

function StatusPill({ labels, savedAt, status }) {
  const label = status === 'error' ? labels.saveError : labels.autosaved
  const title = status === 'saving' ? labels.saving : savedAt ? `${labels.lastSave}: ${savedAt}` : undefined
  return (
    <div aria-live="polite" className={`status-pill status-pill--${status}`} title={title}>
      <CheckCircle2 aria-hidden="true" size={15} strokeWidth={2.2} />
      <span className="status-pill__label">{label}</span>
      <span aria-hidden="true" className="status-pill__activity" />
    </div>
  )
}

export default function App() {
  const [initialData, setInitialData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveStatus, setSaveStatus] = useState('saved')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [scenePath, setScenePath] = useState('')
  const [session, setSession] = useState(null)
  const [projects, setProjects] = useState([])
  const [projectDraft, setProjectDraft] = useState('')
  const [projectMessage, setProjectMessage] = useState('')
  const [selection, setSelection] = useState([])
  const [apiReady, setApiReady] = useState(false)
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false)
  const [sidePanelWidth, setSidePanelWidth] = useState(SIDE_PANEL_DEFAULT_WIDTH)
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false)
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [language, setLanguage] = useState(() => {
    if (typeof window === 'undefined') return 'zh'
    return window.localStorage.getItem('codex-excalidraw-language') === 'en' ? 'en' : 'zh'
  })
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem('codex-excalidraw-theme') === 'dark' ? 'dark' : 'light'
  })
  const [comments, setComments] = useState([])
  const [areCommentsExpanded, setAreCommentsExpanded] = useState(false)
  const [actions, setActions] = useState([])
  const [executorState, setExecutorState] = useState({ config: null, executors: [], selectedExecutorId: null })
  const [executorRuns, setExecutorRuns] = useState([])
  const [executorMessage, setExecutorMessage] = useState('')
  const [isScanningExecutors, setIsScanningExecutors] = useState(false)
  const [executorModelDraft, setExecutorModelDraft] = useState('')
  const [stopCanvasMessage, setStopCanvasMessage] = useState('')
  const [isStoppingCanvas, setIsStoppingCanvas] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentMessage, setCommentMessage] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const t = UI_TEXT[language]
  const apiRef = useRef(null)
  const sceneRef = useRef(null)
  const lastPersistedSceneSnapshotRef = useRef('')
  const saveTimerRef = useRef(null)
  const saveStatusDelayRef = useRef(null)
  const saveRequestIdRef = useRef(0)
  const isRemoteApplyingRef = useRef(false)
  const hasPendingLocalSceneSaveRef = useRef(false)
  const isNativeElementRequestRunningRef = useRef(false)
  const isViewportRequestRunningRef = useRef(false)
  const isVisualValidationRequestRunningRef = useRef(false)
  const pendingControlledThemeRef = useRef(null)
  const exportMenuRef = useRef(null)
  const projectMenuRef = useRef(null)
  const settingsMenuRef = useRef(null)
  const lastSelectionStateRef = useRef('')
  const clientIdRef = useRef(null)

  if (clientIdRef.current === null) {
    clientIdRef.current =
      typeof window !== 'undefined' && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : makeId('client')
  }

  const loadWorkspaceState = useCallback(async (signal) => {
    const [sessionResponse, sceneResponse, commentsResponse, actionsResponse, executorsResponse, executorRunsResponse] = await Promise.all([
      fetch(SESSION_ENDPOINT, { signal }),
      fetch(SCENE_ENDPOINT, { signal }),
      fetch(COMMENTS_ENDPOINT, { signal }),
      fetch(ACTIONS_ENDPOINT, { signal }),
      fetch(EXECUTORS_ENDPOINT, { signal }),
      fetch(EXECUTOR_RUNS_ENDPOINT, { signal })
    ])
    if (!sessionResponse.ok) throw new Error(`Failed to load session: ${sessionResponse.status}`)
    if (!sceneResponse.ok) throw new Error(`Failed to load scene: ${sceneResponse.status}`)
    if (!commentsResponse.ok) throw new Error(`Failed to load comments: ${commentsResponse.status}`)
    if (!actionsResponse.ok) throw new Error(`Failed to load actions: ${actionsResponse.status}`)
    if (!executorsResponse.ok) throw new Error(`Failed to load executors: ${executorsResponse.status}`)
    if (!executorRunsResponse.ok) throw new Error(`Failed to load executor runs: ${executorRunsResponse.status}`)
    const [sessionPayload, scenePayload, commentsPayload, actionsPayload, executorsPayload, executorRunsPayload] = await Promise.all([
      sessionResponse.json(),
      sceneResponse.json(),
      commentsResponse.json(),
      actionsResponse.json(),
      executorsResponse.json(),
      executorRunsResponse.json()
    ])
    const scene = isScene(scenePayload.scene) ? scenePayload.scene : toScenePayload([], DEFAULT_APP_STATE, {})
    sceneRef.current = scene
    lastPersistedSceneSnapshotRef.current = sceneSnapshot(scene)
    setSession(sessionPayload.session ?? null)
    setProjects(sessionPayload.projects ?? [])
    setProjectDraft(sessionPayload.session?.projectDir ?? '')
    setScenePath(scenePayload.path ?? '')
    setSelection([])
    lastSelectionStateRef.current = ''
    setInitialData({
      elements: scene.elements,
      appState: appStateForExcalidraw(scene.appState),
      files: scene.files ?? {}
    })
    setComments(commentsPayload.comments?.comments ?? [])
    setActions(actionsPayload.actions?.actions ?? [])
    setExecutorState({
      config: executorsPayload.config ?? null,
      executors: executorsPayload.executors ?? [],
      selectedExecutorId: executorsPayload.selectedExecutorId ?? null
    })
    setExecutorRuns(executorRunsPayload.runs?.runs ?? [])
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadWorkspaceState(controller.signal).catch((error) => {
      if (error.name === 'AbortError') return
      setLoadError(error)
    })
    return () => controller.abort()
  }, [loadWorkspaceState])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    window.localStorage.setItem('codex-excalidraw-language', language)
  }, [language])

  useEffect(() => {
    document.documentElement.dataset.codexExcalidrawTheme = theme
    window.localStorage.setItem('codex-excalidraw-theme', theme)
  }, [theme])

  useEffect(() => {
    if (pendingControlledThemeRef.current !== theme) return undefined
    const timeout = window.setTimeout(() => {
      if (pendingControlledThemeRef.current === theme) {
        pendingControlledThemeRef.current = null
      }
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [theme])

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimerRef.current)
      window.clearTimeout(saveStatusDelayRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isExportMenuOpen && !isProjectMenuOpen && !isSettingsOpen) return undefined

    const closeOnOutsideClick = (event) => {
      if (isExportMenuOpen && !exportMenuRef.current?.contains(event.target)) {
        setIsExportMenuOpen(false)
      }
      if (isProjectMenuOpen && !projectMenuRef.current?.contains(event.target)) {
        setIsProjectMenuOpen(false)
      }
    }
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      setIsExportMenuOpen(false)
      setIsProjectMenuOpen(false)
      setIsSettingsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isExportMenuOpen, isProjectMenuOpen, isSettingsOpen])

  const saveScene = useCallback(async (elements, appState, files) => {
    const requestId = saveRequestIdRef.current + 1
    saveRequestIdRef.current = requestId
    hasPendingLocalSceneSaveRef.current = true
    const payload = toScenePayload(elements, appState, files)
    const snapshot = sceneSnapshot(payload)
    if (snapshot === lastPersistedSceneSnapshotRef.current) {
      hasPendingLocalSceneSaveRef.current = false
      window.clearTimeout(saveStatusDelayRef.current)
      return
    }
    sceneRef.current = payload
    window.clearTimeout(saveStatusDelayRef.current)
    saveStatusDelayRef.current = window.setTimeout(() => {
      if (saveRequestIdRef.current === requestId) {
        setSaveStatus('saving')
      }
    }, SAVE_STATUS_PENDING_DELAY_MS)
    try {
      await postJson(SCENE_ENDPOINT, payload, {
        headers: { 'x-codex-excalidraw-client-id': clientIdRef.current }
      })
      if (saveRequestIdRef.current !== requestId) return
      hasPendingLocalSceneSaveRef.current = false
      lastPersistedSceneSnapshotRef.current = snapshot
      window.clearTimeout(saveStatusDelayRef.current)
      const savedAt = new Date().toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US')
      setLastSavedAt(savedAt)
      setSaveStatus('saved')
    } catch (error) {
      if (saveRequestIdRef.current !== requestId) return
      hasPendingLocalSceneSaveRef.current = false
      window.clearTimeout(saveStatusDelayRef.current)
      console.error(error)
      setSaveStatus('error')
    }
  }, [language])

  const scheduleSave = useCallback(
    (elements, appState, files) => {
      const payload = toScenePayload(elements, appState, files)
      if (sceneSnapshot(payload) === lastPersistedSceneSnapshotRef.current) {
        hasPendingLocalSceneSaveRef.current = false
        window.clearTimeout(saveTimerRef.current)
        return
      }
      hasPendingLocalSceneSaveRef.current = true
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveScene(payload.elements, payload.appState, payload.files)
      }, SAVE_DEBOUNCE_MS)
    },
    [saveScene]
  )

  const syncSelection = useCallback(async (elements, appState) => {
    const selectedElements = selectedElementsFromAppState(elements, appState)
    const selectionState = JSON.stringify(selectedElements)
    if (selectionState === lastSelectionStateRef.current) return
    lastSelectionStateRef.current = selectionState
    setSelection(selectedElements)
    try {
      await postJson(SELECTION_ENDPOINT, {
        selectedElementIds: selectedElements.map((element) => element.id),
        selectedElements,
        updatedAt: new Date().toISOString()
      })
    } catch (error) {
      console.error(error)
    }
  }, [])

  const handleExcalidrawApi = useCallback((apiInstance) => {
    apiRef.current = apiInstance
    setApiReady(true)
  }, [])

  const excalidrawTheme = useMemo(() => appThemeForExcalidraw(theme), [theme])

  const excalidrawUiOptions = useMemo(
    () => ({
      canvasActions: {
        export: false,
        loadScene: false,
        saveAsImage: false,
        saveToActiveFile: false,
        toggleTheme: true
      },
      tools: {
        image: true
      }
    }),
    []
  )

  const handleChange = useCallback(
    (elements, appState, files) => {
      if (isRemoteApplyingRef.current) return
      const nextTheme = localThemeFromExcalidraw(appState?.theme)
      if (nextTheme && nextTheme !== theme) {
        if (pendingControlledThemeRef.current && pendingControlledThemeRef.current !== nextTheme) {
          // Ignore stale theme echoes while the controlled prop is applying.
        } else {
          pendingControlledThemeRef.current = null
          setTheme(nextTheme)
        }
      } else if (nextTheme === theme) {
        pendingControlledThemeRef.current = null
      }
      scheduleSave(elements, appState, files)
      syncSelection(elements, appState)
    },
    [scheduleSave, syncSelection, theme]
  )

  const completeNativeElementRequest = useCallback(async (requestId, payload) => {
    const response = await fetch(`${NATIVE_ELEMENTS_ENDPOINT}/${encodeURIComponent(requestId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    return response.json()
  }, [])

  const completeViewportRequest = useCallback(async (requestId, payload) => {
    const response = await fetch(`${VIEWPORT_ENDPOINT}/${encodeURIComponent(requestId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    return response.json()
  }, [])

  const completeVisualValidationRequest = useCallback(async (requestId, payload) => {
    const response = await fetch(`${VISUAL_VALIDATION_ENDPOINT}/${encodeURIComponent(requestId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    return response.json()
  }, [])

  const processNativeElementRequests = useCallback(async () => {
    if (!apiReady || !apiRef.current || isNativeElementRequestRunningRef.current) return
    isNativeElementRequestRunningRef.current = true
    try {
      const response = await fetch(NATIVE_ELEMENTS_ENDPOINT)
      if (!response.ok) return
      const payload = await response.json()
      const requests = Array.isArray(payload.requests) ? payload.requests : []
      for (const request of requests) {
        const requestId = nonEmptyString(request.id)
        if (!requestId) continue
        try {
          const batchId = nonEmptyString(request.batchId) ?? makeId('native_batch')
          const rawSpecs = Array.isArray(request.elements) ? request.elements : []
          const layout = normalizeElementSpecsForLayout(rawSpecs, { mode: 'native-browser' })
          const skeletons = layout.elements.map((spec) =>
            nativeSkeletonFromSpec(spec, batchId)
          )
          const textSkeletonsBySemanticId = nativeTextSkeletonOverridesBySemanticId(skeletons)
          const convertedElements = applyNativeTextSkeletonOverrides(
            convertToExcalidrawElements(skeletons, { regenerateIds: false }),
            textSkeletonsBySemanticId
          )
          const qualityReport = qualityReportForElements(convertedElements, { layoutValidation: layout.report })
          const rendering = renderingOptionsFromRequest(request, convertedElements.length)
          const localElements = apiRef.current.getSceneElements()
          const localAppState = apiRef.current.getAppState()
          const localFiles = apiRef.current.getFiles()
          let nextElements = localElements

          isRemoteApplyingRef.current = true
          if (convertedElements.length > 0 && rendering.mode === 'progressive') {
            apiRef.current.setToast({
              message: t.drawingProgress,
              duration: Math.max(1200, rendering.stepDelayMs * Math.min(convertedElements.length, rendering.maxSteps))
            })
            const groups = groupElementsForProgressiveReveal(convertedElements, rendering.maxSteps)
            for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
              nextElements = reindexSceneElements([...nextElements, ...groups[groupIndex]])
              apiRef.current.updateScene({
                elements: nextElements,
                captureUpdate: groupIndex === groups.length - 1 ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER
              })
              if (rendering.stepDelayMs > 0 && groupIndex < groups.length - 1) {
                await delay(rendering.stepDelayMs)
              }
            }
          } else if (convertedElements.length > 0) {
            nextElements = reindexSceneElements([...localElements, ...convertedElements])
            apiRef.current.updateScene({
              elements: nextElements,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY
            })
          }

          const nextScene = toScenePayload(nextElements, localAppState, localFiles)
          await saveScene(nextScene.elements, nextScene.appState, nextScene.files)
          sceneRef.current = nextScene

          if (convertedElements.length > 0) {
            apiRef.current.scrollToContent(convertedElements, {
              fitToViewport: true,
              viewportZoomFactor: 0.72,
              animate: true,
              duration: 260
            })
            apiRef.current.setToast({
              message: t.canvasUpdated,
              duration: 2400
            })
          }

          await completeNativeElementRequest(requestId, {
            status: 'completed',
            result: {
              batchId,
              insertedElementIds: convertedElements.map((element) => element.id),
              insertedElementTypes: convertedElements.map((element) => element.type),
              layoutValidation: layout.report,
              qualityReport,
              rendering
            }
          })
        } catch (error) {
          console.error(error)
          await completeNativeElementRequest(requestId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
          })
        } finally {
          window.setTimeout(() => {
            isRemoteApplyingRef.current = false
          }, 0)
        }
      }
    } finally {
      isNativeElementRequestRunningRef.current = false
    }
  }, [apiReady, completeNativeElementRequest, saveScene, t])

  const processVisualValidationRequests = useCallback(async () => {
    if (!apiReady || !apiRef.current || isVisualValidationRequestRunningRef.current) return
    isVisualValidationRequestRunningRef.current = true
    try {
      const response = await fetch(VISUAL_VALIDATION_ENDPOINT)
      if (!response.ok) return
      const payload = await response.json()
      const requests = Array.isArray(payload.requests) ? payload.requests : []
      for (const request of requests) {
        const requestId = nonEmptyString(request.id)
        if (!requestId) continue
        try {
          const localElements = apiRef.current.getSceneElements()
          const localAppState = apiRef.current.getAppState()
          const localFiles = apiRef.current.getFiles()
          const scene = toScenePayload(localElements, localAppState, localFiles)
          await saveScene(scene.elements, scene.appState, scene.files)
          const elements = elementsForVisualValidation(scene.elements, request.elementIds)
          const qualityReport = qualityReportForElements(elements)
          const svg = await exportToSvg({
            elements,
            appState: {
              ...scene.appState,
              exportBackground: true,
              viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#fbfbfa'
            },
            files: scene.files,
            exportPadding: 24
          })
          const fileName = visualValidationFileName(request)
          const result = await saveExport(fileName, svg.outerHTML)
          await completeVisualValidationRequest(requestId, {
            status: 'completed',
            result: {
              renderer: 'excalidraw-exportToSvg',
              fileName,
              filePath: result.filePath,
              relativePath: result.relativePath,
              elementCount: elements.length,
              batchId: request.batchId ?? null,
              qualityReport
            }
          })
        } catch (error) {
          console.error(error)
          await completeVisualValidationRequest(requestId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } finally {
      isVisualValidationRequestRunningRef.current = false
    }
  }, [apiReady, completeVisualValidationRequest, saveScene])

  const processViewportRequests = useCallback(async () => {
    if (!apiReady || !apiRef.current || isViewportRequestRunningRef.current) return
    isViewportRequestRunningRef.current = true
    try {
      const response = await fetch(VIEWPORT_ENDPOINT)
      if (!response.ok) return
      const payload = await response.json()
      const requests = Array.isArray(payload.requests) ? payload.requests : []
      for (const request of requests) {
        const requestId = nonEmptyString(request.id)
        if (!requestId) continue
        try {
          const focusElement = viewportFocusElement(request.viewport)
          if (!focusElement) throw new Error('Viewport request is missing a valid scene rectangle.')
          apiRef.current.scrollToContent([focusElement], {
            fitToViewport: true,
            viewportZoomFactor: 0.86,
            animate: true,
            duration: 320
          })
          apiRef.current.setToast({
            message: nonEmptyString(request.message) ?? t.canvasFocused,
            duration: 2200
          })
          await completeViewportRequest(requestId, { status: 'completed' })
        } catch (error) {
          console.error(error)
          await completeViewportRequest(requestId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } finally {
      isViewportRequestRunningRef.current = false
    }
  }, [apiReady, completeViewportRequest, t])

  useEffect(() => {
    if (!apiReady || !apiRef.current || !('EventSource' in window)) return undefined
    const events = new EventSource(SCENE_EVENTS_ENDPOINT)
    const refreshScene = async (event) => {
      try {
        let eventPayload = null
        try {
          eventPayload = event?.data ? JSON.parse(event.data) : null
        } catch {
          eventPayload = null
        }
        if (eventPayload?.originClientId === clientIdRef.current) return
        if (hasPendingLocalSceneSaveRef.current) return

        const response = await fetch(SCENE_ENDPOINT)
        if (!response.ok) return
        const payload = await response.json()
        if (!isScene(payload.scene)) return
        const localElements = apiRef.current.getSceneElements()
        const localScene = toScenePayload(localElements, apiRef.current.getAppState(), apiRef.current.getFiles())
        const incomingSnapshot = sceneSnapshot(payload.scene)
        if (sceneSnapshot(localScene) === incomingSnapshot) {
          lastPersistedSceneSnapshotRef.current = incomingSnapshot
          return
        }
        const changedElements = changedVisibleElements(localElements, payload.scene.elements)
        const changedImages = changedElements.filter((element) => element.type === 'image')

        isRemoteApplyingRef.current = true
        const incomingFiles = Object.values(payload.scene.files ?? {})
        if (incomingFiles.length > 0) {
          apiRef.current.addFiles(incomingFiles)
        }
        apiRef.current.updateScene({
          elements: payload.scene.elements,
          appState: appStateForExcalidraw(payload.scene.appState),
          captureUpdate: CaptureUpdateAction.NEVER
        })
        if (changedImages.length > 0) {
          apiRef.current.setActiveTool({ type: 'selection' })
        }
        sceneRef.current = payload.scene
        lastPersistedSceneSnapshotRef.current = incomingSnapshot
        if (changedElements.length > 0) {
          apiRef.current.scrollToContent(changedElements, {
            fitToViewport: true,
            viewportZoomFactor: 0.72,
            animate: true,
            duration: 260
          })
          apiRef.current.setToast({
            message: t.canvasUpdated,
            duration: 2400
          })
        }
        window.setTimeout(() => {
          isRemoteApplyingRef.current = false
        }, 0)
      } catch (error) {
        isRemoteApplyingRef.current = false
        console.error(error)
      }
    }
    const refreshComments = async () => {
      try {
        const response = await fetch(COMMENTS_ENDPOINT)
        if (!response.ok) return
        const payload = await response.json()
        setComments(payload.comments?.comments ?? [])
      } catch (error) {
        console.error(error)
      }
    }
    const refreshActions = async () => {
      try {
        const response = await fetch(ACTIONS_ENDPOINT)
        if (!response.ok) return
        const payload = await response.json()
        setActions(payload.actions?.actions ?? [])
      } catch (error) {
        console.error(error)
      }
    }
    const refreshExecutorRuns = async () => {
      try {
        const response = await fetch(EXECUTOR_RUNS_ENDPOINT)
        if (!response.ok) return
        const payload = await response.json()
        setExecutorRuns(payload.runs?.runs ?? [])
      } catch (error) {
        console.error(error)
      }
    }
    const refreshExecutors = async () => {
      try {
        const response = await fetch(EXECUTORS_ENDPOINT)
        if (!response.ok) return
        const payload = await response.json()
        setExecutorState({
          config: payload.config ?? null,
          executors: payload.executors ?? [],
          selectedExecutorId: payload.selectedExecutorId ?? null
        })
      } catch (error) {
        console.error(error)
      }
    }
    events.addEventListener('scene-changed', refreshScene)
    events.addEventListener('comments-changed', refreshComments)
    events.addEventListener('actions-changed', refreshActions)
    events.addEventListener('executor-runs-changed', refreshExecutorRuns)
    events.addEventListener('executor-config-changed', refreshExecutors)
    events.addEventListener('native-elements-requested', processNativeElementRequests)
    events.addEventListener('viewport-requested', processViewportRequests)
    events.addEventListener('visual-validation-requested', processVisualValidationRequests)
    events.addEventListener('session-changed', () => {
      loadWorkspaceState().catch((error) => {
        console.error(error)
      })
    })
    return () => events.close()
  }, [apiReady, loadWorkspaceState, processNativeElementRequests, processViewportRequests, processVisualValidationRequests, t])

  useEffect(() => {
    processNativeElementRequests().catch((error) => {
      console.error(error)
    })
  }, [processNativeElementRequests])

  useEffect(() => {
    processViewportRequests().catch((error) => {
      console.error(error)
    })
  }, [processViewportRequests])

  useEffect(() => {
    processVisualValidationRequests().catch((error) => {
      console.error(error)
    })
  }, [processVisualValidationRequests])

  useEffect(() => {
    if (!apiReady) return undefined
    const intervalId = window.setInterval(() => {
      processNativeElementRequests().catch((error) => {
        console.error(error)
      })
      processViewportRequests().catch((error) => {
        console.error(error)
      })
      processVisualValidationRequests().catch((error) => {
        console.error(error)
      })
    }, 1500)
    return () => window.clearInterval(intervalId)
  }, [apiReady, processNativeElementRequests, processViewportRequests, processVisualValidationRequests])

  const canUseCanvas = apiReady
  const currentProjectLabel = session?.projectDir ?? t.noProjectSelected

  const selectionSummary = useMemo(() => {
    if (selection.length === 0) return t.noSelection
    if (selection.length === 1) return `${selection[0].type} · ${selection[0].id}`
    return t.manySelected(selection.length)
  }, [selection, t])

  const actionsByCommentId = useMemo(() => {
    const map = new Map()
    for (const action of actions) {
      if (!action.commentId || map.has(action.commentId)) continue
      map.set(action.commentId, action)
    }
    return map
  }, [actions])

  const executorRunsByActionId = useMemo(() => {
    const map = new Map()
    for (const run of executorRuns) {
      if (!run.actionId || map.has(run.actionId)) continue
      map.set(run.actionId, run)
    }
    return map
  }, [executorRuns])

  const executorConfig = executorState.config ?? { defaultExecutorId: 'codex-cli', runMode: 'local', model: null }
  const selectedExecutor = useMemo(
    () => executorState.executors.find((executor) => executor.id === executorConfig.defaultExecutorId) ?? executorState.executors.find((executor) => executor.available) ?? null,
    [executorConfig.defaultExecutorId, executorState.executors]
  )
  const canRunLocalExecutor = executorConfig.runMode !== 'copy' && selectedExecutor?.available === true

  const switchProject = useCallback(
    async (projectDir) => {
      const nextProjectDir = projectDir.trim()
      if (!nextProjectDir) return
      setProjectMessage(t.switchingProject)
      setApiReady(false)
      setInitialData(null)
      try {
        const response = await fetch(SESSION_ENDPOINT, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectDir: nextProjectDir })
        })
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        await loadWorkspaceState()
        setProjectMessage(t.projectLoaded)
        setIsProjectMenuOpen(false)
      } catch (error) {
        console.error(error)
        setProjectMessage(`${t.projectSwitchFailed}: ${error.message}`)
      }
    },
    [loadWorkspaceState, t]
  )

  const refreshWorkspace = useCallback(async () => {
    setProjectMessage(t.refreshingProject)
    try {
      await loadWorkspaceState()
      setProjectMessage(t.projectRefreshed)
    } catch (error) {
      console.error(error)
      setProjectMessage(`${t.refreshFailed}: ${error.message}`)
    }
  }, [loadWorkspaceState, t])

  const copyCurrentProjectPath = useCallback(async () => {
    if (!session?.projectDir) return
    try {
      const copied = await copyTextToClipboard(session.projectDir)
      setProjectMessage(copied ? t.projectPathCopied : t.projectPathCopyFailed)
    } catch (error) {
      console.error(error)
      setProjectMessage(`${t.projectPathCopyFailed}: ${error.message}`)
    }
  }, [session?.projectDir, t])

  const stopLocalCanvas = useCallback(async () => {
    if (isStoppingCanvas) return
    setIsStoppingCanvas(true)
    setStopCanvasMessage(t.stoppingLocalCanvas)
    try {
      await postJson(SESSION_STOP_ENDPOINT, {}, { method: 'POST' })
      setStopCanvasMessage(t.localCanvasStopping)
    } catch (error) {
      console.error(error)
      setStopCanvasMessage(`${t.localCanvasStopFailed}: ${error.message}`)
      setIsStoppingCanvas(false)
    }
  }, [isStoppingCanvas, t])

  const scanExecutors = useCallback(async () => {
    setIsScanningExecutors(true)
    setExecutorMessage(t.executorScanning)
    try {
      const payload = await postJson(`${EXECUTORS_ENDPOINT}/scan`, {}, {
        method: 'POST',
        headers: executorHeaders(session)
      })
      setExecutorState({
        config: payload.config ?? null,
        executors: payload.executors ?? [],
        selectedExecutorId: payload.selectedExecutorId ?? null
      })
      setExecutorMessage('')
    } catch (error) {
      console.error(error)
      setExecutorMessage(`${t.executorScanFailed}: ${error.message}`)
    } finally {
      setIsScanningExecutors(false)
    }
  }, [session, t])

  const updateExecutorConfig = useCallback(
    async (patch) => {
      const nextConfig = { ...executorConfig, ...patch }
      setExecutorState((current) => ({ ...current, config: nextConfig }))
      try {
        const payload = await postJson(EXECUTORS_ENDPOINT, nextConfig, {
          method: 'PUT',
          headers: executorHeaders(session)
        })
        setExecutorState((current) => ({ ...current, config: payload.config ?? nextConfig }))
      } catch (error) {
        console.error(error)
        setExecutorMessage(error.message)
      }
    },
    [executorConfig, session]
  )

  useEffect(() => {
    setExecutorModelDraft(executorConfig.model ?? '')
  }, [executorConfig.model])

  const setControlledTheme = useCallback((nextTheme) => {
    pendingControlledThemeRef.current = nextTheme
    setTheme(nextTheme)
  }, [])

  const saveExcalidrawFile = useCallback(async () => {
    if (!apiRef.current) return
    const scene = toScenePayload(apiRef.current.getSceneElements(), apiRef.current.getAppState(), apiRef.current.getFiles())
    await saveScene(scene.elements, scene.appState, scene.files)
    const fileName = `codex-excalidraw-${nowStamp()}.excalidraw`
    const text = `${serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')}\n`
    const result = await saveExport(fileName, text)
    downloadBlob(new Blob([text], { type: 'application/json' }), fileName)
    setExportMessage(t.savedPath(result.relativePath))
  }, [saveScene, t])

  const exportJson = useCallback(async () => {
    if (!apiRef.current) return
    const scene = toScenePayload(apiRef.current.getSceneElements(), apiRef.current.getAppState(), apiRef.current.getFiles())
    const fileName = `codex-excalidraw-${nowStamp()}.json`
    const text = `${serializeAsJSON(scene.elements, scene.appState, scene.files, 'database')}\n`
    const result = await saveExport(fileName, text)
    downloadBlob(new Blob([text], { type: 'application/json' }), fileName)
    setExportMessage(t.exportedPath(result.relativePath))
  }, [t])

  const exportPng = useCallback(async () => {
    if (!apiRef.current) return
    const elements = apiRef.current.getSceneElements()
    const appState = apiRef.current.getAppState()
    const files = apiRef.current.getFiles()
    const blob = await exportToBlob({
      elements,
      appState: {
        ...appState,
        exportBackground: true,
        viewBackgroundColor: appState.viewBackgroundColor ?? '#fbfbfa'
      },
      files,
      mimeType: 'image/png',
      exportPadding: 24
    })
    const fileName = `codex-excalidraw-${nowStamp()}.png`
    const result = await saveExport(fileName, await blobToBase64(blob), 'base64')
    downloadBlob(blob, fileName)
    setExportMessage(t.exportedPath(result.relativePath))
  }, [t])

  const exportSvg = useCallback(async () => {
    if (!apiRef.current) return
    const elements = apiRef.current.getSceneElements()
    const appState = apiRef.current.getAppState()
    const files = apiRef.current.getFiles()
    const svg = await exportToSvg({
      elements,
      appState: {
        ...appState,
        exportBackground: true,
        viewBackgroundColor: appState.viewBackgroundColor ?? '#fbfbfa'
      },
      files,
      exportPadding: 24
    })
    const fileName = `codex-excalidraw-${nowStamp()}.svg`
    const text = svg.outerHTML
    const result = await saveExport(fileName, text)
    downloadBlob(new Blob([text], { type: 'image/svg+xml' }), fileName)
    setExportMessage(t.exportedPath(result.relativePath))
  }, [t])

  const createDraftComment = useCallback(async () => {
    const body = commentDraft.trim()
    if (!body || selection.length === 0) return null
    const targetElementIds = uniqueNonEmptyStrings(selection.map((element) => element.id))
    if (targetElementIds.length === 0) return null
    setCommentMessage(t.savingComment)
    const nextComment = {
      id: makeId('comment'),
      targetElementIds,
      body,
      status: 'open',
      createdBy: 'user',
      createdAt: new Date().toISOString(),
      resolvedAt: null
    }
    const nextComments = [nextComment, ...comments]
    setComments(nextComments)
    setCommentDraft('')
    try {
      await postJson(COMMENTS_ENDPOINT, { version: 1, comments: nextComments })
      setCommentMessage(t.savedComment(nextComment.id, targetElementIds.length))
      return nextComment
    } catch (error) {
      console.error(error)
      setComments(comments)
      setCommentDraft(body)
      setCommentMessage(`${t.commentSaveFailed}: ${error.message}`)
      return null
    }
  }, [commentDraft, comments, selection, t])

  const resolveComment = useCallback(
    async (commentId) => {
      const nextComments = comments.map((comment) =>
        comment.id === commentId
          ? { ...comment, status: 'resolved', resolvedAt: new Date().toISOString() }
          : comment
      )
      setComments(nextComments)
      setCommentMessage(t.resolvingComment)
      try {
        await postJson(COMMENTS_ENDPOINT, { version: 1, comments: nextComments })
        setCommentMessage(t.resolvedComment(commentId))
      } catch (error) {
        console.error(error)
        setCommentMessage(`${t.resolveFailed}: ${error.message}`)
      }
    },
    [comments, t]
  )

  const deleteComment = useCallback(
    async (commentId) => {
      const runningAction = actions.find((action) => action.commentId === commentId && action.status === 'running')
      if (runningAction) {
        setCommentMessage(t.deleteCommentBlocked)
        return
      }

      const nextComments = comments.filter((comment) => comment.id !== commentId)
      const nextActions = actions.filter((action) => action.commentId !== commentId)
      setComments(nextComments)
      setActions(nextActions)
      setCommentMessage(t.deletingComment)
      try {
        const writes = [postJson(COMMENTS_ENDPOINT, { version: 1, comments: nextComments })]
        if (nextActions.length !== actions.length) {
          writes.push(postJson(ACTIONS_ENDPOINT, { version: 1, actions: nextActions }))
        }
        await Promise.all(writes)
        setCommentMessage(t.deletedComment(commentId))
      } catch (error) {
        console.error(error)
        setComments(comments)
        setActions(actions)
        setCommentMessage(`${t.deleteFailed}: ${error.message}`)
      }
    },
    [actions, comments, t]
  )

  const runCommentWithCodex = useCallback(
    async (comment) => {
      const existingAction = actions.find(
        (action) => action.commentId === comment.id && (action.status === 'queued' || action.status === 'running')
      )
      const actionToCopy =
        existingAction ??
        (() => {
          const scene = apiRef.current
            ? toScenePayload(apiRef.current.getSceneElements(), apiRef.current.getAppState(), apiRef.current.getFiles())
            : sceneRef.current
          const targetElementIds = uniqueNonEmptyStrings(comment.targetElementIds)
          return {
            id: makeId('action'),
            type: 'comment',
            status: 'queued',
            commentId: comment.id,
            targetElementIds,
            instruction: comment.body,
            source: 'canvas-comment',
            projectDir: session?.projectDir ?? null,
            canvasDir: session?.canvasDir ?? null,
            sceneFingerprint: sceneFingerprint(scene),
            selectionSnapshot: selectedSnapshotFromIds(scene, targetElementIds),
            createdBy: 'user',
            claimedBy: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            result: null,
            error: null
          }
        })()

      let nextActions = actions
      if (!existingAction) {
        nextActions = [actionToCopy, ...actions]
        setActions(nextActions)
        setCommentMessage(t.queueingAction)
        try {
          await postJson(ACTIONS_ENDPOINT, { version: 1, actions: nextActions })
        } catch (error) {
          console.error(error)
          setActions(actions)
          setCommentMessage(`${t.actionQueueFailed}: ${error.message}`)
          return
        }
      }

      const command = actionCommand(actionToCopy, language)
      if (canRunLocalExecutor) {
        setCommentMessage(t.queueingAction)
        try {
          const payload = await postJson(EXECUTOR_RUNS_ENDPOINT, {
            actionId: actionToCopy.id,
            executorId: executorConfig.defaultExecutorId
          }, {
            method: 'POST',
            headers: executorHeaders(session)
          })
          setExecutorRuns((current) => [payload.run, ...current.filter((run) => run.id !== payload.run.id)])
          setCommentMessage(t.executorRunStarted(payload.run.id))
          return
        } catch (error) {
          console.error(error)
          setCommentMessage(`${t.executorRunFailed}: ${error.message}`)
        }
      }

      try {
        await navigator.clipboard.writeText(command)
        setCommentMessage(canRunLocalExecutor ? `${t.executorRunFailed}. ${t.copiedCommand(actionToCopy.id)}` : existingAction ? t.copiedExistingAction(actionToCopy.id) : t.queuedAction(actionToCopy.id))
      } catch (error) {
        console.error(error)
        setCommentMessage(command)
      }
    },
    [actions, canRunLocalExecutor, executorConfig.defaultExecutorId, language, session, t]
  )

  const cancelExecutorRun = useCallback(
    async (runId) => {
      try {
        const payload = await postJson(`${EXECUTOR_RUNS_ENDPOINT}/${encodeURIComponent(runId)}/cancel`, {}, {
          method: 'POST',
          headers: executorHeaders(session)
        })
        setExecutorRuns((current) => [payload.run, ...current.filter((run) => run.id !== payload.run.id)])
        setCommentMessage(t.runCanceled)
      } catch (error) {
        console.error(error)
        setCommentMessage(error.message)
      }
    },
    [session, t]
  )

  const copyCommentCommand = useCallback(
    async (comment) => {
      const command =
        language === 'en'
          ? `Execute Excalidraw comment ${comment.id}. Only modify its targetElementIds, then resolve this comment.`
          : `执行 Excalidraw comment ${comment.id}，只处理它的 targetElementIds。完成后 resolve 这个 comment。`
      try {
        await navigator.clipboard.writeText(command)
        setCommentMessage(t.copiedCommand(comment.id))
      } catch (error) {
        console.error(error)
        setCommentMessage(command)
      }
    },
    [language, t]
  )

  const runDraftCommentWithCodex = useCallback(async () => {
    const comment = await createDraftComment()
    if (!comment) return
    await runCommentWithCodex(comment)
  }, [createDraftComment, runCommentWithCodex])

  const copyDraftCommentCommand = useCallback(async () => {
    const comment = await createDraftComment()
    if (!comment) return
    await copyCommentCommand(comment)
  }, [copyCommentCommand, createDraftComment])

  const startPanelResize = useCallback(
    (event) => {
      if (isSidePanelCollapsed) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidePanelWidth
      const handlePointerMove = (moveEvent) => {
        const nextWidth = clamp(startWidth + startX - moveEvent.clientX, SIDE_PANEL_MIN_WIDTH, maxSidePanelWidth())
        setSidePanelWidth(nextWidth)
      }
      const stopResize = () => {
        document.body.classList.remove('is-resizing-panel')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', stopResize)
      }

      document.body.classList.add('is-resizing-panel')
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', stopResize)
    },
    [isSidePanelCollapsed, sidePanelWidth]
  )

  const exportOptions = useMemo(
    () => [
      { id: 'png', tag: t.exportPng, description: t.exportPngDesc, action: exportPng },
      { id: 'svg', tag: t.exportSvg, description: t.exportSvgDesc, action: exportSvg },
      { id: 'json', tag: t.exportJson, description: t.exportJsonDesc, action: exportJson },
      { id: 'excalidraw', tag: '.exc', description: t.exportExcalidrawDesc, action: saveExcalidrawFile }
    ],
    [exportJson, exportPng, exportSvg, saveExcalidrawFile, t]
  )
  const openCommentsCount = comments.filter((comment) => comment.status === 'open').length
  const hasCollapsedComments = comments.length > COMMENT_COLLAPSE_LIMIT
  const visibleComments =
    hasCollapsedComments && !areCommentsExpanded ? comments.slice(0, COMMENT_COLLAPSE_LIMIT) : comments
  const hiddenCommentCount = Math.max(0, comments.length - visibleComments.length)

  if (loadError) {
    return (
      <main className="app-status" data-testid="app-status">
        <PencilRuler aria-hidden="true" size={28} />
        <strong>{t.loadFailed}</strong>
        <span>{loadError.message}</span>
      </main>
    )
  }

  if (!initialData) {
    return (
      <main className="app-status" data-testid="app-status">
        <PencilRuler aria-hidden="true" size={28} />
        <strong>{t.loading}</strong>
      </main>
    )
  }

  return (
    <main className={`app-shell app-shell--${theme}`} data-testid="app-shell" style={{ '--side-panel-width': `${sidePanelWidth}px` }}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <PencilRuler aria-hidden="true" size={15} strokeWidth={2.2} />
          </div>
          <div className="brand-copy">
            <h1>{t.appTitle}</h1>
            <div className="project-menu" ref={projectMenuRef}>
              <button
                aria-expanded={isProjectMenuOpen}
                className={`project-menu-trigger${isProjectMenuOpen ? ' project-menu-trigger--open' : ''}`}
                data-testid="project-menu-trigger"
                onClick={() => {
                  setIsExportMenuOpen(false)
                  setIsSettingsOpen(false)
                  setIsProjectMenuOpen((value) => !value)
                }}
                title={currentProjectLabel}
                type="button"
              >
                <FolderOpen aria-hidden="true" size={12} />
                <span>{currentProjectLabel}</span>
                <ChevronDown aria-hidden="true" size={12} />
              </button>
              {isProjectMenuOpen ? (
                <div className="project-dropdown" data-testid="project-dropdown" role="dialog" aria-label={t.projectSession}>
                  <div className="project-dropdown-header">
                    <div className="project-current-copy">
                      <div className="project-current-text">
                        <strong>{t.currentProject}</strong>
                        <span title={currentProjectLabel}>{currentProjectLabel}</span>
                      </div>
                      <button
                        aria-label={t.copyProjectPath}
                        className="project-copy-button"
                        data-testid="project-copy-path-button"
                        disabled={!session?.projectDir}
                        onClick={copyCurrentProjectPath}
                        title={t.copyProjectPath}
                        type="button"
                      >
                        <Copy aria-hidden="true" size={16} />
                      </button>
                    </div>
                  </div>
                  <select
                    className="project-select"
                    data-testid="project-select"
                    onChange={(event) => {
                      const value = event.target.value
                      if (value) switchProject(value)
                    }}
                    value={session?.projectDir ?? ''}
                  >
                    <option value="">{t.recentProjects}</option>
                    {projects.map((project) => (
                      <option key={project.projectDir} value={project.projectDir}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="project-input"
                    data-testid="project-input"
                    onChange={(event) => setProjectDraft(event.target.value)}
                    placeholder={t.projectPathPlaceholder}
                    type="text"
                    value={projectDraft}
                  />
                  <div className="project-actions">
                    <ToolbarButton disabled={!projectDraft.trim()} icon={FolderOpen} onClick={() => switchProject(projectDraft)} testId="project-open-button" variant="primary">
                      {t.open}
                    </ToolbarButton>
                    <ToolbarButton icon={RefreshCw} onClick={refreshWorkspace} testId="project-refresh-button">
                      {t.refresh}
                    </ToolbarButton>
                  </div>
                  {projectMessage ? <p className="project-message" data-testid="project-message">{projectMessage}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <StatusPill labels={t} savedAt={lastSavedAt} status={saveStatus} />
          <div className="export-menu" ref={exportMenuRef}>
            <ToolbarButton
              disabled={!canUseCanvas}
              icon={Download}
              onClick={() => {
                setIsProjectMenuOpen(false)
                setIsSettingsOpen(false)
                setIsExportMenuOpen((value) => !value)
              }}
              testId="export-menu-trigger"
              variant="primary"
            >
              {t.export}
              <ChevronDown aria-hidden="true" size={14} />
            </ToolbarButton>
            {isExportMenuOpen ? (
              <div className="export-dropdown" data-testid="export-dropdown" role="menu">
                <strong>{t.exportFormat}</strong>
                {exportOptions.map(({ action, description, id, tag }) => (
                  <button
                    data-testid={`export-option-${id}`}
                    key={id}
                    onClick={() => {
                      setIsExportMenuOpen(false)
                      action()
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="export-dropdown__tag">{tag}</span>
                    <span>{description}</span>
                  </button>
                ))}
                <small>→ canvas/excalidraw/exports/</small>
              </div>
            ) : null}
          </div>
          <button
            aria-expanded={isSettingsOpen}
            aria-label={t.settings}
            className={`topbar-icon-button topbar-icon-button--subtle${isSettingsOpen ? ' topbar-icon-button--open' : ''}`}
            data-testid="settings-button"
            onClick={() => {
              setIsExportMenuOpen(false)
              setIsProjectMenuOpen(false)
              setIsSettingsOpen((value) => !value)
            }}
            title={t.settings}
            type="button"
          >
            <Settings aria-hidden="true" size={17} />
          </button>
          <div className="topbar-divider" />
          <button
            aria-label={isSidePanelCollapsed ? t.expandPanel : t.collapsePanel}
            aria-pressed={!isSidePanelCollapsed}
            className={`topbar-icon-button topbar-panel-toggle${!isSidePanelCollapsed ? ' topbar-icon-button--active' : ''}`}
            data-testid="side-panel-toggle"
            disabled={!canUseCanvas}
            onClick={() => {
              setIsExportMenuOpen(false)
              setIsProjectMenuOpen(false)
              setIsSettingsOpen(false)
              setIsSidePanelCollapsed((value) => !value)
            }}
            title={isSidePanelCollapsed ? t.expandPanel : t.collapsePanel}
            type="button"
          >
            {isSidePanelCollapsed ? <PanelRightOpen aria-hidden="true" size={17} /> : <PanelRightClose aria-hidden="true" size={17} />}
            {openCommentsCount > 0 ? <span>{openCommentsCount}</span> : null}
          </button>
        </div>
      </header>

      <section className={`workspace${isSidePanelCollapsed ? ' workspace--panel-collapsed' : ''}`}>
        <div className="canvas-shell" data-testid="canvas-shell">
          <Excalidraw
            excalidrawAPI={handleExcalidrawApi}
            generateIdForFile={generateIdForFile}
            initialData={initialData}
            key={session?.projectDir ?? scenePath}
            langCode={language === 'zh' ? 'zh-CN' : 'en'}
            name={t.appTitle}
            onChange={handleChange}
            theme={excalidrawTheme}
            UIOptions={excalidrawUiOptions}
          />
        </div>

        {!isSidePanelCollapsed ? (
        <aside className="side-panel" aria-label="Canvas side panel" data-testid="side-panel">
            <button
              aria-label={t.resizePanel}
              className="panel-resizer"
              data-testid="panel-resizer"
              onPointerDown={startPanelResize}
              title={t.resizePanel}
              type="button"
            />

            <>
              <div className="annotation-header">
                <div className="annotation-title">
                  <div>
                    <h2>{t.annotationTitle}</h2>
                    <p className={selection.length > 0 ? 'annotation-subtitle annotation-subtitle--active' : 'annotation-subtitle'}>
                      {selectionSummary}
                    </p>
                  </div>
                </div>
                <div className="annotation-header-actions">
                  <span className="annotation-mode-pill">
                    <Plus aria-hidden="true" size={13} />
                    {t.annotating}
                  </span>
                </div>
              </div>

              <div className="panel-content">
                <section className="annotation-workflow">
                  <div className="workflow-step workflow-step--target">
                    <div className="workflow-step-heading">
                      <span className={`workflow-step-number${selection.length > 0 ? ' workflow-step-number--active' : ''}`}>1</span>
                      <strong>{t.annotationTarget}</strong>
                    </div>

                    {selection.length > 0 ? (
                      <div className="annotation-target annotation-target--ready">
                        <div className="target-summary">
                          <span>{t.annotationTargetReady(selection.length)}</span>
                        </div>
                        <div className="annotation-target-list">
                          {selection.slice(0, 5).map((element) => (
                            <div className="annotation-target-row" key={element.id}>
                              <span>{element.type}</span>
                              <code>{element.id}</code>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="annotation-empty-target">
                        <div className="annotation-target-plus">
                          <Plus aria-hidden="true" size={16} />
                        </div>
                        <strong>{t.annotationTargetEmpty}</strong>
                        <span>{t.annotationTargetHint}</span>
                      </div>
                    )}
                  </div>

                  <div className="workflow-step workflow-step--composer">
                    <div className="workflow-step-heading">
                      <span className={`workflow-step-number${selection.length > 0 ? ' workflow-step-number--active' : ''}`}>2</span>
                      <strong>{t.newComment}</strong>
                    </div>

                    {selection.length > 0 ? (
                      <div className="comment-composer annotation-composer">
                        <div className="comment-composer-head">
                          <span>{t.elementTargets(selection.length)}</span>
                        </div>
                        <textarea
                          className="comment-input"
                          data-testid="comment-input"
                          onChange={(event) => setCommentDraft(event.target.value)}
                          placeholder={t.commentPlaceholder}
                          value={commentDraft}
                        />
                        <div className="comment-composer-actions">
                          <button
                            className="text-button text-button--primary"
                            data-testid="run-draft-comment-button"
                            disabled={!commentDraft.trim()}
                            onClick={runDraftCommentWithCodex}
                            type="button"
                          >
                            <PlayCircle aria-hidden="true" size={13} />
                            <span>{t.runWithCodex}</span>
                          </button>
                          <button
                            className="text-button"
                            data-testid="copy-draft-comment-command-button"
                            disabled={!commentDraft.trim()}
                            onClick={copyDraftCommentCommand}
                            type="button"
                          >
                            {t.copyCommand}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="composer-disabled-hint">
                        <MessageSquarePlus aria-hidden="true" size={15} />
                        <span>{t.selectBeforeComment}</span>
                      </div>
                    )}
                  </div>

                  {commentMessage ? <p className="comment-message" data-testid="comment-message">{commentMessage}</p> : null}

                  <div className="workflow-step workflow-step--comments">
                    <div className="workflow-step-heading workflow-step-heading--comments">
                      <span className="workflow-step-number workflow-step-number--active">3</span>
                      <strong>{t.comments}</strong>
                      <span className="comments-count">{comments.length}</span>
                    </div>

                    <div className="comment-list comment-timeline" data-testid="comment-list">
                      {comments.length === 0 ? <p className="empty-copy">{t.noComments}</p> : null}
                      {visibleComments.map((comment) => {
                        const action = actionsByCommentId.get(comment.id)
                        const executorRun = action ? executorRunsByActionId.get(action.id) : null
                        const latestRunEvent = latestExecutorDisplayEvent(executorRun?.events)
                        const actionStatus = actionStatusText(action, t)
                        const actionIsPending = action?.status === 'queued' || action?.status === 'running'
                        const createdTime = formatCommentTime(comment.createdAt, language)
                        const resolvedTime = formatCommentTime(comment.resolvedAt, language)
                        const timeLabel =
                          comment.status === 'resolved' && resolvedTime ? t.commentResolvedAt(resolvedTime) : t.commentCreatedAt(createdTime)
                        return (
                          <article
                            className={`comment-item annotation-comment comment-item--${comment.status}`}
                            data-comment-id={comment.id}
                            data-testid="comment-item"
                            key={comment.id}
                          >
                            <span aria-hidden="true" className="comment-timeline-dot" />
                            <div className="comment-meta">
                              <div>
                                <strong>{comment.status === 'resolved' ? t.resolvedStatus : t.openStatus}</strong>
                                <span>{t.elementTargets(comment.targetElementIds.length)}</span>
                              </div>
                              {timeLabel ? <time dateTime={comment.resolvedAt ?? comment.createdAt}>{timeLabel}</time> : null}
                            </div>
                            <p>{comment.body}</p>
                            {actionStatus ? (
                              <div className={`action-status action-status--${action.status}`}>
                                <span aria-hidden="true" className={actionIsPending ? 'action-status__spinner' : 'action-status__dot'} />
                                <strong>{actionStatus}</strong>
                                <code>{action.id}</code>
                              </div>
                            ) : null}
                            {executorRun ? (
                              <div className={`executor-run-card executor-run-card--${executorRun.status}`} data-testid="executor-run-card">
                                <div className="executor-run-head">
                                  <span aria-hidden="true" className={executorRun.status === 'running' ? 'action-status__spinner' : 'action-status__dot'} />
                                  <strong>{selectedExecutor?.label ?? executorRun.executorId}</strong>
                                  <code>{executorRun.id}</code>
                                </div>
                                <p>{executorRun.status === 'running' ? t.executorRunningDetail : actionStatusText({ status: executorRun.status }, t)}</p>
                                {latestRunEvent?.message ? (
                                  <div className="executor-run-event">
                                    <span>{t.executorLastEvent}</span>
                                    <strong>{latestRunEvent.message}</strong>
                                  </div>
                                ) : null}
                                {executorRun.status === 'running' ? (
                                  <button className="text-button" data-testid="cancel-executor-run-button" onClick={() => cancelExecutorRun(executorRun.id)} type="button">
                                    <X aria-hidden="true" size={13} />
                                    <span>{t.cancelRun}</span>
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="comment-actions">
                              {comment.status === 'open' ? (
                                <>
                                  <button
                                    className="text-button text-button--primary"
                                    data-testid="run-comment-button"
                                    onClick={() => runCommentWithCodex(comment)}
                                    type="button"
                                  >
                                    <PlayCircle aria-hidden="true" size={13} />
                                    <span>{actionIsPending ? t.copyAction : t.runWithCodex}</span>
                                  </button>
                                  <button className="text-button" data-testid="copy-comment-command-button" onClick={() => copyCommentCommand(comment)} type="button">
                                    {t.copyCommand}
                                  </button>
                                  <button className="text-button" data-testid="resolve-comment-button" onClick={() => resolveComment(comment.id)} type="button">
                                    {t.resolve}
                                  </button>
                                </>
                              ) : null}
                              <button
                                className="text-button text-button--danger"
                                data-testid="delete-comment-button"
                                disabled={action?.status === 'running'}
                                onClick={() => deleteComment(comment.id)}
                                title={action?.status === 'running' ? t.deleteCommentBlocked : t.deleteComment}
                                type="button"
                              >
                                <Trash2 aria-hidden="true" size={13} />
                                <span>{t.deleteComment}</span>
                              </button>
                            </div>
                          </article>
                        )
                      })}
                      {hasCollapsedComments ? (
                        <button className="timeline-toggle" data-testid="comment-timeline-toggle" onClick={() => setAreCommentsExpanded((value) => !value)} type="button">
                          {areCommentsExpanded ? t.showFewerComments : t.showMoreComments(hiddenCommentCount)}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>
              </div>
            </>
        </aside>
        ) : null}
      </section>

      {isSettingsOpen ? (
        <div className="settings-overlay">
          <button aria-label={t.collapsePanel} className="settings-backdrop" data-testid="settings-backdrop" onClick={() => setIsSettingsOpen(false)} type="button" />
          <aside className="settings-drawer" ref={settingsMenuRef} aria-label={t.settings} data-testid="settings-drawer">
            <header className="settings-drawer-header">
              <strong>{t.settings}</strong>
              <button aria-label={t.collapsePanel} className="icon-button" data-testid="settings-close-button" onClick={() => setIsSettingsOpen(false)} type="button">
                <X aria-hidden="true" size={16} />
              </button>
            </header>
            <div className="settings-drawer-body">
              <section className="settings-section">
                <div className="settings-heading">
                  <Languages aria-hidden="true" size={15} />
                  <strong>{t.language}</strong>
                </div>
                <div className="segmented-control">
                  <button className={`segment-option${language === 'zh' ? ' segment-option--active' : ''}`} data-testid="language-zh-button" onClick={() => setLanguage('zh')} type="button">
                    {t.chinese}
                  </button>
                  <button className={`segment-option${language === 'en' ? ' segment-option--active' : ''}`} data-testid="language-en-button" onClick={() => setLanguage('en')} type="button">
                    {t.english}
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-heading">
                  <Sun aria-hidden="true" size={15} />
                  <strong>{t.appearance}</strong>
                </div>
                <div className="segmented-control">
                  <button className={`segment-option${theme === 'light' ? ' segment-option--active' : ''}`} data-testid="theme-light-button" onClick={() => setControlledTheme('light')} type="button">
                    <Sun aria-hidden="true" size={14} />
                    {t.light}
                  </button>
                  <button className={`segment-option${theme === 'dark' ? ' segment-option--active' : ''}`} data-testid="theme-dark-button" onClick={() => setControlledTheme('dark')} type="button">
                    <Moon aria-hidden="true" size={14} />
                    {t.dark}
                  </button>
                </div>
              </section>

              <section className="settings-section" data-testid="runtime-settings-section">
                <div className="settings-heading">
                  <Power aria-hidden="true" size={15} />
                  <strong>{t.runtime}</strong>
                </div>
                <div className="runtime-info">
                  <span>{t.runtimeUrl}</span>
                  <code>{session?.apiBaseUrl ?? window.location.origin}</code>
                  <span>{t.runtimeProject}</span>
                  <code>{session?.projectDir ?? t.noProjectSelected}</code>
                </div>
                <ToolbarButton disabled={isStoppingCanvas} icon={Power} onClick={stopLocalCanvas} testId="stop-local-canvas-button">
                  {isStoppingCanvas ? t.stoppingLocalCanvas : t.stopLocalCanvas}
                </ToolbarButton>
                {stopCanvasMessage ? <p className="executor-message" data-testid="stop-local-canvas-message">{stopCanvasMessage}</p> : null}
              </section>

              <section className="settings-section" data-testid="executor-settings-section">
                <div className="settings-heading">
                  <PlayCircle aria-hidden="true" size={15} />
                  <strong>{t.executor}</strong>
                </div>
                <div className="segmented-control">
                  <button
                    className={`segment-option${executorConfig.runMode !== 'copy' ? ' segment-option--active' : ''}`}
                    data-testid="executor-mode-local-button"
                    onClick={() => updateExecutorConfig({ runMode: 'local' })}
                    type="button"
                  >
                    {t.executorLocal}
                  </button>
                  <button
                    className={`segment-option${executorConfig.runMode === 'copy' ? ' segment-option--active' : ''}`}
                    data-testid="executor-mode-copy-button"
                    onClick={() => updateExecutorConfig({ runMode: 'copy' })}
                    type="button"
                  >
                    {t.executorCopy}
                  </button>
                </div>
                <label className="executor-model-field">
                  <span>{t.executorModel}</span>
                  <input
                    className="executor-model-input"
                    data-testid="executor-model-input"
                    onBlur={() => updateExecutorConfig({ model: executorModelDraft })}
                    onChange={(event) => setExecutorModelDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                    placeholder={t.executorModelPlaceholder}
                    value={executorModelDraft}
                  />
                  <small>{t.executorModelHint}</small>
                </label>
                <div className="executor-list" data-testid="executor-list">
                  {executorState.executors.map((executor) => {
                    const statusLabel = executor.status === 'available'
                      ? t.executorReady
                      : executor.status === 'warning'
                        ? t.executorWarning
                        : t.executorMissing
                    return (
                      <button
                        className={`executor-option${executorConfig.defaultExecutorId === executor.id ? ' executor-option--active' : ''}`}
                        data-testid={`executor-option-${executor.id}`}
                        disabled={!executor.available}
                        key={executor.id}
                        onClick={() => updateExecutorConfig({ defaultExecutorId: executor.id })}
                        type="button"
                      >
                        <span className={`executor-status-dot executor-status-dot--${executor.status}`} />
                        <span>
                          <strong>{executor.label}</strong>
                          <small>{executor.version ?? executor.command ?? executor.id}</small>
                        </span>
                        <em>{statusLabel}</em>
                      </button>
                    )
                  })}
                  {executorState.executors.length === 0 ? <p className="settings-note">{t.executorUnavailable}</p> : null}
                </div>
                <ToolbarButton disabled={isScanningExecutors} icon={RefreshCw} onClick={scanExecutors} testId="executor-scan-button">
                  {isScanningExecutors ? t.executorScanning : t.executorScan}
                </ToolbarButton>
                {executorMessage ? <p className="executor-message" data-testid="executor-message">{executorMessage}</p> : null}
                {!canRunLocalExecutor && executorConfig.runMode !== 'copy' ? <p className="settings-note">{t.executorUnavailable}</p> : null}
              </section>

              <p className="settings-note">{t.settingsMore}</p>
            </div>
          </aside>
        </div>
      ) : null}

    </main>
  )
}
