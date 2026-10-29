import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it("ignores a closer below the description column", () => {
  const source = `- :: term
  : payload
    \`\`\`
    code
  \`\`\`
after
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <dl>
      <dt>term</dt>
      <dd>
        <p>payload</p>
        <pre><code>code
</code></pre>
      </dd>
    </dl>
    <pre><code></code></pre>
  </li>
</ul>
<p>after</p>`)
})

it("closes an overindented opener at the description column", () => {
  const source = `- :: term
  : payload
     \`\`\`
     code
    \`\`\`
after
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <dl>
      <dt>term</dt>
      <dd>
        <p>payload</p>
        <pre><code>code
</code></pre>
      </dd>
    </dl>
  </li>
</ul>
<p>after</p>`)
})

it("uses the description column in an ordered item", () => {
  const source = `1. :: term
   : payload
      \`\`\`
      code
     \`\`\`
after
`
  expect(carveToHtml(source)).toBe(`<ol>
  <li>
    <dl>
      <dt>term</dt>
      <dd>
        <p>payload</p>
        <pre><code>code
</code></pre>
      </dd>
    </dl>
  </li>
</ol>
<p>after</p>`)
})

it("ends an ordered host after a fence at its retained column", () => {
  const source = `1. :: term
   : payload
     \`\`\`
     code
  \`\`\`
after
`
  expect(carveToHtml(source)).toBe(`<ol>
  <li>
    <dl>
      <dt>term</dt>
      <dd>
        <p>payload</p>
        <pre><code>code
</code></pre>
      </dd>
    </dl>
  </li>
</ol>
<pre><code>after
</code></pre>`)
})

it("uses the description column in a quoted item", () => {
  const source = `> - :: term
>   : payload
>      \`\`\`
>      code
>     \`\`\`
> after
`
  expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>
      <dl>
        <dt>term</dt>
        <dd>
          <p>payload</p>
          <pre><code>code
</code></pre>
        </dd>
      </dl>
    </li>
  </ul>
  <p>after</p>
</blockquote>`)
})

it("opens an unmatched opener as a code block in a quoted item", () => {
  const source = `> - :: term
>   : payload
>     \`\`\`
>     code
>   \`\`\`
> after
`
  expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>
      <dl>
        <dt>term</dt>
        <dd>
          <p>payload</p>
          <pre><code>code
</code></pre>
        </dd>
      </dl>
      <pre><code></code></pre>
    </li>
  </ul>
  <p>after</p>
</blockquote>`)
})

it("retains marker text after unmatched description fences", () => {
  const source = `- :: term
  : payload
    \`\`\`
  \`\`\`
     \`\`\`
  - nested
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <dl>
      <dt>term</dt>
      <dd>
        <p>payload</p>
        <pre><code></code></pre>
      </dd>
    </dl>
    <pre><code>   \`\`\`
- nested
</code></pre>
  </li>
</ul>`)
})

const markerFenceSource = '- :: term\n  : payload\n    ```\n    - child\n```\nafter\n'

it.each([
  markerFenceSource,
  markerFenceSource.replace('- :: term', '1. :: term').replace('  : payload', '   : payload').replaceAll('    ', '     '),
  markerFenceSource.split('\n').slice(0, -1).map(line => `> ${line}`).join('\n') + '\n',
])('round trips a description fence containing a list marker: %s', source => {
  const formatted = carveToCarve(source)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
