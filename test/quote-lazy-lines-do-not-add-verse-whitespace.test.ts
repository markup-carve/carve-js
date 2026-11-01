import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('quote-lazy lines in verse', () => {
  it('drops the quote frame space before expanding verse whitespace', () => {
    const source = ':::\n> ::: |\n> ```\n > x\n after\n'
    expect(carveToHtml(source).trim()).toBe(`<div>
  <blockquote>
    <div class="line-block">
      <p><code>
x
after</code></p>
    </div>
  </blockquote>
</div>`)
  })

  it('drops a quote frame tab while retaining explicit verse lines', () => {
    const source = '> ::: |\n > ```\n> ```\n\t> x\n\tafter\n'
    expect(carveToHtml(source).trim()).toBe(`<blockquote>
  <div class="line-block">
    <p><code>
</code><br>
x<br>
after</p>
  </div>
</blockquote>`)
  })
})
