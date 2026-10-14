import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// PART 8 ranks cross-references with autolinks, above emphasis: the `/` of
// `</#id>` is never a closer for a bare marker opened before it.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a cross-reference is opaque to emphasis', () => {
  it('keeps an unclosed slash literal before a resolved cross-reference', () => {
    expect(html('{#intro}\n# Intro\n\nx /a </#intro> y')).toContain('<p>x /a <a href="#intro">Intro</a> y</p>')
  })

  it('keeps an unclosed slash literal before an unresolved cross-reference', () => {
    expect(html('x /a </#nothing> y')).toBe('<p>x /a &lt;/#nothing&gt; y</p>')
  })

  it('pairs emphasis around a cross-reference', () => {
    expect(html('/a </#nothing> b/')).toBe('<p><em>a &lt;/#nothing&gt; b</em></p>')
  })

  it('does not close on a marker inside the target', () => {
    expect(html('*a </#x*> b*')).toBe('<p><strong>a &lt;/#x*&gt; b</strong></p>')
  })

  it('matches the autolink control', () => {
    expect(html('x /a <https://x.y/b/> y')).toBe('<p>x /a <a href="https://x.y/b/">https://x.y/b/</a> y</p>')
  })
})

describe('the cross-reference exclusion stays linear', () => {
  const render = (input: string) => void carveToHtml(input)

  perfIt('over unclosed cross-reference openers after an emphasis opener', () => {
    expectScansLinearly(render, '</#a', { prefix: '/x ', suffix: ' >' })
  })

  perfIt('over complete cross-references under an emphasis opener', () => {
    expectScansLinearly(render, '</#a> ', { prefix: '/x ' })
  })
})
