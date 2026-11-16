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
