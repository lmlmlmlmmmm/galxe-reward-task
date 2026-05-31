import { requireAuth } from '../lib/auth.js'
import { queryCampaignList } from '../lib/galxe.js'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

export default async function handler(req, res) {
  try {
    if (!requireAuth(req, res)) {
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { message: 'Method Not Allowed' })
      return
    }

    const input = req.body?.input

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      sendJson(res, 400, { message: '缺少有效的 input 参数' })
      return
    }

    const result = await queryCampaignList(input)
    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, 500, { message: error.message || '加载当前日期任务失败' })
  }
}
