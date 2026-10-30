import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const render = (source: string) => carveToHtml(source)

describe('nested blocks keep the owner selected by authored columns', () => {
  it('releases a quoted block after a blank following an unused note', () => {
    const html = render('[^n]: # H\n\n> </#H>\n')
    expect(html).toContain('<blockquote><p>&lt;/#H&gt;</p></blockquote>')
  })
  it('keeps an intervening opener in the description after a refused first block', () => {
    const html = render(':: t\n: - +\n   # H\n')
    expect(html).toContain('<li>+</li>\n    </ul>\n    <h1 id="H">H</h1>\n  </dd>')
  })
  it('leaves an intervening quoted first-block fence outside its description', () => {
    const html = render('> :: t\n> : - +\n>  ::: box\n')
    expect(html).not.toContain('<p>::: box</p>')
    expect(html).toContain('</dl>\n  <div class="box">')
  })

  it('releases a line below a footnote marker-line quote', () => {
    const html = render('see[^c]\n\n[^c]: > para\n # H\n')
    expect(html).toContain('</p>\n<section id="H">\n  <h1>H</h1>')
    expect(html).toContain('<blockquote><p>para</p></blockquote>')
    expect(html).not.toContain('<blockquote><p>para\n# H</p></blockquote>')
  })

  it.each(['1. ', '- '])('returns the line after a comment under %s to the list item', marker => {
    const source = `${marker}[^c]: para\n${' '.repeat(marker.length)}%% c\n${' '.repeat(marker.length + 2)}tail\n\nsee[^c]\n`
    const html = render(source)
    expect(html).not.toContain('<p>para</p>\n      <p>tail')
    expect(html).toContain('<li>tail</li>')
  })

  it('ends a folded term before a comment below its authored column', () => {
    const html = render('see[^c]\n\n[^c]: :: t\n      : para\n%% c\n\ntail\n')
    expect(html).toContain('<dt>t</dt>\n        <dd>para</dd>')
    expect(html).not.toContain('<dt>t\n    : para\n</dt>')
  })

  it('keeps a heading at the hosted note body floor', () => {
    const html = render('- see[^n]\n  [^n]: +\n  # h\n    # z\n\nsee[^n]\n')
    expect(html).toContain('</ul>\n<p>see')
    expect(html).toContain('<li id="fn1">\n      <h1 id="h">h</h1>\n      <p>')
    expect(html).toContain('</a>\n    <h1 id="z">z</h1>\n  </li>')
  })

  it('ends a div-hosted note paragraph at a below-column term', () => {
    const html = render('::: box\n[^f]: alpha\n :: term\n:::\n\nSee[^f]\n')
    expect(html).not.toContain('<p>alpha\n:: term')
    expect(html).toContain('<div class="box">\n  <dl>\n    <dt>term</dt>')
  })

  it.each(['', '> '])('ends an open note at a below-column term under %s', prefix => {
    const source = `${prefix}[^f]: alpha\n${prefix} :: term\n${prefix.trimEnd()}\n${prefix}See[^f]\n`
    expect(render(source)).toContain('<p>alpha<a href="#fnref1"')
  })

  it('keeps a refused plus in a note paragraph before a div closer', () => {
    const html = render('::: box\n[^f]: alpha\n+\n:::\n\nSee[^f]\n')
    expect(html).toContain('<p>alpha\n+')
  })

  it('ends the open note paragraph at a below-column marked line', () => {
    const html = render('see[^n]\n\n[^n]: para\n # Heading\ntail\n')
    expect(html).not.toContain('<p>para\n# Heading\ntail')
    expect(html).toContain('<section id="Heading">\n  <h1>Heading</h1>\n  <p>tail</p>')
  })

  it('ends the open note paragraph at a below-column quote marker', () => {
    const html = render('see[^n]\n\n[^n]: para\n > q\ntail\n')
    expect(html).not.toContain('<p>para\n&gt; q\ntail')
    expect(html).toContain('<blockquote><p>q\ntail</p></blockquote>')
  })
})
