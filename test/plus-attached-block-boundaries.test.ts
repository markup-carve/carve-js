import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Layout whitespace between tags and around bare item text is not under test.
const norm = (out: string): string => out.replace(/\s*\n\s*</g, '<').replace(/>\n\s*/g, '>').trim()
const html = (src: string): string => norm(carveToHtml(src))

describe('a block attached by a continuation marker ends at its boundary', () => {
  it('closes the item after a heading below a refused plus (#3968)', () => {
    expect(html('- +\n  # H\ntail\n')).toBe('<ul><li>+<h1 id="H">H</h1></li></ul><p>tail</p>')
    expect(html('- +\n  ```\n  c\n  ```\ntail\n')).toBe('<ul><li>+<pre><code>c</code></pre></li></ul><p>tail</p>')
  })

  it('keeps the item body at its content column below a refused plus', () => {
    expect(html('- +\n  # H\n  tail\n')).toBe('<ul><li>+<h1 id="H">H</h1>tail</li></ul>')
    expect(html('- +\n  para\n  - sub\n')).toBe('<ul><li>+\npara<ul><li>sub</li></ul></li></ul>')
  })

  it('still folds a lazy line into a refused plus paragraph', () => {
    expect(html('- +\n  para\ntail\n')).toBe('<ul><li>+\npara\ntail</li></ul>')
  })

  it('keeps a nested attached fence payload indented past its opener (#3970)', () => {
    expect(html('- a\n  - b\n    - c\n    +\n    ```\n      code\n    ```\n')).toContain('<pre><code>  code</code></pre>')
    expect(html('> - a\n>   - b\n>   +\n>   ```\n>     code\n>   ```\n')).toContain('<pre><code>  code</code></pre>')
    expect(html('- foo\n  - +\n    ```\n      c\n    ```\n')).toContain('<pre><code>  c</code></pre>')
  })

  it('refuses lone markers whose follower stands left of them (#3971)', () => {
    expect(html('   - q\n   +\n   +\n%% c\n')).toBe('<ul><li>q\n    +</li></ul>')
    expect(html('   - q\n   +\n%% c\n')).toBe('<ul><li>q\n+</li></ul>')
    expect(html('   - q\n   +\n   > x\n')).toBe('<ul><li>q<blockquote><p>x</p></blockquote></li></ul>')
  })

  it('does not read the quote separator as fence payload (#3972)', () => {
    expect(carveToHtml('> +\n``` x\ny\n')).toContain('<pre><code class="language-x">y\n</code></pre>')
    expect(html('> +\n``` x\n')).toBe('<blockquote><pre><code class="language-x"></code></pre></blockquote>')
  })

  it('folds a list line into a quoted note refused plus (#3973)', () => {
    const out = html('> [^b]: +\n- after\n\nr[^b]\n')
    expect(out.startsWith('<blockquote></blockquote><p>r')).toBe(true)
    expect(out).toContain('<p>+\n- after<a href="#fnref1"')
  })
})
