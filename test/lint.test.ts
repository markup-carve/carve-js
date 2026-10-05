import { describe, it, expect } from 'vitest'
import { perfIt } from './helpers/scaling.js'
import { lintCarve, formatLintWarnings } from '../src/lint.js'
import { citations } from '../src/citations.js'
import { semanticSpan } from '../src/semantic-span.js'

const rules = (src: string) => lintCarve(src).map((w) => w.rule)

describe('lintCarve — broken cross-references', () => {
  it('flags a </#id> with no matching heading', () => {
    const w = lintCarve('# Intro\n\nSee </#nope>.')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('broken-crossref')
    expect(w[0]!.message).toContain('</#nope>')
  })

  it('does not flag a crossref that targets a real heading', () => {
    expect(lintCarve('# Intro\n\nSee </#Intro>.')).toEqual([])
  })

  it('names the id a crossref misses only by case', () => {
    const w = lintCarve('# Intro\n\nSee </#intro>.')
    expect(w.map((x) => x.rule)).toEqual(['broken-crossref'])
    expect(w[0]!.message).toBe(
      'Cross-reference </#intro> matches no id; the id "Intro" differs only in case, and cross-references are case-sensitive, so it renders as the literal text "</#intro>".',
    )
    expect(w[0]!.data).toEqual({ target: 'intro', caseVariants: ['Intro'] })
  })

  it('names every id a crossref matches case-insensitively', () => {
    const w = lintCarve('{#Tip}\n# A\n\n{#TIP}\n# B\n\nSee </#tip>.')
    expect(w.map((x) => x.rule)).toEqual(['broken-crossref'])
    expect(w[0]!.message).toContain('the ids "Tip", "TIP" differ only in case')
    expect(w[0]!.data).toEqual({ target: 'tip', caseVariants: ['Tip', 'TIP'] })
  })

  it('does not flag a crossref that targets a numbered caption id', () => {
    expect(lintCarve('{#tbl}\n| A |\n|---|\n| 1 |\n^ Table #: Data\n\nSee </#tbl>.')).toEqual([])
  })

  it('finds a crossref inside a footnote definition', () => {
    const w = lintCarve('See[^n].\n\n[^n]: See </#ghost>.')
    expect(w.map((x) => x.rule)).toEqual(['broken-crossref'])
    expect(w[0]!.message).toContain('</#ghost>')
  })

  it('treats the auto-suffixed id of a duplicate heading as valid', () => {
    // Two "Title" headings -> ids `Title` and `Title-2`; both resolvable.
    const w = lintCarve('# Title\n\n## Title\n\n</#Title> and </#Title-2>')
    expect(w.map((x) => x.rule)).toEqual(['duplicate-heading-id'])
  })

  it('honors an explicit heading id as a crossref target', () => {
    expect(lintCarve('{#start}\n# Intro\n\nSee </#start>.')).toEqual([])
  })

  it('finds a crossref nested below the top level (inside a list item)', () => {
    const w = lintCarve('# A\n\n- item with </#ghost> inside')
    expect(w.map((x) => x.rule)).toEqual(['broken-crossref'])
  })

  it('reports the crossref position', () => {
    const w = lintCarve('# A\n\nx </#ghost> y')
    expect(w[0]!.line).toBe(3)
    expect(w[0]!.column).toBe(3)
  })
  it.each([
    ['a paragraph', '{#para}\nA para.\n\nSee </#para>.', 'paragraph', 'para'],
    ['an uncaptioned table', '{#tbl}\n| A |\n|---|\n| 1 |\n\nSee </#tbl>.', 'table', 'tbl'],
    ['an inline span, in another case', '[x]{#Spot}\n\nSee </#spot>.', 'span', 'Spot'],
  ])('names the element when the id exists on %s', (_, src, kind, id) => {
    const w = lintCarve(src)
    expect(w.map((x) => x.rule)).toEqual(['broken-crossref'])
    expect(w[0]!.message).toContain(`which is on a ${kind}`)
    expect(w[0]!.message).toContain(`[text](#${id})`)
    expect(w[0]!.data).toEqual({ id, kind })
  })

  it('keeps the generic message when no element carries the id', () => {
    expect(lintCarve('See </#nope>.')[0]!.message).toContain('has no matching heading id')
  })
})

