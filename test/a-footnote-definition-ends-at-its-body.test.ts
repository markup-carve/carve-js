import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

/*
 * A FOOTNOTE DEFINITION ENDS AT ITS BODY, NOT AT THE BLANK LINE THAT ENDS IT
 * (PART 12 §4, markup-carve/carve-js#1347).
 *
 * A definition has no closer, so §4 ends it at its last placed child, and the
 * clause names what is excluded: "a following newline, blank line, or
 * unattached attribute block is not" included in a span.
 *
 * The parser could not know the note had ended until it read a line that did
 * not continue it, and it consumed the blank line first - so the extent it
 * recorded reached the START of the line after the body, one codepoint past
 * the note's own last block. That is markup-carve/carve-js#1304's defect on a
 * different container: a list's span used to swallow the blank run that ended
 * it in exactly the same way.
 *
 * A footnote lives on the root in the parse tree, so the span these tests read
 * is the PART 12 wire one, which is where §4 is normative anyway.
 */

const footnoteSpan = (source: string, nth = 0): [number, number] => {
  const doc = toAstJson(parse(source)) as {
    children: Array<{ type: string; pos?: { startOffset: number; endOffset: number } }>
  }
  const found = doc.children.filter((child) => child.type === 'footnote')
  const hit = found[nth]
  if (!hit?.pos) throw new Error(`no placed footnote #${nth} in ${JSON.stringify(source)}`)
  return [hit.pos.startOffset, hit.pos.endOffset]
}

const covered = (source: string, [start, end]: [number, number]): string =>
  [...source].slice(start, end).join('')

describe('a footnote definition ends at its body', () => {
  it('stops before the newline that separates it from what follows', () => {
    const source = 'x[^n]\n\n[^n]: b\n\ntail\n'
    // It used to end at 15: the start of the blank line, one past the `\n`
    // that terminates the definition's own last line.
    expect(footnoteSpan(source)).toEqual([7, 14])
    expect(covered(source, footnoteSpan(source))).toBe('[^n]: b')
  })

  it('stops at the same place however many blank lines follow it', () => {
    const source = 'x[^n]\n\n[^n]: b\n\n\n\ntail\n'
    expect(covered(source, footnoteSpan(source))).toBe('[^n]: b')
  })

  it('keeps a blank line the body itself holds', () => {
    // The run is only excluded where it ENDS the definition. A blank line
    // followed by a continuation line is inside the note, and the second
    // paragraph is a child the span has to reach.
    const source = 'x[^n]\n\n[^n]: b\n\n  c\n\ntail\n'
    expect(covered(source, footnoteSpan(source))).toBe('[^n]: b\n\n  c')
  })

  it('reaches its last continuation line when nothing follows the note', () => {
    // The shape that was already right, so the walk-back cannot be what ends
    // a definition that runs to the end of the source.
    const source = 'a[^r]\n\n[^r]: first\n  second\n'
    expect(covered(source, footnoteSpan(source))).toBe('[^r]: first\n  second')
  })

  it('ends every definition in a run of them at its own body', () => {
    const source = 'a[^x] b[^y]\n\n[^x]: one\n\n[^y]: two\n\nafter\n'
    expect(covered(source, footnoteSpan(source, 0))).toBe('[^x]: one')
    expect(covered(source, footnoteSpan(source, 1))).toBe('[^y]: two')
  })
})
