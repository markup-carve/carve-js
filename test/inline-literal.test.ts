import { describe, it, expect } from 'vitest'
import {
  carveToHtml,
  carveToCarve,
  carveToMarkdown,
  carveToPlainText,
  carveToAnsi,
  parse,
} from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('inline literal (`…`{!}, grammar PART 9 §27)', () => {
  it('emits bare escaped text with no element when the block carries no further attribute', () => {
    expect(h('`/kaet/`{!}')).toBe('<p>/kaet/</p>')
  })

  it('emits a <span> carrying a class', () => {
    expect(h('`/kaet/`{! .ipa}')).toBe('<p><span class="ipa">/kaet/</span></p>')
  })

  it('emits a <span> carrying class and id in source order', () => {
    expect(h('`/kaet/`{! .ipa #cat}')).toBe(
      '<p><span class="ipa" id="cat">/kaet/</span></p>',
    )
  })

  it('renders attributes in the recorded source order for a mixed block', () => {
    expect(h('`x`{! .a #b k=v}')).toBe('<p><span class="a" id="b" k="v">x</span></p>')
    // ... and the reverse source order flips the emitted order.
    expect(h('`x`{! k=v #b .a}')).toBe('<p><span k="v" id="b" class="a">x</span></p>')
  })

  it('HTML-escapes the content (the opposite of raw passthrough)', () => {
    expect(h('`a<b>`{!}')).toBe('<p>a&lt;b&gt;</p>')
    expect(h('`&amp; <s>`{! .x}')).toBe('<p><span class="x">&amp;amp; &lt;s&gt;</span></p>')
  })

  it('recognizes no inline construct inside the verbatim content', () => {
    expect(h('`*not bold*`{!}')).toBe('<p>*not bold*</p>')
    expect(h('`[t](/u)`{!}')).toBe('<p>[t](/u)</p>')
  })

  it('flows inline within a paragraph', () => {
    expect(h('The word cat is `/kaet/`{!} in IPA.')).toBe(
      '<p>The word cat is /kaet/ in IPA.</p>',
    )
  })

  it('parses to a literal-inline node carrying verbatim content', () => {
    const doc = parse('`/kaet/`{! .ipa}')
    const para = doc.children[0] as { children: Array<Record<string, unknown>> }
    const node = para.children[0]!
    expect(node['type']).toBe('literal-inline')
    expect(node['content']).toBe('/kaet/')
    expect((node['attrs'] as { classes: string[] }).classes).toEqual(['ipa'])
  })
})

describe('inline literal: smart typography is suppressed inside', () => {
  it('keeps dashes, ellipsis, quotes and (c) exactly as authored', () => {
    expect(h('`a -- b ... "q" (c)`{!}')).toBe('<p>a -- b ... "q" (c)</p>')
  })

  it('still transforms the same characters in ordinary text (control)', () => {
    // Proves the case above is a real suppression, not an inert input.
    expect(h('a -- b ... "q" (c)')).toBe('<p>a – b … “q” ©</p>')
  })

  it('suppresses typography inside an attributed literal too', () => {
    expect(h('`a -- b`{! .x}')).toBe('<p><span class="x">a -- b</span></p>')
  })
})

describe('inline literal: regression guards (unchanged constructs)', () => {
  it('leaves a generic attributed code span as a <code>', () => {
    expect(h('`x`{.ipa}')).toBe('<p><code class="ipa">x</code></p>')
  })

  it('leaves raw inline passthrough alone', () => {
    expect(h('`x`{=html}')).toBe('<p>x</p>')
    // ... including its target-routed drop, which the literal never does.
    expect(h('`x`{=latex}')).toBe('<p></p>')
  })

  it('is not a literal when the sigil is not the first token', () => {
    // `!` is not a valid attribute identifier, so the strict attribute rule
    // (§14) makes the whole block literal text.
    expect(h('`x`{.ipa !}')).toBe('<p><code>x</code>{.ipa !}</p>')
  })

  it('requires whitespace between the sigil and any further attribute', () => {
    expect(h('`x`{!.ipa}')).toBe('<p><code>x</code>{!.ipa}</p>')
  })

  it('is inert on any node other than a code span', () => {
    expect(h('[t](/u){!}')).toBe('<p><a href="/u">t</a>{!}</p>')
    expect(h('*b*{!}')).toBe('<p><strong>b</strong>{!}</p>')
  })
})

