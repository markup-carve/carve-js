import { describe, it, expect } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

/*
 * A container label's trailing-comment cut is the label's own inline run's
 * answer (markup-carve/carve#2618). A `%%` a closed construct scopes never
 * reaches the line break, so it is not a marker - in a label no more than in a
 * paragraph, which is the incoherence the ruling closed.
 */

/** The `<p class="div-label">` a container publishes, without its wrapper. */
const labelHtml = (label: string): string => {
  const html = renderHtml(parse(`:::[${label}]\nbody\n:::\n`))
  const line = html.split('\n').find((row) => row.includes('div-label'))
  return line === undefined ? '' : line.trim().replace(/^<p class="div-label">/, '').replace(/<\/p>$/, '')
}

/** The same text as a paragraph, which is the arbiter. */
const paragraphHtml = (text: string): string =>
  renderHtml(parse(`${text}\n`)).trim().replace(/^<p>/, '').replace(/<\/p>$/, '')

describe('a label comment cut keeps a closed construct', () => {
  // Every shape holds a `%%` INSIDE a construct whose closer follows it.
  const scoped = [
    '{+a %% secret+}',
    '{-a %% secret-}',
    '{% %% hidden %} after',
    '{# %% hidden #} after',
    '`a %% b`',
  ]

  it.each(scoped)('publishes %s the way a paragraph does', (label) => {
    expect(labelHtml(label)).toBe(paragraphHtml(label))
  })

  it('publishes the insertion rather than the truncated prefix', () => {
    expect(labelHtml('{+a %% secret+}')).toBe('<ins>a</ins>')
    expect(labelHtml('{-a %% secret-}')).toBe('<del>a</del>')
  })

  it('still cuts a comment that reaches the line break', () => {
    expect(labelHtml('plain %% secret')).toBe('plain')
    expect(labelHtml('{+a+} %% secret')).toBe('<ins>a</ins>')
    expect(labelHtml('%% whole')).toBe('')
  })

  it('cuts the whole separating run, tab as well as space', () => {
    expect(labelHtml('plain\t%% secret')).toBe('plain')
    expect(labelHtml('plain   %% secret')).toBe('plain')
  })

  it('keeps an escaped marker as text', () => {
    expect(labelHtml('plain \\%% kept')).toBe(paragraphHtml('plain \\%% kept'))
  })

  it('keeps the comment out of the targets that write the label as source', () => {
    // The cut is on the STRING, so a comment reaching the line break leaves the
    // node - otherwise Markdown, plain text and ANSI would print it.
    const div = parse(':::[plain %% secret]\nbody\n:::\n').children[0] as { label?: string }
    expect(div.label).toBe('plain')
    const kept = parse(':::[{+a %% secret+}]\nbody\n:::\n').children[0] as { label?: string }
    expect(kept.label).toBe('{+a %% secret+}')
  })
})
