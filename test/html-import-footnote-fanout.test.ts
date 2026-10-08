import { expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

function backlinks(n: number, wrapped = false): string {
  const refs = Array.from({ length: n }, (_, i) => `<a id="ref${i}" href="#fn1" role="doc-noteref">1</a>`).join('')
  const backs = Array.from({ length: n }, (_, i) => {
    const anchor = `<a href="#ref${i}" class="footnote-back">back</a>`
    return wrapped ? `<span>${anchor} </span>` : anchor
  }).join('')
  return `<p>Body ${refs}</p><section><p id="fn1">Note.${backs}</p></section>`
}

function definitions(n: number, wrapped = false): string {
  const refs = Array.from({ length: n }, (_, i) => `<a href="#fn${i}" role="doc-noteref">1</a>`).join('')
  const notes = Array.from({ length: n }, (_, i) => {
    const paragraph = `<p id="fn${i}">Note.</p>`
    return wrapped ? `<div>${paragraph}</div> \n<!--layout-->` : paragraph
  }).join('')
  return `<p>${refs}</p><div id="endnotes">${notes}</div><p>Tail.</p>`
}

function separators(n: number): string {
  return '<p>Body<a href="#fn1" role="doc-noteref">1</a>.</p><section>'
    + '<hr> \n<!--layout-->'.repeat(n) + '<p id="fn1">Note.</p></section><p>Tail.</p>'
}

function duplicateIdentities(n: number): string {
  return '<p>' + '<a id="r" href="#fn1" role="doc-noteref">1</a>'.repeat(n)
    + '</p><section><p id="fn1">Note.' + '<a href="#r" class="footnote-back">back</a>'.repeat(n) + '</p></section>'
}

function deepDefinitions(n: number): string {
  const refs = Array.from({ length: n }, (_, i) => `<a href="#fn${i}" role="doc-noteref">1</a>`).join('')
  const notes = Array.from({ length: n }, (_, i) => `<p id="fn${i}">Note.</p>`).join('')
  return `<p>${refs}</p><section>${'<object>'.repeat(n)}${notes}${'</object>'.repeat(n)}</section><p>Tail.</p>`
}

function nestedBacklinkBlocks(n: number): string {
  const refs = Array.from({ length: n }, (_, i) => `<a id="r${i}" href="#fn${i}" role="doc-noteref">1</a>`).join('')
  const blocks = Array.from({ length: n }, (_, i) => `<div id="fn${i}">`).join('')
  const backs = Array.from({ length: n }, (_, i) => `<a href="#r${i}" class="footnote-back">back</a>`).join('')
  return `<p>${refs}</p><section>${blocks}Note.${backs}${'</div>'.repeat(n)}</section>`
}

function deepAliases(n: number): string {
  const refs = Array.from({ length: n }, (_, i) => `<a href="#alias${i}" role="doc-noteref">1</a>`).join('')
  const targets = Array.from({ length: n }, (_, i) => `<span><a id="alias${i}" href="#unused" class="footnote-back">1</a>`).join('')
  return `<p>${refs}</p><section><p>${targets}Note.${'</span>'.repeat(n)}</p></section>`
}

it('keeps the innermost definition when backlink subtrees overlap', () => {
  const value = htmlToCarve(nestedBacklinkBlocks(64), { adapter: 'word' }).value
  expect(value).toContain('[^1]: Note.')
  expect(value).not.toContain('back')
  expect(value).toContain('(#fn0)')
})

it('still rejects a deep body after resolving its aliases', () => {
  expect(() => htmlToAst(deepAliases(512), { adapter: 'word' })).toThrow('depth')
})

function longInverseClass(n: number, marked = true): string {
  const refs = '<a id="r" href="#fn1" role="doc-noteref">1</a>'.repeat(n)
  return `<p>${refs}</p><section><p>Note.<a id="fn1" href="#r" class="footnote-back ${'noise '.repeat(n)}"${marked ? ' role="doc-noteref"' : ''}>back</a></p></section>`
}

it('keeps every reference when the inverse backlink has many classes', () => {
  for (const marked of [true, false]) {
    const value = htmlToCarve(longInverseClass(64, marked), { adapter: 'word' }).value
    expect(value.split('\n\n')[0]!.match(/\[\^1\]/g)).toHaveLength(64)
    expect(value).toContain('[^1]: Note.')
    expect(value).not.toContain('back')
  }
})

it('keeps references with duplicate identities', () => {
  const value = htmlToCarve(duplicateIdentities(20), { adapter: 'word' }).value
  expect(value.split('\n\n')[0]!.match(/\[\^1\]/g)).toHaveLength(20)
  expect(value).not.toContain('back')
})

it('normalizes notes beneath a deep shared wrapper', () => {
  const value = htmlToCarve(deepDefinitions(64), { adapter: 'word' }).value
  expect(value).toContain('[^64]: Note.')
  expect(value).toContain('Tail.')
})

it('keeps every reference to one note and removes its wrapped backlinks', () => {
  const value = htmlToCarve(backlinks(16, true), { adapter: 'word' }).value
  expect(value.split('\n\n')[0]!.match(/\[\^1\]/g)).toHaveLength(16)
  expect(value).toContain('[^1]: Note.')
  expect(value).not.toContain('back')
})

it('preserves nested backlink cleanup order', () => {
  const back = '<a href="#r" class="footnote-back">back</a>'
  const source = '<p>Body<a id="r" href="#fn1" role="doc-noteref">1</a>.</p>'
    + `<p id="fn1">Note.<span id="outer">${back}<span>${back}</span>${back}</span></p>`
  expect(htmlToCarve(source, { adapter: 'word' }).value).toBe('Body[^1].\n\n[^1]: Note.[]{#outer}\n')
})

it('assigns aliases to one note in definition order', () => {
  const source = '<p><a href="#second" role="doc-noteref">2</a>'
    + '<a href="#alias" role="doc-noteref">1</a><a href="#first" role="doc-noteref">1</a></p>'
    + '<section><p id="first"><a id="alias" href="#ref" class="footnote-back">1</a>First.</p><p id="second">Second.</p></section>'
  expect(htmlToCarve(source).value).toBe('[^2][^1][^1]\n\n[^1]: First.\n\n[^2]: Second.\n')
})

it('keeps the existing placement of several empty note wrappers', () => {
  const source = '<p><a href="#b" role="doc-noteref">2</a><a href="#a" role="doc-noteref">1</a></p>'
    + '<div id="endnotes"><div><p id="a">First.</p></div> \n<!--layout--><div><p id="b">Second.</p></div></div><p>Tail.</p>'
  const value = htmlToCarve(source, { adapter: 'word' }).value
  expect(htmlToCarve(source).value).toContain('%%%\nlayout\n%%%')
  expect(value).toBe('[^2][^1]\n\n{#endnotes}\n:::\n:::: footnotes\n\n::::\n\n%%%\nlayout\n%%%\n:::\n\nTail.\n\n[^1]: First.\n\n[^2]: Second.\n')
})

it('binds many aliases and repeated fragments to one definition', () => {
  const names = Array.from({ length: 20 }, (_, i) => `alias${i}`)
  const refs = [...names, 'alias0', 'alias0'].map(name => `<a href="#${name}" role="doc-noteref">1</a>`).join('')
  const targets = names.map(name => `<a id="${name}" href="#unused" class="footnote-back">1</a>`).join('')
  const value = htmlToCarve(`<p>${refs}</p><section><p>${targets}Note.</p></section>`).value
  expect(value.split('\n\n')[0]!.match(/\[\^1\]/g)).toHaveLength(22)
  expect(value.split('\n\n').slice(1).join('\n\n')).toBe('[^1]: Note.\n')
})

for (const [name, build, small] of [
  ['shared-note backlinks', (n: number) => backlinks(n), 1024],
  ['wrapped backlinks', (n: number) => backlinks(n, true), 1024],
  ['shared definition wrapper', (n: number) => definitions(n), 2048],
  ['empty definition wrappers', (n: number) => definitions(n, true), 4096],
  ['footnote separators', separators, 128],
  ['duplicate reference identities', duplicateIdentities, 1024],
  ['deep shared wrapper', deepDefinitions, 512],
  ['overlapping backlink blocks', nestedBacklinkBlocks, 512],
  ['long inverse backlink classes', longInverseClass, 1024],
  ['long inverse reference classes', (n: number) => longInverseClass(n, false), 1024],
] as const) {
  perfIt(`imports ${name} near linearly`, () => {
    expectBuiltInputScansLinearly(source => { htmlToAst(source, { adapter: 'word' }) }, build,
      { smallRepeats: small, label: name })
  })
}

perfIt('rejects deeply nested footnote aliases near linearly', () => {
  expectBuiltInputScansLinearly(source => {
    expect(() => htmlToAst(source, { adapter: 'word' })).toThrow('depth')
  }, deepAliases, { smallRepeats: 512, label: 'deep footnote aliases' })
})
