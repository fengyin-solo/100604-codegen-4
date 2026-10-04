import { LOAN_SEED } from './seed'
import { assertInvariant } from './ledger'
import type { LedgerState } from './types'

// 借用台账单独一个存储键：器具、借用单、整改清单与计数快照同库存放、同事务替换。
const STORAGE_KEY = 'airport-ground-ops:loan-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): LedgerState {
  const fallback = clone(LOAN_SEED)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as LedgerState
    const merged: LedgerState = {
      ...clone(LOAN_SEED),
      ...parsed,
      seq: { ...LOAN_SEED.seq, ...(parsed.seq ?? {}) },
      processedKeys: parsed.processedKeys ?? {},
    }
    // 读盘时也校一遍：三处对不上的存量数据直接拦下，不在页面上继续错下去。
    assertInvariant(merged)
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: LedgerState | null = null

export function loanState(): LedgerState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function persistLoan(state: LedgerState): void {
  // 落盘前最后一道不变量校验（领域层 commit 已校过，这里兜底）。
  assertInvariant(state)
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetLoanLedger(): LedgerState {
  const fresh = clone(LOAN_SEED)
  persistLoan(fresh)
  return fresh
}

export function loanStorageKey(): string {
  return STORAGE_KEY
}
