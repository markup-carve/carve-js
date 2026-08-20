import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, renderHtml, resolve } from '../src/index.js'
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
    expect(accepted).toBe(51)
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
    ]) expect(tryFastHtml(source, {}), source).toBeUndefined()
  })
})
