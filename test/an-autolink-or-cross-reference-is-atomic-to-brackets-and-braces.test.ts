import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// PART 8 resolves autolinks and cross-references before links and emphasis,
// and PART 9 E2a makes both opaque to delimiter pairing.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('an autolink or cross-reference is atomic', () => {
  it('opens no bracket run from a bracket inside an autolink', () => {
    expect(html('<https://a[> *q](u*) z')).toBe('<p><a href="https://a[">https://a[</a> <strong>q](u</strong>) z</p>')
  })

  it('opens no bracket run from a bracket inside a cross-reference', () => {
    expect(html('</#a[> *q](u*) z')).toBe('<p>&lt;/#a[&gt; <strong>q](u</strong>) z</p>')
  })

  it('lets an opener before the autolink close past it', () => {
    expect(html('*p <https://a[> *q](u*) z')).toBe('<p><strong>p <a href="https://a[">https://a[</a> *q](u</strong>) z</p>')
  })

  it('keeps a braced closer inside a cross-reference from closing the span', () => {
    expect(html('{*a </#x*}> b*}')).toBe('<p><strong>a &lt;/#x*}&gt; b</strong></p>')
  })

  it('still hides a real destination after a code span', () => {
    expect(html('*a `<https://q` [x](u*) b')).toBe('<p>*a <code>&lt;https://q</code> <a href="u*">x</a> b</p>')
  })
})

describe('the atomic-region scan stays linear', () => {
  const render = (input: string) => void carveToHtml(input)

  perfIt('over autolinks holding a bracket between destinations', () => {
    expectScansLinearly(render, '<https://a[> *q](u) ', { prefix: '*x ' })
  })

  perfIt('over unclosed cross-reference openers before a destination', () => {
    expectScansLinearly(render, '</#a[', { prefix: '*x ', suffix: ' ](u)' })
  })
})
