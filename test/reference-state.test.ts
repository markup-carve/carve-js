import { describe, expect, it } from 'vitest'
import type { Link } from '../src/ast.js'
import { applyLinkDefs } from '../src/inline-resolution.js'
import { isUnresolvedReference } from '../src/unresolved-reference.js'
import { resolveReferenceDestination, type ResolvedLink, type UnresolvedLink } from '../src/reference-state.js'
import { parse } from '../src/parse.js'
import { resolveHeadingIds } from '../src/heading-ids.js'

// Public nodes need a state check before entering the resolver.
function referenceTypeContract(publicLink: Link, pending: UnresolvedLink, resolved: ResolvedLink): void {
  // @ts-expect-error A public link has not been checked for an unresolved label.
  resolveReferenceDestination(publicLink, '/target')
  // @ts-expect-error A resolved destination is not an empty placeholder.
  const invalid: UnresolvedLink = resolved
  // @ts-expect-error A placeholder cannot promise a resolved destination.
  const premature: ResolvedLink = pending
  void invalid
  void premature
}
void referenceTypeContract

describe('reference state transitions', () => {
  it('preserves identity and authored metadata when a definition resolves', () => {
    const node: UnresolvedLink = {
      type: 'link', href: '', ref: 'label', rawRef: '[text][label]',
      children: [{ type: 'text', value: 'text' }],
      attrs: { classes: ['use'] },
    }
    const [result] = applyLinkDefs([node], new Map([
      ['label', { href: '/target', attrs: { classes: ['definition'] } }],
    ]))
    expect(result).toBe(node)
    expect(result).toMatchObject({ href: '/target', ref: 'label', rawRef: '[text][label]', attrs: { classes: ['definition', 'use'] } })
    expect(isUnresolvedReference(node)).toBe(false)
  })

  it('keeps empty destinations unresolved and resolves images through the same boundary', () => {
    const node = { type: 'image' as const, src: '' as const, alt: 'text', ref: 'label' }
    expect(resolveReferenceDestination(node, '')).toBe(node)
    expect(isUnresolvedReference(node)).toBe(true)
    expect(resolveReferenceDestination(node, '/image.png')).toMatchObject({ src: '/image.png', ref: 'label' })
    expect(isUnresolvedReference(node)).toBe(false)
  })

  it('resolves heading references while preserving literal unresolved references', () => {
    const doc = parse('[Target][] [missing][]\n\n# Target\n')
    resolveHeadingIds(doc)
    const paragraph = doc.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph')
    expect(paragraph.children).toContainEqual(expect.objectContaining({ type: 'link', href: '#Target', ref: 'Target' }))
    expect(paragraph.children).toContainEqual(expect.objectContaining({ type: 'link', href: '', rawRef: '[missing][]' }))
  })
})
