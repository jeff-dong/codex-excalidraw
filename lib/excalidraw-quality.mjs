const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const TEXT_TYPES = new Set(['text'])
const LINE_TYPES = new Set(['arrow', 'line'])
const SKIPPED_OVERLAP_ROLES = new Set(['background', 'container', 'zone', 'lane', 'section', 'group', 'flow_lane'])

const MIN_READABLE_FONT_SIZE = 16
const MIN_PRIMARY_FONT_SIZE = 20
const MIN_SHAPE_WIDTH = 80
const MIN_SHAPE_HEIGHT = 44
const MIN_LINE_LENGTH = 8
const LARGE_BACKGROUND_AREA = 120_000
const DEFAULT_OVERLAP_GAP = 8
const MAX_SAFE_OVERLAP_PAIRS = 4
const MAX_SAFE_OVERLAP_ELEMENTS = 4
const DENSE_ELEMENT_COUNT = 80
const DENSE_AREA_PER_ELEMENT = 4_500

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function textLength(value) {
  return Array.from(String(value ?? '')).length
}

function textLines(value) {
  return String(value ?? '').split('\n')
}

function elementRole(element) {
  return (
    nonEmptyString(element?.layoutRole) ??
    nonEmptyString(element?.customData?.codex?.layoutRole) ??
    nonEmptyString(element?.customData?.codex?.role)
  )
}

function visibleElements(elements) {
  return (Array.isArray(elements) ? elements : []).filter((element) => plainObject(element) && element.isDeleted !== true)
}

function normalizedPoint(point) {
  if (!Array.isArray(point) || point.length < 2) return null
  const x = Number(point[0])
  const y = Number(point[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

function elementBounds(element) {
  const type = nonEmptyString(element?.type)
  const x = numberOr(element?.x, 0)
  const y = numberOr(element?.y, 0)
  if (LINE_TYPES.has(type) && Array.isArray(element?.points) && element.points.length >= 2) {
    const points = element.points.map(normalizedPoint).filter(Boolean)
    if (points.length >= 2) {
      const xs = points.map((point) => x + point[0])
      const ys = points.map((point) => y + point[1])
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const maxX = Math.max(...xs)
      const maxY = Math.max(...ys)
      return {
        x: minX,
        y: minY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY)
      }
    }
  }
  return {
    x,
    y,
    width: Math.abs(numberOr(element?.width, 0)),
    height: Math.abs(numberOr(element?.height, 0))
  }
}

function sceneBounds(elements) {
  const bounds = visibleElements(elements).map(elementBounds).filter((box) => box.width > 0 || box.height > 0)
  if (bounds.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, area: 0 }
  }
  const minX = Math.min(...bounds.map((box) => box.x))
  const minY = Math.min(...bounds.map((box) => box.y))
  const maxX = Math.max(...bounds.map((box) => box.x + box.width))
  const maxY = Math.max(...bounds.map((box) => box.y + box.height))
  const width = Math.max(0, maxX - minX)
  const height = Math.max(0, maxY - minY)
  return { x: minX, y: minY, width, height, area: width * height }
}

function issue(code, severity, element, details = {}) {
  return {
    code,
    severity,
    id: nonEmptyString(element?.id),
    semanticId: nonEmptyString(element?.customData?.codex?.semanticId),
    type: nonEmptyString(element?.type),
    ...details
  }
}

function lineLength(element) {
  if (!Array.isArray(element?.points) || element.points.length < 2) return 0
  const points = element.points.map(normalizedPoint).filter(Boolean)
  if (points.length < 2) return 0
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index][0] - points[index - 1][0]
    const dy = points[index][1] - points[index - 1][1]
    length += Math.sqrt(dx * dx + dy * dy)
  }
  const renderedLength = Math.sqrt(numberOr(element?.width, 0) ** 2 + numberOr(element?.height, 0) ** 2)
  return Math.max(length, renderedLength)
}

function estimatedTextWidth(text, fontSize) {
  const lines = textLines(text)
  const maxLine = Math.max(1, ...lines.map(textLength))
  return Math.ceil(maxLine * fontSize * 0.72)
}

function estimatedTextHeight(text, fontSize, lineHeight = 1.25) {
  return Math.ceil(Math.max(1, textLines(text).length) * fontSize * lineHeight)
}

function shouldSkipOverlap(element) {
  if (LINE_TYPES.has(nonEmptyString(element?.type))) return true
  if (nonEmptyString(element?.containerId)) return true
  const role = elementRole(element)
  if (role && SKIPPED_OVERLAP_ROLES.has(role)) return true
  const bounds = elementBounds(element)
  return bounds.width * bounds.height >= LARGE_BACKGROUND_AREA
}

function isBoundLabelPair(left, right) {
  return (
    nonEmptyString(left?.containerId) === nonEmptyString(right?.id) ||
    nonEmptyString(right?.containerId) === nonEmptyString(left?.id)
  )
}

function overlaps(left, right, gap) {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  )
}