describe('lintCarve — broken fragment links', () => {
  it('flags a link whose fragment matches no id, at the link', () => {
    const w = lintCarve('# Intro\n\nSee [bad](#nope).')
    expect(w.map((x) => x.rule)).toEqual(['broken-fragment-link'])
    expect(w[0]!.message).toContain('"#nope"')
    expect([w[0]!.line, w[0]!.column]).toEqual([3, 5])
  })

  it.each([
    ['a blockquote', '> [x](#nope)'],
    ['a list item', '- [x](#nope)'],
    ['a footnote body', 'Text[^n].\n\n[^n]: [x](#nope)'],
    ['a reference definition', '[x][r]\n\n[r]: #nope'],
  ])('flags one inside %s', (_, src) => {
    expect(rules(src)).toEqual(['broken-fragment-link'])
  })

  it('names a target that differs only in case', () => {
    const w = lintCarve('# Getting Started\n\n[x](#getting-started)')
    expect(w.map((x) => x.rule)).toEqual(['broken-fragment-link'])
    expect(w[0]!.message).toContain('"Getting-Started" differs only in case')
  })

  it.each([
    ['an auto heading id', '# Getting Started\n\n[x](#Getting-Started)'],
    ['a lowercased heading id', '# Getting Started\n\n[x](#getting-started)', { lowercaseHeadingIds: true }],
    ['a suffixed duplicate heading id', '# A\n\n# A\n\n[x](#A-2)'],
    ['a percent-encoded heading id', '# Über uns\n\n[x](#%C3%9Cber-uns) [y](#Über-uns)'],
    ['an explicit block id', '{#tbl}\n| A |\n|---|\n| 1 |\n\n[x](#tbl)'],
    ['an inline span id', '[x]{#sp}\n\n[y](#sp)'],
    ['a footnote id', 'Text[^n].\n\n[^n]: Back to [ref](#fnref1).\n\n[x](#fn1)'],
    ['an id inside raw HTML', '``` =html\n<div id="raw"></div>\n```\n\n[x](#raw)'],
    ['an anchor name inside raw HTML', '``` =html\n<a name="old"></a>\n```\n\n[x](#old)'],
    ['the top of the page', '[x](#top) [y](#)'],
    ['a text fragment', '[x](#:~:text=word)'],
    ['an id followed by a text directive', '# Intro\n\n[x](#Intro:~:text=word)'],
    ['a link into another file', '[x](other.crv#nope) [y](https://example.com/#nope)'],
  ] as Array<[string, string, { lowercaseHeadingIds?: boolean }?]>)('does not flag a link to %s', (_, src, opts = {}) => {
    expect(lintCarve(src, opts).map((w) => w.rule)).not.toContain('broken-fragment-link')
  })

  it.each([
    ['an attribute value', '<div title=" id=phantom"></div>'],
    ['an HTML comment', '<!-- <div id="phantom"></div> -->'],
  ])('does not count an id spelled inside %s of raw HTML', (_, html) => {
    expect(rules('``` =html\n' + html + '\n```\n\n[x](#phantom)')).toEqual(['broken-fragment-link'])
  })

  it('reads raw HTML ids the way a browser decodes them', () => {
    const src = '``` =html\n<div title=">" id="r&amp;d"></div><p id="&#1114112;"></p>\n```\n\n[x](#r&d) [y](#nope)'
    expect(rules(src)).toEqual(['broken-fragment-link'])
  })

  it('reads ids out of deeply nested raw HTML', () => {
    const src = '``` =html\n' + '<div>'.repeat(10000) + '<p id="deep"></p>\n```\n\n[x](#deep) [y](#nope)'
    expect(rules(src)).toEqual(['broken-fragment-link'])
  })

  it('does not count an id quoted in a code block', () => {
    expect(rules('``` html\n<div id="raw"></div>\n```\n\n[x](#raw)')).toEqual(['broken-fragment-link'])
  })

  it('leaves citation ids alone when citations render', () => {
    expect(lintCarve('[x](#ref-smith) [y](#nope)', { extensions: [{ name: 'citations' }] }).map((w) => w.rule))
      .toEqual(['broken-fragment-link'])
  })

  it('reads ids off the render with the extensions the caller passes', () => {
    // An unused citation definition, and the span id inside it, does not render.
    const unused = '[@a]: [Entry]{#entry}\n\n[x](#entry)'
    expect(rules(unused)).toEqual([])
    expect(lintCarve(unused, { extensions: [citations()] }).map((w) => w.rule)).toEqual(['broken-fragment-link'])
    const used = 'See [@a].\n\n[@a]: [Entry]{#entry}\n\n[x](#entry) [y](#ref-a)'
    expect(lintCarve(used, { extensions: [citations()] })).toEqual([])
    // A link the extension drops with its definition does not render either.
    expect(lintCarve('[@a]: [Entry]{#entry} [self](#entry) [x](#nope)\n\nBody.', { extensions: [citations()] })).toEqual([])
    expect(lintCarve('[Book]{cite #bk} :dfn[term]{#t}\n\n[x](#bk) [y](#t)', { extensions: [semanticSpan()] })).toEqual([])
  })

  it('stays silent when an extension it cannot model may generate ids', () => {
    expect(lintCarve('[x](#tab-1)', { extensions: [{ name: 'tabs' }] })).toEqual([])
  })
})

