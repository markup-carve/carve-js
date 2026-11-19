// carve#6164: rows and tool fixes for upgrade replay sources that no row explained.
import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const rewrites: [string, string, string][] = [
  ['U-430', 'a /b {+c/ d+}\n', 'a \\/b {+c/ d+}\n'],
  ['U-430', '*a *b*} *\n', '*a \\*b*} *\n'],
  ['U-431', 'a ----------- b\n', 'a ———– b\n'],
  ['U-431', 'x d------------- y\n', 'x d———–– y\n'],
  ['U-258', 'a `text``\n', 'a ` text`` `\n'],
  ['U-258', '> `text``\n', '> ` text`` `\n'],
  ['U-258', '> ``#tag`\n', '> `` #tag` ``\n'],
  ['U-068', '/**/ /**/\n', '{*{/\\*\\/ \\/\\*/}*}\n'],
  ['U-068', '/**/\n/**/\n', '{*{/\\*\\/\n\\/\\*/}*}\n'],
]

describe('replay rows of carve#6164', () => {
  it.each(rewrites)('%s writes %j as %j and keeps the 0.1 HTML', (id, source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === id)).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
  })

  it('leaves a hyphen run whose split is unchanged', () => {
    const source = 'a------- b-------- c----------\n'
    expect(upgrade(source).output).toBe(source)
  })

  it.each([
    ['U-393', '[a %% c] d\n', '%% c] d'],
    ['U-393', '{~alpha %% hidden~>word~} tail\n', '%% hidden~>word~} tail'],
    ['U-393', '{=a\\ %% c=} t\n', '%% c=} t'],
    ['U-426', ':foo[%% c] d\n', '%% c]'],
  ])('%s reports the comment of %j from its marker', (id, source, span) => {
    const result = upgrade(source)
    const record = result.records.find((item) => item.entry === id)
    expect(record?.range).toBeDefined()
    expect(source.slice(record!.range!.startOffset, record!.range!.endOffset)).toBe(span)
    expect(result.records.some((item) => item.status === 'no mapped row')).toBe(false)
  })
})

describe('bare spans with a glued attribute block', () => {
  it.each([
    ['a =b={.x} c\n', 'a {=b=}{.x} c\n'],
    [' =_a={c} b_}\n', ' {=_a=}{c} b_}\n'],
  ])('U-067 braces %j before its attribute block', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === 'U-067')).toBe(true)
  })
})

it('cites no comment row for a comment marker inside a code span', () => {
  const result = upgrade('`[%% note]` and `a %% b]`\n{:fr}\n{:fr}\n {lang=de}\nText\n')
  expect(result.records.some((record) => record.entry === 'U-426' || record.entry === 'U-393')).toBe(false)
})
