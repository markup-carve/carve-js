import { expect, it } from 'vitest'
import { carveToMarkdownWithReport } from '../src/index.js'

it.each([
  ['{.note}\n:::\nInside a div.\n:::\n', ['markdown-attributes-dropped', 'markdown-container-flattened']],
  ['{#id .cls}\nPara with attrs.\n', ['markdown-attributes-dropped']],
  ['Para with attrs.\n{#id .cls}\n', ['markdown-attributes-dropped']],
  ['{.x}\n- a\n', ['markdown-attributes-dropped']],
  ['![img](a.png)\n^ A caption\n', ['markdown-caption-flattened']],
  ['| a |\n^ A caption\n', ['markdown-caption-flattened']],
  ['::: figure\n![a](x.png)\n^ (a) first\n\n![b](y.png)\n^ (b) second\n:::\n^ Figure #: Group\n', ['markdown-caption-flattened', 'markdown-caption-flattened', 'markdown-caption-flattened']],
  ['```=html\n<b>x</b>\n```\n', ['raw-html-escaped']],
])('reports Markdown loss for %j', (source, codes) => {
  const result = carveToMarkdownWithReport(source as string)
  expect(result.losses.map(loss => loss.code)).toEqual(codes)
  expect(result.totalLosses).toBe(codes.length)
})

it('retains roundtrip carriers without reporting their preserved structure', () => {
  const result = carveToMarkdownWithReport('{.note}\n:::\nInside a div.\n:::\n', { roundtrip: true })
  expect(result.losses).toEqual([])
})

it('does not report a code title that remains in the Markdown fence', () => {
  const result = carveToMarkdownWithReport('{title="t"}\n``` js\nx\n```\n')
  expect(result.value).toContain('"t"')
  expect(result.losses).toEqual([])
})

it('does not report list-table metadata represented by the Markdown table', () => {
  const source = '{header-rows=1 aligns="left,right"}\n::: list-table\n- - A\n  - B\n- - one\n  - x\n:::\n'
  const result = carveToMarkdownWithReport(source)
  expect(result.value).toContain('| A | B |')
  expect(result.losses).toEqual([])
})
