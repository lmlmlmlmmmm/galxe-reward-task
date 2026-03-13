import crypto from 'node:crypto'

const SESSION_COOKIE_NAME = 'galxe_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim()

  if (!value) {
    throw new Error(`缺少环境变量 ${name}`)
  }

  return value
}

function getAuthConfig() {
  return {
    username: getRequiredEnv('APP_LOGIN_USERNAME'),
    password: getRequiredEnv('APP_LOGIN_PASSWORD'),
    secret: getRequiredEnv('AUTH_SESSION_SECRET'),
  }
}

function signValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function validateLogin(username, password) {
  const config = getAuthConfig()
  return safeEqual(username, config.username) && safeEqual(password, config.password)
}

export function createSessionToken(username) {
  const { secret } = getAuthConfig()
  const payload = {
    username,
    exp: Date.now() + SESSION_TTL_MS,
  }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = signValue(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token) {
  const { secret } = getAuthConfig()
  const [encodedPayload, signature] = String(token || '').split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = signValue(encodedPayload, secret)
  if (!safeEqual(signature, expectedSignature)) {
    return null
  }

  let payload = null

  try {
    payload = JSON.parse(fromBase64Url(encodedPayload))
  } catch {
    return null
  }

  if (!payload?.username || !payload?.exp || Number(payload.exp) <= Date.now()) {
    return null
  }

  return payload
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookieMap, item) => {
      const separatorIndex = item.indexOf('=')
      const key = separatorIndex >= 0 ? item.slice(0, separatorIndex).trim() : item.trim()
      const value = separatorIndex >= 0 ? item.slice(separatorIndex + 1).trim() : ''

      if (key) {
        cookieMap[key] = value
      }

      return cookieMap
    }, {})
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie)
  return verifySessionToken(cookies[SESSION_COOKIE_NAME])
}

export function setSessionCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production'
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]

  if (isProduction) {
    parts.push('Secure')
  }

  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ]

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }

  res.setHeader('Set-Cookie', parts.join('; '))
}

export function requireAuth(req, res) {
  try {
    const session = getSessionFromRequest(req)

    if (session) {
      return session
    }

    res.status(401).json({ message: '未登录或登录已过期' })
    return null
  } catch (error) {
    res.status(500).json({ message: error.message || '认证校验失败' })
    return null
  }
}
