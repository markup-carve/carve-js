import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { autolink } from '../src/autolink.js'

/**
 * One set difference, three subsystems (carve-js#805, #810, #811).
 *
 * JavaScript's `\s` is Unicode White_Space PLUS U+FEFF MINUS U+0085 - a legacy
 * set rather than a property - and `resources/grammar.ebnf` spells the class it
 * was standing in for `whitespace = ' ' | '\t'` (:2206). Wherever a decision was
 * written `\s`, the engine therefore ADMITTED a character the grammar excludes
 * (U+FEFF, and eleven Unicode spaces) and, on the autolink body, OMITTED one it
 * includes (U+0085). A fix aimed at either character alone leaves the other.
 *
 * Measured against carve-rs `83ab9c1` and carve-php `876e312`, both built from
 * their own mains.
 *
 * NOT COVERED HERE, on purpose:
 *   - The TAB row. Whether a delimiter line's trailing run is `whitespace` or
 *     the narrower `space` is unruled: no production names that run at all, and
 *     the three engines disagree (carve-rs takes a tab after `:::` and after `+`
 *     but not after ` ``` `; carve-php takes it in all three). This change
 *     narrows the class to `whitespace` and leaves that question open, so every
 *     tab assertion below is a CONTROL rather than a fixed row.
 *   - U+FEFF, U+200B and U+180E in an AUTOLINK body. `url_char` enumerates
 *     ASCII, and whether it admits non-ASCII at all is markup-carve/carve#860.
 *     Their rows are controls too: they must not move until that lands.
 */

// The characters JavaScript's `\s` reaches that `whitespace` does not. U+0085 is
// the twin case and gets its own tests: it is White_Space, is NOT in `\s`, and so
// went the other way.
const LEGACY_ONLY = [
  ['U+000B', ''],
  ['U+000C', ''],
  ['U+00A0', ' '],
  ['U+1680', ' '],
  ['U+2000', ' '],
  ['U+2009', ' '],
  ['U+200A', ' '],
  ['U+2028', ' '],
  ['U+2029', ' '],
  ['U+202F', ' '],
  ['U+205F', ' '],
  ['U+3000', '　'],
  ['U+FEFF', '﻿'],
] as const

