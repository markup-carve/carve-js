// Writer cases that take seconds; outside the everyday run, `npm run test:stress` runs them, and CI does.
import { expect, it } from 'vitest'
import { CarveWriteError, format } from '../src/index.ts'

it('C2-W-133: a long repeated reference label chain reports its repair limit', () => {
  const source = `x ${'[a][\\]'.repeat(4_000)}`
  try {
    format(source)
    throw new Error('expected a reported refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(CarveWriteError)
    if (error instanceof CarveWriteError) expect(error.diagnostics.map((entry) => entry.code)).toContain('writer-refused')
  }
}, 20_000)
