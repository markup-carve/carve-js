import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const findings = (source, code) => lint(source).filter((entry) => entry.code === code)
  .map(({ range, message }) => ({ range: [range.startOffset, range.endOffset], message }))
const ranges = (source, code) => findings(source, code).map((entry) => entry.range)

describe('0.2 lint reads source spelling within parsed text and containers', () => {
  it('recognizes a bare quote and an abbreviation definition as later paragraph openers', () => {
    expect(ranges('para\n>', 'block-opener-without-blank-line')).toEqual([[5, 6]])
    expect(ranges('para\n*[x]: y', 'block-opener-without-blank-line')).toEqual([[5, 10]])
  })
  it('requires a table row with at least two pipes near a caption-looking paragraph', () => {
    expect(ranges(': key\n|', 'caption-looking-paragraph')).toEqual([])
    expect(ranges(': key\n| x |', 'caption-looking-paragraph')).toEqual([[0, 1]])
  })
  it('reads an invalid quote mark from the source even when the rest is masked', () => {
    expect(ranges('>\t', 'blockquote-marker-without-space')).toEqual([[0, 1]])
    expect(ranges('a\n> %% x', 'blockquote-marker-without-space')).toEqual([])
    expect(ranges('a\n>%% x', 'blockquote-marker-without-space')).toEqual([[2, 7]])
  })
  it('requires a real opening quote mark before an alert and skips term text', () => {
    expect(ranges('>> [!NOTE]', 'github-alert-marker')).toEqual([])
    expect(ranges('> :: a\n> :: t2\n>: key\n> > [!NOTE]', 'github-alert-marker')).toEqual([])
    expect(ranges('> [!NOTE]', 'github-alert-marker')).toEqual([[2, 9]])
  })
  it('does not treat a short final backtick run as a closer', () => {
    expect(ranges('````\n  ```', 'fence-closer-indented')).toEqual([])
    expect(ranges('````\n  ````', 'fence-closer-indented')).toEqual([[7, 11]])
    expect(ranges('> ```\n>   ```', 'fence-closer-indented')).toEqual([[10, 13]])
  })
  it('checks HTML tags in table rows, but not term text', () => {
    expect(ranges('| <i> |', 'bare-html-tag')).toEqual([[2, 5]])
    expect(ranges(':: a <b>', 'bare-html-tag')).toEqual([])
  })
  it('skips caption text of a table and an image (carve#6215)', () => {
    expect(ranges('| x | y |\n^ <i>', 'bare-html-tag')).toEqual([])
    expect(ranges('> | x | y |\n> ^ a\n> <i>', 'bare-html-tag')).toEqual([])
    expect(ranges('![i](u)\n^ <i>', 'bare-html-tag')).toEqual([])
    expect(ranges('| <i> | y |\n^ <b>', 'bare-html-tag')).toEqual([[2, 5]])
  })
  it('skips an indented paragraph after a list and a marker in caption text', () => {
    expect(ranges('\t1. w.\n\n    :', 'indented-code-block')).toEqual([])
    expect(ranges('a\n\n    :', 'indented-code-block')).toEqual([[7, 8]])
    expect(ranges('| w | w |\n^ w\n- ::', 'list-marker-without-blank-line')).toEqual([])
    expect(ranges('a\n- x', 'list-marker-without-blank-line')).toEqual([[2, 5]])
  })
  it('reads definition text behind list and quote marks but skips caption text', () => {
    expect(ranges('> - [x]: y', 'definition-in-container')).toEqual([[4, 8]])
    expect(ranges('> 10. [x]: y', 'definition-in-container')).toEqual([[6, 10]])
    expect(ranges('| w | w |\n^ w\n[^w]: %%', 'definition-in-container')).toEqual([])
  })
  it('finds a quoted comment closer with trailing text', () => {
    expect(ranges('> %%%%\n> %%%% x', 'comment-fence-closer-with-text')).toEqual([[7, 15]])
  })
  it('uses the blank line after an attribute run for its message', () => {
    const entries = findings('{#id .c k=v}\n{#id .c k=v}\n\n', 'unattached-block-attribute')
    expect(entries).toHaveLength(1)
    expect(entries[0].range).toEqual([0, 12])
    expect(entries[0].message).toMatch(/^A blank line follows/)
  })
})
