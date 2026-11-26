import { describe, expect, it } from 'vitest'
import { render, renderWithDiagnostics } from '../src/api.ts'
import { denseListHtml } from '../src/fast-dense-list.ts'

describe('dense dash list render', () => {
  it('writes a nested list with the same bytes as the tree path', () => {
    const source = '- first alpha *bold* `code`\n  - nested one\n  - nested two\n- second beta\n'
    expect(denseListHtml(source)).toBe(renderWithDiagnostics(source).html)
    expect(render(source)).toBe(renderWithDiagnostics(source).html)
  })

  it('leaves ambiguous list shapes to the full tree path', () => {
    for (const source of ['- first\n\n- second\n', '- first\n   - shifted\n',
      '- first [link](/url)\n', '- first\n+\n> quote\n', '- *a**b*\n', '- `a``b`\n']) {
      expect(denseListHtml(source)).toBeUndefined()
      expect(render(source)).toBe(renderWithDiagnostics(source).html)
    }
  })
})
