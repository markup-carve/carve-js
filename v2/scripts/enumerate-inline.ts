// Runs the inline property checks on every content of up to N tokens over the alphabet of inline tokens.
//   node v2/scripts/enumerate-inline.ts [N]        (default 4)
import { loadavg } from 'node:os'
import { enumerateContents, INLINE_TOKENS } from '../test/support/inline-enumerate.ts'

const maxLength = Number(process.argv[2] ?? 4)
console.log(`${INLINE_TOKENS.length} inline tokens, load average ${loadavg().map((n) => n.toFixed(2)).join(' ')}`)
let failed = false
for (let length = 1; length <= maxLength; length++) {
  const cpu = process.cpuUsage()
  const result = enumerateContents(length)
  const used = process.cpuUsage(cpu)
  const seconds = ((used.user + used.system) / 1e6).toFixed(2)
  console.log(`N = ${length}: ${result.contents} contents, ${seconds} s CPU, ${result.failures.length} failures`)
  for (const failure of result.failures) console.log(`  ${failure}`)
  if (result.failures.length > 0) failed = true
}
process.exitCode = failed ? 1 : 0
