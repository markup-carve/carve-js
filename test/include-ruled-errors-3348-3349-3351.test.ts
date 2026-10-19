import { describe, expect, it } from 'vitest'
import { expandIncludes, lintCarve, parse, renderHtml, resolve } from '../src/index.js'

function expand(source: string, files: Record<string, string>) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, { resolve: (path) => files[path] ?? null })
  return { warnings: result.warnings.map((w) => w.rule), html: renderHtml(resolve(result.doc)), deps: result.dependencies }
}

function lint(source: string, files: Record<string, string>) {
  return lintCarve(source, { includes: { resolve: (path: string) => files[path] ?? null, sourcePath: 'doc.crv' } })
    .filter((w) => w.rule.startsWith('include-'))
    .map((w) => `${w.rule} ${w.line}:${w.column}`)
}

// carve#3348: the file's leading U+FEFF is not content, so a line-1 marker still opens a region.
describe('a byte order mark before a line-1 region marker', () => {
  it('selects the region in a code include', () => {
    const r = expand('{{ snippet.js@region:b @code:js }}', { 'snippet.js': '﻿// #region b\nbomcode()\n// #endregion b\n' })
    expect(r.warnings).toEqual([])
    expect(r.html).toBe('<pre><code class="language-js">bomcode()\n</code></pre>')
  })

  it('selects the region in a Carve include', () => {
    const r = expand('{{ part.crv @region:b }}', { 'part.crv': '﻿%% #region b\nInside.\n%% #endregion b\n\nOutside.\n' })
    expect(r.warnings).toEqual([])
    expect(r.html).toBe('<p>Inside.</p>')
  })
})

// carve#3349: a range starting past the last line is an error; one ending past it still clamps.
describe('an include line range past the end of the file', () => {
  const files = { 'two.txt': 'one\ntwo\n' }

  it.each(['{{ two.txt @lines:3-3 @code }}', '{{ two.txt @lines:3-4 }}'])('warns and stays literal: %s', (source) => {
    const r = expand(source, files)
    expect(r.warnings).toEqual(['include-lines-out-of-range'])
    expect(r.html).toContain('{{ two.txt')
    expect(r.deps).toEqual([{ id: 'two.txt', resolved: true }])
  })

  it('counts no line for a file holding only its byte order mark', () => {
    const r = expand('{{ bom.txt @lines:1-1 @code }}', { 'bom.txt': '\uFEFF' })
    expect(r.warnings).toEqual(['include-lines-out-of-range'])
  })

  it('clamps a range that starts inside the file', () => {
    const r = expand('{{ two.txt @lines:2-9 @code }}', files)
    expect(r.warnings).toEqual([])
    expect(r.html).toBe('<pre><code>two\n</code></pre>')
  })

  it('is a lint finding at the directive', () => {
    expect(lint('{{ two.txt @lines:3-3 @code }}\n', files)).toEqual(['include-lines-out-of-range 1:1'])
  })
})

// carve#3351: an option given twice is an error, never "last one wins".
describe('an include option given twice', () => {
  const files = { 'a.js': 'one()\ntwo()\nthree()\n' }

  it.each([
    '{{ a.js @code:js @code:py }}',
    '{{ a.js @lines:1-1 @lines:3-3 @code }}',
    '{{ a.js @shift:1 @shift:2 @code }}',
    '{{ a.js @code @code:js }}',
    '{{ a.js @region:x @region:x @code }}',
  ])('warns and stays literal: %s', (source) => {
    const r = expand(source, files)
    expect(r.warnings).toEqual(['include-duplicate-option'])
    expect(r.html).toContain('{{ a.js')
    expect(r.deps).toEqual([])
  })

  it('warns in inline position too', () => {
    const r = expand('See {{ a.js @shift:1 @shift:1 }} here.', files)
    expect(r.warnings).toEqual(['include-duplicate-option'])
  })

  it('does not read two directives in one paragraph as one with a repeat', () => {
    const r = expand('{{ a.js @shift:1 }} and {{ a.js @shift:2 }}', files)
    expect(r.warnings).not.toContain('include-duplicate-option')
  })

  it('is a lint finding at the directive', () => {
    expect(lint('Text.\n\n{{ a.js @code:js @code:py }}\n', files)).toEqual(['include-duplicate-option 3:1'])
  })
})
