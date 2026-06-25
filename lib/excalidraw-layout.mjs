const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const TEXT_TYPES = new Set(['text'])
const LINE_TYPES = new Set(['arrow', 'line'])
const DIRECTIVE_TYPES = new Set(['cameraUpdate', 'delete', 'restoreCheckpoint'])
const SKIPPED_OVERLAP_ROLES = new Set(['background', 'container', 'zone', 'lane', 'section', 'group', 'flow_lane'])

const MIN_SHAPE_WIDTH = 120
const MIN_SHAPE_HEIGHT = 60
const MIN_TEXT_FONT_SIZE = 16
const MIN_ARROW_LABEL_FONT_SIZE = 14
const MIN_GAP = 24
const LARGE_LAYOUT_AREA = 160_000
const MAX_OVERLAP_REPAIR_PASSES = 8
const MAX_SAFE_OVERLAP_REPAIR_PAIRS = 4
const MAX_SAFE_OVERLAP_REPAIR_ELEMENTS = 4
const POINT_EPSILON = 0.001

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function elementRef(spec, index) {
  return {
    id: nonEmptyString(spec?.id),
    semanticId: nonEmptyString(spec?.semanticId) ?? nonEmptyString(spec?.customData?.codex?.semanticId),
    type: nonEmptyString(spec?.type),
    index
  }
}

function pushIssue(report, code, spec, index, details = {}) {
  report.issues.push({
    code,
    ...elementRef(spec, index),
    ...details
  })
}

function pushRepair(report, code, spec, index, details = {}) {
  report.repairs.push({
    code,
    ...elementRef(spec, index),
    ...details
  })
}

function cloneSpec(spec) {
  if (!plainObject(spec)) return spec
  const next = { ...spec }
  if (plainObject(spec.style)) next.style = { ...spec.style }
  if (plainObject(spec.label)) next.label = { ...spec.label }
  if (plainObject(spec.customData)) next.customData = { ...spec.customData }
  return next
}

function textLength(value) {
  return Array.from(String(value ?? '')).length
}

function textLines(value) {
  return String(value ?? '').split('\n')
}

function estimateTextBounds(text, fontSize, lineHeight = 1.25) {
  const lines = textLines(text)
  const maxLine = Math.max(1, ...lines.map(textLength))
  return {
    width: Math.ceil(maxLine * fontSize * 0.76 + 64),
    height: Math.ceil(Math.max(1, lines.length) * fontSize * lineHeight + 36)
  }
}

function labelText(spec) {
  if (typeof spec.label === 'string') return spec.label
  if (plainObject(spec.label)) return spec.label.text
  return spec.text
}

function ensureMinNumber(spec, field, minValue, report, index) {
  const current = finiteNumber(spec[field])
  if (current === null || current >= minValue) return spec[field]
  pushIssue(report, `${field}-too-small`, spec, index, { field, value: current, minimum: minValue })
  pushRepair(report, `${field}-expanded`, spec, index, { field, from: current, to: minValue })
  return minValue
}

function ensureFontSize(spec, report, index, field = 'fontSize', minimum = MIN_TEXT_FONT_SIZE) {
  const current = finiteNumber(spec[field])
  if (current === null) return spec[field]
  if (current >= minimum) return current
  pushIssue(report, 'font-size-too-small', spec, index, { field, value: current, minimum })
  pushRepair(report, 'font-size-raised', spec, index, { field, from: current, to: minimum })
  return minimum
}

function hexNibble(char) {
  const code = char.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 65 && code <= 70) return code - 55
  if (code >= 97 && code <= 102) return code - 87
  return null
}

function readHexByte(text, offset) {
  const high = hexNibble(text[offset])
  const low = hexNibble(text[offset + 1])
  if (high === null || low === null) return null
  return high * 16 + low
}

function hexColor(value) {
  const text = nonEmptyString(value)
  if (!text || text.length !== 7 || text[0] !== '#') return null
  const red = readHexByte(text, 1)
  const green = readHexByte(text, 3)
  const blue = readHexByte(text, 5)
  if (red === null || green === null || blue === null) return null
  return { red, green, blue }
}