describe('lintCarve — duplicate heading ids', () => {
  it('flags a second heading whose slug collides', () => {
    const w = lintCarve('# Setup\n\n## Setup')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('duplicate-heading-id')
    expect(w[0]!.line).toBe(3)
    expect(w[0]!.message).toContain('Setup-2')
  })

  it('does not flag distinct heading slugs', () => {
    expect(lintCarve('# One\n\n## Two\n\n### Three')).toEqual([])
  })

  it('flags a repeated explicit id', () => {
    const w = lintCarve('{#dup}\n# A\n\n{#dup}\n# B')
    expect(w.map((x) => x.rule)).toEqual(['duplicate-heading-id'])
    expect(w[0]!.line).toBe(5)
  })

  it('flags three-way slug collisions once each (title-2, title-3)', () => {
    const w = lintCarve('# T\n\n## T\n\n### T')
    expect(w.map((x) => x.rule)).toEqual([
      'duplicate-heading-id',
      'duplicate-heading-id',
    ])
    expect(w[0]!.message).toContain('T-2')
    expect(w[1]!.message).toContain('T-3')
  })
})

describe('lintCarve — unresolved reference links', () => {
  it('flags a reference link with no link definition or matching heading', () => {
    const w = lintCarve('See [docs][missing].')
    expect(w.map((x) => x.rule)).toEqual(['unresolved-reference-link'])
    expect(w[0]!.message).toContain('[docs][missing]')
  })

  it('does not flag a reference link with an explicit definition', () => {
    expect(lintCarve('See [docs][site].\n\n[site]: https://example.com')).toEqual([])
  })

  it('does not flag an implicit heading reference', () => {
    expect(lintCarve('# Getting Started\n\nSee [Getting Started][].')).toEqual([])
  })

  it('names the heading text a collapsed reference misses only by case', () => {
    const w = lintCarve('# Getting Started\n\nSee [getting started][].')
    expect(w.map((x) => x.rule)).toEqual(['unresolved-reference-link'])
    expect(w[0]!.message).toBe(
      'Reference link [getting started][] matches no link definition or heading; the label or heading text "Getting Started" differs only in case, and reference labels are case-sensitive, so it renders as literal text.',
    )
    expect(w[0]!.data).toEqual({ label: 'getting started', caseVariants: ['Getting Started'] })
  })

  it('names the definition label an explicit reference misses only by case', () => {
    const w = lintCarve('[x][Label] and [y][label]\n\n[label]: /u')
    expect(w.map((x) => x.rule)).toEqual(['unresolved-reference-link'])
    expect(w[0]!.message).toContain('the label "label" differs only in case')
    expect(w[0]!.data).toEqual({ label: 'Label', caseVariants: ['label'] })
  })

  it('does not offer heading text to an explicit reference', () => {
    const w = lintCarve('# Plan\n\nSee [x][plan].')
    expect(w[0]!.message).toBe('Reference link [x][plan] has no matching link definition or heading; it renders as literal text.')
  })

  it('finds unresolved reference links inside footnote definitions', () => {
    const w = lintCarve('See[^n].\n\n[^n]: See [docs][missing].')
    expect(w.map((x) => x.rule)).toEqual(['unresolved-reference-link'])
  })
})

