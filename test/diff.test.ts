import { describe, expect, it } from 'vitest'

import { carveToAstJson, diffAst, formatChanges } from '../src/index.js'

/**
 * A structural diff answers "did this document change", which a line diff
 * cannot: a reflow rewrites most lines and changes nothing, while a
 * one-character edit to a link destination changes where a reader lands and
 * shows up as one line among many.
 *
 * Every test below is one of those two directions - noise that must NOT be
 * reported, and content that must be.
 */
const diff = (before: string, after: string) =>
  diffAst(carveToAstJson(before), carveToAstJson(after))

const kinds = (before: string, after: string) =>
  diff(before, after).map((c) => `${c.kind} ${c.type}`)

describe('changes that are not changes', () => {
  it('reports nothing for a document compared with itself', () => {
    const source = '# H\n\nA /para/ with [a link](/x) and a note[^n].\n\n[^n]: body\n'
    expect(diff(source, source)).toEqual([])
  })

  it('reports nothing when a paragraph is rewrapped', () => {
    // The single most common no-op edit: `fmt` does it, and so does every
    // editor with a wrap width. A soft break renders as a space, so the run it
    // separates is one piece of prose.
    expect(kinds('a very long paragraph that\nwraps here\n', 'a very long paragraph that wraps here\n')).toEqual([])
  })

  it('reports nothing when a list is re-indented', () => {
    expect(kinds('- a\n- b\n', '-   a\n-   b\n')).toEqual([])
  })

  it('reports nothing when only the byte length changed', () => {
    // `srcByteLength` sits on the root and moves with every edit; reporting it
    // would put a line saying "the document is a different length" on top of
    // every diff.
    const changes = diff('# H\n\none\n', '# H\n\n\n\none\n')
    expect(changes.filter((c) => c.type === 'document')).toEqual([])
  })
})

describe('changes that are changes', () => {
  it('reports an edited link destination', () => {
    const [change, ...rest] = diff('see [docs](/a)\n', 'see [docs](/b)\n')
    expect(rest).toEqual([])
    expect(change).toMatchObject({ kind: 'changed', type: 'link', line: 1 })
    expect(change?.detail).toContain('"/a" -> "/b"')
  })

  it('reports an edited heading level', () => {
    expect(kinds('# H\n\nx\n', '## H\n\nx\n')).toEqual(['changed heading'])
  })

  it('reports edited prose against the text node', () => {
    const [change] = diff('hello world\n', 'hello there\n')
    expect(change).toMatchObject({ kind: 'changed', type: 'text' })
    expect(change?.detail).toContain('hello there')
  })

  it('reports an added block', () => {
    const [change, ...rest] = diff('# H\n\none\n', '# H\n\none\n\ntwo\n')
    expect(rest).toEqual([])
    expect(change).toMatchObject({ kind: 'added', type: 'paragraph', line: 5 })
  })

  it('reports a removed block', () => {
    expect(kinds('# H\n\none\n\ntwo\n', '# H\n\none\n')).toEqual(['removed paragraph'])
  })

  it('reports a MOVE rather than a delete and an insert', () => {
    // The distinction a reviewer cares about: the content is intact, it is
    // somewhere else. Reported once, not twice.
    const [change, ...rest] = diff('# H\n\n- a\n- b\n\npara\n', '# H\n\npara\n\n- a\n- b\n')
    expect(rest).toEqual([])
    expect(change).toMatchObject({ kind: 'moved', type: 'list' })
    expect(change?.detail).toContain('index')
  })

  it('reports a hard break, which a soft break is not', () => {
    // The mirror of the rewrap case. A hard break is a construct the author
    // wrote and the renderer honors; folding it in with soft breaks would make
    // losing one invisible.
    expect(kinds('one\ntwo\n', 'one\\\ntwo\n')).toContain('added hard_break')
  })

  it('reports an attribute change', () => {
    const changes = diff('{.a}\npara\n', '{.b}\npara\n')
    expect(changes.map((c) => c.kind)).toContain('changed')
    expect(JSON.stringify(changes)).toContain('classes')
  })

  it('reports a renamed footnote label', () => {
    // The definition and the reference both change; what matters is that the
    // document is reported as different at all, since the rendered HTML is
    // identical (the note is numbered by order, not by label).
    expect(diff('x[^a]\n\n[^a]: n\n', 'x[^b]\n\n[^b]: n\n').length).toBeGreaterThan(0)
  })
})

describe('reporting', () => {
  it('names a node by line when it has one, and by path when it does not', () => {
    const changes = diff('| a | b |\n|---|---|\n| c | d |\n', '| a | b |\n|---|---|\n| c | e |\n')
    expect(changes.length).toBeGreaterThan(0)
    const formatted = formatChanges(changes)
    expect(formatted).toMatch(/(line \d+|\/)/)
  })

  it('says so plainly when nothing changed', () => {
    expect(formatChanges([])).toBe('no structural changes\n')
  })

  it('counts what it reports', () => {
    const changes = diff('# H\n\none\n', '## H\n\ntwo\n')
    expect(formatChanges(changes)).toContain(`${changes.length} structural change`)
  })
})