function channelLuminance(value) {
  const normalized = value / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(color) {
  return 0.2126 * channelLuminance(color.red) +
    0.7152 * channelLuminance(color.green) +
    0.0722 * channelLuminance(color.blue)
}

function contrastRatio(left, right) {
  const leftLum = luminance(left)
  const rightLum = luminance(right)
  const lighter = Math.max(leftLum, rightLum)
  const darker = Math.min(leftLum, rightLum)
  return (lighter + 0.05) / (darker + 0.05)
}

function readableStrokeFor(backgroundColor) {
  const background = hexColor(backgroundColor)
  if (!background) return null
  return luminance(background) > 0.45 ? '#1f2937' : '#f8fafc'
}

function ensureContrast(spec, report, index) {
  const style = plainObject(spec.style) ? spec.style : {}
  const backgroundColor = nonEmptyString(style.backgroundColor)
  const strokeColor = nonEmptyString(style.strokeColor)
  if (!backgroundColor || backgroundColor === 'transparent' || !strokeColor || strokeColor === 'transparent') return spec
  const background = hexColor(backgroundColor)
  const stroke = hexColor(strokeColor)
  if (!background || !stroke) return spec
  if (contrastRatio(background, stroke) >= 3) return spec
  const nextStroke = readableStrokeFor(backgroundColor)
  if (!nextStroke) return spec
  spec.style = { ...style, strokeColor: nextStroke }
  pushIssue(report, 'low-contrast', spec, index, { backgroundColor, strokeColor })
  pushRepair(report, 'stroke-contrast-adjusted', spec, index, { from: strokeColor, to: nextStroke })
  return spec
}

function normalizedPoint(point) {
  if (!Array.isArray(point) || point.length < 2) return null
  const x = finiteNumber(point[0])
  const y = finiteNumber(point[1])
  if (x === null || y === null) return null
  return [x, y]
}

function nearlyEqual(left, right, epsilon = POINT_EPSILON) {
  return Math.abs(left - right) <= epsilon
}

function pointBounds(points) {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  }
}

function normalizeLinearPoints(spec, report, index) {
  if (!Array.isArray(spec.points) || spec.points.length < 2) return spec
  const points = spec.points.map(normalizedPoint)
  if (points.some((point) => point === null)) return spec
  const x = finiteNumber(spec.x)
  const y = finiteNumber(spec.y)
  if (x === null || y === null) return spec
  const [firstX, firstY] = points[0]
  if (!nearlyEqual(firstX, x) || !nearlyEqual(firstY, y)) return spec

  const bounds = pointBounds(points)
  spec.x = bounds.minX
  spec.y = bounds.minY
  spec.points = points.map(([pointX, pointY]) => [pointX - bounds.minX, pointY - bounds.minY])
  spec.width = bounds.width
  spec.height = bounds.height
  pushIssue(report, 'line-points-absolute-coordinate-risk', spec, index, { originalX: x, originalY: y })
  pushRepair(report, 'line-points-normalized-to-relative', spec, index, { x: spec.x, y: spec.y, width: spec.width, height: spec.height })
  return spec
}

