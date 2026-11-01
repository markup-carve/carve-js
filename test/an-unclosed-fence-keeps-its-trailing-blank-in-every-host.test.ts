import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A blank reaches every frame, so it is the open fence's content wherever the fence
// ends (corpus 291, markup-carve/carve#4033, markup-carve/carve#4047).
const code = (source: string): string | undefined => /<pre><code>([\s\S]*?)<\/code>/.exec(carveToHtml(source))?.[1]

describe('an unclosed fence keeps its trailing blank in every host', () => {
  it.each([
    ':: t\n: ```\n  code\n\nafter\n',
    ':: t\n: x\n\n  ```\n  code\n\nafter\n',
    'r[^1]\n\n[^1]: ```\n  code\n\nafter\n',
    'r[^1]\n\n[^1]: x\n\n  ```\n  code\n\nafter\n',
    '> :: t\n> : ```\n>   code\n>\nafter\n',
    '- :: t\n  : ```\n    code\n\nafter\n',
    '- a\n  :: t\n  : ```\n    code\n\nafter\n',
    'r[^1]\n\n- [^1]: ```\n    code\n\nafter\n',
    'r[^1]\n\n- a\n  [^1]: ```\n    code\n\nafter\n',
    'r[^1]\n\n:: t\n: [^1]: ```\n    code\n\nafter\n',
    'r[^1]\n\n[^1]: :: t\n  : ```\n    code\n\nafter\n',
    ':: t\n: - ```\n    code\n\nafter\n',
  ])('%j', (source) => {
    expect(code(source)).toBe('code\n\n')
    expect(carveToHtml(source)).toContain('<p>after</p>')
  })

  it('keeps a whitespace-only blank past the body column', () => {
    expect(code('r[^1]\n\n[^1]: ```\n  code\n   \nafter\n')).toBe('code\n \n')
  })

  it.each([
    ['a + attachment ends at the blank', 'see[^f]\n\n[^f]: n\n+\n```\na\n\nb\n', 'a\n'],
    ['a closed fence', ':: t\n: ```\n  code\n  ```\n\nafter\n', 'code\n'],
  ])('%s has no trailing blank', (_name, source, payload) => {
    expect(code(source)).toBe(payload)
  })
})
