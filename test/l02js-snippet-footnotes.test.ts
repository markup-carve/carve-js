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

it('leaves an unused parent note unused when the included snippet has no copy', () => {
  const source = '[^n]: Note\n\n{{ child.crv }}'
  const findings = lint(source, { includes: () => ({ text: '{$s}: [^n]', id: 'child.crv' }) })
  expect(findings.map((entry) => entry.code)).toContain('unused-footnote-definition')
})

it('uses the definition file scope when the use precedes an included snippet definition', () => {
  const source = '[^n]: Note\n\n{{ $s }}\n\n{{ child.crv }}'
  const findings = lint(source, { includes: () => ({ text: '{$s}: [^n]', id: 'child.crv' }) })
  expect(findings.map((entry) => entry.code)).toEqual([])
})

it('keeps a child note ahead of a parent note with the same key', () => {
  const source = '[^n]: Root\n\n{{ $s }}\n\n{{ child.crv }}'
  const child = '{$s}: [^n]\n\n[^n]: Child'
  const findings = lint(source, { includes: () => ({ text: child, id: 'child.crv' }) })
  expect(findings.filter((entry) => entry.code === 'unused-footnote-definition').map((entry) => entry.file))
    .toEqual([undefined])
})

it('counts a note reference through nested snippet copies', () => {
  const source = '[^n]: Note\n\n{{ child.crv }}'
  const child = '{$a}: [^n]\n\n{$b}: {{ $a }}\n\n{{ $b }}'
  const findings = lint(source, { includes: () => ({ text: child, id: 'child.crv' }) })
  expect(findings.map((entry) => entry.code)).toEqual([])
})

it('attributes a nested copy to the child note when parent and child share a key', () => {
  const source = '[^n]: Root\n\n{{ $b }}\n\n{{ child.crv }}'
  const child = '{$a}: [^n]\n\n{$b}: {{ $a }}\n\n[^n]: Child'
  const findings = lint(source, { includes: () => ({ text: child, id: 'child.crv' }) })
  expect(findings.filter((entry) => entry.code === 'unused-footnote-definition').map((entry) => entry.file))
    .toEqual([undefined])
})
