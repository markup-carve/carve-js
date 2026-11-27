import { expect, it } from 'vitest'
import { lint } from '../public/index.ts'

it('counts references in each snippet copy as uses of the note', () => {
  const source = '{$s}: [^n]\n\n{{ $s }} and {{ $s }}.\n\n[^n]: Note'
  const codes = lint(source).map((entry) => entry.code)
  expect(codes).not.toContain('unresolved-footnote')
  expect(codes).not.toContain('unused-footnote-definition')
})

it('resolves a snippet reference through its containing include scope', () => {
  const source = '[^n]: Note\n\n{{ child.crv }}'
  const findings = lint(source, { includes: () => ({ text: '{$s}: [^n]\n\n{{ $s }}', id: 'child.crv' }) })
  expect(findings.map((entry) => entry.code)).toEqual([])
})

it('does not treat a note in an included child as visible to a parent snippet', () => {
  const source = '{$s}: [^n]\n\n{{ $s }}\n\n{{ child.crv }}'
  const findings = lint(source, { includes: () => ({ text: '[^n]: Note', id: 'child.crv' }) })
  expect(findings.map((entry) => entry.code)).toContain('unresolved-footnote')
})