describe('a fence delimiter line', () => {
  // The delimiter is followed by `ch` and nothing else. `y` reaching a paragraph
  // of its own means the fence closed; `y` inside the block means it did not.
  const closes = (ch: string) => /<p>y<\/p>/.test(carveToHtml('```\nx\n```' + ch + '\ny\n'))

  it('is closed by a run of spaces and tabs', () => {
    // CONTROL for the whole class: narrowed to nothing, every fence in the corpus
    // would run to end of document. The tab row is the unruled one (see header).
    expect(closes('')).toBe(true)
    expect(closes(' ')).toBe(true)
    expect(closes('   ')).toBe(true)
    expect(closes('\t')).toBe(true)
    expect(closes(' \t ')).toBe(true)
  })

  it('is not closed by a byte order mark', () => {
    // carve-js#805's own row: a U+FEFF closed the fence here and was content in
    // carve-rs and carve-php. PART 1 states the rule outright - "ONE, and only
    // there: a U+FEFF anywhere else is an ordinary zero-width character".
    expect(closes('﻿')).toBe(false)
  })

  it('is not closed by any other character `\\s` reaches', () => {
    // The ticket names U+FEFF because that is the row where this engine was the
    // lone outlier. The CAUSE is the whole set, so a one-character fix would
    // leave twelve rows still diverging from carve-rs.
    for (const [name, ch] of LEGACY_ONLY) {
      expect({ name, closes: closes(ch) }).toEqual({ name, closes: false })
    }
  })

  it('is not closed by a mark in the middle of an otherwise blank run', () => {
    // The rule is about the whole run, so a check on the first character alone
    // passes ` <BOM>` and fails `<BOM> `.
    expect(closes(' ﻿')).toBe(false)
    expect(closes('﻿ ')).toBe(false)
    expect(closes('﻿﻿')).toBe(false)
  })

  it('reads the same from either end: the OPENER carries the same run', () => {
    // carve-js#805 is a closer that kept the spelling its opener had already
    // shed. The trailing run is one rule seen from two ends, so the opener is
    // pinned in the same file: ```<BOM> opened a fence here and stayed prose in
    // carve-rs and carve-php.
    const opens = (ch: string) => /<pre/.test(carveToHtml('```' + ch + '\nx\n```\n'))
    expect(opens('')).toBe(true)
    expect(opens(' ')).toBe(true)
    expect(opens('﻿')).toBe(false)
    expect(opens('　')).toBe(false)
  })

  it('is the same rule for a colon fence, a raw block and frontmatter', () => {
    // Four constructs, one run. `RE_ADMONITION_CLOSE`, `RE_FRONTMATTER_OPEN`,
    // `RE_FRONTMATTER_CLOSE` and `RE_RAW_FENCE` each spelled it separately, so a
    // pass that reached only the code fence would leave three behind.
    const colon = (ch: string) => carveToHtml(':::: note\nx\n::::' + ch + '\ny\n')
    expect(colon('')).not.toContain('::::')
    expect(colon('﻿')).toContain('::::')
    expect(colon(' ')).toContain('::::')

    const raw = (ch: string) => /<p>y<\/p>/.test(carveToHtml('```=html\n<b>x</b>\n```' + ch + '\ny\n'))
    expect(raw('')).toBe(true)
    expect(raw('﻿')).toBe(false)

    const front = (ch: string) => carveToHtml('---\nt: 1\n---' + ch + '\ny\n')
    expect(front('')).not.toContain('t: 1')
    expect(front('﻿')).toContain('t: 1')
    expect(front(' ')).toContain('t: 1')
  })

  it('is the same rule for the paragraph-interruption closer lookahead', () => {
    // §10: an UNTERMINATED fence does not interrupt a paragraph. That lookahead
    // built its own closer regex, so a `<BOM>`-terminated fence counted as
    // closed and the opener interrupted prose it should have stayed inside.
    const interrupts = (ch: string) => /<pre/.test(carveToHtml('p\n```\nx\n```' + ch + '\n'))
    expect(interrupts('')).toBe(true)
    expect(interrupts('﻿')).toBe(false)
  })

  it('is the same rule for the definition prepass, which reads fences too', () => {
    // A THIRTEENTH spelling, in the prepass that collects link definitions.
    //
    // The shape is built so the two passes can be caught disagreeing: the mark
    // does NOT close the fence, a later bare run does, and the reference sits
    // after that. So `[r]: /u` is code either way, but if the prepass alone reads
    // the mark as a closer it collects the line as a definition and the reference
    // resolves to a URL the reader can see is inside a code block.
    const html = carveToHtml('```\nx\n```﻿\n[r]: /u\n```\n\ny [t][r]\n')
    expect(html).toContain('[r]: /u')
    expect(html).not.toContain('href="/u"')
  })

  it('is the same rule for the looseness scan, which reads fences too', () => {
    // A FOURTEENTH: an item's tight/loose decision skips blanks inside a CLOSED
    // fence. Reading the mark as a closer made the fence closed, so the blank was
    // skipped and the item came out tight - the mark decided a `<p>` wrapper two
    // constructs away from itself.
    // The only blank line in the document sits inside the fence, so the item is
    // TIGHT (`<li>b</li>`) when the fence is closed and LOOSE (`<li><p>b</p>`)
    // when it is not. A bare closer closes it; the mark must not.
    const item = (ch: string) => carveToHtml('- a\n  ```\n  x\n\n  y\n  ```' + ch + '\n- b\n')
    expect(item('')).toContain('<li>b</li>')
    expect(item('﻿')).toContain('<li><p>b</p></li>')
    expect(item('X')).toContain('<li><p>b</p></li>')
  })
})

