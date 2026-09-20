import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let server: ReturnType<typeof createServer>
let url = ''

beforeAll(() => new Promise<void>((resolve) => {
  server = createServer((request, response) => {
    if (request.url === '/events') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: {"ok":true}\n\n'); return }
    response.end('ok')
  }).listen(0, '127.0.0.1', () => { const address = server.address(); url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`; resolve() })
}))
afterAll(() => server.close())

describe('phase-0 fake HTTP/SSE server', () => {
  it('serves both a basic response and one SSE event', async () => {
    expect(await (await fetch(url)).text()).toBe('ok')
    expect(await (await fetch(`${url}/events`)).text()).toContain('data: {"ok":true}')
  })
})
