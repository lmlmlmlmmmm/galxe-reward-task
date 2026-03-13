import { createClient } from '@supabase/supabase-js'
import { parseText, stringifyTaskMap, valuesToSequenceText } from '../src/utils/taskStore.js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TASKS_TABLE = process.env.SUPABASE_TASKS_TABLE || 'tasks'
const EVM_ADDRESS_TABLE = process.env.SUPABASE_EVM_ADDRESS_TABLE || 'evm_address'
const SOL_ADDRESS_TABLE = process.env.SUPABASE_SOL_ADDRESS_TABLE || 'sol_address'

let cachedClient = null

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`)
  }
}

function formatDateKeyFromDate(value) {
  const date = new Date(value)
  return `${date.getUTCMonth() + 1}.${date.getUTCDate()}`
}

function parseDateKeyToIsoDate(dateKey) {
  const [month, day] = String(dateKey || '').split('.').map((value) => Number(value) || 0)

  if (!month || !day) {
    throw new Error(`无效日期键：${dateKey}`)
  }

  const today = new Date()
  const targetDate = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day))
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

  if (targetDate.getTime() < todayStart) {
    targetDate.setUTCFullYear(targetDate.getUTCFullYear() + 1)
  }

  return targetDate.toISOString().slice(0, 10)
}

function normalizeTimeValue(value) {
  const timeValue = String(value || '').trim()
  return timeValue ? `${timeValue}:00` : null
}

function normalizeCampaignId(url) {
  const rawValue = String(url || '').trim()

  if (!rawValue) {
    return null
  }

  if (!/^https?:\/\//i.test(rawValue)) {
    return rawValue
  }

  try {
    const parsedUrl = new URL(rawValue)
    return parsedUrl.pathname.split('/').filter(Boolean).at(-1) || null
  } catch {
    return null
  }
}

export function getSupabaseClient() {
  if (cachedClient) {
    return cachedClient
  }

  requireEnv('SUPABASE_URL', SUPABASE_URL)
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)

  cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return cachedClient
}

export function getTableNames() {
  return {
    tasks: TASKS_TABLE,
    evmAddress: EVM_ADDRESS_TABLE,
    solAddress: SOL_ADDRESS_TABLE,
  }
}

function mapTaskRowsToTaskMap(rows) {
  const taskMap = {}

  ;(rows || []).forEach((row) => {
    const dateKey = formatDateKeyFromDate(row.task_date)

    if (!taskMap[dateKey]) {
      taskMap[dateKey] = []
    }

    taskMap[dateKey].push({
      time: row.task_time ? String(row.task_time).slice(0, 5) : '',
      url: String(row.url || '').trim(),
      sequenceText: valuesToSequenceText(Array.isArray(row.sequence_values) ? row.sequence_values : []),
      needCreate: String(row.need_create || 3),
      remark: String(row.remark || '').trim(),
    })
  })

  return taskMap
}

function mapTaskMapToRows(taskMap) {
  const rows = []

  Object.entries(taskMap || {}).forEach(([dateKey, taskList]) => {
    const taskDate = parseDateKeyToIsoDate(dateKey)

    ;(taskList || []).forEach((task, index) => {
      rows.push({
        task_date: taskDate,
        sort_order: index,
        task_time: normalizeTimeValue(task.time),
        url: String(task.url || '').trim(),
        campaign_id: normalizeCampaignId(task.url),
        sequence_values: Array.isArray(task.sequenceValues)
          ? task.sequenceValues.map((value) => Number(value)).filter((value) => Number.isInteger(value))
          : String(task.sequenceText || '')
              .split(/\s+/)
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value)),
        need_create: Number(task.needCreate || 3) || 3,
        remark: String(task.remark || '').trim(),
      })
    })
  })

  return rows
}

export async function loadTasksAsRawText() {
  return stringifyTaskMap(await loadTasksAsTaskMap())
}

export async function loadTasksAsTaskMap() {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from(TASKS_TABLE)
    .select('task_date, sort_order, task_time, url, sequence_values, need_create, remark')
    .order('task_date', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(`读取任务列表失败：${error.message}`)
  }

  return mapTaskRowsToTaskMap(data || [])
}

export async function replaceTasksFromRawText(rawText) {
  return replaceTasksFromTaskMap(parseText(rawText))
}

export async function replaceTasksFromTaskMap(taskMap) {
  const client = getSupabaseClient()
  const rows = mapTaskMapToRows(taskMap)

  const { error: deleteError } = await client.from(TASKS_TABLE).delete().gte('sort_order', 0)

  if (deleteError) {
    throw new Error(`清空任务列表失败：${deleteError.message}`)
  }

  if (!rows.length) {
    return
  }

  const { error: insertError } = await client.from(TASKS_TABLE).insert(rows)

  if (insertError) {
    throw new Error(`写入任务列表失败：${insertError.message}`)
  }
}

async function loadAddressText(tableName) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from(tableName)
    .select('wallet_index, address')
    .eq('is_active', true)
    .order('wallet_index', { ascending: true })

  if (error) {
    throw new Error(`读取地址表失败：${error.message}`)
  }

  return (data || []).map((item) => String(item.address || '').trim()).filter(Boolean).join('\n')
}

export async function loadAddressTexts() {
  const [evm, sol] = await Promise.all([
    loadAddressText(EVM_ADDRESS_TABLE),
    loadAddressText(SOL_ADDRESS_TABLE),
  ])

  return { evm, sol }
}

export async function replaceAddressTable(tableName, addresses = []) {
  const client = getSupabaseClient()
  const rows = addresses.map((address, index) => ({
    wallet_index: index + 1,
    address: String(address || '').trim(),
    remark: '',
    is_active: true,
  }))

  const { error: deleteError } = await client.from(tableName).delete().gte('wallet_index', 1)

  if (deleteError) {
    throw new Error(`清空地址表失败：${deleteError.message}`)
  }

  if (!rows.length) {
    return
  }

  const { error: insertError } = await client.from(tableName).insert(rows)

  if (insertError) {
    throw new Error(`写入地址表失败：${insertError.message}`)
  }
}
