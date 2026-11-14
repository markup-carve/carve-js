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
