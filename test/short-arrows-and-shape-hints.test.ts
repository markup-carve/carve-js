import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

describe('removed single-hyphen arrows (carve#4815)', () => {
  it('keeps short arrows as text and the doubled forms as glyphs', () => {
    expect(html('a<-b, a->b, a<->b; <-- --> <-->, x != y\n'))
      .toBe('<p>a&lt;-b, a-&gt;b, a&lt;-&gt;b; ← → ↔, x ≠ y</p>')
  })
})

describe('comment and glob shape hints (carve#4815)', () => {
  it.each([
    ['/* foo */\n', 'comment-shaped-emphasis'],
    ['*.js,*.ts\n', 'glob-shaped-strong'],
  ])('reports %s', (source, rule) => {
    expect(lintCarve(source).filter(w => w.rule === rule))
      .toMatchObject([{ line: 1, column: 1, severity: 'Hint' }])
  })

  it.each(['`/* foo */`\n', '\\/* foo */\n', '`*.js,*.ts`\n', '\\*.js,*.ts\n'])
    ('keeps verbatim or escaped input quiet: %s', source => {
      expect(lintCarve(source).filter(w => w.rule === 'comment-shaped-emphasis' || w.rule === 'glob-shaped-strong'))
        .toEqual([])
    })

  it('reports a parsed shape at its column inside a quote', () => {
    expect(lintCarve('> /* foo */\n').filter(w => w.rule === 'comment-shaped-emphasis'))
      .toMatchObject([{ line: 1, column: 3, severity: 'Hint' }])
  })
})
