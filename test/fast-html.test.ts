import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import { tryFastHtml, tryFastHtmlWithStats } from '../src/fast-html.js'

function authoritative(source: string): string {
  return renderHtml(resolve(parse(source)))
}

describe('borrowed HTML layout', () => {
  it('matches the authoritative pipeline for every accepted fixture', () => {
    for (const source of [
      '# Heading\n\nPlain text.\n',
      'A paragraph spanning\nthree plain lines\nwithout an interrupt.\n',
      '# Heading\n\nParagraph with *strong*, /emphasis/, and `code`.\n',
      '[site]: https://example.com "Example"\n\n# Links\n\nA [direct](https://example.com/x) and [reference][site].\n',
      '# Lists\n\n- first\n- second\n  - nested *strong*\n  - nested two\n',
      '# Quote\n\n> One quoted /line/.\n',
      '> A quoted paragraph\n> spanning two lines.\n',
      '3. third\n4. fourth\n',
      '# Break\n\n***\n',
      '# Code\n\n```rs\nfn main() {\n}\n```\n',
      '# Table\n\n| A | B | C |\n| --- | ---: | :---: |\n| x | 1 | *z* |\n| y | 2 | `q` |\n',
      '# One\n\n## Two\n\ntext\n\n## Two\n\ntext\n',
    ]) {
      const fast = tryFastHtml(source, {})
      expect(fast, source).not.toBeUndefined()
      expect(fast, source).toBe(authoritative(source))
    }
  })

  it('pins Tier-1 routing and typed acceptance counters', () => {
    const source = [
      '[site]: https://example.com "Example"', '', '# Layout benchmark', '',
      'A [link][site] with *strong* and /emphasis/.', '', '> quoted text', '',
      '- first', '- second', '', '```rs', 'let answer = 42;', '```', '',
      '| Name | Value |', '| --- | ---: |', '| one | 1 |', '| two | 2 |', '',
    ].join('\n')
    const result = tryFastHtmlWithStats(source, {})
    expect(result).toBeDefined()
    expect(result!.accepted).toEqual({
      headings: 1, paragraphs: 1, blockQuotes: 1, codeFences: 1,
      thematicBreaks: 0, unorderedListItems: 2, orderedListItems: 0,
      tableRows: 3, linkDefinitions: 1, consumedLines: 13, activeDefinitions: 1,
    })
    expect(result!.html).toBe(authoritative(source))
  })

  it('keeps exact shadow parity for every accepted corpus document', () => {
    const corpus = fileURLToPath(new URL('../spec/tests/corpus/', import.meta.url))
    const files = readdirSync(corpus).filter((file) => file.endsWith('.crv')).sort()
    let accepted = 0
    for (const file of files) {
      const source = readFileSync(`${corpus}/${file}`, 'utf8')
      const fast = tryFastHtml(source, {})
      if (fast === undefined) continue
      accepted++
      expect(fast, file).toBe(authoritative(source))
    }
    // The population this sweep compares, so a fast path that quietly stopped
    // accepting anything cannot pass by comparing nothing. It moves only when
    // the pinned corpus does: the bump to carve `d0b6c92` added
    // `406-a-heading-s-marker-separator-is-a-run-and-none-of-it-is-content`,
    // whose shadow render already matches the authoritative pipeline above.
    expect(accepted).toBe(52)
  })

  it('falls back for normalization-sensitive or stateful shapes', () => {
    for (const source of [
      '# *marked heading*\n', 'A “smart” quote.\n',
      '[^n]: note\n\nsee [^n]\n', '^[inline note]\n', '::: note\nbody\n:::\n',
      '![image](/x.png)\n', '{#id}\n# heading\n', '[x](java\0script:alert(1))\n',
      '[x](java-script:alert(1))\n', '- a\n- +\n', '- # H\n- next\n',
      '> # H\n\ntail\n', '.   \n', '/*x*/\n', '$`a``b`\n', '`  a  `\n',
      '> a\nb\n', '-   x\n', '=marked= here\n', '- apples\n\n- oranges\n',
      '# a :smile: b\n', 'A #tag here.\n', '(c) 2026\n', '| h |\n|---|\v\n| a |\n',
      'a. only one\n', '````  js\nx\n````\n',
      // A blank line before the next sibling marker LOOSENS the list (§17 L1); it
      // is not one of §11 N1's axes, so the items stay one list. Looseness is not
      // expressible in the borrowed layout, so the document is handed back. The
      // bullet spelling two lines up was listed here from the start and the
      // ordered one never was, which is the whole of carve-js#1270.
      '1. a\n\n2. b\n', '1. a\n\n1. b\n', '1. a\n\n\n2. b\n',
      // A lone `+` is the list continuation marker (§17 L3): it renders nothing
      // and attaches the block below to the item above, which the borrowed
      // layout has no model for. It used to come out as a literal `<p>+</p>`.
      '- a\n\n+\n\n- b\n', '+\n', '- a\n\n+\n\ntext\n',
      // Two spaces before the title is NOT a definition (corpus 265) - it is a
      // paragraph. The borrowed layout collected it and emitted nothing, so the
      // line vanished.
      '[a]: /u  "T"\n',
    ]) expect(tryFastHtml(source, {}), source).toBeUndefined()
  })

  it('renders a blank-separated list the same in both spellings', () => {
    // The end-to-end assertion behind the fallback above: whatever the fast path
    // decides, `carveToHtml` has to agree with the authoritative pipeline. The
    // ordered case rendered as TWO lists, the second carrying `start="2"`, where
    // carve-php and carve-rs produce one loose list - and the corpus has no
    // ordered-blank-ordered fixture, so shadow parity over the corpus could not
    // see it.
    for (const source of [
      '1. a\n\n2. b\n', '1. a\n\n1. b\n', '1. a\n\n\n2. b\n',
      '- a\n\n- b\n', '1) a\n\n2) b\n', 'i. a\n\nii. b\n',
      '1. a\n2. b\n', '1. a\n\n- b\n', '3. c\n4. d\n',
      '```\n```\n', '```python\n```\n', '[a]: /u  "T"\n', '- a\n\n+\n\n- b\n',
    ]) {
      expect(carveToHtml(source), source).toBe(authoritative(source))
    }
  })

  it('agrees with the authoritative pipeline across the construct matrix', () => {
    // THE GUARD FOR THE WHOLE CLASS, not for the four defects that prompted it.
    // Every divergence here has the same shape: the borrowed layout models a
    // construct the authoritative pipeline models differently, and the corpus
    // cannot see it because shadow parity SKIPS every document the fast path
    // hands back. Crossing each construct with every other at each separator
    // width reaches the shapes no fixture happens to contain - it found the
    // continuation marker, the empty fence and the two-space definition slot.
    const bodies = [
      '# H', 'text', 'text\nmore', '> q', '> q\n> r', '```\nx\n```', '```\n```',
      '***', '- a', '- a\n- b', '1. a', '1. a\n2. b', '| A |\n| --- |\n| x |',
      '[s]: https://e.com', '[s]: https://e.com "T"', '+',
    ]
    const separators = ['\n', '\n\n', '\n\n\n']
    const documents = new Set<string>()
    for (const body of bodies) documents.add(`${body}\n`)
    for (const a of bodies) for (const b of bodies) for (const sep of separators) {
      documents.add(`${a}${sep}${b}\n`)
    }
    for (const source of documents) expect(carveToHtml(source), source).toBe(authoritative(source))
  })

  it('pins the loose ordered list the corpus has no fixture for', () => {
    expect(carveToHtml('1. a\n\n2. b\n')).toBe(
      ['<ol>', '  <li><p>a</p></li>', '  <li><p>b</p></li>', '</ol>'].join('\n'),
    )
  })
})
