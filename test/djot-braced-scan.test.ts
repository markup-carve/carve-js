import { expect, it } from 'vitest'
import { applyMigrationFixes, migrateBareSteps, migrateBracedSteps, migrateCandidateChecks } from '../src/djot-migrate.js'

it('finds the real closer of long spans containing escaped delimiters with bounded work', () => {
  for (const count of [1000, 4000, 8000, 16000]) {
    for (const [marker, open, close] of [['~', '{,', ',}'], ['^', '{^', '^}'], ['_', '/', '/']]) {
      const body = `a\\${marker}`.repeat(count) + 'z'
      const source = marker + body + marker
      migrateBareSteps.count = 0
      const result = applyMigrationFixes(source, true)
      expect(result.output).toBe(open + body + close)
      expect(result.applied).toHaveLength(1)
      expect(migrateBareSteps.count).toBeLessThan(5 * source.length)
    }
  }
})

it('scans unclosed braced openers with bounded work and finds the next paragraph', () => {
  for (const count of [1000, 2000, 4000, 8000]) {
    for (const opener of ['{=', '{~']) {
      const source = `${`${opener}a `.repeat(count)}\n\nH{~ 2 ~}O`
      migrateBracedSteps.count = 0
      const result = applyMigrationFixes(source, true)
      expect(result.output).toBe(`${`${opener}a `.repeat(count)}\n\nH{, 2 ,}O`)
      expect(migrateBracedSteps.count).toBeLessThan(6 * source.length)
    }
  }
})

it('never attempts a regex match at escaped underscore openers', () => {
  for (const count of [1000, 2000, 4000, 8000]) {
    const prefix = '\\_a '.repeat(count)
    migrateCandidateChecks.count = 0
    expect(applyMigrationFixes(`${prefix}_ok_`, true).output).toBe(`${prefix}/ok/`)
    expect(migrateCandidateChecks.count).toBeLessThan(8)
  }
})

it('preserves interleaved same-family matches from different rules', () => {
  const count = 4096
  const result = applyMigrationFixes('_a_ x_y_z '.repeat(count), true)
  expect(result.output).toBe('/a/ x{/y/}z '.repeat(count))
  expect(result.applied).toHaveLength(2 * count)
  expect(result.skipped).toHaveLength(0)
})

it('composes heading folds with inline migration edits', () => {
  for (const [source, expected] of [
    ['# **x**\ny', '# *x* y'],
    ['# _x\ny_', '# /x y/'],
    ['# H\n# ^y^', '# H {^y^}'],
  ]) {
    const result = applyMigrationFixes(source, true)
    expect(result.output).toBe(expected)
    expect(result.applied).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)
  }
})

it('keeps carets inside attributes and native inline footnote openers opaque', () => {
  for (const source of ['a{title="[^a^ b"}', '[a]{title="[^a^ b"}']) {
    for (const djot of [false, true]) expect(applyMigrationFixes(source, djot).output).toBe(source)
  }
  expect(applyMigrationFixes('x ^[y]^ z').output).toBe('x ^[y]^ z')
  expect(applyMigrationFixes('x ^[y]^ z', true).output).toBe('x {^[y]^} z')
})

it('keeps warning capture offsets over code and escaped closers', () => {
  const source = 'H{~a `{~` \\~} z ~}O'
  const result = applyMigrationFixes(source, true)
  expect(result.output).toBe('H{,a `{~` \\~} z ,}O')
  expect(result.applied).toHaveLength(1)
  expect(result.applied[0]).toMatchObject({ start: 1, end: source.length - 1 })
})
