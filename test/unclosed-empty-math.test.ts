import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('unclosed empty math spans', () => {
  it.each(['$`', '$`\n', '$`\r'])('parses inline math from %j', source => {
    expect(carveToHtml(source)).toBe('<p><span class="math inline" role="math">\\(\\)</span></p>')
  })

  it('parses display math with no content', () => {
    expect(carveToHtml('$$`')).toBe('<p><span class="math display" role="math">\\[\\]</span></p>')
  })

  it('still preserves content in an unclosed span', () => {
    expect(carveToHtml('$`x')).toBe('<p><span class="math inline" role="math">\\(x\\)</span></p>')
  })
})
