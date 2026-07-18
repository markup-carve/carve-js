import { describe, it, expect } from 'vitest'
import { carveToHtml, type CarveExtension } from '../src/index.js'

const h = (s: string, sourceLine = true) => carveToHtml(s, { sourceLine })

describe('sourceLine render option', () => {
  it('stamps nested blockquote paragraphs', () => {
    expect(h('> outer\n>\n> inner')).toBe(
      '<blockquote data-source-line="1">\n' +
        '  <p data-source-line="1">outer</p>\n' +
        '  <p data-source-line="3">inner</p>\n' +
        '</blockquote>',
    )
  })

  it('keeps a lazy blockquote continuation on the paragraph start line', () => {
    expect(h('> outer\nlazy')).toBe(
      '<blockquote data-source-line="1"><p data-source-line="1">outer\nlazy</p></blockquote>',
    )
  })

  it('stamps div children and nested fenced code', () => {
    expect(h(':::\ninside\n\n```js\ncode\n```\n:::')).toBe(
      '<div data-source-line="1">\n' +
        '  <p data-source-line="2">inside</p>\n' +
        '  <pre data-source-line="4"><code class="language-js">code\n' +
        '</code></pre>\n' +
        '</div>',
    )
  })

  it('stamps list items, loose paragraphs, and nested sublists', () => {
    expect(h('- first\n\n  second\n  - nested')).toBe(
      '<ul data-source-line="1">\n' +
        '  <li data-source-line="1"><p data-source-line="1">first</p>\n' +
        '    <p data-source-line="3">second</p>\n' +
        '    <ul data-source-line="4">\n' +
        '      <li data-source-line="4">nested</li>\n' +
        '    </ul>\n' +
        '  </li>\n' +
        '</ul>',
    )
  })

  it('stamps a plus-attached list block on its real source line after blanks', () => {
    expect(h('- first\n\n+\nquote')).toBe(
      '<ul data-source-line="1">\n' +
        '  <li data-source-line="1">first\n' +
        '    <p data-source-line="4">quote</p>\n' +
        '  </li>\n' +
        '</ul>',
    )
  })

  it('composes source maps for a plus-attached blockquote paragraph inside a list item', () => {
    expect(h('- first\n\n+\n> quote\n')).toBe(
      '<ul data-source-line="1">\n' +
        '  <li data-source-line="1">first\n' +
        '    <blockquote data-source-line="4"><p data-source-line="4">quote</p></blockquote>\n' +
        '  </li>\n' +
        '</ul>',
    )
  })

  it('composes source maps for plus-attached div inner content inside a list item', () => {
    expect(h('- first\n\n+\n:::\ninside\n:::\n')).toBe(
      '<ul data-source-line="1">\n' +
        '  <li data-source-line="1">first\n' +
        '    <div data-source-line="4">\n' +
        '      <p data-source-line="5">inside</p>\n' +
        '    </div>\n' +
        '  </li>\n' +
        '</ul>',
    )
  })

  it('composes source maps for plus-attached footnote definitions inside a list item', () => {
    expect(h('ref[^a]\n\n- first\n\n+\n[^a]: note\n')).toBe(
      '<p data-source-line="1">ref<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
        '<ul data-source-line="3">\n' +
        '  <li data-source-line="3">first</li>\n' +
        '</ul>\n' +
        '<section role="doc-endnotes">\n' +
        '  <hr>\n' +
        '  <ol>\n' +
        '    <li id="fn1" data-source-line="6">\n' +
        '      <p data-source-line="6">note<a href="#fnref1" role="doc-backlink">↩</a></p>\n' +
        '    </li>\n' +
        '  </ol>\n' +
        '</section>',
    )
  })

  it('stamps a nested list inside a blockquote', () => {
    expect(h('> - quoted\n>   - nested')).toBe(
      '<blockquote data-source-line="1">\n' +
        '  <ul data-source-line="1">\n' +
        '    <li data-source-line="1">quoted\n' +
        '      <ul data-source-line="2">\n' +
        '        <li data-source-line="2">nested</li>\n' +
        '      </ul>\n' +
        '    </li>\n' +
        '  </ul>\n' +
        '</blockquote>',
    )
  })

  it('stamps footnote list items and content blocks', () => {
    expect(h('ref[^a]\n\n[^a]: note\n\n  more')).toBe(
      '<p data-source-line="1">ref<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
        '<section role="doc-endnotes">\n' +
        '  <hr>\n' +
        '  <ol>\n' +
        '    <li id="fn1" data-source-line="3">\n' +
        '      <p data-source-line="3">note</p>\n' +
        '      <p data-source-line="5">more<a href="#fnref1" role="doc-backlink">↩</a></p>\n' +
        '    </li>\n' +
        '  </ol>\n' +
        '</section>',
    )
  })

  it('stamps definition lists, dt, dd, and omits dd for an empty term', () => {
    expect(h(':: term\n:  def\n\n:: empty')).toBe(
      '<dl data-source-line="1">\n' +
        '  <dt data-source-line="1">term</dt>\n' +
        '  <dd data-source-line="2">def</dd>\n' +
        '  <dt data-source-line="4">empty</dt>\n' +
        '</dl>',
    )
  })

  it('anchors first-block definitions at their marker line', () => {
    // The dd anchors at its `:  +` marker line (carve-php parity); the body
    // block inside keeps its own later line.
    expect(h(':: term\n:  +\nbody')).toBe(
      '<dl data-source-line="1">\n' +
        '  <dt data-source-line="1">term</dt>\n' +
        '  <dd data-source-line="2">body</dd>\n' +
        '</dl>',
    )
  })

  it('stamps standalone block images', () => {
    expect(h('intro\n\n![alt](x.png)')).toBe(
      '<p data-source-line="1">intro</p>\n<img data-source-line="3" src="x.png" alt="alt">',
    )
  })

  it('does not overwrite an authored data-source-line attribute', () => {
    expect(h('{data-source-line=99}\npara')).toBe('<p data-source-line="99">para</p>')
  })

  it('leaves output byte-identical when the option is off', () => {
    const src = '- first\n\n  second\n  - nested'
    expect(h(src, false)).toBe(carveToHtml(src))
  })

  it('uses original document line numbers with CRLF input', () => {
    expect(h('> a\r\n>\r\n> b\r\n')).toBe(
      '<blockquote data-source-line="1">\n' +
        '  <p data-source-line="1">a</p>\n' +
        '  <p data-source-line="3">b</p>\n' +
        '</blockquote>',
    )
  })

  it('does not stamp raw HTML blocks, comments, table rows, or table cells', () => {
    expect(h('```=html\n<div>x</div>\n```\n\n%% hidden\n\n| a |\n| b |')).toBe(
      '<div>x</div>\n' +
        '<table data-source-line="7">\n' +
        '  <tbody>\n' +
        '    <tr><td>a</td></tr>\n' +
        '    <tr><td>b</td></tr>\n' +
        '  </tbody>\n' +
        '</table>',
    )
  })

  it('anchors extension-parsed block children after the matcher opener', () => {
    const wrap: CarveExtension = {
      name: 'wrap-source-lines',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@@@') return null
        let end = start + 1
        while (end < lines.length && lines[end] !== '@@@') end++
        const inner = lines.slice(start + 1, end).join('\n')
        return {
          node: { type: 'blockquote', children: ctx.parseBlocks(inner) },
          linesConsumed: end - start + 1,
        }
      },
    }
    expect(carveToHtml('@@@\ninside\n@@@', { sourceLine: true, extensions: [wrap] })).toBe(
      '<blockquote data-source-line="1"><p data-source-line="2">inside</p></blockquote>',
    )
  })

  it('does not stamp extension-parsed blocks when no document position matches', () => {
    const synth: CarveExtension = {
      name: 'synthetic-source-lines',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@@@') return null
        return {
          node: { type: 'blockquote', children: ctx.parseBlocks('generated') },
          linesConsumed: 1,
        }
      },
    }
    expect(carveToHtml('@@@', { sourceLine: true, extensions: [synth] })).toBe(
      '<blockquote data-source-line="1"><p>generated</p></blockquote>',
    )
  })

  it('stamps extension-rendered custom elements without corrupting tag names', () => {
    const custom: CarveExtension = {
      name: 'custom-element-source-line',
      blockRenderers: {
        paragraph: () => '<my-widget>ok</my-widget>',
      },
    }
    expect(carveToHtml('ok', { sourceLine: true, extensions: [custom] })).toBe(
      '<my-widget data-source-line="1">ok</my-widget>',
    )
  })
})
