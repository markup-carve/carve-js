// Properties of the inline pass over every content: balanced and ordered events, every character
// in exactly one top-level range, the same events from a reused state, and no exception.
// See support/inline-checks.ts.
import { describe, expect, it } from 'vitest'
import { acquireInlineState, buildInlineTree, parseTree, releaseInlineState, scanInline } from '../src/index.ts'
import { checkInlines } from './support/inline-checks.ts'
import { enumerateContents, INLINE_TOKENS } from './support/inline-enumerate.ts'
import { inlineShapeOf } from './support/inline-shape.ts'
import { treeShape } from './support/shape.ts'

describe('enumerated contents', () => {
  for (const length of [1, 2, 3]) {
    it(`every content of ${length} tokens over ${INLINE_TOKENS.length} inline tokens`, () => {
      const result = enumerateContents(length)
      expect(result.contents).toBe(INLINE_TOKENS.length ** length)
      expect(result.failures).toEqual([])
    })
  }
})

describe('contents and offsets', () => {
  it('a content with no text has no events', () => {
    expect(treeShape('| | a |')).toBe('table[tr[td[] td["a"]]]')
    expect(checkInlines('| | a |')).toBeNull()
  })

  it('a node keeps offsets into the one source string', () => {
    const src = '> a *b\n> c* `d`\r\n'
    const paragraph = parseTree(src).children![0]!.children![0]!
    const [text, strong, space, code] = paragraph.inlines!
    expect([text!.start, text!.end, strong!.start, strong!.end]).toEqual([2, 4, 4, 11])
    expect([space!.start, space!.end, code!.start, code!.end]).toEqual([11, 12, 12, 15])
    const [b, softBreak, c] = strong!.children!
    expect([b!.start, b!.end, softBreak!.start, softBreak!.end, c!.start, c!.end]).toEqual([5, 6, 6, 9, 9, 10])
  })

  it('offsets count behind a character outside the basic plane as the source string does', () => {
    const src = '😀 *é😀* x'
    const strong = parseTree(src).children![0]!.inlines![1]!
    expect(src.slice(strong.start, strong.end)).toBe('*é😀*')
    expect(checkInlines(src)).toBeNull()
  })

  it('trailing spaces and tabs of a content are no text', () => {
    expect(treeShape('a \t\n\nb  ')).toBe('p["a"] p["b"]')
  })

  it('a line of a line block is a content of its own and keeps its leading spaces', () => {
    expect(treeShape('::: |\n*a\n  b* %% c\n:::')).toBe('lines[line["*a"] line["  b* %% c"]]')
    expect(checkInlines('::: |\n*a\n  b* %% c\n:::')).toBeNull()
  })
})

describe('reused state', () => {
  it('a pass started inside another one takes its own state from the pool', () => {
    const src = '*a* b'
    const outer = acquireInlineState()
    try {
      scanInline(outer, src, [0, src.length], 0, 2, 0, true)
      expect(treeShape('/nested/')).toBe('p[em["nested"]]')
      expect(inlineShapeOf(src, buildInlineTree(src, outer.events, outer.eventLength, () => ''))).toBe('strong["a"] " b"')
    } finally {
      releaseInlineState(outer)
    }
  })

  it('the token, event and stack arrays grow', () => {
    const src = `${'['.repeat(100)}${'{*a '.repeat(50)}${'*b* '.repeat(3000)}${'](/u)'.repeat(100)}`
    expect(checkInlines(src)).toBeNull()
    expect(treeShape(src).split('strong[').length - 1).toBe(3000)
    const lines = Array.from({ length: 400 }, (_, index) => `*l${index}*`).join('\n')
    expect(treeShape(lines).split(' sb ').length).toBe(400)
    expect(checkInlines(lines)).toBeNull()
  })

  it('a delimiter stack with entries that left it grows and empties again', () => {
    // C2-I-053: each slash span fails while a star entry above it stays open.
    const round = `${'/a '.repeat(150)}*b c/d ${'e/ '.repeat(150)}`
    const src = `${round.repeat(12)}${'f* '.repeat(12)}`
    expect(checkInlines(src)).toBeNull()
    expect(treeShape(src).split('strong[').length - 1).toBe(12)
  })
})

describe('what the events hold', () => {
  /** The events of the content `src`, read on a state that has read `before` first. */
  function eventsAfter(before: string, src: string): number[] {
    const state = acquireInlineState()
    try {
      scanInline(state, before, [0, before.length], 0, 2, 0, true)
      scanInline(state, src, [0, src.length], 0, 2, 0, true)
      return Array.from(state.events.subarray(0, state.eventLength))
    } finally {
      releaseInlineState(state)
    }
  }

  it('the tokens of an earlier content are not read', () => {
    // Each first content leaves a token behind the last token of the second one.
    for (const [before, src] of [['`a`{.c}', '`a`'], ['[a][b]', '^[a]'], ['[a](/u)', ':n[a]'], ['^[a]{.c}', '^[a]']]) {
      expect(eventsAfter(before!, src!), src).toEqual(eventsAfter('', src!))
    }
  })

  it('a node with no payload has no span', () => {
    expect(eventsAfter('', 'x`').length).toBe(3 * 3)
    expect(eventsAfter('', '{%%}').length).toBe(2 * 3)
  })

  it('a break at the end of the content ends where the content ends', () => {
    const src = 'x\\ '
    const hardBreak = parseTree(src).children![0]!.inlines![1]!
    expect([hardBreak.start, hardBreak.end]).toEqual([1, 2])
  })

  it('a line comment at the start of a content', () => {
    const src = '%% c\nd'
    const state = acquireInlineState()
    try {
      scanInline(state, src, [0, 4, 5, 6], 0, 4, 0, true)
      expect(inlineShapeOf(src, buildInlineTree(src, state.events, state.eventLength, () => ''))).toBe('%%" c" sb "d"')
      scanInline(state, src, [0, 4, 5, 6], 0, 4, 0, false)
      expect(inlineShapeOf(src, buildInlineTree(src, state.events, state.eventLength, () => ''))).toBe('"%% c" sb "d"')
    } finally {
      releaseInlineState(state)
    }
  })
})
