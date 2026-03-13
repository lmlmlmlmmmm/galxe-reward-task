import {
  getTableNames,
  loadTasksAsRawText,
  loadTasksAsTaskMap,
  replaceTasksFromRawText,
  replaceTasksFromTaskMap,
} from '../lib/supabase.js'
import { requireAuth } from '../lib/auth.js'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

export default async function handler(req, res) {
  try {
    if (!requireAuth(req, res)) {
      return
    }

    if (req.method === 'GET') {
      const [taskMap, rawText] = await Promise.all([loadTasksAsTaskMap(), loadTasksAsRawText()])
      sendJson(res, 200, {
        taskMap,
        rawText,
        source: `supabase:${getTableNames().tasks}`,
      })
      return
    }

    if (req.method === 'POST') {
      const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText : null
      const taskMap = req.body?.taskMap && typeof req.body.taskMap === 'object' ? req.body.taskMap : null

      if (rawText == null && taskMap == null) {
        sendJson(res, 400, { message: 'rawText 或 taskMap 至少提供一个' })
        return
      }

      if (taskMap) {
        await replaceTasksFromTaskMap(taskMap)
      } else {
        await replaceTasksFromRawText(rawText)
      }

      sendJson(res, 200, { success: true })
      return
    }

    sendJson(res, 405, { message: 'Method Not Allowed' })
  } catch (error) {
    sendJson(res, 500, { message: error.message || '任务接口执行失败' })
  }
}
