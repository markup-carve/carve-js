import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

// carve-js#4008: the quoted fence is the sub-item's first block, so no paragraph takes `after`.
it('ends a nested item on a column-0 line after its quoted fence', () => {
  expect(normalize(carveToHtml('- a\n  - > ```\n    > x\nafter\n'))).toBe(normalize(
    '<ul><li>a<ul><li><blockquote><pre><code>x\n</code></pre></blockquote></li></ul></li></ul><p>after</p>',
  ))
})

it('ends a doubly nested item on a column-0 line after its doubly quoted fence', () => {
  expect(normalize(carveToHtml('1. a\n   * b\n     - > > ~~~\n       > > x\nafter\n'))).toBe(normalize(
    '<ol><li>a<ul><li>b<ul><li><blockquote><blockquote><pre><code>x\n</code></pre></blockquote></blockquote></li></ul></li></ul></li></ol><p>after</p>',
  ))
})

// carve-js#4003: a description separator below its list's column misses the list.
it('ends an item on a column-0 separator after a marker-line description', () => {
  expect(normalize(carveToHtml('- :: t\n  : d\n: e\n'))).toBe(normalize(
    '<ul><li><dl><dt>t</dt><dd>d</dd></dl></li></ul><p>: e</p>',
  ))
})

it('returns a separator at the parent content column to the parent item', () => {
  expect(normalize(carveToHtml('- - :: t\n    : d\n  : e\n'))).toBe(normalize(
    '<ul><li><ul><li><dl><dt>t</dt><dd>d</dd></dl></li></ul>: e</li></ul>',
  ))
})

it('still folds a separator under a plain item paragraph', () => {
  expect(normalize(carveToHtml('- a\n: e\n'))).toBe('<ul><li>a\n: e</li></ul>'.replace('\n', ' '))
})

// carve-js#4002: once a quoted description follows the lead term, a term line interrupts it.
it('ends a quote on a column-0 term after a quoted description', () => {
  expect(normalize(carveToHtml('> :: t\n> : d\n:: v\n'))).toBe(normalize(
    '<blockquote><dl><dt>t</dt><dd>d</dd></dl></blockquote><dl><dt>v</dt></dl>',
  ))
})

it('keeps a column-0 separator as lazy text of a quoted description', () => {
  expect(normalize(carveToHtml('> :: t\n> : d\n: e\n'))).toBe(normalize(
    '<blockquote><dl><dt>t</dt><dd>d : e</dd></dl></blockquote>',
  ))
})

// carve-js#3995: a nested item's line block takes a lazy line as a shallow one does.
it('folds a column-0 line into a nested line block', () => {
  expect(normalize(carveToHtml('- a\n  - b\n    ::: |\n    x\ny\n'))).toBe(normalize(
    '<ul><li>a<ul><li>b<div class="line-block"><p>x<br>y</p></div></li></ul></li></ul>',
  ))
})

it('leaves a nested line block after a comment line', () => {
  expect(normalize(carveToHtml('- a\n  - b\n    ::: |\n    %% c\ny\n'))).toBe(normalize(
    '<ul><li>a<ul><li>b<div class="line-block"><p></p></div></li></ul></li></ul><p>y</p>',
  ))
})
