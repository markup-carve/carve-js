import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// CARVE-P3-001: the bracket scan skips an autolink, so a `]` inside one is
// not the close of a label opened before it.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('an autolink is opaque to the bracket scan', () => {
  it('keeps the link when a bracket sits inside an autolink in its label', () => {
    expect(html('[a <https://x]> b](u)')).toBe('<p><a href="u">a https://x] b</a></p>')
  })

  it('keeps a span label whole and the autolink inside it', () => {
    expect(html('[a <https://x]> b]{.c}')).toBe('<p><span class="c">a <a href="https://x]">https://x]</a> b</span></p>')
  })

  it('keeps an image label whole', () => {
    expect(html('![a <https://x]> b](u)')).toBe('<img src="u" alt="a &lt;https://x]&gt; b">')
  })

  it('treats an email autolink in a label as one link text', () => {
    expect(html('[a <me@x.org> b](u)')).toBe('<p><a href="u">a me@x.org b</a></p>')
  })

  it('lets a bracket after a `<` that opens no autolink close the label', () => {
    expect(html('[a <x]> b](u)')).toBe('<p>[a &lt;x]&gt; b](u)</p>')
  })
})

describe('the autolink skip stays linear', () => {
  const render = (input: string) => void carveToHtml(input)

  perfIt('over autolinks holding a closing bracket inside open labels', () => {
    expectScansLinearly(render, '[a <https://x]> ', { suffix: ' ](u)' })
  })
})
