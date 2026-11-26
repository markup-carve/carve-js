import { describe, expect, it } from 'vitest'
import { bbcodeHtml, readItems } from '../src/bbcode.ts'
import { importBbcodeItems, needsHtmlRoute } from '../src/bbcode-tree.ts'
import { importHtml } from '../src/html.ts'
import { withoutHtmlRanges } from '../src/kit.ts'

const CASES = [
  'plain text\n\nsecond paragraph\nwith a soft break',
  '  [color=red]  [/color]  lead and trail  ',
  '[b]bold[/b] [i]it[/i] [u]u[/u] [s]s[/s] [strike]st[/strike] [sup]1[/sup] [sub]2[/sub] [b][/b]',
  '[url]https://example.com/x[/url] [url=https://e.com]text [b]b[/b][/url] [url=javascript:alert(1)]x[/url] [url=x][/url]',
  '[email]a@b.c[/email] [email=a@b.c]mail me[/email] [youtube]abc123[/youtube]',
  '[img]https://e.com/a.png[/img]', '[img=alt text]javascript:x[/img] [img]data:x[/img]',
  '[c]code[/c] [icode][b]x[/b][/icode] [noparse][b]x[/b][/noparse]',
  '[code]\nconst a = 1\n[/code]', '[code=JS]x[/code]', '[code=foo bar]x[/code]', '[code= =html]x[/code]', '[code][/code]',
  '[quote]a\n\nb[/quote]', '[quote=alice]hello [b]world[/b][/quote]', '[quote="Bob" post_id=12 time=1600000000]x[/quote]',
  '[quote="  "]x[/quote]', '[quote=x][/quote]',
  '[list]\n[*]one\n[*]two\n[/list]', '[list=1][*]a[*]b\n\nc[/list]', '[list=a][*][quote]q[/quote][/list]', '[list=I][*]x[/list]',
  '[list=x][*][img]https://e.com/a.png[/img] [img]https://e.com/b.png[/img][/list]', '[list]before[*]a[/list]', '[list][/list]',
  '[list][*][b][/b][img]https://e.com/a.png[/img][*]b[/list]', '[list][*][list][*]nested[/list][*]b[/list]',
  '[table][tr][th]a[/th][th]b[/th][/tr][tr][td]1\n2[/td][td][b]x\ny[/b][/td][/tr][/table]',
  '[table]out[tr]row[td]x[/td][/tr][tr][/tr][/table]', '[table][tr][th]only head[/th][/tr][/table]', '[table][/table]',
  '[table][tr][td][url=javascript:x]a[/url][/td][/tr][tr][th][img]javascript:y[/img][/th][/tr][/table]',
  '[spoiler]hidden[/spoiler] [center]c[/center] [left]l[/left] [right]r[/right]', '[hr]', 'a [hr] b',
  '[b]unclosed and [/i] stray', '[unknown]kept[/unknown]', '[*] outside a list', ' nbsp  and ﻿',
  'a\n\n\n\nb', '& < > " \' [', 'é 中文 😀 \ud800',
]

/** The import of `input` through the HTML that `bbcode.ts` writes. */
function throughHtml(input: string): unknown {
  const result = importHtml(bbcodeHtml(input), false, {}, false)
  return { ...result, diagnostics: withoutHtmlRanges(result.diagnostics) }
}

function direct(input: string): unknown {
  const result = importBbcodeItems(readItems(input))
  return { ...result, diagnostics: withoutHtmlRanges(result.diagnostics) }
}

describe('BBCode tree without the HTML route', () => {
  it.each(CASES)('builds the tree and findings the HTML route gives for %j', input => {
    expect(needsHtmlRoute(input, readItems(input))).toBe(false)
    expect(direct(input)).toEqual(throughHtml(input))
  })

  it.each([
    ['a link inside a link', '[url=https://a.b]x [url=https://c.d]y[/url] z[/url]'],
    ['a NUL', 'a\0b'],
    ['a nesting deeper than 64 tags', `${'[b]'.repeat(70)}x${'[/b]'.repeat(70)}`],
  ])('keeps the HTML route for %s', (_name, input) => {
    expect(needsHtmlRoute(input, readItems(input))).toBe(true)
  })
})
