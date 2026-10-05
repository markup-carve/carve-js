import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

function expand(source: string, files: Record<string, string>) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, { resolve: (path) => files[path] ?? null })
  return { ...result, rules: result.warnings.map((w) => w.rule), html: renderHtml(resolve(result.doc)) }
}

const pick = (child: string, name: string) => expand(`{{ c #${name} }}`, { c: child })

describe('include fragment selection (PART 9 section 19 I1a)', () => {
  it('selects a non-heading block alone, with its own attributes', () => {
    const r = pick('# Pizza\n\n{#dough}\n```text\n500 g flour\n```\n\nafter', 'dough')
    expect(r.rules).toEqual([])
    expect(r.html).toBe('<pre id="dough"><code class="language-text">500 g flour\n</code></pre>')
  })

  it('a heading wins over an earlier block with the same id', () => {
    const r = pick('{#x}\nfirst\n\n{#x}\n# H\n\nbody', 'x')
    expect(r.html).toContain('<h1>H</h1>')
    expect(r.html).toContain('<p>body</p>')
    expect(r.html).not.toContain('first')
  })

  it('a name compares exactly, so #hello takes the block, not the heading Hello', () => {
    const r = pick('{#hello}\npara\n\n# Hello\n\nbody', 'hello')
    expect(r.html).toBe('<p id="hello">para</p>')
  })

  it('the first block in document order wins, and a container precedes its contents', () => {
    const quote = pick('{#x}\n> {#x}\n> inner\n\n{#x}\nlater', 'x')
    expect(quote.html).toMatch(/^<blockquote id="x">/)
    expect(quote.html).not.toContain('later')
    expect(pick('{#x}\nonce\n\n{#x}\ntwice', 'x').html).toBe('<p id="x">once</p>')
  })

  it('a block at depth is selectable', () => {
    const r = pick('- a\n\n  {#z}\n  ```\n  code\n  ```\n\nafter', 'z')
    expect(r.rules).toEqual([])
    expect(r.html).toBe('<pre id="z"><code>code\n</code></pre>')
  })

  it('a heading inside a container selects up to the end of that container', () => {
    const r = pick('> {#q}\n> ## Q\n>\n> in\n\nafter', 'q')
    expect(r.rules).toEqual([])
    expect(r.html).toContain('<p>in</p>')
    expect(r.html).not.toContain('after')
    expect(r.html).not.toContain('blockquote')
  })

  it.each([
    ['a list item', '-{#li} item\n- two', 'li'],
    ['a table row', '| a |{#row}', 'row'],
    ['a table cell image', '| ![a](a){#im} |', 'im'],
    ['an inline span', 'x [span]{#sp} y', 'sp'],
    ['a footnote block', 'See[^n].\n\n[^n]: {#w}\n    note', 'w'],
    ['a reference definition', '[a]: /x {#rd}\n\n[a]', 'rd'],
    ['nothing', '{#p}\npara', 'nope'],
  ])('an id on %s selects nothing', (_label, child, name) => {
    const r = pick(child, name)
    expect(r.rules).toEqual(['include-section'])
    const source = `{{ c #${name} }}`
    expect(r.html).toBe(renderHtml(resolve(parse(source))))
  })

  it('a block name matches exactly, case included', () => {
    expect(pick('{#Dough}\nyes', 'Dough').html).toBe('<p id="Dough">yes</p>')
    expect(pick('{#Dough}\nyes', 'dough').rules).toEqual(['include-section'])
  })

  it('a digit-leading name selects a digit-leading explicit id', () => {
    const r = pick('{#2024-plan}\n```text\nship it\n```', '2024-plan')
    expect(r.rules).toEqual([])
    expect(r.html).toContain('id="2024-plan"')
    expect(r.html).toContain('ship it')
  })

  it('an inline include splices a selected paragraph without its attributes', () => {
    const r = expand('See {{ c #p }} here.', { c: '{#p .k}\nhello *x*\n\nother' })
    expect(r.rules).toEqual([])
    expect(r.html).toBe('<p>See hello <strong>x</strong> here.</p>')
  })

  it('an inline include of a selected non-paragraph block is block-in-inline', () => {
    const r = expand('See {{ c #z }} here.', { c: '{#z}\n```\ncode\n```' })
    expect(r.rules).toEqual(['include-block-in-inline'])
  })

  it('the shift option applies inside a selected block', () => {
    const r = expand('{{ c #q @shift:1 }}', { c: '{#q}\n> # T\n>\n> body' })
    expect(r.rules).toEqual([])
    expect(r.html).toContain('<h2 id="T">T</h2>')
  })

  it('a selected block that includes its own file is a cycle', () => {
    const r = expand('{{ c #q }}', { c: '{#q}\n> {{ c #q }}' })
    expect(r.rules).toEqual(['include-cycle'])
  })

  it('nested includes outside the selected block are never resolved', () => {
    const calls: string[] = []
    const source = '{{ c #q }}'
    const files: Record<string, string> = { c: '{{ other }}\n\n{#q}\nyes', other: 'x' }
    const result = expandIncludes(parse(source, { positions: true }), source, {
      resolve: (path) => {
        calls.push(path)
        return files[path] ?? null
      },
    })
    expect(calls).toEqual(['c'])
    expect(renderHtml(resolve(result.doc))).toBe('<p id="q">yes</p>')
  })
})

