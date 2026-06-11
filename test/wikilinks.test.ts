import { describe, expect, it } from 'vitest'

import { carveToHtml, wikilinks } from '../src/index.js'

describe('wikilinks extension', () => {
  it('links a bare page name with a slug href', () => {
    expect(carveToHtml('See [[Tigers]] now.', { extensions: [wikilinks()] })).toBe(
      '<p>See <a href="tigers" class="wikilink" data-wikilink="Tigers">Tigers</a> now.</p>',
    )
  })

  it('slugifies multi-word pages', () => {
    expect(carveToHtml('[[Tiger Facts]]', { extensions: [wikilinks()] })).toBe(
      '<p><a href="tiger-facts" class="wikilink" data-wikilink="Tiger Facts">Tiger Facts</a></p>',
    )
  })

  it('supports display text after a pipe', () => {
    expect(carveToHtml('[[tigers|big cats]]', { extensions: [wikilinks()] })).toBe(
      '<p><a href="tigers" class="wikilink" data-wikilink="tigers">big cats</a></p>',
    )
  })

  it('keeps an anchor on the href but not in the page slug', () => {
    expect(carveToHtml('[[page#section]]', { extensions: [wikilinks()] })).toBe(
      '<p><a href="page#section" class="wikilink" data-wikilink="page">page</a></p>',
    )
  })

  it('preserves folder slashes', () => {
    expect(carveToHtml('[[docs/intro]]', { extensions: [wikilinks()] })).toBe(
      '<p><a href="docs/intro" class="wikilink" data-wikilink="docs/intro">docs/intro</a></p>',
    )
  })

  it('honors a custom urlGenerator', () => {
    const ext = wikilinks({ urlGenerator: (p) => '/wiki/' + p.toLowerCase().replace(/ /g, '-') + '.html' })
    expect(carveToHtml('[[Tiger Facts]]', { extensions: [ext] })).toBe(
      '<p><a href="/wiki/tiger-facts.html" class="wikilink" data-wikilink="Tiger Facts">Tiger Facts</a></p>',
    )
  })

  it('honors a custom cssClass', () => {
    expect(carveToHtml('[[A]]', { extensions: [wikilinks({ cssClass: 'wl internal' })] })).toBe(
      '<p><a href="a" class="wl internal" data-wikilink="A">A</a></p>',
    )
  })

  it('adds target/rel when newWindow is set', () => {
    expect(carveToHtml('[[A]]', { extensions: [wikilinks({ newWindow: true })] })).toBe(
      '<p><a href="a" class="wikilink" data-wikilink="A" target="_blank" rel="noopener">A</a></p>',
    )
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('See [[Tigers]].')).toBe('<p>See [[Tigers]].</p>')
  })

  it('leaves an unclosed [[ literal', () => {
    expect(carveToHtml('[[oops', { extensions: [wikilinks()] })).toBe('<p>[[oops</p>')
  })

  it('does not match an empty page', () => {
    expect(carveToHtml('[[]]', { extensions: [wikilinks()] })).toBe('<p>[[]]</p>')
  })

  it('does not match a whitespace-only page', () => {
    expect(carveToHtml('[[   ]]', { extensions: [wikilinks()] })).toBe('<p>[[   ]]</p>')
  })

  it('links an anchor-only target', () => {
    expect(carveToHtml('[[#section]]', { extensions: [wikilinks()] })).toBe(
      '<p><a href="#section" class="wikilink" data-wikilink="">#section</a></p>',
    )
  })
})
