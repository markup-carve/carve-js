import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('fenced code language tags with punctuation', () => {
  it('accepts c++ as a code-block language', () => {
    expect(html('```c++\nint main(){}\n```')).toBe(
      '<pre><code class="language-c++">int main(){}\n</code></pre>',
    )
  })

  it('accepts c# as a code-block language', () => {
    expect(html('```c#\nvar x = 1;\n```')).toContain('class="language-c#"')
  })

  it('accepts a dotted language like asp.net', () => {
    expect(html('```asp.net\nx\n```')).toContain('class="language-asp.net"')
  })

  it('still rejects a multiword info string (stays an inline code span)', () => {
    const out = html('```js title="x"\ny\n```')
    expect(out).not.toContain('<pre')
  })

  it('plain language still works', () => {
    expect(html('```js\nx\n```')).toContain('class="language-js"')
  })
})
