import Database from 'better-sqlite3'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { parseText, stringifyTaskMap, valuesToSequenceText } from '../src/utils/taskStore.js'

const SQLITE_FILE = process.env.SQLITE_FILE || 'data/app.db'
const TASKS_TABLE = process.env.SQLITE_TASKS_TABLE || 'tasks'
const EVM_ADDRESS_TABLE = process.env.SQLITE_EVM_ADDRESS_TABLE || 'evm_address'
const SOL_ADDRESS_TABLE = process.env.SQLITE_SOL_ADDRESS_TABLE || 'sol_address'

let cachedDb = null
let initialized = false

function resolveDatabasePath() {
  return path.resolve(process.cwd(), SQLITE_FILE)
}

function ensureDatabaseDirectory() {
  const dbPath = resolveDatabasePath()
  mkdirSync(path.dirname(dbPath), { recursive: true })
  return dbPath
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

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TASKS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_date TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      task_time TEXT,
      url TEXT NOT NULL,
      campaign_id TEXT,
      sequence_values TEXT NOT NULL DEFAULT '',
      need_create INTEGER NOT NULL DEFAULT 3,
      remark TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_${TASKS_TABLE}_date_sort
    ON ${TASKS_TABLE} (task_date, sort_order);

    CREATE TABLE IF NOT EXISTS ${EVM_ADDRESS_TABLE} (
      wallet_index INTEGER PRIMARY KEY,
      address TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ${SOL_ADDRESS_TABLE} (
      wallet_index INTEGER PRIMARY KEY,
      address TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)
}

export function getDb() {
  if (cachedDb) {
    return cachedDb
  }

  const dbPath = ensureDatabaseDirectory()
  cachedDb = new Database(dbPath)
  cachedDb.pragma('journal_mode = WAL')

  if (!initialized) {
    initializeSchema(cachedDb)
    initialized = true
  }

  return cachedDb
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
      sequenceText: valuesToSequenceText(String(row.sequence_values || '')),
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
      const sequenceValues = Array.isArray(task.sequenceValues)
        ? task.sequenceValues.map((value) => Number(value)).filter((value) => Number.isInteger(value))
        : String(task.sequenceText || '')
            .split(/\s+/)
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value))

      rows.push({
        task_date: taskDate,
        sort_order: index,
        task_time: normalizeTimeValue(task.time),
        url: String(task.url || '').trim(),
        campaign_id: normalizeCampaignId(task.url),
        sequence_values: valuesToSequenceText(sequenceValues),
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
  const db = getDb()
  const rows = db
    .prepare(`
      SELECT task_date, sort_order, task_time, url, sequence_values, need_create, remark
      FROM ${TASKS_TABLE}
      ORDER BY task_date ASC, sort_order ASC
    `)
    .all()

  return mapTaskRowsToTaskMap(rows)
}

export async function replaceTasksFromRawText(rawText) {
  return replaceTasksFromTaskMap(parseText(rawText))
}

export async function replaceTasksFromTaskMap(taskMap) {
  const db = getDb()
  const rows = mapTaskMapToRows(taskMap)
  const deleteStatement = db.prepare(`DELETE FROM ${TASKS_TABLE}`)
  const insertStatement = db.prepare(`
    INSERT INTO ${TASKS_TABLE} (task_date, sort_order, task_time, url, campaign_id, sequence_values, need_create, remark)
    VALUES (@task_date, @sort_order, @task_time, @url, @campaign_id, @sequence_values, @need_create, @remark)
  `)

  const transaction = db.transaction((nextRows) => {
    deleteStatement.run()

    for (const row of nextRows) {
      insertStatement.run(row)
    }
  })

  transaction(rows)
}

function loadAddressText(tableName) {
  const db = getDb()
  const rows = db
    .prepare(`
      SELECT wallet_index, address
      FROM ${tableName}
      WHERE is_active = 1
      ORDER BY wallet_index ASC
    `)
    .all()

  return rows.map((item) => String(item.address || '').trim()).filter(Boolean).join('\n')
}

export async function loadAddressTexts() {
  const [evm, sol] = await Promise.all([
    Promise.resolve(loadAddressText(EVM_ADDRESS_TABLE)),
    Promise.resolve(loadAddressText(SOL_ADDRESS_TABLE)),
  ])

  return { evm, sol }
}

export async function replaceAddressTable(tableName, addresses = []) {
  const db = getDb()
  const deleteStatement = db.prepare(`DELETE FROM ${tableName}`)
  const insertStatement = db.prepare(`
    INSERT INTO ${tableName} (wallet_index, address, remark, is_active)
    VALUES (@wallet_index, @address, @remark, @is_active)
  `)

  const rows = addresses.map((address, index) => ({
    wallet_index: index + 1,
    address: String(address || '').trim(),
    remark: '',
    is_active: 1,
  }))

  const transaction = db.transaction((nextRows) => {
    deleteStatement.run()

    for (const row of nextRows) {
      insertStatement.run(row)
    }
  })

  transaction(rows)
}
