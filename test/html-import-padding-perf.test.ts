import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/html-import.js'
import { LinkPolicy } from '../src/profile.js'
import { renderMarkdown } from '../src/render-markdown.js'
import { parse, carveToHtml, markdownToCarve, djotToCarve, lintCarve } from '../src/index.js'
import { codeCallouts } from '../src/code-callouts.js'
import { normalizeHtml } from '../src/portability.js'
import type { Document } from '../src/ast.js'
import { trimEndSpaceTab, trimMatchingEdges } from '../src/trim-non-nbsp.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('HTML import inline padding', () => {
  it.each([
    ['', ''], [' \t', ''], ['x \t', 'x'], ['x y', 'x y'],
    ['x \n', 'x \n'], ['x \r', 'x \r'], ['x \f', 'x \f'],
    ['x \u00a0', 'x \u00a0'], ['x \u2028', 'x \u2028'],
    ['x\u00a0 \t', 'x\u00a0'],
  ])('trims only trailing spaces and tabs in %j', (input, output) => {
    expect(trimEndSpaceTab(input)).toBe(output)
  })

  it('preserves the content between adjacent space-only spans', () => {
    const spaces = '<span> </span>'.repeat(128)
    const result = htmlToCarve(`<p>x${spaces}x</p>`)
    expect(result.value).toBe(`x${' '.repeat(128)}x\n`)
    expect(result.report.diagnostics).toHaveLength(128)
    expect(result.report.diagnostics.every((row) => row.code === 'element-dropped')).toBe(true)
  })

  perfIt('imports internal space runs in linear time', () => {
    expectScansLinearly((html) => void htmlToCarve(html), '<span> </span>', {
      prefix: '<p>x', suffix: 'x</p>', smallRepeats: 4000,
      minSampleMs: 500,
      label: 'HTML import internal spaces',
    })
  }, 30000)
})

describe('whitespace edge scans', () => {
  it('matches each caller whitespace set without widening it', () => {
    for (const whitespace of [/[ \t]/, /[ \t\n]/, /[\t\n\f\r ]/, /[\u0000-\u0020]/]) {
      const old = new RegExp(`^${whitespace.source}+|${whitespace.source}+$`, 'g')
      const chars = ['x', ' ', '\t', '\n', '\r', '\f', '\0', '\u00a0', '\u001f', '!', '\v', '\u2028']
      const check = (value: string, depth: number): void => {
        expect(trimMatchingEdges(value, (code) => whitespace.test(String.fromCharCode(code)))).toBe(value.replace(old, ''))
        if (depth > 0) for (const char of chars) check(value + char, depth - 1)
      }
      check('', 4)
    }
  })

  it('keeps invalid padded data-lang from becoming a code language', () => {
    const invalid = `a${' '.repeat(16384)}b`
    const result = htmlToCarve(`<pre data-lang="${invalid}"><code>x</code></pre>`)
    expect(result.value).toBe(`{data-lang="${invalid}"}\n\`\`\`\nx\n\`\`\`\n`)
  })

  perfIt('checks URLs with internal whitespace in linear time', () => {
    const policy = LinkPolicy.unrestricted()
    expectScansLinearly((url) => void policy.isUrlAllowed(url), ' ', {
      prefix: '/a', suffix: 'b', smallRepeats: 16000,
      minSampleMs: 250, label: 'URL policy internal spaces',
    })
  }, 30000)

  perfIt('reads invalid data-lang with internal whitespace in linear time', () => {
    expectScansLinearly((html) => void htmlToCarve(html), ' ', {
      prefix: '<pre data-lang="a', suffix: 'b"><code>x</code></pre>', smallRepeats: 16000,
      minSampleMs: 250, label: 'HTML data-lang internal spaces',
    })
  }, 30000)
})

