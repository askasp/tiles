/** OS encryption for tokens. Persisting a secret requires real encryption, never a plain-text fallback. */
export interface SecretStorage {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
