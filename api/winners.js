import { queryCampaignWinners } from '../lib/galxe.js'
import { requireAuth } from '../lib/auth.js'
import { getTableNames, loadAddressTexts } from '../lib/supabase.js'

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

    const taskUrl = String(req.body?.taskUrl || req.body?.campaignId || '').trim()

    if (!taskUrl) {
      sendJson(res, 400, { message: '缺少 taskUrl 或 campaignId' })
      return
    }

    const addressTexts = await loadAddressTexts()
    const result = await queryCampaignWinners(taskUrl, addressTexts)

    sendJson(res, 200, {
      ...result,
      source: {
        evm: `supabase:${getTableNames().evmAddress}`,
        sol: `supabase:${getTableNames().solAddress}`,
      },
    })
  } catch (error) {
    sendJson(res, 500, { message: error.message || '中奖查询失败' })
  }
}
