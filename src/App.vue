<script setup>
import axios from 'axios'
import Sortable from 'sortablejs'
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  compareDateKey,
  normalizeNeedCreate,
  sequenceTextToValues,
  valuesToSequenceText,
} from './utils/taskStore'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const SOURCE_PATH = 'Supabase tasks'
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
const taskTableRef = ref(null)

let suspendAutoSave = false
let autoSaveTimer = null
let pendingSaveAfterCurrent = false
let taskSorter = null

const sortedDates = computed(() => Object.keys(groupedTasks.value).sort(compareDateKey))
const currentDate = computed(() => selectedDate.value || sortedDates.value[0] || '')
const currentDateTasks = computed(() => groupedTasks.value[currentDate.value] || [])
const totalTaskCount = computed(() => Object.values(groupedTasks.value).reduce((sum, taskList) => sum + taskList.length, 0))

const saveIndicator = computed(() => {
  if (loading.value) {
    return { type: 'info', text: '正在读取云端任务源…' }
  }

  if (saving.value) {
    return { type: 'warning', text: '正在自动保存到云端…' }
  }

  if (lastSaveError.value) {
    return { type: 'danger', text: `保存失败：${lastSaveError.value}` }
  }

  if (lastSavedAt.value) {
    return { type: 'success', text: `已自动保存 ${formatClock(lastSavedAt.value)}` }
  }

  if (sourceLoaded.value) {
    return { type: 'success', text: '已连接 Supabase，页面修改会自动保存' }
  }

  return { type: 'warning', text: '尚未读取到云端任务源' }
})

