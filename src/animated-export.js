const ANIMATED_EDGE_LIMIT = 24
const PULSE_NODE_LIMIT = 8
const MIN_EDGE_LENGTH = 20

const DISABLED_MOTION_VALUES = new Set(['none', 'off', 'static'])
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('\n', ' ')
}

function isVisibleElement(element) {
  return element && !element.isDeleted && Number.isFinite(element.x) && Number.isFinite(element.y)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function pointDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function pathLength(points) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += pointDistance(points[index - 1], points[index])
  }
  return length
}

function rotatedPoint(point, center, angle) {
  if (!Number.isFinite(angle) || Math.abs(angle) < 0.00001) return point
  const [x, y] = point
  const [cx, cy] = center
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

function absoluteElementPoints(element) {
  const rawPoints = Array.isArray(element.points) && element.points.length >= 2
    ? element.points
    : [[0, 0], [numberOr(element.width, 0), numberOr(element.height, 0)]]
  const width = numberOr(element.width, 0)
  const height = numberOr(element.height, 0)
  const center = [element.x + width / 2, element.y + height / 2]
  return rawPoints.map(([x, y]) => rotatedPoint([element.x + x, element.y + y], center, numberOr(element.angle, 0)))
}

function pathDFromPoints(points) {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`)
    .join(' ')
}

function round(value) {
  return Number(value.toFixed(2))
}

function colorForElement(element, fallback = '#22d3ee') {
  const color = typeof element.strokeColor === 'string' ? element.strokeColor.trim() : ''
  if (!color || color === 'transparent') return fallback
  return color
}

function codexData(element) {
  return element?.customData?.codex && typeof element.customData.codex === 'object'
    ? element.customData.codex
    : {}
}

function motionConfig(element) {
  const codex = codexData(element)
  if (Object.prototype.hasOwnProperty.call(codex, 'motion')) return codex.motion
  if (Object.prototype.hasOwnProperty.call(element?.customData ?? {}, 'motion')) return element.customData.motion
  return null
}

function motionStringValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

function isMotionDisabled(element) {
  const motion = motionConfig(element)
  if (motion === false) return true
  const motionText = motionStringValue(motion)
  if (motionText && DISABLED_MOTION_VALUES.has(motionText)) return true
  if (motion && typeof motion === 'object' && !Array.isArray(motion)) {
    if (motion.enabled === false) return true
    const effect = motionStringValue(motion.effect)
    if (effect && DISABLED_MOTION_VALUES.has(effect)) return true
  }
  return false
}

function hasExplicitMotion(element) {
  const motion = motionConfig(element)
  if (motion === true) return true
  const motionText = motionStringValue(motion)
  if (motionText) return !DISABLED_MOTION_VALUES.has(motionText)
  if (!motion || typeof motion !== 'object' || Array.isArray(motion)) return false
  if (motion.enabled === true || motion.animate === true || motion.flow === true || motion.pulse === true) return true
  if (nonEmptyString(motion.effect) || nonEmptyString(motion.journeyId)) return true
  return Number.isFinite(motion.priority)
}

function isExplicitPulseTarget(element) {
  const motion = motionConfig(element)
  if (!motion || typeof motion !== 'object' || Array.isArray(motion)) return false
  return motion.pulse === true || motion.effect === 'pulse' || motion.effect === 'highlight'
}

function motionPriority(element) {
  const motion = motionConfig(element)
  return motion && typeof motion === 'object' && Number.isFinite(motion.priority) ? motion.priority : 0
}

function motionJourneyId(element) {
  const motion = motionConfig(element)
  if (motion && typeof motion === 'object') return nonEmptyString(motion.journeyId) ?? 'main-flow'
  const semanticId = nonEmptyString(codexData(element).semanticId)
  return semanticId ? 'semantic-flow' : 'main-flow'
}

function motionEffect(element, fallback) {
  const motion = motionConfig(element)
  if (motion && typeof motion === 'object') return nonEmptyString(motion.effect) ?? fallback
  if (typeof motion === 'string' && !DISABLED_MOTION_VALUES.has(motionStringValue(motion))) return motion
  return fallback
}

function bindingElementIds(element) {
  return [
    nonEmptyString(element?.startBinding?.elementId),
    nonEmptyString(element?.endBinding?.elementId)
  ].filter(Boolean)
}

function edgeModelFromElement(element, reason) {
  const points = absoluteElementPoints(element)
  const length = pathLength(points)
  return {
    id: element.id,
    elementId: element.id,
    semanticId: nonEmptyString(codexData(element).semanticId),
    d: pathDFromPoints(points),
    color: colorForElement(element),
    length,
    strokeWidth: Math.max(2, Math.min(5, numberOr(element.strokeWidth, 2) + 1)),
    dashed: element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted',
    journeyId: motionJourneyId(element),
    effect: motionEffect(element, 'flow-dot'),
    priority: motionPriority(element),
    bindingElementIds: bindingElementIds(element),
    reason
  }
}

function scoreEdge(edge) {
  return edge.priority * 1000 + edge.length
}

function visibleLinearElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .filter((element) => isVisibleElement(element) && (element.type === 'arrow' || element.type === 'line'))
    .filter((element) => !isMotionDisabled(element))
}

function plannedEdgesFromElements(elements, maxEdges = ANIMATED_EDGE_LIMIT) {
  const linearElements = visibleLinearElements(elements)
  const explicitElements = linearElements.filter(hasExplicitMotion)
  if (explicitElements.length > 0) {
    return explicitElements
      .map((element) => edgeModelFromElement(element, 'explicit-motion'))
      .filter((edge) => edge.length >= MIN_EDGE_LENGTH)
      .sort((left, right) => scoreEdge(right) - scoreEdge(left))
      .slice(0, maxEdges)
  }

  const arrowElements = linearElements.filter((element) => element.type === 'arrow')
  const edgeCandidates = arrowElements.length > 0 ? arrowElements : linearElements
  const reason = arrowElements.length > 0 ? 'auto-arrow-flow' : 'auto-line-fallback'
  return edgeCandidates
    .map((element) => edgeModelFromElement(element, reason))
    .filter((edge) => edge.length >= MIN_EDGE_LENGTH)
    .sort((left, right) => scoreEdge(right) - scoreEdge(left))
    .slice(0, maxEdges)
}

function shapeCandidatesFromElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .filter((element) => isVisibleElement(element) && ['rectangle', 'ellipse', 'diamond'].includes(element.type))
    .map((element) => ({
      id: element.id,
      elementId: element.id,
      semanticId: nonEmptyString(codexData(element).semanticId),
      type: element.type,
      x: numberOr(element.x, 0),
      y: numberOr(element.y, 0),
      width: Math.max(1, Math.abs(numberOr(element.width, 1))),
      height: Math.max(1, Math.abs(numberOr(element.height, 1))),
      color: colorForElement(element, '#a78bfa'),
      area: Math.abs(numberOr(element.width, 0) * numberOr(element.height, 0)),
      explicit: isExplicitPulseTarget(element),
      motionDisabled: isMotionDisabled(element)
    }))
    .filter((node) => node.area >= 3600)
}

function pulseNodesFromElements(elements, plannedEdges, maxNodes = PULSE_NODE_LIMIT) {
  const connectedElementIds = new Set(plannedEdges.flatMap((edge) => edge.bindingElementIds ?? []))
  const candidates = shapeCandidatesFromElements(elements)
  const explicitNodes = candidates.filter((node) => node.explicit)
  const autoCandidates = candidates.filter((node) => !node.motionDisabled)
  const edgeConnectedNodes = autoCandidates.filter((node) => connectedElementIds.has(node.id))
  const sourceNodes = [
    ...explicitNodes,
    ...(edgeConnectedNodes.length > 0 ? edgeConnectedNodes : autoCandidates)
  ]
  const byId = new Map()
  for (const node of sourceNodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }
  return [...byId.values()]
    .sort((left, right) => {
      if (left.explicit !== right.explicit) return left.explicit ? -1 : 1
      const leftConnected = connectedElementIds.has(left.id)
      const rightConnected = connectedElementIds.has(right.id)
      if (leftConnected !== rightConnected) return leftConnected ? -1 : 1
      return right.area - left.area
    })
    .slice(0, maxNodes)
}

function journeySummary(edges) {
  const journeys = new Map()
  for (const edge of edges) {
    const key = edge.journeyId ?? 'main-flow'
    const journey = journeys.get(key) ?? {
      id: key,
      edgeIds: [],
      effect: edge.effect,
      color: edge.color
    }
    journey.edgeIds.push(edge.id)
    journeys.set(key, journey)
  }
  return [...journeys.values()]
}

function inferMotionMode(edges) {
  if (edges.some((edge) => edge.reason === 'explicit-motion')) return 'explicit'
  if (edges.some((edge) => edge.reason === 'auto-line-fallback')) return 'line-fallback'
  return edges.length > 0 ? 'auto-arrow' : 'static'
}

export function buildMotionPlan(elements, options = {}) {
  const edges = plannedEdgesFromElements(elements, numberOr(options.maxEdges, ANIMATED_EDGE_LIMIT))
  const pulseNodes = pulseNodesFromElements(elements, edges, numberOr(options.maxPulseNodes, PULSE_NODE_LIMIT))
  return {
    version: 1,
    mode: inferMotionMode(edges),
    edges,
    pulseNodes,
    journeys: journeySummary(edges),
    limits: {
      maxEdges: numberOr(options.maxEdges, ANIMATED_EDGE_LIMIT),
      maxPulseNodes: numberOr(options.maxPulseNodes, PULSE_NODE_LIMIT)
    },
    stats: {
      edgeCount: edges.length,
      pulseNodeCount: pulseNodes.length
    }
  }
}

function parseSvgBox(svgText) {
  if (typeof window !== 'undefined' && window.DOMParser) {
    const doc = new window.DOMParser().parseFromString(svgText, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    const viewBox = svg?.getAttribute('viewBox')
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number)
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        return { x: parts[0], y: parts[1], width: parts[2], height: parts[3], viewBox }
      }
    }
    const width = Number.parseFloat(svg?.getAttribute('width') ?? '')
    const height = Number.parseFloat(svg?.getAttribute('height') ?? '')
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { x: 0, y: 0, width, height, viewBox: `0 0 ${width} ${height}` }
    }
  }

  const text = String(svgText ?? '')
  const viewBoxMatch = text.match(/\sviewBox=(["'])(.*?)\1/i)
  if (viewBoxMatch) {
    const parts = viewBoxMatch[2].split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3], viewBox: viewBoxMatch[2] }
    }
  }
  const widthMatch = text.match(/\swidth=(["'])([\d.]+)\1/i)
  const heightMatch = text.match(/\sheight=(["'])([\d.]+)\1/i)
  const width = Number.parseFloat(widthMatch?.[2] ?? '')
  const height = Number.parseFloat(heightMatch?.[2] ?? '')
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { x: 0, y: 0, width, height, viewBox: `0 0 ${width} ${height}` }
  }
  return { x: 0, y: 0, width: 1280, height: 800, viewBox: '0 0 1280 800' }
}

function overlayForEdges(edges) {
  return edges
    .map((edge, index) => {
      const color = escapeAttribute(edge.color)
      const dash = edge.dashed ? '4 9' : '10 12'
      const delay = `${(index % 8) * 0.16}s`
      const dotDur = `${Math.max(2.4, Math.min(5.6, edge.length / 180)).toFixed(2)}s`
      return `<g class="motion-edge" data-motion-id="${escapeAttribute(edge.id)}" data-motion-reason="${escapeAttribute(edge.reason)}" style="--edge-color: ${color}; --edge-delay: ${delay}; --dot-dur: ${dotDur};">
  <path class="motion-edge__glow" d="${escapeAttribute(edge.d)}" stroke-width="${edge.strokeWidth + 3}"/>
  <path class="motion-edge__dash" d="${escapeAttribute(edge.d)}" stroke-width="${edge.strokeWidth}" stroke-dasharray="${dash}"/>
  <circle class="motion-edge__dot" r="${Math.max(3, Math.min(5, edge.strokeWidth + 1))}">
    <animateMotion dur="${dotDur}" begin="${delay}" repeatCount="indefinite" path="${escapeAttribute(edge.d)}"/>
  </circle>
</g>`
    })
    .join('\n')
}

function diamondPoints(node, grow) {
  const x = node.x - grow
  const y = node.y - grow
  const width = node.width + grow * 2
  const height = node.height + grow * 2
  return [
    [x + width / 2, y],
    [x + width, y + height / 2],
    [x + width / 2, y + height],
    [x, y + height / 2]
  ]
    .map(([px, py]) => `${round(px)},${round(py)}`)
    .join(' ')
}

function overlayForPulseNodes(nodes) {
  return nodes
    .map((node, index) => {
      const grow = Math.min(10, Math.max(4, Math.min(node.width, node.height) * 0.08))
      const delay = `${(index % 6) * 0.22}s`
      const color = escapeAttribute(node.color)
      const common = `class="motion-node" data-motion-id="${escapeAttribute(node.id)}" style="--node-color: ${color}; --node-delay: ${delay};"`
      if (node.type === 'ellipse') {
        return `<ellipse ${common} cx="${round(node.x + node.width / 2)}" cy="${round(node.y + node.height / 2)}" rx="${round(node.width / 2 + grow)}" ry="${round(node.height / 2 + grow)}"/>`
      }
      if (node.type === 'diamond') {
        return `<polygon ${common} points="${diamondPoints(node, grow)}"/>`
      }
      return `<rect ${common} x="${round(node.x - grow)}" y="${round(node.y - grow)}" width="${round(node.width + grow * 2)}" height="${round(node.height + grow * 2)}" rx="12"/>`
    })
    .join('\n')
}

function titleFromAppState(appState) {
  return typeof appState?.name === 'string' && appState.name.trim()
    ? appState.name.trim()
    : 'Codex Excalidraw Animated Export'
}

function safeJsonForHtml(value) {
  return JSON.stringify(value, null, 2).replaceAll('<', '\\u003c')
}

export function buildAnimatedExportHtml({ svgText, elements, appState, motionPlan }) {
  const box = parseSvgBox(svgText)
  const plan = motionPlan ?? buildMotionPlan(elements)
  const edges = plan.edges
  const nodes = plan.pulseNodes
  const title = titleFromAppState(appState)
  const generatedAt = new Date().toISOString()

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} · Animated</title>
  <style>
    :root {
      color-scheme: dark;
      --page-bg: #050608;
      --panel-bg: #0b0f14;
      --panel-border: rgba(255,255,255,.12);
      --text: #f5f5f4;
      --muted: #a8b3c2;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 20% 10%, rgba(34,211,238,.14), transparent 28%),
        radial-gradient(circle at 80% 15%, rgba(167,139,250,.12), transparent 30%),
        var(--page-bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .stage {
      width: min(100%, ${Math.ceil(box.width)}px);
      display: grid;
      gap: 12px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
    }
    .toolbar strong {
      color: var(--text);
      font-size: 13px;
      letter-spacing: .02em;
    }
    .toolbar button {
      height: 32px;
      padding: 0 12px;
      color: var(--text);
      background: rgba(255,255,255,.08);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-weight: 650;
    }
    .toolbar button:hover { background: rgba(255,255,255,.13); }
    .canvas {
      position: relative;
      overflow: hidden;
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 14px;
      box-shadow: 0 24px 80px rgba(0,0,0,.45);
    }
    .canvas > svg,
    .motion-overlay {
      display: block;
      width: 100%;
      height: auto;
    }
    .motion-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      mix-blend-mode: screen;
    }
    .motion-edge__glow,
    .motion-edge__dash {
      fill: none;
      stroke: var(--edge-color);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .motion-edge__glow {
      opacity: .07;
      filter: url(#motion-glow);
    }
    .motion-edge__dash {
      opacity: .9;
      animation: motion-dash 900ms linear infinite;
      animation-delay: var(--edge-delay);
    }
    .motion-edge__dot {
      fill: var(--edge-color);
      filter: url(#motion-glow);
      opacity: .95;
    }
    .motion-node {
      fill: none;
      stroke: var(--node-color);
      stroke-width: 2.5;
      opacity: 0;
      animation: node-pulse 2600ms ease-in-out infinite;
      animation-delay: var(--node-delay);
      filter: url(#motion-glow);
    }
    .is-paused .motion-edge__dash,
    .is-paused .motion-node {
      animation-play-state: paused;
    }
    @keyframes motion-dash {
      to { stroke-dashoffset: -44; }
    }
    @keyframes node-pulse {
      0%, 100% { opacity: 0; stroke-width: 1.5; }
      35% { opacity: .72; stroke-width: 3.5; }
      70% { opacity: .12; stroke-width: 7; }
    }
    @media (prefers-reduced-motion: reduce) {
      .motion-edge__dash,
      .motion-edge__dot,
      .motion-node {
        animation: none !important;
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <main class="stage">
    <div class="toolbar">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>Animated HTML · ${plan.mode} · ${edges.length} flow paths · ${nodes.length} pulse targets</span>
      </div>
      <button id="toggle-motion" type="button">Pause</button>
    </div>
    <div class="canvas" id="animated-canvas">
      ${svgText}
      <svg class="motion-overlay" xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttribute(box.viewBox)}" role="img" aria-label="${escapeAttribute(title)} animated motion overlay">
        <defs>
          <filter id="motion-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        ${overlayForPulseNodes(nodes)}
        ${overlayForEdges(edges)}
      </svg>
    </div>
  </main>
  <script type="application/json" id="motion-plan">${safeJsonForHtml(plan)}</script>
  <script>
    (() => {
      const canvas = document.getElementById('animated-canvas');
      const button = document.getElementById('toggle-motion');
      const overlay = document.querySelector('.motion-overlay');
      let paused = false;
      button.addEventListener('click', () => {
        paused = !paused;
        canvas.classList.toggle('is-paused', paused);
        button.textContent = paused ? 'Play' : 'Pause';
        if (overlay && typeof overlay.pauseAnimations === 'function') {
          paused ? overlay.pauseAnimations() : overlay.unpauseAnimations();
        }
      });
    })();
  </script>
  <!-- Generated by Codex Excalidraw animated export at ${escapeHtml(generatedAt)} -->
</body>
</html>
`
}
