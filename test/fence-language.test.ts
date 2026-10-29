import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

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
    // The bare closer line below is a valid opener of its own (carve#4018).
    const out = html('```js title="x"\ny\n```')
    expect(out).toBe('<p><code>js title="x"\ny</code></p>\n<pre><code></code></pre>')
  })

  it('rejects an inline `{...}` after the language (use a preceding line)', () => {
    expect(html('```php {.fancy}\ny\n```')).toBe('<p><code>php {.fancy}\ny</code></p>\n<pre><code></code></pre>')
  })

  it('accepts a bracketed [label] after the language; label is not in the class', () => {
    expect(html('```php [NPM]\nx\n```')).toBe(
      '<pre><code class="language-php">x\n</code></pre>',
    )
  })

  it('accepts a bare [label] (no language)', () => {
    expect(html('```[NPM]\nx\n```')).toBe('<pre><code>x\n</code></pre>')
  })

  it('exposes the label on the AST node (not in the language)', () => {
    const doc = parse('```php [NPM]\nx\n```')
    const cb = doc.children[0] as { type: string; lang?: string; label?: string }
    expect(cb.type).toBe('code_block')
    expect(cb.lang).toBe('php')
    expect(cb.label).toBe('NPM')
  })

  it('plain language still works', () => {
    expect(html('```js\nx\n```')).toContain('class="language-js"')
  })
})