const statusBanner = computed(() => {
  if (loading.value) {
    return {
      type: 'info',
      title: '正在读取云端任务源',
      description: `当前数据源：${SOURCE_PATH}`,
    }
  }

  if (saving.value) {
    return {
      type: 'warning',
      title: '正在自动保存到云端',
      description: `当前数据源：${SOURCE_PATH}`,
    }
  }

  if (lastSaveError.value) {
    return {
      type: 'error',
      title: '保存云端任务源失败',
      description: `${lastSaveError.value}。请确认 Vercel API 和 Supabase 环境变量已经配置完成。当前数据源：${SOURCE_PATH}`,
    }
  }

  if (lastSavedAt.value) {
    return {
      type: 'success',
      title: `已自动保存 ${formatClock(lastSavedAt.value)}`,
      description: `当前数据源：${SOURCE_PATH}`,
    }
  }

  if (sourceLoaded.value) {
    return {
      type: 'success',
      title: '已读取云端任务源，页面修改会自动保存',
      description: `当前数据源：${SOURCE_PATH}`,
    }
  }

  return {
    type: 'warning',
    title: '还没有读取到云端任务源',
    description: `请确认当前站点可以访问 Vercel API。当前数据源：${SOURCE_PATH}`,
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

  Object.entries(groupedTasks.value).forEach(([dateKey, taskList]) => {
    nextTaskMap[dateKey] = taskList.map((task) => ({
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

function destroyTaskSorter() {
  if (taskSorter) {
    taskSorter.destroy()
    taskSorter = null
  }
}

function getTaskTableBody() {
  const tableEl = taskTableRef.value?.$el
  if (!tableEl) {
    return null
  }

  return tableEl.querySelector('.el-table__body-wrapper tbody')
}

function moveTaskItem(oldIndex, newIndex) {
  const dateKey = currentDate.value
  const taskList = groupedTasks.value[dateKey]

  if (!taskList || oldIndex === newIndex) {
    return
  }

  const movedItem = taskList.splice(oldIndex, 1)[0]
  if (!movedItem) {
    return
  }

  taskList.splice(newIndex, 0, movedItem)
}

async function initTaskSorter() {
  await nextTick()
  destroyTaskSorter()

  const tbody = getTaskTableBody()
  if (!tbody) {
    return
  }

  taskSorter = Sortable.create(tbody, {
    animation: 160,
    handle: '.drag-handle',
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    dragClass: 'drag-dragging',
    onEnd: (event) => {
      const oldIndex = event.oldIndex
      const newIndex = event.newIndex

      if (oldIndex == null || newIndex == null || oldIndex === newIndex) {
        return
      }

      moveTaskItem(oldIndex, newIndex)
    },
  })
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
  groupedTasks.value = nextTaskMap

  if (selectedDate.value && !nextTaskMap[selectedDate.value]) {
    selectedDate.value = ''
  }

  if (!selectedDate.value) {
    selectedDate.value = Object.keys(nextTaskMap).sort(compareDateKey)[0] || ''
  }

  sourceLoaded.value = true
  lastSaveError.value = ''

  nextTick(() => {
    suspendAutoSave = false
  })
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
    throw new Error(payload?.message || `${method === 'GET' ? '读取' : '写入'}云端任务源失败`)
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
    taskItems: [...taskItemMap.values()],
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
    lastSaveError.value = error.message || '读取云端任务源失败'
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
      ElMessage.success('已保存到 Supabase')
    }
  } catch (error) {
    lastSaveError.value = error.message || '写入云端任务源失败'

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

  if (!taskList.length) {
    delete groupedTasks.value[currentDate.value]
    selectedDate.value = sortedDates.value[0] || ''
  }

  ElMessage.success('任务已删除，稍后会自动保存到 Supabase')
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

  ElMessage.success(`已删除 ${targetDateKey} 全部任务，稍后会自动保存到 Supabase`)
}

onMounted(() => {
  loadSourceTasks()
  initTaskSorter()
})

onBeforeUnmount(() => {
  destroyTaskSorter()
})

watch(
  groupedTasks,
  () => {
    scheduleAutoSave()
  },
  { deep: true },
)

watch(
  () => [currentDate.value, currentDateTasks.value.length],
  () => {
    initTaskSorter()
  },
)
</script>

<template>
  <div class="page-shell">
    <el-card class="toolbar-card" shadow="never">
      <div class="panel-head">
        <div class="panel-copy">
          <div class="panel-badge">GALXE TASK CONSOLE</div>
          <div class="panel-title">Galxe 任务控制台</div>
          <div class="panel-subtitle">按日期加载、维护任务和查询结果，变更会自动保存到 Vercel API + Supabase。</div>
        </div>

        <div class="panel-stats">
          <div class="panel-stat">
            <span class="panel-stat-label">当前日期</span>
            <strong class="panel-stat-value">{{ currentDate || '未选择' }}</strong>
          </div>
          <div class="panel-stat">
            <span class="panel-stat-label">当日任务</span>
            <strong class="panel-stat-value">{{ currentDateTasks.length }}</strong>
          </div>
          <div class="panel-stat">
            <span class="panel-stat-label">总任务数</span>
            <strong class="panel-stat-value">{{ totalTaskCount }}</strong>
          </div>
        </div>
      </div>

      <div class="toolbar-row">
        <div class="toolbar-left">
          <el-date-picker
            v-model="selectedDate"
            type="date"
            format="M月D日"
            value-format="M.D"
            placeholder="选择日期"
            class="date-picker"
          />

          <el-select v-model="selectedDate" clearable placeholder="已有日期" class="date-select">
            <el-option v-for="dateItem in sortedDates" :key="dateItem" :label="dateItem" :value="dateItem" />
          </el-select>
        </div>

        <div class="toolbar-right">
          <el-button type="primary" :loading="loadingCanDoTasks" @click="loadCanDoTasks">加载所选日期任务</el-button>
          <el-button type="danger" plain @click="removeSelectedDateTasks">删除当前日期任务</el-button>
        </div>
      </div>

      <div class="summary-row">
        <el-tag :type="saveIndicator.type" effect="plain">{{ saveIndicator.text }}</el-tag>
        <span class="summary-source">当前数据源：{{ SOURCE_PATH }}</span>
      </div>

      <el-alert
        class="status-alert"
        :title="statusBanner.title"
        :description="statusBanner.description"
        :type="statusBanner.type"
        :closable="false"
        show-icon
      />

      <div class="summary-row summary-tip">
        <span class="summary-text">
          序号支持 `1-12` 勾选；“是否需要做”支持 `做 / 不做 / 待定`；任务可拖动排序；所有改动会自动保存到 Supabase。
        </span>
      </div>
    </el-card>

    <el-card class="table-card" shadow="never">
      <template #header>
        <div class="table-header">
          <div>
            <div class="table-title">Galxe 任务列表</div>
            <div class="table-subtitle">当前字段：拖动排序、结束时间、任务链接、序号、是否需要做、备注</div>
          </div>
          <div class="table-count">{{ currentDateTasks.length }} 条任务</div>
        </div>
      </template>

      <el-empty
        v-if="!loading && !currentDateTasks.length"
        description="当前日期没有任务，可点击“加载所选日期任务”"
      />

      <el-table
        v-else
        ref="taskTableRef"
        v-loading="loading"
        :data="currentDateTasks"
        row-key="id"
        border
        class="task-table"
        style="width: 100%"
      >
        <el-table-column label="拖动" width="72" align="center" class-name="drag-column">
          <template #default>
            <span class="drag-handle" title="拖动排序" aria-label="拖动排序"></span>
          </template>
        </el-table-column>
        <el-table-column label="结束时间" min-width="140">
          <template #default="scope">
            <span class="text-cell time-text">{{ scope.row.time || '-' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="Galxe 任务链接" min-width="520">
          <template #default="scope">
            <div class="url-cell">
              <span v-if="scope.row.url" class="text-cell url-text" :title="scope.row.url">{{ scope.row.url }}</span>
              <span v-else class="text-cell">-</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="序号" min-width="360">
          <template #default="scope">
            <div class="sequence-cell">
              <el-checkbox-group v-model="scope.row.sequenceValues" class="sequence-group">
                <el-checkbox v-for="item in sequenceOptions" :key="item" :label="item">{{ item }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="是否需要做" min-width="240" align="center">
          <template #default="scope">
            <div class="need-create-cell">
              <el-radio-group v-model="scope.row.needCreate" class="need-create-group">
                <el-radio-button v-for="item in needCreateOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
              </el-radio-group>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="备注" min-width="220">
          <template #default="scope">
            <el-input v-model="scope.row.remark" placeholder="为空时默认空字符串" />
          </template>
        </el-table-column>

        <el-table-column label="操作" fixed="right" min-width="220" align="center">
          <template #default="scope">
            <div class="action-cell">
              <el-button
                v-if="scope.row.url"
                size="small"
                plain
                type="primary"
                class="action-button"
                @click="openTaskUrl(scope.row.url)"
              >
                打开
              </el-button>
              <el-button
                v-if="scope.row.url"
                size="small"
                plain
                type="primary"
                class="action-button"
                @click="copyText(scope.row.url)"
              >
                复制
              </el-button>
              <el-button
                size="small"
                plain
                type="primary"
                class="action-button"
                :loading="queryingTaskId === scope.row.id"
                @click="queryWinner(scope.row)"
              >
                查询
              </el-button>
              <el-button size="small" plain type="danger" class="action-button" @click="removeTask(scope.row.id)">
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.page-shell {
  position: relative;
  width: 100%;
  max-width: none;
  margin: 0;
  min-height: 100vh;
  padding: 20px 22px 30px;
  color: #d8e6ff;
  background:
    radial-gradient(circle at 0% 0%, rgba(34, 211, 238, 0.14), transparent 26%),
    radial-gradient(circle at 100% 0%, rgba(244, 114, 182, 0.12), transparent 24%),
    radial-gradient(circle at 50% 100%, rgba(139, 92, 246, 0.12), transparent 30%),
    linear-gradient(180deg, #04060b 0%, #070b14 48%, #04060b 100%);
  overflow: hidden;
  isolation: isolate;
}

.page-shell::before,
.page-shell::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  filter: blur(48px);
  opacity: 0.42;
  pointer-events: none;
  z-index: -1;
}

.page-shell::before {
  top: -90px;
  left: -70px;
  width: 280px;
  height: 280px;
  background: rgba(34, 211, 238, 0.24);
}

.page-shell::after {
  top: 80px;
  right: -110px;
  width: 320px;
  height: 320px;
  background: rgba(168, 85, 247, 0.2);
}

.panel-head {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 18px 20px;
  border: 1px solid rgba(34, 211, 238, 0.16);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(3, 8, 18, 0.98) 0%, rgba(8, 18, 34, 0.96) 52%, rgba(18, 8, 34, 0.94) 100%);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 0 0 1px rgba(34, 211, 238, 0.06);
  overflow: hidden;
}

.panel-head::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(34, 211, 238, 0.08), rgba(34, 211, 238, 0) 28%, rgba(244, 114, 182, 0.08) 62%, rgba(244, 114, 182, 0) 82%);
  pointer-events: none;
}

.panel-head::after {
  content: '';
  position: absolute;
  right: -30px;
  bottom: -76px;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(34, 211, 238, 0.22) 0%, rgba(34, 211, 238, 0) 72%);
  pointer-events: none;
}

.panel-copy,
.panel-stats {
  position: relative;
  z-index: 1;
}

.panel-copy {
  min-width: 260px;
}

.panel-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgba(34, 211, 238, 0.22);
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.08);
  color: #67e8f9;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-shadow: 0 0 18px rgba(34, 211, 238, 0.35);
}

.panel-title {
  margin-top: 14px;
  font-size: 28px;
  font-weight: 900;
  line-height: 1.12;
  letter-spacing: 0.01em;
  color: #f8fbff;
  text-shadow:
    0 0 24px rgba(34, 211, 238, 0.22),
    0 0 40px rgba(168, 85, 247, 0.12);
}

.panel-subtitle {
  margin-top: 8px;
  max-width: 560px;
  color: rgba(216, 230, 255, 0.72);
  font-size: 14px;
  line-height: 1.7;
}

.panel-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(112px, 1fr));
  gap: 10px;
  min-width: min(100%, 390px);
}

.panel-stat {
  padding: 12px 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(14px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 10px 20px rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.panel-stat:hover {
  transform: translateY(-2px);
  border-color: rgba(34, 211, 238, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 14px 24px rgba(34, 211, 238, 0.08);
}

.panel-stat-label {
  display: block;
  color: rgba(191, 219, 254, 0.6);
  font-size: 12px;
}

.panel-stat-value {
  display: block;
  margin-top: 6px;
  color: #f8fbff;
  font-size: 20px;
  font-weight: 900;
}

.toolbar-card,
.table-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(34, 211, 238, 0.12);
  border-radius: 20px;
  background: rgba(5, 9, 18, 0.76);
  box-shadow:
    0 22px 48px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 0 0 1px rgba(34, 211, 238, 0.03);
  backdrop-filter: blur(20px);
  transition: transform 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease;
}

.toolbar-card:hover,
.table-card:hover {
  transform: translateY(-2px);
  border-color: rgba(34, 211, 238, 0.2);
  box-shadow:
    0 28px 60px rgba(0, 0, 0, 0.42),
    0 0 28px rgba(34, 211, 238, 0.08);
}

.toolbar-card::before,
.table-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(34, 211, 238, 0), rgba(34, 211, 238, 0.95), rgba(168, 85, 247, 0.88), rgba(244, 114, 182, 0.75), rgba(244, 114, 182, 0));
}

.table-card {
  margin-top: 18px;
}

:deep(.toolbar-card .el-card__body),
:deep(.table-card .el-card__body) {
  padding: 20px;
}

:deep(.table-card .el-card__header) {
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(34, 211, 238, 0.08);
  background: linear-gradient(180deg, rgba(7, 12, 24, 0.88) 0%, rgba(7, 12, 24, 0.74) 100%);
}

.toolbar-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: nowrap;
  align-items: center;
  padding: 14px;
  border: 1px solid rgba(34, 211, 238, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.toolbar-left,
.toolbar-right {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar-left {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 220px));
  flex: 0 1 auto;
  min-width: 0;
  align-items: stretch;
}

.toolbar-right {
  margin-left: auto;
  flex: 0 0 auto;
}

.date-picker,
.date-select {
  width: 100%;
}

:deep(.toolbar-left > .el-select),
:deep(.toolbar-left > .el-date-editor) {
  width: 100%;
}

.summary-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  align-items: center;
}

.summary-tip {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(168, 85, 247, 0.2);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(12, 18, 34, 0.94), rgba(18, 12, 34, 0.92));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.summary-text {
  color: #b9c7de;
  font-size: 13px;
  line-height: 1.6;
}

.summary-source {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(34, 211, 238, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: #93c5fd;
  font-size: 13px;
  font-weight: 700;
  font-family: Consolas, 'Courier New', monospace;
  letter-spacing: 0.01em;
}

.status-alert {
  margin-top: 14px;
}

:deep(.status-alert.el-alert) {
  border: 1px solid rgba(34, 211, 238, 0.12);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.18);
}

:deep(.status-alert .el-alert__title) {
  font-size: 14px;
  font-weight: 800;
  color: #f8fbff;
}

:deep(.status-alert .el-alert__description) {
  color: #a8b8d4;
  line-height: 1.7;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.table-title {
  font-size: 20px;
  font-weight: 900;
  color: #f8fbff;
  text-shadow: 0 0 22px rgba(34, 211, 238, 0.16);
}

.table-subtitle {
  margin-top: 6px;
  color: #7f8ea8;
  font-size: 13px;
}

.table-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(34, 211, 238, 0.22);
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.08);
  color: #67e8f9;
  font-size: 13px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 0 24px rgba(34, 211, 238, 0.08);
}

