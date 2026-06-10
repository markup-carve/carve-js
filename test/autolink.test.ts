import { describe, expect, it } from 'vitest'

import { autolink, carveToHtml } from '../src/index.js'

describe('autolink extension', () => {
  it('links a bare https URL', () => {
    expect(carveToHtml('Visit https://example.com for more.', { extensions: [autolink()] })).toBe(
      '<p>Visit <a href="https://example.com">https://example.com</a> for more.</p>',
    )
  })

  it('leaves a trailing sentence period outside the link', () => {
    expect(carveToHtml('See https://example.com.', { extensions: [autolink()] })).toBe(
      '<p>See <a href="https://example.com">https://example.com</a>.</p>',
    )
  })

  it('links a mailto: address, displaying without the prefix', () => {
    expect(carveToHtml('Mail mailto:a@b.com now.', { extensions: [autolink()] })).toBe(
      '<p>Mail <a href="mailto:a@b.com">a@b.com</a> now.</p>',
    )
  })

  it('links a bare email address via mailto', () => {
    expect(carveToHtml('Ping a@b.com please.', { extensions: [autolink()] })).toBe(
      '<p>Ping <a href="mailto:a@b.com">a@b.com</a> please.</p>',
    )
  })

  it('respects allowedSchemes (https only, no mailto)', () => {
    const ext = autolink({ allowedSchemes: ['https'] })
    expect(carveToHtml('a@b.com and http://x.com', { extensions: [ext] })).toBe(
      '<p>a@b.com and http://x.com</p>',
    )
    expect(carveToHtml('go https://x.com', { extensions: [ext] })).toBe(
      '<p>go <a href="https://x.com">https://x.com</a></p>',
    )
  })

  it('stops before a trailing inline-attribute block so core can attach it', () => {
    expect(carveToHtml('https://x.com{.external}', { extensions: [autolink()] })).toBe(
      '<p><a href="https://x.com" class="external">https://x.com</a></p>',
    )
  })

  it('is inert without the extension (bare URL stays literal)', () => {
    expect(carveToHtml('Visit https://example.com')).toBe('<p>Visit https://example.com</p>')
  })

  it('does not double-link an angle autolink (core handles <url>)', () => {
    // Core consumes <url> first; the matcher only sees positions core declined.
    expect(carveToHtml('<https://example.com>', { extensions: [autolink()] })).toBe(
      '<p><a href="https://example.com">https://example.com</a></p>',
    )
  })
})