export function collectOverlapPairs(elements, options = {}) {
  const gap = numberOr(options.gap, DEFAULT_OVERLAP_GAP)
  const candidates = visibleElements(elements)
    .map((element, index) => ({ element, index, box: elementBounds(element) }))
    .filter(({ element, box }) => !shouldSkipOverlap(element) && box.width > 0 && box.height > 0)
  const pairs = []
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex]
      const right = candidates[rightIndex]
      if (isBoundLabelPair(left.element, right.element)) continue
      if (!overlaps(left.box, right.box, gap)) continue
      pairs.push({
        leftIndex: left.index,
        rightIndex: right.index,
        leftId: nonEmptyString(left.element.id),
        rightId: nonEmptyString(right.element.id),
        leftSemanticId: nonEmptyString(left.element.customData?.codex?.semanticId),
        rightSemanticId: nonEmptyString(right.element.customData?.codex?.semanticId)
      })
    }
  }
  return pairs
}

function severityRank(severity) {
  if (severity === 'error') return 3
  if (severity === 'warn') return 2
  return 1
}

function statusFromIssues(issues) {
  const maxSeverity = Math.max(0, ...issues.map((item) => severityRank(item.severity)))
  if (maxSeverity >= 3) return 'fail'
  if (maxSeverity >= 2) return 'warn'
  return 'pass'
}

export function qualityReportForElements(elements, options = {}) {
  const items = visibleElements(elements)
  const issues = []
  const counts = {
    elements: items.length,
    shapes: 0,
    text: 0,
    linear: 0
  }

  for (const element of items) {
    const type = nonEmptyString(element.type)
    const bounds = elementBounds(element)
    if (SHAPE_TYPES.has(type)) {
      counts.shapes += 1
      if (!shouldSkipOverlap(element) && (bounds.width < MIN_SHAPE_WIDTH || bounds.height < MIN_SHAPE_HEIGHT)) {
        issues.push(issue('tiny-shape', 'warn', element, { width: bounds.width, height: bounds.height }))
      }
      continue
    }
    if (TEXT_TYPES.has(type)) {
      counts.text += 1
      const fontSize = numberOr(element.fontSize, numberOr(element.style?.fontSize, 0))
      const text = String(element.text ?? element.originalText ?? '')
      if (fontSize > 0 && fontSize < MIN_READABLE_FONT_SIZE) {
        issues.push(issue('small-text', 'warn', element, { fontSize, minimum: MIN_READABLE_FONT_SIZE }))
      }
      if (!nonEmptyString(element.containerId) && element.autoResize !== true && textLength(text) > 0) {
        const requiredWidth = estimatedTextWidth(text, Math.max(fontSize, MIN_READABLE_FONT_SIZE))
        const requiredHeight = estimatedTextHeight(text, Math.max(fontSize, MIN_READABLE_FONT_SIZE), numberOr(element.lineHeight, 1.25))
        if (bounds.width > 0 && bounds.width < requiredWidth * 0.82) {
          issues.push(issue('text-width-risk', 'warn', element, { width: bounds.width, estimated: requiredWidth }))
        }
        if (bounds.height > 0 && bounds.height < requiredHeight * 0.82) {
          issues.push(issue('text-height-risk', 'warn', element, { height: bounds.height, estimated: requiredHeight }))
        }
      }
      if (fontSize >= MIN_PRIMARY_FONT_SIZE && bounds.width === 0) {
        issues.push(issue('invisible-text', 'error', element))
      }
      continue
    }
    if (LINE_TYPES.has(type)) {
      counts.linear += 1
      const length = lineLength(element)
      if (length < MIN_LINE_LENGTH) {
        issues.push(issue('short-line', 'warn', element, { length, minimum: MIN_LINE_LENGTH }))
      }
    }
  }

  const overlapPairs = collectOverlapPairs(items, options.overlap)
  const affected = new Set()
  for (const pair of overlapPairs) {
    affected.add(pair.leftIndex)
    affected.add(pair.rightIndex)
  }
  const overlapRisk = {
    pairCount: overlapPairs.length,
    affectedElementCount: affected.size,
    sampledPairs: overlapPairs.slice(0, 16),
    needsRedraw: overlapPairs.length > MAX_SAFE_OVERLAP_PAIRS || affected.size > MAX_SAFE_OVERLAP_ELEMENTS
  }
  if (overlapRisk.needsRedraw) {
    issues.push(issue('overlap-redraw-required', 'error', null, {
      pairCount: overlapRisk.pairCount,
      affectedElementCount: overlapRisk.affectedElementCount
    }))
  } else if (overlapPairs.length > 0) {
    issues.push(issue('overlap-risk', 'warn', null, {
      pairCount: overlapRisk.pairCount,
      affectedElementCount: overlapRisk.affectedElementCount
    }))
  }

  const bounds = sceneBounds(items)
  const areaPerElement = counts.elements > 0 && bounds.area > 0 ? bounds.area / counts.elements : 0
  const density = {
    areaPerElement,
    isDense: counts.elements >= DENSE_ELEMENT_COUNT && areaPerElement < DENSE_AREA_PER_ELEMENT
  }
  if (density.isDense) {
    issues.push(issue('dense-scene-risk', 'warn', null, {
      elementCount: counts.elements,
      areaPerElement
    }))
  }
  if (counts.elements === 0) {
    issues.push(issue('empty-scene', 'error', null))
  }

  const status = statusFromIssues(issues)
  return {
    version: 1,
    status,
    counts,
    bounds,
    overlapRisk,
    density,
    issueCount: issues.length,
    issues,
    recommendations: overlapRisk.needsRedraw
      ? ['Split the drawing into sections or use a structured diagram layout before inserting again.']
      : []
  }
}

export function qualityReportForScene(scene, options = {}) {
  return qualityReportForElements(scene?.elements ?? [], options)
}
