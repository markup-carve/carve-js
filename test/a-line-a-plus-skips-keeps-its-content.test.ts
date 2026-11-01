import { describe, it, expect } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'

// carve-js#4135 row 866: a `+` skips comments and abbreviation definitions on its way to the block it attaches.
describe('a line a plus skips keeps its content', () => {
  it.each([
    ['- +\n*[A]: b\ntext\n\nA\n', '- text\n\n*[A]: b\n\nA\n'],
    [':: t\n: +\n*[A]: b\ntext\n\nA\n', ':: t\n: text\n\n*[A]: b\n\nA\n'],
    ['> +\n*[A]: b\ntext\n\nA\n', '> text\n\n*[A]: b\n\nA\n'],
  ])('writes the skipped abbreviation definition at document level: %j', (src, out) => {
    const doc = parse(src, { positions: false })
    expect(doc.children.map((node) => node.type)).toContain('abbreviation_def')
    expect(JSON.stringify(doc)).not.toContain('"comment"')
    expect(carveToCarve(src)).toBe(out)
    expect(carveToCarve(out)).toBe(out)
  })

  it('keeps the text of a skipped line comment', () => {
    const src = '- +\n%% c\ntext\n'
    expect(JSON.stringify(parse(src, { positions: false }))).toContain('"content":"c"')
    expect(carveToCarve(src)).toBe('- %% c\n  text\n')
  })

  it('places the hoisted definition at its source line, past a byte order mark', () => {
    const src = '\ufeff- +\n*[A]: b\ntext\n'
    const def = parse(src).children.find((node) => node.type === 'abbreviation_def')!
    expect(src.slice(def.pos!.startOffset, def.pos!.endOffset)).toBe('*[A]: b')
    expect(def.pos!.startLine).toBe(2)
  })
})
