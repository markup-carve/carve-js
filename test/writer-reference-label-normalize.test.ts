// C2-W-075, C2-W-127: with `normalize` the label of a collapsed or shortcut reference is written from the tree, and
// the spelling it gets must still fold to the key, also where a braced form or a dropped escape changed its text.
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, render, treesEqual } from '../src/index.ts'

function normalized(source: string): string {
  const written = formatWithDiagnostics(source, { normalize: true })
  expect(written.diagnostics, source).toEqual([])
  expect(treesEqual(parse(written.source), parse(source)), `${source}\n->\n${written.source}`).toBe(true)
  expect(formatWithDiagnostics(written.source, { normalize: true }).source).toBe(written.source)
  return written.source
}

describe('reference labels under normalize', () => {
  it('C2-W-075: a strong in a collapsed label with a line break keeps the label and the link', () => {
    const source = '*[*a\nb*][]*\n\n[*a b*]: /u\n'
    expect(normalized(source)).toBe('{*[*a\nb*][]*}\n\n[*a b*]: /u\n')
    expect(render(normalized(source))).toContain('href="/u"')
    expect(normalized('x *[*a\nb*][]* y\n\n[*a b*]: /u\n')).toBe('x {*[*a\nb*][]*} y\n\n[*a b*]: /u\n')
    expect(normalized('*[*a b\nc*][]*\n\n[*a b c*]: /u\n')).toBe('{*[*a b\nc*][]*}\n\n[*a b c*]: /u\n')
  })

  it('C2-W-075: a shortcut label is written so that it folds to its key', () => {
    expect(normalized('*[*a\nb*]*\n\n[*a b*]: /u\n')).toBe('{*[*a\nb*]*}\n\n[*a b*]: /u\n')
  })

  it('C2-W-075: the alt text of a collapsed or shortcut image keeps the escapes and breaks of its key', () => {
    expect(normalized('_![f.g  \\[h\\]  `k`]_\n\n[f.g \\[h\\] `k`]: /u\n')).toBe('_![f.g  \\[h\\]  `k`]_\n\n[f.g \\[h\\] `k`]: /u\n')
    expect(normalized('> ![\\[h\\]\n> b][]\n\n[\\[h\\] b]: /u\n')).toBe('> ![\\[h\\]\n> b][]\n\n[\\[h\\] b]: /u\n')
    expect(normalized('{+![{^e\\*\n\\[h\\]^}][]+}\n\n[{^e\\* \\[h\\]^}]: /u\n')).toBe('{+![{^e\\*\n\\[h\\]^}][]+}\n\n[{^e\\* \\[h\\]^}]: /u\n')
  })
})
