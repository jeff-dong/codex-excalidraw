import assert from 'node:assert/strict'

import { buildAnimatedExportHtml, buildMotionPlan } from '../src/animated-export.js'

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect x="0" y="0" width="600" height="400"/></svg>'

function withCodex(role, motion, semanticId) {
  return {
    customData: {
      codex: {
        role,
        motion,
        semanticId
      }
    }
  }
}

function arrow(id, x, y, dx, dy, extra = {}) {
  return {
    id,
    type: 'arrow',
    x,
    y,
    width: dx,
    height: dy,
    points: [[0, 0], [dx, dy]],
    strokeColor: '#22d3ee',
    strokeWidth: 2,
    ...extra
  }
}

function line(id, x, y, dx, dy, extra = {}) {
  return {
    id,
    type: 'line',
    x,
    y,
    width: dx,
    height: dy,
    points: [[0, 0], [dx, dy]],
    strokeColor: '#ffffff',
    strokeWidth: 1,
    ...extra
  }
}

function rectangle(id, x, y, width, height, extra = {}) {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: '#22c55e',
    backgroundColor: 'transparent',
    ...extra
  }
}

function ids(items) {
  return items.map((item) => item.id)
}

function assertHtmlIncludesMotionPlan(html) {
  assert.match(html, /<script type="application\/json" id="motion-plan">/)
  assert.match(html, /class="motion-overlay"/)
  assert.match(html, /id="toggle-motion"/)
}

{
  const elements = [
    arrow('edge_main', 20, 40, 250, 0, withCodex('data-flow', { enabled: true, journeyId: 'checkout', priority: 5 }, 'edge.main')),
    arrow('edge_secondary', 20, 80, 250, 0, withCodex('data-flow', null, 'edge.secondary')),
    line('divider', 20, 120, 250, 0, withCodex('background', null, 'divider')),
    rectangle('service', 330, 20, 160, 90, withCodex('service', { pulse: true }, 'service'))
  ]
  const plan = buildMotionPlan(elements)
  assert.equal(plan.mode, 'explicit')
  assert.deepEqual(ids(plan.edges), ['edge_main'])
  assert.deepEqual(plan.journeys.map((journey) => journey.id), ['checkout'])
  assert.ok(ids(plan.pulseNodes).includes('service'))

  const html = buildAnimatedExportHtml({ svgText, elements, appState: { name: 'Explicit Motion' } })
  assertHtmlIncludesMotionPlan(html)
  assert.match(html, /data-motion-id="edge_main"/)
  assert.doesNotMatch(html, /data-motion-id="edge_secondary"/)
}

{
  const elements = [
    arrow('request_flow', 30, 60, 220, 0),
    arrow('response_flow', 280, 60, 220, 0),
    line('decorative_rule', 20, 160, 520, 0, withCodex('decorative', false, 'rule')),
    rectangle('container', 10, 30, 560, 180, withCodex('decorative', false, 'container'))
  ]
  const plan = buildMotionPlan(elements)
  assert.equal(plan.mode, 'auto-arrow')
  assert.deepEqual(ids(plan.edges), ['request_flow', 'response_flow'])
  assert.doesNotMatch(buildAnimatedExportHtml({ svgText, elements, appState: {} }), /data-motion-id="decorative_rule"/)
}

{
  const elements = [
    line('signal_path', 40, 90, 260, 80),
    line('background_rule', 20, 180, 540, 0, withCodex('decorative', false, 'background-rule'))
  ]
  const plan = buildMotionPlan(elements)
  assert.equal(plan.mode, 'line-fallback')
  assert.deepEqual(ids(plan.edges), ['signal_path'])
}

{
  const elements = [
    arrow('suppressed_edge', 20, 40, 250, 0, withCodex('data-flow', false, 'edge.suppressed')),
    arrow('active_edge', 20, 90, 250, 0)
  ]
  const plan = buildMotionPlan(elements)
  assert.equal(plan.mode, 'auto-arrow')
  assert.deepEqual(ids(plan.edges), ['active_edge'])
}

{
  const elements = [
    rectangle('node_a', 30, 30, 120, 80),
    rectangle('node_b', 330, 30, 120, 80),
    arrow('bound_edge', 150, 70, 180, 0, {
      startBinding: { elementId: 'node_a' },
      endBinding: { elementId: 'node_b' }
    }),
    rectangle('large_unbound', 50, 180, 300, 120)
  ]
  const plan = buildMotionPlan(elements)
  assert.deepEqual(ids(plan.pulseNodes).slice(0, 2), ['node_a', 'node_b'])
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    'explicit-motion-plan-wins',
    'auto-arrows-ignore-motion-disabled-decorations',
    'line-fallback-without-arrows',
    'disabled-motion-suppresses-edge',
    'bound-nodes-become-pulse-targets'
  ]
}, null, 2))
