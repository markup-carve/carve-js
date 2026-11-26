/**
 * The source upgrade of the reference engine (`@markup-carve/carve/upgrade`, C2-T-003, spec/0.2/UPGRADING.md): it
 * rewrites Carve 0.1 source into Carve 0.2. Kept off the root entry because it carries the 0.1 reader.
 */
import { upgrade as upgradeImpl, type UpgradeResult as UpgradeCore } from '../upgrade/src/upgrade.ts'
import { upgradeEdits, type UpgradeEdit } from '../upgrade/src/source-edits.ts'
import { CarveOptionError } from '../src/options.ts'
import { checkOptions } from './check.ts'
import { type RegisteredExtension } from '../upgrade/src/extension-respell.ts'

export { type UpgradeEdit } from '../upgrade/src/source-edits.ts'
export { type ReportRecord } from '../upgrade/src/report.ts'

/** The options of `upgrade`. */
export interface UpgradeOptions {
  /** Also returns `edits`, the changes from the 0.1 source to the 0.2 source, for an editor to offer as quick fixes. */
  edits?: boolean
  /** Default 0.1 host extensions whose source forms need a 0.2 spelling. */
  registeredExtensions?: readonly RegisteredExtension[]
}

export interface UpgradeResult extends UpgradeCore {
  /** With `edits`: one entry per change, in source order, with the UTF-8 byte range of the input and the upgrade row. */
  edits?: UpgradeEdit[]
}

/**
 * Rewrites the Carve 0.1 document `source` into Carve 0.2 and checks the result against both engines. `records` name
 * the upgrade rows that applied; `check` is `pass` or `explained` when the output may be written.
 */
export function upgrade(source: string, options?: UpgradeOptions): UpgradeResult {
  checkOptions(options, { edits: 'boolean', registeredExtensions: 'extension-names' })
  if (typeof source !== 'string') throw new CarveOptionError('source', 'not a string')
  const result: UpgradeResult = upgradeImpl(source, options?.registeredExtensions)
  if (options?.edits === true) result.edits = upgradeEdits(source, result.output, result.records)
  return result
}
