import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('list blocks whose leading tab crosses the item column', () => {
  it('ends the item after a table row before a flush-left follower', () => {
    const html = carveToHtml('- a\n\t|x|\n+ c')
    expect(html).toContain('</ul>\n<p>+ c</p>')
  })

  it.each(['|x|', '|a|b|', '# h'])('closes the item paragraph after %s', block => {
    const html = carveToHtml(`- a\n\t${block}\n+ c`)
    expect(html).toContain('</ul>\n<p>+ c</p>')
  })

  it('keeps a plain line in the item paragraph', () => {
    expect(carveToHtml('- a\n\tword\nmore')).toContain('word\nmore</li>')
  })
})
