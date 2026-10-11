import { expect, it } from 'vitest'
import { carveToMarkdown, carveToMarkdownWithReport, parse, renderMarkdownWithReport, RenderLossError, resolve } from '../src/index.js'
import controls from './fixtures/markdown-unicode-marker-exhaustion.json'

const pool = Array.from({ length: 6400 }, (_, index) => String.fromCharCode(0xe000 + index)).join('')
const expand = (value: string): string => value.replaceAll('FULL_PRIVATE_USE_POOL', pool)

// These goldens were checked separately with cmark-gfm for HTML and literal Unicode.
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


it('preserves fallback tokens assembled across adjacent text nodes', () => {
  const doc = resolve(parse(`a${pool}b\n`))
  const paragraph = doc.children[0]!
  if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
  const authored = Array.from({ length: 32 }, (_, nonce) => `\ue009m${nonce}x0\ue00a`).join('')
  paragraph.children = [
    { type: 'text', value: pool },
    ...Array.from(authored, value => ({ type: 'text' as const, value })),
    { type: 'text', value: ' a@b.co' },
  ]
  const result = renderMarkdownWithReport(doc)
  expect(result.value).toBe(pool + authored + ' a<!---->@b.co\n')
  expect(result.totalLosses).toBe(0)
})

it('keeps email offsets correct after multi-character escape markers', () => {
  const doc = resolve(parse('ordinary\n'))
  const paragraph = doc.children[0]!
  if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
  paragraph.children = [{ type: 'text', value: pool + ' _ a@b.co' }]
  const result = renderMarkdownWithReport(doc)
  expect(result.value).toBe(pool + ' _ a<!---->@b.co\n')
  expect(result.totalLosses).toBe(0)
})


it('does not reuse probe tokens consumed while protecting list markers', () => {
  const doc = resolve(parse('ordinary\n'))
  const paragraph = doc.children[0]!
  if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
  const token = '\ue009m0x8\ue00a'
  paragraph.children = [
    { type: 'text', value: '1' },
    ...Array.from(token, value => ({ type: 'text' as const, value })),
    { type: 'text', value: ' x' },
  ]
  const anchor = resolve(parse(`\`\`\`\n${pool}\n\`\`\`\n\n`))
  doc.children.push(...anchor.children)
  const result = renderMarkdownWithReport(doc)
  expect(result.value).toContain('1' + token + ' x\n')
  expect(result.totalLosses).toBe(0)
})

it.each(['a*_x*', 'a*x!*', 'a*[x*', 'a*#x*', '*x*_b', '*x*_', 'a/*_x*/'])('preserves tight emphasis with full-pool carriers: %s', source => {
  const expected = carveToMarkdownWithReport(source).value
  const anchor = `\`\`\`\n${pool}\n\`\`\`\n\n`
  const actual = carveToMarkdownWithReport(anchor + source)
  expect(actual.value).toBe(anchor + expected)
  expect(actual.totalLosses).toBe(0)
})


it('charges cross-reference labels equally with character and string carriers', () => {
  const source = '# h {#h}\n\n' + '</#h> '.repeat(400) + '\n'
  const makeDocument = () => {
    const doc = parse(source)
    const heading = doc.children[0]!
    if (heading.type !== 'heading') throw new Error('expected heading')
    heading.children = [{ type: 'text', value: 'h' + '_'.repeat(1000) }]
    doc.srcByteLength = 0
    return doc
  }
  const ordinary = renderMarkdownWithReport(resolve(makeDocument()))
  const fallbackDoc = makeDocument()
  fallbackDoc.children.push(...parse(`\`\`\`\n${pool}\n\`\`\`\n`).children)
  const fallback = renderMarkdownWithReport(resolve(fallbackDoc))
  const boundary = fallback.value.indexOf('\n\n```\n')
  expect(boundary).toBeGreaterThan(0)
  expect(fallback.value.slice(0, boundary) + '\n').toBe(ordinary.value)
  expect(fallback.totalLosses).toBe(ordinary.totalLosses)
})
