const datePattern = /^\d{1,2}\.\d{1,2}$/
const urlPattern = /^https?:\/\/\S+$/i
const timePattern = /^\d{1,2}:\d{2}$/

export function compareDateKey(leftDate, rightDate) {
  const [leftMonth, leftDay] = String(leftDate || '').split('.').map((value) => Number(value) || 0)
  const [rightMonth, rightDay] = String(rightDate || '').split('.').map((value) => Number(value) || 0)

  if (leftMonth !== rightMonth) {
    return leftMonth - rightMonth
  }

  return leftDay - rightDay
}

function parseTimeToMinutes(value) {
  const normalizedValue = String(value || '').trim()
  if (!timePattern.test(normalizedValue)) {
    return null
  }

  const [hour, minute] = normalizedValue.split(':').map((item) => Number(item) || 0)
  if (hour > 23 || minute > 59) {
    return null
  }

  return hour * 60 + minute
}

export function compareTaskTime(leftTask, rightTask) {
  const leftMinutes = parseTimeToMinutes(leftTask?.time)
  const rightMinutes = parseTimeToMinutes(rightTask?.time)

  if (leftMinutes == null && rightMinutes == null) {
    return String(leftTask?.url || '').localeCompare(String(rightTask?.url || ''), 'zh-CN')
  }

  if (leftMinutes == null) {
    return 1
  }

  if (rightMinutes == null) {
    return -1
  }

  if (leftMinutes !== rightMinutes) {
    return leftMinutes - rightMinutes
  }

  return String(leftTask?.url || '').localeCompare(String(rightTask?.url || ''), 'zh-CN')
}

function buildTaskId(dateKey, index, url) {
  const suffix = String(url || 'task')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'task'

  return `${dateKey}-${index}-${suffix}`
}

function normalizeRemark(remark) {
  return String(remark || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || ''
}

export function normalizeNeedCreate(value) {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return '3'
  }

  const upperValue = rawValue.toUpperCase()

  if (upperValue === 'Y' || rawValue === '1' || rawValue === '做') {
    return '1'
  }

  if (upperValue === 'N' || rawValue === '2' || rawValue === '不做') {
    return '2'
  }

  if (rawValue === '3' || rawValue === '待定') {
    return '3'
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '2'
  }

  return '3'
}

