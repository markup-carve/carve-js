import { describe, expect, it } from 'vitest'
import {
  carveToAnsi,
  carveToAstJson,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  fromAstJson,
  lintCarve,
  parse,
  renderCarve,
} from '../src/index.js'

describe('delimited inline comments (PART 9 §21a)', () => {
  it('closes at the first %} and does not nest', () => {
    expect(carveToHtml('foo {% bar %} baz').trim()).toBe('<p>foo  baz</p>')
    expect(carveToHtml('a {% one {% two %} b').trim()).toBe('<p>a  b</p>')
  })

  it('leaves an unterminated opener literal', () => {
    expect(carveToHtml('a {% oops').trim()).toBe('<p>a {% oops</p>')
  })

  it('is opaque inside code spans and raw inlines', () => {
    expect(carveToHtml('Run `a {% x %} b` then done.').trim()).toBe(
      '<p>Run <code>a {% x %} b</code> then done.</p>',
    )
    expect(carveToHtml('`a {% x %} b`{=html}').trim()).toBe('<p>a {% x %} b</p>')
  })

  it('is transparent to emphasis and link structure', () => {
    expect(carveToHtml('*bo{% c %}ld* text').trim()).toBe('<p><strong>bold</strong> text</p>')
    expect(carveToHtml('[li{% ] %}nk](https://example.test)').trim()).toBe(
      '<p><a href="https://example.test">link</a></p>',
    )
  })

  it('crosses soft line breaks but not paragraph boundaries', () => {
    expect(carveToHtml('a {% one\ntwo %} b').trim()).toBe('<p>a  b</p>')
    expect(carveToHtml('a {% one\n\ntwo %} b').trim()).toBe(
      '<p>a {% one</p>\n<p>two %} b</p>',
    )
  })

  it('honors an escaped opener', () => {
    expect(carveToHtml('a \\{% not a comment %} b').trim()).toBe(
      '<p>a {% not a comment %} b</p>',
    )
  })

  it('drops the comment from every presentation target', () => {
    const source = 'a {% hidden %} b'
    expect(carveToHtml(source)).not.toContain('hidden')
    expect(carveToMarkdown(source)).not.toContain('hidden')
    expect(carveToPlainText(source)).not.toContain('hidden')
    expect(carveToAnsi(source)).not.toContain('hidden')
  })

  it('coexists with %% in a table cell', () => {
    const html = carveToHtml('| A {% x %} B | C %% y |\n| --- | --- |')
    expect(html).toContain('<th scope="col">A  B</th>')
    expect(html).toContain('<th scope="col">C</th>')
    expect(html).not.toContain('x')
    expect(html).not.toContain('y')
  })

  it('records delimiter choice and trims at most one padding space', () => {
    const children = (parse('{%  bar  %}') as any).children[0].children
    expect(children[0]).toMatchObject({
      type: 'comment',
      block: false,
      delimited: true,
      content: ' bar ',
    })
    const wire = carveToAstJson('{%bar%}') as any
    expect(wire.children[0].children[0]).toMatchObject({ delimited: true, content: 'bar' })
    expect(renderCarve(fromAstJson(wire))).toBe('{% bar %}\n')
  })

  it('formats without swallowing following prose and is idempotent', () => {
    const source = 'foo {% bar %} baz'
    const once = renderCarve(parse(source))
    expect(once).toBe('foo {% bar %} baz\n')
    expect(renderCarve(parse(once))).toBe(once)
    expect(carveToHtml(once)).toBe(carveToHtml(source))
  })

  it('does not change the %% form or emit delimited false', () => {
    const wire = carveToAstJson('foo %% bar') as any
    expect(wire.children[0].children.at(-1)).toMatchObject({ type: 'comment', content: 'bar' })
    expect(wire.children[0].children.at(-1)).not.toHaveProperty('delimited')
  })
})

describe('braced-comment-in-a-template-source lint', () => {
  it('reports template tag shapes alongside braced comments without rewriting', () => {
    const source = '{% raw %}\ntext {% note %}\n{% endraw %}'
    expect(lintCarve(source).map((warning) => warning.rule)).toContain(
      'braced-comment-in-a-template-source',
    )
    expect(renderCarve(parse(source))).toContain('{% raw %}')
  })

  it('does not report an ordinary braced comment alone', () => {
    expect(lintCarve('text {% note %}')).toEqual([])
  })

  it('reports EVERY tag-shaped comment and no other', () => {
    // The report points at the constructs that vanish. An ordinary note in the
    // same document is not one of them, and the second tag is.
    const source = '{% raw %}\ntext {% note %}\n{% endraw %}'
    const reported = lintCarve(source).filter(
      (warning) => warning.rule === 'braced-comment-in-a-template-source',
    )
    expect(reported).toHaveLength(2)
    expect(reported.map((warning) => warning.line)).toEqual([1, 3])
  })
})
