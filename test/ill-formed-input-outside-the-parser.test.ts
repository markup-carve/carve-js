import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  bbcodeToCarve,
  djotToCarve,
  expandIncludes,
  fromAstJson,
  htmlToAst,
  htmlToCarve,
  markdownToCarve,
  parse,
  renderHtml,
  resolve,
  toAstJson,
  type IncludeOptions,
} from '../src/index.js'
import { fileSystemResolver } from '../src/includes-fs.js'
import { replaceLoneSurrogates } from '../src/well-formed.js'

// CARVE-P0-023: every entry point that does not go through the parser replaces
// a lone surrogate too. A paired surrogate (an astral character) is the control.
const LONE = 'a\uD800b\uDC00c'
const ASTRAL = 'x\u{1F600}y'

describe('importers replace a lone surrogate with U+FFFD', () => {
  const importers: [string, (text: string) => string][] = [
    ['Markdown', (t) => markdownToCarve(`*${t}*`)],
    ['BBCode', (t) => bbcodeToCarve(`[b]${t}[/b]`)],
    ['Djot', (t) => djotToCarve(`*${t}*`)],
    ['HTML to Carve', (t) => htmlToCarve(`<p>${t}</p>`).value],
    ['HTML to AST', (t) => JSON.stringify(htmlToAst(`<p>${t}</p>`).value)],
  ]
  for (const [name, convert] of importers) {
    it(name, () => {
      const out = convert(LONE)
      expect(replaceLoneSurrogates(out)).toBe(out)
      expect(out).toContain('a\uFFFDb\uFFFDc')
      expect(convert(ASTRAL)).toContain(ASTRAL)
    })
  }
})

describe('AST JSON ingest replaces a lone surrogate with U+FFFD', () => {
  const ingest = (value: string): string => {
    const json = toAstJson(parse('placeholder'))
    const text = (json as { children: { children: { value: string }[] }[] }).children[0]!.children[0]!
    text.value = value
    return renderHtml(fromAstJson(json))
  }
  it('replaces the lone code units and keeps the pair', () => {
    expect(ingest(LONE)).toBe('<p>a\uFFFDb\uFFFDc</p>')
    expect(ingest(ASTRAL)).toBe(`<p>${ASTRAL}</p>`)
  })
})

describe('an include that is not well-formed text is refused, not replaced', () => {
  const expand = (resolveTarget: NonNullable<IncludeOptions['resolve']>) => {
    const source = '{{ child }}'
    const result = expandIncludes(parse(source, { positions: true }), source, { resolve: resolveTarget })
    return { rules: result.warnings.map((w) => w.rule), html: renderHtml(resolve(result.doc)) }
  }

  it('refuses ill-formed UTF-8 bytes', () => {
    const bytes = new Uint8Array([0x61, 0xed, 0xa0, 0x80, 0x62])
    expect(expand(() => ({ source: bytes, id: 'child' }))).toEqual({ rules: ['include-non-text'], html: '<p>{{ child }}</p>' })
  })

  it('refuses a string holding a lone surrogate', () => {
    expect(expand(() => LONE).rules).toEqual(['include-non-text'])
  })

  it('reads well-formed bytes and strings, astral characters included', () => {
    const bytes = new TextEncoder().encode(ASTRAL)
    expect(expand(() => ({ source: bytes, id: 'child' }))).toEqual({ rules: [], html: `<p>${ASTRAL}</p>` })
    expect(expand(() => ASTRAL)).toEqual({ rules: [], html: `<p>${ASTRAL}</p>` })
  })

  describe('through the filesystem resolver', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'carve-js-ill-formed-include-')))
    afterAll(() => rmSync(root, { recursive: true, force: true }))
    const fsExpand = (bytes: Uint8Array) => {
      writeFileSync(path.join(root, 'child'), bytes)
      return expand(fileSystemResolver(root))
    }

    it('refuses a file with an encoded lone surrogate or a stray 0xFF', () => {
      expect(fsExpand(new Uint8Array([0x61, 0xed, 0xa0, 0x80, 0x62])).rules).toEqual(['include-non-text'])
      expect(fsExpand(new Uint8Array([0x61, 0xff, 0x62])).rules).toEqual(['include-non-text'])
    })

    it('reads a well-formed file with an astral character', () => {
      expect(fsExpand(new TextEncoder().encode(ASTRAL))).toEqual({ rules: [], html: `<p>${ASTRAL}</p>` })
    })
  })
})
