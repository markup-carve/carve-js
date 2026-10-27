import { expect, it } from 'vitest'
import { carveToAstJson, lintCarve } from '../src/index.js'

// A definition list in a `::: box` inside a list item opens on `::`, not on the
// indent before it (corpus 698), and its term and description do too.
type Node = { type?: string; pos?: { startOffset: number; endOffset: number }; [k: string]: unknown }

const startsOf = (source: string): string[] => {
  const codepoints = [...source]
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    const node = n as Node
    if (node.type?.startsWith('definition_') && node.pos) {
      out.push(`${node.type} ${codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')}`)
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'pos') walk(value)
  }
  walk(carveToAstJson(source, { positions: true }))
  return out
}

it('closed box: list, term and description begin at their markers', () => {
  expect(startsOf('- a\n  ::: box\n   :: sub\n   : def\n  :::\n')).toEqual([
    'definition_list :: sub\n   : def',
    'definition_term :: sub',
    'definition_description : def',
  ])
})

it('unclosed box: the separator below the list column is reported', () => {
  const source = '- a\n  ::: box\n   :: sub\n: def\n'
  expect(startsOf(source)).toEqual(['definition_list :: sub', 'definition_term :: sub'])
  const rules = lintCarve(source).map((d: { rule?: string; line?: number }) => `${d.line} ${d.rule}`)
  expect(rules).toContain('4 description-separator-below-content-column')
})
