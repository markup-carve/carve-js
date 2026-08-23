import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

/*
 * A HEADING ENDS AT ITS LAST PLACED CHILD (PART 12 §4, PART 2's NO TRAILING
 * WHITESPACE clause, markup-carve/carve-js#1348).
 *
 * A heading has no closer - it ends at its newline by construction - so §4 ends
 * it at its last placed child like every other closerless construct. Its extent
 * came from the LINE it consumed instead, and a content line may end in a
 * whitespace run that PART 2 rules is "DROPPED. It does not reach the output,
 * and it is not content", naming a heading among the lines it holds for.
 *
 * The run reaches no child, because the text the inlines are parsed from has
 * already had it stripped. So the node claimed source that is not content and
 * belongs to nothing inside it - which is what §4's rule exists to catch. The
 * same clause is already applied to a verbatim run (markup-carve/carve-js#1145)
 * and to a caption line (markup-carve/carve-php#1037).
 */

type Pos = { startOffset?: number; endOffset?: number }

const spanOf = (source: string, type: string): [number, number] => {
  let hit: Pos | undefined
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; pos?: Pos }
    if (hit === undefined && n.type === type && n.pos?.startOffset !== undefined) hit = n.pos
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pos') continue
      walk(value)
    }
  }
  walk(parse(source))
  if (!hit) throw new Error(`no placed ${type} in ${JSON.stringify(source)}`)
  return [hit.startOffset!, hit.endOffset!]
}

const covered = (source: string, type: string): string => {
  const [start, end] = spanOf(source, type)
  return [...source].slice(start, end).join('')
}

describe('a heading ends at its last placed child', () => {
  it('drops the trailing space run its line drops', () => {
    const source = '# h  \n'
    // It used to end at 5, covering the two spaces the line never publishes.
    expect(spanOf(source, 'heading')).toEqual([0, 3])
    expect(covered(source, 'heading')).toBe('# h')
  })

  it('drops a trailing tab too, because the run is space and tab', () => {
    expect(covered('## h\t\n', 'heading')).toBe('## h')
  })

  it('drops a mixed run at every level', () => {
    expect(covered('###### h \t \n', 'heading')).toBe('###### h')
  })

  it('keeps a brace run, which is heading content and not an attribute', () => {
    // djot-strict: a heading takes its attributes on the preceding block
    // attribute line, so a trailing `{…}` is ordinary inline content and the
    // span has to reach it.
    expect(covered('# h{.x}\n', 'heading')).toBe('# h{.x}')
  })

  it('reaches a trailing comment, which is a placed child', () => {
    expect(covered('# h %%c%%\n', 'heading')).toBe('# h %%c%%')
  })

  it('is unchanged where the line carries no trailing run', () => {
    expect(covered('# h\n', 'heading')).toBe('# h')
    expect(covered('# *b*\n', 'heading')).toBe('# *b*')
  })

  it('still starts at its own marker below an attribute line', () => {
    // The rule moves the END only: the start stays at the opening markup, so
    // the attribute line above stays outside the heading.
    expect(covered('{.a}\n# h  \n', 'heading')).toBe('# h')
  })
})
