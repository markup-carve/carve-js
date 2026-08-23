import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

/*
 * A fence's info string does not lose what follows a backtick.
 *
 * `markdownToCarve` dropped everything after a backtick, silently
 * (carve-js#1392):
 *
 *     input     ```foo`bar
 *     migrated  ```foo
 *
 * Not markup the document grew, but content the document LOST, and unlike the
 * grown-markup class it is not recoverable by reading the output - the bytes are
 * simply not there. The other two engines lose nothing here: carve-php preserves
 * the info string verbatim, and carve-rs reads the line through pulldown-cmark,
 * which applies CommonMark's own rule and hands back a paragraph.
 *
 * TWO SHAPES, and CommonMark separates them:
 *
 * - A BACKTICK fence's info string "may not contain any backtick characters"
 *   (CommonMark 4.5), so ```` ```a`b ```` is a PARAGRAPH, not a code block. The
 *   converter now reads it that way, everywhere it asks whether a line is a
 *   fence - the file's own note said that reading "is asked of the whole file or
 *   not at all" - and the backticks survive as the escaped literal text they are.
 * - A TILDE fence's info string MAY hold one, so the line is a code block whose
 *   language Carve's fence cannot spell. The word is dropped WHOLE rather than
 *   truncated at the backtick: dropping it says "this language does not fit",
 *   where keeping `foo` says the source named a language it never named.
 *
 * The documented normalizations are untouched, and they are the controls: a
 * separate info word (```js title="x") and a Pandoc brace
 * (```{.python .numberLines}) still reduce to a language the source really did
 * name.
 */

describe('a fence info string holding a backtick', () => {
  it('keeps every byte of a backtick fence opener', () => {
    // The defect: `bar was gone from the output entirely.
    const migrated = markdownToCarve('```foo`bar\nx\n```\n')

    expect(migrated).toContain('foo')
    expect(migrated).toContain('bar')
  })

  it('renders those bytes back as text', () => {
    // Present in the source is not the same as reaching the reader. The
    // backticks are escaped, so they are literal text rather than a verbatim
    // span that would swallow the rest of the line.
    const html = carveToHtml(markdownToCarve('```foo`bar\nx\n```\n'))

    expect(html).toContain('```foo`bar')
  })

  it('reads the line as a paragraph, the way CommonMark does', () => {
    // The mechanism, not just the symptom: the line does not open a code block.
    const html = carveToHtml(markdownToCarve('```foo`bar\nx\n```\n'))

    expect(html).toContain('<p>')
  })

  it('names no language for a tilde fence whose language holds one', () => {
    // A tilde fence's info string may hold a backtick, so this IS a code block -
    // with a language no Carve fence can spell. `foo` would be a language the
    // source never named.
    const migrated = markdownToCarve('~~~foo`bar\nx\n~~~\n')

    expect(migrated).not.toContain('~~~foo')
    expect(migrated).toContain('~~~\nx\n~~~')
  })

  it('still carries a language that does fit', () => {
    // The control. Every assertion above passes for a converter that dropped
    // every info string, and this is what such a converter would break.
    expect(markdownToCarve('```js\nx\n```\n')).toContain('```js')
    expect(markdownToCarve('```c++\nx\n```\n')).toContain('```c++')
    expect(markdownToCarve('```text/html\nx\n```\n')).toContain('```text/html')
  })

  it('still reduces an extended info string to its language', () => {
    // The other control, and the line this fix does NOT cross: `title="x"` is a
    // separate WORD, and reducing to the language is the documented
    // normalization rather than a truncation.
    expect(markdownToCarve('```js title="x"\nx\n```\n')).toContain('```js\n')
  })

  it('still reduces a Pandoc brace to its language', () => {
    // The shape the unanchored reduction was written for, and it still names a
    // language the source really did name.
    expect(markdownToCarve('```{.python .numberLines}\nx\n```\n')).toContain('```.python')
  })

  it('still opens an ordinary fence with no info at all', () => {
    // A bare run has no info string, so nothing about this rule reaches it.
    expect(carveToHtml(markdownToCarve('```\nx\n```\n'))).toContain('<pre><code>x')
  })

  it('reads the same line the same way on a list-marker line', () => {
    // The asymmetry the file's own note warned about: the collector and the
    // main loop must not disagree about whether the same line is a fence. Both
    // kept the bytes before - only the top-level path truncated - but they
    // disagreed about what the line WAS, so the item's copy crossed unescaped
    // as live Carve markup while the same line at top level opened a fence.
    const migrated = markdownToCarve('- ```foo`bar\n  x\n  ```\n')

    expect(migrated).toContain('\\`\\`\\`foo\\`bar')
  })
})
