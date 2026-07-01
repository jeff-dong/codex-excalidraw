import ELK from 'elkjs/lib/elk.bundled.js'

const DEFAULT_SEQUENCE_LAYOUT = {
  x: 0,
  y: 0,
  laneGap: 340,
  participantMinWidth: 220,
  participantMaxWidth: 300,
  participantHeight: 88,
  titleFontSize: 30,
  subtitleFontSize: 18,
  messageFontSize: 16,
  noteFontSize: 16,
  gateFontSize: 16,
  rowGap: 92,
  attachmentGap: 18,
  noteMaxWidth: 420,
  gateWidth: 272,
  gateHeight: 96,
  grid: 8
}

const DEFAULT_GRAPH_LAYOUT = {
  x: 0,
  y: 0,
  titleFontSize: 30,
  subtitleFontSize: 18,
  nodeFontSize: 18,
  edgeFontSize: 16,
  minNodeWidth: 170,
  minNodeHeight: 76,
  maxNodeWidth: 340,
  nodeSpacing: 70,
  layerSpacing: 110,
  titleGap: 18,
  canvasPadding: 80,
  graphTopGap: 52,
  grid: 8
}

const PARTICIPANT_COLORS = ['#ecfdf5', '#eff6ff', '#fffbeb', '#f5f3ff', '#fdf2f8', '#f0fdfa']
const MESSAGE_COLORS = ['#10a37f', '#0891b2', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#0f766e']
const GRAPH_NODE_COLORS = ['#ecfdf5', '#eff6ff', '#fffbeb', '#f5f3ff', '#fdf2f8', '#f0fdfa', '#f8fafc']
const GRAPH_EDGE_COLORS = ['#10a37f', '#0891b2', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b']
const GRAPH_DIAGRAM_KINDS = new Set(['flowchart', 'graph', 'class', 'er', 'state', 'mindmap'])
const GRAPH_NODE_SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])
const FIREWORKS_STYLE_PROFILES = {
  1: {
    name: 'Flat Icon',
    background: '#ffffff',
    titleColor: '#111827',
    subtitleColor: '#6b7280',
    textPrimary: '#111827',
    textSecondary: '#6b7280',
    textMuted: '#9ca3af',
    nodeFill: '#ffffff',
    nodeStroke: '#64748b',
    sectionFill: '#ffffff',
    sectionStroke: '#64748b',
    sectionLabel: '#2563eb',
    arrowColors: {
      control: '#7c3aed',
      write: '#10b981',
      read: '#2563eb',
      data: '#f97316',
      async: '#6b7280',
      feedback: '#ef4444',
      neutral: '#6b7280'
    }
  },
  3: {
    name: 'Blueprint',
    background: '#082f49',
    titleColor: '#e0f2fe',
    subtitleColor: '#7dd3fc',
    textPrimary: '#e0f2fe',
    textSecondary: '#bae6fd',
    textMuted: '#7dd3fc',
    nodeFill: '#0b3b5e',
    nodeStroke: '#67e8f9',
    sectionFill: '#082f49',
    sectionStroke: '#0ea5e9',
    sectionLabel: '#67e8f9',
    arrowColors: {
      control: '#67e8f9',
      write: '#22d3ee',
      read: '#38bdf8',
      data: '#fde047',
      async: '#c084fc',
      feedback: '#fb7185',
      neutral: '#bae6fd'
    }
  },
  6: {
    name: 'Claude Official',
    background: '#f8f6f3',
    titleColor: '#141413',
    subtitleColor: '#8f8a80',
    textPrimary: '#141413',
    textSecondary: '#6b6257',
    textMuted: '#a29a8f',
    nodeFill: '#fffcf7',
    nodeStroke: '#8c6f5a',
    sectionFill: '#f8f6f3',
    sectionStroke: '#8f8a80',
    sectionLabel: '#8b7355',
    arrowColors: {
      control: '#d97757',
      write: '#7b8b5c',
      read: '#8c6f5a',
      data: '#b45309',
      async: '#9a6fb0',
      feedback: '#d97757',
      neutral: '#8f8a80'
    }
  },
  7: {
    name: 'OpenAI',
    background: '#ffffff',
    titleColor: '#0f172a',
    subtitleColor: '#64748b',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    nodeFill: '#ffffff',
    nodeStroke: '#64748b',
    sectionFill: '#ffffff',
    sectionStroke: '#64748b',
    sectionLabel: '#10a37f',
    arrowColors: {
      control: '#10a37f',
      write: '#0f766e',
      read: '#0891b2',
      data: '#f59e0b',
      async: '#64748b',
      feedback: '#10a37f',
      neutral: '#94a3b8'
    }
  }
}
const DEFAULT_VISUAL_LANGUAGE = 'fireworks-style'
const UNIFIED_DIAGRAM_STYLE = FIREWORKS_STYLE_PROFILES[7]
const DECISION_STROKE_COLOR = '#b91c1c'
const DECISION_FILL_COLOR = '#fff1f2'
const GRAPH_LAYOUT_DEFAULTS = {
  flowchart: { algorithm: 'layered', direction: 'RIGHT' },
  graph: { algorithm: 'stress', direction: 'RIGHT' },
  class: { algorithm: 'layered', direction: 'DOWN' },
  er: { algorithm: 'layered', direction: 'RIGHT' },
  state: { algorithm: 'layered', direction: 'RIGHT' },
  mindmap: { algorithm: 'mrtree', direction: 'RIGHT' }
}

const elk = new ELK()


function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
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

function slug(value, fallback) {
  const text = nonEmptyString(value) ?? fallback
  let output = ''
  let lastWasSeparator = false
  for (const char of String(text).trim()) {
    if (isSafeIdChar(char)) {
      output += char
      lastWasSeparator = false
    } else if (!lastWasSeparator) {
      output += '_'
      lastWasSeparator = true
    }
  }
  while (output.startsWith('_')) output = output.slice(1)
  while (output.endsWith('_')) output = output.slice(0, -1)
  return output || fallback
}

function uniqueSlug(value, fallback, used) {
  const base = slug(value, fallback)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

function fireworksElementId(batchId, localId) {
  return `fw_${slug(batchId, 'batch')}_${slug(localId, 'element')}`
}

function snap(value, grid) {
  return Math.round(value / grid) * grid
}

function snapUp(value, grid) {
  return Math.ceil(value / grid) * grid
}

function textLength(value) {
  return Array.from(String(value ?? '')).length
}

function textLines(value) {
  return String(value ?? '').split('\n')
}

function measureText(text, fontSize, options = {}) {
  const lines = textLines(text)
  const maxLine = Math.max(1, ...lines.map(textLength))
  const width = Math.ceil(maxLine * fontSize * numberOr(options.widthFactor, 0.76) + numberOr(options.paddingX, 56))
  const height = Math.ceil(lines.length * fontSize * numberOr(options.lineHeight, 1.25) + numberOr(options.paddingY, 34))
  return { width, height }
}

function maxCharsForWidth(width, fontSize, options = {}) {
  const paddingX = numberOr(options.paddingX, 56)
  const widthFactor = numberOr(options.widthFactor, 0.76)
  return Math.max(8, Math.floor((Math.max(1, width) - paddingX) / (fontSize * widthFactor)))
}

function wrapLine(line, maxChars) {
  const chars = Array.from(String(line ?? ''))
  if (chars.length <= maxChars) return line
  const lines = []
  let current = ''
  for (const char of chars) {
    if (textLength(current) >= maxChars) {
      lines.push(current)
      current = ''
    }
    current += char
  }
  if (current) lines.push(current)
  return lines.join('\n')
}

function wrapText(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return String(text ?? '')
  return textLines(text).map((line) => wrapLine(line, maxChars)).join('\n')
}

function wrapTextToWidth(text, fontSize, width, options = {}) {
  return wrapText(text, maxCharsForWidth(width, fontSize, options))
}

function clampWidth(width, minWidth, maxWidth) {
  return Math.max(minWidth, Math.min(width, maxWidth))
}

function supportedShape(value, fallback = 'rectangle') {
  const shapeType = nonEmptyString(value)
  return GRAPH_NODE_SHAPES.has(shapeType) ? shapeType : fallback
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map(nonEmptyString).filter(Boolean)
}

function normalizeSections(value) {
  if (!Array.isArray(value)) return []
  return value.map((section, index) => {
    const item = plainObject(section) ? section : { items: [section] }
    const title = nonEmptyString(item.title)
    const items = stringList(item.items)
    return {
      id: slug(item.id ?? title, `section_${index + 1}`),
      title,
      items
    }
  }).filter((section) => section.title || section.items.length > 0)
}

function graphNodeText(node) {
  const lines = [node.label]
  if (node.details.length > 0) {
    lines.push('', ...node.details)
  }
  for (const section of node.sections) {
    lines.push('', ...(section.title ? [section.title] : []), ...section.items)
  }
  return lines.join('\n')
}

function graphNodeLabel(node, fontSize, width) {
  return textLines(graphNodeText(node))
    .map((line) => wrapTextToWidth(line, fontSize, width, { paddingX: 56, widthFactor: 0.72 }))
    .join('\n')
}

function semanticRoleForGraphNode(kind, node) {
  return nonEmptyString(node.role) ?? `${kind}-node`
}

function semanticRoleForGraphEdge(kind, edge) {
  return nonEmptyString(edge.role) ?? `${kind}-edge`
}

function normalizeGraphNodes(diagram) {
  const source = Array.isArray(diagram?.nodes) ? diagram.nodes : []
  const used = new Set()
  const references = new Map()
  const nodes = source.map((node, index) => {
    const item = plainObject(node) ? node : { id: node, label: node }
    const normalizedId = uniqueSlug(item.id ?? item.label, `node_${index + 1}`, used)
    const label = nonEmptyString(item.label) ?? normalizedId
    const normalized = {
      id: normalizedId,
      sourceId: nonEmptyString(item.id),
      label,
      shape: supportedShape(item.shape, 'rectangle'),
      color: nonEmptyString(item.color) ?? GRAPH_NODE_COLORS[index % GRAPH_NODE_COLORS.length],
      strokeColor: nonEmptyString(item.strokeColor) ?? UNIFIED_DIAGRAM_STYLE.nodeStroke,
      role: nonEmptyString(item.role),
      details: stringList(item.details ?? item.fields ?? item.attributes),
      sections: normalizeSections(item.sections),
      metadata: plainObject(item.metadata) ?? {}
    }
    for (const key of [item.id, normalized.id, item.label]) {
      const ref = nonEmptyString(key)
      if (ref && !references.has(ref)) references.set(ref, normalized.id)
    }
    return normalized
  })
  return { nodes, references }
}

function normalizeGraphEdges(diagram, references) {
  const source = Array.isArray(diagram?.edges) ? diagram.edges : []
  const used = new Set()
  return source.map((edge, index) => {
    const item = plainObject(edge) ? edge : {}
    const from = references.get(nonEmptyString(item.from) ?? '') ?? null
    const to = references.get(nonEmptyString(item.to) ?? '') ?? null
    if (!from || !to) {
      throw new Error(`graph edge ${index + 1} references an unknown node.`)
    }
    return {
      id: uniqueSlug(item.id, `edge_${index + 1}`, used),
      from,
      to,
      label: nonEmptyString(item.label) ?? '',
      color: nonEmptyString(item.color) ?? GRAPH_EDGE_COLORS[index % GRAPH_EDGE_COLORS.length],
      dashed: item.dashed === true,
      role: nonEmptyString(item.role),
      metadata: plainObject(item.metadata) ?? {}
    }
  })
}

function normalizeGraphDiagram(kind, diagram, options = {}) {
  const spec = plainObject(diagram) ?? {}
  const layout = {
    ...DEFAULT_GRAPH_LAYOUT,
    ...(plainObject(spec.layout) ?? {}),
    ...(plainObject(options.layout) ?? {})
  }
  const batchId = nonEmptyString(options.batchId) ?? nonEmptyString(spec.batchId) ?? `${kind}_${Date.now()}`
  const { nodes, references } = normalizeGraphNodes(spec)
  if (nodes.length === 0) {
    throw new Error(`${kind} diagram requires at least one node.`)
  }
  const edges = normalizeGraphEdges(spec, references)
  if (edges.length === 0 && nodes.length > 1) {
    throw new Error(`${kind} diagram requires edges when multiple nodes are present.`)
  }
  return {
    version: 1,
    kind,
    batchId,
    title: nonEmptyString(spec.title),
    subtitle: nonEmptyString(spec.subtitle),
    nodes,
    edges,
    layout,
    metadata: plainObject(spec.metadata) ?? {}
  }
}

function normalizeParticipants(diagram) {
  const source = Array.isArray(diagram?.participants) ? diagram.participants : []
  return source.map((participant, index) => {
    const item = plainObject(participant) ? participant : { id: participant, label: participant }
    const id = slug(item.id ?? item.label, `participant_${index + 1}`)
    return {
      id,
      label: nonEmptyString(item.label) ?? id,
      color: nonEmptyString(item.color) ?? PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]
    }
  })
}

