import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

describe('carve#6601: a paragraph of comments and a hard break that no comment line takes', () => {
  it('C2-H-019, C2-H-069: a braced comment line, then a hard break', () => {
    expect(render('{%%}\n\\\n')).toBe('<p><br>\n</p>')
  })

  it('C2-H-019, C2-H-069: two hard breaks, then a comment line', () => {
    expect(render('\\\n\\\n%%\n')).toBe('<p><br>\n</p>')
  })

  it('C2-H-019: breaks between comments, or taken by a comment line, still render nothing', () => {
    expect(render('{%%}\n{%%}\n')).toBe('')
    expect(render('{%%}\\\n{%%}\n')).toBe('')
    expect(render('\\\n%%\n')).toBe('')
  })
})
