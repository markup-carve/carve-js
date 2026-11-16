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

describe('C2-B-184, C2-I-120: each fragment of a continuation row is an inline content of its own', () => {
  // The children of the paragraph of the first cell of the first table.
  const cell = (src: string): unknown => {
    type Branch = { type: string, children?: Branch[] }
    let node = parse(src, { positions: false }).children.find((child) => child.type === 'table') as Branch | undefined
    while (node !== undefined && node.type !== 'cell_paragraph') node = node.children?.[0]
    return node?.children ?? null
  }

  it('C2-B-184: Example 249 and a strong span that would cross the row are text, joined by one space', () => {
    expect(render('| `a | 1 |\n+ b` | 2 |')).toContain('<tr><td>`a b`</td><td>1 2</td></tr>')
    expect(render('| *a |\n+ b* |')).toContain('<tr><td>*a b*</td></tr>')
    expect(cell('| *a* |\n+ *b* |')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'a' }] }, { type: 'text', value: ' ' },
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
    ])
  })

  it('C2-I-102: a backslash at the end of a fragment is a hard break, followed by the joining space', () => {
    expect(cell('| a\\ |\n+ b |')).toEqual([{ type: 'text', value: 'a' }, { type: 'hard_break' }, { type: 'text', value: ' b' }])
  })

  it('C2-I-098: an abbreviation term split across two rows does not match across the join', () => {
    expect(cell('*[HT]: Hyper Text\n\n| H |\n+ T |')).toEqual([{ type: 'text', value: 'H T' }])
    expect(JSON.stringify(cell('*[HT]: Hyper Text\n\n| HT |\n+ x |'))).toContain('"abbreviation"')
  })

  it('C2-B-184: an empty fragment adds nothing, and a cell that starts in a continuation row has no joining space', () => {
    expect(cell('| a |\n+ |\n+ c |')).toEqual([{ type: 'text', value: 'a c' }])
    expect(cell('| |\n+ b |')).toEqual([{ type: 'text', value: 'b' }])
  })
})

describe('C2-I-017, C2-I-119: a backtick run with no closing run is text', () => {
  it('C2-I-017: the run is text and the scan goes on behind it, so later forms are read', () => {
    expect(render('see `unclosed *x* and [y](/u)')).toBe('<p>see `unclosed <strong>x</strong> and <a href="/u">y</a></p>')
    expect(render('b* and `c\n\nd`')).toBe('<p>b* and `c</p>\n<p>d`</p>')
    expect(render('a `` b `c` d')).toBe('<p>a `` b <code>c</code> d</p>')
  })

  it('C2-I-017: a `!`, `$` or `$$` glued before an unclosed run is text with it', () => {
    expect(render('the sum $`a + b')).toBe('<p>the sum $`a + b</p>')
    expect(render('x $$`a and !``b')).toBe('<p>x $$`a and !``b</p>')
    expect(parse('x !`b').children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'x !`b' }] })
  })

  it('C2-I-017, C2-B-118: a fence-like line whose info holds a backtick is a paragraph, and its run is text', () => {
    expect(render('```a`b\nx')).toBe('<p>```a`b\nx</p>')
  })

  it('C2-I-017: many unclosed runs of different lengths each find no closer', () => {
    const src = Array.from({ length: 300 }, (_, at) => '`'.repeat(at + 1)).join(' a ')
    expect(render(src)).toBe(`<p>${src}</p>`)
  })
})
