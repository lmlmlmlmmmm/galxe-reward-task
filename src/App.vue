<script setup>
import axios from 'axios'
import { computed, h, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  compareDateKey,
  compareTaskTime,
  normalizeNeedCreate,
  sequenceTextToValues,
  valuesToSequenceText,
} from './utils/taskStore'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const SOURCE_PATH = '/api/tasks'
const SOURCE_ENDPOINT = `${API_BASE_URL}/api/tasks`
const WINNER_ENDPOINT = `${API_BASE_URL}/api/winners`
const GALXE_ENDPOINT = 'https://graphigo.prd.galaxy.eco/query'
const AUTO_SAVE_DELAY = 400
const DAY_MS = 24 * 60 * 60 * 1000
const LOAD_TASK_PAGE_SIZE = 20
const sequenceOptions = Array.from({ length: 12 }, (_, index) => String(index + 1))
const needCreateOptions = [
  { value: '1', label: '做' },
  { value: '2', label: '不做' },
  { value: '3', label: '待定' },
]
const needCreateLabelMap = {
  '1': '做',
  '2': '不做',
  '3': '待定',
}
const needCreateTagTypeMap = {
  '1': 'success',
  '2': 'info',
  '3': 'warning',
}
const GALXE_LOAD_TASK_QUERY = `query CampaignList($input: ListCampaignInput!) {
  campaigns(input: $input) {
    pageInfo {
      endCursor
      hasNextPage
    }
    list {
      id
      endTime
      space {
        alias
      }
    }
  }
}`

const groupedTasks = ref({})
const loading = ref(false)
const saving = ref(false)
const sourceLoaded = ref(false)
const selectedDate = ref('')
const lastSavedAt = ref(null)
const lastSaveError = ref('')
const loadingCanDoTasks = ref(false)
const queryingTaskId = ref('')

let suspendAutoSave = false
let autoSaveTimer = null
let pendingSaveAfterCurrent = false

const sortedDates = computed(() => Object.keys(groupedTasks.value).sort(compareDateKey))
const currentDate = computed(() => selectedDate.value || sortedDates.value[0] || '')
const currentDateTasks = computed(() => groupedTasks.value[currentDate.value] || [])
const totalTaskCount = computed(() => Object.values(groupedTasks.value).reduce((sum, taskList) => sum + taskList.length, 0))
const doneTaskCount = computed(() =>
  Object.values(groupedTasks.value).reduce(
    (sum, taskList) => sum + taskList.filter((task) => normalizeNeedCreate(task.needCreate) === '1').length,
    0,
  ),
)
const pendingTaskCount = computed(() =>
  Object.values(groupedTasks.value).reduce(
    (sum, taskList) => sum + taskList.filter((task) => normalizeNeedCreate(task.needCreate) === '3').length,
    0,
  ),
)
const currentDateDoneCount = computed(() =>
  currentDateTasks.value.filter((task) => normalizeNeedCreate(task.needCreate) === '1').length,
)
const currentDatePendingCount = computed(() =>
  currentDateTasks.value.filter((task) => normalizeNeedCreate(task.needCreate) === '3').length,
)
const currentDateEmptyTimeCount = computed(() => currentDateTasks.value.filter((task) => !String(task.time || '').trim()).length)

const saveIndicator = computed(() => {
  if (loading.value) {
    return { type: 'info', text: '正在读取任务数据…' }
  }

  if (saving.value) {
    return { type: 'warning', text: '正在自动保存变更…' }
  }

  if (lastSaveError.value) {
    return { type: 'danger', text: `保存失败：${lastSaveError.value}` }
  }

  if (lastSavedAt.value) {
    return { type: 'success', text: `已自动保存 ${formatClock(lastSavedAt.value)}` }
  }

  if (sourceLoaded.value) {
    return { type: 'success', text: '任务数据已就绪，页面修改会自动保存' }
  }

  return { type: 'warning', text: '尚未读取到任务数据' }
})

