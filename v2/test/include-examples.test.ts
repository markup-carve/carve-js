// The 31 examples of spec/0.2/includes.md: the HTML of each, and the tree where the example shows one.
import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'
import { exampleOptions, INCLUDE_EXAMPLES, includeExample, includes, withoutPositions } from './support/includes.ts'

// The clause each example is written under.
const CLAUSES = new Map([
  [1, 'C2-N-002'], [2, 'C2-N-015'], [3, 'C2-N-018'], [4, 'C2-N-019'], [5, 'C2-N-021'], [6, 'C2-N-022'], [7, 'C2-N-023'],
  [8, 'C2-N-024'], [9, 'C2-N-025'], [10, 'C2-N-028'], [11, 'C2-N-030'], [12, 'C2-N-031'], [13, 'C2-N-036'], [14, 'C2-N-041'],
  [15, 'C2-N-042'], [16, 'C2-N-045'], [17, 'C2-N-048'], [18, 'C2-N-050'], [19, 'C2-N-054'], [20, 'C2-N-056'], [21, 'C2-N-057'],
  [22, 'C2-N-058'], [23, 'C2-N-064'], [24, 'C2-N-066'], [25, 'C2-N-070'], [26, 'C2-N-072'], [27, 'C2-N-074'], [28, 'C2-N-075'],
  [29, 'C2-N-076'], [30, 'C2-N-077'], [31, 'C2-N-084'],
])

/** The part of `actual` that `expected` names: the examples leave out the nodes they are not about. */
function shown(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(expected) && Array.isArray(actual)) return actual.map((item, at) => shown(item, expected[at]))
  if (typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null) return actual
  const record = actual as Record<string, unknown>
  return Object.fromEntries(Object.keys(expected).map((key) => [key, shown(record[key], (expected as Record<string, unknown>)[key])]))
}

describe('the examples of the Includes document', () => {
  it('there are 31', () => {
    expect(INCLUDE_EXAMPLES.map((example) => example.number)).toEqual(Array.from({ length: 31 }, (_, at) => at + 1))
  })

  for (const example of INCLUDE_EXAMPLES) {
    it(`${CLAUSES.get(example.number) ?? ''}: Example ${example.number}`, () => {
      expect(render(example.input, exampleOptions(example))).toBe(example.html)
    })
  }

  for (const example of INCLUDE_EXAMPLES.filter((entry) => entry.tree !== null)) {
    it(`${CLAUSES.get(example.number) ?? ''}: the tree of Example ${example.number}`, () => {
      const positions = example.number === 4
      const document = parse(example.input, { includes: includes(example.files), positions })
      const expected = example.tree as { type: string }
      const actual = expected.type === 'document' ? document : document.children.find((node) => node.type === 'include')!
      const tree = positions ? JSON.parse(JSON.stringify(actual)) as unknown : withoutPositions(actual)
      // C2-A-135: the stages also name `tableAlignment`, which Example 3 leaves out.
      if (expected.type === 'document') {
        expect(document.stages).toEqual(['includeExpansion', 'referenceResolution', 'tableAlignment'])
        delete (tree as { stages?: unknown }).stages
        delete (expected as { stages?: unknown }).stages
      }
      expect(shown(tree, expected)).toEqual(expected)
    })
  }

  it('C2-N-021: Example 5, the frontmatter of the included file is its first child and not document metadata', () => {
    const example = includeExample(5)
    const document = parse(example.input, { includes: includes(example.files) })
    expect(withoutPositions(document.children[1]!)).toMatchObject(example.tree as object)
  })
})
