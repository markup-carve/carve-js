import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string): string => html.replace(/\n\s*/g, '')

describe('container ownership regressions', () => {
  it('keeps a captioned math block after a blank in a loose item', () => {
    const html = carveToHtml('- host\n\n  $$`x\n  ^ p\n')
    expect(html).toContain('<li><p>host</p>')
    expect(html).toContain('<figcaption>p</figcaption>')
  })

  it('places a table before a nested item content column beside that item', () => {
    for (const opener of [':::', '::: note', '::: tip']) {
      const html = compact(carveToHtml(`- ${opener}\n   - t0\n    ||\n`))
      expect(html).toContain('</li></ul>')
      expect(html).toContain('<table>')
      expect(html).not.toContain('t0||')
    }
  })

  it('classifies consecutive plus markers in a quoted lazy description', () => {
    expect(compact(carveToHtml('> :: t0\n> : f\n> l\n> +\n> +\n> after\n>\n'))).toContain(
      '<dd><p>fl</p><p>after</p></dd>',
    )
  })

  it('keeps a refused second plus inside its first-block item', () => {
    expect(compact(carveToHtml(':::\n- +\n+\n- next\n:::\n'))).toBe(
      '<div><ul><li>+</li><li>next</li></ul></div>',
    )
  })

  it('folds a marker-column description line into its nested term', () => {
    expect(compact(carveToHtml('- - :: t0\n  : a0\n'))).toContain('<dt>t0: a0</dt>')
    expect(compact(carveToHtml('- :: t\n  : a\n'))).toContain('<dt>t</dt><dd>a</dd>')
    expect(compact(carveToHtml(' - 1. :: t\n   : a\n'))).toContain('<dt>t: a</dt>')
    expect(compact(carveToHtml('> - 1. :: t\n>   : a\n'))).not.toContain('<dt>t: a</dt>')
  })


})

describe('quote content', () => {
  it.each(['\u2028', '\u2029'])('preserves %s as quote content', (separator) => {
    expect(carveToHtml(`> ${separator}\n`)).toBe(`<blockquote><p>${separator}</p></blockquote>`)
  })
})