describe('lintCarve — footnotes', () => {
  it('flags a footnote reference with no definition', () => {
    const w = lintCarve('See[^missing].')
    expect(w.map((x) => x.rule)).toEqual(['unresolved-footnote'])
    expect(w[0]!.message).toContain('[^missing]')
  })

  it('flags a duplicate footnote definition', () => {
    const w = lintCarve('[^a]: one\n\n[^a]: two\n\nSee[^a].')
    expect(w.map((x) => x.rule)).toEqual(['duplicate-footnote-definition'])
    expect(w[0]!.line).toBe(3)
  })

  it('flags an unused footnote definition', () => {
    const w = lintCarve('[^unused]: note')
    expect(w.map((x) => x.rule)).toEqual(['unused-footnote-definition'])
    expect(w[0]!.message).toContain('[^unused]')
  })

  it('does not flag a referenced footnote definition', () => {
    expect(lintCarve('See[^a].\n\n[^a]: note')).toEqual([])
  })
})

describe('lintCarve — trailing heading attribute', () => {
  it('flags a heading that ends with {#id} (literal, not an attribute)', () => {
    const w = lintCarve('## Setup {#install}')
    expect(w.map((x) => x.rule)).toEqual(['heading-trailing-attribute'])
    expect(w[0]!.message).toContain('{#install}')
    expect(w[0]!.column).toBe(10)
  })

  it('flags the {.class} form too', () => {
    expect(rules('## Setup {.featured}')).toEqual(['heading-trailing-attribute'])
  })

  it('does not flag the correct preceding block-attribute line', () => {
    expect(lintCarve('{#install .lead}\n## Setup')).toEqual([])
  })

  it('does not flag a valid inline span at the end of a heading', () => {
    // `[text]{.class}` is a span (brace abuts `]`), not a heading attribute.
    expect(lintCarve('## See [foo]{.bar}')).toEqual([])
  })

  it('ignores a brace that only looks attribute-like inside code', () => {
    expect(lintCarve('```\n## Setup {#x}\n```')).toEqual([])
  })
})

describe('lintCarve — legacy raw fence', () => {
  it('flags ```raw FORMAT and suggests ```=FORMAT', () => {
    const w = lintCarve('```raw html\n<b>x</b>\n```')
    expect(w.map((x) => x.rule)).toEqual(['raw-block-syntax'])
    expect(w[0]!.message).toContain('```=html')
    expect(w[0]!.line).toBe(1)
  })

  it('does not flag the correct ```=FORMAT raw block', () => {
    expect(lintCarve('```=html\n<b>x</b>\n```')).toEqual([])
  })

  it('does not flag a raw-looking line inside a real code block', () => {
    expect(lintCarve('```python\n```raw html\n```')).toEqual([])
  })

  it('does not flag a raw-looking line inside a captioned (figure) code block', () => {
    expect(lintCarve('```python\n```raw html\nx\n```\n^ A listing caption')).toEqual([])
  })
})

describe('lintCarve — block marker leaked as text', () => {
  it('flags a ::: fence that parsed as a paragraph', () => {
    const w = lintCarve(':::note\nbody')
    expect(w.map((x) => x.rule)).toEqual(['block-marker-as-text'])
    expect(w[0]!.message).toContain(':::')
  })

  it('does not flag a valid admonition', () => {
    expect(lintCarve('::: note\nbody\n:::')).toEqual([])
  })

  it('does not flag a valid admonition with a title', () => {
    expect(lintCarve('::: tip "Heads up"\nbody\n:::')).toEqual([])
  })
})

describe('lintCarve — blockquote marker without space', () => {
  it('flags the old tight blockquote spelling', () => {
    const w = lintCarve('>quote')
    expect(w.map((x) => x.rule)).toEqual(['blockquote-marker-without-space'])
    expect(w[0]!.message).toContain('> quote')
  })

  it('flags operators and tabs that now stay prose', () => {
    expect(rules('>>= operator')).toEqual(['blockquote-marker-without-space'])
    expect(rules('>\tquote')).toEqual(['blockquote-marker-without-space'])
  })

  it('does not flag valid quote markers or escaped prose', () => {
    expect(lintCarve('> quote\n>\n>  indented')).toEqual([])
    expect(lintCarve('\\>quote')).toEqual([])
  })
})

