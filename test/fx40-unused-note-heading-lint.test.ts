import { expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

const rules = (source: string): string[] => lintCarve(source).map(warning => warning.rule)

it('reports a collapsed reference to an unused footnote heading', () => {
  expect(rules('[^n]: # H\n\n[H][]\n')).toContain('unresolved-reference-link')
})

it('reports a cross-reference to an unused footnote heading', () => {
  expect(rules('[^n]: # H\n\n</#H>\n')).toContain('broken-crossref')
})

it('indexes the same heading once its note is rendered', () => {
  const source = '[^n]: # H\n\nSee[^n] [H][] </#H>\n'
  expect(rules(source)).not.toContain('unresolved-reference-link')
  expect(rules(source)).not.toContain('broken-crossref')
})
