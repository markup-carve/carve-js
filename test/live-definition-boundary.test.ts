import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  {
    ticket: 'carve#5352',
    source: '- a\n  :: t\n  # H\n  w\n: z\n',
    expected: `<ul>
  <li>a
    <dl>
      <dt>t</dt>
    </dl>
    <h1 id="H">H</h1>
    w
: z
  </li>
</ul>`,
  },
  {
    ticket: 'carve#5365',
    source: '- a\n  :: t\n  > q\n\n  w\n: z\n',
    expected: `<ul>
  <li><p>a</p>
    <dl>
      <dt>t</dt>
    </dl>
    <blockquote><p>q</p></blockquote>
    <p>w
: z</p>
  </li>
</ul>`,
  },
  {
    ticket: 'carve#5368',
    source: '- a\n  :: t\n  x\n: d\n',
    expected: `<ul>
  <li>a
    <dl>
      <dt>t</dt>
    </dl>
    x
: d
  </li>
</ul>`,
  },
  {
    ticket: 'carve#5373',
    source: '- a\n  :: m\n  : d\n\n  p\n\n  : x\n: l\n',
    expected: `<ul>
  <li><p>a</p>
    <dl>
      <dt>m</dt>
      <dd>d</dd>
    </dl>
    <p>p</p>
    <p>: x
: l</p>
  </li>
</ul>`,
  },
  {
    ticket: 'carve#5379',
    source: '- a\n  :: m\n  - i\n: l\n',
    expected: `<ul>
  <li>a
    <dl>
      <dt>m</dt>
    </dl>
    <ul>
      <li>i
: l</li>
    </ul>
  </li>
</ul>`,
  },
  {
    ticket: 'carve#5365 quoted description',
    source: '- a\n  > +\n  :: t\n    : d\n\n    q\n: d\n',
    expected: `<ul>
  <li><p>a</p>
    <blockquote>
      <dl>
        <dt>t</dt>
        <dd>d</dd>
      </dl>
    </blockquote>
    <p>q
: d</p>
  </li>
</ul>`,
  },
]

describe('a definition boundary ends when its list ends', () => {
  for (const { ticket, source, expected } of cases) {
    it(ticket, () => expect(carveToHtml(source)).toBe(expected))
  }
})
