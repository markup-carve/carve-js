import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Operation, superlinear } from './scaling.ts'

function cpuMs(): number {
  const usage = process.cpuUsage()
  return (usage.user + usage.system) / 1000
}

/** An operation that spends `cost(length)` milliseconds of CPU time on a source. */
function modeled(cost: (length: number) => number): Operation {
  return ['model', (source: string) => {
    const end = cpuMs() + cost(source.length)
    while (cpuMs() < end) { /* spin */ }
  }]
}

const build = (n: number): string => 'x'.repeat(n)

void test('a cost per byte that rises at small sizes and then stays flat is not superlinear', () => {
  assert.equal(superlinear(modeled((length) => length / 50 * Math.min(length, 400) / 400), build, 100), null)
})

void test('a quadratic cost stays superlinear at four times the base', () => {
  assert.match(superlinear(modeled((length) => (length / 200) ** 2), build, 100) ?? '', /^model n=400: /)
})
