// Runs the property checks on every document of up to N lines over the alphabet of line shapes.
//   node v2/scripts/enumerate.ts [N]        (default 4; Node 22.18 or later runs the sources as they are)
import { loadavg } from 'node:os'
import { enumerateDocuments, LINE_SHAPES } from '../test/support/enumerate.ts'

const maxLines = Number(process.argv[2] ?? 4)
console.log(`${LINE_SHAPES.length} line shapes, load average ${loadavg().map((n) => n.toFixed(2)).join(' ')}`)
let failed = false
for (let lines = 1; lines <= maxLines; lines++) {
  const cpu = process.cpuUsage()
  const result = enumerateDocuments(lines)
  const used = process.cpuUsage(cpu)
  const seconds = ((used.user + used.system) / 1e6).toFixed(2)
  console.log(`N = ${lines}: ${result.documents} documents, ${seconds} s CPU, ${result.failures.length} failures`)
  for (const failure of result.failures) console.log(`  ${failure}`)
  if (result.failures.length > 0) failed = true
}
process.exitCode = failed ? 1 : 0
