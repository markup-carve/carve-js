// carve#6910: the catalog message of `fence-title-syntax` for each kind of further words (C2-B-122, C2-B-117).
import { describe, expect, it } from 'vitest'
import { parseWithDiagnostics } from '../src/index.ts'

const FURTHER = (opener: string): string => 'These further words are not read as a title, label or attributes. The block opens without '
  + `them. Use "${opener}" for the same block with only valid opener parts; put attributes on their own line above it.`
const AFTER_TITLE = 'These words follow a valid title and are not part of the code fence opener. Remove them or put them in the block body.'

function titleMessages(src: string): string[] {
  return parseWithDiagnostics(src).diagnostics.filter((entry) => entry.code === 'fence-title-syntax').map((entry) => entry.message)
}

describe('fence-title-syntax messages', () => {
  it.each([
    ['```=html~\n<b>x</b>\n```\n'],
    ['```=html\tfoo bar\nx\n```\n'],
    ['```=html "t"\nx\n```\n'],
    ['```=html "t" x\nx\n```\n'],
    ['``` =html [l]\nx\n```\n'],
    ['```` =latex\tx\nx\n````\n'],
  ])('C2-B-122: a raw fence takes no title and no label, so %j reports further words', (src) => {
    const run = /^`+/.exec(src)![0]
    expect(titleMessages(src)).toEqual([FURTHER(`${run} =${/=(\w+)/.exec(src)![1]}`)])
  })

  it('C2-B-116: "=" with no format name is no raw format, and what follows the run is further words', () => {
    expect(titleMessages('```=\nx\n```\n')).toEqual([FURTHER('```')])
    expect(titleMessages('``` = foo\nx\n```\n')).toEqual([FURTHER('```')])
  })

  it('C2-B-122: the corrected opener keeps the valid title and label before the further words', () => {
    expect(titleMessages('```[l] x\nx\n```\n')).toEqual([FURTHER('``` [l]')])
    expect(titleMessages('```` js [l]\t[m]\nx\n````\n')).toEqual([FURTHER('```` js [l]')])
  })

  it('C2-B-122: a div takes the further-words message, not the code-fence one, after a title', () => {
    expect(titleMessages('::: note "T" x\nx\n:::\n')).toEqual([FURTHER('::: note "T"')])
    expect(titleMessages(':::: js "t" {.b}\nx\n::::\n')).toEqual([FURTHER(':::: js "t"')])
    expect(titleMessages('::: "t"\tx\nx\n:::\n')).toEqual([FURTHER('::: "t"')])
  })

  it('C2-B-122: words glued behind a code-fence title follow a valid title', () => {
    expect(titleMessages('``` js "t""u"\nx\n```\n')).toEqual([AFTER_TITLE])
    expect(titleMessages('```"t" x\nx\n```\n')).toEqual([AFTER_TITLE])
  })

  it('C2-B-122: the typographic-quote message needs a code fence type; with none the title is further words', () => {
    expect(titleMessages('``` \u201ct\u201d\nx\n```\n')).toEqual([FURTHER('```')])
    expect(titleMessages('``` js \u201ct\u201d\nx\n```\n')[0]).toContain('The title after "js" uses typographic quotes.')
  })

  it('C2-B-117: a brace block behind spaces is further words, behind a tab the whitespace message', () => {
    expect(titleMessages('```  {a=1}\nx\n```\n')).toEqual([FURTHER('```')])
    expect(titleMessages('```  {.a}\nx\n```\n')).toEqual([FURTHER('```')])
    expect(titleMessages('``` \t{a=1}\nx\n```\n')[0]).toContain('The whitespace in this fence opener is invalid')
    expect(titleMessages('```\t{.a}\nx\n```\n')[0]).toContain('The whitespace in this fence opener is invalid')
  })

  it('C2-B-117: a tab inside a valid title or label separates no opener parts', () => {
    expect(titleMessages('```js "foo\tbar" junk\nx\n```\n')).toEqual([AFTER_TITLE])
    expect(titleMessages('```js [foo\tbar] junk\nx\n```\n')).toEqual([FURTHER('``` js [foo\tbar]')])
  })
})
