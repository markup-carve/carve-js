import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-056 C2-B-059 list continuation', () => {
  const cases: [string, string][] = [
    ['smallest list quote item', '- > +\n'],
    ['star list quote item', '* > +\n'],
    ['table rows after a continuation', ['- +', '| a | b |', '| c | d |', '- next', ''].join('\n')],
    ['second table row after a continuation', ['- +', '| x | y |', '| z | w |', '- next', ''].join('\n')],
    ['fence after a list continuation', ['- +', '```', 'a', '```', 'tail', ''].join('\n')],
    ['named div after a list continuation', ['- +', '::: note', 'inside', ':::', 'tail', ''].join('\n')],
    ['nested anonymous div after a list continuation', ['- d', '  - +', '  :::', '  in', 'after', ''].join('\n')],
    ['numbered child item with a fence', ['- foo', '  1. +', '  ```', '  x', '  ```', ''].join('\n')],
    ['numbered child item followed by an outer fence', ['- foo', '  1. +', '    ```', '    x', '    ```', ''].join('\n')],
    ['comment before a continued heading', ['- +', '{% c %}', '# H', ''].join('\n')],
    ['task item before a continued sibling', ['- foo', '  - [ ] task', '  +', '  - x', ''].join('\n')],
    ['attribute before continued item text', ['- +', '  {x}', 'text', ''].join('\n')],
    ['percent comment before continued item text', ['- +', '  %%%', '  c', '  %%%', 'text', ''].join('\n')],
  ]
  for (const [name, source] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-122')
    })
  }
})
