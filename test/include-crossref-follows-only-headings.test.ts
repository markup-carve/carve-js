import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

function expand(source: string, files: Record<string, string>) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, { resolve: (path) => files[path] ?? null })
  return { ...result, rules: result.warnings.map((w) => w.rule), html: renderHtml(resolve(result.doc)) }
}

// carve-js#2564: a rename only carries a reference that RESOLVES to the renamed
// target when the child is read on its own. `</#id>` reaches headings, so one
// naming a non-heading id is authored literal text and must survive untouched.
describe('a cross-reference follows a rename only when it resolves', () => {
  it('leaves a </#id> that names a renamed paragraph as authored', () => {
    const child = '{#foo}\nA paragraph\n\nsee </#foo> here'
    const alone = expand(child, {})
    expect(alone.html).toContain('&lt;/#foo&gt;')

    const r = expand('{#foo}\nParent para\n\n{{ c }}', { c: child })
    expect(r.rules).toEqual(['include-id-rename'])
    expect(r.html).toContain('<p id="foo-2">A paragraph</p>')
    expect(r.html).toContain('&lt;/#foo&gt;')
    expect(r.html).not.toContain('foo-2&gt;')
  })

  it('still follows a </#id> that names a renamed heading', () => {
    const child = '{#foo}\n# Title\n\nsee </#foo> here'
    const r = expand('{#foo}\nParent para\n\n{{ c }}', { c: child })
    expect(r.rules).toEqual(['include-id-rename'])
    expect(r.html).toContain(`<section id="foo-2">`)
    expect(r.html).toContain('href="#foo-2"')
  })

  it('a link destination still follows a renamed paragraph', () => {
    const r = expand('{#foo}\nParent\n\n{{ c }}', { c: '{#foo}\npara\n\n[x](#foo)' })
    expect(r.html).toContain('<a href="#foo-2">x</a>')
  })
})
