import http from 'node:http'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tasksHandler from './api/tasks.js'
import winnersHandler from './api/winners.js'
import loginHandler from './api/auth/login.js'
import logoutHandler from './api/auth/logout.js'
import sessionHandler from './api/auth/session.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = __dirname
const distDir = path.join(rootDir, 'dist')
const publicIndexFile = path.join(distDir, 'index.html')
const envFile = path.join(rootDir, '.env')

function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const firstChar = value[0]
    const lastChar = value[value.length - 1]

    if ((firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'")) {
      return value.slice(1, -1)
    }
  }

  return value
}

async function loadEnvFile() {
  try {
    const content = await fs.readFile(envFile, 'utf8')

    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim()
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue
      }

      const separatorIndex = trimmedLine.indexOf('=')
      if (separatorIndex <= 0) {
        continue
      }

      const key = trimmedLine.slice(0, separatorIndex).trim()
      const rawValue = trimmedLine.slice(separatorIndex + 1).trim()
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        continue
      }

      process.env[key] = stripWrappingQuotes(rawValue)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

await loadEnvFile()

const port = Number(process.env.PORT || 3000)

const apiRoutes = new Map([
  ['/api/tasks', tasksHandler],
  ['/api/winners', winnersHandler],
  ['/api/auth/login', loginHandler],
  ['/api/auth/logout', logoutHandler],
  ['/api/auth/session', sessionHandler],
])

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

function enhanceResponse(res) {
  let statusCode = 200

  res.status = (nextStatusCode) => {
    statusCode = Number(nextStatusCode) || 200
    res.statusCode = statusCode
    return res
  }

  res.json = (payload) => {
    if (!res.headersSent) {
      res.statusCode = statusCode
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }

    res.end(JSON.stringify(payload))
  }

  res.send = (payload) => {
    if (!res.headersSent && !res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    }

    res.statusCode = statusCode
    res.end(payload)
  }

  return res
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
}

async function readRequestBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function enhanceRequest(req) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const rawBody = ['GET', 'HEAD'].includes(req.method || '') ? '' : await readRequestBody(req)
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()

  let body = undefined
  if (rawBody) {
    if (contentType === 'application/json') {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = null
      }
    } else if (contentType === 'application/x-www-form-urlencoded') {
      body = Object.fromEntries(new URLSearchParams(rawBody).entries())
    } else {
      body = rawBody
    }
  }

  req.url = requestUrl.pathname + requestUrl.search
  req.path = requestUrl.pathname
  req.query = Object.fromEntries(requestUrl.searchParams.entries())
  req.body = body
  req.rawBody = rawBody
  req.headers = normalizeHeaders(req.headers)

  return req
}

async function serveFile(filePath, res) {
  const extname = path.extname(filePath).toLowerCase()
  const contentType = mimeTypes[extname] || 'application/octet-stream'
  const fileBuffer = await fs.readFile(filePath)

  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.end(fileBuffer)
}

function resolveStaticFile(requestPath) {
  const normalizedPath = decodeURIComponent(requestPath.split('?')[0] || '/')
  const relativePath = normalizedPath === '/' ? 'index.html' : normalizedPath.replace(/^\/+/, '')
  const candidatePath = path.resolve(distDir, relativePath)

  if (!candidatePath.startsWith(distDir)) {
    return null
  }

  return candidatePath
}

async function serveStaticAsset(req, res) {
  const candidatePath = resolveStaticFile(req.url || '/')

  if (!candidatePath) {
    res.status(400).json({ message: '非法路径' })
    return true
  }

  try {
    const stats = await fs.stat(candidatePath)
    if (stats.isFile()) {
      await serveFile(candidatePath, res)
      return true
    }
  } catch {
  }

  try {
    await serveFile(publicIndexFile, res)
    return true
  } catch {
    res.status(404).json({ message: 'dist/index.html 不存在，请先执行 npm run build' })
    return true
  }
}

async function handleApiRequest(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const handler = apiRoutes.get(requestUrl.pathname)

  if (!handler) {
    res.status(404).json({ message: 'API Not Found' })
    return
  }

  await enhanceRequest(req)
  await handler(req, res)
}

const server = http.createServer(async (req, res) => {
  enhanceResponse(res)
  setSecurityHeaders(res)

  try {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApiRequest(req, res)
      return
    }

    await serveStaticAsset(req, res)
  } catch (error) {
    if (!res.writableEnded) {
      res.status(500).json({ message: error?.message || '服务器内部错误' })
    }
  }
})

server.listen(port, () => {
  console.log(`Server listening on http://0.0.0.0:${port}`)
})
