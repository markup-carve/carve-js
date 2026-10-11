import { expect, it } from 'vitest'
import { carveToMarkdown, carveToMarkdownWithReport, parse, renderMarkdownWithReport, RenderLossError, resolve } from '../src/index.js'
import controls from './fixtures/markdown-unicode-marker-exhaustion.json'

const pool = Array.from({ length: 6400 }, (_, index) => String.fromCharCode(0xe000 + index)).join('')
const expand = (value: string): string => value.replaceAll('FULL_PRIVATE_USE_POOL', pool)

// cmark-gfm readback verifies HTML and literal Unicode in these Markdown goldens.
it.each(controls)('preserves full-pool Markdown output: $source', control => {
  const source = expand(control.source)
  const expected = expand(control.markdown)
  for (const result of [carveToMarkdownWithReport(source), renderMarkdownWithReport(resolve(parse(source)))]) {
    expect(result.value).toBe(expected)
    expect(result.value).toContain(pool)
    expect(result.losses).toEqual([])
    expect(result.totalLosses).toBe(0)
    expect(result.truncated).toBe(false)
  }
})

it('retains ordered losses and strict counts with multi-character escape markers', () => {
  const source = `\`\`\`\n${pool}\n\`\`\`\n\n\`one\`{=latex} and \`two\`{=typst}`
  const result = carveToMarkdownWithReport(source)
  expect(result.value).toBe(carveToMarkdown(source))
  expect(result.value).toContain(pool)
  expect(result.losses.map(loss => loss.code === 'raw-format-dropped' ? loss.format : undefined)).toEqual(['latex', 'typst'])
  expect(result.totalLosses).toBe(2)
  expect(carveToMarkdownWithReport(source, { maxRenderLosses: 0 })).toMatchObject({ losses: [], totalLosses: 2, truncated: true })
  let failure: unknown
  try {
    carveToMarkdownWithReport(source, { strictLosses: true, maxRenderLosses: 1 })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(RenderLossError)
  expect(failure).toMatchObject({ totalLosses: 2, truncated: true })
  expect((failure as RenderLossError).losses).toEqual(result.losses.slice(0, 1))
  expect(carveToMarkdownWithReport('ordinary\n')).toMatchObject({ value: 'ordinary\n', totalLosses: 0, truncated: false })
})

const headings = [
  ['# heading \\#\n', '# heading \\#\n'],
  ['# a \\# \\#\n', '# a # \\#\n'],
  ['# company_id \\#\n', '# company_id \\#\n'],
] as const

it.each(headings)('preserves trailing heading hashes with a full marker pool: %s', (source, expected) => {
  const anchor = `\`\`\`\n${pool}\n\`\`\`\n\n`
  for (const result of [carveToMarkdownWithReport(anchor + source), renderMarkdownWithReport(resolve(parse(anchor + source)))]) {
    expect(result.value).toBe(anchor + expected)
    expect(result.totalLosses).toBe(0)
  }
})
