import { describe, expect, it } from 'vitest'

import { carveToHtml, externalLinks } from '../src/index.js'

describe('externalLinks extension', () => {
  it('adds target and rel to an external link', () => {
    expect(carveToHtml('[docs](https://example.com)', { extensions: [externalLinks()] })).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a></p>',
    )
  })

  it('leaves relative and anchor links untouched', () => {
    expect(carveToHtml('[a](/local) [b](#sec)', { extensions: [externalLinks()] })).toBe(
      '<p><a href="/local">a</a> <a href="#sec">b</a></p>',
    )
  })

  it('appends nofollow when requested', () => {
    expect(
      carveToHtml('[x](http://x.com)', { extensions: [externalLinks({ nofollow: true })] }),
    ).toBe('<p><a href="http://x.com" target="_blank" rel="noopener noreferrer nofollow">x</a></p>')
  })

  it('honors custom target and rel', () => {
    expect(
      carveToHtml('[x](https://x.com)', {
        extensions: [externalLinks({ target: '_top', rel: 'external' })],
      }),
    ).toBe('<p><a href="https://x.com" target="_top" rel="external">x</a></p>')
  })

  it('also marks an autolinked external URL', () => {
    // Composes with the link tree regardless of how the link was produced.
    expect(carveToHtml('<https://x.com>', { extensions: [externalLinks()] })).toBe(
      '<p><a href="https://x.com" target="_blank" rel="noopener noreferrer">https://x.com</a></p>',
    )
  })

  it('marks links nested in a table cell (generic walk)', () => {
    const src = '|= H |\n| [x](https://x.com) |'
    const html = carveToHtml(src, { extensions: [externalLinks()] })
    expect(html).toContain('<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('marks links nested in a list item', () => {
    const html = carveToHtml('- [x](https://x.com)', { extensions: [externalLinks()] })
    expect(html).toContain('target="_blank"')
  })

  it('marks links inside a footnote definition (rendered in endnotes)', () => {
    const html = carveToHtml('See[^a]\n\n[^a]: ref [x](https://x.com)', {
      extensions: [externalLinks()],
    })
    expect(html).toContain('<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('replaces a case-variant existing target attribute', () => {
    // `{Target=_self}` must not survive alongside the enforced lowercase one.
    const html = carveToHtml('[x](https://x.com){Target=_self}', { extensions: [externalLinks()] })
    expect(html).toBe(
      '<p><a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a></p>',
    )
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('[x](https://x.com)')).toBe('<p><a href="https://x.com">x</a></p>')
  })
})