const statusBanner = computed(() => {
  if (loading.value) {
    return {
      type: 'info',
      title: '正在读取任务数据',
      description: `当前数据接口：${SOURCE_PATH}`,
    }
  }

  if (saving.value) {
    return {
      type: 'warning',
      title: '正在自动保存修改',
      description: '你对任务列表的改动会自动同步到服务端。',
    }
  }

  if (lastSaveError.value) {
    return {
      type: 'error',
      title: '自动保存失败',
      description: `${lastSaveError.value}。请确认当前站点可以正常访问任务接口。`,
    }
  }

  if (lastSavedAt.value) {
    return {
      type: 'success',
      title: `已自动保存 ${formatClock(lastSavedAt.value)}`,
      description: '任务清单已同步到服务端，可继续编辑。',
    }
  }

  if (sourceLoaded.value) {
    return {
      type: 'success',
      title: '任务数据已加载完成',
      description: '现在可以按日期管理任务、查询结果并继续补充新任务。',
    }
  }

  return {
    type: 'warning',
    title: '还没有读取到任务数据',
    description: '请确认当前环境能够访问任务接口。',
  }
})

function formatClock(value) {
  const date = value instanceof Date ? value : new Date(value)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function formatMonthDayKey(date) {
  return `${date.getMonth() + 1}.${date.getDate()}`
}

function formatUnixTimeToClock(unixSeconds) {
  const timeValue = Number(unixSeconds || 0)

  if (!timeValue) {
    return ''
  }

  const date = new Date(timeValue * 1000)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function buildTaskId(dateKey, index, url) {
  const suffix = String(url || '')
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task'

  return `${dateKey}-${index}-${suffix}`
}

function sortTaskList(taskList) {
  taskList.sort((leftTask, rightTask) => compareTaskTime(leftTask, rightTask))
  return taskList
}

function sortGroupedTasksMap(taskMap) {
  const sortedMap = {}

  Object.entries(taskMap || {})
    .sort(([leftDate], [rightDate]) => compareDateKey(leftDate, rightDate))
    .forEach(([dateKey, taskList]) => {
      sortedMap[dateKey] = sortTaskList([...taskList])
    })

  return sortedMap
}

function syncCurrentDateTaskOrder() {
  const dateKey = currentDate.value
  if (!dateKey || !groupedTasks.value[dateKey]) {
    return
  }

  sortTaskList(groupedTasks.value[dateKey])
}

function parseDateKeyToTargetDate(dateKey) {
  const [month, day] = String(dateKey || '').split('.').map((value) => Number(value) || 0)

  if (!month || !day) {
    throw new Error('请先选择有效日期')
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const targetDate = new Date(today.getFullYear(), month - 1, day)
  targetDate.setHours(0, 0, 0, 0)

  if (targetDate.getMonth() + 1 !== month || targetDate.getDate() !== day) {
    throw new Error('日期格式不正确')
  }

  if (targetDate < today) {
    targetDate.setFullYear(targetDate.getFullYear() + 1)
  }

  return targetDate
}

function getLoadTargetDateKey() {
  return selectedDate.value || formatMonthDayKey(new Date())
}

function calculateDaysFromToday(dateKey) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const targetDate = parseDateKeyToTargetDate(dateKey)
  return Math.round((targetDate.getTime() - today.getTime()) / DAY_MS)
}

function getTargetUnixRange(days) {
  const targetDate = new Date()
  targetDate.setHours(0, 0, 0, 0)
  targetDate.setDate(targetDate.getDate() + days)

  const targetStart = Math.floor(targetDate.getTime() / 1000)
  const targetEndDate = new Date(targetDate)
  targetEndDate.setDate(targetEndDate.getDate() + 1)
  const targetEnd = Math.floor(targetEndDate.getTime() / 1000)

  return {
    targetDate,
    targetStart,
    targetEnd,
  }
}

function buildLoadTaskPayload(page) {
  return {
    operationName: 'CampaignList',
    variables: {
      input: {
        listType: 'Trending',
        gasTypes: null,
        excludeParent: false,
        types: null,
        rewardTypes: ['TOKEN', 'CUSTOM'],
        chains: null,
        isVerified: null,
        statuses: ['Active'],
        spaceCategories: null,
        backers: null,
        first: LOAD_TASK_PAGE_SIZE,
        after: String(page),
        searchString: null,
        claimableByUser: null,
        ecosystem: null,
        isRecurring: false,
      },
    },
    query: GALXE_LOAD_TASK_QUERY,
  }
}

function getAxiosErrorMessage(error, defaultMessage) {
  const errorMessage = error?.response?.data?.errors?.map((item) => item.message).filter(Boolean).join('；')
  const statusCode = error?.response?.status
  const causeMessage = error?.cause?.message || error?.message || ''

  return errorMessage || (statusCode ? `${defaultMessage}（${statusCode}）` : `${defaultMessage}：${causeMessage}`)
}

function buildExistingUrlSet() {
  const existingUrls = new Set()

  Object.values(groupedTasks.value).forEach((taskList) => {
    taskList.forEach((task) => {
      const url = String(task?.url || '').trim().toLowerCase()

      if (url) {
        existingUrls.add(url)
      }
    })
  })

  return existingUrls
}

function createTaskModel(task, dateKey, index) {
  return {
    id: task.id || buildTaskId(dateKey, index, task.url),
    time: String(task.time || '').trim(),
    url: String(task.url || '').trim(),
    sequenceValues: sequenceTextToValues(task.sequenceText),
    needCreate: normalizeNeedCreate(task.needCreate),
    remark: String(task.remark || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '',
  }
}

function buildSerializableTaskMap() {
  const nextTaskMap = {}

  Object.entries(groupedTasks.value)
    .sort(([leftDate], [rightDate]) => compareDateKey(leftDate, rightDate))
    .forEach(([dateKey, taskList]) => {
      nextTaskMap[dateKey] = [...taskList]
        .sort((leftTask, rightTask) => compareTaskTime(leftTask, rightTask))
        .map((task) => ({
          time: String(task.time || '').trim(),
          url: String(task.url || '').trim(),
          sequenceText: valuesToSequenceText(task.sequenceValues),
          needCreate: normalizeNeedCreate(task.needCreate),
          remark: String(task.remark || '').trim(),
        }))
    })

  return nextTaskMap
}

function clearAutoSaveTimer() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

function ensureDateBucket(dateKey) {
  if (!dateKey) {
    return
  }

  if (!groupedTasks.value[dateKey]) {
    groupedTasks.value[dateKey] = []
  }
}

function applyTaskMap(taskMap) {
  const normalizedTaskMap = taskMap || {}
  const nextTaskMap = {}

  Object.entries(normalizedTaskMap).forEach(([dateKey, taskList]) => {
    nextTaskMap[dateKey] = taskList.map((task, index) => createTaskModel(task, dateKey, index))
  })

  suspendAutoSave = true
  groupedTasks.value = sortGroupedTasksMap(nextTaskMap)

  if (selectedDate.value && !groupedTasks.value[selectedDate.value]) {
    selectedDate.value = ''
  }

  if (!selectedDate.value) {
    selectedDate.value = Object.keys(groupedTasks.value).sort(compareDateKey)[0] || ''
  }

  sourceLoaded.value = true
  lastSaveError.value = ''

  setTimeout(() => {
    suspendAutoSave = false
  }, 0)
}

async function requestSource(method, rawText = '') {
  const requestBody =
    method === 'POST'
      ? JSON.stringify({
          rawText,
          taskMap: buildSerializableTaskMap(),
        })
      : undefined

  const response = await fetch(SOURCE_ENDPOINT, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: requestBody,
  })

  let payload = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(payload?.message || `${method === 'GET' ? '读取' : '写入'}任务数据失败`)
  }

  return payload
}

async function requestCanDoTasks(days) {
  const range = getTargetUnixRange(days)
  const taskItemMap = new Map()
  let page = -1

  while (true) {
    let result = null

    try {
      const response = await axios.post(GALXE_ENDPOINT, buildLoadTaskPayload(page), {
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
        },
        timeout: 15000,
      })
      result = response.data
    } catch (error) {
      throw new Error(getAxiosErrorMessage(error, '加载当前日期任务失败'))
    }

    if (Array.isArray(result?.errors) && result.errors.length) {
      throw new Error(result.errors.map((item) => item.message).filter(Boolean).join('；') || 'Galxe 查询失败')
    }

    const campaigns = result?.data?.campaigns || {}
    const taskList = campaigns?.list || []

    taskList.forEach((task) => {
      const taskId = String(task?.id || '').trim()
      const spaceAlias = String(task?.space?.alias || '').trim()
      const endTime = Number(task?.endTime || 0)

      if (!taskId || !spaceAlias || !endTime) {
        return
      }

      if (range.targetStart <= endTime && endTime < range.targetEnd) {
        const taskUrl = `https://app.galxe.com/quest/${spaceAlias}/${taskId}`
        taskItemMap.set(taskUrl.toLowerCase(), {
          url: taskUrl,
          endTime,
          time: formatUnixTimeToClock(endTime),
        })
      }
    })

    if (!campaigns?.pageInfo?.hasNextPage) {
      break
    }

    page += LOAD_TASK_PAGE_SIZE
    await sleep(800)
  }

  return {
    days,
    targetDateKey: formatMonthDayKey(range.targetDate),
    taskItems: [...taskItemMap.values()].sort((leftTask, rightTask) => compareTaskTime(leftTask, rightTask)),
    taskUrls: [...taskItemMap.values()].map((item) => item.url),
    total: taskItemMap.size,
  }
}

