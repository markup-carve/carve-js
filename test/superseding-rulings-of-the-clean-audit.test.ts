import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const html = (source: string) => carveToHtml(source).trim().replace(/\n\s*/g, '\n')

describe('a braced comment counts as nothing for every flank test (carve#4719)', () => {
  it.each([
    ['{%%}--x\n', '<p>--x</p>'],
    ['--{%%}x\n', '<p>--x</p>'],
    ['"{%%}--x\n', '<p>“--x</p>'],
    ['a{%%}*b*\n', '<p>a*b*</p>'],
    ['*b*{%%}a\n', '<p>*b*a</p>'],
    ['a{% c %}{%%}/b/\n', '<p>a/b/</p>'],
    ['_{%%}*x*\n', '<p>_<strong>x</strong></p>'],
    ['{%%}*x*\n', '<p><strong>x</strong></p>'],
    ['"a-"{%%}\n', '<p>“a-”</p>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('keeps a code span that holds an opener out of the comment scan', () => {
    expect(html('`{%` *x* %}*b*\n')).toBe('<p><code>{%</code> <strong>x</strong> %}<strong>b</strong></p>')
  })
})

describe('an arrow needs its exact hyphen run (carve#4645)', () => {
  it.each([
    ['a<---b\n', '<p>a&lt;—b</p>'],
    ['<--->\n', '<p>&lt;—&gt;</p>'],
    ['a<--b\n', '<p>a←b</p>'],
    ['<-->\n', '<p>↔</p>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('an extension closes at bracket depth zero (carve#4513)', () => {
  it.each([
    [':foo[[x](u) y]\n', '<p><span class="ext-foo"><a href="u">x</a> y</span></p>'],
    [':foo[a]b]\n', '<p><span class="ext-foo">a</span>b]</p>'],
    [':foo[a[b]\n', '<p><span class="ext-foo">a[b</span></p>'],
    [':foo[a\\]b]\n', '<p><span class="ext-foo">a]b</span></p>'],
    [':foo[a\n', '<p>:foo[a</p>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('a marker between an item\'s columns reads as at its marker column (carve#4545)', () => {
  it.each([
    ['- a\n * b\n', '<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>'],
    ['- a\n - b\n', '<ul>\n<li>a</li>\n<li>b</li>\n</ul>'],
    ['1. a\n a.  b\n', '<ol>\n<li>a</li>\n</ol>\n<ol type="a">\n<li>b</li>\n</ol>'],
    [':: t\n: - para\n - li\n', '<dl>\n<dt>t</dt>\n<dd>\n<ul>\n<li>para\n- li</li>\n</ul>\n</dd>\n</dl>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('lint rulings (carve#4834, carve#4835)', () => {
  const rules = (source: string) => lintCarve(source).map((w) => `${w.line}:${w.column} ${w.rule}`)

  it('retires fence-delimiter-indentation', () => {
    expect(rules('  ```\n  x\n  ```\n')).toEqual(['1:3 block-opener-overindented'])
    expect(rules('[^a]: x\n   ```js x\n')).not.toContain('2:4 fence-delimiter-indentation')
  })

  it('reports each same-kind sibling below the content column', () => {
    expect(rules('- Rechnung\n - Entwurf\n - Final\n- Mahnung\n')).toEqual([
      '2:2 list-marker-below-content-column',
      '3:2 list-marker-below-content-column',
    ])
    expect(lintCarve('1. a\n\n 2. b\n')[0]!.message).toContain('after a blank line')
    expect(lintCarve('1. a\n\n 2. b\n')[0]!.message).toContain('sibling item')
  })
})
