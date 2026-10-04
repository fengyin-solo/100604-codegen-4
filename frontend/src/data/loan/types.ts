/**
 * 机坪工器具借用台账——领域类型。
 *
 * 一条链路的核心约定：
 * 「在册数 / 已借出数 / 可借出数」三处数量不各自存储，全部由本文件里的
 * { tools, orders } 同一份状态实时推导（见 ledger.ts 的 stockSnapshot）。
 * 归还时对借用单、器具台账、巡查整改清单的改动放在同一个事务提交里，
 * 不存在「两处各改各的、改完对不上」的可能。
 */

/** 借用单四态：严格按序前进，禁止逆向，终态不允许重复登记。 */
export const LOAN_STATUSES = ['待领用', '已借出', '待归还', '已归还'] as const
export type LoanStatus = (typeof LOAN_STATUSES)[number]

/** 器具建档状态。只有「在册」计入在册数；损坏/缺失在归还闭环时一次性核减。 */
export type ToolStatus = '在册' | '损坏停用' | '缺失注销'

export interface Tool {
  id: number
  /** 器具编号，全台账唯一，一件器具一个编号。 */
  code: string
  /** 器具名称：反光锥 / 轮挡 / 牵引杆 …… */
  name: string
  spec: string
  status: ToolStatus
  createdAt: string
}

/** 归还时现场核库结论的输入。 */
export type ReturnCondition = '完好' | '损坏' | '缺失'

/** 落到机坪安全巡查整改清单上的归还结论。 */
export type ReturnConclusion = '正常归还' | '逾期归还' | '器具损坏' | '器具缺失'

export interface LoanOrder {
  id: number
  /** 借用单号 JYD-xxxxx */
  code: string
  toolCode: string
  /** 借用班组 */
  team: string
  /** 借用人 */
  borrower: string
  /** 申领时间（ISO 字符串，并发申领排序的第一依据） */
  appliedAt: string
  /** 预计归还日期 yyyy-MM-dd */
  expectedReturn: string
  status: LoanStatus
  /** 实际领用（借出）时间 */
  lentAt?: string
  /** 登记归还时间：已借出 -> 待归还 */
  returnRegisteredAt?: string
  /** 核库闭环时间：待归还 -> 已归还 */
  returnedAt?: string
  condition?: ReturnCondition
  conclusion?: ReturnConclusion
}

export type RectificationStatus = '待整改' | '整改中' | '已闭环'

/** 机坪安全巡查整改清单中的一条，来源固定为「借用归还」。 */
export interface RectificationItem {
  id: number
  /** 整改单号 ZG-xxxxx */
  code: string
  source: '借用归还'
  orderCode: string
  toolCode: string
  team: string
  borrower: string
  expectedReturn: string
  returnedAt: string
  conclusion: ReturnConclusion
  issue: string
  action: string
  status: RectificationStatus
  createdAt: string
  closedAt?: string
}

export interface ReturnReceipt {
  orderId: number
  orderCode: string
  toolCode: string
  team: string
  /** false = 本条不满足条件，被跳过；组内其它条照常归还。 */
  ok: boolean
  /** true = 同一张借用单重复提交，只记一次，回执按条照发。 */
  duplicated?: boolean
  fromStatus: LoanStatus | '不存在'
  toStatus?: LoanStatus
  conclusion?: ReturnConclusion
  rectificationCode?: string
  message: string
}

export interface ClaimRequest {
  toolCode: string
  team: string
  borrower: string
  expectedReturn: string
  /** 不传则取受理时刻。同批申领默认同一时刻，再用预计归还日期、提交序号兜底排序。 */
  appliedAt?: string
}

export interface ClaimReceipt {
  index: number
  ok: boolean
  toolCode: string
  team: string
  orderCode?: string
  reason?: 'overlap' | 'invalid'
  /** 互斥冲突中的胜出勤领方（班组 + 单号）。 */
  winner?: string
  message: string
}

export interface ReturnLine {
  orderId: number
  /** 批量归还时统一登记的现场核库结论，缺省按「完好」。 */
  condition?: ReturnCondition
}

export interface StoredIdempotentResult {
  at: string
  receipts: ReturnReceipt[]
}

export interface LedgerState {
  tools: Tool[]
  orders: LoanOrder[]
  rectifications: RectificationItem[]
  seq: { tool: number; order: number; rect: number }
  /** 幂等凭证 -> 首次提交时的逐条回执，重复提交原样回放，不再记账。 */
  processedKeys: Record<string, StoredIdempotentResult>
}
