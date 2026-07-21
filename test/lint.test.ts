import { describe, it, expect } from 'vitest'
import { lintCarve, formatLintWarnings } from '../src/lint.js'

const rules = (src: string) => lintCarve(src).map((w) => w.rule)

describe('lintCarve — broken cross-references', () => {
  it('flags a </#id> with no matching heading', () => {
    const w = lintCarve('# Intro\n\nSee </#nope>.')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('broken-crossref')
    expect(w[0]!.message).toContain('</#nope>')
  })

  it('does not flag a crossref that targets a real heading', () => {
    expect(lintCarve('# Intro\n\nSee </#intro>.')).toEqual([])
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
    // Two "Title" headings -> ids `title` and `title-2`; both resolvable.
    const w = lintCarve('# Title\n\n## Title\n\n</#title> and </#title-2>')
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
    expect(lintCarve('# Getting Started\n\nSee [getting started][].')).toEqual([])
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

  it('keeps the generic warning for other broken fence lines', () => {
    const w = lintCarve('::: note "unterminated\nbody\n:::')
    expect(w.map((x) => x.rule)).toEqual(['block-marker-as-text'])
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
  it('lints a 10000-fence document without quadratic blow-up', () => {
    // The budget is a generous DoS ceiling, not a micro-benchmark: the old
    // O(n^2) scan took ~1.7s on this input, so a re-regression would blow far
    // past 1000ms. The near-linear scaling guarantee lives in the next test;
    // this one only guards against returning to seconds-scale behavior under
    // shared CI load.
    let src = ''
    for (let i = 0; i < 10000; i++) src += '```\ncode\n```\n\n'
    const t0 = performance.now()
    const w = lintCarve(src)
    const ms = performance.now() - t0
    expect(w).toEqual([])
    expect(ms).toBeLessThan(1000)
  })

  it('scales near-linearly with the number of verbatim regions', () => {
    const build = (n: number): string => {
      let s = ''
      for (let i = 0; i < n; i++) s += '```\ncode\n```\n\n'
      return s
    }
    const time = (src: string): number => {
      const t0 = performance.now()
      lintCarve(src)
      return performance.now() - t0
    }
    // Warm up so JIT state is comparable across the two measured sizes.
    time(build(2000))
    const small = time(build(4000))
    const large = time(build(16000)) // 4x the regions
    // Quadratic scaling would give ~16x; linear ~4x. Allow generous slack for
    // CI noise but stay far below the quadratic blow-up.
    expect(large).toBeLessThan(small * 9 + 50)
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
  const rulesOf = (src) => lintCarve(src).map((w) => w.rule)

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
    const rulesOf = (src) => lintCarve(src).map((w) => w.rule)
    expect(rulesOf('  ```not a fence```\n')).not.toContain('fence-delimiter-indentation')
    expect(rulesOf('  ```foo bar```\n')).not.toContain('fence-delimiter-indentation')
  })
})