.url-cell {
  min-width: 0;
}

.url-text {
  display: block;
  padding: 10px 12px;
  border: 1px solid rgba(34, 211, 238, 0.08);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(10, 15, 28, 0.96), rgba(5, 9, 18, 0.98));
  color: #d7e5ff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  font-family: Consolas, 'Courier New', monospace;
  word-break: break-all;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.url-text:hover {
  transform: translateY(-1px);
  border-color: rgba(34, 211, 238, 0.2);
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.08);
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: 1px dashed rgba(34, 211, 238, 0.2);
  background: rgba(15, 23, 42, 0.7);
  cursor: grab;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.drag-handle::before {
  content: '';
  width: 12px;
  height: 12px;
  background:
    repeating-linear-gradient(
      90deg,
      rgba(125, 211, 252, 0.8),
      rgba(125, 211, 252, 0.8) 2px,
      transparent 2px,
      transparent 4px
    );
  opacity: 0.8;
}

.drag-handle:active {
  cursor: grabbing;
}

:deep(.task-table .drag-ghost > td.el-table__cell) {
  background: rgba(34, 211, 238, 0.08) !important;
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.2);
}

:deep(.task-table .drag-chosen > td.el-table__cell) {
  background: rgba(125, 211, 252, 0.08) !important;
}

