// The shortcuts of a render from source give what the full path gives: a content of plain text
// that skips the inline pass, a body that is one piece of the source, and a leaf that resolution
// does not walk into.
import { describe, expect, it } from 'vitest'
import {
  acquireInlineState, PARAGRAPH, parse, parseBlockTree, parseWithDiagnostics, releaseInlineState, render, scanInline,
} from '../src/index.ts'
import { buildInlineTree, type InlineNode, TEXT } from './support/inline-tree.ts'
import { inlinesOf, ofType } from './support/nodes.ts'
import { isPlainText } from '../src/inline-scan.ts'

/** The inline nodes of the one-line content `text`, read by the inline pass with no shortcut. */
function fullPass(text: string): InlineNode[] {
  const state = acquireInlineState()
  try {
    scanInline(state, text, [0, text.length], 0, 2, 0, true)
    return buildInlineTree(text, state.events, state.eventLength, (from, to) => text.slice(from, to))
  } finally {
    releaseInlineState(state)
  }
}

// Pieces of a content: text, and every kind of character that may make the pass act.
const PIECES = ['a', 'B c', '9', ' ', '(x)', ',', ';', '?', '/', '*', '_', '.', '-', '"', "'", '`', '[', ']', '<', '\\', ':', '@', '#', '%', '{', '$', '!', '^', '~', '=', '+', '|', '&', '>', '\t', 'é', ' ']

describe('a content of plain text', () => {
  it('is plain only when every character is text wherever it stands and no space stands at an end', () => {
    expect(['a', 'a b', 'A b; c? d) & e'].map((text) => isPlainText(text, 0, text.length))).toEqual([true, true, true])
    expect(['', ' a', 'a ', 'a\tb ', '\ta', 'a*b', 'a.b', 'a-b', "a'b", 'aé', 'a b', 'a\\b', 'a/b'].map((text) => isPlainText(text, 0, text.length))).toEqual(Array(13).fill(false))
    expect(isPlainText('*abc*', 1, 4)).toBe(true)
  })

  it('gives the nodes of the inline pass, for every content of up to three pieces', () => {
    let plain = 0
    const check = (text: string): void => {
      if (!isPlainText(text, 0, text.length)) return
      const block = parseBlockTree(text).children![0]!
      // A text that the block pass reads as another block, or not as one line of a paragraph, is no such content.
      if (block.kind !== PARAGRAPH || block.spans![0] !== 0 || block.spans![1] !== text.length) return
      plain++
      // The shortcut gives one text node of the whole line, and so does the pass.
      const pass = fullPass(text).map((node) => [node.kind, node.value, node.start, node.end])
      expect([text, pass]).toEqual([text, [[TEXT, text, 0, text.length]]])
      expect([text, inlinesOf(parse(text, { positions: false }).children[0])]).toEqual([text, [{ type: 'text', value: text }]])
    }
    for (const first of PIECES) {
      check(first)
      for (const second of PIECES) {
        check(first + second)
        for (const third of PIECES) check(first + second + third)
      }
    }
    expect(plain).toBeGreaterThan(400)
  })

  it('every content the shortcut leaves to the pass still reads as before', () => {
    expect(render('a b\n\n- c d\n- e *f*\n\n# G h')).toBe('<p>a b</p>\n<ul>\n  <li>c d</li>\n  <li>e <strong>f</strong></li>\n</ul>\n<section id="G-h">\n  <h1>G h</h1>\n</section>')
  })
})

describe('a body that is one piece of the source', () => {
  const FENCE = '```'

  it('has the value of a body read line by line', () => {
    const body = 'a\n  b\n\nc <d> & e'
    const direct = parse(`${FENCE}\n${body}\n${FENCE}`, { positions: false }).children[0]
    const quoted = ofType(parse(`> ${FENCE}\n${body.split('\n').map((line) => `> ${line}`).join('\n')}\n> ${FENCE}`, { positions: false }).children[0], 'block_quote').children[0]
    const returned = parse(`${FENCE}\r\n${body.replaceAll('\n', '\r\n')}\r\n${FENCE}`, { positions: false }).children[0]
    expect(direct).toEqual({ type: 'code_block', value: `${body}\n` })
    expect(quoted).toEqual(direct)
    expect(returned).toEqual(direct)
    expect(parse(`${FENCE}\n${FENCE}`, { positions: false }).children[0]).toEqual({ type: 'code_block', value: '' })
  })
})

describe('a leaf that resolution does not walk into', () => {
  it('a rendered source and its rendered tree agree where a leaf holds an id, a reference, a note or a cross-reference', () => {
    const src = [
      '# One [x]{#in-heading}', 'plain *text* and `code`', 'a [ref][one] b ![img][pic] c[^n] d^[inline *note*] e </#One-x> f [g]{#a}', '- item [h]{#a}',
      '| cell[^n] | [i]{#b} |', '::: |\nline [j]{#c}\n:::', ':: term [k]{#d}\n: description [l][one]', '![m](m.png)\n^ Figure #: caption [o]{#e}',
      '[one]: /one', '[pic]: /pic.png', '[^n]: note [p]{#f}',
    ].join('\n\n')
    const fromSource = render(src)
    expect(render(parse(src))).toBe(fromSource)
    expect(fromSource).toContain('id="in-heading"')
    expect(fromSource).toContain('<a href="/one">ref</a>')
    expect(fromSource).toContain('<a href="#One-x">One x</a>')
    // An id inside a leaf is reserved before the heading ids, so the second `a` is reported.
    expect(parseWithDiagnostics(src).diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['duplicate-id', '/children/3/children/0/children/0/children/1']])
  })

  it('a leaf whose only node is an inline note is walked into, so the note is numbered', () => {
    expect(inlinesOf(parse('x^[]', { positions: false }).children[0])[1]).toEqual({ type: 'inline_footnote', children: [], number: 1 })
    expect(render('x^[]')).toContain('<li id="fn1">')
  })
})