export function sequenceTextToValues(sequenceText) {
  const tokens = String(sequenceText || '')
    .split(/[\s,，]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const seen = new Set()
  const nextValues = []

  tokens.forEach((token) => {
    if (!/^\d+$/.test(token)) {
      return
    }

    const numberValue = Number(token)
    if (numberValue < 1 || numberValue > 12) {
      return
    }

    const normalizedValue = String(numberValue)
    if (seen.has(normalizedValue)) {
      return
    }

    seen.add(normalizedValue)
    nextValues.push(normalizedValue)
  })

  return nextValues.sort((leftValue, rightValue) => Number(leftValue) - Number(rightValue))
}

export function valuesToSequenceText(values) {
  return sequenceTextToValues(Array.isArray(values) ? values.join(' ') : values).join(' ')
}

export function normalizeSequenceText(sequenceText) {
  return valuesToSequenceText(sequenceText)
}

function normalizeTask(task, dateKey, index) {
  return {
    id: task.id || buildTaskId(dateKey, index, task.url),
    time: timePattern.test(String(task.time || '').trim()) ? String(task.time || '').trim() : '',
    url: String(task.url || '').trim(),
    sequenceText: normalizeSequenceText(task.sequenceText ?? task.sequenceValues),
    needCreate: normalizeNeedCreate(task.needCreate),
    remark: normalizeRemark(task.remark),
  }
}

export function normalizeTaskMap(taskMap) {
  const nextMap = {}

  Object.entries(taskMap || {}).forEach(([dateKey, taskList]) => {
    if (!datePattern.test(dateKey)) {
      return
    }

    const normalizedTasks = (taskList || [])
      .map((task, index) => normalizeTask(task, dateKey, index))
      .filter((task) => task.url)
      .sort((leftTask, rightTask) => compareTaskTime(leftTask, rightTask))

    if (normalizedTasks.length) {
      nextMap[dateKey] = normalizedTasks
    }
  })

  return Object.fromEntries(
    Object.entries(nextMap).sort(([leftDate], [rightDate]) => compareDateKey(leftDate, rightDate)),
  )
}

function parseHeaderLine(line) {
  const tokens = String(line || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) {
    return null
  }

  let time = ''
  const lastToken = tokens[tokens.length - 1]

  if (timePattern.test(lastToken)) {
    time = lastToken
    tokens.pop()
  }

  const sequenceValues = sequenceTextToValues(tokens.join(' '))
  if (!time && !sequenceValues.length) {
    return null
  }

  return {
    time,
    sequenceText: valuesToSequenceText(sequenceValues),
  }
}

function parsePipeTaskLine(line) {
  const parts = String(line || '').split('|')

  if (parts.length >= 5 && urlPattern.test(String(parts[1] || '').trim())) {
    return {
      time: timePattern.test(String(parts[0] || '').trim()) ? String(parts[0] || '').trim() : '',
      url: String(parts[1] || '').trim(),
      sequenceText: normalizeSequenceText(parts[2]),
      needCreate: normalizeNeedCreate(parts[3]),
      remark: normalizeRemark(parts.slice(4).join('|')),
    }
  }

  if (parts.length >= 4 && urlPattern.test(String(parts[1] || '').trim())) {
    const firstField = String(parts[0] || '').trim()
    const thirdField = String(parts[2] || '').trim()
    const restRemark = normalizeRemark(parts.slice(3).join('|'))

    if (timePattern.test(firstField)) {
      return {
        time: firstField,
        url: String(parts[1] || '').trim(),
        sequenceText: '',
        needCreate: normalizeNeedCreate(thirdField),
        remark: restRemark,
      }
    }

    const sequenceText = normalizeSequenceText(firstField)
    if (sequenceText) {
      return {
        time: '',
        url: String(parts[1] || '').trim(),
        sequenceText,
        needCreate: normalizeNeedCreate(thirdField),
        remark: restRemark,
      }
    }

    return {
      time: '',
      url: String(parts[1] || '').trim(),
      sequenceText: '',
      needCreate: normalizeNeedCreate(thirdField),
      remark: normalizeRemark([firstField, restRemark].filter(Boolean).join(' ')),
    }
  }

  if (parts.length >= 2 && urlPattern.test(String(parts[0] || '').trim())) {
    return {
      time: '',
      url: String(parts[0] || '').trim(),
      sequenceText: '',
      needCreate: normalizeNeedCreate(parts[1]),
      remark: normalizeRemark(parts.slice(2).join('|')),
    }
  }

  return null
}

export function parseText(rawText) {
  const taskMap = {}
  const lines = String(rawText || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  let currentDate = ''
  let currentNeedCreate = '1'
  let currentHeader = null
  let currentTask = null

  for (const originalLine of lines) {
    const line = originalLine.trim()

    if (!line) {
      currentTask = null
      currentHeader = null

      if (currentDate && currentNeedCreate === '1') {
        currentNeedCreate = '2'
      }

      continue
    }

    if (datePattern.test(line)) {
      currentDate = line
      currentNeedCreate = '1'
      currentHeader = null
      currentTask = null

      if (!taskMap[currentDate]) {
        taskMap[currentDate] = []
      }

      continue
    }

    const pipeTask = parsePipeTaskLine(line)
    if (pipeTask) {
      const dateKey = currentDate || '1.1'
      if (!taskMap[dateKey]) {
        taskMap[dateKey] = []
      }

      taskMap[dateKey].push(pipeTask)
      currentTask = taskMap[dateKey][taskMap[dateKey].length - 1]
      currentHeader = null
      continue
    }

    const parsedHeader = parseHeaderLine(line)
    if (parsedHeader) {
      currentHeader = parsedHeader
      currentTask = null
      continue
    }

    if (urlPattern.test(line)) {
      const dateKey = currentDate || '1.1'
      if (!taskMap[dateKey]) {
        taskMap[dateKey] = []
      }

      currentTask = {
        time: currentHeader?.time || '',
        url: line,
        sequenceText: currentHeader?.sequenceText || '',
        needCreate: currentNeedCreate,
        remark: '',
      }

      taskMap[dateKey].push(currentTask)
      currentHeader = null
      continue
    }

    if (currentTask && !currentTask.remark) {
      currentTask.remark = line
    }
  }

  return normalizeTaskMap(taskMap)
}

export function stringifyTaskMap(taskMap) {
  const normalizedTaskMap = normalizeTaskMap(taskMap)
  const lines = []

  for (const [dateKey, taskList] of Object.entries(normalizedTaskMap)) {
    lines.push(dateKey)

    taskList.forEach((task) => {
      const time = timePattern.test(String(task.time || '').trim()) ? String(task.time || '').trim() : ''
      const sequenceText = normalizeSequenceText(task.sequenceText)
      const needCreate = normalizeNeedCreate(task.needCreate)
      const remark = normalizeRemark(task.remark)
      lines.push(`${time}|${task.url}|${sequenceText}|${needCreate}|${remark}`)
    })

    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