function normalizeMessages(diagram) {
  const source = Array.isArray(diagram?.messages) ? diagram.messages : []
  return source.map((message, index) => {
    const item = plainObject(message) ? message : {}
    return {
      id: slug(item.id, `message_${index + 1}`),
      from: nonEmptyString(item.from),
      to: nonEmptyString(item.to),
      label: nonEmptyString(item.label) ?? '',
      color: nonEmptyString(item.color) ?? MESSAGE_COLORS[index % MESSAGE_COLORS.length],
      rowGap: Number.isFinite(item.rowGap) ? item.rowGap : null
    }
  }).filter((message) => message.from && message.to)
}

function normalizeAttachments(diagram, field, fallbackKind) {
  const source = Array.isArray(diagram?.[field]) ? diagram[field] : []
  return source.map((attachment, index) => {
    const item = plainObject(attachment) ? attachment : {}
    return {
      id: slug(item.id, `${fallbackKind}_${index + 1}`),
      kind: fallbackKind,
      text: nonEmptyString(item.text) ?? '',
      lane: nonEmptyString(item.lane),
      from: nonEmptyString(item.from),
      to: nonEmptyString(item.to),
      afterMessageId: nonEmptyString(item.afterMessageId),
      color: nonEmptyString(item.color),
      backgroundColor: nonEmptyString(item.backgroundColor)
    }
  }).filter((attachment) => attachment.text)
}

function style(strokeColor, backgroundColor, extra = {}) {
  return {
    strokeColor,
    backgroundColor,
    fillStyle: 'solid',
    roughness: 0.8,
    strokeWidth: 1.6,
    ...extra
  }
}

function codexData(batchId, semanticId, role, extra = {}) {
  return {
    codex: {
      createdBy: 'codex',
      batchId,
      semanticId,
      role,
      ...extra
    }
  }
}

function shape(type, { x, y, width, height, label, fontSize, strokeColor, backgroundColor, semanticId, batchId, role }) {
  return {
    type,
    x,
    y,
    width,
    height,
    label: { text: label, fontSize },
    style: style(strokeColor, backgroundColor, { strokeWidth: type === 'diamond' ? 2 : 1.5 }),
    customData: codexData(batchId, semanticId, role ?? type)
  }
}

function line({ x1, y1, x2, y2, strokeColor, semanticId, batchId, dashed = false }) {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)
  const points = [
    [x1 - x, y1 - y],
    [x2 - x, y2 - y]
  ]
  return {
    type: 'line',
    x,
    y,
    width,
    height,
    points,
    style: {
      strokeColor,
      backgroundColor: 'transparent',
      strokeStyle: dashed ? 'dashed' : 'solid',
      roughness: 0.8,
      strokeWidth: dashed ? 1.5 : 2
    },
    customData: codexData(batchId, semanticId, 'lifeline')
  }
}

function arrow({ x1, y1, x2, y2, label, fontSize, strokeColor, semanticId, batchId }) {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)
  const points = [
    [x1 - x, y1 - y],
    [x2 - x, y2 - y]
  ]
  return {
    type: 'arrow',
    x,
    y,
    width,
    height,
    points,
    label: label ? { text: label, fontSize } : undefined,
    style: {
      strokeColor,
      backgroundColor: 'transparent',
      roughness: 0.8,
      strokeWidth: 2
    },
    customData: codexData(batchId, semanticId, 'message')
  }
}

