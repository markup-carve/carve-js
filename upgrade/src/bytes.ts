/** C2-W-101: preserve a UTF-8 signature while refusing malformed input. */
export function decodeUpgradeBytes(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
}
