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

const PARTICIPANT_COLORS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#ede9fe', '#ccfbf1']
const MESSAGE_COLORS = ['#2563eb', '#a16207', '#15803d', '#ca8a04', '#be185d', '#7c3aed', '#0f766e']
const GRAPH_NODE_COLORS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#ede9fe', '#ccfbf1', '#fee2e2']
const GRAPH_EDGE_COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#a16207', '#be185d', '#475569']
const GRAPH_DIAGRAM_KINDS = new Set(['flowchart', 'graph', 'class', 'er', 'state', 'mindmap'])
const GRAPH_NODE_SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])
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
      strokeColor: nonEmptyString(item.strokeColor) ?? '#334155',
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
    fillStyle: 'hachure',
    roughness: 2,
    strokeWidth: 2,
    ...extra
  }
}

function codexData(batchId, semanticId, role) {
  return {
    codex: {
      createdBy: 'codex',
      batchId,
      semanticId,
      role
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
      roughness: 2,
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
      roughness: 2,
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
      roughness: 2,
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
      roughness: 2
    },
    customData: codexData(batchId, semanticId, role ?? 'text')
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
      strokeColor: '#1f2937',
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
      strokeColor: '#4b5563',
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
      strokeColor: attachment.color ?? '#dc2626',
      backgroundColor: attachment.backgroundColor ?? '#fee2e2',
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
    strokeColor: attachment.color ?? '#475569',
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
      strokeColor: '#1f2937',
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
      strokeColor: '#4b5563',
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
      strokeColor: '#334155',
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
      strokeColor: '#94a3b8',
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
  if (GRAPH_DIAGRAM_KINDS.has(diagramKind)) {
    return layoutGraphDiagram(diagramKind, diagram, options)
  }
  throw new Error(`Unsupported diagram kind: ${diagramKind ?? 'unknown'}.`)
}

export function supportedDiagramKinds() {
  return ['sequence', ...GRAPH_DIAGRAM_KINDS]
}
