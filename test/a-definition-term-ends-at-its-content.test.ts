import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

/*
 * A DEFINITION TERM ENDS AT ITS CONTENT, NOT AT THE END OF ITS LAST LINE
 * (PART 2's NO TRAILING WHITESPACE clause, PART 12 §4,
 * markup-carve/carve-js#1349).
 *
 * A term's extent was measured from the LINES it took, and a content line may
 * end in a whitespace run PART 2 rules is "DROPPED. It does not reach the
 * output, and it is not content" - naming a definition term among the lines it
 * holds for. The text the term's inlines are parsed from already has the run
 * stripped, so the run reaches no child either: the term owned source that is
 * not content and belongs to nothing inside it, which is the arrangement §4's
 * closerless-container rule exists to catch.
 *
 * THE OTHER TWO ENGINES CLOSED THIS FIRST: markup-carve/carve-php#1330 and
 * markup-carve/carve-rs#1029, both under this title. carve-js never got one.
 */

type Pos = { startOffset?: number; endOffset?: number }

const spans = (source: string, type: string): Pos[] => {
  const out: Pos[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; pos?: Pos }
    if (n.type === type && n.pos?.startOffset !== undefined) out.push(n.pos)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pos') continue
      walk(value)
    }
  }
  // THE PART 12 WIRE SHAPE, NOT THE PARSE TREE. This engine models a definition
  // entry as a bare `{ terms, definitions, termSpans, ... }` record with no
  // `type` and no `pos`, so no `definition_term` node exists to read until
  // `toAstJson` publishes one - and §4 is normative about the interchange
  // document anyway.
  walk(toAstJson(parse(source)))
  return out
}

const covered = (source: string, type: string, nth = 0): string => {
  const pos = spans(source, type)[nth]
  if (!pos) throw new Error(`no placed ${type} #${nth} in ${JSON.stringify(source)}`)
  return [...source].slice(pos.startOffset!, pos.endOffset!).join('')
}

describe('a definition term ends at its content', () => {
  it('drops the trailing run on a folded continuation line', () => {
    // The ticket's shape: the second line of the term ends in one space, and
    // the verbatim run inside it ends one codepoint earlier than the term did.
    const source = ':: `a\nb \n:  d\n'
    expect(spans(source, 'definition_term')[0]).toMatchObject({ startOffset: 0, endOffset: 7 })
    expect(covered(source, 'definition_term')).toBe(':: `a\nb')
    expect(covered(source, 'code')).toBe('`a\nb')
  })

  it('drops the trailing run on a single-line term too', () => {
    expect(covered(':: a  \n:  d\n', 'definition_term')).toBe(':: a')
  })

  it('drops a trailing tab, because the run is space and tab', () => {
    expect(covered(':: a\t\n:  d\n', 'definition_term')).toBe(':: a')
  })

  it('drops it on every term of an entry', () => {
    const source = ':: a  \n:: b \n:  d\n'
    expect(covered(source, 'definition_term', 0)).toBe(':: a')
    expect(covered(source, 'definition_term', 1)).toBe(':: b')
  })

  it('keeps an interior run, which belongs to the author', () => {
    expect(covered(':: a  b\n:  d\n', 'definition_term')).toBe(':: a  b')
  })

  it('is unchanged where the line carries no trailing run', () => {
    expect(covered(':: a\n:  d\n', 'definition_term')).toBe(':: a')
    expect(covered(':: a\nb\n:  d\n', 'definition_term')).toBe(':: a\nb')
  })

  it('lets the list end where the term does when the term is its last child', () => {
    // §4 already ends a definition list at its last placed child, so a term
    // that stops earlier takes the list with it rather than leaving the list
    // covering a run no node holds.
    const source = ':: a  \n'
    expect(covered(source, 'definition_term')).toBe(':: a')
    expect(covered(source, 'definition_list')).toBe(':: a')
  })

  it('leaves a description alone', () => {
    // A description was ALREADY blended this way - recorded start, derived end
    // - which is where the term's own fix comes from. It is unchanged.
    expect(covered(':: a\n:  d  \n', 'definition_description')).toBe(':  d')
  })
})
