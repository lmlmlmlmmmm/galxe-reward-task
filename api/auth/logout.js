import { clearSessionCookie, requireAuth } from '../../lib/auth.js'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

export default function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      sendJson(res, 405, { message: 'Method Not Allowed' })
      return
    }

    if (!requireAuth(req, res)) {
      return
    }

    clearSessionCookie(res)
    sendJson(res, 200, { success: true })
  } catch (error) {
    sendJson(res, 500, { message: error.message || '退出登录失败' })
  }
}
