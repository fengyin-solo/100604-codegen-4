import { defineStore } from 'pinia'

import {
  applyClaims,
  lendTool,
  registerReturn,
  completeReturns,
  createTool,
  rectificationsFor,
  stockOf,
  updateRectification,
  type StockSnapshot,
} from '@/data/loan/ledger'
import { loanState, persistLoan, resetLoanLedger } from '@/data/loan/store'
import type { ClaimRequest, ClaimReceipt, LedgerState, ReturnLine, ReturnReceipt } from '@/data/loan/types'

/**
 * 借用台账 Pinia 门面。页面只通过这里读写：所有写入都是
 * 「领域函数返回新整份状态 -> 不变量校验 -> 整份替换」，
 * 器具在册数、已借出数、可借出数永远读同一份状态推导，没有第二处计数。
 */
export const useLoanStore = defineStore('loan-ledger', {
  state: (): LedgerState => JSON.parse(JSON.stringify(loanState())) as LedgerState,
  getters: {
    stock: (state): StockSnapshot => stockOf(state),
    toolStock: (state) => (code: string): StockSnapshot => stockOf(state, code),
    openOrders: (state) => state.orders.filter((order) => order.status !== '已归还'),
    rectificationList: (state) => rectificationsFor(state),
    pendingRectificationCount: (state) =>
      state.rectifications.filter((item) => item.status !== '已闭环').length,
  },
  actions: {
    commit(next: LedgerState) {
      persistLoan(next)
      const fresh = JSON.parse(JSON.stringify(next)) as LedgerState
      this.tools = fresh.tools
      this.orders = fresh.orders
      this.rectifications = fresh.rectifications
      this.seq = fresh.seq
      this.processedKeys = fresh.processedKeys
    },
    addTool(input: { code: string; name: string; spec?: string }) {
      this.commit(createTool(loanState(), input))
    },
    /** 一班组多器具或多班组并发申领都走这里，裁定结果逐条回执。 */
    claimBatch(requests: ClaimRequest[]): ClaimReceipt[] {
      const { state: next, receipts } = applyClaims(loanState(), requests)
      this.commit(next)
      return receipts
    },
    lend(orderId: number) {
      this.commit(lendTool(loanState(), orderId))
    },
    registerReturn(orderId: number) {
      this.commit(registerReturn(loanState(), orderId))
    },
    /**
     * 批量归还：一次选中多张借用单整组提交，逐条给出每张的结果。
     * 同一张借用单在同一次勾选里重复出现只记一次，重复条照发幂等回执。
     */
    batchReturn(lines: ReturnLine[], idempotencyKey?: string): ReturnReceipt[] {
      const unique: ReturnLine[] = []
      const firstIndex = new Map<number, number>()
      // 记录原始勾选顺序，保证回执顺序与勾选顺序一致。
      const layout: ({ kind: 'once'; idx: number } | { kind: 'dup'; orderId: number })[] = []
      for (const line of lines) {
        const prev = firstIndex.get(line.orderId)
        if (prev === undefined) {
          firstIndex.set(line.orderId, unique.length)
          layout.push({ kind: 'once', idx: unique.length })
          unique.push(line)
        } else {
          layout.push({ kind: 'dup', orderId: line.orderId })
        }
      }

      const { state: next, receipts } = completeReturns(loanState(), unique, idempotencyKey ? { idempotencyKey } : {})
      this.commit(next)

      if (unique.length === lines.length) return receipts
      return layout.map((slot) =>
        slot.kind === 'once'
          ? receipts[slot.idx]
          : {
              ...receipts[firstIndex.get(slot.orderId) as number],
              duplicated: true,
              message: `借用单 #${slot.orderId} 在本次勾选里重复出现，只记一次`,
            },
      )
    },
    setRectificationStatus(rectId: number, status: '整改中' | '已闭环') {
      this.commit(updateRectification(loanState(), rectId, status))
    },
    resetAll() {
      const fresh = resetLoanLedger()
      this.commit(fresh)
    },
  },
})

export type { ClaimReceipt, ReturnReceipt }