describe('lintCarve — fence opener title syntax', () => {
  it('flags an unquoted trailing title with a quoted suggestion', () => {
    const w = lintCarve('::: note Custom Title\nbody\n:::')
    expect(w.map((x) => x.rule)).toEqual(['fence-title-syntax'])
    expect(w[0]!.message).toContain('::: note "Custom Title"')
  })

  it('flags typographic quotes with a straight-quote suggestion', () => {
    const w = lintCarve('::: tab “Overview”\nbody\n:::')
    expect(w.map((x) => x.rule)).toEqual(['fence-title-syntax'])
    expect(w[0]!.message).toContain('smart quote')
    expect(w[0]!.message).toContain('::: tab "Overview"')
  })

  it('keeps a trailing [label] out of the suggested title', () => {
    const w = lintCarve('::: tab Overview [API]\nbody\n:::')
    expect(w.map((x) => x.rule)).toEqual(['fence-title-syntax'])
    expect(w[0]!.message).toContain('::: tab "Overview" [API]')
  })

  it('echoes the actual fence length in the suggestion', () => {
    const w = lintCarve(':::: note Custom Title\nbody\n::::')
    expect(w.map((x) => x.rule)).toEqual(['fence-title-syntax'])
    expect(w[0]!.message).toContain(':::: note "Custom Title"')
  })

  it('flags a trailing {…} with a preceding-line hint', () => {
    const w = lintCarve('::: note {#id}\nbody\n:::')
    expect(w.map((x) => x.rule)).toEqual(['fence-title-syntax'])
    expect(w[0]!.message).toContain('own line')
  })

  it('diagnoses an unterminated title while recovering the container', () => {
    const w = lintCarve('::: note "unterminated\nbody\n:::')
    expect(w.map((x) => x.rule)).toEqual(['fence-title-syntax'])
  })

  it('does not flag valid title and label forms', () => {
    expect(lintCarve('::: tip "Pro Tip" [Build]\nbody\n:::')).toEqual([])
    expect(lintCarve('::: tab [Overview]\nbody\n:::')).toEqual([])
  })
})

describe('lintCarve — clean input', () => {
  it('returns nothing for an empty or plain document', () => {
    expect(lintCarve('')).toEqual([])
    expect(lintCarve('# Title\n\nJust prose, one heading.')).toEqual([])
  })
})

describe('formatLintWarnings', () => {
  it('renders file:line:col rule — message', () => {
    const w = lintCarve('# A\n\n</#x>')
    expect(formatLintWarnings(w, 'doc.crv')).toMatch(
      /^doc\.crv:3:1 broken-crossref — /,
    )
  })
})

describe('lintCarve — verbatim-scan performance (no O(n^2))', () => {
  // Each collector used to rebuild a verbatim range list and test every source
  // line against it with `.some(...)`, an O(lines x regions) scan run twice.
  // The shared O(1) line set must keep lint near-linear: a document with
  // thousands of fenced blocks must lint quickly, not in seconds.
  it('lints a 10000-fence document and warns about none of them', () => {
    // NO TIME BOUND, and the reason is that the one that was here could not be
    // the guard it claimed to be. It asserted under 1000ms "against returning
    // to seconds-scale behavior under shared CI load" - but the value it
    // compared read 185ms on a box at loadavg 10, only 5.4x below the bound, in
    // a suite where ambient load alone has inflated a reading 10.4x on
    // unchanged code (carve-js#1268). A ceiling a busy runner can reach is not
    // a ceiling on the algorithm.
    //
    // The near-linear guarantee is asserted in the next test, per region and
    // interleaved, which is the load-cancelling form. What is left here is the
    // half that does not depend on the machine: 10000 fenced blocks are all
    // recognized as verbatim, so none of them produces a warning. A collector
    // that stopped suppressing inside verbatim regions fails this on content,
    // not on the clock.
    let src = ''
    for (let i = 0; i < 10000; i++) src += '```\ncode\n```\n\n'
    expect(lintCarve(src)).toEqual([])
  })

  perfIt('scales near-linearly with the number of verbatim regions', () => {
    const build = (n: number): string => {
      let s = ''
      for (let i = 0; i < n; i++) s += '```\ncode\n```\n\n'
      return s
    }
    // Cost PER REGION, not total elapsed: "linear" means this stays flat as the
    // input grows, so the metric is ~1 for a healthy scan and ~4 (the size
    // multiple) if quadratic scanning returns.
    const perRegion = (n: number): number => {
      const src = build(n)
      const t0 = performance.now()
      lintCarve(src)
      return (performance.now() - t0) / n
    }
    const median = (xs: number[]): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

    perRegion(2000) // warm up so JIT state is comparable across sizes

    // Interleave the two sizes so a runner that is busy for only part of the
    // run cannot skew one sample relative to the other, and take the median so
    // a single stall is discarded (a mean would still be dragged by it).
    const smalls: number[] = []
    const larges: number[] = []
    for (let round = 0; round < 5; round++) {
      smalls.push(perRegion(4000))
      larges.push(perRegion(16000)) // 4x the regions
    }
    // Linear -> ~1; quadratic -> ~4 at 4x input. 2 sits clear of both.
    expect(median(larges) / median(smalls)).toBeLessThan(2)
  })
})

