/**
 * The Node-only surface of the package, kept off the main entry so the browser
 * bundle - built from `src/index.ts` unmodified - stays free of Node built-ins.
 */
export {
  DEFAULT_MAX_FILE_BYTES,
  fileSystemResolver,
  type FileSystemResolverOptions,
} from './includes-fs.js'