function polyline({ points, label, fontSize, strokeColor, semanticId, batchId, role, dashed = false }) {
  const normalizedPoints = points
    .map((point) => Array.isArray(point) && point.length >= 2 ? [numberOr(point[0], 0), numberOr(point[1], 0)] : null)
    .filter(Boolean)
  if (normalizedPoints.length < 2) {
    throw new Error('polyline requires at least two points.')
  }
  const xs = normalizedPoints.map((point) => point[0])
  const ys = normalizedPoints.map((point) => point[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(1, Math.max(...xs) - x)
  const height = Math.max(1, Math.max(...ys) - y)
  return {
    type: 'arrow',
    x,
    y,
    width,
    height,
    points: normalizedPoints.map(([pointX, pointY]) => [pointX - x, pointY - y]),
    label: label ? { text: label, fontSize } : undefined,
    style: {
      strokeColor,
      backgroundColor: 'transparent',
      strokeStyle: dashed ? 'dashed' : 'solid',
      roughness: 0.8,
      strokeWidth: 2
    },
    customData: codexData(batchId, semanticId, role ?? 'edge')
  }
}

function textElement({ x, y, width, height, text, fontSize, strokeColor, semanticId, batchId, role }) {
  return {
    type: 'text',
    x,
    y,
    width,
    height,
    text,
    fontSize,
    style: {
      strokeColor,
      backgroundColor: 'transparent',
      roughness: 0.8
    },
    customData: codexData(batchId, semanticId, role ?? 'text')
  }
}

function fireworksStyleProfile(value) {
  const index = Number.isFinite(value) ? value : Number.parseInt(String(value ?? '1'), 10)
  return FIREWORKS_STYLE_PROFILES[index] ?? FIREWORKS_STYLE_PROFILES[1]
}

function fireworksFlow(value) {
  const flow = nonEmptyString(value)?.toLowerCase()
  if (flow === 'write' || flow === 'read' || flow === 'data' || flow === 'async' || flow === 'feedback' || flow === 'neutral') {
    return flow
  }
  return 'control'
}

function fireworksElementStyle(strokeColor, backgroundColor, extra = {}) {
  return {
    strokeColor,
    backgroundColor,
    fillStyle: 'solid',
    roughness: 0.8,
    strokeWidth: 1.5,
    ...extra
  }
}

function fireworksElement(type, spec, batchId, role) {
  const layoutRole = nonEmptyString(spec.layoutRole)
  return {
    type,
    ...spec,
    semanticId: spec.semanticId,
    customData: codexData(batchId, spec.semanticId, role, layoutRole ? { layoutRole } : {})
  }
}

function fireworksTextBounds(text, fontSize) {
  const lines = textLines(text)
  const maxLine = Math.max(1, ...lines.map(textLength))
  return {
    width: Math.ceil(maxLine * fontSize * 0.76 + 64),
    height: Math.ceil(Math.max(1, lines.length) * fontSize * 1.25 + 36)
  }
}

function fireworksVisualTextWidth(text, fontSize, options = {}) {
  const lines = textLines(text)
  const maxLine = Math.max(1, ...lines.map(textLength))
  return Math.ceil(maxLine * fontSize * numberOr(options.widthFactor, 0.72) + numberOr(options.paddingX, 48))
}

function fireworksTextElement({ x, y, width, height, text, fontSize = 16, strokeColor, semanticId, batchId, role, textAlign = 'left', verticalAlign = 'top' }) {
  const content = String(text ?? '')
  const safeFontSize = Math.max(16, fontSize)
  const required = fireworksTextBounds(content, safeFontSize)
  const originalWidth = numberOr(width, required.width)
  const originalHeight = numberOr(height, required.height)
  const nextWidth = Math.max(originalWidth, required.width)
  const nextHeight = Math.max(originalHeight, required.height)
  const nextX = textAlign === 'center' ? x + originalWidth / 2 - nextWidth / 2 : x
  const nextY = verticalAlign === 'middle' ? y + originalHeight / 2 - nextHeight / 2 : y
  return fireworksElement('text', {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
    text: content,
    fontSize: safeFontSize,
    textAlign: textAlign === 'center' ? 'left' : textAlign,
    verticalAlign: verticalAlign === 'middle' ? 'top' : verticalAlign,
    layoutRole: 'section',
    style: fireworksElementStyle(strokeColor, 'transparent', { roughness: 0.2 }),
    semanticId
  }, batchId, role ?? 'text')
}

function fireworksNodeLabelFontSize(width) {
  return Math.max(17, Math.min(18, width / 12))
}

function fireworksNodeSafeWidth(node, fallbackWidth) {
  const label = nonEmptyString(node?.label)
  const typeLabel = nonEmptyString(node?.type_label ?? node?.typeLabel)
  const sublabel = nonEmptyString(node?.sublabel ?? node?.subtitle)
  const tagText = Array.isArray(node?.tags)
    ? node.tags.map((tag) => nonEmptyString(tag?.label)).filter(Boolean).join('   ')
    : null
  const requested = Math.max(120, numberOr(node?.width, fallbackWidth))
  const labelWidth = label ? fireworksVisualTextWidth(label, fireworksNodeLabelFontSize(requested), { widthFactor: 0.78, paddingX: 72 }) : 0
  const typeWidth = typeLabel ? fireworksVisualTextWidth(typeLabel.toUpperCase(), 16, { widthFactor: 0.66, paddingX: 36 }) : 0
  const secondaryText = sublabel ?? tagText
  const secondaryWidth = secondaryText ? fireworksVisualTextWidth(secondaryText, 16, { widthFactor: 0.66, paddingX: 40 }) : 0
  return Math.ceil(Math.max(requested, labelWidth + 48, typeWidth + 48, secondaryWidth + 48))
}

function estimatedTextWidth(text, fontSize) {
  return Math.max(1, ...textLines(text).map(textLength)) * fontSize * 0.64 + 12
}

function fireworksCenteredText({ x, y, width, height, text, fontSize, strokeColor, semanticId, batchId, role }) {
  const label = wrapTextToWidth(text, fontSize, width, { paddingX: 24, widthFactor: 0.68 })
  const measured = measureText(label, fontSize, { paddingX: 12, paddingY: 8, widthFactor: 0.64, lineHeight: 1.2 })
  return fireworksTextElement({
    x: x + width / 2 - measured.width / 2,
    y: y + height / 2 - measured.height / 2,
    width: measured.width,
    height: measured.height,
    text: label,
    fontSize,
    strokeColor,
    semanticId,
    batchId,
    role,
    textAlign: 'center',
    verticalAlign: 'middle'
  })
}

function fireworksRectangle({ id, x, y, width, height, strokeColor, backgroundColor, semanticId, batchId, role, layoutRole, strokeStyle = 'solid', opacity = 100, locked = false, strokeWidth = 1.5 }) {
  return fireworksElement('rectangle', {
    id,
    x,
    y,
    width,
    height,
    locked,
    layoutRole,
    style: fireworksElementStyle(strokeColor, backgroundColor, {
      strokeStyle,
      strokeWidth,
      opacity
    }),
    semanticId
  }, batchId, role ?? 'shape')
}

function fireworksEllipse({ id, x, y, width, height, strokeColor, backgroundColor, semanticId, batchId, role, layoutRole, opacity = 100 }) {
  return fireworksElement('ellipse', {
    id,
    x,
    y,
    width,
    height,
    layoutRole,
    style: fireworksElementStyle(strokeColor, backgroundColor, { opacity }),
    semanticId
  }, batchId, role ?? 'shape')
}

function fireworksLineSpec({ id, points, strokeColor, semanticId, batchId, role, dashed = false, arrow = false, strokeWidth = 2 }) {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return fireworksElement(arrow ? 'arrow' : 'line', {
    id,
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
    points: points.map(([pointX, pointY]) => [pointX - x, pointY - y]),
    style: fireworksElementStyle(strokeColor, 'transparent', {
      strokeStyle: dashed ? 'dashed' : 'solid',
      strokeWidth
    }),
    semanticId
  }, batchId, role ?? (arrow ? 'arrow' : 'line'))
}

function normalizeFireworksNode(node, index, offsetX, offsetY, profile) {
  const id = slug(node?.id ?? node?.label, `node_${index + 1}`)
  const x = numberOr(node?.x, 80 + index * 220) + offsetX
  const y = numberOr(node?.y, 140) + offsetY
  const hasSecondaryText = Boolean(nonEmptyString(node?.type_label ?? node?.typeLabel) || nonEmptyString(node?.sublabel ?? node?.subtitle))
  const width = fireworksNodeSafeWidth(node, 180)
  const height = Math.max(hasSecondaryText ? 120 : 76, numberOr(node?.height, 76))
  return {
    id,
    sourceId: nonEmptyString(node?.id),
    kind: nonEmptyString(node?.kind ?? node?.shape) ?? 'rect',
    x,
    y,
    width,
    height,
    label: nonEmptyString(node?.label) ?? id,
    typeLabel: nonEmptyString(node?.type_label ?? node?.typeLabel),
    sublabel: nonEmptyString(node?.sublabel ?? node?.subtitle),
    tags: Array.isArray(node?.tags) ? node.tags : [],
    fill: nonEmptyString(node?.fill) ?? profile.nodeFill,
    stroke: nonEmptyString(node?.stroke) ?? profile.nodeStroke,
    textColor: nonEmptyString(node?.text_fill ?? node?.textColor) ?? profile.textPrimary,
    typeColor: nonEmptyString(node?.type_fill ?? node?.typeColor) ?? profile.textMuted,
    subColor: nonEmptyString(node?.sub_fill ?? node?.subColor) ?? profile.textSecondary
  }
}

function renderFireworksNode(node, profile, batchId) {
  const elements = []
  const semanticId = `fireworks_node_${node.id}`
  const groupId = fireworksElementId(batchId, `group_${node.id}`)
  const textInset = 24
  const textX = node.x + textInset
  const textWidth = Math.max(72, node.width - textInset * 2)
  const base = {
    id: fireworksElementId(batchId, `node_${node.id}`),
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    strokeColor: node.stroke,
    backgroundColor: node.fill,
    semanticId,
    batchId,
    role: `fireworks-${node.kind}`,
    layoutRole: 'container',
    strokeWidth: node.kind === 'double_rect' ? 2 : 1.7
  }

  if (node.kind === 'cylinder') {
    elements.push(fireworksRectangle({ ...base, backgroundColor: node.fill, role: 'fireworks-cylinder-body' }))
    elements.push(fireworksEllipse({
      id: fireworksElementId(batchId, `node_${node.id}_top`),
      x: node.x,
      y: node.y - 2,
      width: node.width,
      height: Math.max(60, Math.min(72, node.height * 0.45)),
      strokeColor: node.stroke,
      backgroundColor: node.fill,
      semanticId: `${semanticId}_top`,
      batchId,
      role: 'fireworks-cylinder-cap',
      layoutRole: 'container',
      opacity: 88
    }))
  } else if (node.kind === 'circle_cluster') {
    elements.push(fireworksRectangle({ ...base, role: 'fireworks-cluster-frame' }))
    const circleSize = Math.max(120, Math.min(node.width * 0.56, node.height * 0.86))
    const circleY = node.y + Math.max(8, node.height * 0.18)
    const circleXs = [node.x + node.width * 0.25 - circleSize / 2, node.x + node.width * 0.5 - circleSize / 2, node.x + node.width * 0.72 - circleSize / 2]
    for (let index = 0; index < circleXs.length; index += 1) {
      elements.push(fireworksEllipse({
        id: fireworksElementId(batchId, `node_${node.id}_circle_${index + 1}`),
        x: circleXs[index],
        y: circleY,
        width: circleSize,
        height: circleSize,
        strokeColor: node.stroke,
        backgroundColor: node.fill,
        semanticId: `${semanticId}_circle_${index + 1}`,
        batchId,
        role: 'fireworks-cluster-circle',
        layoutRole: 'container',
        opacity: 58
      }))
    }
  } else {
    elements.push(fireworksRectangle({ ...base, role: `fireworks-${node.kind}` }))
    if (node.kind === 'double_rect') {
      elements.push(fireworksRectangle({
        id: fireworksElementId(batchId, `node_${node.id}_inner`),
        x: node.x + 8,
        y: node.y + 8,
        width: Math.max(120, node.width - 16),
        height: Math.max(60, node.height - 16),
        strokeColor: node.stroke,
        backgroundColor: 'transparent',
        semanticId: `${semanticId}_inner`,
        batchId,
        role: 'fireworks-double-rect-inner',
        layoutRole: 'container',
        strokeWidth: 1.2
      }))
    }
    if (node.kind === 'document') {
      elements.push(fireworksLineSpec({
        id: fireworksElementId(batchId, `node_${node.id}_fold`),
        points: [
          [node.x + node.width - 36, node.y],
          [node.x + node.width - 36, node.y + 36],
          [node.x + node.width, node.y + 36]
        ],
        strokeColor: node.stroke,
        semanticId: `${semanticId}_fold`,
        batchId,
        role: 'fireworks-document-fold',
        strokeWidth: 1.4
      }))
    }
  }

  if (node.typeLabel) {
    elements.push(fireworksTextElement({
      x: textX,
      y: node.y + 16,
      width: textWidth,
      height: 22,
      text: node.typeLabel.toUpperCase(),
      fontSize: 16,
      strokeColor: node.typeColor,
      semanticId: `${semanticId}_type`,
      batchId,
      role: 'fireworks-node-type',
      textAlign: 'left'
    }))
  }

  const titleY = node.typeLabel ? node.y + 44 : node.y + 24
  const titleHeight = node.sublabel || node.tags.length > 0 ? node.height - (node.typeLabel ? 86 : 68) : node.height - (node.typeLabel ? 64 : 48)
  elements.push(fireworksTextElement({
    x: textX,
    y: titleY,
    width: textWidth,
    height: Math.max(32, titleHeight),
    text: node.label,
    fontSize: fireworksNodeLabelFontSize(node.width),
    strokeColor: node.textColor,
    semanticId: `${semanticId}_label`,
    batchId,
    role: 'fireworks-node-label',
    textAlign: 'left'
  }))

  if (node.sublabel) {
    elements.push(fireworksTextElement({
      x: textX,
      y: node.y + node.height - 38,
      width: textWidth,
      height: 24,
      text: node.sublabel,
      fontSize: 16,
      strokeColor: node.subColor,
      semanticId: `${semanticId}_sublabel`,
      batchId,
      role: 'fireworks-node-sublabel',
      textAlign: 'left'
    }))
  } else if (node.tags.length > 0) {
    const tagText = node.tags.map((tag) => nonEmptyString(tag?.label)).filter(Boolean).join('   ')
    if (tagText) {
      elements.push(fireworksTextElement({
        x: textX,
        y: node.y + node.height - 38,
        width: textWidth,
        height: 24,
        text: tagText,
        fontSize: 16,
        strokeColor: node.stroke,
        semanticId: `${semanticId}_tags`,
        batchId,
        role: 'fireworks-node-tags',
        textAlign: 'left'
      }))
    }
  }

  return elements.map((element) => ({
    ...element,
    groupIds: [...(element.groupIds ?? []), groupId]
  }))
}

function normalizeFireworksContainers(containers, offsetX, offsetY, profile) {
  if (!Array.isArray(containers)) return []
  return containers.map((container, index) => ({
    id: slug(container?.id ?? container?.label, `container_${index + 1}`),
    x: numberOr(container?.x, 40) + offsetX,
    y: numberOr(container?.y, 120 + index * 150) + offsetY,
    width: Math.max(160, numberOr(container?.width, 880)),
    height: Math.max(76, numberOr(container?.height, 112)),
    label: nonEmptyString(container?.label) ?? '',
    subtitle: nonEmptyString(container?.subtitle),
    fill: nonEmptyString(container?.fill) ?? profile.sectionFill,
    stroke: nonEmptyString(container?.stroke) ?? profile.sectionStroke
  }))
}

function fireworksBox(item) {
  return {
    left: item.x,
    top: item.y,
    right: item.x + item.width,
    bottom: item.y + item.height,
    width: item.width,
    height: item.height
  }
}

function fireworksUnionBounds(items) {
  let bounds = null
  for (const item of items) {
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue
    const width = Math.max(1, numberOr(item.width, 1))
    const height = Math.max(1, numberOr(item.height, 1))
    const box = fireworksBox({ ...item, width, height })
    if (!bounds) {
      bounds = { ...box }
    } else {
      bounds.left = Math.min(bounds.left, box.left)
      bounds.top = Math.min(bounds.top, box.top)
      bounds.right = Math.max(bounds.right, box.right)
      bounds.bottom = Math.max(bounds.bottom, box.bottom)
      bounds.width = bounds.right - bounds.left
      bounds.height = bounds.bottom - bounds.top
    }
  }
  return bounds
}

function fireworksElementBounds(elements, ignoredSemanticIds = new Set()) {
  return fireworksUnionBounds(
    elements
      .filter((element) => !ignoredSemanticIds.has(element.semanticId))
      .map((element) => ({
        x: numberOr(element.x, 0),
        y: numberOr(element.y, 0),
        width: Math.max(1, numberOr(element.width, 1)),
        height: Math.max(1, numberOr(element.height, 1))
      }))
  )
}

function fireworksVerticalOverlapRatio(left, right) {
  const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
  if (overlap <= 0) return 0
  return overlap / Math.max(1, Math.min(left.height, right.height))
}

function resolveFireworksNodeOverlaps(nodes, layout = {}) {
  const minGap = Math.max(16, numberOr(layout.nodeGap, 28))
  const rows = []
  const repairs = []
  const nextNodes = nodes.map((node) => ({ ...node }))
  const sorted = [...nextNodes].sort((left, right) => left.y - right.y || left.x - right.x)
  for (const node of sorted) {
    const box = fireworksBox(node)
    let bestRow = null
    let bestOverlap = 0
    for (const row of rows) {
      const overlap = fireworksVerticalOverlapRatio(box, row.box)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestRow = row
      }
    }
    if (!bestRow || bestOverlap < 0.42) {
      rows.push({ box: { ...box }, nodes: [node] })
      continue
    }
    bestRow.nodes.push(node)
    bestRow.box.top = Math.min(bestRow.box.top, box.top)
    bestRow.box.bottom = Math.max(bestRow.box.bottom, box.bottom)
    bestRow.box.height = bestRow.box.bottom - bestRow.box.top
  }

  for (const row of rows) {
    row.nodes.sort((left, right) => left.x - right.x)
    let nextX = -Infinity
    for (const node of row.nodes) {
      if (Number.isFinite(nextX) && node.x < nextX) {
        repairs.push({
          code: 'fireworks-node-shifted-to-avoid-overlap',
          id: node.id,
          from: node.x,
          to: nextX
        })
        node.x = nextX
      }
      nextX = node.x + node.width + minGap
    }
  }

  const byId = new Map(nextNodes.map((node) => [node.id, node]))
  return {
    nodes: nodes.map((node) => byId.get(node.id) ?? node),
    repairs
  }
}

function inferFireworksContainerChildren(containers, nodes) {
  const result = new Map(containers.map((container) => [container.id, []]))
  for (const node of nodes) {
    const centerX = node.x + node.width / 2
    const centerY = node.y + node.height / 2
    const nodeBox = fireworksBox(node)
    const nodeArea = Math.max(1, nodeBox.width * nodeBox.height)
    for (const container of containers) {
      const box = fireworksBox(container)
      const intersectionWidth = Math.max(0, Math.min(nodeBox.right, box.right) - Math.max(nodeBox.left, box.left))
      const intersectionHeight = Math.max(0, Math.min(nodeBox.bottom, box.bottom) - Math.max(nodeBox.top, box.top))
      const overlapRatio = (intersectionWidth * intersectionHeight) / nodeArea
      if (
        (centerX >= box.left && centerX <= box.right && centerY >= box.top && centerY <= box.bottom) ||
        overlapRatio >= 0.18
      ) {
        result.get(container.id)?.push(node.id)
      }
    }
  }
  return result
}

function expandFireworksContainersToNodes(containers, nodes, childMap) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const repairs = []
  const nextContainers = containers.map((container) => {
    const children = (childMap.get(container.id) ?? []).map((id) => nodeMap.get(id)).filter(Boolean)
    if (children.length === 0) return container
    const childBounds = fireworksUnionBounds(children)
    if (!childBounds) return container

    const horizontalPadding = 32
    const titleReserve = container.label ? (container.subtitle ? 78 : 58) : 28
    const bottomPadding = 32
    const currentRight = container.x + container.width
    const currentBottom = container.y + container.height
    const nextX = Math.min(container.x, childBounds.left - horizontalPadding)
    const nextY = Math.min(container.y, childBounds.top - titleReserve)
    let nextRight = Math.max(currentRight, childBounds.right + horizontalPadding)
    const nextBottom = Math.max(currentBottom, childBounds.bottom + bottomPadding)

    if (container.label) {
      const labelWidth = fireworksVisualTextWidth(container.label.toUpperCase(), 18, { widthFactor: 0.66, paddingX: 72 })
      nextRight = Math.max(nextRight, nextX + labelWidth)
    }

    const next = {
      ...container,
      x: Math.round(nextX),
      y: Math.round(nextY),
      width: Math.round(nextRight - nextX),
      height: Math.round(nextBottom - nextY)
    }
    if (next.x !== container.x || next.y !== container.y || next.width !== container.width || next.height !== container.height) {
      repairs.push({
        code: 'fireworks-container-expanded-to-fit-children',
        id: container.id,
        from: { x: container.x, y: container.y, width: container.width, height: container.height },
        to: { x: next.x, y: next.y, width: next.width, height: next.height }
      })
    }
    return next
  })
  return { containers: nextContainers, repairs }
}

