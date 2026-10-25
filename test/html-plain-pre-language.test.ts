import { expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'

it('reads a sole plain pre class as a code language after stronger hints', () => {
  for (const html of ['<pre class="python">x</pre>', '<pre class="python"><code>x</code></pre>']) {
    const result = htmlToCarve(html)
    expect(result.value).toContain('```python')
    expect(htmlToAst(html).value.children[0]).toMatchObject({ type: 'code_block', lang: 'python' })
  }
  expect(htmlToCarve('<pre class="python"><code class="language-js">x</code></pre>').value).toContain('```js')
  expect(htmlToCarve('<div class="highlight highlight-source-js"><pre class="prettyprint">x</pre></div>').value).toContain('```js')
  expect(htmlToAst('<pre class="python extra">x</pre>').value.children[0]).not.toHaveProperty('lang')
  expect(htmlToAst('<pre class="d">x</pre>').value.children[0]).not.toHaveProperty('lang')
  expect(htmlToAst('<pre class="mermaid">graph TD</pre>').value.children[0]).not.toHaveProperty('lang')
})