describe('explicit id collisions across inclusions (PART 9 section 19 I5)', () => {
  it('renames a child paragraph id the parent holds, and the child link follows', () => {
    const r = expand('{#tip}\nKeep the dough cold.\n\n{{ child }}', {
      child: '{#tip}\nRest it overnight.\n\n[The tip above](#tip) is this file\'s.',
    })
    expect(r.rules).toEqual(['include-heading-id-rename'])
    expect(r.warnings[0]!.file).toBe('child')
    expect(r.html).toContain('<p id="tip">Keep the dough cold.</p>')
    expect(r.html).toContain('<p id="tip-2">Rest it overnight.</p>')
    expect(r.html).toContain('<a href="#tip-2">The tip above</a>')
  })

  it('a heading and a paragraph share one namespace', () => {
    const r = expand('{#tip}\n# Tip\n\n{{ child }}', { child: '{#tip}\npara' })
    expect(r.rules).toEqual(['include-heading-id-rename'])
    expect(r.html).toContain('<p id="tip-2">para</p>')
  })

  it('an inline span collides with a block', () => {
    const r = expand('{#tip}\npara\n\n{{ child }}', { child: 'a [b]{#tip} c' })
    expect(r.rules).toEqual(['include-heading-id-rename'])
    expect(r.html).toContain('<span id="tip-2">b</span>')
  })

  it('ids compare exactly: {#Tip} and {#tip} do not collide', () => {
    const r = expand('{#Tip}\npara\n\n{{ child }}', { child: '{#tip}\nchild' })
    expect(r.rules).toEqual([])
    expect(r.html).toContain('<p id="tip">child</p>')
  })

  it('a duplicate a single file holds on its own is left alone', () => {
    const r = expand('{{ child }}', { child: '{#x}\none\n\n{#x}\ntwo' })
    expect(r.rules).toEqual([])
    expect(r.html).toBe('<p id="x">one</p>\n<p id="x">two</p>')
  })

  it('two inclusions of the same file collide', () => {
    const r = expand('{{ child }}\n\n{{ child }}', { child: '{#x}\none' })
    expect(r.rules).toEqual(['include-heading-id-rename'])
    expect(r.html).toBe('<p id="x">one</p>\n<p id="x-2">one</p>')
  })

  it('the suffix skips ids the child itself already holds', () => {
    const r = expand('{#x}\np\n\n{{ child }}', { child: '{#x}\na\n\n{#x-2}\nb' })
    expect(r.html).toContain('<p id="x-3">a</p>')
    expect(r.html).toContain('<p id="x-2">b</p>')
  })

  it('every colliding occurrence gets its own suffix and warning; references follow the first', () => {
    const r = expand('{#d}\nparent\n\n{{ child }}', { child: '{#d}\none\n\n{#d}\ntwo\n\n[back](#d)' })
    expect(r.rules).toEqual(['include-heading-id-rename', 'include-heading-id-rename'])
    expect(r.warnings.map((w) => w.message)).toEqual([
      'Id "d" was renamed to "d-2".',
      'Id "d" was renamed to "d-3".',
    ])
    expect(r.html).toContain('<p id="d-2">one</p>')
    expect(r.html).toContain('<p id="d-3">two</p>')
    expect(r.html).toContain('<a href="#d-2">back</a>')
  })

  it('the suffix skips an id the parent writes after the include', () => {
    const r = expand('{#x}\np\n\n{{ child }}\n\n{#x-2}\nlater', { child: '{#x}\na' })
    expect(r.html).toContain('<p id="x-3">a</p>')
    expect(r.html).toContain('<p id="x-2">later</p>')
  })

  it('the suffix skips an id a later inclusion holds, which then keeps it', () => {
    const r = expand('{#x}\np\n\n{{ a }}\n\n{{ b }}', { a: '{#x}\n[self](#x)', b: '{#x-2}\nb' })
    expect(r.rules).toEqual(['include-heading-id-rename'])
    expect(r.html).toContain('<p id="x-3"><a href="#x-3">self</a></p>')
    expect(r.html).toContain('<p id="x-2">b</p>')
  })

  it('the suffix skips an id a nested inclusion holds', () => {
    const r = expand('{#x}\np\n\n{{ a }}', { a: '{#x}\na\n\n{{ b }}', b: '{#x-2}\nb' })
    expect(r.html).toContain('<p id="x-3">a</p>')
    expect(r.html).toContain('<p id="x-2">b</p>')
  })

  it('a rejected inclusion reserves nothing for the suffix', () => {
    const r = expand('{#x}\np\n\n{{ a }}\n\n{{ b #missing }}', { a: '{#x}\na', b: '{#x-2}\nb' })
    expect(r.rules).toEqual(['include-heading-id-rename', 'include-section'])
    expect(r.html).toContain('<p id="x-2">a</p>')
  })

  it('an inline include reserves no id for the paragraph it unwraps', () => {
    const r = expand('See {{ a }} here.\n\n{{ b }}', { a: '{#x}\na', b: '{#x}\nb' })
    expect(r.rules).toEqual([])
    expect(r.html).toBe('<p>See a here.</p>\n<p id="x">b</p>')
  })

  it('an inline include reserves no id for a paragraph a nested include supplies', () => {
    const r = expand('See {{ a }} here.\n\n{{ c }}', { a: '{{ b }}', b: '{#x}\nhello', c: '{#x}\nworld' })
    expect(r.rules).toEqual([])
    expect(r.html).toBe('<p>See hello here.</p>\n<p id="x">world</p>')
  })

  it('a link to an id only the parent defines keeps its name', () => {
    const r = expand('{#top}\nparent\n\n{#tip}\nx\n\n{{ child }}', {
      child: '{#tip}\nmine\n\n[up](#top) and [own](#tip)',
    })
    expect(r.html).toContain('<a href="#top">up</a>')
    expect(r.html).toContain('<a href="#tip-2">own</a>')
  })

  it('a reference definition destination follows the rename', () => {
    const r = expand('{#tip}\nx\n\n{{ child }}', { child: '{#tip}\nmine\n\nSee [it][].\n\n[it]: #tip' })
    expect(r.html).toContain('<a href="#tip-2">it</a>')
  })

  it('a crossref follows a renamed heading case-insensitively', () => {
    const r = expand('{#tip}\n# Parent\n\n{{ child }}', { child: '{#tip}\n# Child\n\nSee </#TIP>.' })
    expect(r.html).toContain('<section id="tip-2">')
    expect(r.html).toContain('href="#tip-2"')
  })

  it('a crossref to a footnote heading follows that heading, not a body block', () => {
    const r = expand('{#x}\nparent\n\n{{ c }}', {
      c: '{#x}\npara\n\nSee </#x>[^n].\n\n[^n]: {#x}\n    # Note heading',
    })
    expect(r.html).toContain('<h1 id="x-3">Note heading</h1>')
    expect(r.html).toContain('href="#x-3"')
  })

  it('a parent crossref still reaches the parent target', () => {
    const r = expand('{#tip}\n# Parent\n\nSee </#tip>.\n\n{{ child }}', { child: '{#tip}\n# Child' })
    expect(r.html).toMatch(/See <a href="#tip">Parent<\/a>/)
  })

  it('footnote labels are a separate namespace', () => {
    const r = expand('{#n}\npara\n\n{{ child }}', { child: 'Note[^n].\n\n[^n]: body' })
    expect(r.rules).toEqual([])
  })

  it('a selected block is renamed on collision like any other', () => {
    const r = expand('{#dough}\nparent\n\n{{ c #dough }}', { c: '{#dough}\nchild' })
    expect(r.rules).toEqual(['include-heading-id-rename'])
    expect(r.html).toContain('<p id="dough-2">child</p>')
  })
})