function renderFireworksContainer(container, profile, batchId) {
  const semanticId = `fireworks_container_${container.id}`
  const elements = [
    fireworksRectangle({
      id: fireworksElementId(batchId, `container_${container.id}`),
      x: container.x,
      y: container.y,
      width: container.width,
      height: container.height,
      strokeColor: container.stroke,
      backgroundColor: container.fill,
      strokeStyle: 'dashed',
      opacity: 42,
      semanticId,
      batchId,
      role: 'fireworks-container',
      layoutRole: 'container'
    })
  ]
  if (container.label) {
    elements.push(fireworksTextElement({
      x: container.x + 18,
      y: container.y + 18,
      width: container.width - 36,
      height: 26,
      text: container.label.toUpperCase(),
      fontSize: 18,
      strokeColor: profile.sectionLabel,
      semanticId: `${semanticId}_label`,
      batchId,
      role: 'fireworks-container-label'
    }))
  }
  if (container.subtitle) {
    elements.push(fireworksTextElement({
      x: container.x + 18,
      y: container.y + 44,
      width: container.width - 36,
      height: 24,
      text: container.subtitle,
      fontSize: 16,
      strokeColor: profile.textMuted,
      semanticId: `${semanticId}_subtitle`,
      batchId,
      role: 'fireworks-container-subtitle'
    }))
  }
  return elements
}

function fireworksContainerHeaderBounds(container) {
  if (!container.label && !container.subtitle) return null
  return {
    id: `container_header_${container.id}`,
    left: container.x + 6,
    top: container.y + 6,
    right: container.x + container.width - 6,
    bottom: container.y + (container.subtitle ? 76 : 48),
    width: Math.max(1, container.width - 12),
    height: container.subtitle ? 70 : 42
  }
}

function fireworksAnchor(node, port, toward) {
  const side = nonEmptyString(port)?.toLowerCase()
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  if (side === 'left') return [node.x, cy]
  if (side === 'right') return [node.x + node.width, cy]
  if (side === 'top') return [cx, node.y]
  if (side === 'bottom') return [cx, node.y + node.height]
  const dx = toward[0] - cx
  const dy = toward[1] - cy
  if (Math.abs(dx) * node.height >= Math.abs(dy) * node.width) {
    return dx >= 0 ? [node.x + node.width, cy] : [node.x, cy]
  }
  return dy >= 0 ? [cx, node.y + node.height] : [cx, node.y]
}

function fireworksRoute(start, end, arrow, offsetX, offsetY) {
  if (Array.isArray(arrow?.route_points) && arrow.route_points.length > 0) {
    return [
      start,
      ...arrow.route_points
        .map((point) => Array.isArray(point) && point.length >= 2 ? [numberOr(point[0], 0) + offsetX, numberOr(point[1], 0) + offsetY] : null)
        .filter(Boolean),
      end
    ]
  }

  const corridorX = Array.isArray(arrow?.corridor_x) && Number.isFinite(arrow.corridor_x[0]) ? arrow.corridor_x[0] + offsetX : null
  const corridorY = Array.isArray(arrow?.corridor_y) && Number.isFinite(arrow.corridor_y[0]) ? arrow.corridor_y[0] + offsetY : null
  if (corridorX !== null) return [start, [corridorX, start[1]], [corridorX, end[1]], end]
  if (corridorY !== null) return [start, [start[0], corridorY], [end[0], corridorY], end]

  const sourcePort = nonEmptyString(arrow?.source_port)?.toLowerCase()
  const targetPort = nonEmptyString(arrow?.target_port)?.toLowerCase()
  if ((sourcePort === 'top' || sourcePort === 'bottom') && (targetPort === 'top' || targetPort === 'bottom')) {
    const midY = (start[1] + end[1]) / 2
    return [start, [start[0], midY], [end[0], midY], end]
  }
  if ((sourcePort === 'left' || sourcePort === 'right') && (targetPort === 'left' || targetPort === 'right')) {
    const midX = (start[0] + end[0]) / 2
    return [start, [midX, start[1]], [midX, end[1]], end]
  }
  return [start, [end[0], start[1]], end]
}

function fireworksSegmentAxis(left, right) {
  if (Math.abs(left[1] - right[1]) < 1e-6) return 'horizontal'
  if (Math.abs(left[0] - right[0]) < 1e-6) return 'vertical'
  return 'other'
}

function fireworksPortAxis(port) {
  const side = nonEmptyString(port)?.toLowerCase()
  if (side === 'left' || side === 'right') return 'horizontal'
  if (side === 'top' || side === 'bottom') return 'vertical'
  return null
}

function fireworksOffsetPoint(point, port, distance) {
  const side = nonEmptyString(port)?.toLowerCase()
  if (side === 'left') return [point[0] - distance, point[1]]
  if (side === 'right') return [point[0] + distance, point[1]]
  if (side === 'top') return [point[0], point[1] - distance]
  if (side === 'bottom') return [point[0], point[1] + distance]
  return point
}