describe('an autolink body', () => {
  const links = (ch: string) => /<a href="https:\/\/a\.com\/b/.test(carveToHtml('<https://a.com/b' + ch + 'c>\n'))

  it('does not admit U+0085, which `\\s` alone leaves in', () => {
    // The MIRROR of the fence rows: U+0085 is Unicode White_Space and is NOT in
    // JavaScript's `\s`, so a body spelled `\s` linked it and carried an
    // invisible character into the href. carve-rs leaves the line literal.
    // Excluded under both readings of `url_char`, so markup-carve/carve#860 does
    // not reach it.
    expect(links('')).toBe(false)
  })

  it('still admits an ordinary URL', () => {
    // CONTROL. Without it the class could be widened to everything and the whole
    // construct would vanish.
    expect(links('')).toBe(true)
    expect(links('X')).toBe(true)
    expect(carveToHtml('<https://xn--caf-dma.example/x>\n')).toContain('href="https://xn--caf-dma.example/x"')
  })

  it('does not admit any other Unicode space either', () => {
    // These were already out via `\s`; they are here so a later switch to a bare
    // property (or back to `\s`) cannot quietly move them.
    for (const ch of ['', '', ' ', ' ', ' ', ' ', ' ', '　']) {
      expect({ cp: ch.codePointAt(0), links: links(ch) }).toEqual({ cp: ch.codePointAt(0), links: false })
    }
  })

  it('leaves the zero-width rows exactly where markup-carve/carve#860 found them', () => {
    // CONTROLS, and the reason the class is not spelled `\p{White_Space}` alone.
    // U+FEFF is out and U+200B / U+180E are in - an incoherence this engine has
    // carried since the body was `\s`. All three belong to one question (may a
    // `url_char` be non-ASCII at all?), so they move together when it is ruled
    // and not before.
    expect(links('﻿')).toBe(false)
    expect(links('​')).toBe(true)
    expect(links('᠎')).toBe(true)
  })

  it('is spelled once, so the bare-URL extension answers the same', () => {
    // The body appears TWICE in the extension's own pattern - the run and the
    // last-character guard - and once more in the core parser. A URL that may
    // not CONTAIN the character must not be able to END with it either.
    const href = (src: string) => carveToHtml(src, { extensions: [autolink()] }).match(/href="([^"]*)"/)?.[1]
    expect(href('see https://a.com/bc end')).toBe('https://a.com/b')
    expect(href('see https://a.com/bc end')).toBe('https://a.com/bc')
    expect(href('see https://a.com/b end')).toBe('https://a.com/b')
  })
})

describe('a continuation marker', () => {
  // `- a` then the marker line then a fence: the fence lands INSIDE the item when
  // the marker is recognized and after the list when it is not.
  const marker = (ch: string) => /<ul>[\s\S]*<pre[\s\S]*<\/ul>/.test(carveToHtml('- a\n+' + ch + '\n```\nq\n```\n'))

  it('is a lone `+` with spaces or tabs around it', () => {
    // CONTROL for the class. The tab row is the unruled one (see header);
    // carve-rs and carve-php both take it.
    expect(marker('')).toBe(true)
    expect(marker(' ')).toBe(true)
    expect(marker('\t')).toBe(true)
    expect(marker('X')).toBe(false)
  })

  it('is not opened by `+` followed by a byte order mark', () => {
    // carve-js#811's own row.
    expect(marker('﻿')).toBe(false)
  })

  it('is not opened by `+` followed by anything else `\\s` reaches', () => {
    for (const [name, ch] of LEGACY_ONLY) {
      expect({ name, marker: marker(ch) }).toEqual({ name, marker: false })
    }
  })

  it('reads the same in the first-block form `- +`', () => {
    // A SECOND spelling, on the item's own content rather than a following line.
    const first = (ch: string) => /<ul>[\s\S]*<pre[\s\S]*<\/ul>/.test(carveToHtml('- +' + ch + '\n```\nq\n```\n'))
    expect(first('')).toBe(true)
    expect(first('﻿')).toBe(false)
    expect(first('　')).toBe(false)
  })

  it('reads the same in the definition prepass, which used the wider `trim()`', () => {
    // A THIRD spelling, and the one that did not even agree with the other two:
    // the prepass used the native `trim()` (full `\s`, U+00A0 included) where the
    // block lexer used `\s` minus U+00A0. With the marker recognized, the item's
    // open content column is the MARKER's own, so a definition at the item's
    // column is not collected and the reference below stays literal; without it
    // the item's column is live and the definition resolves.
    //
    // U+00A0 is the row that ISOLATES this site: no other spelling ever accepted
    // it, so a reference that resolves here and nowhere else can only mean the
    // prepass and the block lexer disagreed about the same line.
    const resolves = (ch: string) =>
      carveToHtml('-   a\n+' + ch + '\n    [r]: /u\n\nx [t][r]\n').includes('href="/u"')
    expect(resolves('')).toBe(false)
    expect(resolves('\t')).toBe(false)
    expect(resolves('X')).toBe(true)
    expect(resolves('﻿')).toBe(true)
    expect(resolves('\u00a0')).toBe(true)
  })

  it('does not treat a mark before the `+` as indentation', () => {
    // The LEADING run is the line's indentation, where a tab is syntax and a
    // zero-width character is not (carve-js#790, #793). It was `\s` here too.
    expect(marker('')).toBe(true)
    expect(/<ul>[\s\S]*<pre[\s\S]*<\/ul>/.test(carveToHtml('- a\n﻿+\n```\nq\n```\n'))).toBe(false)
  })
})
