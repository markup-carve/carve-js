import { describe, expect, it } from "vitest"
import { carveToHtml } from "../src/index.js"

// A payload line between a nested item's column and an authored fence base loses
// its prefix and stays payload (CARVE-P0-004, carve#3133), so the fence keeps
// running and holds the blank lines before the line that ends its item.
// Expected HTML is the layout checker's.
describe("a below-base payload line keeps a descendant fence open", () => {
  it("a line between the child column and the base keeps the trailing blanks", () => {
    const source = `- - # h
     \`\`\`
    b

tail
`
    expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <ul>
      <li>
        <h1 id="h">h</h1>
        <pre><code>b

</code></pre>
      </li>
    </ul>
  </li>
</ul>
<p>tail</p>`)
  })
  it("a run past the opener and a below-base marker line stay payload", () => {
    const source = `- - # h
     \`\`\`
      \`\`\`
    - \`\`\`


tail
`
    expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <ul>
      <li>
        <h1 id="h">h</h1>
        <pre><code> \`\`\`
- \`\`\`


</code></pre>
      </li>
    </ul>
  </li>
</ul>
<p>tail</p>`)
  })
  it("a band run still closes the fence", () => {
    const source = `- - # h
     \`\`\`
    b
    \`\`\`

tail
`
    expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <ul>
      <li>
        <h1 id="h">h</h1>
        <pre><code>b
</code></pre>
      </li>
    </ul>
  </li>
</ul>
<p>tail</p>`)
  })
  it("a line below the child column still ends the fence", () => {
    const source = `- - # h
     \`\`\`
    b
  c
`
    expect(carveToHtml(source)).toBe(`<ul>
  <li>
    <ul>
      <li>
        <h1 id="h">h</h1>
        <pre><code>b
</code></pre>
      </li>
    </ul>
    c
  </li>
</ul>`)
  })
})
