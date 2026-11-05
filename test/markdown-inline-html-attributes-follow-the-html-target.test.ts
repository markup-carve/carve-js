import { describe, expect, it } from 'vitest'
import { parse, renderHtml, renderMarkdown, resolve } from '../src/index.js'

// carve-js#4417. CARVE-P11-045: an inline node the Markdown target writes as
// inline HTML takes the HTML target's attribute rules, so the attribute order
// and the ID / CLASS folding match the HTML renderer.
const md = (source: string) => renderMarkdown(resolve(parse(source))).trim()
const html = (source: string) => renderHtml(resolve(parse(source))).trim().replace(/^<p>|<\/p>$/g, '')

const CASES: Array<[string, string]> = [
  ['{*b*}{.k #i}', '<strong class="k" id="i">b</strong>'],
  ['{*b*}{#i .k}', '<strong id="i" class="k">b</strong>'],
  ['{*b*}{a=1 #i .k}', '<strong a="1" id="i" class="k">b</strong>'],
  ['{_u_}{.k #i}', '<u class="k" id="i">u</u>'],
  ['{^s^}{.k #i}', '<sup class="k" id="i">s</sup>'],
  ['{*b*}{.k #i ID=z}', '<strong class="k" id="z">b</strong>'],
  ['{*b*}{.k class=m #i}', '<strong class="k m" id="i">b</strong>'],
  ['{/a /*b*/{.k}{#i}/}', '*a <strong class="k" id="i">*b*</strong>*'],
]

describe('Markdown inline HTML attributes follow the HTML target', () => {
  it.each(CASES)('%s', (source, expected) => {
    expect(md(source)).toBe(expected)
  })

  it.each(CASES.slice(0, 7))('%s writes the same attributes as the HTML target', (source) => {
    expect(md(source)).toBe(html(source))
  })
})