async function requestWinnerQuery(taskUrl) {
  let payload = null

  try {
    const response = await fetch(WINNER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskUrl }),
    })

    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      throw new Error(payload?.message || '中奖查询接口请求失败')
    }
  } catch (error) {
    throw new Error(error.message || '中奖查询接口请求失败')
  }

  return payload
}

function formatLoadTaskResultText(result) {
  const lines = []
  const loadedTasks = Array.isArray(result?.loadedTasks) ? result.loadedTasks : []
  const skippedTasks = Array.isArray(result?.skippedTasks) ? result.skippedTasks : []

  lines.push(`目标日期：${result?.targetDateKey || '-'}`)
  lines.push(`抓取链接总数：${result?.totalFetched ?? 0}`)
  lines.push(`新增链接：${loadedTasks.length}`)
  lines.push(`跳过重复：${skippedTasks.length}`)
  lines.push('')
  lines.push('新增链接明细：')

  if (loadedTasks.length) {
    loadedTasks.forEach((task, index) => {
      lines.push(`${index + 1}. ${task.time || '--:--'} | ${task.url}`)
    })
  } else {
    lines.push('无')
  }

  lines.push('')
  lines.push('跳过重复明细：')

  if (skippedTasks.length) {
    skippedTasks.forEach((task, index) => {
      lines.push(`${index + 1}. ${task.time || '--:--'} | ${task.url}`)
    })
  } else {
    lines.push('无')
  }

  return lines.join('\n')
}

