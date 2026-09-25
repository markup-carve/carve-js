import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { glossary } from '../src/glossary.js'
import { tocPlacement } from '../src/table-of-contents.js'

const placed = 'a[^1]\n\n::: footnotes "Notes" [End]\n:::\n\n[^1]: body\n'

describe('a titled directive names the region it places (CARVE-P9-072)', () => {
  it('opens the endnotes section with the title, the label and then the rule', () => {
    expect(carveToHtml(placed)).toContain(
      [
        '<section role="doc-endnotes" aria-labelledby="adm-1">',
        '  <p class="admonition-title" id="adm-1">Notes</p>',
        '  <p class="div-label">End</p>',
        '  <hr>',
      ].join('\n'),
    )
  })

  it('leaves an untitled marker byte-identical', () => {
    const marker = carveToHtml('a[^1]\n\n::: footnotes\n:::\n\n[^1]: body\n')
    const none = carveToHtml('a[^1]\n\n[^1]: body\n')
    expect(marker).toContain('<section role="doc-endnotes" aria-label="Footnotes">')
    expect(marker).toBe(none)
  })

  it('draws the id from the one sequence a titled admonition uses', () => {
    const html = carveToHtml('::: note "First"\nx\n:::\n\na[^1]\n\n::: footnotes "Notes"\n:::\n\n[^1]: body\n')
    expect(html).toContain('<p class="admonition-title" id="adm-1">First</p>')
    expect(html).toContain('<section role="doc-endnotes" aria-labelledby="adm-2">')
    expect(html).toContain('<p class="admonition-title" id="adm-2">Notes</p>')
  })

  it('takes its id in document order, ahead of a titled block written inside it', () => {
    const html = carveToHtml('a[^1]\n\n::: footnotes "Notes"\n::: note "Inner"\nx\n:::\n:::\n\n[^1]: body\n')
    expect(html).toContain('<section role="doc-endnotes" aria-labelledby="adm-1">')
    expect(html).toContain('<p class="admonition-title" id="adm-2">Inner</p>')
  })

  it('names the TOC nav with the title in place of the tocNav default', () => {
    const html = carveToHtml('# Intro\n\n::: toc "Contents" [T]\n:::\n', { extensions: [tocPlacement()] })
    expect(html).toContain(
      [
        '<nav class="toc" aria-labelledby="adm-1">',
        '<p class="admonition-title" id="adm-1">Contents</p>',
        '<p class="div-label">T</p>',
        '<ul>',
      ].join('\n'),
    )
    expect(html).not.toContain('aria-label="Table of contents"')
  })

  it('keeps an author-written name and mints no id for it', () => {
    const html = carveToHtml('# Intro\n\n{aria-label="Mine"}\n::: toc "Contents"\n:::\n', {
      extensions: [tocPlacement()],
    })
    expect(html).toContain('<nav class="toc" aria-label="Mine">')
    expect(html).toContain('<p class="admonition-title">Contents</p>')
    expect(html).not.toContain('aria-labelledby')
  })

  it('carries both tokens into a degraded div, with no name on it', () => {
    const html = carveToHtml('::: footnotes "Notes" [End]\n:::\n')
    expect(html).toContain('<div class="footnotes">')
    expect(html).toContain('<p class="admonition-title">Notes</p>')
    expect(html).toContain('<p class="div-label">End</p>')
    expect(html).not.toContain('aria-label')
  })

  it('puts the tokens before a glossary, whose <dl> holds no paragraph', () => {
    const html = carveToHtml(':: T\n: d\n\n::: glossary "Gloss" [G]\n:: T2\n: d2\n:::\n', {
      extensions: [glossary()],
    })
    expect(html).toContain(
      ['<p class="admonition-title">Gloss</p>', '<p class="div-label">G</p>', '<dl class="glossary">'].join('\n'),
    )
    expect(html).not.toContain('aria-labelledby')
  })
})