function fireworksExpandBox(box, padding) {
  return {
    left: box.left - padding,
    top: box.top - padding,
    right: box.right + padding,
    bottom: box.bottom + padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    id: box.id
  }
}

function fireworksSegmentHitsBox(leftPoint, rightPoint, box) {
  const [x1, y1] = leftPoint
  const [x2, y2] = rightPoint
  const epsilon = 1e-6
  if (Math.abs(y1 - y2) < epsilon) {
    const y = y1
    if (!(box.top + epsilon < y && y < box.bottom - epsilon)) return false
    const segmentLeft = Math.min(x1, x2)
    const segmentRight = Math.max(x1, x2)
    const overlapLeft = Math.max(segmentLeft, box.left)
    const overlapRight = Math.min(segmentRight, box.right)
    return overlapRight - overlapLeft > epsilon
  }
  if (Math.abs(x1 - x2) < epsilon) {
    const x = x1
    if (!(box.left + epsilon < x && x < box.right - epsilon)) return false
    const segmentTop = Math.min(y1, y2)
    const segmentBottom = Math.max(y1, y2)
    const overlapTop = Math.max(segmentTop, box.top)
    const overlapBottom = Math.min(segmentBottom, box.bottom)
    return overlapBottom - overlapTop > epsilon
  }
  return false
}

function fireworksCollisionCount(points, obstacles) {
  let count = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const obstacle of obstacles) {
      if (fireworksSegmentHitsBox(points[index], points[index + 1], obstacle)) count += 1
    }
  }
  return count
}

function fireworksRouteLength(points) {
  let length = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.abs(points[index + 1][0] - points[index][0]) + Math.abs(points[index + 1][1] - points[index][1])
  }
  return length
}

function fireworksRouteUsesLane(points, value, axis) {
  return points.some((point) => Math.abs((axis === 'x' ? point[0] : point[1]) - value) <= 1)
}

function fireworksRouteIsOrthogonal(points) {
  return points.every((point, index) => index === 0 || fireworksSegmentAxis(points[index - 1], point) !== 'other')
}

function fireworksRouteScore(points, hintX, hintY, sourcePort, targetPort) {
  let score = fireworksRouteLength(points) + Math.max(0, points.length - 2) * 22
  const sourceAxis = fireworksPortAxis(sourcePort)
  const targetAxis = fireworksPortAxis(targetPort)
  if (sourceAxis && points.length >= 2 && fireworksSegmentAxis(points[0], points[1]) !== sourceAxis) score += 180
  if (targetAxis && points.length >= 2 && fireworksSegmentAxis(points.at(-2), points.at(-1)) !== targetAxis) score += 180
  for (const lane of hintX) {
    if (fireworksRouteUsesLane(points, lane, 'x')) score -= 28
  }
  for (const lane of hintY) {
    if (fireworksRouteUsesLane(points, lane, 'y')) score -= 28
  }
  return score
}

function fireworksObstacleAwareRoute(start, end, arrow, offsetX, offsetY, obstacles = []) {
  if (Array.isArray(arrow?.route_points) && arrow.route_points.length > 0) {
    return simplifyFireworksRoute([
      start,
      ...arrow.route_points
        .map((point) => Array.isArray(point) && point.length >= 2 ? [numberOr(point[0], 0) + offsetX, numberOr(point[1], 0) + offsetY] : null)
        .filter(Boolean),
      end
    ])
  }

  const sourcePort = nonEmptyString(arrow?.source_port)?.toLowerCase()
  const targetPort = nonEmptyString(arrow?.target_port)?.toLowerCase()
  const routingPadding = Math.max(12, numberOr(arrow?.routing_padding, 24))
  const portClearance = Math.max(16, numberOr(arrow?.port_clearance, routingPadding * 0.85))
  const innerStart = fireworksOffsetPoint(start, sourcePort, portClearance)
  const innerEnd = fireworksOffsetPoint(end, targetPort, portClearance)
  const [startX, startY] = innerStart
  const [endX, endY] = innerEnd
  const expanded = obstacles.map((box) => fireworksExpandBox(box, routingPadding))
  const hintX = Array.isArray(arrow?.corridor_x)
    ? arrow.corridor_x.filter(Number.isFinite).map((value) => value + offsetX)
    : []
  const hintY = Array.isArray(arrow?.corridor_y)
    ? arrow.corridor_y.filter(Number.isFinite).map((value) => value + offsetY)
    : []
  const laneX = new Set([startX, endX, (startX + endX) / 2, ...hintX])
  const laneY = new Set([startY, endY, (startY + endY) / 2, ...hintY])
  for (const box of expanded) {
    laneX.add(box.left)
    laneX.add(box.right)
    laneY.add(box.top)
    laneY.add(box.bottom)
  }
  const routeBounds = expanded.length > 0
    ? {
        left: Math.min(...expanded.map((box) => box.left)) - 24,
        right: Math.max(...expanded.map((box) => box.right)) + 24,
        top: Math.min(...expanded.map((box) => box.top)) - 24,
        bottom: Math.max(...expanded.map((box) => box.bottom)) + 24
      }
    : {
        left: Math.min(startX, endX) - 48,
        right: Math.max(startX, endX) + 48,
        top: Math.min(startY, endY) - 48,
        bottom: Math.max(startY, endY) + 48
      }

  const candidates = [
    [start, innerStart, innerEnd, end],
    [start, innerStart, [endX, startY], innerEnd, end],
    [start, innerStart, [startX, endY], innerEnd, end],
    [start, innerStart, [(startX + endX) / 2, startY], [(startX + endX) / 2, endY], innerEnd, end],
    [start, innerStart, [startX, (startY + endY) / 2], [endX, (startY + endY) / 2], innerEnd, end],
    [start, innerStart, [routeBounds.left, startY], [routeBounds.left, endY], innerEnd, end],
    [start, innerStart, [routeBounds.right, startY], [routeBounds.right, endY], innerEnd, end],
    [start, innerStart, [startX, routeBounds.top], [endX, routeBounds.top], innerEnd, end],
    [start, innerStart, [startX, routeBounds.bottom], [endX, routeBounds.bottom], innerEnd, end]
  ]
  for (const x of laneX) {
    candidates.push([start, innerStart, [x, startY], [x, endY], innerEnd, end])
  }
  for (const y of laneY) {
    candidates.push([start, innerStart, [startX, y], [endX, y], innerEnd, end])
  }
  for (const x of hintX) {
    for (const y of hintY) {
      candidates.push([start, innerStart, [x, startY], [x, y], [endX, y], innerEnd, end])
    }
  }

  let bestRoute = null
  let bestScore = Infinity
  let fallbackRoute = null
  let fallbackCollisionCount = Infinity
  let fallbackScore = Infinity
  const defaultRoute = simplifyFireworksRoute([start, innerStart, [endX, startY], innerEnd, end])
  const defaultCollisions = fireworksCollisionCount(defaultRoute, expanded)
  const defaultRawCollisions = fireworksCollisionCount(defaultRoute, obstacles)
  const defaultLength = fireworksRouteLength(defaultRoute)

  for (const candidate of candidates) {
    const route = simplifyFireworksRoute(candidate)
    const score = fireworksRouteScore(route, hintX, hintY, sourcePort, targetPort)
    const collisions = fireworksCollisionCount(route, expanded)
    if (collisions === 0 && fireworksRouteIsOrthogonal(route)) {
      if (score < bestScore) {
        bestScore = score
        bestRoute = route
      }
      continue
    }
    if (!fireworksRouteIsOrthogonal(route)) continue
    const rawCollisions = fireworksCollisionCount(route, obstacles)
    const length = fireworksRouteLength(route)
    if (
      collisions < defaultCollisions &&
      rawCollisions <= defaultRawCollisions &&
      length <= defaultLength &&
      (collisions < fallbackCollisionCount || (collisions === fallbackCollisionCount && score < fallbackScore))
    ) {
      fallbackCollisionCount = collisions
      fallbackScore = score
      fallbackRoute = route
    }
  }

  return bestRoute ?? fallbackRoute ?? defaultRoute
}

function simplifyFireworksRoute(points) {
  const simplified = []
  for (const point of points) {
    const next = [Math.round(point[0]), Math.round(point[1])]
    if (simplified.length === 0 || simplified.at(-1)[0] !== next[0] || simplified.at(-1)[1] !== next[1]) {
      simplified.push(next)
    }
  }
  const collapsed = []
  for (const point of simplified) {
    if (collapsed.length < 2) {
      collapsed.push(point)
      continue
    }
    const [x0, y0] = collapsed.at(-2)
    const [x1, y1] = collapsed.at(-1)
    const [x2, y2] = point
    if ((x0 === x1 && x1 === x2) || (y0 === y1 && y1 === y2)) {
      collapsed[collapsed.length - 1] = point
    } else {
      collapsed.push(point)
    }
  }
  return collapsed
}

function longestSegmentMidpoint(points) {
  let best = [points[0], points[1]]
  let bestLength = -1
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]
    const right = points[index + 1]
    const length = Math.abs(right[0] - left[0]) + Math.abs(right[1] - left[1])
    if (length > bestLength) {
      bestLength = length
      best = [left, right]
    }
  }
  return [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2]
}

function fireworksBoundsIntersect(left, right, padding = 0) {
  return !(
    left.right + padding <= right.left ||
    right.right + padding <= left.left ||
    left.bottom + padding <= right.top ||
    right.bottom + padding <= left.top
  )
}

function fireworksLabelBounds(x, y, text) {
  const width = Math.max(36, fireworksVisualTextWidth(text, 16, { widthFactor: 0.66, paddingX: 18 }))
  const height = 30
  return {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2,
    width,
    height
  }
}

function fireworksLabelPositionCandidates(points) {
  const segments = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]
    const right = points[index + 1]
    segments.push({
      left,
      right,
      length: Math.abs(right[0] - left[0]) + Math.abs(right[1] - left[1]),
      axis: fireworksSegmentAxis(left, right)
    })
  }
  segments.sort((left, right) => right.length - left.length)
  const candidates = []
  for (const segment of segments) {
    if (segment.length < 34) continue
    const x = (segment.left[0] + segment.right[0]) / 2
    const y = (segment.left[1] + segment.right[1]) / 2
    if (segment.axis === 'horizontal') {
      candidates.push([x, y - 20], [x, y + 20], [x, y - 44], [x, y + 44], [x, y - 72], [x, y + 72], [x, y - 96], [x, y + 96], [x, y])
    } else if (segment.axis === 'vertical') {
      candidates.push([x - 36, y], [x + 36, y], [x - 72, y], [x + 72, y], [x - 104, y], [x + 104, y], [x, y])
    }
  }
  return candidates.length > 0 ? candidates : [longestSegmentMidpoint(points)]
}