async function loadCanDoTasks() {
  const targetDateKey = getLoadTargetDateKey()
  const days = calculateDaysFromToday(targetDateKey)

  loadingCanDoTasks.value = true

  try {
    const payload = await requestCanDoTasks(days)
    const taskItems = Array.isArray(payload?.taskItems) ? payload.taskItems : []
    const existingUrls = buildExistingUrlSet()
    const newTaskItems = []
    const skippedTaskItems = []
    let duplicateCount = 0

    taskItems.forEach((taskItem) => {
      const normalizedUrl = String(taskItem?.url || '').trim()

      if (!normalizedUrl) {
        return
      }

      const urlKey = normalizedUrl.toLowerCase()
      if (existingUrls.has(urlKey)) {
        duplicateCount += 1
        skippedTaskItems.push({
          url: normalizedUrl,
          time: String(taskItem?.time || '').trim(),
        })
        return
      }

      existingUrls.add(urlKey)
      newTaskItems.push({
        url: normalizedUrl,
        time: String(taskItem?.time || '').trim(),
      })
    })

    if (newTaskItems.length) {
      ensureDateBucket(targetDateKey)

      newTaskItems.forEach((taskItem) => {
        groupedTasks.value[targetDateKey].push(
          createTaskModel(
            {
              time: taskItem.time,
              url: taskItem.url,
              sequenceText: '',
              needCreate: '3',
              remark: '',
            },
            targetDateKey,
            groupedTasks.value[targetDateKey].length,
          ),
        )
      })

      syncCurrentDateTaskOrder()
    }

    selectedDate.value = targetDateKey

    const resultText = formatLoadTaskResultText({
      targetDateKey,
      totalFetched: taskItems.length,
      loadedTasks: newTaskItems,
      skippedTasks: skippedTaskItems,
    })

    console.log(resultText)

    await ElMessageBox.alert(
      h('div', { class: 'winner-result-scroll' }, [h('pre', { class: 'winner-result-pre' }, resultText)]),
      '加载所选日期任务结果',
      {
        confirmButtonText: '知道了',
        customClass: 'winner-result-box',
      },
    )

    if (newTaskItems.length) {
      ElMessage.success(`已加载 ${targetDateKey} 任务：新增 ${newTaskItems.length} 条，跳过 ${duplicateCount} 条重复链接`)
      return
    }

    if (taskItems.length) {
      ElMessage.info(`没有新增链接，已跳过 ${duplicateCount} 条重复链接`)
      return
    }

    ElMessage.info(`${targetDateKey} 没有可加载任务`)
  } catch (error) {
    ElMessage.error(error.message || '加载当前日期任务失败')
  } finally {
    loadingCanDoTasks.value = false
  }
}

