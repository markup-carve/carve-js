import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// PART 9 E2a and CARVE-P3-001 (ruled 2026-10-15): an autolink, a cross-reference
// and a comment are atomic, so no delimiter, arrow or bracket outside one reads inside it.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('an autolink, a cross-reference or a comment is atomic to every outside delimiter', () => {
  it('keeps an autolink whole against the arrow that ends it', () => {
    expect(html("{~a <https://x~>y> b~}")).toBe("<p><s>a <a href=\"https://x~\">https://x~</a>y&gt; b</s></p>")
  })

  it('takes a later arrow outside the autolink', () => {
    expect(html("{~a <https://x~>y~>z b~}")).toBe("<p><del>a <a href=\"https://x~\">https://x~</a>y</del><ins>z b</ins></p>")
  })

  it('keeps a cross-reference whole against the arrow that ends it', () => {
    expect(html("{~a </#x~> b~}")).toBe("<p><s>a &lt;/#x~&gt; b</s></p>")
  })

  it('splits at an arrow after an address that cannot end in a tilde', () => {
    expect(html("{~a <me@x.org~>y> b~}")).toBe("<p><del>a &lt;me@x.org</del><ins>y&gt; b</ins></p>")
  })

  it('hides an insertion closer inside an editorial comment', () => {
    expect(html("{+a {#x+}#} b+}")).toBe("<p><ins>a <span class=\"critic-comment\">x+}</span> b</ins></p>")
  })

  it('hides a deletion closer inside an editorial comment', () => {
    expect(html("{-a {#x-}#} b-}")).toBe("<p><del>a <span class=\"critic-comment\">x-}</span> b</del></p>")
  })

  it('hides an insertion closer inside a delimited comment', () => {
    expect(html("{+a {%x+}%} b+}")).toBe("<p><ins>a  b</ins></p>")
  })

  it('closes a comment opened first at its own closer', () => {
    expect(html("{#a </#x#}> b#}")).toBe("<p><span class=\"critic-comment\">a &lt;/#x</span>&gt; b#}</p>")
  })

  it('keeps a link label whole around a cross-reference holding a bracket', () => {
    expect(html("[a </#x]> b](u)")).toBe("<p><a href=\"u\">a &lt;/#x]&gt; b</a></p>")
  })

  it('keeps a span label whole around a cross-reference', () => {
    expect(html("[a </#x]> b]{.c}")).toBe("<p><span class=\"c\">a &lt;/#x]&gt; b</span></p>")
  })

  it('keeps an image label whole around a cross-reference', () => {
    expect(html("![a </#x]> b](u)")).toBe("<img src=\"u\" alt=\"a &lt;/#x]&gt; b\">")
  })

  it('keeps a label whole around a cross-reference shaped like a destination', () => {
    expect(html("[a </#x](u)> b](v)")).toBe("<p><a href=\"v\">a &lt;/#x](u)&gt; b</a></p>")
  })

  it('keeps a link label whole around a delimited comment', () => {
    expect(html("[a {%x]%} b](u)")).toBe("<p><a href=\"u\">a  b</a></p>")
  })

  it('keeps an inline note whole around a cross-reference', () => {
    expect(html("^[a </#x]> b]")).toBe("<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>a &lt;/#x]&gt; b<a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>")
  })

  it('keeps a cross-reference whole against an arrow before more text', () => {
    expect(html("{~a </#x~>y> b~}")).toBe("<p><s>a &lt;/#x~&gt;y&gt; b</s></p>")
  })
})

describe('the atomic skips stay linear', () => {
  const render = (input: string) => void carveToHtml(input)

  perfIt('over cross-references holding a closing bracket inside open labels', () => {
    expectScansLinearly(render, '[a </#x]> ', { suffix: ' ](u)' })
  })

  perfIt('over substitutions whose only arrow ends an autolink', () => {
    expectScansLinearly(render, '{~a <https://x~>y ', { suffix: ' ~}' })
  })

  perfIt('over cross-references ending in an arrow inside one substitution', () => {
    expectScansLinearly(render, '</#x~> ', { prefix: '{~a ', suffix: ' ~}' })
  })
})
