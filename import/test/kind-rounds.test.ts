// C2-W-088: where the kind rounds lose a node and the plan cannot write the group, the rounds run again, and the
// losses they report stay whole.
import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

describe('a group that the kind rounds and the plan both leave to the rounds', () => {
  it('imports with every diagnostic present', () => {
    const html = '<section data-carve-generated-id id="It-s-a-b">\n  <h1>It’s a*b</h1>\n  <p><a href="#It-s-a-b" ' +
      'data-carve-ref="It&apos;s a*b" data-carve-ref-collapsed>It’s a*b</a> and <a href="#It-s-a-b" ' +
      'data-carve-ref="It’s a*b">go</a> and [go][It\\\'s a\\*b]</p>\n</section>\n'
    const result = importDocument(html, { from: 'html' })
    expect(result.diagnostics.every((entry) => entry !== undefined)).toBe(true)
    expect(result.source.startsWith('= It’s a*b\n')).toBe(true)
  })
})