async function loadSourceTasks() {
  clearAutoSaveTimer()
  loading.value = true

  try {
    const payload = await requestSource('GET')
    applyTaskMap(payload?.taskMap || {})
  } catch (error) {
    sourceLoaded.value = false
    lastSaveError.value = error.message || '读取任务数据失败'
  } finally {
    loading.value = false
  }
}

async function saveTasksToSource({ silent = false } = {}) {
  if (saving.value) {
    pendingSaveAfterCurrent = true
    return
  }

  saving.value = true
  lastSaveError.value = ''

  try {
    await requestSource('POST')
    lastSavedAt.value = new Date()

    if (!silent) {
      ElMessage.success('已保存任务变更')
    }
  } catch (error) {
    lastSaveError.value = error.message || '写入任务数据失败'

    if (!silent) {
      ElMessage.error(lastSaveError.value)
    }
  } finally {
    saving.value = false

    if (pendingSaveAfterCurrent) {
      pendingSaveAfterCurrent = false
      scheduleAutoSave(0)
    }
  }
}

function scheduleAutoSave(delay = AUTO_SAVE_DELAY) {
  if (suspendAutoSave || !sourceLoaded.value) {
    return
  }

  clearAutoSaveTimer()
  autoSaveTimer = setTimeout(() => {
    saveTasksToSource({ silent: true })
  }, delay)
}

function updateTaskTime(task, value) {
  task.time = String(value || '').trim()
  syncCurrentDateTaskOrder()
}

async function copyText(text) {
  if (!text) {
    ElMessage.warning('没有可复制的内容')
    return
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', 'readonly')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    ElMessage.success('已复制')
  } catch (error) {
    ElMessage.error(error.message || '复制失败')
  }
}

