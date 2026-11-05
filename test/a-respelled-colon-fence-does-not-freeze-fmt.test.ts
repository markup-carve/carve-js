import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// A colon fence's opener and closer belong to its container, so a writer that
// respells them has not dropped an authored line beside an erased one.
describe('a respelled colon fence does not freeze fmt', () => {
  it.each([
    ['a hard-break container holding only a comment (corpus 493-2)', '::: \\\n%% hidden\n:::\n\n---\n', '{.hardbreaks}\n:::\n%% hidden\n:::\n\n***\n'],
    ['a longer colon fence', ':::: note\n%% c\n::::\n\n---\n', '::: note\n%% c\n:::\n\n***\n'],
    ['extra space before the kind', ':::  note\n%% c\n:::\n\n---\n', '::: note\n%% c\n:::\n\n***\n'],
    ['in a list item', '- ::: \\\n  %% hidden\n  :::\n', '- {.hardbreaks}\n  :::\n  %% hidden\n  :::\n'],
    ['in a quote', '> ::: \\\n> %% hidden\n> :::\n', '> {.hardbreaks}\n> :::\n> %% hidden\n> :::\n'],
  ])('%s', (_name, source, expected) => {
    const written = carveToCarve(source)
    expect(written).toBe(expected)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
