export const uid = () => crypto.randomUUID()
export const basename = (path: string) => path.replace(/\/$/, '').split('/').pop() || path

export function normalizeURL(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('Enter a URL')
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:|\/|$)/.test(value) ? 'http' : 'https'}://${value}`)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP and HTTPS URLs without embedded credentials are supported')
  }
  return url.href
}