:deep(.task-table .drag-dragging > td.el-table__cell) {
  background: rgba(15, 23, 42, 0.96) !important;
  opacity: 0.9;
}

:deep(.toolbar-card .el-tag),
:deep(.table-card .el-tag) {
  --el-tag-bg-color: rgba(255, 255, 255, 0.04);
  --el-tag-border-color: rgba(34, 211, 238, 0.14);
  --el-tag-text-color: #d7e5ff;
  padding: 0 14px;
  height: 34px;
  border-radius: 999px;
  font-weight: 700;
  box-shadow: 0 10px 18px rgba(0, 0, 0, 0.12);
}

:deep(.toolbar-card .el-button),
:deep(.table-card .el-button) {
  height: 38px;
  padding: 0 16px;
  border-radius: 12px;
  font-weight: 700;
}

:deep(.toolbar-right .el-button:not(.is-link)) {
  border-color: rgba(34, 211, 238, 0.18);
}

:deep(.toolbar-right .el-button--primary) {
  color: #05111c;
  background: linear-gradient(135deg, #22d3ee 0%, #8b5cf6 58%, #f472b6 100%);
  border-color: transparent;
  box-shadow: 0 14px 26px rgba(34, 211, 238, 0.22);
}

:deep(.toolbar-right .el-button--primary:hover) {
  background: linear-gradient(135deg, #67e8f9 0%, #a78bfa 58%, #fb7185 100%);
  border-color: transparent;
}

:deep(.toolbar-card .el-input__wrapper),
:deep(.toolbar-card .el-textarea__inner),
:deep(.toolbar-card .el-select__wrapper),
:deep(.toolbar-card .el-date-editor.el-input__wrapper) {
  min-height: 42px;
  border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.1) inset;
  background: rgba(2, 6, 15, 0.82);
}

:deep(.toolbar-left .el-input__wrapper),
:deep(.toolbar-left .el-select__wrapper),
:deep(.toolbar-left .el-date-editor.el-input__wrapper) {
  height: 42px;
}

:deep(.toolbar-card .el-input__inner),
:deep(.toolbar-card .el-select__placeholder),
:deep(.toolbar-card .el-select__selected-item),
:deep(.toolbar-card .el-date-editor input),
:deep(.task-table .el-input__inner),
:deep(.task-table .el-textarea__inner) {
  color: #e7f0ff;
}

:deep(.toolbar-card .el-input__inner::placeholder),
:deep(.task-table .el-input__inner::placeholder),
:deep(.task-table .el-textarea__inner::placeholder) {
  color: #6f819e;
}

:deep(.toolbar-card .el-icon),
:deep(.toolbar-card .el-input__prefix-inner),
:deep(.toolbar-card .el-input__suffix-inner),
:deep(.toolbar-card .el-select__caret) {
  color: #67e8f9;
}

:deep(.task-table) {
  --el-table-border-color: rgba(34, 211, 238, 0.08);
  --el-table-header-bg-color: rgba(8, 14, 28, 0.94);
  --el-table-row-hover-bg-color: rgba(16, 25, 45, 0.94);
  --el-table-bg-color: rgba(5, 9, 18, 0.72);
  --el-fill-color-blank: rgba(5, 9, 18, 0.72);
  color: #d8e6ff;
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.06);
}

