import { describe, expect, it } from 'vitest'

import { carveToHtml, type CarveExtension } from '../src/index.js'

/**
 * Parse-stage matcher contract (extensions ADD syntax, never hijack core).
 * Mirrors the carve-rs `match_inline` / `match_block` trait hooks and the
 * carve-php `addInlinePattern` / `addBlockPattern` sugar, completing the
 * 4-point contract in extensions.md §2.1.
 */
describe('extension inline matchers', () => {
  // `§Foo§` -> a core link node, inner parsed via ctx.parseInlines.
  const ref: CarveExtension = {
    name: 'ref',
    matchInline(text, pos, ctx) {
      if (text[pos] !== '§') return null
      const close = text.indexOf('§', pos + 1)
      if (close < 0) return null
      const inner = text.slice(pos + 1, close)
      return {
        node: { type: 'link', href: '#' + inner, children: ctx.parseInlines(inner) },
        end: close + 1,
      }
    },
  }

  it('fires where core leaves the text literal', () => {
    expect(carveToHtml('See §Foo§.', { extensions: [ref] })).toBe(
      '<p>See <a href="#Foo">Foo</a>.</p>',
    )
  })

  it('exposes ctx.parseInlines so inner markup is parsed recursively', () => {
    expect(carveToHtml('§*x*§', { extensions: [ref] })).toBe(
      '<p><a href="#*x*"><strong>x</strong></a></p>',
    )
  })

  it('is inert without the extension (no syntax hijack of §)', () => {
    expect(carveToHtml('See §Foo§.')).toBe('<p>See §Foo§.</p>')
  })

  it('never hijacks a core construct: emphasis still wins at *', () => {
    let sawStar = false
    const greedy: CarveExtension = {
      name: 'greedy',
      matchInline(text, pos) {
        if (text[pos] === '*') {
          sawStar = true
          return { node: { type: 'text', value: 'HIJACK' }, end: pos + 1 }
        }
        return null
      },
    }
    // Core emphasis consumes `*b*` as one unit, so the matcher is never
    // offered the `*` positions; the surrounding literal text still is.
    expect(carveToHtml('a *b* c', { extensions: [greedy] })).toBe(
      '<p>a <strong>b</strong> c</p>',
    )
    expect(sawStar).toBe(false)
  })

  it('resolves document-level abbreviation defs inside ctx.parseInlines', () => {
    // The abbreviation is defined elsewhere in the document; recursive
    // matcher parsing must still expand it (codex P2 regression).
    const src = '§HTML§\n\n*[HTML]: HyperText Markup Language'
    expect(carveToHtml(src, { extensions: [ref] })).toBe(
      '<p><a href="#HTML"><abbr title="HyperText Markup Language">HTML</abbr></a></p>',
    )
  })

  it('routes a matched extension node through a registered renderer', () => {
    const kbd: CarveExtension = {
      name: 'kbd',
      matchInline(text, pos) {
        const m = /^\{\{(\w+)\}\}/.exec(text.slice(pos))
        if (!m) return null
        return {
          node: { type: 'extension', name: 'kbd', content: [{ type: 'text', value: m[1]! }] },
          end: pos + m[0].length,
        }
      },
      renderers: {
        kbd: (node, ctx) => `<kbd>${ctx.renderInlines(node.content)}</kbd>`,
      },
    }
    expect(carveToHtml('Press {{Esc}} now.', { extensions: [kbd] })).toBe(
      '<p>Press <kbd>Esc</kbd> now.</p>',
    )
  })
})

