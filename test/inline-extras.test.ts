import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'
import type { InlineNode } from '../src/index.js'

const h = (s: string, o = {}) => carveToHtml(s, o)

function collectInlineTypes(nodes: InlineNode[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    out.push(node.type)
    if ('children' in node && Array.isArray(node.children)) {
      out.push(...collectInlineTypes(node.children as InlineNode[]))
    }
    if (node.type === 'footnote' && node.inline) out.push(...collectInlineTypes(node.inline))
  }
  return out
}

function inlineTypes(src: string): string[] {
  const doc = parse(src)
  const para = doc.children[0]
  if (!para || para.type !== 'paragraph') return []
  return collectInlineTypes(para.children)
}

describe('inline extras (nbsp, raw inline, symbols)', () => {
  it('backslash-space is a non-breaking space', () => {
    expect(h('10\\ kg')).toBe('<p>10&nbsp;kg</p>')
  })

  it('raw inline passes through a matching format', () => {
    expect(h('a `<b>x</b>`{=html} z')).toBe('<p>a <b>x</b> z</p>')
  })

  it('raw inline drops a non-matching format', () => {
    expect(h('a `\\foo`{=latex} z')).toBe('<p>a  z</p>')
  })

  it('a verbatim span without a format tag stays code', () => {
    expect(h('`x + y`')).toBe('<p><code>x + y</code></p>')
  })

  it('symbol renders literally when no map is supplied', () => {
    expect(h('hi :rocket: there')).toBe('<p>hi :rocket: there</p>')
  })

  it('symbol resolves against a processor-supplied map', () => {
    expect(h(':rocket: :tada:', { symbols: { rocket: '🚀', tada: '🎉' } })).toBe(
      '<p>🚀 🎉</p>',
    )
  })

  it('an unmapped symbol name stays literal even with a map', () => {
    expect(h(':rocket: :nope:', { symbols: { rocket: '🚀' } })).toBe(
      '<p>🚀 :nope:</p>',
    )
  })

  it('a name may start with + or - (the reaction shortcodes)', () => {
    expect(h('Vote :+1: or :-1:.', { symbols: { '+1': '👍', '-1': '👎' } })).toBe(
      '<p>Vote 👍 or 👎.</p>',
    )
  })

  it('a name may not start with _ (it would steal from underline)', () => {
    expect(h(':_x:', { symbols: { _x: 'A' } })).toBe('<p>:_x:</p>')
    // With a leading `_` allowed, this would be the symbol `_x_` instead.
    expect(h(':_x_:', { symbols: { _x_: 'B' } })).toBe('<p>:<u>x</u>:</p>')
  })

  it('a symbol beats smart typography inside the colons', () => {
    // `:+-:` is the symbol `+-`, not a `±` between colons; the typographic
    // form still applies where no symbol opens (no boundary, or no colons).
    expect(h('Tolerance :+-: here', { symbols: { '+-': '±' } })).toBe(
      '<p>Tolerance ± here</p>',
    )
    expect(h('a +- b and word:+-:', { symbols: { '+-': 'SYM' } })).toBe(
      '<p>a ± b and word:±:</p>',
    )
  })

  it('inserts mapped symbol output as trusted raw HTML', () => {
    expect(h(':rocket:', { symbols: { rocket: '<b>go</b>' } })).toBe('<p><b>go</b></p>')
  })

  it('wraps symbol output when attributes are attached', () => {
    expect(h(':rocket:{.big}', { symbols: { rocket: '🚀' } })).toBe(
      '<p><span class="big">🚀</span></p>',
    )
    expect(h(':rocket:{.big}')).toBe('<p><span class="big">:rocket:</span></p>')
  })

  it('lets a registered inline renderer resolve symbols before the map', () => {
    const ext = {
      name: 'sym',
      inlineRenderers: {
        symbol: (node: { name: string }) =>
          node.name === 'rocket' ? '<b>ROCKET</b>' : undefined,
      },
    }
    // handler wins over the map
    expect(h(':rocket:', { extensions: [ext], symbols: { rocket: 'MAP' } })).toBe(
      '<p><b>ROCKET</b></p>',
    )
    // returning undefined defers to the map, then to the literal
    expect(h(':tada:', { extensions: [ext], symbols: { tada: 'MAP' } })).toBe('<p>MAP</p>')
    expect(h(':none:', { extensions: [ext] })).toBe('<p>:none:</p>')
    // attributes still wrap the handler output
    expect(h(':rocket:{.c}', { extensions: [ext] })).toBe(
      '<p><span class="c"><b>ROCKET</b></span></p>',
    )
  })

  it('uses the symbol AST type and enforces the leading boundary guard', () => {
    // The guard is what keeps a time, a ratio, or any word-glued colon run
    // from becoming a symbol once a map is active — `word:+-:` is the same
    // shape as `10:30:` and must behave the same. `:_x:` fails on name shape.
    for (const src of ['a:b:c', '10:30: x', 'word:rocket:', 'word:+-:', ':_x:']) {
      expect(inlineTypes(src)).not.toContain('symbol')
    }
    for (const src of ['(:tada:)', 'start :rocket:', ':+1:', ':-1:', ':+-:']) {
      expect(inlineTypes(src)).toContain('symbol')
    }
  })

  it('keeps `:type[content]` as an extension, not a symbol', () => {
    expect(h(':kbd[Esc]')).toBe('<p><kbd>Esc</kbd></p>')
    expect(inlineTypes(':kbd[Ctrl]')).toContain('extension')
    expect(inlineTypes(':kbd[Ctrl]')).not.toContain('symbol')
  })

  it('keeps symbol-related fmt round-trips stable', () => {
    for (const src of [':rocket:{.big}', 'a \\:rocket: b', 'a:b:c']) {
      const formatted = carveToCarve(src)
      expect(carveToHtml(formatted)).toBe(carveToHtml(src))
      expect(carveToCarve(formatted)).toBe(formatted)
    }
  })
})
