// Prints, for every input of the contract, whether the tool gives the contract's output and what
// the self-check says. A development view of what test/contract.test.ts asserts.
//   node upgrade/scripts/contract.ts [--verbose] [U-nnn...]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { upgrade } from '../src/upgrade.ts'

interface Case {
  id: string
  class: string
  inputs: string[]
  outputs: string[]
}

const cases = JSON.parse(readFileSync(join(import.meta.dirname, '../test/contract.json'), 'utf8')) as Case[]
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const only = args.filter((arg) => !arg.startsWith('--'))
let good = 0
let bad = 0
for (const entry of cases) {
  if (only.length > 0 && !only.includes(entry.id)) continue
  entry.inputs.forEach((input, index) => {
    const result = upgrade(input)
    const want = entry.class === 'rewrite' || entry.class === 'escape' ? (entry.outputs[index] ?? input) : input
    const hit = result.records.some((record) => record.entry === entry.id)
    const ok = result.output === want && (entry.class !== 'report' || hit) && (entry.class === 'report' || result.check === 'pass')
    if (ok) good++
    else bad++
    if (ok && !verbose) return
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${entry.id}#${index} ${entry.class} check=${result.check} output=${result.output === want ? 'same' : 'differs'}`)
    if (result.output !== want) console.log(JSON.stringify(result.output) + '\n' + JSON.stringify(want))
    for (const record of result.records) console.log(`     ${record.entry} ${record.class} ${record.line}: ${record.message}`)
  })
}
console.log(`${good} ok, ${bad} failing`)