describe('public whitespace paths', () => {
  it.each([' php\n', '\u00a0php\u00a0'])('keeps data-lang whitespace rules for %j', (language) => {
    const result = htmlToCarve(`<pre data-lang="${language}"><code>x</code></pre>`)
    expect(result.value.includes('```php\n')).toBe(language === ' php\n')
  })

  it('denies a dangerous scheme padded with C0 controls', () => {
    expect(LinkPolicy.unrestricted().isUrlAllowed('\0 javascript:x \u001f')).toBe(false)
  })

  it.each(['heading', 'paragraph'] as const)('preserves internal spaces in a Markdown %s', (type) => {
    const value = `x${' '.repeat(128)}x`
    const ast: Document = { type: 'document', children: type === 'heading'
      ? [{ type, level: 1, children: [{ type: 'text', value }] }]
      : [{ type, children: [{ type: 'text', value }] }] }
    expect(renderMarkdown(ast)).toBe(`${type === 'heading' ? '# ' : ''}${value}\n`)
  })

  perfIt.each([
    ['verbatim spaces', '<pre><code>x', 'x\n</code></pre>', ' '],
    ['destination spaces', '<p><a href="x', 'x">label</a></p>', ' '],
    ['leading spans', '<p>', 'x</p>', '<span> </span>'],
    ['link leading spans', '<p><a href="u">', 'x</a></p>', '<span> </span>'],
  ])('imports %s in linear time', (label, prefix, suffix, repeated) => {
    expectScansLinearly((html) => void htmlToCarve(html), repeated, {
      prefix, suffix, smallRepeats: 4000, minSampleMs: 250, label,
    })
  }, 30000)

  perfIt.each(['heading', 'paragraph'] as const)('renders Markdown %s padding in linear time', (type) => {
    expectScansLinearly((value) => {
      const ast: Document = { type: 'document', children: type === 'heading'
        ? [{ type, level: 1, children: [{ type: 'text', value }] }]
        : [{ type, children: [{ type: 'text', value }] }] }
      renderMarkdown(ast)
    }, ' ', { prefix: 'x', suffix: 'x', smallRepeats: 16000, minSampleMs: 250, label: type })
  }, 30000)
})

describe('parser and migration whitespace scans', () => {
  it('preserves an internal space run in parsed paragraph text', () => {
    const source = `x${' '.repeat(128)}x\n`
    expect(carveToHtml(source)).toBe(`<p>${source.trimEnd()}</p>`)
  })

  it.each([['<x/>', '<x>'], ['<x/ >', '<x />'], ['<x a="b" />', '<x a="b">'], ['</x />', '</x>'], ['<!x />', '<!x>']])('normalizes tag endings in %s', (source, expected) => {
    expect(normalizeHtml(source).html).toBe(expected)
  })

  perfIt.each([
    ['parse', (source: string) => parse(source)],
    ['HTML', (source: string) => carveToHtml(source)],
    ['Markdown import', (source: string) => markdownToCarve(source)],
    ['Djot import', (source: string) => djotToCarve(source)],
  ])('scans internal spaces through %s in linear time', (label, run) => {
    expectScansLinearly((source) => void run(source), ' ', {
      prefix: 'x', suffix: 'x\n', smallRepeats: 4000, minSampleMs: 250, label,
    })
  }, 30000)
})

describe('whitespace in optional features', () => {
  perfIt('scans code without callout markers in linear time', () => {
    expectScansLinearly((source) => void carveToHtml(source, { extensions: [codeCallouts()] }), ' ', {
      prefix: '```\nx', suffix: 'x\n```\n', smallRepeats: 4000,
      minSampleMs: 250, label: 'code callout spaces',
    })
  }, 30000)

  perfIt('scans invalid container titles in linear time', () => {
    expectScansLinearly((source) => void lintCarve(source), ' ', {
      prefix: '::: note x', suffix: 'x\nbody\n:::\n', smallRepeats: 4000,
      minSampleMs: 250, label: 'container title spaces',
    })
  }, 30000)

  perfIt('rejects padded invalid Djot fence info in linear time', () => {
    expectScansLinearly((source) => void djotToCarve(source), ' ', {
      prefix: '```', suffix: '?\n', smallRepeats: 4000,
      minSampleMs: 250, label: 'Djot invalid fence info',
    })
  }, 30000)
})

perfIt.each(['\r', '\u2028', '\u2029'])('rejects invalid container title line endings %j in linear time', (ending) => {
  expectScansLinearly((source) => void lintCarve(source), ' ', {
    prefix: '::: note', suffix: `x${ending}\nbody\n:::\n`, smallRepeats: 4000,
    minSampleMs: 250, label: 'container title line ending',
  })
}, 30000)

perfIt('scans invalid fence attributes in linear time', () => {
  expectScansLinearly((source) => void lintCarve(source), ' ', {
    prefix: '```x', suffix: 'x\n', smallRepeats: 4000,
    minSampleMs: 250, label: 'invalid fence attributes',
  })
}, 30000)
