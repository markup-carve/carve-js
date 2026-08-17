import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/*
 * PART 9 §27 binds `!` immediately before a backtick run to an INLINE LITERAL,
 * and names the consequence itself: "A literal `!` immediately before a
 * backtick run is therefore written `\!` - the single case this construct
 * reinterprets". So the backslash is not a defensive choice the writer could
 * decline; it is the only spelling of a tree holding a `text` ending in `!`
 * beside a `code` node.
 *
 * What WAS a defect is where the writer learned that. The minimal pass wrote
 * the `!` bare, the redundancy check re-parsed it as a `literal_inline` - a
 * difference `mergeTextRuns` cannot absorb, unlike an ordinary escape - and the
 * WHOLE DOCUMENT escalated to conservative escaping. Punctuation that opens no
 * channel anywhere else in the document came back escaped, which is the
 * over-escaping PART 11 §4 forbids, and carve-rs wrote those lines bare
 * (carve-js#1175).
 *
 * One structural escape keeps the minimal pass winnable, exactly as the
 * caption-opening caret already does (carve-js#614).
 */
describe('a `!` before a code span does not escalate the document', () => {
  const PROSE = 'foo (bar) #baz 50% a-b'

  it('leaves prose elsewhere in the document unescaped', () => {
    const src = `${PROSE}\n\n!\`l\n`
    expect(carveToCarve(src).split('\n')[0]).toBe(PROSE)
  })

  it('the same when the `!` ends a longer text run', () => {
    const src = `${PROSE}\n\na!\`l\n`
    expect(carveToCarve(src).split('\n')[0]).toBe(PROSE)
  })

  it('CONTROL: that prose already round-tripped bare on its own', () => {
    // So the escapes above were the trigger line reaching across the document,
    // not the prose needing them.
    expect(carveToCarve(`${PROSE}\n`)).toBe(`${PROSE}\n`)
  })

  it('the `!` itself is still escaped - §27 leaves no other spelling', () => {
    expect(carveToCarve('!`l\na\n')).toBe('\\!`l\na`\n')
    expect(carveToHtml(carveToCarve('!`l\na\n'))).toBe(carveToHtml('!`l\na\n'))
  })

  it('and the written form is stable under a second pass', () => {
    expect(carveToCarve(carveToCarve('!`l\na\n'))).toBe(carveToCarve('!`l\na\n'))
  })

  it('CONTROL: a real inline literal still writes back bare', () => {
    expect(carveToCarve('!`x`\n')).toBe('!`x`\n')
    expect(carveToCarve('!`x`{.ipa}\n')).toBe('!`x`{.ipa}\n')
    expect((parse('!`x`\n').children[0] as { children: { type: string }[] }).children[0]!.type).toBe(
      'literal_inline',
    )
  })

  it('CONTROL: a code span with no `!` before it is untouched', () => {
    expect(carveToCarve(`${PROSE}\n\n\`l\na\n`)).toBe(`${PROSE}\n\n\`l\na\`\n`)
  })

  it('CONTROL: a `!` NOT before a backtick run keeps its bare form', () => {
    // The escape guards one channel, and only where that channel opens.
    expect(carveToCarve('a! b\n')).toBe('a! b\n')
    expect(carveToCarve('done!\n')).toBe('done!\n')
    expect(carveToCarve('a! $`m`\n')).toBe('a! $`m`\n')
  })
})
