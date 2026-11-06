import { describe, expect, it } from 'vitest'
import { canonicalCarveWrite } from '../src/ast/canonical-carve-write.js'
import { parseDocument } from '../src/parse/parse-document.js'
import { readbackTree, renderCarve, renderCarveCandidate, withReadbackMemo } from '../src/render-carve.js'

const canonical = { canonicalTransparentLines: true }

const candidate = (source: string): string | null =>
  withReadbackMemo(source, () => renderCarveCandidate(parseDocument(source, {}), canonical, readbackTree(source)))

describe('canonical candidate whose narrowing cannot read back (carve-js#4427)', () => {
  // The canonical form escapes the `{~`, so every narrowed state parses to a different tree.
  const unreachable = '![a </#x]> b](u)\n\n{~alpha %% hidden~>word~} tail\n'

  it('is refused before the escape search', () => {
    expect(candidate(unreachable)).toBeNull()
  })

  it('leaves the formatter output unchanged', () => {
    expect(canonicalCarveWrite(unreachable)).toBe(unreachable)
  })

  it.each([
    '- a\n\n  %% n\n- b\n\n\\*x\\*\n',
    '{~alpha %% hidden~>word~} tail\n',
  ])('renders a reachable candidate in full for %j', (source) => {
    expect(candidate(source)).toBe(renderCarve(parseDocument(source, {}), canonical))
  })
})
