import { describe, it, expect } from 'vitest'
import {
  carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi,
  index, tabs, parse, renderHtml, renderMarkdown, renderPlainText, renderAnsi,
} from '../src/index.js'

const options = { smartTypography: { quotes: false } }
const source = `He said "hi" and 'yes'; it's fine... a--b c---d -> <= (c) (r) (tm) +-\n`
const expected = `He said "hi" and 'yes'; it's fine… a–b c—d → ≤ © ® ™ ±`
const targets = [carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi]
const renderers = [renderHtml, renderMarkdown, renderPlainText, renderAnsi]

describe('quotes-only source output', () => {
  it.each(targets)('keeps every other substitution enabled', (render) => {
    expect(render(source, options)).toContain(expected)
    expect(render(source, { smartTypography: { quotes: true } })).toBe(render(source))
    expect(render(source, { smartTypography: {} })).toBe(render(source))
    expect(render(source, { smartTypography: false })).toContain('fine... a--b c---d')
  })

  it.each(renderers)('renders the same AST without changing it', (render) => {
    const doc = parse(source)
    const before = JSON.stringify(doc)
    expect(render(doc, options)).toContain(expected)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it.each(targets)('preserves typed curly quotes, escapes, and code', (render) => {
    const output = render(`“typed” ‘quotes’ \\"escaped\\" \\'single\\' and \`a--b "q"\`\n`, options)
    expect(output.replaceAll('\\', '')).toContain('“typed” ‘quotes’ "escaped" \'single\'')
    expect(output).toContain('a--b "q"')
  })

  it.each(targets)('uses the option for generated heading labels', (render) => {
    const output = render(`# Don't "guess"... a--b\n\n</#Don-t-guess-a-b>\n`, options)
    expect(output.match(/Don't "guess"… a–b/g)?.length).toBe(2)
  })

  it.each(targets)('rejects unsupported family values even on an empty document', (render) => {
    expect(() => render('', { smartTypography: { quotes: 'off' } } as never)).toThrow(TypeError)
    expect(() => render('', { smartTypography: { dashes: false } } as never)).toThrow(TypeError)
  })

  it.each(targets)('retains the legacy null fallback', (render) => {
    expect(render(source, { smartTypography: null } as never)).toBe(render(source))
  })

  it('keeps accessible task labels consistent with their text', () => {
    expect(carveToHtml(`- [ ] Don't "guess"... a--b\n`, options))
      .toContain(`aria-label="Don&apos;t &quot;guess&quot;… a–b"`)
  })

  it('uses the option in tab labels derived from headings', () => {
    const input = `:::: tabs\n::: tab\n# Don't "guess"... a--b\n\nBody.\n:::\n::::\n`
    expect(carveToHtml(input, { ...options, extensions: [tabs()] }))
      .toContain(`>Don't "guess"… a–b</label>`)
  })

  it('uses quote source runs in index backlink names', () => {
    const input = `:index["quoted" term]\n\n::: index\n:::\n`
    const output = carveToHtml(input, { ...options, extensions: [index()] })
    expect(output).toContain('&quot;quoted&quot; term')
    expect(output).not.toMatch(/[“”]/)
  })

  it('keeps HTML heading identifiers unchanged', () => {
    const input = `# Don't "guess"... a--b\n`
    const ids = (output: string) => output.match(/id="[^"]+"/g)
    expect(ids(carveToHtml(input, options))).toEqual(ids(carveToHtml(input)))
  })
})
