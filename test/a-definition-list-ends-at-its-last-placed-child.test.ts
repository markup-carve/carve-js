import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

/*
 * A DEFINITION LIST ENDS AT ITS LAST PLACED CHILD TOO (PART 12 §4,
 * markup-carve/carve#1530).
 *
 * It was the one container that answered the floating-attribute question the
 * other way: a floating attribute is SCOPED to the container that holds it, so
 * the attribute line was one the definition list consumed - and consuming it
 * was read as owning it, which ran the extent to the last line the list read.
 *
 * Scope and extent are different questions. Scope decides which blocks an
 * attribute may reach; extent decides which source a node claims. The bullet
 * list one construct over already separates them, and `{.k}` here attaches to
 * nothing, leaves no attributes anywhere, and is the unattached attribute block
 * §4 excludes by name.
 *
 * MEASURED ON THE WIRE SHAPE, which is what §4 is normative about. This engine
 * models an entry as a bare `{terms, definitions, ...}` record with no `type`
 * and no `pos`, so a parse tree cannot show a definition list's children at
 * all - which is also why the spec repository's stops-at-its-children pass
 * could not see this one until it serialized first.
 */

type Pos = { startOffset?: number; endOffset?: number }

const wireSpans = (source: string): Array<[string, number, number]> => {
  const out: Array<[string, number, number]> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; pos?: Pos }
    if (typeof n.type === 'string' && n.pos?.startOffset !== undefined) {
      out.push([n.type, n.pos.startOffset, n.pos.endOffset!])
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pos') continue
      walk(value)
    }
  }
  walk(toAstJson(parse(source)))
  return out
}

const spanOf = (source: string, type: string, nth = 0): [number, number] => {
  const found = wireSpans(source).filter(([t]) => t === type)
  const hit = found[nth]
  if (!hit) throw new Error(`no ${type} #${nth} in ${JSON.stringify(source)}`)
  return [hit[1], hit[2]]
}

describe('a definition list ends at its last placed child', () => {
  it('stops before an attribute line no child covers', () => {
    const source = ':: t\n:  d\n   {.k}\ntail\n'
    // The list used to end at 17, which is where the attribute line ends.
    expect(spanOf(source, 'definition_list')).toEqual([0, 9])
    expect(spanOf(source, 'definition_description')).toEqual([5, 9])
  })

  it('stops before the wrapped spelling of the same attribute block', () => {
    // §15 A5 lets one attribute block wrap, so the list consumed two lines
    // here rather than one. Neither of them is a child.
    const source = ':: t\n:  d\n   {.k\n   #x}\ntail\n'
    expect(spanOf(source, 'definition_list')).toEqual([0, 9])
  })

  it('stops before the definition hoisted out of it', () => {
    // PART 12 §7 hoists the definition to the document, so it is the list's
    // SIBLING and their spans used to overlap on 10..20.
    const source = ':: t\n:  a\n   [r]: /u\ntail\n\n[r][]\n'
    expect(spanOf(source, 'definition_list')).toEqual([0, 9])
    const def = spanOf(source, 'link_reference_definition')
    expect(def[0]).toBeGreaterThanOrEqual(9)
  })

  it('stops before trailing whitespace the clause excludes', () => {
    const source = ':: term \n:  def \n'
    expect(spanOf(source, 'definition_list')).toEqual([0, 15])
  })

  it('leaves the rendered list alone - only the spans moved', () => {
    const source = ':: t\n:  d\n   {.k}\ntail\n'
    // The attribute reaches no block, so it renders nothing here and never did.
    // If this changes, the extent is not what moved.
    expect(spanOf(source, 'definition_term')).toEqual([0, 4])
  })

  it('still ends at its last description when nothing follows it', () => {
    // The control: a list whose last line IS its last child was already right,
    // and the fix must not shorten it.
    const source = ':: t\n:  d\n'
    expect(spanOf(source, 'definition_list')).toEqual([0, 9])
  })
})
