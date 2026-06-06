import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const ol = (s: string) => carveToHtml(s).split('\n')[0]
const h = (s: string) => carveToHtml(s)

describe('ordered-list dialects', () => {
  it('lower-alpha', () => {
    expect(ol('a. apple\nb. banana')).toBe('<ol type="a">')
  })
  it('upper-alpha with a start letter', () => {
    expect(ol('C. third\nD. fourth')).toBe('<ol type="A" start="3">')
  })
  it('lower-roman', () => {
    expect(ol('i. one\nii. two')).toBe('<ol type="i">')
  })
  it('upper-roman', () => {
    expect(ol('I. one\nII. two')).toBe('<ol type="I">')
  })
  it('roman start above one', () => {
    expect(ol('iv. four\nv. five\nvi. six')).toBe('<ol type="i" start="4">')
  })
  it('the ) delimiter works for dialects', () => {
    expect(ol('a) a\nb) b')).toBe('<ol type="a">')
  })

  // Tie-break: consecutive letters are alpha; consecutive roman is roman.
  it('c. d. is alpha (consecutive letters), not roman', () => {
    expect(ol('c. cat\nd. dog')).toBe('<ol type="a" start="3">')
  })
  it('v. w. is alpha (w is not roman)', () => {
    expect(ol('v. victor\nw. whiskey')).toBe('<ol type="a" start="22">')
  })
  it('x. xi. is roman (consecutive roman)', () => {
    expect(ol('x. ten\nxi. eleven')).toBe('<ol type="i" start="10">')
  })
  it('a lone i. defaults to roman', () => {
    expect(ol('i. only')).toBe('<ol type="i">')
  })

  it('a dialect change starts a new list (§11)', () => {
    const out = h('a. alpha\n1. decimal')
    expect(out).toContain('<ol type="a">')
    expect(out.match(/<ol/g)?.length).toBe(2)
  })
})

describe('ordered dialects vs paragraphs (§10)', () => {
  it('a lone a. in prose remains paragraph text', () => {
    expect(h('Pick option a. it is best.\nMore prose.')).toBe(
      '<p>Pick option a. it is best.\nMore prose.</p>',
    )
  })
  it('alpha ordered markers do not interrupt paragraphs (§10 guard)', () => {
    expect(h('Choices:\na. first\nb. second')).toBe(
      '<p>Choices:\na. first\nb. second</p>',
    )
  })
  it('a single a. at block start is a list', () => {
    expect(ol('a. only one')).toBe('<ol type="a">')
  })
  it('decimal markers stay unambiguous mid-prose', () => {
    expect(h('See step 1. it works\nmore')).toBe('<p>See step 1. it works\nmore</p>')
  })
})

describe('ordered dialects edge cases', () => {
  it('does not fabricate a link def from a prose `a. [ref]:` line', () => {
    // The `a. [ref]: /u` line is a lone ambiguous marker in prose (§10),
    // so it stays text and must NOT register `[ref]` as a definition.
    const out = h('Choices:\na. [ref]: /u\nThen [ref] here.')
    expect(out).not.toContain('<a ')
  })

  it('classifies a loose roman list across a blank line as one list', () => {
    const out = h('x. ten\n\nxi. eleven')
    expect(out.split('\n')[0]).toBe('<ol type="i" start="10">')
    expect(out.match(/<ol/g)?.length).toBe(1)
  })

  it('tie-breaks past a continuation line on the first item', () => {
    const out = h('x. ten\n   still ten\nxi. eleven')
    expect(out.split('\n')[0]).toBe('<ol type="i" start="10">')
    expect(out.match(/<ol/g)?.length).toBe(1)
  })
})