function fireworksChooseLabelPosition(points, text, occupiedBounds, offsetX = 0, offsetY = 0) {
  const candidates = fireworksLabelPositionCandidates(points)
  for (const candidate of candidates) {
    const labelX = candidate[0] + offsetX
    const labelY = candidate[1] + offsetY
    const box = fireworksLabelBounds(labelX, labelY, text)
    if (!occupiedBounds.some((occupied) => fireworksBoundsIntersect(box, occupied, 8))) return [labelX, labelY]
  }
  const fallbackOffsets = [
    [0, -64], [0, 64], [-64, 0], [64, 0],
    [0, -96], [0, 96], [-96, 0], [96, 0],
    [-96, -64], [96, -64], [-96, 64], [96, 64],
    [0, -128], [0, 128], [-128, 0], [128, 0],
    [0, -160], [0, 160], [-160, 0], [160, 0]
  ]
  for (const candidate of candidates) {
    for (const [extraX, extraY] of fallbackOffsets) {
      const labelX = candidate[0] + offsetX + extraX
      const labelY = candidate[1] + offsetY + extraY
      const box = fireworksLabelBounds(labelX, labelY, text)
      if (!occupiedBounds.some((occupied) => fireworksBoundsIntersect(box, occupied, 8))) return [labelX, labelY]
    }
  }
  const fallback = longestSegmentMidpoint(points)
  return [fallback[0] + offsetX, fallback[1] + offsetY]
}

function renderFireworksArrow(arrowData, index, nodeMap, profile, batchId, offsetX, offsetY, routeObstacles = [], labelObstacles = []) {
  const sourceId = nonEmptyString(arrowData?.source)
  const targetId = nonEmptyString(arrowData?.target)
  const source = nodeMap.get(sourceId)
  const target = nodeMap.get(targetId)
  if (!source || !target) {
    throw new Error(`fireworks arrow ${index + 1} references an unknown source or target.`)
  }
  const start = fireworksAnchor(source, arrowData.source_port, [target.x + target.width / 2, target.y + target.height / 2])
  const end = fireworksAnchor(target, arrowData.target_port, [source.x + source.width / 2, source.y + source.height / 2])
  const obstacles = routeObstacles.filter((obstacle) => obstacle.id !== source.id && obstacle.id !== target.id)
  const points = fireworksObstacleAwareRoute(start, end, arrowData, offsetX, offsetY, obstacles)
  const flow = fireworksFlow(arrowData.flow)
  const color = nonEmptyString(arrowData.color) ?? profile.arrowColors[flow]
  const id = slug(arrowData.id ?? `${source.id}_${target.id}_${index + 1}`, `arrow_${index + 1}`)
  const semanticId = `fireworks_arrow_${id}`
  const elements = [
    fireworksLineSpec({
      id: fireworksElementId(batchId, `arrow_${id}`),
      points,
      strokeColor: color,
      semanticId,
      batchId,
      role: `fireworks-arrow-${flow}`,
      dashed: arrowData.dashed === true || flow === 'write' || flow === 'async',
      arrow: true,
      strokeWidth: flow === 'data' ? 2.4 : 2
    })
  ]
  const labels = []
  let labelBounds = null
  const label = nonEmptyString(arrowData.label)
  if (label) {
    const [labelX, labelY] = fireworksChooseLabelPosition(
      points,
      label,
      labelObstacles,
      numberOr(arrowData.label_dx, 0),
      numberOr(arrowData.label_dy, -4)
    )
    const fontSize = 16
    const width = estimatedTextWidth(label, fontSize)
    labelBounds = fireworksLabelBounds(labelX, labelY, label)
    labels.push(fireworksTextElement({
      x: labelX - width / 2,
      y: labelY - 12,
      width,
      height: 26,
      text: label,
      fontSize,
      strokeColor: profile.textSecondary,
      semanticId: `${semanticId}_label`,
      batchId,
      role: 'fireworks-arrow-label',
      textAlign: 'center'
    }))
  }
  return { arrows: elements, labels, labelBounds }
}

function fireworksLegendSize(legend) {
  const labels = legend.map((item) => nonEmptyString(item?.label) ?? fireworksFlow(item?.flow))
  const labelWidth = Math.max(
    180,
    ...labels.map((label) => fireworksVisualTextWidth(label, 16, { widthFactor: 0.66, paddingX: 28 }))
  )
  return {
    width: Math.max(260, labelWidth + 78),
    height: Math.max(32, legend.length * 32)
  }
}

function renderFireworksLegend(legend, data, profile, batchId, offsetX, offsetY, contentBounds) {
  if (!Array.isArray(legend) || legend.length === 0) return []
  const width = Math.max(640, numberOr(data.width, 960))
  const height = Math.max(420, numberOr(data.height, 640))
  const position = nonEmptyString(data.legend_position) ?? 'bottom-left'
  const size = fireworksLegendSize(legend)
  const bounds = contentBounds ?? {
    left: offsetX + 42,
    top: offsetY + 104,
    right: offsetX + width - 42,
    bottom: offsetY + height - 42
  }
  const explicitX = Number.isFinite(data.legend_x)
  const explicitY = Number.isFinite(data.legend_y)
  const margin = 36
  let x = explicitX ? data.legend_x + offsetX : bounds.left
  let y = explicitY ? data.legend_y + offsetY : bounds.bottom + margin
  if (!explicitX) {
    if (position === 'right') {
      x = bounds.right + margin
    } else if (position.includes('right')) {
      x = Math.max(bounds.left, bounds.right - size.width)
    }
  }
  if (!explicitY && position.includes('top')) {
    y = offsetY + 104
  }
  const elements = []
  for (let index = 0; index < legend.length; index += 1) {
    const item = legend[index]
    const flow = fireworksFlow(item?.flow)
    const color = nonEmptyString(item?.color) ?? profile.arrowColors[flow]
    const itemY = y + index * 32
    const semanticId = `fireworks_legend_${index + 1}`
    elements.push(fireworksLineSpec({
      id: fireworksElementId(batchId, `legend_line_${index + 1}`),
      points: [[x, itemY], [x + 52, itemY]],
      strokeColor: color,
      semanticId: `${semanticId}_line`,
      batchId,
      role: `fireworks-legend-${flow}`,
      dashed: flow === 'write' || flow === 'async',
      arrow: true,
      strokeWidth: 2
    }))
    elements.push(fireworksTextElement({
      x: x + 70,
      y: itemY - 14,
      width: Math.max(190, size.width - 70),
      height: 28,
      text: nonEmptyString(item?.label) ?? flow,
      fontSize: 16,
      strokeColor: profile.textSecondary,
      semanticId: `${semanticId}_label`,
      batchId,
      role: 'fireworks-legend-label'
    }))
  }
  return elements
}

function resizeFireworksBackground(background, contentBounds, offsetX, offsetY, width, height) {
  if (!contentBounds) return background
  const padding = 48
  const left = Math.min(offsetX, contentBounds.left - padding)
  const top = Math.min(offsetY, contentBounds.top - padding)
  const right = Math.max(offsetX + width, contentBounds.right + padding)
  const bottom = Math.max(offsetY + height, contentBounds.bottom + padding)
  background.x = Math.round(left)
  background.y = Math.round(top)
  background.width = Math.round(right - left)
  background.height = Math.round(bottom - top)
  return background
}

export function layoutFireworksDiagram(diagram, options = {}) {
  const spec = plainObject(diagram) ?? {}
  const layout = plainObject(spec.layout) ?? {}
  const offsetX = numberOr(layout.x, numberOr(spec.x, 0))
  const offsetY = numberOr(layout.y, numberOr(spec.y, 0))
  const width = Math.max(640, numberOr(spec.width, 960))
  const height = Math.max(420, numberOr(spec.height, 640))
  const batchId = nonEmptyString(options.batchId) ?? nonEmptyString(spec.batchId) ?? `fireworks_${Date.now()}`
  const profile = fireworksStyleProfile(spec.style)
  const rawNodes = Array.isArray(spec.nodes) ? spec.nodes : []
  if (rawNodes.length === 0) throw new Error('fireworks diagram requires at least one node.')
  const rawContainers = normalizeFireworksContainers(spec.containers, offsetX, offsetY, profile)
  const rawNormalizedNodes = rawNodes.map((node, index) => normalizeFireworksNode(node, index, offsetX, offsetY, profile))
  const containerChildren = inferFireworksContainerChildren(rawContainers, rawNormalizedNodes)
  const nodeLayout = resolveFireworksNodeOverlaps(rawNormalizedNodes, layout)
  const nodes = nodeLayout.nodes
  const containerLayout = expandFireworksContainersToNodes(rawContainers, nodes, containerChildren)
  const containers = containerLayout.containers
  const layoutRepairs = [...nodeLayout.repairs, ...containerLayout.repairs]
  const nodeMap = new Map()
  for (const node of nodes) {
    for (const key of [node.id, node.sourceId, node.label]) {
      const ref = nonEmptyString(key)
      if (ref && !nodeMap.has(ref)) nodeMap.set(ref, node)
    }
  }
  const background = fireworksRectangle({
    id: fireworksElementId(batchId, 'background'),
    x: offsetX,
    y: offsetY,
    width,
    height,
    strokeColor: 'transparent',
    backgroundColor: profile.background,
    semanticId: 'fireworks_background',
    batchId,
    role: 'background',
    layoutRole: 'background',
    strokeWidth: 1
  })
  const elements = [background]

  const title = nonEmptyString(spec.title)
  if (title) {
    elements.push(fireworksTextElement({
      x: offsetX + 48,
      y: offsetY + 28,
      width: width - 96,
      height: 44,
      text: title,
      fontSize: 30,
      strokeColor: profile.titleColor,
      semanticId: 'fireworks_title',
      batchId,
      role: 'title',
      textAlign: profile.name === 'Flat Icon' ? 'center' : 'left'
    }))
  }
  const subtitle = nonEmptyString(spec.subtitle)
  if (subtitle) {
    elements.push(fireworksTextElement({
      x: offsetX + 48,
      y: offsetY + 72,
      width: width - 96,
      height: 30,
      text: subtitle,
      fontSize: 18,
      strokeColor: profile.subtitleColor,
      semanticId: 'fireworks_subtitle',
      batchId,
      role: 'subtitle',
      textAlign: profile.name === 'Flat Icon' ? 'center' : 'left'
    }))
  }

  for (const container of containers) {
    elements.push(...renderFireworksContainer(container, profile, batchId))
  }
  const nodeObstacles = nodes.map((node) => ({ ...fireworksBox(node), id: node.id }))
  const reservedObstacles = containers
    .map(fireworksContainerHeaderBounds)
    .filter(Boolean)
  const routeObstacles = [...nodeObstacles, ...reservedObstacles]
  const labelObstacles = [...routeObstacles]
  const arrowElements = []
  const arrowLabelElements = []
  const arrows = Array.isArray(spec.arrows) ? spec.arrows : []
  for (let index = 0; index < arrows.length; index += 1) {
    const rendered = renderFireworksArrow(arrows[index], index, nodeMap, profile, batchId, offsetX, offsetY, routeObstacles, labelObstacles)
    arrowElements.push(...rendered.arrows)
    arrowLabelElements.push(...rendered.labels)
    if (rendered.labelBounds) labelObstacles.push(rendered.labelBounds)
  }
  elements.push(...arrowElements)
  for (const node of nodes) {
    elements.push(...renderFireworksNode(node, profile, batchId))
  }
  elements.push(...arrowLabelElements)
  const contentBounds = fireworksElementBounds(elements, new Set(['fireworks_background']))
  elements.push(...renderFireworksLegend(spec.legend, spec, profile, batchId, offsetX, offsetY, contentBounds))
  const finalContentBounds = fireworksElementBounds(elements, new Set(['fireworks_background']))
  resizeFireworksBackground(background, finalContentBounds, offsetX, offsetY, width, height)

  const viewport = {
    x: background.x - 80,
    y: background.y - 80,
    width: background.width + 160,
    height: background.height + 160
  }
  return {
    version: 1,
    kind: 'fireworks',
    sourceFormat: 'ir',
    elements,
    viewport,
    layout: {
      engine: 'fireworks-style',
      style: profile.name,
      visualLanguage: DEFAULT_VISUAL_LANGUAGE,
      containerCount: containers.length,
      nodeCount: nodes.length,
      arrowCount: arrows.length,
      legendCount: Array.isArray(spec.legend) ? spec.legend.length : 0,
      autoRepaired: layoutRepairs.length > 0,
      autoRepairCount: layoutRepairs.length,
      width: viewport.width,
      height: viewport.height
    },
    ir: {
      version: 1,
      kind: 'fireworks',
      batchId,
      style: profile.name,
      containers,
      nodes,
      arrowCount: arrows.length,
      layoutRepairs
    }
  }
}

