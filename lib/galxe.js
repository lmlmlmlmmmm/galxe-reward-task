import axios from 'axios'

const GALXE_ENDPOINT = 'https://graphigo.prd.galaxy.eco/query'
const DEFAULT_TIMEOUT = 15000

const WINNER_QUERY = `query campaignParticipants($id: ID!, $wfirst: Int!, $wafter: String!, $bDownload: Boolean! = false, $isParent: Boolean = false) {
  campaign(id: $id) {
    id
    participants @skip(if: $isParent) {
      participantsCount
      bountyWinners(first: $wfirst, after: $wafter, download: $bDownload) {
        list {
          address {
            address
            solanaAddress
          }
        }
      }
      bountyWinnersCount
    }
  }
}`

function getAxiosErrorMessage(error, defaultMessage) {
  const errorMessage = error?.response?.data?.errors?.map((item) => item.message).filter(Boolean).join('；')
  const statusCode = error?.response?.status
  const causeMessage = error?.cause?.message || error?.message || ''

  return errorMessage || (statusCode ? `${defaultMessage}（${statusCode}）` : `${defaultMessage}：${causeMessage}`)
}

function createAddressBook(rawText) {
  const addressList = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((address) => address.toLowerCase())

  return {
    count: addressList.length,
    indexMap: new Map(addressList.map((address, index) => [address, index + 1])),
  }
}

export function extractCampaignId(taskUrl) {
  const rawValue = String(taskUrl || '').trim()

  if (!rawValue) {
    throw new Error('缺少 Galxe 任务链接')
  }

  if (!/^https?:\/\//i.test(rawValue)) {
    return rawValue
  }

  let parsedUrl

  try {
    parsedUrl = new URL(rawValue)
  } catch {
    throw new Error('Galxe 任务链接格式不正确')
  }

  const campaignId = parsedUrl.pathname.split('/').filter(Boolean).at(-1)

  if (!campaignId) {
    throw new Error('未能从任务链接中解析出活动 ID')
  }

  return campaignId
}

function pickWinnerAddress(addressInfo) {
  const evmAddress = String(addressInfo?.address || '').trim()
  if (evmAddress) {
    return { type: 'evm', address: evmAddress }
  }

  const solAddress = String(addressInfo?.solanaAddress || '').trim()
  if (solAddress) {
    return { type: 'sol', address: solAddress }
  }

  return { type: 'unknown', address: '' }
}

export async function queryCampaignWinners(taskUrl, addressTexts = {}) {
  const campaignId = extractCampaignId(taskUrl)
  const evmAddressBook = createAddressBook(addressTexts.evm)
  const solAddressBook = createAddressBook(addressTexts.sol)

  let result = null

  try {
    const response = await axios.post(
      GALXE_ENDPOINT,
      {
        operationName: 'campaignParticipants',
        variables: {
          id: campaignId,
          wfirst: 1000,
          wafter: '-1',
          bDownload: false,
          isParent: false,
        },
        query: WINNER_QUERY,
      },
      {
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
        },
        timeout: DEFAULT_TIMEOUT,
      },
    )
    result = response.data
  } catch (error) {
    throw new Error(getAxiosErrorMessage(error, 'Galxe 接口请求失败'))
  }

  if (Array.isArray(result?.errors) && result.errors.length) {
    throw new Error(result.errors.map((item) => item.message).filter(Boolean).join('；') || 'Galxe 查询失败')
  }

  const participants = result?.data?.campaign?.participants

  if (!participants) {
    throw new Error('未查询到对应活动的中奖数据')
  }

  const winners = (participants?.bountyWinners?.list || [])
    .map((winner, index) => {
      const { type, address } = pickWinnerAddress(winner?.address)

      if (!address) {
        return null
      }

      const normalizedAddress = address.toLowerCase()
      const addressBook = type === 'evm' ? evmAddressBook : type === 'sol' ? solAddressBook : null
      const walletIndex = addressBook?.indexMap.get(normalizedAddress) || null

      return {
        order: index + 1,
        type,
        address,
        walletIndex,
        isMine: Boolean(walletIndex),
      }
    })
    .filter(Boolean)

  const matchedWinners = winners.filter((winner) => winner.isMine)

  return {
    campaignId,
    taskUrl: String(taskUrl || '').trim(),
    participantsCount: Number(participants?.participantsCount || 0),
    totalWinners: winners.length,
    bountyWinnersCount: Number(participants?.bountyWinnersCount || winners.length),
    walletSummary: {
      evm: evmAddressBook.count,
      sol: solAddressBook.count,
    },
    matchedCount: matchedWinners.length,
    matchedWinners,
    winners,
  }
}
