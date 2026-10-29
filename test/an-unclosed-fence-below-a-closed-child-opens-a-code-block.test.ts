import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 2 "A CLOSER IS REQUIRED" and CARVE-P0-009: a child that leaves no paragraph
// open lets a fence below its column leave it. The fence opens a code block that
// runs to the end of the box; a box closer inside it is payload (carve#4018).
const cases = [
  {
    name: 'source 2 from carve#3046',
    source: `> 1. ::: box
>    - ::: |
>      \`\`\`
>      x
>      \`\`\`
>      :::
>     \`\`\`
>     - x
> \`\`\`
`,
    html: `<blockquote>
  <ol>
    <li>
      <div class="box">
        <ul>
          <li>
            <div class="line-block">
              <p><code>
x
</code></p>
            </div>
          </li>
        </ul>
        <pre><code>- x
</code></pre>
      </div>
    </li>
  </ol>
  <pre><code></code></pre>
</blockquote>`,
  },
  {
    name: 'a closed line block in a list item',
    source: `- ::: box
  - ::: |
    x
    :::
   \`\`\`
   - x
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>
          <div class="line-block">
            <p>x</p>
          </div>
        </li>
      </ul>
      <pre><code>- x
</code></pre>
    </div>
  </li>
</ul>`,
  },
  {
    name: 'an ordered item',
    source: `1. ::: box
   - ::: |
     x
     :::
    \`\`\`
    - x
`,
    html: `<ol>
  <li>
    <div class="box">
      <ul>
        <li>
          <div class="line-block">
            <p>x</p>
          </div>
        </li>
      </ul>
      <pre><code>- x
</code></pre>
    </div>
  </li>
</ol>`,
  },
  {
    name: 'text after the fence',
    source: `- ::: box
  - ::: |
    x
    :::
   \`\`\`
   y
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>
          <div class="line-block">
            <p>x</p>
          </div>
        </li>
      </ul>
      <pre><code>y
</code></pre>
    </div>
  </li>
</ul>`,
  },
  {
    name: 'nothing after the fence',
    source: `- ::: box
  - ::: |
    x
    :::
   \`\`\`
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>
          <div class="line-block">
            <p>x</p>
          </div>
        </li>
      </ul>
      <pre><code></code></pre>
    </div>
  </li>
</ul>`,
  },
  {
    name: 'a closed code child',
    source: `- ::: box
  - \`\`\`
    x
    \`\`\`
   \`\`\`
   - x
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>
          <pre><code>x
</code></pre>
        </li>
      </ul>
      <pre><code>- x
</code></pre>
    </div>
  </li>
</ul>`,
  },
  {
    name: 'a box closer ahead is payload',
    source: `- ::: box
  - ::: |
    x
    :::
   \`\`\`
  :::
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>
          <div class="line-block">
            <p>x</p>
          </div>
        </li>
      </ul>
      <pre><code>:::
</code></pre>
    </div>
  </li>
</ul>`,
  },
  {
    name: 'a box closer ahead after text is payload',
    source: `- ::: box
  - ::: |
    x
    :::
   \`\`\`
   - x
  :::
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>
          <div class="line-block">
            <p>x</p>
          </div>
        </li>
      </ul>
      <pre><code>- x
:::
</code></pre>
    </div>
  </li>
</ul>`,
  },
  {
    name: 'an open paragraph in the child does not take the fence',
    source: `- ::: box
  - x
   \`\`\`
  :::
`,
    html: `<ul>
  <li>
    <div class="box">
      <ul>
        <li>x</li>
      </ul>
      <pre><code>:::
</code></pre>
    </div>
  </li>
</ul>`,
  },
]

it.each(cases)('$name', ({ source, html }) => {
  expect(carveToHtml(source).trim()).toBe(html)
})
