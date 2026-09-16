import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

// markup-carve/carve-js#1786: a trailing hard break puts the closer at the start
// of the next line, where only the braced closer closes. The bytes match
// carve-php (markup-carve/carve-php#2054).
const tree = (source: string) =>
  JSON.stringify(carveToAstJson(source), (key, value) => (key === 'pos' || key === 'srcByteLength' ? undefined : value))

const sources: Array<[string, string, string]> = [
  ['strike', '{~x\\\n~}\n', '{~x\\\n~}\n'],
  ['emphasis', '{/x\\\n/}\n', '{/x\\\n/}\n'],
  ['strong', '{*x\\\n*}\n', '{*x\\\n*}\n'],
  ['underline', '{_x\\\n_}\n', '{_x\\\n_}\n'],
  ['highlight', '{=x\\\n=}\n', '{=x\\\n=}\n'],
  ['only a break', '{~\\\n~}\n', '{~\\\n~}\n'],
  ['two breaks', '{~x\\\ny\\\n~}\n', '{~x\\\ny\\\n~}\n'],
  ['between words', 'a {~x\\\n~} b\n', 'a {~x\\\n~} b\n'],
  ['in a list item', '- {*x\\\n  *}\n', '- {*x\\\n  *}\n'],
  ['strong in emphasis', '{/{*x\\\n*}/}\n', '/{*x\\\n*}/\n'],
  ['emphasis in strike', '{~{/x\\\n/}~}\n', '~{/x\\\n/}~\n'],
]

const htmls: Array<[string, string]> = [
  ['<p><s>x<br></s></p>', '{~x\\\n~}\n'],
  ['<p><s><br></s></p>', '{~\\\n~}\n'],
  ['<p>a<s><br></s>b</p>', 'a{~\\\n~}b\n'],
  ['<p><em>x<br></em></p>', '{/x\\\n/}\n'],
  ['<p>(<strong>x<br></strong>)</p>', '({*x\\\n*})\n'],
  ['<p><mark>x<br></mark></p>', '{=x\\\n=}\n'],
  ['<p><u>x<br></u></p>', '{_x\\\n_}\n'],
  ['<p><sup>x<br></sup></p>', '{^x\\\n^}\n'],
  ['<p><ins>x<br></ins></p>', '{+x\\\n+}\n'],
  ['<p><s>x<br>y<br></s></p>', '{~x\\\ny\\\n~}\n'],
  ['<p><s>x<br> </s></p>', '{~x\\\n~}\n'],
  ['<p><a href="u">x<br></a></p>', '[x\\\n](u)\n'],
  ['<p><s>x\\<br></s></p>', '{~x\\\\\\\n~}\n'],
  ['<p><em><strong>x<br></strong></em></p>', '/{*x\\\n*}/\n'],
  ['<p><s><em>x<br></em></s></p>', '~{/x\\\n/}~\n'],
]

describe('the writer braces an emphasis ending in a hard break', () => {
  it.each(sources)('writes %s', (_, source, formatted) => {
    expect(carveToCarve(source)).toBe(formatted)
  })

  it.each(sources)('keeps the tree of %s', (_, source) => {
    expect(tree(carveToCarve(source))).toBe(tree(source))
  })

  it.each(sources)('writes %s as a fixed point of fmt', (_, _source, formatted) => {
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('keeps the bare closer when text follows the break', () => {
    expect(carveToCarve('{~x\\\ny~}\n')).toBe('~x\\\ny~\n')
  })
})

describe('the HTML importer keeps an emphasis ending in a hard break', () => {
  it.each(htmls)('imports %s', (html, imported) => {
    expect(htmlToCarve(html).value).toBe(imported)
  })

  it.each(htmls)('reads %s back', (html) => {
    expect(carveToHtml(htmlToCarve(html).value).replace(/\n/g, '')).toBe(html.replace('<br> ', '<br>'))
  })

  it.each(htmls)('imports %s as a fixed point of fmt', (_, imported) => {
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('leaves a trailing text backslash bare', () => {
    expect(htmlToCarve('<p><s>x\\</s></p>').value).toBe('~x\\\\~\n')
  })
})
