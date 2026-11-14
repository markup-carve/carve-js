// The clauses that the specification commits "three points from replaying old tickets", "decisions from a second
// reviewer reading as an implementer and as an author" and "the escapes the procedure cannot reach, and the title of
// a degraded admonition" added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { format, parse, render } from '../src/index.ts'

describe('link definitions', () => {
  it('C2-B-083: the tail is that of an inline link, with a destination of at least one character', () => {
    expect(render("[a]: /u 'T'\n\n[x][a]")).toBe('<p><a href="/u" title="T">x</a></p>')
    expect(render('[a]: /u"T"\n\n[x][a]')).toBe('<p><a href="/u&quot;T&quot;">x</a></p>')
    expect(render('[a]: "T"\n\n[x][a]')).toBe('<p><a href="&quot;T&quot;">x</a></p>')
    expect(render('[a]: /u "T"   \n\n[x][a]')).toBe('<p><a href="/u" title="T">x</a></p>')
    expect(parse('[a]: /u  "T"').children[0]!.type).toBe('paragraph')
    expect(parse('[a]: /u "T" x').children[0]!.type).toBe('paragraph')
    expect(parse("[a]: /u 'T\"").children[0]!.type).toBe('paragraph')
  })

  it('C2-B-083: the writer writes the title in double quotes', () => {
    expect(format("[a]: /u 'it\\'s'")).toBe('[a]: /u "it\'s"\n')
    expect(format('[a]: /u"T"')).toBe('[a]: /u"T"\n')
  })
})

describe('paragraphs in a description', () => {
  it('C2-H-018: a paragraph that carries attributes or a lang is never written bare', () => {
    expect(render(':: t\n: {.x}\n  d')).toBe('<dl>\n  <dt>t</dt>\n  <dd><p class="x">d</p></dd>\n</dl>')
    expect(render(':: t\n: {lang=de}\n  d')).toBe('<dl>\n  <dt>t</dt>\n  <dd><p lang="de">d</p></dd>\n</dl>')
    expect(render('- {.x}\n  d')).toBe('<ul>\n  <li><p class="x">d</p></li>\n</ul>')
  })

  it('C2-H-040, C2-B-073: a description counts its visible blocks, so a comment does not give the paragraph a <p>', () => {
    expect(render(':: t\n: d\n\n  %%%\n  c\n  %%%')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>')
    expect(render(':: t\n: d\n  %% c')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>')
    expect(render(':: t\n: d\n\n  e')).toBe('<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <p>e</p>\n  </dd>\n</dl>')
  })
})
