import { describe, expect, it } from 'vitest'
import { fromAstJson, parse, renderHtml, resolve, toAstJson } from '../src/index.js'

// In #2368, a code span inside the label hides its closing bracket.
// Check the parse/resolve/serialize path used by the ingest gate (#2368).
const source = '``` js [a `]` b]\nc\n```\n'
const expected = '<pre><code class="language-js">c\n</code></pre>'

describe('a fence label keeps its block through AST ingest', () => {
  it.each([false, true])('parses a code block with positions=%s', (positions) => {
    const doc = resolve(parse(source, { positions }))
    expect(doc.children).toHaveLength(1)
    expect(doc.children[0]).toMatchObject({
      type: 'code_block', lang: 'js', label: 'a `]` b', content: 'c',
    })
    expect(renderHtml(doc).trim()).toBe(expected)
    const wire = toAstJson(doc)
    if (positions) expect(wire.children[0]).toHaveProperty('pos')
    else expect(wire.children[0]).not.toHaveProperty('pos')
    const ingested = fromAstJson(JSON.parse(JSON.stringify(wire)))
    expect(toAstJson(ingested)).toEqual(wire)
    expect(renderHtml(ingested).trim()).toBe(expected)
  })
})