describe('lintCarve — verbatim regions still suppress in-block warnings', () => {
  it('does not flag a legacy raw fence inside a code block', () => {
    // A `~~~raw html` line is a raw-block-syntax warning in prose, but inside a
    // fenced code block it is verbatim content and must be skipped. This proves
    // the shared verbatim set still gates both source-line collectors.
    const inProse = lintCarve('~~~raw html\n<b>x</b>\n~~~').map((w) => w.rule)
    expect(inProse).toContain('raw-block-syntax')
    const inBlock = lintCarve('````\n~~~raw html\n<b>x</b>\n~~~\n````').map(
      (w) => w.rule,
    )
    expect(inBlock).not.toContain('raw-block-syntax')
  })

  it('does not flag a footnote definition shape inside a code block', () => {
    const w = lintCarve('````\n[^a]: not a real footnote def\n[^a]: dup\n````').map(
      (x) => x.rule,
    )
    expect(w).not.toContain('duplicate-footnote-definition')
  })
})

describe('lintCarve — indented fenced-code delimiter', () => {
  const rulesOf = (src: string) => lintCarve(src).map((w) => w.rule)

  it('flags an indented fence opener at the top level', () => {
    const w = lintCarve('  ```\n  code\n  ```\n')
    expect(w.map((x) => x.rule)).toContain('fence-delimiter-indentation')
    expect(w[0].message).toContain('column-exact')
    expect(w[0].line).toBe(1)
  })

  it('flags an indented tilde fence', () => {
    expect(rulesOf(' ~~~\n x\n ~~~\n')).toContain('fence-delimiter-indentation')
  })

  it('does not flag a column-0 fence', () => {
    expect(rulesOf('```\ncode\n```\n')).not.toContain('fence-delimiter-indentation')
  })

  it('does not flag a fence at a list item content column', () => {
    expect(rulesOf('- one\n  ```\n  code\n  ```\n')).not.toContain('fence-delimiter-indentation')
  })

  it('does not flag a fence inside a block quote', () => {
    expect(rulesOf('> ```\n> code\n> ```\n')).not.toContain('fence-delimiter-indentation')
  })

  it('does not flag an indented ``` shown as sample text inside a fence', () => {
    expect(rulesOf('````\n  ```\nsample\n  ```\n````\n')).not.toContain(
      'fence-delimiter-indentation',
    )
  })

  it('does not double-flag a legacy raw fence (rule 2 owns it)', () => {
    const w = lintCarve('  ``` raw html\nx\n  ```\n').filter(
      (x) => x.line === 1,
    )
    expect(w.map((x) => x.rule)).not.toContain('fence-delimiter-indentation')
  })
})

describe('lintCarve — indented fence rule inline-span guard', () => {
  it('does not flag an indented inline code span (complete on one line)', () => {
    const rulesOf = (src: string) => lintCarve(src).map((w) => w.rule)
    expect(rulesOf('  ```not a fence```\n')).not.toContain('fence-delimiter-indentation')
    expect(rulesOf('  ```foo bar```\n')).not.toContain('fence-delimiter-indentation')
  })
})

