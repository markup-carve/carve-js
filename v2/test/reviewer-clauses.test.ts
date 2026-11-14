// The clauses that the specification commits "three points from replaying old tickets", "decisions from a second
// reviewer reading as an implementer and as an author" and "the escapes the procedure cannot reach, and the title of
// a degraded admonition" added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { format, parse, parseWithDiagnostics, render, renderWithDiagnostics } from '../src/index.ts'

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

describe('list markers in prose', () => {
  it('C2-B-015: a marker that would open a new list interrupts a paragraph only as a bullet or with the value 1', () => {
    expect(render('- We moved in\n  2024. It was good')).toBe('<ul>\n  <li>We moved in\n2024. It was good</li>\n</ul>')
    expect(render('- a\n  ii) b')).toBe('<ul>\n  <li>a\nii) b</li>\n</ul>')
    expect(render('- a\n  b. c')).toBe('<ul>\n  <li>a\nb. c</li>\n</ul>')
    expect(render('[^n]: a\n  2. b\n\nx[^n]')).toContain('<p>a\n2. b')
    for (const marker of ['1.', '01.', 'a)', 'A.', 'i.', 'I)', '.', '-', '*']) {
      const spaces = marker === 'A.' ? '  ' : ' '
      expect(parse(`- a\n  ${marker}${spaces}b`).children[0]).toMatchObject({ children: [{ children: [{ type: 'paragraph' }, { type: 'list' }] }] })
    }
  })

  it('C2-B-015: a sibling marker at an open list\'s column interrupts whatever its number', () => {
    expect(render('1. a\n3. b')).toBe('<ol>\n  <li>a</li>\n  <li>b</li>\n</ol>')
    expect(render('- a\n  1. b\n  5. c')).toBe('<ul>\n  <li>a\n    <ol>\n      <li>b</li>\n      <li>c</li>\n    </ol>\n  </li>\n</ul>')
  })

  it('C2-B-015: after a blank line and on the marker line a nested list starts at any number', () => {
    expect(render('- a\n\n  2. b')).toContain('<ol start="2">')
    expect(render('- 3. x')).toContain('<ol start="3">')
  })

  it('C2-B-043: a bare dot whose content starts with a dot and a space is no marker', () => {
    expect(render('. . . and then silence')).toBe('<p>. . . and then silence</p>')
    expect(render('1. a\n. . . b')).toBe('<ol>\n  <li>a\n. . . b</li>\n</ol>')
    expect(render('. .x')).toBe('<ol>\n  <li>.x</li>\n</ol>')
    expect(format('. . . and then silence')).toBe('. . . and then silence\n')
  })
})

describe('smart typography', () => {
  it('C2-I-117: the plus-minus sign needs its exact run', () => {
    expect(render('C++-style')).toBe('<p>C++-style</p>')
    expect(render('x+-+')).toBe('<p>x+-+</p>')
    expect(render('a +-- b')).toBe('<p>a +– b</p>')
    expect(render('5 +- 1')).toBe('<p>5 ± 1</p>')
    expect(render('*a*+- b')).toBe('<p><strong>a</strong>± b</p>')
    expect(format('C++-style')).toBe('C++-style\n')
  })

  it('C2-I-108: the word n is exempt, so it keeps both apostrophes', () => {
    expect(render("Rock 'n' roll")).toBe('<p>Rock ’n’ roll</p>')
    expect(render("Rock 'N' roll")).toBe('<p>Rock ’N’ roll</p>')
    expect(render("say 'em' now")).toBe('<p>say ‘em’ now</p>')
  })
})

describe('comment-only lines', () => {
  it('C2-H-069: a line of comments of any form and spaces takes one line break around it with it', () => {
    expect(render('a\n{% c %}\nb')).toBe('<p>a\nb</p>')
    expect(render('a\n{% c %} %% x\nb')).toBe('<p>a\nb</p>')
    expect(render('a\n{% c %}')).toBe('<p>a</p>')
    expect(render('{% c %}\nb')).toBe('<p>b</p>')
    expect(render('a\n{% c\nd %}\nb')).toBe('<p>a\nb</p>')
    expect(render('> :: t\n> : b\n> {% c %}\n- s')).toBe('<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>b\n- s</dd>\n  </dl>\n</blockquote>')
  })

  it('C2-H-069: a line that holds text beside a comment keeps both breaks', () => {
    expect(render('a {% c %}\nb')).toBe('<p>a \nb</p>')
    expect(render('a\n{% c %} x\nb')).toBe('<p>a\n x\nb</p>')
  })
})

