import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps content-column payload and leaves a flush-left tail outside the description', () => {
  const source = [':: t', ': - ``` x', '    x', 'tail'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<dl>', '  <dt>t</dt>', '  <dd>', '    <ul>', '      <li>',
    '        <pre><code class="language-x">x', '</code></pre>',
    '      </li>', '    </ul>', '  </dd>', '</dl>', '<p>tail</p>',
  ].join('\n'))
})

it('leaves an unprefixed tail outside a nested list marker fence', () => {
  const source = ['- - ```', 'tail'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<ul>', '  <li>', '    <ul>', '      <li>',
    '        <pre><code></code></pre>', '      </li>', '    </ul>',
    '  </li>', '</ul>', '<p>tail</p>',
  ].join('\n'))
})

it('continues the outer-item paragraph after a three-level fence ends', () => {
  const source = ['- - - ```', '  tail', 'tail'].join('\n')
  expect(carveToHtml(source)).toBe([
    '<ul>', '  <li>', '    <ul>', '      <li>', '        <ul>', '          <li>',
    '            <pre><code></code></pre>', '          </li>', '        </ul>',
    '      </li>', '    </ul>', '    tail', 'tail', '  </li>', '</ul>',
  ].join('\n'))
})

it('keeps payload that supplies the enclosing item prefix', () => {
  const source = ['- - ```', '    x'].join('\n')
  expect(carveToHtml(source)).toContain('<pre><code>x</code></pre>')
})

it('keeps a terminated nested marker fence and its payload', () => {
  const source = [':: t', ': - ```', '    x', '    ```', 'tail'].join('\n')
  expect(carveToHtml(source)).toContain('<pre><code>x\n</code></pre>')
  expect(carveToHtml(source)).toContain('</dl>\n<p>tail</p>')
})

it("keeps the outer body fence after - - ```", () => {
  const source = [
    "- - ```",
    "  ```",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <pre><code></code></pre>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("keeps the outer body fence after - - - ```", () => {
  const source = [
    "- - - ```",
    "  ```",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code></code></pre>",
    "          </li>",
    "        </ul>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("ends the nested description fence before host text with ```", () => {
  const source = [
    ":: t",
    ": - ```",
    "  x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<dl>",
    "  <dt>t</dt>",
    "  <dd>",
    "    <ul>",
    "      <li>",
    "        <pre><code></code></pre>",
    "      </li>",
    "    </ul>",
    "    <p>x</p>",
    "  </dd>",
    "</dl>",
    "<p>tail</p>",
  ].join('\n'))
})

it("ends the deepest fence before middle item text with ```", () => {
  const source = [
    "- - - ```",
    "    x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code></code></pre>",
    "          </li>",
    "        </ul>",
    "        x",
    "      </li>",
    "    </ul>",
    "  </li>",
    "</ul>",
    "<p>tail</p>",
  ].join('\n'))
})

it("keeps the outer body fence after - - ~~~", () => {
  const source = [
    "- - ~~~",
    "  ~~~",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <pre><code></code></pre>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("keeps the outer body fence after - - - ~~~", () => {
  const source = [
    "- - - ~~~",
    "  ~~~",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code></code></pre>",
    "          </li>",
    "        </ul>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("ends the nested description fence before host text with ~~~", () => {
  const source = [
    ":: t",
    ": - ~~~",
    "  x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<dl>",
    "  <dt>t</dt>",
    "  <dd>",
    "    <ul>",
    "      <li>",
    "        <pre><code></code></pre>",
    "      </li>",
    "    </ul>",
    "    <p>x</p>",
    "  </dd>",
    "</dl>",
    "<p>tail</p>",
  ].join('\n'))
})

it("ends the deepest fence before middle item text with ~~~", () => {
  const source = [
    "- - - ~~~",
    "    x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code></code></pre>",
    "          </li>",
    "        </ul>",
    "        x",
    "      </li>",
    "    </ul>",
    "  </li>",
    "</ul>",
    "<p>tail</p>",
  ].join('\n'))
})

it("keeps the outer body fence after - - ``` x", () => {
  const source = [
    "- - ``` x",
    "  ```",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <pre><code class=\"language-x\"></code></pre>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("keeps the outer body fence after - - - ``` x", () => {
  const source = [
    "- - - ``` x",
    "  ```",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code class=\"language-x\"></code></pre>",
    "          </li>",
    "        </ul>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("ends the nested description fence before host text with ``` x", () => {
  const source = [
    ":: t",
    ": - ``` x",
    "  x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<dl>",
    "  <dt>t</dt>",
    "  <dd>",
    "    <ul>",
    "      <li>",
    "        <pre><code class=\"language-x\"></code></pre>",
    "      </li>",
    "    </ul>",
    "    <p>x</p>",
    "  </dd>",
    "</dl>",
    "<p>tail</p>",
  ].join('\n'))
})

it("ends the deepest fence before middle item text with ``` x", () => {
  const source = [
    "- - - ``` x",
    "    x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code class=\"language-x\"></code></pre>",
    "          </li>",
    "        </ul>",
    "        x",
    "      </li>",
    "    </ul>",
    "  </li>",
    "</ul>",
    "<p>tail</p>",
  ].join('\n'))
})

it("keeps the outer body fence after - - ````", () => {
  const source = [
    "- - ````",
    "  ````",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <pre><code></code></pre>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("keeps the outer body fence after - - - ````", () => {
  const source = [
    "- - - ````",
    "  ````",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code></code></pre>",
    "          </li>",
    "        </ul>",
    "      </li>",
    "    </ul>",
    "    <pre><code>tail</code></pre>",
    "  </li>",
    "</ul>",
  ].join('\n'))
})

it("ends the nested description fence before host text with ````", () => {
  const source = [
    ":: t",
    ": - ````",
    "  x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<dl>",
    "  <dt>t</dt>",
    "  <dd>",
    "    <ul>",
    "      <li>",
    "        <pre><code></code></pre>",
    "      </li>",
    "    </ul>",
    "    <p>x</p>",
    "  </dd>",
    "</dl>",
    "<p>tail</p>",
  ].join('\n'))
})

it("ends the deepest fence before middle item text with ````", () => {
  const source = [
    "- - - ````",
    "    x",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <ul>",
    "      <li>",
    "        <ul>",
    "          <li>",
    "            <pre><code></code></pre>",
    "          </li>",
    "        </ul>",
    "        x",
    "      </li>",
    "    </ul>",
    "  </li>",
    "</ul>",
    "<p>tail</p>",
  ].join('\n'))
})

it("ends a term-led item after nested description fence payload", () => {
  const source = [
    "- :: t",
    "  : - ~~~",
    "      x",
    "      ```",
    "tail",
  ].join('\n')
  expect(carveToHtml(source)).toBe([
    "<ul>",
    "  <li>",
    "    <dl>",
    "      <dt>t</dt>",
    "      <dd>",
    "        <ul>",
    "          <li>",
    "            <pre><code>x",
    "```",
    "</code></pre>",
    "          </li>",
    "        </ul>",
    "      </dd>",
    "    </dl>",
    "  </li>",
    "</ul>",
    "<p>tail</p>",
  ].join('\n'))
})
