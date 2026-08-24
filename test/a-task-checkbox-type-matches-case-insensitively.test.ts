import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

/**
 * `type` on `<input>` is an ENUMERATED attribute, and HTML matches an
 * enumerated keyword ASCII case-insensitively. `<input type="CHECKBOX">` is a
 * checkbox to every browser, so an importer that compares the value exactly
 * reads a real task list as an ordinary bullet and loses the task state with
 * nothing said.
 *
 * All three engines compared exactly, so nothing diverged and no cross-engine
 * gate could see it - which is why this is pinned per spelling rather than on
 * the one uppercase shape that prompted it. A fix tested only on `CHECKBOX`
 * still misses `Checkbox`.
 */
const item = (type: string, checked = '') =>
  `<ul><li><input type="${type}"${checked}> a</li></ul>`

describe('a task checkbox is recognized whatever case its type is written in', () => {
  it.each(['checkbox', 'CHECKBOX', 'Checkbox', 'chEckBox', 'cHECKBOx'])(
    'type=%s reads as a task item',
    (spelling) => {
      expect(htmlToCarve(item(spelling)).value).toBe('- [ ] a\n')
      expect(htmlToCarve(item(spelling, ' checked')).value).toBe('- [x] a\n')
    },
  )

  it('the input is consumed by the marker rather than left in the content', () => {
    // The half a value-only fix would miss: recognizing the checkbox has to
    // also REMOVE it, or the item carries both a `[ ]` marker and the raw
    // element.
    const out = htmlToCarve(item('CHECKBOX')).value
    expect(out).not.toContain('input')
    expect(out).not.toContain('=html')
  })

  it('a non-checkbox input is still not a task item', () => {
    // The control. A fix that matched loosely - a prefix test, a `includes` -
    // would turn every text input at the head of an item into a task marker.
    expect(htmlToCarve(item('text')).value).not.toContain('[ ]')
    expect(htmlToCarve(item('TEXT')).value).not.toContain('[ ]')
    expect(htmlToCarve(item('checkboxes')).value).not.toContain('[ ]')
  })

  it('the fold is ASCII, so a Kelvin sign is not a K', () => {
    // `toLowerCase()` is Unicode-aware and folds U+212A KELVIN SIGN to `k`, so
    // `CHECKBOX` would become the exact string `checkbox` under it. HTML's
    // rule is ASCII case-insensitive and no browser reads that as a checkbox,
    // so neither does this.
    expect(htmlToCarve(item('CHECKBOX')).value).not.toContain('[ ]')
  })
})
