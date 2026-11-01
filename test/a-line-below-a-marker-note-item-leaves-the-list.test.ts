import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The fence interrupts the note's paragraph, so the line below it leaves the list (carve#4018).
it("ends an unclosed note fence at the line below it", () => {
  const source = `- [^n]: text
    more
    \`\`\`
    code
after [^n]
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li></li>
</ul>
<p>after <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>text
more</p>
      <pre><code>code
</code></pre>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})

it("keeps the line in the nested note list after a closed fence", () => {
  const source = `- [^a]: text
    - child
    [^b]: inner
      - c2
      ~~~
      one
      ~~~
      - next
below

[^a] [^b]
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li></li>
</ul>
<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>text
- child<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
    <li id="fn2">
      <p>inner
- c2</p>
      <pre><code>one
</code></pre>
      <ul>
        <li>next
below</li>
      </ul>
      <p><a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})

it("keeps the following nested item in the outer note after its fence closes", () => {
  const source = `- [^a]: text
    more
    [^b]: inner
      - c2
      ~~~
      code
      ~~~
    - sub
      ~~~
      x
      ~~~
below

[^a] [^b]
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li></li>
</ul>
<p>below</p>
<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>text
more</p>
      <ul>
        <li>sub
          <pre><code>x
</code></pre>
        </li>
      </ul>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
    <li id="fn2">
      <p>inner
- c2</p>
      <pre><code>code
</code></pre>
      <p><a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})

it("leaves a comment-led note and its closed fence", () => {
  const source = `- [^n]: text
    %% c
    more
     \`\`\`
     code
     \`\`\`
after [^n]
`
  expect(carveToHtml(source)).toBe(`<ul>
  <li></li>
</ul>
<p>after <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>text</p>
      <p>more</p>
      <pre><code>code
</code></pre>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})

it("starts the following paragraph at quote level", () => {
  const source = `> - [^n]: text
>     %% c
>     more
>      ~~~
>      code
>      ~~~
> after [^n]
`
  expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li></li>
  </ul>
  <p>after <a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
</blockquote>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>text</p>
      <p>more</p>
      <pre><code>code
</code></pre>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
})
