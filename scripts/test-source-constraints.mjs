import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)

function includesAll(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label} missing token: ${token}`)
  }
}

function assertNoRegexLikeReplace(source, fileName) {
  assert.equal(source.includes('replace('), false, `${fileName} should not use replace() for path, route, or identifier cleanup.`)
  assert.equal(source.includes('RegExp'), false, `${fileName} should not introduce RegExp-based routing or intent handling.`)
}

function sourceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken)
  assert.ok(start >= 0, `Missing start token: ${startToken}`)
  const end = source.indexOf(endToken, start)
  assert.ok(end > start, `Missing end token after ${startToken}: ${endToken}`)
  return source.slice(start, end)
}

async function collectPrivacyScanFiles(dir) {
  const files = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!privacyScanExcludedDirs.has(entry.name)) {
        files.push(...await collectPrivacyScanFiles(entryPath))
      }
      continue
    }

    if (privacyScanExcludedFiles.has(entry.name)) {
      continue
    }

    if (privacyScanExtensions.has(extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}

const appSource = await readFile(join(repoRoot, 'src', 'App.jsx'), 'utf8')
const dataSource = await readFile(join(repoRoot, 'lib', 'excalidraw-data.mjs'), 'utf8')
const diagramsSource = await readFile(join(repoRoot, 'lib', 'excalidraw-diagrams.mjs'), 'utf8')
const layoutSource = await readFile(join(repoRoot, 'lib', 'excalidraw-layout.mjs'), 'utf8')
const mcpSource = await readFile(join(repoRoot, 'mcp', 'server.mjs'), 'utf8')
const viteSource = await readFile(join(repoRoot, 'vite.config.js'), 'utf8')
const executorRuntimeSource = await readFile(join(repoRoot, 'lib', 'executor-runtime.mjs'), 'utf8')
const runtimeBoundariesSource = await readFile(join(repoRoot, 'skills', 'RUNTIME_BOUNDARIES.md'), 'utf8')
const pluginManifest = JSON.parse(await readFile(join(repoRoot, '.codex-plugin', 'plugin.json'), 'utf8'))
const skillNames = [
  'excalidraw-open-canvas',
  'excalidraw-draw',
  'excalidraw-comments',
  'excalidraw-image',
  'excalidraw-export',
  'excalidraw-optimize-sketch'
]
const privacyScanExcludedDirs = new Set([
  '.git',
  'canvas',
  'dist',
  'node_modules',
  'tmp'
])
const privacyScanExcludedFiles = new Set([
  'package-lock.json'
])
const privacyScanExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sh',
  '.svg',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
])
function tokenFromCodes(codes) {
  return String.fromCharCode(...codes)
}

function localPrivacyTokensFromEnv() {
  const value = process.env.CODEX_EXCALIDRAW_PRIVACY_TERMS
  if (!value) return []
  const tokens = []
  for (const line of value.split('\n')) {
    const token = line.trim()
    if (token) tokens.push(token)
  }
  return tokens
}

const privacyDisallowedTokens = [
  tokenFromCodes([47, 85, 115, 101, 114, 115, 47]),
  tokenFromCodes([47, 118, 97, 114, 47, 102, 111, 108, 100, 101, 114, 115]),
  tokenFromCodes([49, 50, 55, 46, 48, 46, 48, 46, 49, 58, 52, 51, 50, 50, 48]),
  ...localPrivacyTokensFromEnv()
]
const skillSources = await Promise.all(
  skillNames.map(async (skillName) => ({
    skillName,
    source: await readFile(join(repoRoot, 'skills', skillName, 'SKILL.md'), 'utf8')
  }))
)

includesAll(
  appSource,
  [
    'THEME',
    'convertToExcalidrawElements',
    'serializeAsJSON',
    'NATIVE_ELEMENTS_ENDPOINT',
    'VIEWPORT_ENDPOINT',
    'VISUAL_VALIDATION_ENDPOINT',
    'SESSION_STOP_ENDPOINT',
    'nativeSkeletonFromSpec',
    'processNativeElementRequests',
    'processViewportRequests',
    'processVisualValidationRequests',
    'stopLocalCanvas',
    'createDraftComment',
    'runDraftCommentWithCodex',
    'copyDraftCommentCommand',
    'run-draft-comment-button',
    'copy-draft-comment-command-button',
    'viewportFocusElement',
    'normalizeElementSpecsForLayout',
    'qualityReportForElements',
    'groupElementsForProgressiveReveal',
    'renderingOptionsFromRequest',
    'drawingProgress',
    'runtime-settings-section',
    'stop-local-canvas-button',
    'theme={excalidrawTheme}',
    'generateIdForFile={generateIdForFile}',
    'toggleTheme: true',
    'image: true',
    'setToast',
    'scrollToContent',
    'hasPendingLocalSceneSaveRef',
    'originClientId',
    'sceneSnapshot(localScene) === incomingSnapshot',
    'CaptureUpdateAction.NEVER',
    'appStateForExcalidraw',
    'pendingControlledThemeRef',
	    'delete nextAppState.theme'
	  ],
  'App Excalidraw native integration'
)

assert.equal(appSource.includes('add-comment-button'), false, 'New comments should expose direct action buttons instead of an extra add-comment step.')

includesAll(
  appSource,
  [
    'uniqueNonEmptyStrings',
    'executorModelDraft',
    'executor-model-input',
    'updateExecutorConfig({ model: executorModelDraft })'
  ],
  'App executor session controls'
)

includesAll(
  dataSource,
  [
    'safeExportPath',
    'stripLeadingDots',
    'timestampForFile',
    'cleanIdPrefix',
    'compactUuid',
    'delete appState.theme',
    'safeAssetFileName',
    'insertImageSpec',
    'sourceAssetPath',
    'assetsDir',
    'normalizeElementForExcalidraw',
    'imageCrop',
    'resolveImageCrop',
    "placement.fit === 'stretch' || placement.fit === 'cover'",
    'crop: placement.crop',
    'uniqueNonEmptyStrings',
    'saveCheckpoint',
    'restoreCheckpoint',
    'splitElementSpecsAndDirectives',
    'cameraUpdate',
    'restoreCheckpoint',
    'layoutValidation'
  ],
  'Data layer boundary helpers'
)

includesAll(
  diagramsSource,
  [
    'layoutDiagram',
    'layoutSequenceDiagram',
    'layoutGraphDiagram',
    'layoutFireworksDiagram',
    'GRAPH_DIAGRAM_KINDS',
    'FIREWORKS_STYLE_PROFILES',
    'GRAPH_LAYOUT_DEFAULTS',
    'fireworks-style',
    'participants',
    'messages',
    'notes',
    'gates',
    'nodes',
    'edges',
    'elk.layout',
    'afterMessageId',
    'seq_participant_',
    'seq_message_',
    'seq_note_',
    'seq_gate_',
    'points'
  ],
  'Structured diagram layout engines'
)

includesAll(
  layoutSource,
  [
    'normalizeElementSpecsForLayout',
    'label-width-overflow-risk',
    'font-size-too-small',
    'low-contrast',
    'element-overlap-risk',
    'overlap-redraw-required',
    'needsRedraw',
    'line-points-absolute-coordinate-risk',
    'line-points-normalized-to-relative',
    'repairOverlaps',
    'contrastRatio',
    'MIN_SHAPE_WIDTH'
  ],
  'Layout validation and repair'
)

includesAll(
  mcpSource,
  [
    'OPEN_CANVAS',
    'open_excalidraw_canvas',
    'startCanvasService',
    'openCanvasTarget',
    'INSERT_IMAGE',
    'insert_excalidraw_image',
    'insert_excalidraw_diagram',
    "'cover'",
    'layoutDiagram',
    'layoutSequenceDiagram',
    'sequenceDiagramSchema',
    'graphDiagramSchema',
    'fireworksDiagramSchema',
    'sourceFormat',
    'fireworks',
    'flowchart',
    'mindmap',
    'participants',
    'messages',
    'notes',
    'gates',
    'insertImageSpec',
    'insertElementsViaNativeApi',
    'read_excalidraw_drawing_guide',
    'save_excalidraw_checkpoint',
    'restore_excalidraw_checkpoint',
    'focus_excalidraw_viewport',
    'DRAWING_GUIDE',
    'cameraUpdate',
    'layoutValidation',
    'qualityReport',
    'qualityReportForElements',
    'rendering',
    '/api/native-elements',
    '/api/viewport',
    '/api/visual-validation',
    'nativeConversion',
    'Visible Excalidraw canvas runtime is required before drawing',
    'visual_validate_excalidraw'
  ],
  'MCP native conversion bridge'
)

const publicCanvasArgsSource = sourceBetween(mcpSource, 'function canvasArgs()', 'function styleSchema()')
assert.equal(publicCanvasArgsSource.includes('preferApi'), false, 'MCP public tool schema must not expose preferApi to normal model calls.')
assert.ok(mcpSource.includes('args.preferApi === false'), 'MCP server should keep preferApi only as an internal test/headless compatibility path.')
assert.ok(mcpSource.includes('call open_excalidraw_canvas first'), 'MCP initialize instructions must tell models to open the live canvas first.')

includesAll(
  viteSource,
  [
    'nativeElementRequests',
    'viewportRequests',
    'visualValidationRequests',
    'createNativeElementRequest',
    'createViewportRequest',
    'createVisualValidationRequest',
    'rendering',
    'native-elements-requested',
    'viewport-requested',
    'visual-validation-requested',
    '/api/native-elements',
    '/api/viewport',
    '/api/visual-validation',
    '/api/session/stop',
    'scheduleLocalCanvasShutdown',
    'isLocalMutationAllowed',
    'sceneForStorage',
    'delete appState.theme',
    'isSafeChildPath',
    'isPathInsideOrSame',
    'serveStaticFile'
  ],
  'Vite native conversion queue'
)

includesAll(
  executorRuntimeSource,
  [
    'createExecutorRuntime',
    'scanExecutors',
    'startActionRun',
    'cancelRun',
	    'CODEX_EXCALIDRAW_EXECUTOR_ADAPTER',
	    'targetElementIds',
	    'executor-runs-changed',
	    'resolveComment',
	    'SESSION_EVENT_TYPES',
	    'sessionIdCandidate',
	    'buildActionContextEnvelope',
	    'willResumeProviderSession',
	    'Structured context envelope',
	    'If the action asks for generated imagery',
	    "'-m'"
	  ],
	  'Executor runtime'
	)

includesAll(
  runtimeBoundariesSource,
  [
    'visible live canvas',
    'file-backed',
    'start-canvas.sh',
    'get_excalidraw_session',
    'switch_excalidraw_project',
    'sourceMode',
    'system default browser',
    'scene.excalidraw',
    'assets/',
    'exports/'
  ],
  'Skill runtime boundaries'
)

includesAll(
  runtimeBoundariesSource,
  [
    'first-turn plugin requests',
    '@codex-excalidraw draw',
    'open_excalidraw_canvas',
    'Do not pass `preferApi: false`'
  ],
  'Visible-first canvas boundary'
)

for (const { skillName, source } of skillSources) {
  includesAll(
    source,
    [
      '../RUNTIME_BOUNDARIES.md'
    ],
    `${skillName} runtime boundary preflight`
  )
}

includesAll(
  skillSources.find(({ skillName }) => skillName === 'excalidraw-open-canvas').source,
  [
    'Creating `scene.excalidraw`',
    'not an opened canvas',
    'system default browser',
    'Browser tool unavailable',
    'first step for any user-visible Excalidraw drawing',
    'Call `open_excalidraw_canvas`'
  ],
  'Open canvas visible workflow boundary'
)

includesAll(
  skillSources.find(({ skillName }) => skillName === 'excalidraw-draw').source,
  [
    'file-backed scene writes',
    'visible live canvas',
    'sourceMode: "file"',
    'degraded',
    'First Action For User-Visible Drawing',
    'Call `open_excalidraw_canvas`',
    'Do not call drawing tools with `preferApi: false`',
    'insert_excalidraw_diagram',
    'participants',
    'messages',
    'notes',
    'gates'
  ],
  'Draw visible workflow boundary'
)

assertNoRegexLikeReplace(appSource, 'src/App.jsx')
assertNoRegexLikeReplace(dataSource, 'lib/excalidraw-data.mjs')
assertNoRegexLikeReplace(diagramsSource, 'lib/excalidraw-diagrams.mjs')
assertNoRegexLikeReplace(mcpSource, 'mcp/server.mjs')
assertNoRegexLikeReplace(viteSource, 'vite.config.js')
assertNoRegexLikeReplace(executorRuntimeSource, 'lib/executor-runtime.mjs')

const privacyScanFiles = await collectPrivacyScanFiles(repoRoot)
for (const filePath of privacyScanFiles) {
  const source = await readFile(filePath, 'utf8')
  const displayPath = relative(repoRoot, filePath)

  for (const token of privacyDisallowedTokens) {
    assert.equal(source.includes(token), false, `${displayPath} contains a private or environment-specific token.`)
  }
}

const defaultPrompts = pluginManifest.interface?.defaultPrompt ?? []
assert.ok(Array.isArray(defaultPrompts), 'Plugin defaultPrompt must be an array.')
assert.ok(defaultPrompts.length <= 3, 'Plugin defaultPrompt must stay within Codex manifest limit.')
for (const prompt of defaultPrompts) {
  assert.equal(typeof prompt, 'string', 'Each plugin defaultPrompt entry must be a string.')
  assert.ok(prompt.length <= 128, `Plugin defaultPrompt entry is too long: ${prompt}`)
}

console.log(JSON.stringify({ ok: true }, null, 2))