describe('lintCarve - unclosed container', () => {
  const unclosed = (source: string) =>
    lintCarve(source)
      .filter((w) => w.rule === 'unclosed-container-fence')
      .map((w) => ({
        line: w.line,
        column: w.column,
        start: w.start,
        end: w.end,
        message: w.message,
      }))

  it('reports a single unclosed opener at its opener fence run', () => {
    // Since PART 9 section 12 took exact-length closers, this no longer turns
    // the rest of the document into literal text - it closes at end of input.
    // Which is why it needs saying: the container silently runs further than
    // the author meant, and everything still renders.
    const [warning] = unclosed('💡\n:::: note\nbody\n')
    expect(warning).toMatchObject({ line: 2, column: 1, start: 3, end: 7 })
    expect(warning?.message).toContain('runs to the end of the document')
    expect(warning?.message).toContain('bare fence of 4 colons')
  })

  it('says nothing when every container is closed', () => {
    expect(unclosed('::: note\nbody\n:::\n')).toEqual([])
    expect(unclosed('::::\n::: note\nx\n:::\n::::\n')).toEqual([])
  })

  it('reports a closed container nested inside an unclosed one', () => {
    expect(unclosed(':::: note\nouter\n:::\ninner\n:::\n')).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
    ])
  })

  it('reports all openers left open when a would-be outer closer is blocked by an inner opener', () => {
    expect(unclosed('::::\n::: note\nbody\n::::\n')).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
      expect.objectContaining({ line: 2, column: 1 }),
      expect.objectContaining({ line: 4, column: 1 }),
    ])
  })

  it('reports both sides of a wrong-width closer typo', () => {
    const warnings = unclosed(':::: note\nbody\n:::\n')
    expect(warnings).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
      expect.objectContaining({ line: 3, column: 1 }),
    ])
    expect(warnings[0]?.message).toContain('bare fence of 4 colons')
    expect(warnings[1]?.message).toContain('bare fence of 3 colons')
  })

  it('ignores a line that opens nothing', () => {
    // No space after the fence, so the grammar makes this a paragraph.
    expect(unclosed(':::note\nbody\n')).toEqual([])
  })

  it('does not treat a bare fence inside a code fence as a closer', () => {
    expect(unclosed('::: note\n```text\n:::\n```\n')).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
    ])
  })

  it('does not treat a bare fence inside a comment block as a closer', () => {
    expect(unclosed('::: note\n%%%\n:::\n%%%\n')).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
    ])
  })

  it('does not report a container opener inside an opaque code or comment block', () => {
    expect(unclosed('```\n::: note\n```\n')).toEqual([])
    expect(unclosed('%%%\n::: note\n%%%\n')).toEqual([])
  })

  it('reports line-block and hard-break-block openers', () => {
    expect(unclosed('::: |\nline\n')).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
    ])
    expect(unclosed('::: \\\nline\n')).toEqual([
      expect.objectContaining({ line: 1, column: 1 }),
    ])
  })
})

describe('lintCarve — empty-include-path advisory', () => {
  const emptyRules = (src: string) =>
    lintCarve(src)
      .filter((w) => w.rule === 'empty-include-path')

  it('flags empty braces that look like an include with no path', () => {
    const w = emptyRules('{{ }}')
    expect(w).toHaveLength(1)
    expect(w[0]!.message).toContain('include directive with no path')
    expect(w[0]!.message).toContain('literal text')
  })

  it('flags a run carrying only a #section', () => {
    const w = emptyRules('{{ #intro }}')
    expect(w).toHaveLength(1)
  })

  it('flags a run carrying only an @option', () => {
    expect(emptyRules('{{ @lines:2-4 }}')).toHaveLength(1)
  })

  it('flags an empty-path shape mid-paragraph and points at the braces', () => {
    const w = emptyRules('See {{ }} here.')
    expect(w).toHaveLength(1)
    expect(w[0]!.column).toBe(5)
  })

  it('does not flag a valid include directive', () => {
    expect(emptyRules('{{ x.crv }}')).toEqual([])
  })

  it('does not flag a directive whose only fault is a bad option', () => {
    // That is an expansion-time diagnostic, not an empty path.
    expect(emptyRules('{{ chapter.crv @bogus:1 }}')).toEqual([])
  })

  it('does not flag an empty-path shape inside an inline code span', () => {
    // Spec I9: code is verbatim, so a literal "{{ }}" there is intentional.
    expect(emptyRules('Use `{{ }}` literally.')).toEqual([])
  })

  it('does not flag an empty-path shape inside a fenced code block', () => {
    expect(emptyRules('```txt\n{{ }}\n```')).toEqual([])
  })

  it('does not flag ordinary prose with no braces', () => {
    expect(emptyRules('Just a normal sentence.')).toEqual([])
  })

  it('does not flag a spaceless bracey token (e.g. a template helper)', () => {
    expect(emptyRules('{{#if x}}y{{/if}}')).toEqual([])
  })
})

