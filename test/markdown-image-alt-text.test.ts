import { expect, it } from 'vitest'
import { carveToMarkdown, carveToMarkdownWithReport, RenderLossError, parse, renderMarkdownWithReport, resolve } from '../src/index.js'
import controls from './fixtures/markdown-image-alt-text.json'

// These goldens were checked separately with Carve and cmark-gfm readers.
it.each(controls)('keeps literal image alt text during Markdown export: $source', ({ source, markdown }) => {
  for (const result of [carveToMarkdownWithReport(source), renderMarkdownWithReport(resolve(parse(source)))]) {
    expect(result.value).toBe(markdown.js)
    expect(result.losses).toEqual([])
    expect(result.totalLosses).toBe(0)
    expect(result.truncated).toBe(false)
  }
})

it('keeps ordered loss counts after escaping image labels', () => {
  const source = 'a ![**alt** _x_](u) `one`{=latex} and `two`{=typst}'
  const report = carveToMarkdownWithReport(source)
  expect(report.value).toBe(carveToMarkdown(source))
  expect(report.losses.map(loss => loss.code === 'raw-format-dropped' ? loss.format : undefined)).toEqual(['latex', 'typst'])
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
