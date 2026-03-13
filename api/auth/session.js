import { getSessionFromRequest } from '../../lib/auth.js'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

export default function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      sendJson(res, 405, { message: 'Method Not Allowed' })
      return
    }

    const session = getSessionFromRequest(req)

    if (!session) {
      sendJson(res, 401, { authenticated: false, message: '未登录或登录已过期' })
      return
    }

    sendJson(res, 200, {
      authenticated: true,
      username: session.username,
    })
  } catch (error) {
    sendJson(res, 500, { message: error.message || '获取登录状态失败' })
  }
}