:deep(.task-table .el-table__inner-wrapper::before) {
  display: none;
}

:deep(.task-table .el-table__header-wrapper) {
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
}

:deep(.task-table .el-table__header-wrapper th) {
  color: #9ae6ff;
  font-weight: 800;
  background: linear-gradient(180deg, rgba(9, 16, 32, 0.98), rgba(6, 11, 22, 0.96));
}

:deep(.task-table .cell) {
  color: #dbe7ff;
}

:deep(.task-table tr:nth-child(even) > td.el-table__cell) {
  background: rgba(7, 12, 24, 0.9);
}

:deep(.task-table tr:nth-child(odd) > td.el-table__cell) {
  background: rgba(4, 8, 16, 0.9);
}

:deep(.task-table tr:hover > td.el-table__cell) {
  background: rgba(12, 19, 36, 0.98) !important;
}

:deep(.task-table td) {
  padding-top: 14px;
  padding-bottom: 14px;
}

:deep(.task-table .el-input__wrapper),
:deep(.task-table .el-textarea__inner),
:deep(.task-table .el-select__wrapper) {
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.08) inset;
  background: rgba(6, 11, 22, 0.94);
}

:deep(.task-table .el-input__wrapper:hover),
:deep(.task-table .el-textarea__inner:hover),
:deep(.task-table .el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.18) inset, 0 0 18px rgba(34, 211, 238, 0.05);
}

