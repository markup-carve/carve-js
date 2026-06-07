import { describe, it, expect } from 'vitest'
import { carveToHtml, tabNormalize } from '../src/index.js'

const src = '```\n\tindented\n```\n\nInline `a\tb` code.'

describe('tabs stay tabs by default (djot-aligned)', () => {
  it('preserves a literal tab in a code block and inline code', () => {
    const out = carveToHtml(src)
    expect(out).toContain('<pre><code>\tindented\n</code></pre>')
    expect(out).toContain('<code>a\tb</code>')
  })
})

describe('tabNormalize extension', () => {
  it('expands tabs to 2 spaces by default (code block + inline)', () => {
    const out = carveToHtml(src, { extensions: [tabNormalize()] })
    expect(out).toContain('<pre><code>  indented\n</code></pre>')
    expect(out).toContain('<code>a  b</code>')
    expect(out).not.toContain('\t')
  })

  it('honors a custom width', () => {
    const out = carveToHtml(src, { extensions: [tabNormalize(4)] })
    expect(out).toContain('<pre><code>    indented\n</code></pre>')
    expect(out).toContain('<code>a    b</code>')
  })

  it('does not touch tabs in prose', () => {
    const out = carveToHtml('a\tb', { extensions: [tabNormalize()] })
    expect(out).toContain('a\tb')
  })
})
