import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The position-free HTML path must decline every ordered marker the block parser
// opens, including a multi-letter roman run inside a bullet item.
describe('an ordered marker in a bullet item on the position-free HTML path', () => {
  it.each([
    '- ii.  x\n',
    '- iv.  x\n',
    '* xii.  x\n',
    '- IV.  x\n',
    '- ii) x\n',
    '- iv.{.c}  x\n',
    '- x\n  ii.  y\n',
  ])('renders %j like the positioned parse', (source) => {
    expect(carveToHtml(source)).toBe(carveToHtml(source, { positions: true }))
  })

  it('opens the nested roman list', () => {
    expect(carveToHtml('- iv.  x\n')).toContain('<ol type="i" start="4">')
  })
})
