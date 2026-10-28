import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const render = (source: string) => carveToHtml(source)

describe('nested blocks keep the owner selected by authored columns', () => {
  it('leaves an intervening quoted first-block fence outside its description', () => {
    const html = render('> :: t\n> : - +\n>  ::: box\n')
    expect(html).toContain('<p>::: box</p>')
    expect(html).not.toContain('<div class="box">')
  })

  it('releases a line below a footnote marker-line quote', () => {
    const html = render('see[^c]\n\n[^c]: > para\n # H\n')
    expect(html).toContain('<p># H</p>')
    expect(html).toContain('<blockquote><p>para</p></blockquote>')
    expect(html).not.toContain('<blockquote><p>para\n# H</p></blockquote>')
  })

  it.each(['1. ', '- '])('keeps a note body after a comment under %s', marker => {
    const source = `${marker}[^c]: para\n${' '.repeat(marker.length)}%% c\n${' '.repeat(marker.length + 2)}tail\n\nsee[^c]\n`
    const html = render(source)
    expect(html).toContain('<p>para</p>\n      <p>tail')
    expect(html).not.toContain('<li>tail</li>')
  })

  it('ends a folded term before a comment below its authored column', () => {
    const html = render('see[^c]\n\n[^c]: :: t\n      : para\n%% c\n\ntail\n')
    expect(html).toContain('<dt>t\n    : para</dt>')
    expect(html).not.toContain('<dt>t\n    : para\n</dt>')
  })

  it('keeps a heading at the hosted note body floor', () => {
    const html = render('- see[^n]\n  [^n]: +\n  # h\n    # z\n\nsee[^n]\n')
    expect(html).toContain('</ul>\n<p>see')
    expect(html).toContain('<h1 id="h">h</h1>\n      <h1 id="z">z</h1>')
  })

  it('folds a below-column term into a div-hosted note paragraph', () => {
    const html = render('::: box\n[^f]: alpha\n :: term\n:::\n\nSee[^f]\n')
    expect(html).toContain('<p>alpha\n:: term')
    expect(html).not.toContain('<dl>')
  })

  it.each(['', '> '])('keeps a below-column term in an open note under %s', prefix => {
    const source = `${prefix}[^f]: alpha\n${prefix} :: term\n${prefix.trimEnd()}\n${prefix}See[^f]\n`
    expect(render(source)).toContain('<p>alpha\n:: term')
  })

  it('keeps a refused plus in a note paragraph before a div closer', () => {
    const html = render('::: box\n[^f]: alpha\n+\n:::\n\nSee[^f]\n')
    expect(html).toContain('<p>alpha\n+')
  })

  it('folds a below-column marked line into the open note paragraph', () => {
    const html = render('see[^n]\n\n[^n]: para\n # Heading\ntail\n')
    expect(html).toContain('<p>para\n# Heading\ntail')
    expect(html).not.toContain('<h1 id="Heading">')
  })

  it('folds a below-column quote marker into the open note paragraph', () => {
    const html = render('see[^n]\n\n[^n]: para\n > q\ntail\n')
    expect(html).toContain('<p>para\n&gt; q\ntail')
    expect(html).not.toContain('<blockquote>')
  })
})
