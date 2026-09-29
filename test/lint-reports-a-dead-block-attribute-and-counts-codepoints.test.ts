import { describe, expect, it } from 'vitest'
import { carveToHtml, djotMigrationWarnings, lintCarve } from '../src/index.js'

const at = (source: string, rule: string) =>
  lintCarve(source).filter((w) => w.rule === rule).map((w) => `${w.line}:${w.column}`)

// carve-js#2240, part one. PART 9 §15 A4 drops a block attribute with no block
// left to attach to, and docs/validation.md has listed the diagnostic since the
// clause landed. carve-js emitted it nowhere, so the one construct in the
// language that reaches neither the page nor a symbol table did so silently.
describe('lint reports a block attribute that reaches no block', () => {
  it.each([
    ':: t\n: {empty}\n\nflush\n',
    'ref[^a]\n\n[^a]: {empty}\n\nflush\n',
    '> :: t\n> : {empty}\n\nflush\n',
  ])('stays silent for an empty body sentinel: %s', (source) => {
    expect(at(source, 'unattached-block-attribute')).toEqual([])
    expect(carveToHtml(source)).toContain('<p>flush</p>')
  })

  it.each([
    [':: t\n: {.x}\n\nflush\n', '2:3'],
    ['ref[^a]\n\n[^a]: {.x}\n\nflush\n', '3:7'],
    ['para\n\n{empty}\n', '3:1'],
  ])('reports ordinary attributes with no following block: %s', (source, location) => {
    expect(at(source, 'unattached-block-attribute')).toEqual([location])
  })

  it('reports one at an item boundary, where the next marker ends the item', () => {
    expect(at('- a\n\n  {.c}\n- b\n', 'unattached-block-attribute')).toEqual(['3:3'])
  })

  it('reports one on a quote\'s last line, the case the clause is written around', () => {
    expect(at('> q\n> {.k}\n\ntail\n', 'unattached-block-attribute')).toEqual(['2:3'])
  })

  it('reports one at end of document', () => {
    expect(at('a\n\n{.c}\n', 'unattached-block-attribute')).toEqual(['3:1'])
  })

  it('reports one at a description body column, which closes the body paragraph', () => {
    expect(at(':: t\n:  d\n   {.k}\ntail\n', 'unattached-block-attribute')).toEqual(['3:4'])
  })

  it('stays silent when the attribute attaches', () => {
    expect(at('{.c}\na\n', 'unattached-block-attribute')).toEqual([])
  })

  // A2a: `pending` floats PAST a construct that renders nothing, so the run is
  // alive when the definition goes by and must not be reported at it.
  it('stays silent while the run floats past an invisible construct', () => {
    expect(at('{#i}\n[^f]: note\n\ne\n\nsee[^f]\n', 'unattached-block-attribute')).toEqual([])
  })

  it('stays silent inside a code fence or a comment fence', () => {
    expect(at('```\n{.c}\n```\n', 'unattached-block-attribute')).toEqual([])
    expect(at('%%%\n{.c}\n%%%\n', 'unattached-block-attribute')).toEqual([])
  })

  // An indented `{.c}` is paragraph text, not a block attribute, and the rule
  // that owns that case is `block-marker-as-text`. Reporting both would say the
  // line was an attribute and was not.
  it('leaves an indented attribute-shaped line to block-marker-as-text', () => {
    expect(at('a\n\n    {.c}\n', 'unattached-block-attribute')).toEqual([])
    expect(at('a\n\n    {.c}\n', 'block-marker-as-text')).toEqual(['3:5'])
  })
})

// carve-js#2240, part two. Every other rule in this package reports a codepoint
// column; the Markdown-habit rules counted UTF-16, so one emoji earlier in the
// line put the column one past the construct.
describe('the Markdown-habit rules count codepoints', () => {
  const habit = (source: string) =>
    djotMigrationWarnings(source).map((w) => `${w.rule} ${w.line}:${w.column}`)

  it('does not let an astral character widen the column', () => {
    expect(habit('\u{1F600} é **b** ~~d~~\n')).toEqual([
      'markdown-strong-double-star 1:5',
      'markdown-strikethrough-double-tilde 1:11',
    ])
  })

  it('agrees with the semantic rules on the same line', () => {
    const source = '\u{1F600} é **b** [r][nodef]\n'
    expect(habit(source)).toEqual(['markdown-strong-double-star 1:5'])
    expect(at(source, 'unresolved-reference-link')).toEqual(['1:11'])
  })

  it('leaves an all-ASCII line where it was', () => {
    expect(habit('a **b** ~~d~~\n')).toEqual([
      'markdown-strong-double-star 1:3',
      'markdown-strikethrough-double-tilde 1:9',
    ])
  })

  // `start`/`end` are splice targets for `applyMigrationFixes`, so they stay in
  // UTF-16 code units even though `column` does not.
  it('keeps start and end in UTF-16, because a fix splices with them', () => {
    const source = '\u{1F600} **b**\n'
    const [hit] = djotMigrationWarnings(source)
    expect(source.slice(hit!.start, hit!.end)).toBe('**b**')
  })
})

// carve-js#2240, part three. The definition scan is anchored at column 1, so a
// definition indented inside a container was invisible to it and the report fell
// back to line 1 - a line with nothing to do with the definition.
describe('unused-footnote-definition points at the definition', () => {
  it('points inside a list item', () => {
    expect(at('1. a\n   [^f]: note\n    more\ntail\n', 'unused-footnote-definition')).toEqual(['2:4'])
  })

  it('points inside a block quote', () => {
    expect(at('> [^f]: note\n', 'unused-footnote-definition')).toEqual(['1:3'])
  })

  it('still points at a definition written at column 1', () => {
    expect(at('[^f]: note\n', 'unused-footnote-definition')).toEqual(['1:1'])
  })
})