function openTaskUrl(url) {
  if (!url) {
    ElMessage.warning('没有可打开的链接')
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function formatWinnerResultText(result) {
  const lines = []
  const winners = Array.isArray(result?.winners) ? result.winners : []
  const matchedWinners = Array.isArray(result?.matchedWinners) ? result.matchedWinners : []

  if (result?.taskUrl) {
    lines.push(`任务链接：${result.taskUrl}`)
  }

  lines.push(`活动 ID：${result?.campaignId || '-'}`)

  if (result?.participantsCount) {
    lines.push(`参与人数：${result.participantsCount}`)
  }

  lines.push(`中奖名单：${result?.totalWinners ?? 0}`)
  lines.push(`我的 EVM 钱包：${result?.walletSummary?.evm ?? 0}`)
  lines.push(`我的 SOL 钱包：${result?.walletSummary?.sol ?? 0}`)
  lines.push(`我的中奖数量：${result?.matchedCount ?? 0}`)
  lines.push('')

  if (matchedWinners.length) {
    lines.push('命中的钱包：')
    matchedWinners.forEach((item) => {
      lines.push(`${item.order}. [${String(item.type || '').toUpperCase()} 钱包 #${item.walletIndex}] ${item.address}`)
    })
  } else {
    lines.push('命中的钱包：无')
  }

  lines.push('')
  lines.push('完整中奖名单：')

  if (winners.length) {
    winners.forEach((item) => {
      const walletType = String(item.type || '').toUpperCase()
      const mineTag = item.isMine ? `  <- 我的钱包 #${item.walletIndex}` : ''
      lines.push(`${item.order}. [${walletType}] ${item.address}${mineTag}`)
    })
  } else {
    lines.push('无')
  }

  return lines.join('\n')
}

async function queryWinner(task) {
  const taskUrl = String(task?.url || '').trim()

  if (!taskUrl) {
    ElMessage.warning('请先填写 Galxe 任务链接')
    return
  }

  queryingTaskId.value = task.id

  try {
    const result = await requestWinnerQuery(taskUrl)
    const resultText = formatWinnerResultText(result)

    console.log(resultText)

    document.body.classList.add('winner-result-lock')

    try {
      await ElMessageBox.alert(
        h('div', { class: 'winner-result-scroll' }, [h('pre', { class: 'winner-result-pre' }, resultText)]),
        '中奖查询结果',
        {
          confirmButtonText: '知道了',
          customClass: 'winner-result-box',
          modalClass: 'winner-result-modal',
        },
      )
    } finally {
      document.body.classList.remove('winner-result-lock')
    }
  } catch (error) {
    ElMessage.error(error.message || '查询中奖结果失败')
  } finally {
    queryingTaskId.value = ''
  }
}

async function removeTask(taskId) {
  try {
    await ElMessageBox.confirm('确认删除这条任务吗？', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  const taskList = currentDateTasks.value
  const taskIndex = taskList.findIndex((task) => task.id === taskId)

  if (taskIndex === -1) {
    return
  }

  taskList.splice(taskIndex, 1)
  syncCurrentDateTaskOrder()

  if (!taskList.length) {
    delete groupedTasks.value[currentDate.value]
    selectedDate.value = sortedDates.value[0] || ''
  }

  ElMessage.success('任务已删除，稍后会自动保存')
}

async function removeSelectedDateTasks() {
  const targetDateKey = selectedDate.value || ''

  if (!targetDateKey) {
    ElMessage.warning('请先选择日期')
    return
  }

  const taskList = groupedTasks.value[targetDateKey]

  if (!taskList || !taskList.length) {
    ElMessage.info('当前日期没有任务可删除')
    return
  }

  try {
    await ElMessageBox.confirm(`确认删除 ${targetDateKey} 的全部任务吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  delete groupedTasks.value[targetDateKey]

  if (selectedDate.value === targetDateKey) {
    const nextDates = Object.keys(groupedTasks.value).sort(compareDateKey)
    selectedDate.value = nextDates[0] || ''
  }

  ElMessage.success(`已删除 ${targetDateKey} 全部任务，稍后会自动保存`)
}

loadSourceTasks()

watch(
  groupedTasks,
  () => {
    scheduleAutoSave()
  },
  { deep: true },
)
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__title">
        <h1>Galxe 任务面板</h1>
        <p>按日期管理任务，列表按结束时间升序排列，编辑会自动保存</p>
      </div>
      <div class="save-indicator" :class="`save-indicator--${saveIndicator.type}`">
        <span class="save-indicator__dot"></span>
        <span class="save-indicator__text">{{ saveIndicator.text }}</span>
      </div>
    </header>

    <section class="stats">
      <div class="stat-card">
        <span class="stat-card__label">当前日期</span>
        <span class="stat-card__value font-data">{{ currentDate || '—' }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">当日任务</span>
        <span class="stat-card__value font-data">{{ currentDateTasks.length }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">当日要做</span>
        <span class="stat-card__value font-data">{{ currentDateDoneCount }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">当日待定</span>
        <span class="stat-card__value font-data">{{ currentDatePendingCount }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">总任务</span>
        <span class="stat-card__value font-data">{{ totalTaskCount }}</span>
      </div>
    </section>

    <section class="toolbar">
      <div class="toolbar__group">
        <el-date-picker
          v-model="selectedDate"
          type="date"
          format="M月D日"
          value-format="M.D"
          placeholder="选择日期"
          class="date-picker"
        />
        <el-select v-model="selectedDate" clearable placeholder="切换已有日期" class="date-select">
          <el-option v-for="dateItem in sortedDates" :key="dateItem" :label="dateItem" :value="dateItem" />
        </el-select>
      </div>
      <div class="toolbar__group">
        <el-button type="primary" :loading="loadingCanDoTasks" @click="loadCanDoTasks">加载任务</el-button>
        <el-button @click="removeSelectedDateTasks">清除当日</el-button>
      </div>
    </section>

    <section class="task-section">
      <header class="task-section__head">
        <div class="task-section__title">
          <h2>任务列表</h2>
          <span class="task-section__count font-data">{{ currentDateTasks.length }} 条</span>
        </div>
      </header>

      <el-empty v-if="!loading && !currentDateTasks.length" description="当前日期暂无任务" />

      <div v-else class="task-table-wrap" v-loading="loading">
        <table class="task-table">
          <thead>
            <tr>
              <th class="col-time">时间</th>
              <th class="col-sequence">序号</th>
              <th class="col-status">状态</th>
              <th class="col-url">任务链接</th>
              <th class="col-remark">备注</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in currentDateTasks" :key="task.id">
              <td>
                <el-input
                  :model-value="task.time"
                  maxlength="5"
                  placeholder="HH:mm"
                  size="small"
                  class="font-data"
                  @update:model-value="updateTaskTime(task, $event)"
                />
              </td>
              <td>
                <el-checkbox-group v-model="task.sequenceValues" class="sequence-grid">
                  <el-checkbox v-for="item in sequenceOptions" :key="item" :label="item">{{ item }}</el-checkbox>
                </el-checkbox-group>
              </td>
              <td>
                <el-radio-group v-model="task.needCreate" size="small" class="status-group">
                  <el-radio-button v-for="item in needCreateOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
                </el-radio-group>
              </td>
              <td class="url-cell">
                <div class="url-content">
                  <a
                    v-if="task.url"
                    :href="task.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="url-link font-data"
                    :title="task.url"
                  >{{ task.url }}</a>
                  <span v-else class="url-empty">—</span>
                </div>
              </td>
              <td>
                <el-input v-model="task.remark" placeholder="备注" size="small" maxlength="20" />
              </td>
              <td class="actions-cell">
                <el-button v-if="task.url" link type="primary" size="small" @click="copyText(task.url)">复制</el-button>
                <el-button link type="primary" size="small" :loading="queryingTaskId === task.id" @click="queryWinner(task)">查询</el-button>
                <el-button link type="danger" size="small" @click="removeTask(task.id)">删除</el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  width: min(1280px, calc(100vw - 48px));
  margin: 0 auto;
  padding: 32px 0 64px;
}

.page__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
}

.page__title h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.page__title p {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.save-indicator__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.save-indicator--success .save-indicator__dot { background-color: var(--success); }
.save-indicator--info .save-indicator__dot { background-color: var(--info); }
.save-indicator--warning .save-indicator__dot { background-color: var(--warning); }
.save-indicator--danger .save-indicator__dot { background-color: var(--danger); }

.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 16px 20px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
}

.stat-card__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-card__value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px;
  margin-bottom: 24px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.toolbar__group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.date-picker,
.date-select {
  width: 160px;
}

.task-section {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.task-section__head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-muted);
}

.task-section__title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.task-section__title h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.task-section__count {
  font-size: 13px;
  color: var(--text-secondary);
}

.task-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.task-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.task-table th {
  padding: 12px 16px;
  text-align: left;
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.task-table td {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}

.task-table tbody tr:hover {
  background-color: var(--bg-muted);
}

.col-time { width: 100px; }
.col-sequence { width: 220px; }
.col-status { width: 180px; }
.col-url { width: auto; }
.col-remark { width: 160px; }
.col-actions { width: 150px; text-align: right; }

.url-cell {
  max-width: 0;
}

.url-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-link {
  color: var(--accent-primary);
  text-decoration: none;
  font-size: 12px;
}

.url-link:hover {
  text-decoration: underline;
}

.url-empty {
  color: var(--text-muted);
}

.actions-cell {
  text-align: right;
  white-space: nowrap;
}

.sequence-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
}

.sequence-grid :deep(.el-checkbox) {
  height: 24px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sequence-grid :deep(.el-checkbox.is-checked) {
  background-color: var(--accent-primary);
  border-color: var(--accent-primary);
}

.sequence-grid :deep(.el-checkbox__input) {
  display: none;
}

.sequence-grid :deep(.el-checkbox__label) {
  padding: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-data);
}

.sequence-grid :deep(.el-checkbox.is-checked .el-checkbox__label) {
  color: #ffffff;
}

.status-group {
  width: 100%;
  display: flex;
}

.status-group :deep(.el-radio-button) {
  flex: 1;
}

.status-group :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 6px 4px;
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-surface);
  border-color: var(--border-color);
  color: var(--text-secondary);
}

.status-group :deep(.el-radio-button.is-active:nth-child(1) .el-radio-button__inner) {
  background-color: var(--success);
  border-color: var(--success);
  color: #ffffff;
}

.status-group :deep(.el-radio-button.is-active:nth-child(2) .el-radio-button__inner) {
  background-color: var(--text-muted);
  border-color: var(--text-muted);
  color: #ffffff;
}

.status-group :deep(.el-radio-button.is-active:nth-child(3) .el-radio-button__inner) {
  background-color: var(--warning);
  border-color: var(--warning);
  color: #ffffff;
}

/* Element Plus Customizations */
:deep(.el-input__wrapper) {
  background-color: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--border-color) inset;
}

:deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--border-hover) inset;
}

:deep(.el-input.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--accent-primary) inset !important;
}

:deep(.el-input__inner) {
  color: var(--text-primary);
}

@media (max-width: 1024px) {
  .stats {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .page {
    width: calc(100vw - 32px);
    padding: 24px 0;
  }

  .stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar__group {
    justify-content: space-between;
  }

  .date-picker, .date-select {
    flex: 1;
  }

  .task-table {
    min-width: 800px;
  }
}
</style>


<style>
.winner-result-box {
  width: min(1080px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  height: min(80vh, 900px);
  max-height: calc(100vh - 24px);
  margin: 12px auto;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
}

.winner-result-modal .el-overlay-message-box {
  overflow: hidden;
}

body.winner-result-lock {
  overflow: hidden;
}

.winner-result-box .el-message-box__header {
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.winner-result-box .el-message-box__title {
  color: var(--text-primary);
  font-weight: 700;
}

.winner-result-box .el-message-box__content {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-body);
}

.winner-result-box .el-message-box__container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: hidden;
  gap: 0;
}

.winner-result-box .el-message-box__message {
  flex: 1;
  min-height: 0;
  padding: 0;
  margin: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.winner-result-box .el-message-box__btns {
  flex-shrink: 0;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.winner-result-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: transparent;
  width: 100%;
}

.winner-result-pre {
  display: block;
  margin: 0;
  padding: 20px 22px;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-data);
  min-height: 100%;
}
</style>
