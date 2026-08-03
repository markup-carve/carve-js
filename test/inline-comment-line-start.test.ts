import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `%%` starts a line comment at the start of a line or after whitespace. The
 * inline scanner accepted only the start of the RUN or a space/tab before it,
 * so a comment at the start of a later line inside multi-line inline content
 * stayed visible.
 *
 * A paragraph never showed it, because a comment-only line is handled at the
 * block layer there. Inside a line block it is inline content, so the verse
 * kept `%% c` as text where carve-rs and carve-php drop it - the first line of
 * the same block dropped it here too, so this engine disagreed with itself
 * (carve#574).
 */
describe('a line comment at the start of a line', () => {
  const norm = (html: string) => html.replace(/\n\s*/g, '')

  it('is dropped on a later verse line, as on the first', () => {
    expect(norm(carveToHtml('::: |\nverse\n%% c\n:::\n'))).toBe(
      '<div class="line-block"><p>verse<br></p></div>',
    )
  })

  it('is dropped between two verse lines', () => {
    expect(norm(carveToHtml('::: |\nverse\n%% c\nmore\n:::\n'))).toBe(
      '<div class="line-block"><p>verse<br><br>more</p></div>',
    )
  })

  it('still drops on the first verse line', () => {
    expect(norm(carveToHtml('::: |\n%% c\nverse\n:::\n'))).toBe(
      '<div class="line-block"><p><br>verse</p></div>',
    )
  })

  it('still drops a trailing comment', () => {
    expect(norm(carveToHtml('::: |\nverse %% c\n:::\n'))).toBe(
      '<div class="line-block"><p>verse</p></div>',
    )
  })

  it('leaves a percent run that is not a comment alone', () => {
    expect(carveToHtml('::: |\n50%\n:::\n')).toContain('50%')
  })

  it('does not swallow an escaped comment marker', () => {
    expect(carveToHtml('::: |\nverse\n\\%% c\n:::\n')).toContain('%% c')
  })
})
