// Secrets encrypted with Electron safeStorage (Keychain-held key) in <dataDir>/secrets.bin (RFC §1B.6, DEC-004).
import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let file = ''
let cache: Record<string, string> | null = null

export function initSecrets(dataDir: string): void {
  file = path.join(dataDir, 'secrets.bin')
  cache = null
}

export const secretsAvailable = (): boolean => safeStorage.isEncryptionAvailable()

function load(): Record<string, string> {
  if (cache) return cache
  if (!fs.existsSync(file)) return (cache = {})
  const map = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as Record<string, string>
  return (cache = map)
}

function save(map: Record<string, string>): void {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(map)), { mode: 0o600 })
  fs.renameSync(tmp, file)
  cache = map
}

export const secrets = {
  get(name: string): string | null {
    if (!secretsAvailable()) return null
    return load()[name] ?? null
  },
  set(name: string, value: string): void {
    if (!secretsAvailable()) throw Object.assign(new Error("macOS Keychain is unavailable; secrets can't be saved"), { code: 'INTERNAL' })
    save({ ...load(), [name]: value })
  },
  delete(name: string): void {
    if (!secretsAvailable() || !fs.existsSync(file)) return
    const m = { ...load() }
    delete m[name]
    save(m)
  }
}
