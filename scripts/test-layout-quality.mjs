import assert from 'node:assert/strict'
import { updateElements } from '../lib/excalidraw-data.mjs'
import { layoutSequenceDiagram } from '../lib/excalidraw-diagrams.mjs'
import { normalizeElementSpecsForLayout } from '../lib/excalidraw-layout.mjs'
import { qualityReportForElements } from '../lib/excalidraw-quality.mjs'

function node(id, x, y, extra = {}) {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 140,
    height: 70,
    label: { text: id, fontSize: 18 },
    style: {
      strokeColor: '#1e40af',
      backgroundColor: '#dbeafe'
    },
    customData: {
      codex: {
        semanticId: id,
        role: 'node'
      }
    },
    ...extra
  }
}

{
  const layout = normalizeElementSpecsForLayout([
    node('left', 0, 0),
    node('right', 80, 0)
  ])
  assert.equal(layout.report.needsRedraw, false)
  assert.equal(layout.report.overlapRisk.repairMode, 'auto')
  assert.ok(layout.report.repairs.some((repair) => repair.code === 'element-shifted-right-to-avoid-row-overlap'))
  assert.ok(layout.elements[1].x > 140)
  assert.equal(layout.elements[1].y, 0)
}

{
  const denseRow = normalizeElementSpecsForLayout([
    node('a', 0, 0),
    node('b', 20, 0),
    node('c', 40, 0),
    node('d', 60, 0),
    node('e', 80, 0),
    node('f', 100, 0)
  ])
  assert.equal(denseRow.report.needsRedraw, false)
  assert.equal(denseRow.report.overlapRisk.repairMode, 'auto')
  assert.ok(denseRow.report.repairs.some((repair) => repair.code === 'element-shifted-right-to-avoid-row-overlap'))
  assert.deepEqual(denseRow.elements.map((element) => element.y), [0, 0, 0, 0, 0, 0])
  for (let index = 1; index < denseRow.elements.length; index += 1) {
    const previous = denseRow.elements[index - 1]
    const current = denseRow.elements[index]
    assert.ok(current.x >= previous.x + previous.width + 24)
  }
}

{
  const dense = normalizeElementSpecsForLayout([
    node('a', 0, 0),
    node('b', 20, 50),
    node('c', 40, 100),
    node('d', 60, 150),
    node('e', 80, 200),
    node('f', 100, 250)
  ])
  assert.equal(dense.report.needsRedraw, true)
  assert.equal(dense.report.redrawReason, 'high-risk-overlap')
  assert.equal(dense.report.overlapRisk.repairMode, 'diagnostic')
  assert.equal(dense.report.repairs.some((repair) => repair.code === 'element-shifted-right-to-avoid-row-overlap'), false)
  assert.deepEqual(dense.elements.map((element) => element.y), [0, 50, 100, 150, 200, 250])
}

{
  const withContainer = normalizeElementSpecsForLayout([
    node('zone', -30, -30, {
      width: 420,
      height: 260,
      customData: {
        codex: {
          semanticId: 'zone',
          role: 'zone'
        }
      }
    }),
    node('inside-a', 0, 0),
    node('inside-b', 210, 0)
  ])
  assert.equal(withContainer.report.needsRedraw, false)
  assert.equal(withContainer.report.overlapRisk.pairCount, 0)
}

{
  const layout = normalizeElementSpecsForLayout([
    {
      type: 'text',
      x: 0,
      y: 0,
      text: 'Large heading',
      style: { fontSize: 34, strokeColor: '#111827' }
    }
  ])
  assert.equal(layout.elements[0].fontSize, 34)
  assert.ok(layout.elements[0].height > 56)
}

{
  const sequence = layoutSequenceDiagram({
    title: 'Run with Codex comment workflow',
    participants: [
      { id: 'user', label: 'User' },
      { id: 'canvas', label: 'Excalidraw Canvas' },
      { id: 'mcp', label: 'MCP Server' },
      { id: 'codex', label: 'Codex Agent' }
    ],
    messages: [
      { id: 'queue_action', from: 'canvas', to: 'mcp', label: 'Create pending action with target element IDs' },
      { id: 'claim_action', from: 'codex', to: 'mcp', label: 'Claim action and lock execution' }
    ],
    gates: [
      { id: 'executor_gate', afterMessageId: 'claim_action', lane: 'codex', text: 'Executor available?' }
    ]
  }, { batchId: 'sequence_layout_quality_case' })
  const layout = normalizeElementSpecsForLayout(sequence.elements)
  assert.equal(layout.report.needsRedraw, false)
  assert.equal(layout.report.issueCount, 0)
  assert.equal(layout.report.repairCount, 0)
}

{
  const elements = [
    {
      id: 'shape_1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 160,
      height: 80,
      isDeleted: false
    },
    {
      id: 'label_1',
      type: 'text',
      containerId: 'shape_1',
      x: 20,
      y: 20,
      width: 120,
      height: 30,
      fontSize: 18,
      text: 'Bound label',
      isDeleted: false
    }
  ]
  const report = qualityReportForElements(elements)
  assert.equal(report.status, 'pass')
  assert.equal(report.overlapRisk.pairCount, 0)
}

{
  const result = updateElements({
    type: 'excalidraw',
    version: 2,
    elements: [
      {
        id: 'shape_1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 180,
        height: 80,
        customData: {
          codex: {
            semanticId: 'movable_card'
          }
        },
        isDeleted: false
      },
      {
        id: 'label_1',
        type: 'text',
        containerId: 'shape_1',
        x: 40,
        y: 45,
        width: 120,
        height: 30,
        fontSize: 18,
        text: 'Doing',
        isDeleted: false
      }
    ],
    appState: {},
    files: {}
  }, { semanticIds: ['movable_card'] }, {
    x: 250,
    y: 180,
    labelText: 'Done'
  })
  const shape = result.scene.elements.find((element) => element.id === 'shape_1')
  const label = result.scene.elements.find((element) => element.id === 'label_1')
  assert.equal(shape.x, 250)
  assert.equal(shape.y, 180)
  assert.equal(label.x, 280)
  assert.equal(label.y, 205)
  assert.equal(label.text, 'Done')
  assert.ok(result.updatedElementIds.includes('shape_1'))
  assert.ok(result.updatedElementIds.includes('label_1'))
}

{
  const report = qualityReportForElements([
    {
      id: 'auto_text',
      type: 'text',
      x: 0,
      y: 0,
      width: 260,
      height: 40,
      fontSize: 30,
      text: 'Auto-resized title text',
      autoResize: true,
      isDeleted: false
    },
    {
      id: 'reverse_arrow',
      type: 'arrow',
      x: 0,
      y: 80,
      width: 420,
      height: 0,
      points: [[-0.5, 0], [0.5, 0]],
      isDeleted: false
    }
  ])
  assert.equal(report.status, 'pass')
  assert.equal(report.issueCount, 0)
}

{
  const report = qualityReportForElements([
    node('a', 0, 0),
    node('b', 10, 0),
    node('c', 20, 0),
    node('d', 30, 0),
    node('e', 40, 0),
    node('f', 50, 0)
  ])
  assert.equal(report.status, 'fail')
  assert.equal(report.overlapRisk.needsRedraw, true)
  assert.ok(report.issues.some((item) => item.code === 'overlap-redraw-required'))
}

console.log('layout quality tests passed')