function normalizeShapeSpec(spec, report, index) {
  spec.width = ensureMinNumber(spec, 'width', MIN_SHAPE_WIDTH, report, index) ?? MIN_SHAPE_WIDTH
  spec.height = ensureMinNumber(spec, 'height', MIN_SHAPE_HEIGHT, report, index) ?? MIN_SHAPE_HEIGHT
  const label = labelText(spec)
  const labelObject = plainObject(spec.label)
  const style = plainObject(spec.style) ? spec.style : {}
  const fontSize = Math.max(
    MIN_TEXT_FONT_SIZE,
    numberOr(labelObject?.fontSize, numberOr(spec.fontSize, numberOr(style.fontSize, 22)))
  )
  if (labelObject && finiteNumber(labelObject.fontSize) !== null && labelObject.fontSize < MIN_TEXT_FONT_SIZE) {
    spec.label = { ...labelObject, fontSize }
    pushIssue(report, 'label-font-size-too-small', spec, index, { value: labelObject.fontSize, minimum: MIN_TEXT_FONT_SIZE })
    pushRepair(report, 'label-font-size-raised', spec, index, { from: labelObject.fontSize, to: fontSize })
  }
  if (label) {
    const estimated = estimateTextBounds(label, fontSize)
    if (spec.width < estimated.width) {
      pushIssue(report, 'label-width-overflow-risk', spec, index, { value: spec.width, minimum: estimated.width })
      pushRepair(report, 'shape-width-fits-label', spec, index, { from: spec.width, to: estimated.width })
      spec.width = estimated.width
    }
    if (spec.height < estimated.height) {
      pushIssue(report, 'label-height-overflow-risk', spec, index, { value: spec.height, minimum: estimated.height })
      pushRepair(report, 'shape-height-fits-label', spec, index, { from: spec.height, to: estimated.height })
      spec.height = estimated.height
    }
  }
  return ensureContrast(spec, report, index)
}

function normalizeTextSpec(spec, report, index) {
  const style = spec.style && typeof spec.style === 'object' ? spec.style : {}
  if (finiteNumber(spec.fontSize) === null && finiteNumber(style.fontSize) !== null) {
    spec.fontSize = style.fontSize
  }
  spec.fontSize = ensureFontSize(spec, report, index, 'fontSize', MIN_TEXT_FONT_SIZE) ?? MIN_TEXT_FONT_SIZE
  const estimated = estimateTextBounds(spec.text, spec.fontSize, numberOr(spec.lineHeight, 1.25))
  if (!Number.isFinite(spec.width) || spec.width < estimated.width) {
    if (Number.isFinite(spec.width)) {
      pushIssue(report, 'text-width-overflow-risk', spec, index, { value: spec.width, minimum: estimated.width })
      pushRepair(report, 'text-width-expanded', spec, index, { from: spec.width, to: estimated.width })
    }
    spec.width = estimated.width
  }
  if (!Number.isFinite(spec.height) || spec.height < estimated.height) {
    if (Number.isFinite(spec.height)) {
      pushIssue(report, 'text-height-overflow-risk', spec, index, { value: spec.height, minimum: estimated.height })
      pushRepair(report, 'text-height-expanded', spec, index, { from: spec.height, to: estimated.height })
    }
    spec.height = estimated.height
  }
  return ensureContrast(spec, report, index)
}

function normalizeLineSpec(spec, report, index) {
  normalizeLinearPoints(spec, report, index)
  if (plainObject(spec.label)) {
    const current = finiteNumber(spec.label.fontSize)
    if (current !== null && current < MIN_ARROW_LABEL_FONT_SIZE) {
      spec.label = { ...spec.label, fontSize: MIN_ARROW_LABEL_FONT_SIZE }
      pushIssue(report, 'line-label-font-size-too-small', spec, index, { value: current, minimum: MIN_ARROW_LABEL_FONT_SIZE })
      pushRepair(report, 'line-label-font-size-raised', spec, index, { from: current, to: MIN_ARROW_LABEL_FONT_SIZE })
    }
  }
  return ensureContrast(spec, report, index)
}

function layoutBox(spec) {
  const type = nonEmptyString(spec.type)
  if (!SHAPE_TYPES.has(type) && !TEXT_TYPES.has(type)) return null
  const role = nonEmptyString(spec.layoutRole) ??
    nonEmptyString(spec.customData?.codex?.layoutRole) ??
    nonEmptyString(spec.customData?.codex?.role)
  if (role && SKIPPED_OVERLAP_ROLES.has(role)) return null
  if (nonEmptyString(spec.containerId)) return null
  const width = numberOr(spec.width, 1)
  const height = numberOr(spec.height, 1)
  if (width * height >= LARGE_LAYOUT_AREA) return null
  return {
    x: numberOr(spec.x, 0),
    y: numberOr(spec.y, 0),
    width,
    height
  }
}

