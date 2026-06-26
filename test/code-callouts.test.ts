import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'
import { codeCallouts } from '../src/code-callouts.js'

const h = (s: string) => carveToHtml(s, { extensions: [codeCallouts()] }).trim()

const SRC = '```js\nconst x = compute();   <1>\nreturn x * 2;          <2>\n```\n\n<1> Runs the expensive step once.\n<2> Doubles the result.'

describe('code callouts', () => {
  it('renders in-code markers as <b class="callout"> bubbles', () => {
    const out = h(SRC)
    expect(out).toContain('const x = compute();   <b class="callout" data-callout="1">1</b>')
    expect(out).toContain('return x * 2;          <b class="callout" data-callout="2">2</b>')
  })

  it('binds the following list as <ol class="callouts"> with explicit values', () => {
    const out = h(SRC)
    expect(out).toContain('<ol class="callouts">')
    expect(out).toContain('<li value="1">Runs the expensive step once.</li>')
    expect(out).toContain('<li value="2">Doubles the result.</li>')
  })

  it('preserves a non-sequential marker number in both bubble and list', () => {
    const out = h('```\nfoo()  <3>\n```\n\n<3> only three.')
    expect(out).toContain('data-callout="3">3</b>')
    expect(out).toContain('<li value="3">only three.</li>')
  })

  it('escapes the code around the marker', () => {
    const out = h('```\na < b && c;  <1>\n```\n\n<1> note.')
    expect(out).toContain('a &lt; b &amp;&amp; c;  <b class="callout" data-callout="1">1</b>')
  })

  it('does not bind a list when the code has no marker', () => {
    const out = h('```\nplain();\n```\n\n<1> orphan.')
    expect(out).not.toContain('class="callouts"')
    expect(out).toContain('&lt;1&gt; orphan.') // ordinary paragraph, literal
  })

  it('does not bind when a following line is not a <n> item', () => {
    const out = h('```\nfoo()  <1>\n```\n\n<1> first.\nnot a callout line.')
    expect(out).not.toContain('class="callouts"')
    // the in-code marker still renders (markers are independent of the list)
    expect(out).toContain('data-callout="1">1</b>')
  })

  it('carries authored attributes onto the <ol>', () => {
    const out = h('```\nfoo()  <1>\n```\n\n{#notes .wide}\n<1> note.')
    expect(out).toContain('<ol id="notes" class="callouts wide">')
  })

  it('does not crash on a document containing a definition list', () => {
    const out = h(':: term\n:  a definition\n\n```\nx  <1>\n```\n\n<1> note.')
    expect(out).toContain('<dl>')
    expect(out).toContain('data-callout="1">1</b>')
  })

  it('off: <n> stays literal in code and the list is an ordinary paragraph', () => {
    const out = carveToHtml(SRC).trim()
    expect(out).toContain('&lt;1&gt;')
    expect(out).not.toContain('class="callout')
    expect(out).toContain('<p>&lt;1&gt; Runs the expensive step once.')
  })

  it('only the trailing <n> on a line is a marker', () => {
    const out = h('```\nVec<2> v;  <1>\n```\n\n<1> note.')
    expect(out).toContain('Vec&lt;2&gt; v;  <b class="callout" data-callout="1">1</b>')
  })
})
