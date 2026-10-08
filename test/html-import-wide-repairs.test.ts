import { expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

function source(shape: string, n: number): string {
  if (shape === 'sections') return '<table><tbody><tr><td>x</td></tr></tbody>' + '<tbody></tbody>'.repeat(n) + '</table>'
  if (shape === 'empty-code') return '<p>' + '<code></code>x'.repeat(n) + '</p>'
  if (shape === 'empty-spans') return '<p>' + '<strong></strong>x'.repeat(n) + '</p>'
  return '<p><strong>' + '<strong><code>x</code></strong> y '.repeat(n) + '</strong></p>'
}

it('retains table sections in document order', () => {
  expect(htmlToAst(source('sections', 3)).value.children[0]?.type).toBe('table')
})

it('drops empty code spans and preserves the text between them', () => {
  expect(htmlToCarve(source('empty-code', 8)).value).toBe('xxxxxxxx\n')
})

it('drops empty spans and preserves following text', () => {
  expect(htmlToCarve(source('empty-spans', 8)).value).toBe('xxxxxxxx\n')
})

it('unwraps every refused inner span and retains its text', () => {
  const result = htmlToCarve(source('nested-spans', 8))
  expect(result.value).toContain('`x` y `x` y')
  expect(result.report.diagnostics.filter(item => item.code === 'structure-unspellable')).toHaveLength(8)
})

for (const [shape, small] of [['sections', 2048], ['empty-code', 8192], ['nested-spans', 128]] as const) {
  perfIt(`repairs many ${shape} near linearly`, () => {
    expectBuiltInputScansLinearly(html => {
      if (shape === 'sections') htmlToAst(html)
      else htmlToCarve(html)
    }, n => source(shape, n), { smallRepeats: small, label: shape })
  })
}

it('repairs consecutive nested spans before text merging changes their identities', () => {
  const result = htmlToCarve('<p><strong><strong>x</strong> y <strong>x</strong> y</strong></p>')
  expect(result.value).toBe('*x y x y*\n')
  expect(result.report.diagnostics.filter(item => item.code === 'structure-unspellable')).toHaveLength(2)
})

it('bounds array removal work when many empty code spans are dropped', () => {
  const n = 2048
  const original = Array.prototype.splice
  let shifted = 0
  Array.prototype.splice = function (...args: Parameters<typeof original>) {
    const start = args[0] < 0 ? Math.max(0, this.length + args[0]) : Math.min(this.length, args[0])
    const removed = Math.min(args[1] ?? this.length - start, this.length - start)
    if (removed > 0 && args.length <= 2) shifted += this.length - start - removed
    return Reflect.apply(original, this, args)
  }
  let value: string
  try {
    value = htmlToCarve(source('empty-code', n)).value
  } finally {
    Array.prototype.splice = original
  }
  expect(value).toBe('x'.repeat(n) + '\n')
  expect(shifted).toBeLessThan(64 * n)
})

it('keeps the first refusal when row and span repairs reach the diagnostic cap', () => {
  const blank = '<table><tr><td></td></tr></table>'
  const nested = '<p><strong><strong><code>x</code></strong><strong><code>y</code></strong></strong></p>'
  for (const [html, message] of [[blank + nested, 'Dropped a row'], [nested + blank, 'Unwrapped <strong>'], [blank + nested + blank, 'Dropped a row'], [nested + blank + nested, 'Unwrapped <strong>']] as const) {
    const result = htmlToCarve(html, { maxDiagnostics: 2 })
    expect(result.report.diagnostics[0]?.message).toContain(message)
  }
})

it('keeps title ids when an earlier note leaves the document before title inference', () => {
  const result = htmlToCarve('<p><a href="#fn1" role="doc-noteref">1</a><a href="#fn2" role="doc-noteref">2</a></p><section><div id="fn1"><p id="adm-1">x</p></div><div id="fn2"><aside class="admonition note" aria-labelledby="adm-2"><p class="admonition-title" id="adm-2">T2</p><p>y</p></aside></div></section>', { adapter: 'word' })
  expect(result.report.diagnostics).toEqual([expect.objectContaining({ code: 'attribute-dropped', path: 'footnote[2]/aside[1]/p[1]' })])
})
