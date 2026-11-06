import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a plain line into the description a list quote\'s + attached (#4596)', () => {
  expect(carveToHtml('- > +\n  :: t\n  : d\nz\n').trim()).toBe(`<ul>
  <li>
    <blockquote>
      <dl>
        <dt>t</dt>
        <dd>d
z</dd>
      </dl>
    </blockquote>
  </li>
</ul>`)
})

it('folds a plain line into the admonition a task item\'s quote + attached (#4596)', () => {
  expect(carveToHtml('- [ ] > +\n      ::: note\n      k\nz\n').trim()).toBe(`<ul class="task-list">
  <li><input type="checkbox" disabled> 
    <blockquote>
      <aside class="admonition note" aria-label="Note">
        <p>k
z</p>
      </aside>
    </blockquote>
  </li>
</ul>`)
})

it('attaches the block after a comment span behind a list quote\'s + (#4595)', () => {
  expect(carveToHtml('- > +\n  %%%\n  k\n  %%%\n  # h\n').trim()).toBe(`<ul>
  <li>
    <blockquote>
      <h1 id="h">h</h1>
    </blockquote>
  </li>
</ul>`)
})

it('attaches a quoted term after an empty comment span (#4595)', () => {
  expect(carveToHtml('- > +\n  %%%\n  %%%\n  > :: t\n  > : d\n: d\n').trim()).toBe(`<ul>
  <li>
    <blockquote>
      <blockquote>
        <dl>
          <dt>t</dt>
          <dd>d
: d</dd>
        </dl>
      </blockquote>
    </blockquote>
  </li>
</ul>`)
})

it('attaches the paragraph after a comment span in a loose item\'s quote (#4595)', () => {
  expect(carveToHtml('- a\n\n  > +\n  %%%\n  %%%\n  after\n').trim()).toBe(`<ul>
  <li><p>a</p>
    <blockquote><p>after</p></blockquote>
  </li>
</ul>`)
})

it('ends an unclosed span at a task item line left of its quote (carve#5335)', () => {
  expect(carveToHtml('- [ ] > +\n      %%%\n  after\n').trim()).toBe(`<ul class="task-list">
  <li><input type="checkbox" disabled> 
    <blockquote>

    </blockquote>
    after
  </li>
</ul>`)
})

it('ends an unclosed span at a column-0 line after a list quote (carve#5335)', () => {
  expect(carveToHtml('- > +\n  %%%\nafter\n').trim()).toBe(`<ul>
  <li>
    <blockquote>

    </blockquote>
  </li>
</ul>
<p>after</p>`)
})

it('ends the item at a marker-column colon after a comment-led description list (#4595)', () => {
  expect(carveToHtml('- > +\n  %%%\n  %%%\n  :: t\n  : d\n: d\n').trim()).toBe(`<ul>
  <li>
    <blockquote>
      <dl>
        <dt>t</dt>
        <dd>d</dd>
      </dl>
    </blockquote>
  </li>
</ul>
<p>: d</p>`)
})

it('keeps a nested list under a stacked item\'s quote', () => {
  expect(carveToHtml('- - > +\n    - a\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <blockquote>
          <ul>
            <li>a</li>
          </ul>
        </blockquote>
      </li>
    </ul>
  </li>
</ul>`)
})