function boxesOverlapWithGap(left, right, gap = MIN_GAP) {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  )
}

function collectOverlapPairs(elements) {
  const boxes = []
  const pairs = []
  for (let index = 0; index < elements.length; index += 1) {
    const spec = elements[index]
    if (!plainObject(spec) || DIRECTIVE_TYPES.has(spec.type)) continue
    const box = layoutBox(spec)
    if (!box) continue
    for (const previous of boxes) {
      if (!boxesOverlapWithGap(box, previous.box)) continue
      pairs.push({
        leftIndex: previous.index,
        rightIndex: index,
        left: previous.spec,
        right: spec
      })
    }
    boxes.push({ index, spec, box })
  }
  return pairs
}

function collectLayoutBoxes(elements) {
  const boxes = []
  for (let index = 0; index < elements.length; index += 1) {
    const spec = elements[index]
    if (!plainObject(spec) || DIRECTIVE_TYPES.has(spec.type)) continue
    const box = layoutBox(spec)
    if (!box) continue
    boxes.push({ index, spec, box })
  }
  return boxes
}

function verticalOverlap(left, right) {
  const top = Math.max(left.y, right.y)
  const bottom = Math.min(left.y + left.height, right.y + right.height)
  return Math.max(0, bottom - top)
}

function belongsToRow(item, row) {
  const overlap = verticalOverlap(item.box, row.box)
  const minimumHeight = Math.max(1, Math.min(item.box.height, row.box.height))
  if (overlap / minimumHeight >= 0.55) return true
  const itemCenter = item.box.y + item.box.height / 2
  const rowCenter = row.box.y + row.box.height / 2
  return Math.abs(itemCenter - rowCenter) <= Math.max(MIN_GAP, minimumHeight * 0.35)
}