describe('lintCarve — fence opener that fell back to inline text', () => {
  const rulesOf = (src: string) => lintCarve(src).map((w) => w.rule)
  const RULE = 'fence-opener-fallback'

  it('flags a trailing attribute block and suggests the line above', () => {
    const w = lintCarve('```js {.diff}\n const a = 1\n-let b = 2\n```\n')
    expect(w.map((x) => x.rule)).toEqual([RULE])
    expect(w[0].line).toBe(1)
    expect(w[0].column).toBe(1)
    expect(w[0].message).toContain('(use: "{.diff}" on its own line directly above the fence, then "```js")')
    expect(w[0].data).toEqual({ attributes: '{.diff}', opener: '```js' })
  })

  it('flags a tilde opener, an unquoted title and a key="value" pair', () => {
    expect(rulesOf('~~~js {.diff}\nx\n~~~\n')).toEqual([RULE])
    expect(rulesOf('```js main.js\nx\n```\n')).toEqual([RULE])
    expect(rulesOf('```js title="x"\nx\n```\n')).toEqual([RULE])
    expect(rulesOf('```php [l] "h"\nx\n```\n')).toEqual([RULE])
  })

  it('does not suggest moving anything when there is no trailing attribute block', () => {
    const [w] = lintCarve('```js main.js\nx\n```\n')
    expect(w.message).not.toContain('(use:')
    expect(w.data).toBeUndefined()
  })

  it('names the whitespace when a tab or a second space broke the opener', () => {
    const [w] = lintCarve('```  php\nx\n```\n')
    expect(w.rule).toBe(RULE)
    expect(w.message).toContain('(use: "```php")')
    const [t] = lintCarve('```js\t"T"\nx\n```\n')
    expect(t.message).toContain('(use: "```js "T"")')
  })

  it('flags an opener that interrupts a paragraph', () => {
    const w = lintCarve('para\n```js {.x}\ny\n```\n')
    expect(w.map((x) => [x.rule, x.line])).toEqual([[RULE, 2]])
  })

  it('flags an opener inside a block quote and a list item', () => {
    const q = lintCarve('> ```js {.x}\n> y\n> ```\n')
    expect(q.map((x) => [x.rule, x.line, x.column])).toEqual([[RULE, 1, 3]])
    const l = lintCarve('- item\n\n  ```js {.x}\n  y\n  ```\n')
    expect(l.map((x) => [x.rule, x.line, x.column])).toEqual([[RULE, 3, 3]])
  })

  it('handles CRLF line endings', () => {
    expect(rulesOf('```js {.x}\r\ny\r\n```\r\n')).toEqual([RULE])
    expect(rulesOf('```js\r\ny\r\n```\r\n')).toEqual([])
  })

  it('does not flag valid fences in any container', () => {
    for (const src of [
      '```js\nx\n```\n',
      '``` js\nx\n```\n',
      '```js "main.js" [Main]\nx\n```\n',
      '~~~\nx\n~~~\n',
      '{.diff}\n```js\nx\n```\n',
      '> ```js\n> x\n> ```\n',
      '- item\n\n  ```js\n  x\n  ```\n',
      'para\n```js\nx\n```\n',
    ]) {
      expect(rulesOf(src), src).not.toContain(RULE)
    }
  })

  it('does not flag fence-shaped lines inside an open fence, raw blocks or comments', () => {
    expect(rulesOf('````\n```js {.x}\n```\n````\n')).not.toContain(RULE)
    expect(rulesOf('```=html\n```js {.x}\n```\n')).not.toContain(RULE)
    expect(rulesOf('%%%\n```js {.x}\n%%%\n')).not.toContain(RULE)
  })

  it('does not flag inline code that closes on the same line, or a run mid-paragraph', () => {
    expect(rulesOf('```foo bar```\n')).not.toContain(RULE)
    expect(rulesOf('Use ```js {.x}``` inline.\n')).not.toContain(RULE)
    expect(rulesOf('Some text with ```js {.x} a run\nthat continues ```\n')).not.toContain(RULE)
  })

  it('leaves a legacy raw fence to raw-block-syntax', () => {
    const rules = rulesOf('``` raw html\nx\n```\n')
    expect(rules).toContain('raw-block-syntax')
    expect(rules).not.toContain(RULE)
  })

  it('reports an indented invalid opener once, as a fallback, not as an indentation problem', () => {
    const w = lintCarve('  ```js {.x}\n  y\n  ```\n').filter((x) => x.line === 1)
    expect(w.map((x) => x.rule)).toEqual([RULE])
  })
})
