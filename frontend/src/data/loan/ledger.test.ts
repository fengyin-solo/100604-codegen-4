import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { LOAN_SEED } from './seed'
import {
  applyClaim,
  applyClaims,
  assertInvariant,
  completeReturn,
  completeReturns,
  lendTool,
  registerReturn,
  stockOf,
  updateRectification,
} from './ledger'
import type { ClaimRequest, LedgerState } from './types'

function fresh(): LedgerState {
  return JSON.parse(JSON.stringify(LOAN_SEED)) as LedgerState
}

const day = (offset: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

describe('三处数量同源', () => {
  it('播种数据满足 在册 = 可借 + 已借 + 待归还 + 待领用', () => {
    const state = fresh()
    assertInvariant(state)
    const stock = stockOf(state)
    assert.equal(stock.registered, 5)
    assert.equal(stock.lentOut, 2)
    assert.equal(stock.pendingReturn, 1)
    assert.equal(stock.reserved, 1)
    assert.equal(stock.available, 1)
    assert.equal(stock.registered, stock.available + stock.lentOut + stock.pendingReturn + stock.reserved)
  })

  it('归还闭环一次同时改掉借用单与器具占用，两处不可能各改各的', () => {
    let state = fresh()
    const before = stockOf(state)
    // JYD-00004 已借出、预计 2026-10-05 归还（今天 2026-10-04，未逾期）
    state = registerReturn(state, 4)
    assert.deepEqual(
      [stockOf(state).lentOut, stockOf(state).pendingReturn],
      [before.lentOut - 1, before.pendingReturn + 1],
    )
    // 待归还 -> 已归还：占用释放，可借 +1
    const res = completeReturn(state, 4, '完好')
    state = res.state
    assert.equal(res.receipt.ok, true)
    assert.equal(res.receipt.conclusion, '正常归还')
    const after = stockOf(state)
    assert.equal(after.lentOut, before.lentOut - 1)
    assert.equal(after.pendingReturn, before.pendingReturn)
    assert.equal(after.available, before.available + 1)
  })
})

describe('同一器具同一时段互斥 + 排序裁定', () => {
  it('两个班组同时申领同一件：申领更早者胜出，负方逐条拒收并告知胜者', () => {
    const state0 = fresh()
    // FGZ-001 已被一班组申领（待领用，窗口 10-03 ~ 10-08）
    const req: ClaimRequest = {
      toolCode: 'FGZ-001',
      team: '货运班组',
      borrower: '钱七',
      appliedAt: '2026-10-04T05:00:00.000Z',
      expectedReturn: '2026-10-09',
    }
    const { receipt } = applyClaim(state0, req)
    assert.equal(receipt.ok, false)
    assert.equal(receipt.reason, 'overlap')
    assert.match(receipt.message, /航线一班组/)
  })

  it('同批申领同一件且申领时刻相同：预计归还更早者优先；仍相同则按提交顺序', () => {
    let state = fresh()
    // 用一件完全空闲的器具：先把相关占用清空（取新编号器具建档）
    state = { ...state, tools: [...state.tools, { id: 7, code: 'LDG-009', name: '轮挡', spec: '测试', status: '在册' as const, createdAt: '2026-10-01T00:00:00.000Z' }], seq: { ...state.seq, tool: 7 } }
    const at = '2026-10-04T01:00:00.000Z'
    const requests: ClaimRequest[] = [
      { toolCode: 'LDG-009', team: 'A班组', borrower: 'a', appliedAt: at, expectedReturn: '2026-10-10' },
      { toolCode: 'LDG-009', team: 'B班组', borrower: 'b', appliedAt: at, expectedReturn: '2026-10-08' },
    ]
    const { state: next, receipts } = applyClaims(state, requests)
    assert.equal(receipts[0].ok, false) // A 还得晚，败
    assert.equal(receipts[1].ok, true)  // B 还得早，胜
    assert.match(receipts[0].message, /B班组/)
    state = next
    assert.equal(stockOf(state, 'LDG-009').reserved, 1)
  })

  it('时段不相交的申领允许通过', () => {
    const state0 = fresh()
    // FGZ-001 占用到 09-28；10-10 之后再申领应该放行
    const { receipt } = applyClaim(state0, {
      toolCode: 'FGZ-001',
      team: '货运班组',
      borrower: '钱七',
      appliedAt: '2026-10-10T00:00:00.000Z',
      expectedReturn: '2026-10-12',
    })
    assert.equal(receipt.ok, true)
  })
})

describe('状态机：待领用 -> 已借出 -> 待归还 -> 已归还，禁止倒着改', () => {
  it('待领用不能直接登记归还（先归还再借出一律拒绝）', () => {
    const state = fresh()
    assert.throws(() => registerReturn(state, 1), /只有「已借出」才能登记归还/)
  })

  it('已归还不允许重复登记归还或再次领用', () => {
    const state = fresh()
    assert.throws(() => registerReturn(state, 6), /只有「已借出」才能登记归还/)
    assert.throws(() => lendTool(state, 6), /只有「待领用」可以领用出库/)
  })

  it('待归还不能直接领用，必须沿序前进', () => {
    const state = fresh()
    assert.throws(() => lendTool(state, 5), /只有「待领用」可以领用出库/)
  })
})

describe('批量归还：整组提交、逐条回执、只跳过不满足条件的条', () => {
  it('混合状态整组提交：已借出/待归还照常归还，待领用/已归还/不存在分别跳过或幂等', () => {
    let state = fresh()
    const before = stockOf(state)
    const key = 'batch-1'
    const { state: next, receipts } = completeReturns(
      state,
      [
        { orderId: 2 },   // 已借出 -> 归还
        { orderId: 5 },   // 待归还 -> 归还
        { orderId: 1 },   // 待领用：跳过
        { orderId: 6 },   // 已归还：幂等
        { orderId: 999 }, // 不存在：跳过
      ],
      { idempotencyKey: key },
    )
    state = next

    assert.equal(receipts[0].ok, true)
    assert.equal(receipts[0].toStatus, '已归还')
    assert.equal(receipts[1].ok, true)
    assert.equal(receipts[2].ok, false)
    assert.match(receipts[2].message, /必须先登记归还/)
    assert.equal(receipts[3].ok, true)
    assert.equal(receipts[3].duplicated, true)
    assert.equal(receipts[4].ok, false)
    assert.equal(receipts[4].fromStatus, '不存在')

    // 实际记账：2 和 5 两单闭环，占用释放 2 件（2 已借出、5 待归还）
    const after = stockOf(state)
    assert.equal(after.lentOut, before.lentOut - 1)
    assert.equal(after.pendingReturn, before.pendingReturn - 1)
    assert.equal(after.available, before.available + 2)

    // 成功条各生成一张整改单（含已存在的两单不重复生成）
    const newRects = state.rectifications.filter((item) => ['JYD-00002', 'JYD-00005'].includes(item.orderCode))
    assert.equal(newRects.length, 2)

    // 同一张借用单重复提交（同幂等键）：整组原样回放首次的 5 条回执，只记一次
    const replay = completeReturns(
      state,
      [
        { orderId: 2 },
        { orderId: 5 },
        { orderId: 1 },
        { orderId: 6 },
        { orderId: 999 },
      ],
      { idempotencyKey: key },
    )
    assert.equal(replay.state, state)
    assert.equal(replay.receipts.length, 5)
    assert.ok(replay.receipts.filter((item) => item.ok).every((item) => item.duplicated))
    assert.ok(replay.receipts.some((item) => !item.ok && item.fromStatus === '待领用'))
    assert.ok(replay.receipts.some((item) => !item.ok && item.fromStatus === '不存在'))
    assert.equal(replay.state.rectifications.length, state.rectifications.length)
  })

  it('损坏/缺失归还：同事务核减在册数并开巡查整改单，逾期结论正确', () => {
    let state = fresh()
    // LDG-001 预计 10-02 归还，直接以「损坏」批量闭环
    const { state: s1, receipts: r1 } = completeReturns(state, [{ orderId: 2, condition: '损坏' }])
    state = s1
    assert.equal(r1[0].conclusion, '器具损坏')
    assert.equal(stockOf(state).registered, 4)
    const tool = state.tools.find((t) => t.code === 'LDG-001')!
    assert.equal(tool.status, '损坏停用')
    const rect = state.rectifications.find((item) => item.orderCode === 'JYD-00002')!
    assert.equal(rect.status, '待整改')
    assert.equal(rect.conclusion, '器具损坏')
  })

  it('完好但逾期：不核减在库，开逾期整改单；现场完好可再借', () => {
    let state = fresh()
    // JYD-00004 预计 10-05；强制晚于预计归还日期闭环——已借出，直接批量归还并伪造时间不可行，
    // 改为：构造一单预计归还已过期的已借出单
    state = {
      ...state,
      orders: state.orders.map((o) =>
        o.id === 4 ? { ...o, expectedReturn: '2026-09-30' } : o,
      ),
    }
    const { state: next, receipts } = completeReturns(state, [{ orderId: 4, condition: '完好' }])
    state = next
    assert.equal(receipts[0].conclusion, '逾期归还')
    assert.equal(stockOf(state, 'FGZ-002').registered, 1)
    assert.equal(stockOf(state, 'FGZ-002').available, 1)
    assert.equal(
      state.rectifications.find((item) => item.orderCode === 'JYD-00004')?.status,
      '待整改',
    )
  })
})

describe('巡查整改清单联动', () => {
  it('整改单可推进至整改中/已闭环，已闭环不允许回退', () => {
    let state = fresh()
    state = updateRectification(state, 1, '整改中')
    assert.equal(state.rectifications[0].status, '整改中')
    state = updateRectification(state, 1, '已闭环')
    assert.equal(state.rectifications[0].status, '已闭环')
    assert.throws(() => updateRectification(state, 1, '整改中'), /不允许回退/)
  })
})

describe('不允许篡改出对不上的台账', () => {
  it('人为制造重复占用会被不变量拦下', () => {
    const state = fresh()
    const evil: LedgerState = {
      ...state,
      orders: [
        ...state.orders,
        {
          id: 100,
          code: 'JYD-00100',
          toolCode: 'LDG-002',
          team: 'X班组',
          borrower: 'x',
          appliedAt: '2026-10-02T09:00:00.000Z',
          expectedReturn: '2026-10-04',
          status: '已借出',
          lentAt: '2026-10-02T09:00:00.000Z',
        },
      ],
    }
    assert.throws(() => assertInvariant(evil), /时段重叠|同时压了/)
  })
})
