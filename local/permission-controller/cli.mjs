#!/usr/bin/env node
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CanonicalPolicyApi, DisabledUniSatBridge, ledgerPath, loadConfig, privateFile } from './adapters.mjs'
import { PermissionController, receipt } from './controller.mjs'
import { PermissionLedger } from './ledger.mjs'
import { exactKeys, fail, PermissionError } from './schema.mjs'

const errorCode = error => error instanceof PermissionError ? error.code : 'CONTROLLER_UNAVAILABLE'
function token(path) {
  const text = privateFile(path, { maxBytes: 128 }).toString('utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(text)) fail('INVALID_ACCESS_TOKEN')
  return Buffer.from(text, 'hex')
}
export async function serve(config) {
  if (config.autonomousSigning) fail('ISOLATED_UNISAT_BRIDGE_NOT_VERIFIED')
  const auth = token(config.accessTokenFile), ledger = new PermissionLedger(ledgerPath(config), config)
  const controller = new PermissionController({ config, ledger, policyReader: new CanonicalPolicyApi(), bridge: new DisabledUniSatBridge() })
  const socketDir = lstatSync(dirname(config.socketPath))
  if (!socketDir.isDirectory() || socketDir.isSymbolicLink() || socketDir.uid !== process.getuid() || (socketDir.mode & 0o022)) fail('UNSAFE_SOCKET_DIRECTORY')
  // Do not unlink a socket that another controller might be serving.
  if (existsSync(config.socketPath)) fail('SOCKET_ALREADY_EXISTS')
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store')
    try {
      const bearer = request.headers.authorization
      if (typeof bearer !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(bearer) || !timingSafeEqual(Buffer.from(bearer.slice(7), 'hex'), auth)) fail('UNAUTHORIZED')
      if (request.method !== 'POST' || request.url !== '/v1/request') fail('UNKNOWN_ROUTE')
      let size = 0; const parts = []
      for await (const part of request) { size += part.length; if (size > 200_000) fail('REQUEST_TOO_LARGE'); parts.push(part) }
      const command = JSON.parse(Buffer.concat(parts).toString('utf8'))
      exactKeys(command, ['method'], ['request', 'requestId'])
      let result
      if (command.method === 'inspect' && !command.request && !command.requestId) result = await controller.inspect()
      else if (command.method === 'plan' && command.request && !command.requestId) result = await controller.plan(command.request)
      else if (command.method === 'execute' && command.request && !command.requestId) result = await controller.execute(command.request)
      else if (command.method === 'receipt' && /^[a-f0-9]{64}$/.test(command.requestId || '') && !command.request) { const row = ledger.get(command.requestId); if (!row) fail('RECEIPT_NOT_FOUND'); result = receipt(row) }
      else fail('INVALID_COMMAND')
      response.end(JSON.stringify({ ok: true, result }))
    } catch (error) { response.statusCode = errorCode(error) === 'UNAUTHORIZED' ? 401 : 409; response.end(JSON.stringify({ ok: false, error: errorCode(error) })) }
  })
  server.headersTimeout = 10_000; server.requestTimeout = 20_000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.socketPath, resolve) })
  chmodSync(config.socketPath, 0o600)
  server.on('close', () => { ledger.close(); auth.fill(0); if (existsSync(config.socketPath)) unlinkSync(config.socketPath) })
  return server
}
export async function client({ socketPath, tokenPath, command }) {
  const auth = token(tokenPath)
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({ socketPath, path: '/v1/request', method: 'POST', headers: { authorization: `Bearer ${auth.toString('hex')}`, 'content-type': 'application/json' }, timeout: 20_000 }, response => {
        const parts = []; let size = 0
        response.on('data', part => { size += part.length; if (size > 300_000) response.destroy(new Error('RESPONSE_TOO_LARGE')); else parts.push(part) })
        response.on('error', reject); response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) } catch (error) { reject(error) } })
      })
      request.on('error', reject); request.on('timeout', () => request.destroy(new Error('CONTROLLER_TIMEOUT')))
      request.end(JSON.stringify(command))
    })
  } finally { auth.fill(0) }
}
async function main(argv) {
  const [command, ...args] = argv
  if (command === 'serve' && args.length === 1) {
    const server = await serve(loadConfig(args[0]))
    process.stdout.write('Permission controller ready; autonomous signing disabled.\n')
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
    return
  }
  if (command === 'call' && args.length === 3) {
    const result = await client({ socketPath: args[0], tokenPath: args[1], command: JSON.parse(readFileSync(args[2], 'utf8')) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.ok) process.exitCode = 1
    return
  }
  process.stdout.write('Usage: node local/permission-controller/cli.mjs serve /absolute/config.json\n       node local/permission-controller/cli.mjs call /absolute/controller.sock /absolute/token /absolute/command.json\n')
  process.exitCode = 1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${errorCode(error)}\n`); process.exitCode = 1 })
