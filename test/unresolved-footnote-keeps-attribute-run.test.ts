import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToCarve, carveToHtml, carveToPlainText } from '../src/index.js'

describe('an unresolved footnote reference keeps its attribute run (carve#4816)', () => {
  it.each([
    ['x[^n]{.c} and [t][m]{.c}', '<p>x[^n]{.c} and [t][m]{.c}</p>'],
    ['x[^n]{a="<b>"}{.c}', '<p>x[^n]{a="&lt;b&gt;"}{.c}</p>'],
    ['# H[^n]{.c}', '<section id="H">\n  <h1>H[^n]{.c}</h1>\n</section>'],
    ['| a[^n]{.c} |', '<table>\n  <tbody>\n    <tr><td>a[^n]{.c}</td></tr>\n  </tbody>\n</table>'],
    ['[a[^n]{.c}](/u)', '<p><a href="/u">a[^n]{.c}</a></p>'],
  ])('renders %j with the run as text', (input, html) => {
    expect(carveToHtml(`${input}\n`).trim()).toBe(html)
  })

  it('still takes the run as attributes on a resolved reference', () => {
    expect(carveToHtml('x[^n]{.c}\n\n[^n]: body\n')).toContain('role="doc-noteref" class="c"')
  })

  it('keeps the run in the text targets', () => {
    expect(carveToPlainText('x[^n]{.c}\n')).toBe('x[^n]{.c}\n')
    expect(carveToAnsi('x[^n]{.c}\n')).toBe('x[^n]{.c}\n')
  })

  it('writes the run back as typed, so formatting keeps the text', () => {
    expect(carveToCarve('x[^n]{a="<b>"}{.c}\n')).toBe('x[^n]{a="<b>"}{.c}\n')
    // A table-cell hard break makes the writer copy the tree first.
    expect(carveToCarve('x[^n]{.a}{.b}\n\n| a\\ | b |\n')).toBe('x[^n]{.a}{.b}\n\n| a\\ | b |\n')
  })
})
