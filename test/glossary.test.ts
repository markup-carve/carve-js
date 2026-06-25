import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'
import { glossary } from '../src/glossary.js'

const h = (s: string) => carveToHtml(s, { extensions: [glossary()] }).trim()

const GLOSS_HTTP = '::: glossary\n:: HTTP\n:  HyperText Transfer Protocol.\n:::'

const GLOSS = '::: glossary\n:: HTTP\n:  HyperText Transfer Protocol.\n\n:: HTML\n:  HyperText Markup Language.\n:::'

describe('glossary', () => {
  it('renders the ::: glossary block as a <dl> with gloss- ids', () => {
    const out = h(GLOSS)
    expect(out).toContain('<dl class="glossary">')
    expect(out).toContain('<dt id="gloss-http">HTTP</dt>')
    expect(out).toContain('<dd>HyperText Transfer Protocol.</dd>')
    expect(out).toContain('<dt id="gloss-html">HTML</dt>')
  })

  it('links :term[word] to a defined entry by slug', () => {
    const out = h(`Use :term[HTTP].\n\n${GLOSS}`)
    expect(out).toContain('<a href="#gloss-http" class="term">HTTP</a>')
  })

  it('degrades :term for an undefined term to a plain span', () => {
    const out = h(`Use :term[FTP].\n\n${GLOSS}`)
    expect(out).toContain('<span class="term">FTP</span>')
    expect(out).not.toContain('href="#gloss-ftp"')
  })

  it('renders entries in source order', () => {
    const out = h(GLOSS)
    expect(out.indexOf('gloss-http')).toBeLessThan(out.indexOf('gloss-html'))
  })

  it('gives the id to the first of a duplicated slug only', () => {
    const out = h('::: glossary\n:: HTTP\n:  One.\n\n:: HTTP\n:  Two.\n:::')
    expect(out.match(/id="gloss-http"/g)?.length).toBe(1)
    expect(out).toContain('<dt>HTTP</dt>') // the duplicate, id-less
  })

  it('degrades to the generic fallback when the extension is off', () => {
    const out = carveToHtml('Use :term[HTTP].').trim()
    expect(out).toContain('<span class="ext-term">HTTP</span>')
  })

  it('preserves authored attributes on the <dl>', () => {
    const out = h('{#terms .wide}\n::: glossary\n:: HTTP\n:  HyperText Transfer Protocol.\n:::')
    expect(out).toContain('<dl id="terms" class="glossary wide">')
  })

  it('preserves intro prose and a second definition list', () => {
    const out = h('::: glossary\nProtocols below.\n\n:: HTTP\n:  One.\n\n:: FTP\n:  Two.\n:::')
    expect(out).toContain('Protocols below.')
    expect(out).toContain('<dt id="gloss-http">HTTP</dt>')
    expect(out).toContain('<dt id="gloss-ftp">FTP</dt>')
  })

  it('keeps a trailing note after the terms in source order', () => {
    const out = h('::: glossary\n:: HTTP\n:  One.\n\nSee the RFCs.\n:::')
    expect(out.indexOf('gloss-http')).toBeLessThan(out.indexOf('See the RFCs.'))
  })

  it('carries inline attributes on :term', () => {
    const out = h(`Use :term[HTTP]{.abbr #use}.\n\n${GLOSS_HTTP}`)
    expect(out).toContain('href="#gloss-http"')
    expect(out).toContain('id="use"')
    expect(out).toContain('class="term abbr"')
  })

  it('drops an author href so the glossary link has only one', () => {
    const out = h(`:term[HTTP]{href="#other"}.\n\n${GLOSS_HTTP}`)
    expect(out).toContain('<a href="#gloss-http" class="term">HTTP</a>')
    expect(out).not.toContain('#other')
  })

  it('drops an author href case-insensitively', () => {
    const out = h(`:term[HTTP]{HREF="#other"}.\n\n${GLOSS_HTTP}`)
    expect(out).not.toContain('#other')
    expect(out.match(/href=/gi)?.length).toBe(1)
  })

  it('assigns ids consistently when the same instance renders twice', () => {
    const ext = glossary()
    carveToHtml(GLOSS_HTTP, { extensions: [ext] })
    const out = carveToHtml(GLOSS_HTTP, { extensions: [ext] }).trim()
    expect(out).toContain('<dt id="gloss-http">HTTP</dt>')
  })

  it('finds a ::: glossary nested inside a blockquote', () => {
    const out = h('Use :term[HTTP].\n\n> ::: glossary\n> :: HTTP\n> :  HyperText Transfer Protocol.\n> :::')
    expect(out).toContain('<dt id="gloss-http">HTTP</dt>')
    expect(out).toContain('<a href="#gloss-http" class="term">HTTP</a>')
  })
})
