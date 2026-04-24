import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getTableNames, replaceAddressTable, replaceTasksFromRawText } from '../lib/sqlite.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'data')

async function readTextFile(fileName) {
  return readFile(path.join(dataDir, fileName), 'utf8')
}

function parseAddressText(rawText) {
  return String(rawText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function main() {
  const [tasksText, evmText, solText] = await Promise.all([
    readTextFile('tasks.txt'),
    readTextFile('evm_address.txt'),
    readTextFile('sol_address.txt'),
  ])

  const tableNames = getTableNames()

  await replaceTasksFromRawText(tasksText)
  await replaceAddressTable(tableNames.evmAddress, parseAddressText(evmText))
  await replaceAddressTable(tableNames.solAddress, parseAddressText(solText))

  console.log('SQLite 导入完成：')
  console.log(`- tasks -> ${tableNames.tasks}`)
  console.log(`- evm_address -> ${tableNames.evmAddress}`)
  console.log(`- sol_address -> ${tableNames.solAddress}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exitCode = 1
})
