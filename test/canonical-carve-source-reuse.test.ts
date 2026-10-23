import { describe, expect, it } from 'vitest'
import type { Document } from '../src/ast.js'
import { canonicalCarveWrite } from '../src/ast/canonical-carve-write.js'

describe('canonical source reuse', () => {
  it.each([
    '> A *quoted* line\n> Another line\n',
    '- One **item**\n- Two [linked](https://example.com) items\n',
    '![Alt](image.png)\n',
    '[empty][]\n\n[empty]: /target\n',
  ])('matches the checked writer for %s', source => {
    expect(canonicalCarveWrite(source, {}, undefined, source)).toBe(canonicalCarveWrite(source))
  })

  it('uses the checked writer when a transform changes the parsed tree', () => {
    const source = '> Before\n'
    const change = (document: Document) => {
      document.children = []
      return true
    }
    expect(canonicalCarveWrite(source, {}, change, source)).toBe(canonicalCarveWrite(source, {}, change))
  })
})
