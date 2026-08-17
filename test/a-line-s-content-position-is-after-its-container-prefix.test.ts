import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'
import { renderMarkdown } from '../src/render-markdown.js'
import type { Document, InlineNode } from '../src/ast.js'

/**
 * A LINE'S CONTENT POSITION IS AFTER ITS CONTAINER PREFIX (PART 11 section 8b
 * M2b, the ruling on markup-carve/carve#1330).
 *
 * M2b keeps an authored hash escaped where it would open an ATX heading and
 * emits it bare everywhere else. The position was measured on the FINISHED
 * document, so a container prefix defeated it: the hash at the start of a
 * quote's content had a `> ` in front of it, scored as mid-line, and lost the
 * escape. Read back through an importer, `> \# heading` came out as
 * `<blockquote><h1>heading</h1></blockquote>` - the author's text returned as
 * structure, which is corruption rather than a rendering difference.
 *
 * The position is now measured on the EMITTED LINE, after every prefix the
 * writer put in front of the content, to whatever depth and in whatever
 * combination.
 *
 * BOTH DIRECTIONS ARE ASSERTED ON EVERY CHARACTER, because the failure mode of
 * a correction like this is widening it into "an escape behind a prefix is
 * kept". It is not: a hash mid-line loses its escape inside a container just as
 * it does outside one, and so does a hash at the content position whose run is
 * closed by a letter, since M2b's reading is CommonMark's and neither of those
 * opens a heading.
 *
 * The corpus pins the quote and the bullet
 * (`343-an-escaped-hash-keeps-its-escape-at-a-container-s-content-position`).
 * What is here is what the corpus does not reach: the prefixes it does not
 * spell, the non-container that must NOT count, and the alignment case that
 * says why the position cannot be recovered from the finished document.
 */
const md = (src: string) => carveToMarkdown(src).trim()

describe("a line's content position is after its container prefix", () => {
  it('keeps the escape at a quote, a bullet and both nested', () => {
    expect(md('> \\# heading')).toBe('> \\# heading')
    expect(md('- \\# heading')).toBe('- \\# heading')
    expect(md('> > \\# deep')).toBe('> > \\# deep')
    expect(md('- - \\# deep')).toBe('- - \\# deep')
  })

  it('keeps it behind a task marker and an ordered marker', () => {
    expect(md('- [ ] \\# heading')).toBe('- [ ] \\# heading')
    expect(md('- [x] \\# heading')).toBe('- [x] \\# heading')
    expect(md('1. \\# heading')).toBe('1. \\# heading')
  })

  it('keeps it behind a footnote definition marker', () => {
    // The definition body is a block like any other, so its marker is a prefix
    // like any other. Asserted on the line rather than on the whole document
    // because the numbering and the reference come with it.
    expect(md('a[^n]\n\n[^n]: \\# heading')).toContain('[^n]: \\# heading')
  })

  it('keeps it behind a definition marker', () => {
    // Named in the clause alongside the quote and the list markers. The
    // narrowing holds behind it too: a run closed by a letter opens no heading
    // there any more than anywhere else.
    expect(md(':: term\n:  \\# heading')).toBe('**term**\n: \\# heading')
    expect(md(':: term\n:  \\#tag rest')).toBe('**term**\n: #tag rest')
  })

  it('keeps it on a lazy continuation, which the writer re-prefixes', () => {
    // Lazy continuation is a PARSER concept: a line inside a container that
    // does not carry its marker. This writer emits no such line, so the second
    // line arrives at M2b with its `> ` and is read at the content position
    // like any other.
    expect(md('> a\n\\# heading')).toBe('> a\n> \\# heading')
  })

  it('keeps it under the alignment a wide marker gives a continuation line', () => {
    // THE CASE THAT SAYS WHY THE POSITION CANNOT BE DERIVED FROM THE FINISHED
    // DOCUMENT. Section 10 aligns a continuation line to the marker's width, so
    // this one carries four spaces - and four spaces is an over-indent to
    // anything that does not already know the marker above it was `10. `. Only
    // the writer knows, which is why the decision is taken where it writes the
    // line.
    expect(md('10. a\n\n    \\# heading')).toBe('10. a\n\n    \\# heading')
  })

  it('drops it mid-line inside a container, exactly as outside one', () => {
    expect(md('> C\\# is a language')).toBe('> C# is a language')
    expect(md('- issue \\#123 fixed')).toBe('- issue #123 fixed')
    expect(md('C\\# is a language')).toBe('C# is a language')
  })

  it('drops it at the content position when the run opens no heading', () => {
    // A run closed by a letter is not a heading under CommonMark, and a run
    // longer than six is not one either. Standing at the content position is
    // necessary and not sufficient.
    expect(md('> \\#tag rest')).toBe('> #tag rest')
    expect(md('- \\#tag rest')).toBe('- #tag rest')
    expect(md('> \\#\\#\\#\\#\\#\\#\\# too many')).toBe('> ####### too many')
    expect(md('> \\#\\#\\#\\#\\#\\# six is fine')).toBe('> \\###### six is fine')
  })

  it('drops it behind a heading marker, which is not a container prefix', () => {
    // A heading is not a container and `## ` is part of the heading's own line,
    // so the hash behind it is mid-line. CommonMark reads `## # x` as an h2
    // whose text is `# x`, so the escape protects nothing and goes.
    expect(md('## \\# x')).toBe('## # x')
    expect(md('# \\# x')).toBe('# # x')
  })

  it('drops it in a table cell, where the pipe is not a prefix either', () => {
    expect(md('| \\# x | y |\n|---|---|\n| a | b |')).toContain('| # x |')
  })

  it('leaves a hash at column 0 exactly where it was', () => {
    // The rule that was already right, and the one a correction to the others
    // is most likely to disturb. Column 0 is the content position of a line no
    // container encloses.
    expect(md('\\# heading')).toBe('\\# heading')
    expect(md('\\#tag rest')).toBe('#tag rest')
  })
})

