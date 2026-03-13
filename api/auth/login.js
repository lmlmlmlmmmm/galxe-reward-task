import { createSessionToken, setSessionCookie, validateLogin } from '../../lib/auth.js'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

export default function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      sendJson(res, 405, { message: 'Method Not Allowed' })
      return
    }

    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')

    if (!username || !password) {
      sendJson(res, 400, { message: '请输入账号和密码' })
      return
    }

    if (!validateLogin(username, password)) {
      sendJson(res, 401, { message: '账号或密码错误' })
      return
    }

    setSessionCookie(res, createSessionToken(username))
    sendJson(res, 200, { success: true, username })
  } catch (error) {
    sendJson(res, 500, { message: error.message || '登录失败' })
  }
}
