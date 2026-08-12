import { describe, it, expect } from 'vitest'
import {
  bbcodeToCarve,
  BbcodeInputTooLargeError,
  BBCODE_MAX_INPUT_LENGTH,
} from '../src/bbcode-migrate.js'

describe('bbcodeToCarve — formatting', () => {
  it('maps the four basic tags to their Carve spelling', () => {
    expect(bbcodeToCarve('[b]bold[/b]')).toBe('*bold*\n')
    expect(bbcodeToCarve('[i]italic[/i]')).toBe('/italic/\n')
    expect(bbcodeToCarve('[u]under[/u]')).toBe('_under_\n')
    expect(bbcodeToCarve('[s]gone[/s]')).toBe('~gone~\n')
  })

  it('keeps the text of a tag with no Carve equivalent', () => {
    expect(bbcodeToCarve('[size=20]big[/size]')).toBe('big\n')
    expect(bbcodeToCarve('[color=red]red[/color]')).toBe('red\n')
  })

  it('forces the braced form for sup and sub, which are often intraword', () => {
    expect(bbcodeToCarve('E=mc[sup]2[/sup]')).toBe('E=mc{^2^}\n')
    expect(bbcodeToCarve('H[sub]2[/sub]O')).toBe('H{,2,}O\n')
  })
})

describe('bbcodeToCarve — links, images and code', () => {
  it('converts both url spellings', () => {
    expect(bbcodeToCarve('[url=https://e.com]text[/url]')).toBe('[text](https://e.com)\n')
    expect(bbcodeToCarve('[url]https://e.com[/url]')).toBe('<https://e.com>\n')
  })

  it('drops an image size, which Carve has no place for', () => {
    expect(bbcodeToCarve('[img=100x50]a.png[/img]')).toBe('![](a.png)\n')
  })

  it('fences a code block and keeps its language', () => {
    expect(bbcodeToCarve('[code=php]\n$x = 1;\n[/code]')).toBe('```php\n$x = 1;\n```\n')
  })

  it('strips a leading = from the language so no raw-HTML block can be minted', () => {
    // `[code= =html]` must not become a Carve `=html` raw-HTML block, which
    // would be live HTML under the default renderer.
    expect(bbcodeToCarve('[code= =html]\n<b>x</b>\n[/code]')).not.toContain('```=html')
  })
})

describe('bbcodeToCarve — quotes', () => {
  it('renders an attribution as name, datetime and id', () => {
    expect(bbcodeToCarve('[quote=Alice]q[/quote]')).toBe('> q\n^ Alice\n')
    expect(bbcodeToCarve('[quote=id="9" name="Bob" date="2024-01-01"]q[/quote]')).toContain(
      '^ Bob (2024-01-01) #9',
    )
  })

  it('nests without recursing, and drops a stray closer', () => {
    expect(bbcodeToCarve('[quote=A][quote=B]inner[/quote]outer[/quote]')).toContain('> > inner')
    expect(bbcodeToCarve('no open [/quote] here')).toBe('no open  here\n')
  })
})

describe('bbcodeToCarve — lists and tables', () => {
  it('converts both list kinds', () => {
    expect(bbcodeToCarve('[list]\n[*]one\n[*]two\n[/list]')).toBe('- one\n- two\n')
    expect(bbcodeToCarve('[list=1]\n[*]one\n[*]two\n[/list]')).toBe('1. one\n2. two\n')
  })

  it('alternates the bullet so two adjacent lists stay distinct', () => {
    const out = bbcodeToCarve('[list]\n[*]a\n[/list]\n[list]\n[*]b\n[/list]')
    expect(out).toContain('- a')
    expect(out).toContain('* b')
  })

  it('uses native header markers for a row carrying th cells', () => {
    expect(bbcodeToCarve('[table][tr][th]A[/th][th]B[/th][/tr][/table]')).toBe('|= A |= B |\n')
    expect(bbcodeToCarve('[table][tr][td]a[/td][td]b[/td][/tr][/table]')).toBe('| a | b |\n')
  })
})

describe('bbcodeToCarve — text that is literal in BBCode', () => {
  // BBCode owns no Carve delimiter, so every one of these is the author's
  // literal text and must not become markup (carve-php#1141, #1191).
  it('escapes Carve delimiters a forum post means literally', () => {
    expect(bbcodeToCarve('literal *stars* here')).toBe('literal \\*stars* here\n')
    expect(bbcodeToCarve('a /it/ and =hi= and ~no~')).toBe('a \\/it/ and \\=hi= and \\~no~\n')
  })

  it('escapes a hashtag, which BBCode does not have', () => {
    expect(bbcodeToCarve('Issue #42 and #project-x here.')).toBe(
      'Issue \\#42 and \\#project-x here.\n',
    )
  })

  it('leaves a numeric character reference decodable', () => {
    expect(bbcodeToCarve('a &#8212; b')).toBe('a &#8212; b\n')
  })

  it('does not let the list marker be escaped as an emphasis pair', () => {
    // Two `[*]` on a line read as a `*…*` pair to the escaper unless the tag
    // is protected first.
    expect(bbcodeToCarve('[list]\n[*]a\n[*]b\n[/list]')).toBe('- a\n- b\n')
  })
})

describe('bbcodeToCarve — bounds', () => {
  it('rejects an implausibly large post rather than converting it slowly', () => {
    expect(() => bbcodeToCarve('x'.repeat(BBCODE_MAX_INPUT_LENGTH + 1))).toThrow(
      BbcodeInputTooLargeError,
    )
  })

  it('converts an empty document to an empty document', () => {
    expect(bbcodeToCarve('')).toBe('\n')
  })
})