describe('inline literal: non-HTML renderers never drop it', () => {
  it('emits the content as literal text in Markdown, plain text and ANSI', () => {
    const src = '`*not bold*`{!}'
    // Markdown escapes its own metacharacters so the text stays visible.
    expect(carveToMarkdown(src).trim()).toBe('\\*not bold\\*')
    expect(carveToPlainText(src).trim()).toBe('*not bold*')
    expect(carveToAnsi(src).trim()).toBe('*not bold*')
  })

  it('keeps typography verbatim in the non-HTML targets as well', () => {
    const src = '`a -- b ... "q"`{!}'
    expect(carveToMarkdown(src).trim()).toBe('a -- b ... "q"')
    expect(carveToPlainText(src).trim()).toBe('a -- b ... "q"')
    expect(carveToAnsi(src).trim()).toBe('a -- b ... "q"')
  })

  it('carries no code styling in ANSI (it is prose, not code)', () => {
    // A code span is colorized; the literal is not.
    expect(carveToAnsi('`x`').trim()).not.toBe('x')
    expect(carveToAnsi('`x`{!}').trim()).toBe('x')
  })
})

describe('inline literal: contributes to heading text', () => {
  it('feeds the auto heading id, so a crossref resolves', () => {
    // It renders as visible prose, so it must slug like a code span does.
    // Ids are case-preserving; the crossref folds case-insensitively.
    expect(h('# `Cat`{!}\n\nSee </#cat>')).toBe(
      '<section id="Cat">\n  <h1>Cat</h1>\n  <p>See <a href="#Cat">Cat</a></p>\n</section>',
    )
  })

  it('slugs exactly like the equivalent code span does', () => {
    const lit = h('# `Cat`{!}\n\nSee </#cat>')
    const code = h('# `Cat`\n\nSee </#cat>')
    expect(lit.replace(/<\/?code>/g, '')).toBe(code.replace(/<\/?code>/g, ''))
  })

  it('combines with surrounding heading text', () => {
    expect(h('# The `/kaet/`{!} sound')).toContain('id="The-kaet-sound"')
  })
})

describe('inline literal: carve serialization (fmt)', () => {
  const cases = [
    '`/kaet/`{!}',
    '`/kaet/`{! .ipa}',
    '`/kaet/`{! .ipa #cat}',
    '`x`{! .a #b k=v}',
    '`a<b>`{!}',
    '`*not bold*`{!}',
    '`a -- b ... "q" (c)`{!}',
  ]

  it('round-trips the source spelling', () => {
    for (const src of cases) {
      expect(carveToCarve(src).trim()).toBe(src)
    }
  })

  it('widens the backtick fence when the content contains backticks', () => {
    expect(carveToCarve('``a`b``{!}').trim()).toBe('``a`b``{!}')
    expect(carveToCarve('```a``b```{!}').trim()).toBe('```a``b```{!}')
    // Content that starts/ends with a backtick gets the padding spaces back.
    expect(carveToCarve('`` `x` ``{!}').trim()).toBe('`` `x` ``{!}')
  })

  it('is idempotent', () => {
    for (const src of [...cases, '``a`b``{!}', 'The word cat is `/kaet/`{!} in IPA']) {
      const once = carveToCarve(src)
      expect(carveToCarve(once)).toBe(once)
    }
  })

  it('preserves the carveToHtml(fmt(x)) === carveToHtml(x) invariant', () => {
    for (const src of [
      ...cases,
      '``a`b``{!}',
      'The word cat is `/kaet/`{!} in IPA',
      // The unchanged neighbours must keep the invariant too.
      '`x`{.ipa}',
      '`x`{.ipa !}',
      '[t](/u){!}',
    ]) {
      expect(h(carveToCarve(src))).toBe(h(src))
    }
  })
})