describe('a decision survives the container that would re-read it', () => {
  it('keeps a nested quote\u2019s hash when the outer quote has one of its own', () => {
    // THE CASE THE SECOND SENTINEL EXISTS FOR. The inner quote answers M2b on
    // its own content and the outer one answers it on content that already
    // carries the inner marker. Recorded as a distinct sentinel the inner
    // answer is inert to that second pass; left undecided it is measured again
    // against `> # deep`, scores as mid-line, and the outer marker takes the
    // escape straight back off - markup-carve/carve#1330 returning by the back
    // door.
    //
    // The outer quote must carry a hash of ITS OWN, or it skips the pass
    // entirely and the case proves nothing.
    expect(md('> \\# outer\n>\n> > \\# deep')).toBe('> \\# outer\n>\n> > \\# deep')
  })

  it('keeps a quoted hash under an admonition, which prefixes nothing', () => {
    // The other side of the same boundary: an admonition is not a container
    // this target prefixes, so it settles nothing and the quote inside it is
    // what decides. Hand-built because the title has to carry a hash too - the
    // title's own is mid-line and loses its escape, the quoted one keeps it.
    const hash: InlineNode = { type: 'escaped_text', value: '#' }
    const doc: Document = {
      type: 'document',
      children: [
        {
          type: 'admonition',
          kind: 'note',
          title: [{ type: 'text', value: 'C' }, hash, { type: 'text', value: ' tips' }],
          children: [
            {
              type: 'block_quote',
              children: [
                { type: 'paragraph', children: [hash, { type: 'text', value: ' heading' }] },
              ],
            },
          ],
        },
      ],
    }

    expect(renderMarkdown(doc)).toBe('**C# tips**\n\n> \\# heading\n')
  })
})

describe('the position is settled after the trim that shapes the line', () => {
  it('reads a hash the trim moves to column 0 as being at column 0', () => {
    // A BLOCK DOES NOT KNOW WHETHER ITS OWN LEADING WHITESPACE SURVIVES. Four
    // spaces in front of the hash stay where the paragraph sits mid-document
    // and are trimmed away where it is the first block of the document or of a
    // container. Deciding before that trim scored the hash as over-indented and
    // emitted it bare, and the trim then put the bare hash at column 0 - a
    // heading where the author wrote text, which is the same corruption this
    // clause exists to prevent, arriving from the other direction.
    //
    // Hand-built: the parser does not keep leading whitespace on a paragraph,
    // and an ingested tree is a document this target has to render correctly.
    const hash: InlineNode = { type: 'escaped_text', value: '#' }
    const indented = (lead: string): Document => ({
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: lead }, hash, { type: 'text', value: ' heading' }],
        },
      ],
    })

    expect(renderMarkdown(indented('    '))).toBe('\\# heading\n')
    expect(renderMarkdown(indented('\t'))).toBe('\\# heading\n')
    expect(renderMarkdown(indented('  '))).toBe('\\# heading\n')
  })

  it('does the same for the first block inside a container', () => {
    const hash: InlineNode = { type: 'escaped_text', value: '#' }
    const doc: Document = {
      type: 'document',
      children: [
        {
          type: 'block_quote',
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: '    ' },
                hash,
                { type: 'text', value: ' heading' },
              ],
            },
          ],
        },
      ],
    }

    expect(renderMarkdown(doc)).toBe('> \\# heading\n')
  })
})

describe('the sentinels M2b decides on never come from the author', () => {
  it('strips a private-use character that would forge a decision', () => {
    // The scheme's own contract is that author content never carries a
    // sentinel, because the strip on the way in drops the whole range. The
    // range stopped one character short of the authored-hash sentinel, so a
    // document holding U+E007 emitted a hash this renderer had decided about -
    // bare mid-line and escaped at a line start, neither of them the author's.
    // Both new sentinels are inside the range now.
    expect(md('a \ue007 b')).toBe('a  b')
    expect(md('\ue007 x')).toBe('x')
    expect(md('a \ue008 b')).toBe('a  b')
    // The characters below it were always stripped; asserted alongside so the
    // range is pinned at both ends rather than at the end that moved.
    expect(md('a \ue005 b')).toBe('a  b')
  })

  it('strips one carried on a stored smart-punctuation node', () => {
    // The other way in. Both branches of that node emit a value straight off
    // the tree, so a stored document could hand the resolve pass a sentinel it
    // would read as an escape decision and write out as a backslash the
    // document never held.
    const withSentinel = (value: string): Document => ({
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            { type: 'smart_punctuation', kind: 'ellipsis', value },
            { type: 'text', value: ' b' },
          ] as InlineNode[],
        },
      ],
    })

    for (const code of ['\ue005', '\ue007', '\ue008']) {
      expect(renderMarkdown(withSentinel(`x${code}y`), { smartTypography: 'source' })).toBe(
        'a xy b\n',
      )
    }
  })
})
