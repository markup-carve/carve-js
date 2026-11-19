/**
 * The Node-only part of the API (`@markup-carve/carve/node`), kept off the root entry so browser builds never see
 * Node built-ins.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileResolver } from '../cli/include-fs.ts'
import { type IncludeResolver } from '../src/include-settings.ts'

/**
 * The include resolver of the command line (C2-N-012 to C2-N-014): it reads files below `root` and refuses a path
 * that leads out of it with `outside_root`. A relative root is read from the working directory.
 */
export function fileSystemResolver(root: string): IncludeResolver {
  return fileResolver(realpathSync(resolve(root)))
}