function expandRowBox(row, box) {
  const left = Math.min(row.box.x, box.x)
  const top = Math.min(row.box.y, box.y)
  const right = Math.max(row.box.x + row.box.width, box.x + box.width)
  const bottom = Math.max(row.box.y + row.box.height, box.y + box.height)
  row.box = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

function groupLayoutRows(boxes) {
  const rows = []
  const sorted = [...boxes].sort((left, right) => {
    if (left.box.y !== right.box.y) return left.box.y - right.box.y
    return left.box.x - right.box.x
  })
  for (const item of sorted) {
    const row = rows.find((candidate) => belongsToRow(item, candidate))
    if (!row) {
      rows.push({ box: { ...item.box }, items: [item] })
      continue
    }
    row.items.push(item)
    expandRowBox(row, item.box)
  }
  return rows
}

function repairRowOverlaps(elements, report) {
  const rows = groupLayoutRows(collectLayoutBoxes(elements))
  let movedCount = 0
  for (const row of rows) {
    if (row.items.length < 2) continue
    const items = row.items.sort((left, right) => {
      if (left.box.x !== right.box.x) return left.box.x - right.box.x
      return left.index - right.index
    })
    let rightEdge = items[0].box.x + items[0].box.width
    for (let offset = 1; offset < items.length; offset += 1) {
      const item = items[offset]
      const minimumX = rightEdge + MIN_GAP
      if (item.box.x < minimumX) {
        pushIssue(report, 'element-row-overlap-risk', item.spec, item.index, { value: item.box.x, repairedX: minimumX })
        pushRepair(report, 'element-shifted-right-to-avoid-row-overlap', item.spec, item.index, { from: item.box.x, to: minimumX })
        item.spec.x = minimumX
        item.box.x = minimumX
        movedCount += 1
      }
      rightEdge = item.box.x + item.box.width
    }
  }
  return movedCount
}

function markHighRiskOverlap(elements, report, pairs) {
  const affected = new Set()
  for (const pair of pairs) {
    affected.add(pair.leftIndex)
    affected.add(pair.rightIndex)
    pushIssue(report, 'element-overlap-risk', pair.right, pair.rightIndex, {
      overlapsWithIndex: pair.leftIndex,
      overlapsWithId: nonEmptyString(pair.left.id),
      overlapsWithSemanticId: nonEmptyString(pair.left.semanticId) ?? nonEmptyString(pair.left.customData?.codex?.semanticId)
    })
  }
  report.needsRedraw = true
  report.redrawReason = 'high-risk-overlap'
  report.overlapRisk = {
    pairCount: pairs.length,
    affectedElementCount: affected.size,
    repairMode: 'diagnostic'
  }
  pushIssue(report, 'overlap-redraw-required', null, null, {
    pairCount: pairs.length,
    affectedElementCount: affected.size,
    recommendation: 'Split this drawing into sections or use a structured diagram layout before inserting again.'
  })
}

function repairOverlaps(elements, report) {
  const initialPairs = collectOverlapPairs(elements)
  const rowRepairCount = initialPairs.length > 0 ? repairRowOverlaps(elements, report) : 0
  const pairs = collectOverlapPairs(elements)
  if (pairs.length === 0) {
    report.overlapRisk = {
      pairCount: initialPairs.length,
      affectedElementCount: 0,
      repairMode: rowRepairCount > 0 ? 'auto' : 'none'
    }
    return
  }
  const affected = new Set()
  for (const pair of pairs) {
    affected.add(pair.leftIndex)
    affected.add(pair.rightIndex)
  }
  if (pairs.length > MAX_SAFE_OVERLAP_REPAIR_PAIRS || affected.size > MAX_SAFE_OVERLAP_REPAIR_ELEMENTS) {
    markHighRiskOverlap(elements, report, pairs)
    return
  }

  const boxes = []
  for (let index = 0; index < elements.length; index += 1) {
    const spec = elements[index]
    if (!plainObject(spec) || DIRECTIVE_TYPES.has(spec.type)) continue
    const box = layoutBox(spec)
    if (!box) continue
    let nextY = box.y
    for (let pass = 0; pass < MAX_OVERLAP_REPAIR_PASSES; pass += 1) {
      let moved = false
      const current = { ...box, y: nextY }
      for (const previous of boxes) {
        if (!boxesOverlapWithGap(current, previous.box)) continue
        nextY = Math.max(nextY, previous.box.y + previous.box.height + MIN_GAP)
        moved = true
      }
      if (!moved) break
    }
    if (nextY !== box.y) {
      pushIssue(report, 'element-overlap-risk', spec, index, { value: box.y, repairedY: nextY })
      pushRepair(report, 'element-shifted-to-avoid-overlap', spec, index, { from: box.y, to: nextY })
      spec.y = nextY
      box.y = nextY
    }
    boxes.push({ index, box })
  }
  report.overlapRisk = {
    pairCount: pairs.length,
    affectedElementCount: affected.size,
    repairMode: 'auto'
  }
}

export function normalizeElementSpecsForLayout(specs, options = {}) {
  const report = {
    version: 1,
    mode: options.mode ?? 'native-browser',
    issues: [],
    repairs: [],
    needsRedraw: false,
    redrawReason: null
  }
  const elements = (Array.isArray(specs) ? specs : []).map((sourceSpec, index) => {
    const spec = cloneSpec(sourceSpec)
    if (!plainObject(spec)) return spec
    const type = nonEmptyString(spec.type)
    if (DIRECTIVE_TYPES.has(type)) return spec
    if (SHAPE_TYPES.has(type)) return normalizeShapeSpec(spec, report, index)
    if (TEXT_TYPES.has(type)) return normalizeTextSpec(spec, report, index)
    if (LINE_TYPES.has(type)) return normalizeLineSpec(spec, report, index)
    return spec
  })
  repairOverlaps(elements, report)
  return {
    elements,
    report: {
      ...report,
      issueCount: report.issues.length,
      repairCount: report.repairs.length,
      repaired: report.repairs.length > 0
    }
  }
}
