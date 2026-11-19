/**
 * The Node-only part of the API (`@markup-carve/carve/node`), kept off the root entry so browser builds never see
 * Node built-ins.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { type FileResolverOptions, fileResolver } from '../cli/include-fs.ts'
import { type IncludeResolver } from '../src/include-settings.ts'
import { INCLUDE_BYTES } from '../src/include-tables.ts'
import { CarveOptionError } from '../src/options.ts'
import { checkOptions } from './check.ts'

export { type FileResolverOptions } from '../cli/include-fs.ts'

/**
 * The include resolver of the command line (C2-N-012 to C2-N-014): it reads files below `root` and refuses a path
 * that leads out of it with `outside_root`. A relative root is read from the working directory. `maxFileBytes` makes a
 * larger file `unreadable`; `allowAbsolute: false` refuses an absolute path with `outside_root`.
 */
export function fileSystemResolver(root: string, options?: FileResolverOptions): IncludeResolver {
  checkOptions(options, { maxFileBytes: 'count', allowAbsolute: 'boolean' })
  const max = options?.maxFileBytes
  if (max !== undefined && max > INCLUDE_BYTES) throw new CarveOptionError('maxFileBytes', `above the cap of ${INCLUDE_BYTES} bytes`)
  return fileResolver(realpathSync(resolve(root)), {}, options)
}
