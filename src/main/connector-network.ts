import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { lookup as lookupAsync } from 'node:dns/promises'
import { connectorBaseURL } from '../shared/connectors'

export function privateAddress(ip: string): boolean {
  const address = ip.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19)
  }
  return !/^[23][0-9a-f]{3}:/.test(address)
}
export async function checkDestination(baseURL: string) {
  const url = new URL(connectorBaseURL(baseURL))
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return
  const addresses = await lookupAsync(url.hostname.replace(/^\[|\]$/g, ''), { all: true })
  if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error('Connector hosts must resolve to public addresses. For local APIs use localhost explicitly.')
}

/** Pin the validated DNS answer to the socket: no DNS-rebinding check/use gap.
 * No redirects, proxies or automatic retries. TLS verifies the original host.
 */
export const connectorFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!local && url.protocol !== 'https:') throw new Error('Remote APIs require HTTPS')
  const hostIP = url.hostname.replace(/^\[|\]$/g, '')
  if (!local && isIP(hostIP) && privateAddress(hostIP)) throw new Error('Private API destination blocked')
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()), signal: init.signal || undefined,
      lookup: (hostname, options, callback) => {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) { callback(error, '', 4); return }
          const unsafe = addresses.some(a => local ? !['127.0.0.1', '::1'].includes(a.address) : privateAddress(a.address))
          if (unsafe || !addresses.length) { callback(new Error('Unsafe API DNS destination'), '', 4); return }
          // Node may request all addresses for autoSelectFamily.
          if (options.all) (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        })
      },
    }, response => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      const status = response.statusCode || 500
      if ([204, 205, 304].includes(status)) { response.resume(); resolve(new Response(null, { status, headers })); return }
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }))
    })
    request.on('error', reject)
    if (init.body) request.write(String(init.body))
    request.end()
  })
}
