import { describe, expect, it } from 'vitest'
import {
  carveToAnsi,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  fromAstJson,
  parse,
  renderCarve,
  toAstJson,
} from '../src/index.js'
import { tocPlacement } from '../src/table-of-contents.js'

const source = '::: toc "Contents"\n:::\n'

describe('a generated-content directive keeps its quoted title', () => {
  it('publishes and ingests the inline title', () => {
    const wire = toAstJson(parse(source))
    const directive = wire.children[0] as { type: string; title?: unknown }
    expect(directive.type).toBe('directive')
    expect(directive.title).toMatchObject([{ type: 'text', value: 'Contents' }])
    expect(toAstJson(fromAstJson(wire))).toEqual(wire)
  })

  it('writes the title back into the opener', () => {
    const written = renderCarve(parse(source))
    expect(written).toContain('::: toc "Contents"')
    expect(toAstJson(parse(written)).children[0]).toHaveProperty('title')
  })

  it('renders the title in the generic HTML fallback and flat targets', () => {
    expect(carveToHtml(source)).toContain('<p class="admonition-title">Contents</p>')
    expect(carveToMarkdown(source)).toContain('**Contents**')
    expect(carveToPlainText(source)).toContain('Contents')
    expect(carveToAnsi(source)).toContain('Contents')
  })

  it('keeps an explicitly empty quoted title', () => {
    const empty = '::: toc ""\n:::\n'
    expect(toAstJson(parse(empty)).children[0]).toHaveProperty('title', [])
    expect(renderCarve(parse(empty))).toContain('::: toc ""')
    expect(carveToHtml(empty)).toContain('<p class="admonition-title"></p>')
  })

  // Both cases read the other way round before CARVE-P9-072: the title was a
  // sibling BEFORE the placed element, which left it outside the region it
  // names while the region kept the labels-map default.
  it('renders the title inside a generated TOC', () => {
    const html = carveToHtml('# Intro\n\n::: toc "Contents"\n:::\n', { extensions: [tocPlacement()] })
    expect(html).toContain('<nav class="toc" aria-labelledby="adm-1">')
    expect(html.indexOf('<nav class="toc"')).toBeLessThan(html.indexOf('admonition-title'))
  })

  it('renders the title inside the placed endnotes section', () => {
    const html = carveToHtml('a[^1]\n\n::: footnotes "Notes"\n:::\n\n[^1]: body\n')
    expect(html).toContain('<section role="doc-endnotes" aria-labelledby="adm-1">')
    expect(html.indexOf('doc-endnotes')).toBeLessThan(html.indexOf('admonition-title'))
  })
})
