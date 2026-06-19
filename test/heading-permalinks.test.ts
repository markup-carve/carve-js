import { describe, expect, it } from 'vitest'

import { carveToHtml, headingPermalinks } from '../src/index.js'

describe('headingPermalinks extension', () => {
  it('appends a permalink anchor to a top-level heading', () => {
    expect(carveToHtml('# My Heading', { extensions: [headingPermalinks()] })).toBe(
      '<section id="My-Heading">\n' +
        '  <h1>My Heading <a href="#My-Heading" class="permalink" aria-label="Permalink">¶</a></h1>\n' +
        '</section>',
    )
  })

  it('honors a custom symbol, cssClass, and ariaLabel', () => {
    expect(
      carveToHtml('# Hi', {
        extensions: [headingPermalinks({ symbol: '#', cssClass: 'anchor', ariaLabel: 'Link' })],
      }),
    ).toBe(
      '<section id="Hi">\n  <h1>Hi <a href="#Hi" class="anchor" aria-label="Link">#</a></h1>\n</section>',
    )
  })

  it('can prepend the anchor', () => {
    expect(carveToHtml('# Hi', { extensions: [headingPermalinks({ prepend: true })] })).toBe(
      '<section id="Hi">\n  <h1><a href="#Hi" class="permalink" aria-label="Permalink">¶</a> Hi</h1>\n</section>',
    )
  })

  it('only targets the configured levels', () => {
    const ext = headingPermalinks({ levels: [2] })
    const html = carveToHtml('# One\n\n## Two', { extensions: [ext] })
    expect(html).toContain('<h1>One</h1>')
    expect(html).toContain('<h2>Two <a href="#Two"')
  })

  it('keeps other heading attributes on the h* (id stays on the section)', () => {
    expect(carveToHtml('{.big}\n# Hi', { extensions: [headingPermalinks()] })).toBe(
      '<section id="Hi">\n  <h1 class="big">Hi <a href="#Hi" class="permalink" aria-label="Permalink">¶</a></h1>\n</section>',
    )
  })

  it('keeps data-source-line on a custom-rendered heading', () => {
    const html = carveToHtml('# Hi', { extensions: [headingPermalinks()], sourceLine: true })
    expect(html).toContain('<h1 data-source-line="1"')
    expect(html).toContain('class="permalink"')
  })

  it('leaves a heading nested in a container untouched (id stays on the h*)', () => {
    // No section wrapper inside a div, so the id must remain on the heading
    // and no permalink is added (heading renderers apply to section headings).
    const html = carveToHtml('::::\n{#x}\n# Hi\n::::', { extensions: [headingPermalinks()] })
    expect(html).toContain('<h1 id="x">Hi</h1>')
    expect(html).not.toContain('permalink')
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('# My Heading')).toBe(
      '<section id="My-Heading">\n  <h1>My Heading</h1>\n</section>',
    )
  })
})