describe('extension block matchers', () => {
  // A `^^^ <text>` line becomes a paragraph the extension owns; proves the
  // block matcher runs before the core paragraph fallback.
  const banner: CarveExtension = {
    name: 'banner',
    matchBlock(lines, start) {
      const line = lines[start]
      if (!line || !line.startsWith('^^^ ')) return null
      return {
        node: {
          type: 'paragraph',
          children: [{ type: 'text', value: 'BANNER:' + line.slice(4) }],
        },
        linesConsumed: 1,
      }
    },
  }

  it('claims a block before the paragraph fallback', () => {
    expect(carveToHtml('^^^ hi there', { extensions: [banner] })).toBe(
      '<p>BANNER:hi there</p>',
    )
  })

  it('is inert without the extension (^^^ is a normal paragraph)', () => {
    expect(carveToHtml('^^^ hi there')).toBe('<p>^^^ hi there</p>')
  })

  it('does not interrupt an open paragraph (blank line required, matches rs/php)', () => {
    // Block matchers are offered at block start, not as paragraph
    // interrupters — core §10 interruption is core-only. carve-rs
    // `interrupts_paragraph` likewise ignores extension matchers, so this
    // is deliberate cross-impl behavior, not a gap: a blank line is needed.
    expect(carveToHtml('intro\n^^^ claimed', { extensions: [banner] })).toBe(
      '<p>intro\n^^^ claimed</p>',
    )
    expect(carveToHtml('intro\n\n^^^ claimed', { extensions: [banner] })).toBe(
      '<p>intro</p>\n<p>BANNER:claimed</p>',
    )
  })

  it('never hijacks a core block: a heading still wins', () => {
    let sawHeading = false
    const greedy: CarveExtension = {
      name: 'greedy-block',
      matchBlock(lines, start) {
        if (lines[start]?.startsWith('# ')) sawHeading = true
        return {
          node: { type: 'paragraph', children: [{ type: 'text', value: 'CLAIMED' }] },
          linesConsumed: 1,
        }
      },
    }
    // Core heading is dispatched before the matcher is offered the line.
    expect(carveToHtml('# Title', { extensions: [greedy] })).toBe(
      '<section id="title">\n  <h1>Title</h1>\n</section>',
    )
    expect(sawHeading).toBe(false)
  })

  it('shares the document footnote map through ctx.parseBlocks', () => {
    // A footnote DEFINED inside extension-owned content must reach the
    // document so the reference resolves (codex P2 regression).
    const wrap: CarveExtension = {
      name: 'wrap-fn',
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
    const html = carveToHtml('@@@\nSee[^a]\n\n[^a]: note\n@@@', { extensions: [wrap] })
    // The footnote reference resolves (renders a superscript link), not literal.
    expect(html).toContain('<sup')
    expect(html).not.toContain('[^a]')
  })

  it('rebinds ctx so a nested matcher sees snippet-local defs', () => {
    // Outer matcher wraps `@@@ … @@@`; inner matcher `§ABBR§` reads
    // ctx.abbrDefs. A def inside the wrapped block must be visible to the
    // inner matcher's ctx (codex P2: recursive-parse context rebinding).
    const seen: string[] = []
    const probe: CarveExtension = {
      name: 'probe',
      matchInline(text, pos, ctx) {
        if (text[pos] !== '§') return null
        const close = text.indexOf('§', pos + 1)
        if (close < 0) return null
        const key = text.slice(pos + 1, close)
        seen.push(ctx.abbrDefs.get(key) ?? 'MISS')
        return { node: { type: 'text', value: ctx.abbrDefs.get(key) ?? 'MISS' }, end: close + 1 }
      },
    }
    const wrap: CarveExtension = {
      name: 'wrap',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@@@') return null
        let end = start + 1
        while (end < lines.length && lines[end] !== '@@@') end++
        const inner = lines.slice(start + 1, end).join('\n')
        return { node: { type: 'blockquote', children: ctx.parseBlocks(inner) }, linesConsumed: end - start + 1 }
      },
    }
    carveToHtml('@@@\n§X§\n\n*[X]: local-def\n@@@', { extensions: [wrap, probe] })
    expect(seen).toContain('local-def')
  })

  it('bounds recursive extension nesting (no stack overflow)', () => {
    // A self-recursive container matcher on pathologically deep input must
    // hit MAX_NESTING_DEPTH and fall back to text, not blow the stack
    // (codex P2: depth propagation through ctx.parseBlocks).
    const wrap: CarveExtension = {
      name: 'deep',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@@@') return null
        let end = start + 1
        while (end < lines.length && lines[end] !== '@@@') end++
        const inner = lines.slice(start + 1, end).join('\n')
        return { node: { type: 'blockquote', children: ctx.parseBlocks(inner) }, linesConsumed: end - start + 1 }
      },
    }
    const depth = 400
    const src = '@@@\n'.repeat(depth) + 'x' + '\n@@@'.repeat(depth)
    expect(() => carveToHtml(src, { extensions: [wrap] })).not.toThrow()
  })

  it('exposes ctx.parseBlocks for recursive block content', () => {
    const wrap: CarveExtension = {
      name: 'wrap',
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
    expect(carveToHtml('@@@\n*bold*\n@@@', { extensions: [wrap] })).toBe(
      '<blockquote><p><strong>bold</strong></p></blockquote>',
    )
  })
})
