// Prints the conformance number: the examples of the 0.2 specification that this engine renders
// as the specification expects, of all, per document and per label, and every failure with its
// verdict. Fails when an example fails without a verdict.
//   node v2/scripts/conformance.ts
import { conformance, type Tally, VERDICTS } from '../test/support/conformance.ts'

function line(name: string, tally: Tally): string {
  return `${name.padEnd(20)} ${tally.passed} of ${tally.total}`
}

const report = conformance()
console.log(line('all examples', report.all))
for (const [file, tally] of report.byFile) console.log(line(file, tally))
for (const [label, tally] of report.byLabel) console.log(line(label, tally))
let open = 0
for (const id of report.failures) {
  const verdict = VERDICTS.get(id)
  if (verdict === undefined) open++
  console.log(`${id}: ${verdict ?? 'NO VERDICT'}`)
}
if (open > 0) process.exitCode = 1