function reports(src: string): string[] {
  return parseWithDiagnostics(src).diagnostics.map((entry) => `${entry.code} ${entry.path} ${entry.range?.startOffset}-${entry.range?.endOffset}`)
}

function messages(src: string): string[] {
  return parseWithDiagnostics(src).diagnostics.map((entry) => entry.message)
}

describe('the parse channel', () => {
  it('C2-B-111: a comment block that ends with its container and one that runs to the end are two reports, and both say what they hide', () => {
    expect(reports('> %%%\n> a\n%%%\nb')).toEqual(['unclosed-comment-fence /children/0/children/0 2-9', 'unclosed-comment-fence /children/1 10-15'])
    expect(messages('> %%%\n> a\n%%%\nb')).toEqual([
      'The %%% comment fence opened here has no closing fence and hides everything to the end of its container. Add a closing %%% where the comment should stop.',
      'The %%% comment fence opened here has no closing fence and hides everything to the end of the document. Add a closing %%% where the comment should stop.',
    ])
  })

  it('C2-B-163: frontmatter with no closer is reported, and the message says the whole document is hidden in it', () => {
    expect(reports('---\ntitle: x\n')).toEqual(['unclosed-frontmatter /children/0 0-12'])
    expect(messages('---\ntitle: x\n')).toEqual(['The frontmatter opened on line 1 has no closing line, so the whole document is frontmatter.'])
  })

  it('C2-B-111: a code fence and a raw block that end without their closer', () => {
    expect(messages('```js\ncode')).toEqual([
      'The ``` fence opened here has no closing fence; it runs to the end of the document. Add a closing ``` where the code should stop.',
    ])
    expect(messages('- ~~~~\n  x\ny')).toEqual([
      'The ~~~~ fence opened here has no closing fence; it ends at the end of its container on line 2. Add a closing ~~~~ where the code should stop.',
    ])
    expect(reports('```=html\n<b>')).toEqual(['unclosed-code-fence /children/0 0-12'])
  })

  it('C2-B-111, C2-B-125: a div, an admonition and a line block that end without their closer', () => {
    expect(messages(':::\nx')).toEqual(['This 3-colon container has no closer; add a bare fence of 3 colons to close it.'])
    expect(messages('::: note\n:::: warning\nx\n:::')).toEqual([
      'This 4-colon admonition has no closer; it runs to the end of its container. Add a bare fence of 4 colons to close it.',
    ])
    expect(reports('::: |\nline')).toEqual(['unclosed-container-fence /children/0 0-10'])
    expect(reports('::: note\nx\n:::\n\n```\ny\n```')).toEqual([])
  })

  it('C2-B-085: a losing footnote definition says how many lines of content are lost with it', () => {
    expect(messages('[^a]: x\n\n[^a]: one\n  two\n  three\n\n[^a]: y')).toEqual([
      'Duplicate footnote definition [^a] is ignored; the first definition for a label wins. Its 3 lines of content are lost with it.',
      'Duplicate footnote definition [^a] is ignored; the first definition for a label wins.',
    ])
    expect(parseWithDiagnostics('[^a]: x\n\n[^a]: one\n  two', { positions: false }).diagnostics[0]!.message).toContain('Its 2 lines')
  })

  it('C2-B-122: further words on an opener are reported, and typographic quotes are named', () => {
    expect(messages('```js “T”\nx\n```')[0]).toBe(
      'The title after "js" uses typographic quotes - usually a CMS "smart quote" filter rewrote the source before Carve parsed it. '
      + 'A fence title needs straight double quotes: ``` js "T".')
    expect(messages('```js T [L]\nx\n```')[0]).toBe(
      'Text after the "js" fence type must be a quoted "title" or a [label]; unquoted it is not read as a title, and the block opens. '
      + 'Did you mean ``` js "T" [L]?')
    expect(reports('```=html x\n<b>\n```')).toEqual(['fence-title-syntax /children/0 0-18'])
    expect(reports('```js "T" [L]\nx\n```')).toEqual([])
  })

  it('C2-B-181: a delimited table with an unclosed quote is reported and stays a table', () => {
    expect(reports('{table=""}\n```csv\na,"b\n```')).toEqual(['delimited-table-malformed /children/0 0-26'])
  })

  it('C2-A-172: the parse findings come beside the HTML too, and a parse that asks for none carries none', () => {
    expect(renderWithDiagnostics('```\nx').diagnostics.map((entry) => entry.code)).toEqual(['unclosed-code-fence'])
    expect(parse('```\nx').children[0]!.type).toBe('code_block')
  })
})
