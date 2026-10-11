import { expect, it } from 'vitest'
import { carveToMarkdown, carveToMarkdownWithReport, RenderLossError, parse, renderMarkdownWithReport, resolve } from '../src/index.js'
import controls from './fixtures/markdown-nested-emphasis.json'

// Native Carve HTML and cmark-gfm readback validate these Markdown goldens.
it.each(controls)('keeps nested emphasis during Markdown export: $source', ({ source, markdown }) => {
  for (const result of [carveToMarkdownWithReport(source), renderMarkdownWithReport(resolve(parse(source)))]) {
    expect(result.value).toBe(markdown.js)
    expect(result.losses).toEqual([])
    expect(result.totalLosses).toBe(0)
    expect(result.truncated).toBe(false)
  }
})

it('keeps complete ordered loss counts while repairing nested spans', () => {
  const source = '{*a {/b {*x `omitted`{=latex}*} c/} d*} and `tail`{=typst}'
  const report = carveToMarkdownWithReport(source)
  expect(report.value).toBe(carveToMarkdown(source))
  expect(report.losses.map(loss => [loss.code === 'raw-format-dropped' ? loss.format : undefined, loss.pos?.startColumn])).toEqual([['latex', 13], ['typst', 45]])
  expect(report.totalLosses).toBe(2)
  expect(carveToMarkdownWithReport(source, { maxRenderLosses: 0 })).toMatchObject({ losses: [], totalLosses: 2, truncated: true })
  let strictError: unknown
  try {
    carveToMarkdownWithReport(source, { strictLosses: true, maxRenderLosses: 1 })
  } catch (error) {
    strictError = error
  }
  expect(strictError).toBeInstanceOf(RenderLossError)
  expect(strictError).toMatchObject({ totalLosses: 2, truncated: true })
  expect((strictError as RenderLossError).losses).toEqual(report.losses.slice(0, 1))
  expect(carveToMarkdownWithReport('/clean/').totalLosses).toBe(0)
})