:deep(.table-card .el-empty) {
  padding: 56px 0 50px;
}

:deep(.table-card .el-empty__description p) {
  color: #7f8ea8;
  font-weight: 700;
}

.action-cell {
  display: grid;
  grid-template-columns: repeat(2, 68px);
  justify-content: center;
  align-items: center;
  gap: 6px;
}

:deep(.action-button) {
  width: 68px;
  height: 28px;
  margin: 0;
  padding: 0;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  border-color: rgba(34, 211, 238, 0.12);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

:deep(.action-button:hover) {
  transform: translateY(-1px);
}

:deep(.action-button.el-button--primary) {
  color: #7dd3fc;
  background: rgba(255, 255, 255, 0.04);
}

:deep(.action-button.el-button--primary:hover) {
  border-color: rgba(34, 211, 238, 0.28);
  background: rgba(34, 211, 238, 0.08);
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.08);
}

:deep(.action-button.el-button--danger) {
  color: #fb7185;
  background: rgba(255, 255, 255, 0.04);
}

:deep(.action-button.el-button--danger:hover) {
  border-color: rgba(251, 113, 133, 0.3);
  background: rgba(251, 113, 133, 0.08);
  box-shadow: 0 0 20px rgba(251, 113, 133, 0.08);
}

:deep(.action-button span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.text-cell {
  color: #dbe7ff;
  line-height: 1.6;
}

.time-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(34, 211, 238, 0.22);
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.08);
  color: #67e8f9;
  font-weight: 800;
  box-shadow: 0 0 22px rgba(34, 211, 238, 0.08);
}

