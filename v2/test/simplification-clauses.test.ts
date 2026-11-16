// The clauses the simplifications and rulings of 16 November 2026 changed, reader side.
import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

describe('C2-B-190, C2-I-118: block and inline depth are limited each by itself', () => {
  it('C2-B-190: Example 247, of 201 quote marks the last is text', () => {
    const html = render(`${'> '.repeat(201)}x`)
    expect(html.split('<blockquote>').length - 1).toBe(200)
    expect(html).toContain('<p>&gt; x</p>')
    expect(render(`${'> '.repeat(200)}x`)).toContain('<blockquote><p>x</p></blockquote>')
  })

  it('C2-I-118: behind 197 quote marks a list item forms its link, and the star that never pairs stays text', () => {
    expect(render(`${'> '.repeat(197)}- *[x](u)`)).toContain('<li>*<a href="u">x</a></li>')
  })

  it('C2-I-118: the count starts at zero in each content, so a quote leaves room for 200 superscripts', () => {
    const html = render(`> ${'{^'.repeat(201)}x${'^}'.repeat(201)}`)
    expect(html).toBe(`<blockquote><p>${'<sup>'.repeat(200)}{^x${'</sup>'.repeat(200)}^}</p></blockquote>`)
  })

  it('C2-I-118: a content of a cell, a heading and a caption each counts from zero', () => {
    const deep = `${'{^'.repeat(200)}x${'^}'.repeat(200)}`
    for (const src of [`${'> '.repeat(150)}| ${deep} |`, `${'> '.repeat(150)}# ${deep}`, `${'> '.repeat(150)}![a](b)\n${'> '.repeat(150)}^ ${deep}`]) {
      expect(render(src).split('<sup>').length - 1, src.slice(300, 320)).toBe(200)
    }
  })

  it('C2-I-118: an unpaired delimiter opener counts until the end of its content, a closed one stops counting', () => {
    const open = parse(`${'{^'.repeat(199)}*[x](u)`).children[0]
    expect(JSON.stringify(open)).not.toContain('"link"')
    const closed = parse(`${'{^a^} '.repeat(300)}*[x](u)`).children[0]
    expect(JSON.stringify(closed)).toContain('"link"')
  })
})

describe('C2-B-137: a comment-only line is invisible to block structure', () => {
  const shape = (src: string): unknown => JSON.parse(JSON.stringify(parse(src).children, (key, value: unknown) => key === 'pos' ? undefined : value))

  it('C2-B-137, C2-B-154: Example 248, a comment-only line at column 0 does not close the heading', () => {
    expect(render('= Title\n%% note\n  continues')).toBe('<section id="Title-continues">\n  <h1>Title\ncontinues</h1>\n</section>')
    expect(shape('= Title\n%% note\n  continues')).toEqual([{
      type: 'heading', level: 1, generatedId: 'Title-continues', children: [
        { type: 'text', value: 'Title' }, { type: 'soft_break' }, { type: 'comment', form: 'line', value: 'note' },
        { type: 'soft_break' }, { type: 'text', value: 'continues' },
      ],
    }])
  })

  it('C2-B-138: below a heading the comment is the last child of the heading, and the heading spans its line', () => {
    const node = parse('= Title\n%% note\ntext').children[0]
    expect(node).toMatchObject({ type: 'heading', pos: { startLine: 1, endLine: 2 } })
    expect(node?.type === 'heading' ? node.children.at(-1) : null).toMatchObject({ type: 'comment', value: 'note' })
    expect(render('= Title\n%% note\ntext')).toBe('<section id="Title">\n  <h1>Title</h1>\n  <p>text</p>\n</section>')
  })

  it('C2-B-137: whatever its indent it closes no container and no table, and a pending attribute line waits', () => {
    expect(render('- a\n%% c\n  b')).toBe('<ul>\n  <li>a\nb</li>\n</ul>')
    expect(render('| a |\n%% c\n| b |')).toContain('<tr><td>b</td></tr>')
    expect(render('{.x}\n%% c\npara')).toBe('<p class="x">para</p>')
  })
})
