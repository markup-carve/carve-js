import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an unmarked quote marker in the quoted description paragraph', () => {
  expect(carveToHtml('>\n> :: m\n> : l\n  >\n')).toBe(`<blockquote>
  <dl>
    <dt>m</dt>
    <dd>l
&gt;</dd>
  </dl>
</blockquote>`)
})

it('keeps an unmarked table row in the quoted description paragraph', () => {
  expect(carveToHtml('>\n> :: m\n> : l\n  ||\n')).toBe(`<blockquote>
  <dl>
    <dt>m</dt>
    <dd>l
||</dd>
  </dl>
</blockquote>`)
})

it('folds a quote opener below the quoted description column', () => {
  expect(carveToHtml('- a\n  > quote\n  > :: term\n  > :  detail\n  >   > quote\n\tq\n\n- item\n')).toBe(`<ul>
  <li><p>a</p>
    <blockquote>
      <p>quote</p>
      <dl>
        <dt>term</dt>
        <dd>detail
&gt; quote
q</dd>
      </dl>
    </blockquote>
  </li>
  <li><p>item</p></li>
</ul>`)
})

it('opens an authored quote after folded list markers in an unquoted description', () => {
  expect(carveToHtml(':: m\n: l\n. d\n  * k\n    >\n')).toBe(`<dl>
  <dt>m</dt>
  <dd>
    <p>l
. d
* k</p>
    <blockquote>

    </blockquote>
  </dd>
</dl>`)
})

it('leaves a marked fence at its host column', () => {
  expect(carveToHtml('> :: m\n> : l\n>  ```\n> ```\n')).toBe(`<blockquote>
  <dl>
    <dt>m</dt>
    <dd>l</dd>
  </dl>
  <p><code>
</code></p>
</blockquote>`)
})

it('lets an open inline code run finish before classifying a quote opener', () => {
  expect(carveToHtml('> - :: a\n>   :: b\n>   : p\n>     ```\n>    > ```\n')).toBe(`<blockquote>
  <ul>
    <li>
      <dl>
        <dt>a</dt>
        <dt>b</dt>
        <dd>p
<code></code></dd>
      </dl>
      <blockquote>
        <pre><code></code></pre>
      </blockquote>
    </li>
  </ul>
</blockquote>`)
})