.sequence-cell {
  min-width: 0;
}

.sequence-group {
  display: grid;
  grid-template-columns: repeat(6, minmax(46px, 1fr));
  gap: 6px 8px;
}

.need-create-cell {
  display: flex;
  justify-content: center;
}

.need-create-group {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: 6px;
}

:deep(.sequence-group .el-checkbox) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  margin-right: 0;
  padding: 0 6px;
  border: 1px solid rgba(34, 211, 238, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.16);
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

:deep(.sequence-group .el-checkbox:hover) {
  transform: translateY(-1px);
  border-color: rgba(34, 211, 238, 0.18);
  background: rgba(34, 211, 238, 0.06);
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.06);
}

:deep(.sequence-group .el-checkbox.is-checked) {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.1), rgba(168, 85, 247, 0.08));
}

:deep(.sequence-group .el-checkbox__input.is-checked .el-checkbox__inner) {
  background: #22d3ee;
  border-color: #22d3ee;
}

:deep(.sequence-group .el-checkbox__input) {
  margin-right: 0;
  flex: 0 0 auto;
}

:deep(.sequence-group .el-checkbox__inner) {
  width: 13px;
  height: 13px;
}

:deep(.sequence-group .el-checkbox__label) {
  margin-left: 0;
  padding-left: 0;
  color: #d8e6ff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

:deep(.need-create-group .el-radio-button) {
  margin: 0;
}

:deep(.need-create-group .el-radio-button__inner) {
  min-width: 68px;
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: none;
  color: #d6e4ff;
  font-size: 12px;
  font-weight: 800;
  line-height: 30px;
  box-shadow: 0 8px 14px rgba(0, 0, 0, 0.14);
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease, color 0.18s ease;
}

:deep(.need-create-group .el-radio-button:not(.is-active) .el-radio-button__inner:hover) {
  transform: translateY(-1px);
  border-color: rgba(34, 211, 238, 0.24);
  background: rgba(34, 211, 238, 0.08);
  color: #eef6ff;
}

:deep(.need-create-group .el-radio-button.is-active .el-radio-button__inner) {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.52), rgba(168, 85, 247, 0.44));
  color: #ffffff;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.16);
  box-shadow: 0 0 16px rgba(34, 211, 238, 0.16), 0 0 14px rgba(168, 85, 247, 0.1);
}

:deep(.task-table .el-input),
:deep(.task-table .el-textarea),
:deep(.task-table .el-input__wrapper) {
  width: 100%;
}

@media (max-width: 900px) {
  .page-shell {
    padding: 14px;
  }

  .panel-head {
    padding: 16px;
  }

  .panel-title {
    font-size: 24px;
  }

  .panel-stats {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .date-picker,
  .date-select {
    width: 100%;
  }

  .toolbar-row {
    flex-wrap: wrap;
  }

  .toolbar-left {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .toolbar-right {
    width: 100%;
  }

  :deep(.toolbar-right .el-button:not(.is-link)) {
    width: 100%;
  }

  .table-header {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .sequence-group {
    grid-template-columns: repeat(4, minmax(40px, 1fr));
    gap: 6px;
  }

  .need-create-group {
    flex-wrap: wrap;
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
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.winner-result-modal .el-overlay-message-box {
  overflow: hidden;
}

body.winner-result-lock {
  overflow: hidden;
}

.winner-result-box .el-message-box__header {
  padding: 18px 22px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  background: #ffffff;
  flex-shrink: 0;
}

.winner-result-box .el-message-box__content {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  background: #ffffff;
}

.winner-result-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: #f8fafc;
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
  font-family: Consolas, 'Courier New', monospace;
  min-height: 100%;
}
</style>