function graphNodeDimensions(node, layout) {
  const text = graphNodeText(node)
  const measured = measureText(text, layout.nodeFontSize, { paddingX: 74, paddingY: 44, widthFactor: 0.72, lineHeight: 1.28 })
  const width = snapUp(clampWidth(measured.width, layout.minNodeWidth, layout.maxNodeWidth), layout.grid)
  const label = graphNodeLabel(node, layout.nodeFontSize, width)
  const labelMeasured = measureText(label, layout.nodeFontSize, { paddingX: 74, paddingY: 44, widthFactor: 0.72, lineHeight: 1.28 })
  const height = snapUp(Math.max(layout.minNodeHeight, labelMeasured.height), layout.grid)
  return { width, height, label }
}

function graphLayoutConfig(kind, layout) {
  const kindDefaults = GRAPH_LAYOUT_DEFAULTS[kind] ?? GRAPH_LAYOUT_DEFAULTS.graph
  return {
    algorithm: nonEmptyString(layout.algorithm) ?? kindDefaults.algorithm,
    direction: nonEmptyString(layout.direction) ?? kindDefaults.direction
  }
}

function graphElkOptions(kind, layout) {
  const config = graphLayoutConfig(kind, layout)
  return {
    'elk.algorithm': config.algorithm,
    'elk.direction': config.direction,
    'elk.edgeRouting': 'POLYLINE',
    'elk.spacing.nodeNode': String(numberOr(layout.nodeSpacing, DEFAULT_GRAPH_LAYOUT.nodeSpacing)),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(numberOr(layout.layerSpacing, DEFAULT_GRAPH_LAYOUT.layerSpacing)),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.max(24, numberOr(layout.nodeSpacing, DEFAULT_GRAPH_LAYOUT.nodeSpacing) / 2)),
    'elk.mrtree.spacing.nodeNode': String(numberOr(layout.nodeSpacing, DEFAULT_GRAPH_LAYOUT.nodeSpacing)),
    'elk.stress.desiredEdgeLength': String(Math.max(120, numberOr(layout.layerSpacing, DEFAULT_GRAPH_LAYOUT.layerSpacing)))
  }
}

function positionedNodeMap(layoutGraph) {
  const nodes = new Map()
  for (const node of Array.isArray(layoutGraph.children) ? layoutGraph.children : []) {
    nodes.set(node.id, node)
  }
  return nodes
}

function edgePointsFromLayout(edgeLayout, sourceNode, targetNode, offsetX, offsetY) {
  const section = Array.isArray(edgeLayout?.sections) ? edgeLayout.sections[0] : null
  if (section?.startPoint && section?.endPoint) {
    const points = [
      [section.startPoint.x + offsetX, section.startPoint.y + offsetY],
      ...(Array.isArray(section.bendPoints) ? section.bendPoints.map((point) => [point.x + offsetX, point.y + offsetY]) : []),
      [section.endPoint.x + offsetX, section.endPoint.y + offsetY]
    ]
    return points
  }
  return [
    [sourceNode.x + sourceNode.width / 2 + offsetX, sourceNode.y + sourceNode.height / 2 + offsetY],
    [targetNode.x + targetNode.width / 2 + offsetX, targetNode.y + targetNode.height / 2 + offsetY]
  ]
}

function graphViewport(originX, originY, titleHeight, subtitleHeight, titleSubtitleGap, layoutGraph, layout) {
  const children = Array.isArray(layoutGraph.children) ? layoutGraph.children : []
  const minX = children.length > 0 ? Math.min(...children.map((node) => node.x)) : 0
  const minY = children.length > 0 ? Math.min(...children.map((node) => node.y)) : 0
  const maxX = children.length > 0 ? Math.max(...children.map((node) => node.x + node.width)) : 1
  const maxY = children.length > 0 ? Math.max(...children.map((node) => node.y + node.height)) : 1
  const graphY = originY + titleHeight + titleSubtitleGap + subtitleHeight + layout.graphTopGap
  return {
    x: originX + minX - layout.canvasPadding,
    y: originY - layout.canvasPadding,
    width: maxX - minX + layout.canvasPadding * 2,
    height: graphY - originY + maxY - minY + layout.canvasPadding * 2
  }
}

async function layoutGraphDiagram(kind, diagram, options = {}) {
  const ir = normalizeGraphDiagram(kind, diagram, options)
  const layout = ir.layout
  const originX = numberOr(layout.x, 0)
  const originY = numberOr(layout.y, 0)
  const nodeSizes = new Map(ir.nodes.map((node) => [node.id, graphNodeDimensions(node, layout)]))
  const elkGraph = {
    id: `${ir.kind}_root`,
    layoutOptions: graphElkOptions(ir.kind, layout),
    children: ir.nodes.map((node) => {
      const dimensions = nodeSizes.get(node.id)
      return {
        id: node.id,
        width: dimensions.width,
        height: dimensions.height
      }
    }),
    edges: ir.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to]
    }))
  }
  const layoutGraph = await elk.layout(elkGraph)
  const nodesById = positionedNodeMap(layoutGraph)
  const titleText = ir.title ? wrapText(ir.title, 62) : null
  const subtitleText = ir.subtitle ? wrapText(ir.subtitle, 72) : null
  const titleMetrics = titleText ? measureText(titleText, layout.titleFontSize, { paddingX: 0, paddingY: 34, lineHeight: 1.35 }) : null
  const subtitleMetrics = subtitleText ? measureText(subtitleText, layout.subtitleFontSize, { paddingX: 0, paddingY: 34, lineHeight: 1.35 }) : null
  const titleHeight = titleMetrics?.height ?? 0
  const titleSubtitleGap = titleText && subtitleText ? layout.titleGap : 0
  const subtitleHeight = subtitleMetrics?.height ?? 0
  const graphY = originY + titleHeight + titleSubtitleGap + subtitleHeight + layout.graphTopGap
  const elements = []
  const graphWidth = Math.max(320, numberOr(layoutGraph.width, 320))

  if (titleText) {
    elements.push(textElement({
      x: originX,
      y: originY,
      width: graphWidth,
      height: titleHeight,
      text: titleText,
      fontSize: layout.titleFontSize,
      strokeColor: UNIFIED_DIAGRAM_STYLE.titleColor,
      semanticId: `${ir.kind}_title`,
      batchId: ir.batchId,
      role: 'title'
    }))
  }
  if (subtitleText) {
    elements.push(textElement({
      x: originX,
      y: originY + titleHeight + titleSubtitleGap,
      width: graphWidth,
      height: subtitleHeight,
      text: subtitleText,
      fontSize: layout.subtitleFontSize,
      strokeColor: UNIFIED_DIAGRAM_STYLE.subtitleColor,
      semanticId: `${ir.kind}_subtitle`,
      batchId: ir.batchId,
      role: 'subtitle'
    }))
  }

  for (const node of ir.nodes) {
    const positioned = nodesById.get(node.id)
    if (!positioned) {
      throw new Error(`${ir.kind} diagram node ${node.id} was not returned by the layout engine.`)
    }
    const dimensions = nodeSizes.get(node.id)
    elements.push(shape(node.shape, {
      x: snap(originX + positioned.x, layout.grid),
      y: snap(graphY + positioned.y, layout.grid),
      width: dimensions.width,
      height: dimensions.height,
      label: dimensions.label,
      fontSize: layout.nodeFontSize,
      strokeColor: node.strokeColor,
      backgroundColor: node.color,
      semanticId: `${ir.kind}_node_${node.id}`,
      batchId: ir.batchId,
      role: semanticRoleForGraphNode(ir.kind, node)
    }))
  }

  const layoutEdges = new Map((Array.isArray(layoutGraph.edges) ? layoutGraph.edges : []).map((edge) => [edge.id, edge]))
  for (const edge of ir.edges) {
    const source = nodesById.get(edge.from)
    const target = nodesById.get(edge.to)
    if (!source || !target) {
      throw new Error(`${ir.kind} diagram edge ${edge.id} was not returned with valid endpoints.`)
    }
    const points = edgePointsFromLayout(layoutEdges.get(edge.id), source, target, originX, graphY)
    elements.push(polyline({
      points,
      label: edge.label,
      fontSize: layout.edgeFontSize,
      strokeColor: edge.color,
      semanticId: `${ir.kind}_edge_${edge.id}`,
      batchId: ir.batchId,
      role: semanticRoleForGraphEdge(ir.kind, edge),
      dashed: edge.dashed
    }))
  }

  const viewport = graphViewport(originX, originY, titleHeight, subtitleHeight, titleSubtitleGap, layoutGraph, layout)
  return {
    version: 1,
    kind: ir.kind,
    sourceFormat: 'ir',
    elements,
    viewport,
    layout: {
      engine: 'elk',
      algorithm: graphLayoutConfig(ir.kind, layout).algorithm,
      direction: graphLayoutConfig(ir.kind, layout).direction,
      nodeCount: ir.nodes.length,
      edgeCount: ir.edges.length,
      visualLanguage: DEFAULT_VISUAL_LANGUAGE,
      width: viewport.width,
      height: viewport.height
    },
    ir
  }
}

