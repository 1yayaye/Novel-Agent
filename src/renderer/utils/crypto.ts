export function getEndpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export async function computeSha256Fingerprint(baseUrl: string, model: string): Promise<string> {
  const normUrl = baseUrl.trim().replace(/\/+$/, '')
  const normModel = model.trim()
  const data = new TextEncoder().encode(`${normUrl}:${normModel}`)
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24)
}
