import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 and CARVE-P2-017: a line that opens nothing folds lazily into the open
// description paragraph, so a later block at the description column stays in the dd.
const cases = [
  {
    name: 'unclosed run then lazy line',
    source: `- :: t
  : p
    \`\`\`
  x
    :::
    d
    :::
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p
<code>
x</code></p>
        <div>
          <p>d</p>
        </div>
      </dd>
    </dl>
  </li>
</ul>`,
  },
  {
    name: 'lazy line then div',
    source: `- :: t
  : p
  x
    :::
    d
    :::
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p
x</p>
        <div>
          <p>d</p>
        </div>
      </dd>
    </dl>
  </li>
</ul>`,
  },
  {
    name: 'lazy line then quote',
    source: `- :: t
  : p
  x
    > q
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p
x</p>
        <blockquote><p>q</p></blockquote>
      </dd>
    </dl>
  </li>
</ul>`,
  },
  {
    name: 'lazy line between the base and the column',
    source: `- :: t
  : p
   x
    > q
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p
x</p>
        <blockquote><p>q</p></blockquote>
      </dd>
    </dl>
  </li>
</ul>`,
  },
  {
    name: 'ordered item',
    source: `1. :: t
   : p
   x
     ::: n
     d
     :::
`,
    html: `<ol>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p
x</p>
        <div class="n">
          <p>d</p>
        </div>
      </dd>
    </dl>
  </li>
</ol>`,
  },
  {
    name: 'control: blank before the line',
    source: `- :: t
  : p

  x
    > q
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>p</dd>
    </dl>
    <p>x</p>
    <blockquote><p>q</p></blockquote>
  </li>
</ul>`,
  },
  {
    name: 'control: closed fence before the line',
    source: `- :: t
  : p
    \`\`\`
    c
    \`\`\`
  x
    > q
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p</p>
        <pre><code>c
</code></pre>
      </dd>
    </dl>
    x
    <blockquote><p>q</p></blockquote>
  </li>
</ul>`,
  },
  {
    name: 'control: no lazy line',
    source: `- :: t
  : p
    \`\`\`
    :::
    d
    :::
`,
    html: `<ul>
  <li>
    <dl>
      <dt>t</dt>
      <dd>
        <p>p
<code></code></p>
        <div>
          <p>d</p>
        </div>
      </dd>
    </dl>
  </li>
</ul>`,
  },
]

it.each(cases)('$name', ({ source, html }) => {
  expect(carveToHtml(source).trim()).toBe(html)
})
