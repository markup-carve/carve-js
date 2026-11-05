import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { ParseSession } from '../src/parse/parse-session.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// carve#5184: erased definition lines are read alone instead of in a second parse of the whole document.
const wholeDocumentParses = (source: string): number => {
  const original = ParseSession.prototype.parse
  let count = 0
  ParseSession.prototype.parse = function (this: ParseSession, text, ...rest) {
    if (text === source) count++
    return original.call(this, text, ...rest)
  }
  try {
    parse(source)
  } finally {
    ParseSession.prototype.parse = original
  }
  return count
}

describe('erased definition lines', () => {
  it('read alone give the nodes and links the authored parse gave', () => {
    const source = 'Préface [x][r] and HTML\n\n[r]: /u "t"\n*[HTML]: Hyper\n%% note\n\n- item\n\n  [q]: /q\n  %% in item\n\n[y][q]\n'
    const doc = parse(source)
    expect(doc.children.map((block) => block.type)).toEqual(
      ['paragraph', 'abbreviation_def', 'comment', 'list', 'paragraph', 'link_reference_definition', 'link_reference_definition'])
    expect(renderHtml(doc)).toBe('<p>Préface <a href="/u" title="t">x</a> and <abbr title="Hyper">HTML</abbr></p>\n' +
      '<ul>\n  <li>item</li>\n</ul>\n<p><a href="/q">y</a></p>')
    expect(wholeDocumentParses(source)).toBe(1)
  })

  it('give way to a later visible definition of the label', () => {
    const source = 'é [x][r]\n\n[r]: /early\n\n- [r]: /later\n'
    expect(renderHtml(parse(source))).toBe('<p>é <a href="/later">x</a></p>\n<ul>\n  <li></li>\n</ul>')
    expect(wholeDocumentParses(source)).toBe(1)
  })

  perfIt.each([
    ['definition and comment lines beside lists', 'Text é [x][r] HTML\n\n[r]: /u\n%% c\n\n- item\n\n  [q]: /q\n  %% in item\n\n'],
  ])('restore %s in linear time', (label, unit) => {
    expectBuiltInputScansLinearly((source) => void parse(source),
      (repeats) => '*[HTML]: Hyper\n\n' + Array.from({ length: repeats }, (_value, i) => unit.replaceAll('[r]', `[r${i}]`).replaceAll('[q]', `[q${i}]`)).join(''),
      { label, smallRepeats: 200, minSampleMs: 250 })
  }, 120000)
})