function attachmentLaneCenter(attachment, participantMap, participants, leftCenter, rightCenter) {
  const laneId = attachment.lane ?? attachment.to ?? attachment.from
  if (laneId && participantMap.has(laneId)) return participantMap.get(laneId).centerX
  if (Number.isFinite(leftCenter) && Number.isFinite(rightCenter)) return (leftCenter + rightCenter) / 2
  return participants[Math.floor(participants.length / 2)]?.centerX ?? 0
}

function attachmentElement(attachment, context) {
  const { batchId, layout, participantMap, participants, leftCenter, rightCenter, y } = context
  const centerX = attachmentLaneCenter(attachment, participantMap, participants, leftCenter, rightCenter)
  const fontSize = attachment.kind === 'gate' ? layout.gateFontSize : layout.noteFontSize
  if (attachment.kind === 'gate') {
    const label = wrapTextToWidth(attachment.text, fontSize, layout.gateWidth, { paddingX: 48, widthFactor: 0.78 })
    return shape('diamond', {
      x: snap(centerX - layout.gateWidth / 2, layout.grid),
      y,
      width: layout.gateWidth,
      height: layout.gateHeight,
      label,
      fontSize,
      strokeColor: attachment.color ?? DECISION_STROKE_COLOR,
      backgroundColor: attachment.backgroundColor ?? DECISION_FILL_COLOR,
      semanticId: `seq_gate_${attachment.id}`,
      batchId,
      role: 'gate'
    })
  }
  const label = wrapTextToWidth(attachment.text, fontSize, layout.noteMaxWidth, { paddingX: 56, widthFactor: 0.76 })
  const measured = measureText(label, fontSize)
  const width = clampWidth(measured.width + 20, 280, layout.noteMaxWidth + 40)
  const height = Math.max(82, measured.height + 10)
  return shape('rectangle', {
    x: snap(centerX - width / 2, layout.grid),
    y,
    width,
    height,
    label,
    fontSize,
    strokeColor: attachment.color ?? UNIFIED_DIAGRAM_STYLE.textSecondary,
    backgroundColor: attachment.backgroundColor ?? '#f8fafc',
    semanticId: `seq_note_${attachment.id}`,
    batchId,
    role: 'note'
  })
}

function groupAttachments(attachments) {
  const grouped = new Map()
  for (const attachment of attachments) {
    if (!attachment.afterMessageId) continue
    const current = grouped.get(attachment.afterMessageId) ?? []
    current.push(attachment)
    grouped.set(attachment.afterMessageId, current)
  }
  return grouped
}

export function layoutSequenceDiagram(diagram, options = {}) {
  const spec = plainObject(diagram) ?? {}
  const layout = { ...DEFAULT_SEQUENCE_LAYOUT, ...(plainObject(spec.layout) ?? {}), ...(plainObject(options.layout) ?? {}) }
  const batchId = nonEmptyString(options.batchId) ?? nonEmptyString(spec.batchId) ?? `sequence_${Date.now()}`
  const participants = normalizeParticipants(spec)
  if (participants.length < 2) {
    throw new Error('sequence diagram requires at least two participants.')
  }
  const messages = normalizeMessages(spec)
  if (messages.length === 0) {
    throw new Error('sequence diagram requires at least one message.')
  }
  const notes = normalizeAttachments(spec, 'notes', 'note')
  const gates = normalizeAttachments(spec, 'gates', 'gate')
  const attachmentsByMessage = groupAttachments([...notes, ...gates])

  const originX = numberOr(layout.x, 0)
  const originY = numberOr(layout.y, 0)
  const participantWidth = snapUp(
    clampWidth(
      Math.max(
        layout.participantMinWidth,
        ...participants.map((participant) => measureText(participant.label, 18, { widthFactor: 0.86, paddingX: 90 }).width)
      ),
      layout.participantMinWidth,
      numberOr(layout.participantMaxWidth, DEFAULT_SEQUENCE_LAYOUT.participantMaxWidth)
    ),
    layout.grid
  )
  const participantLabels = new Map(participants.map((participant) => [
    participant.id,
    wrapTextToWidth(participant.label, 18, participantWidth, { paddingX: 64, widthFactor: 0.84 })
  ]))
  const participantHeight = snapUp(
    Math.max(
      layout.participantHeight,
      ...[...participantLabels.values()].map((label) => measureText(label, 18, { widthFactor: 0.84, paddingX: 64, paddingY: 30 }).height)
    ),
    layout.grid
  )
  const laneGap = Math.max(layout.laneGap, participantWidth + 110)
  const titleText = nonEmptyString(spec.title) ? wrapText(nonEmptyString(spec.title), 54) : null
  const subtitleText = nonEmptyString(spec.subtitle) ? wrapText(nonEmptyString(spec.subtitle), 64) : null
  const titleMetrics = titleText ? measureText(titleText, layout.titleFontSize, { paddingX: 0, paddingY: 34, lineHeight: 1.35 }) : null
  const subtitleMetrics = subtitleText ? measureText(subtitleText, layout.subtitleFontSize, { paddingX: 0, paddingY: 34, lineHeight: 1.35 }) : null
  const titleHeight = titleMetrics?.height ?? 0
  const titleSubtitleGap = titleText && subtitleText ? 14 : 0
  const subtitleHeight = subtitleMetrics?.height ?? 0
  const subtitleY = originY + titleHeight + titleSubtitleGap
  const participantY = subtitleY + subtitleHeight + 48

  const placedParticipants = participants.map((participant, index) => {
    const x = snap(originX + index * laneGap, layout.grid)
    return {
      ...participant,
      x,
      y: participantY,
      width: participantWidth,
      height: participantHeight,
      centerX: x + participantWidth / 2
    }
  })
  const participantMap = new Map(placedParticipants.map((participant) => [participant.id, participant]))
  const totalWidth = (placedParticipants.at(-1)?.x ?? originX) - originX + participantWidth
  const elements = []

  if (titleText) {
    elements.push(textElement({
      x: originX,
      y: originY,
      width: totalWidth,
      height: titleHeight,
      text: titleText,
      fontSize: layout.titleFontSize,
      strokeColor: UNIFIED_DIAGRAM_STYLE.titleColor,
      semanticId: 'seq_title',
      batchId,
      role: 'title'
    }))
  }
  if (subtitleText) {
    elements.push(textElement({
      x: originX,
      y: subtitleY,
      width: totalWidth,
      height: subtitleHeight,
      text: subtitleText,
      fontSize: layout.subtitleFontSize,
      strokeColor: UNIFIED_DIAGRAM_STYLE.subtitleColor,
      semanticId: 'seq_subtitle',
      batchId,
      role: 'subtitle'
    }))
  }

  for (const participant of placedParticipants) {
    elements.push(shape('rectangle', {
      x: participant.x,
      y: participant.y,
      width: participant.width,
      height: participant.height,
      label: participantLabels.get(participant.id) ?? participant.label,
      fontSize: 18,
      strokeColor: UNIFIED_DIAGRAM_STYLE.nodeStroke,
      backgroundColor: participant.color,
      semanticId: `seq_participant_${participant.id}`,
      batchId,
      role: 'participant'
    }))
  }

  const messageElements = []
  let yCursor = participantY + participantHeight + 56
  for (const message of messages) {
    const from = participantMap.get(message.from)
    const to = participantMap.get(message.to)
    if (!from || !to) {
      throw new Error(`sequence message ${message.id} references an unknown participant.`)
    }
    const rowTop = yCursor
    const messageLabel = wrapTextToWidth(
      message.label,
      layout.messageFontSize,
      Math.max(260, Math.abs(to.centerX - from.centerX) - 40),
      { paddingX: 28, widthFactor: 0.76 }
    )
    messageElements.push(arrow({
      x1: from.centerX,
      y1: rowTop,
      x2: to.centerX,
      y2: rowTop,
      label: messageLabel,
      fontSize: layout.messageFontSize,
      strokeColor: message.color,
      semanticId: `seq_message_${message.id}`,
      batchId
    }))
    let attachmentY = rowTop + 28
    let attachmentHeight = 0
    for (const attachment of attachmentsByMessage.get(message.id) ?? []) {
      const element = attachmentElement(attachment, {
        batchId,
        layout,
        participantMap,
        participants: placedParticipants,
        leftCenter: Math.min(from.centerX, to.centerX),
        rightCenter: Math.max(from.centerX, to.centerX),
        y: attachmentY
      })
      messageElements.push(element)
      const consumed = element.height + layout.attachmentGap
      attachmentY += consumed
      attachmentHeight += consumed
    }
    const messageLabelHeight = measureText(messageLabel, layout.messageFontSize, { paddingX: 24, paddingY: 18 }).height
    yCursor += Math.max(numberOr(message.rowGap, layout.rowGap), attachmentHeight + messageLabelHeight + 32)
  }

  const lifelineTop = participantY + participantHeight + 10
  const lifelineBottom = Math.max(yCursor + 20, lifelineTop + 300)
  for (const participant of placedParticipants) {
    elements.push(line({
      x1: participant.centerX,
      y1: lifelineTop,
      x2: participant.centerX,
      y2: lifelineBottom,
      strokeColor: UNIFIED_DIAGRAM_STYLE.textMuted,
      semanticId: `seq_lifeline_${participant.id}`,
      batchId,
      dashed: true
    }))
  }
  elements.push(...messageElements)

  const viewport = {
    x: originX - 80,
    y: originY - 80,
    width: totalWidth + 160,
    height: lifelineBottom - originY + 160
  }
  return {
    kind: 'sequence',
    elements,
    viewport,
    layout: {
      participantCount: placedParticipants.length,
      messageCount: messages.length,
      noteCount: notes.length,
      gateCount: gates.length,
      laneGap,
      participantWidth,
      participantHeight,
      visualLanguage: DEFAULT_VISUAL_LANGUAGE,
      width: viewport.width,
      height: viewport.height
    }
  }
}

export async function layoutDiagram(kind, diagram, options = {}) {
  const diagramKind = nonEmptyString(kind)
  if (diagramKind === 'sequence') {
    return layoutSequenceDiagram(diagram, options)
  }
  if (diagramKind === 'fireworks') {
    return layoutFireworksDiagram(diagram, options)
  }
  if (GRAPH_DIAGRAM_KINDS.has(diagramKind)) {
    return layoutGraphDiagram(diagramKind, diagram, options)
  }
  throw new Error(`Unsupported diagram kind: ${diagramKind ?? 'unknown'}.`)
}

export function supportedDiagramKinds() {
  return ['sequence', 'fireworks', ...GRAPH_DIAGRAM_KINDS]
}
