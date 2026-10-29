import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// carve-js#3908: the collector re-scanned the whole note body after every lazy line.
const noteRef = '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>'
const backRef = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a marker-line note followed by a lazy run', () => {
  it('folds the lazy lines into the note paragraph', () => {
    expect(flat(carveToHtml('- [^a]: text\nbelow\nbelow\n\nr[^a]\n'))).toBe(
      `<ul><li></li></ul><p>r${noteRef}</p><section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><p>text\nbelow\nbelow${backRef}</p></li></ol></section>`)
  })

  it('ends an open note fence at a lazy line whose closer comes later', () => {
    expect(flat(carveToHtml('- [^a]: text\n    ```\nbelow\n    ```\nafter\n\nr[^a]\n'))).toBe(
      '<ul><li></li></ul><p>below</p><pre><code>after\n\nr[^a]\n</code></pre>')
  })

  const heads: Record<string, string> = {
    'marker-line note': '- [^a]: text\n',
    'ordered marker-line note': '1. [^a]: text\n',
    'note with an open fence': '- [^a]: text\n    ```\n',
    'note over a nested note': '- [^a]: text\n    [^b]: inner\n',
    'nested note': '- x\n  [^a]: text\n',
  }
  for (const [label, prefix] of Object.entries(heads)) {
    perfIt(`parses the ${label} lazy run in linear time`, () => {
      expectScansLinearly((input) => void carveToHtml(input), 'below\n', { label, prefix, suffix: '\nr[^a]\n', smallRepeats: 1000 })
    })
  }
})
