// Properties of the public tree and of the HTML on every enumerated document and on every example
// of the specification: the validator accepts the tree, positions are those of the source, children
// lie inside their parent, siblings are ordered and disjoint, encode then decode gives the same
// tree, two parses give the same tree, and the HTML is well formed. See support/tree-checks.ts.
import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'
import { EXAMPLES } from './support/conformance.ts'
import { LINE_SHAPES } from './support/enumerate.ts'
import { INLINE_TOKENS } from './support/inline-enumerate.ts'
import { checkHtml, checkTree, enumerateTrees } from './support/tree-checks.ts'

describe('enumerated documents', () => {
  for (const lines of [1, 2]) {
    it(`every document of ${lines} lines over ${LINE_SHAPES.length} line shapes`, () => {
      const result = enumerateTrees(LINE_SHAPES, lines, '\n', '')
      expect(result.documents).toBe(LINE_SHAPES.length ** lines)
      expect(result.failures).toEqual([])
    })
  }

  for (const length of [1, 2, 3]) {
    it(`every content of ${length} tokens over ${INLINE_TOKENS.length} inline tokens`, () => {
      const result = enumerateTrees(INLINE_TOKENS, length, '', 'x')
      expect(result.documents).toBe(INLINE_TOKENS.length ** length)
      expect(result.failures).toEqual([])
    })
  }
})

describe('the examples of the specification', () => {
  it('every example holds the properties', () => {
    const failures = EXAMPLES.map((example) => [`${example.file}:${example.number}`, checkTree(example.input)]).filter(([, failure]) => failure !== null)
    expect(failures).toEqual([])
  })

  it('the properties hold with a carriage return before every line feed and with characters of two to four bytes', () => {
    for (const example of EXAMPLES) {
      expect(checkTree(example.input.replaceAll('\n', '\r\n'))).toBeNull()
      expect(checkTree(example.input.replaceAll('a', 'é').replaceAll('b', '€').replaceAll('x', '😀'))).toBeNull()
    }
  })
})

describe('large documents', () => {
  it('a block with more children than a call takes arguments is parsed and rendered', () => {
    const count = 150_000
    const list = parse('- a\n'.repeat(count))
    expect(list.children![0]!.children!.length).toBe(count)
    expect(list.children![0]!.children![count - 1]!.pos!.startLine).toBe(count)
    const terms = parse(`*[HTML]: x\n\n${'HTML '.repeat(count)}`).children![1]!.children!
    expect(terms.filter((node) => node.type === 'abbreviation').length).toBe(count)
    expect(terms[terms.length - 1]!.pos!.endOffset).toBe(12 + 5 * count - 1)
    expect(render(`| a |\n${'%% c\n'.repeat(count)}^ cap`)).toContain('<caption>cap</caption>')
  })
})

describe('the HTML check itself', () => {
  it('refuses a tag that is not closed, an attribute twice and a bare markup character', () => {
    expect(checkHtml('<p>a</p>\n<hr>\n<img src="x" alt="">')).toBeNull()
    expect(checkHtml('<p>a')).toBe('<p> is not closed')
    expect(checkHtml('<p>a</div>')).toBe('</div> closes nothing at 4')
    expect(checkHtml('<p id="a" ID="b">a</p>')).toBe('an attribute twice in <p id="a" ID="b">')
    expect(checkHtml('<p>a > b</p>')).toBe('a bare > at 5')
    expect(checkHtml('<p k=v>a</p>')).toMatch(/^a malformed tag at 0/)
  })
})
