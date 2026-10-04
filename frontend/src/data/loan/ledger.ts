/**
 * 机坪工器具借用台账——纯领域逻辑。
 *
 * 全部函数只吃 / 吐 LedgerState，不碰 localStorage、不碰 Vue，方便直接单测。
 * 写入一律走 commit()：先在副本上改，改完跑不变量校验，通过后整份落盘。
 */

import { LOAN_STATUSES, type ClaimReceipt, type ClaimRequest, type LedgerState, type LoanOrder, type LoanStatus, type RectificationItem, type ReturnConclusion, type ReturnCondition, type ReturnLine, type ReturnReceipt, type Tool } from './types'

export interface StockSnapshot {
  /** 在册数：状态为「在册」的器具件数。 */
  registered: number
  /** 已借出数：当前处于「已借出 / 待归还」的借用单件数（一件最多压一单）。 */
  lentOut: number
  /** 占用（待归还：器具已回现场，尚在核库闭环中，不算在库也不放行再借）。 */
  pendingReturn: number
  /** 已申领待领用：器具还在架子上但已被锁定，重叠申领会被互斥规则拒收。 */
  reserved: number
  /**
   * 可借出数：在册数 - 已借出数 - 待归还数，由前三者实时推导，从不单独存储。
   * 「已申领待领用」是锁定中的库存，看板另行明示，不计入可借出池。
   */
  available: number
}

function dateOnly(value: string): string {
  return value.slice(0, 10)
}

/** 当日零点判断：晚于预计归还日期当天归还即为逾期。 */
function isOverdue(expectedReturn: string, returnedAt: string): boolean {
  return dateOnly(returnedAt) > expectedReturn
}

function orderCode(id: number): string {
  return `JYD-${String(id).padStart(5, '0')}`
}

function rectCode(id: number): string {
  return `ZG-${String(id).padStart(5, '0')}`
}

/** 允许的状态前进边：只有相邻下一步，倒着改一律拒绝。 */
const NEXT_STATUS: Record<LoanStatus, LoanStatus | null> = {
  '待领用': '已借出',
  '已借出': '待归还',
  '待归还': '已归还',
  '已归还': null,
}

export function canMove(from: LoanStatus, to: LoanStatus): boolean {
  return NEXT_STATUS[from] === to
}

function findTool(state: LedgerState, code: string): Tool | undefined {
  return state.tools.find((tool) => tool.code === code.trim())
}

function activeOrders(state: LedgerState): LoanOrder[] {
  return state.orders.filter((order) => order.status !== '已归还')
}

/**
 * 同一器具同一时段互斥：未闭环的申领单（待领用 / 已借出 / 待归还）
 * 与新申领的 [appliedAt, expectedReturn] 时段相交即冲突。
 * 待归还期间器具虽已回机坪但还没核库，仍归原班组占用，不放行再借。
 */
function overlaps(order: LoanOrder, appliedAt: string, expectedReturn: string): boolean {
  const start = dateOnly(appliedAt)
  const end = expectedReturn
  const otherStart = dateOnly(order.appliedAt)
  const otherEnd = order.expectedReturn
  return start <= otherEnd && otherStart <= end
}

/** 器具件级库存快照：三处数量同源，全部从同一份状态推导。 */
export function stockOf(state: LedgerState, code?: string): StockSnapshot {
  const tools = code ? state.tools.filter((tool) => tool.code === code) : state.tools
  const belongs = (order: LoanOrder) => tools.some((tool) => tool.code === order.toolCode)
  const today = new Date().toISOString().slice(0, 10)
  const registered = tools.filter((tool) => tool.status === '在册').length
  const lent = activeOrders(state).filter((order) => belongs(order) && order.status === '已借出').length
  const pendingReturn = activeOrders(state).filter((order) => belongs(order) && order.status === '待归还').length
  // 待领用只在预约窗口覆盖今天时锁定库存；未来 disjoint 窗口的预约不占当前可借池。
  const reserved = activeOrders(state).filter(
    (order) =>
      belongs(order) &&
      order.status === '待领用' &&
      dateOnly(order.appliedAt) <= today &&
      today <= order.expectedReturn,
  ).length
  return {
    registered,
    lentOut: lent,
    pendingReturn,
    reserved,
    available: registered - lent - pendingReturn - reserved,
  }
}

/**
 * 提交前不变量自检：任何一次写入（包括归还的跨集合联动）之后都必须满足，
 * 一旦对不上直接抛错、整笔不落盘——从机制上杜绝「两处各改各的」。
 */
export function assertInvariant(state: LedgerState): void {
  const problems: string[] = []

  // 1. 器具编号唯一。
  const codes = new Set<string>()
  for (const tool of state.tools) {
    if (codes.has(tool.code)) problems.push(`器具编号重复：${tool.code}`)
    codes.add(tool.code)
  }
  // 借用单号唯一。
  const orderCodes = new Set<string>()
  for (const order of state.orders) {
    if (orderCodes.has(order.code)) problems.push(`借用单号重复：${order.code}`)
    orderCodes.add(order.code)
  }
  // 整改单号唯一。
  const rectCodes = new Set<string>()
  for (const item of state.rectifications) {
    if (rectCodes.has(item.code)) problems.push(`整改单号重复：${item.code}`)
    rectCodes.add(item.code)
  }

  // 2. 状态只能沿 待领用 -> 已借出 -> 待归还 -> 已归还 前进；时序字段必须齐全且单调。
  for (const order of state.orders) {
    const step = LOAN_STATUSES.indexOf(order.status)
    if (step < 0) problems.push(`借用单 ${order.code} 状态非法：${order.status}`)
    if (step >= 1 && !order.lentAt) problems.push(`借用单 ${order.code} 已借出但缺借出时间`)
    if (step >= 2 && !order.returnRegisteredAt) problems.push(`借用单 ${order.code} 已登记归还但缺登记时间`)
    if (step >= 3 && !order.returnedAt) problems.push(`借用单 ${order.code} 已归还但缺闭环时间`)
    if (order.lentAt && order.appliedAt > order.lentAt) problems.push(`借用单 ${order.code} 借出早于申领`)
    if (order.returnRegisteredAt && order.lentAt && order.returnRegisteredAt < order.lentAt) {
      problems.push(`借用单 ${order.code} 登记归还早于借出（倒着改）`)
    }
    if (order.returnedAt && order.returnRegisteredAt && order.returnedAt < order.returnRegisteredAt) {
      problems.push(`借用单 ${order.code} 核库闭环早于登记归还`)
    }
  }

  // 3. 同一器具同一时段只允许一个未闭环占用单。
  const open = activeOrders(state)
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      if (open[i].toolCode === open[j].toolCode && overlaps(open[i], open[j].appliedAt, open[j].expectedReturn)) {
        problems.push(`器具 ${open[i].toolCode} 存在时段重叠的占用：${open[i].code} × ${open[j].code}`)
      }
    }
  }

  // 4. 已借出/待归还必须指向在册器具（损坏、缺失件不允许压着占用单）。
  for (const order of open) {
    const tool = findTool(state, order.toolCode)
    if (!tool) {
      problems.push(`借用单 ${order.code} 指向不存在的器具 ${order.toolCode}`)
    } else if (tool.status !== '在册' && order.status !== '待归还') {
      problems.push(`借用单 ${order.code} 占用了非在册器具 ${order.toolCode}（${tool.status}）`)
    }
  }

  // 5. 三处同源：在册数 = 可借出数 + 已借出数 + 待归还核库数 + 已锁定待领用；占用 ≤ 1。
  const stock = stockOf(state)
  if (stock.registered !== stock.available + stock.lentOut + stock.pendingReturn + stock.reserved) {
    problems.push(`库存对不上：在册 ${stock.registered} ≠ 可借 ${stock.available} + 已借 ${stock.lentOut} + 待归还 ${stock.pendingReturn} + 待领用 ${stock.reserved}`)
  }
  for (const tool of state.tools) {
    const item = stockOf(state, tool.code)
    if (item.lentOut + item.pendingReturn + item.reserved > 1) {
      problems.push(`器具 ${tool.code} 同时压了 ${item.lentOut + item.pendingReturn + item.reserved} 张未闭环单`)
    }
    if (item.available < 0) problems.push(`器具 ${tool.code} 可借出数为负`)
  }

  // 6. 整改清单与归还结论一一对应。
  for (const item of state.rectifications) {
    const order = state.orders.find((row) => row.code === item.orderCode)
    if (!order) {
      problems.push(`整改单 ${item.code} 找不到来源借用单 ${item.orderCode}`)
      continue
    }
    if (order.status !== '已归还') problems.push(`整改单 ${item.code} 对应的借用单尚未归还闭环`)
    if (order.conclusion !== item.conclusion) {
      problems.push(`整改单 ${item.code} 结论与借用单 ${order.code} 不一致`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`台账不变量被破坏：\n- ${problems.join('\n- ')}`)
  }
}

/** 深拷贝一份再改，校验通过后作为新状态返回；校验失败抛错，调用方状态保持原样。 */
function commit(state: LedgerState, mutate: (draft: LedgerState) => void): LedgerState {
  const draft: LedgerState = JSON.parse(JSON.stringify(state)) as LedgerState
  mutate(draft)
  assertInvariant(draft)
  return draft
}

function nowIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// 器具建档
// ---------------------------------------------------------------------------

export function createTool(state: LedgerState, input: { code: string; name: string; spec?: string }): LedgerState {
  const code = input.code.trim()
  const name = input.name.trim()
  if (!code || !name) throw new Error('器具编号与名称不能为空')
  return commit(state, (draft) => {
    if (findTool(draft, code)) throw new Error(`器具编号 ${code} 已建档，一件器具只允许一个编号档案`)
    draft.seq.tool += 1
    draft.tools.push({
      id: draft.seq.tool,
      code,
      name,
      spec: input.spec?.trim() ?? '',
      status: '在册',
      createdAt: nowIso(),
    })
  })
}

// ---------------------------------------------------------------------------
// 申领：同一件器具同一时段只允许一个班组占用
// ---------------------------------------------------------------------------

/**
 * 并发申领排序规则（由本台账统一裁定，不再由班组口头协调）：
 *   1) 申领时间早的优先；
 *   2) 申领时间相同，预计归还日期早的优先（快借快还优先）；
 *   3) 仍相同，按提交到本台账的先后序号兜底。
 * 胜出方建档为「待领用」，其余申领方逐条拒收并告知胜出方是谁。
 */
export function claimPriority(a: ClaimRequest, b: ClaimRequest, ia: number, ib: number): number {
  const ta = a.appliedAt ?? nowIso()
  const tb = b.appliedAt ?? nowIso()
  if (ta !== tb) return ta < tb ? -1 : 1
  if (a.expectedReturn !== b.expectedReturn) return a.expectedReturn < b.expectedReturn ? -1 : 1
  return ia - ib
}

export function applyClaims(state: LedgerState, requests: ClaimRequest[]): { state: LedgerState; receipts: ClaimReceipt[] } {
  const normalized: { req: ClaimRequest; appliedAt: string; ok: boolean; invalidReason?: string }[] = requests.map((req) => {
    const appliedAt = req.appliedAt ? new Date(req.appliedAt).toISOString() : nowIso()
    const code = req.toolCode.trim()
    const team = req.team.trim()
    const borrower = req.borrower.trim()
    const expected = dateOnly(req.expectedReturn.trim())
    let invalidReason: string | undefined
    if (!code || !team || !borrower || !/^\d{4}-\d{2}-\d{2}$/.test(expected)) {
      invalidReason = '借用班组、借用人、器具编号、预计归还日期(YYYY-MM-DD)必须填写完整'
    } else {
      const tool = findTool(state, code)
      if (!tool) invalidReason = `器具 ${code} 未建档`
      else if (tool.status !== '在册') invalidReason = `器具 ${code} 当前${tool.status}，不可申领`
      else if (dateOnly(appliedAt) > expected) invalidReason = '预计归还日期不能早于申领时间'
    }
    return {
      req: { ...req, toolCode: code, team, borrower, expectedReturn: expected, appliedAt },
      appliedAt,
      ok: invalidReason === undefined,
      invalidReason,
    }
  })

  // 排序裁定：先在「全部有效申领 + 存量未闭环单」里决出每场次的胜者。
  const valid = normalized
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.ok)
    .sort((a, b) => claimPriority(a.entry.req, b.entry.req, a.index, b.index))

  // winners：本次提交后被占用的 { 器具 -> 胜出勤领方 }（先放入存量占用单）。
  const winners = new Map<string, LoanOrder>()
  for (const order of activeOrders(state)) {
    winners.set(order.toolCode, order)
  }

  const decisions = new Map<number, { orderCode?: string; winner?: LoanOrder; conflict?: boolean }>()

  const draft: LedgerState = JSON.parse(JSON.stringify(state)) as LedgerState
  draft.seq.order = state.seq.order

  for (const { entry, index } of valid) {
    const req = entry.req
    const occupant = winners.get(req.toolCode)
    if (occupant && overlaps(occupant, req.appliedAt as string, req.expectedReturn)) {
      decisions.set(index, { winner: occupant, conflict: true })
      continue
    }
    draft.seq.order += 1
    const id = draft.seq.order
    const order: LoanOrder = {
      id,
      code: orderCode(id),
      toolCode: req.toolCode,
      team: req.team,
      borrower: req.borrower,
      appliedAt: req.appliedAt as string,
      expectedReturn: req.expectedReturn,
      status: '待领用',
    }
    draft.orders.push(order)
    winners.set(req.toolCode, order)
    decisions.set(index, { orderCode: order.code })
  }

  assertInvariant(draft)

  const receipts: ClaimReceipt[] = normalized.map((entry, index) => {
    const base = { index, toolCode: entry.req.toolCode, team: entry.req.team }
    if (!entry.ok) {
      return { ...base, ok: false, reason: 'invalid' as const, message: entry.invalidReason as string }
    }
    const decision = decisions.get(index)!
    if (decision.conflict) {
      const winner = decision.winner as LoanOrder
      return {
        ...base,
        ok: false,
        reason: 'overlap' as const,
        winner: `${winner.team}（${winner.code}，申领于 ${dateOnly(winner.appliedAt)}，预计 ${winner.expectedReturn} 归还）`,
        message: `器具 ${entry.req.toolCode} 在该时段已被 ${winner.team} 占用：申领更早/预计归还更早者优先，本张申领被拒收`,
      }
    }
    return { ...base, ok: true, orderCode: decision.orderCode, message: `申领成功，借用单 ${decision.orderCode} 已进入「待领用」` }
  })

  return { state: draft, receipts }
}

/** 单张申领的便捷封装。 */
export function applyClaim(state: LedgerState, req: ClaimRequest): { state: LedgerState; receipt: ClaimReceipt } {
  const { state: next, receipts } = applyClaims(state, [req])
  return { state: next, receipt: receipts[0] }
}

// ---------------------------------------------------------------------------
// 状态机：领用（待领用 -> 已借出）、登记归还（已借出 -> 待归还）
// ---------------------------------------------------------------------------

export function lendTool(state: LedgerState, orderId: number): LedgerState {
  return commit(state, (draft) => {
    const order = mustFindOrder(draft, orderId)
    if (order.status !== '待领用') {
      throw new Error(`借用单 ${order.code} 当前「${order.status}」，只有「待领用」可以领用出库`)
    }
    const tool = findTool(draft, order.toolCode)
    if (!tool || tool.status !== '在册') throw new Error(`器具 ${order.toolCode} 不在册，无法出库`)
    order.status = '已借出'
    order.lentAt = nowIso()
  })
}

export function registerReturn(state: LedgerState, orderId: number): LedgerState {
  return commit(state, (draft) => {
    const order = mustFindOrder(draft, orderId)
    if (order.status !== '已借出') {
      throw new Error(`借用单 ${order.code} 当前「${order.status}」：只有「已借出」才能登记归还，倒着改一律拒绝`)
    }
    order.status = '待归还'
    order.returnRegisteredAt = nowIso()
  })
}

// ---------------------------------------------------------------------------
// 归还闭环：一次把「借用单 + 器具在册/借出 + 巡查整改清单」三处同事务改掉
// ---------------------------------------------------------------------------

function describeIssue(conclusion: ReturnConclusion): { issue: string; action: string } {
  switch (conclusion) {
    case '逾期归还':
      return { issue: '工器具逾期归还，存在机坪占道、遗失风险', action: '班组说明逾期原因并签字确认，复核器具完好性' }
    case '器具损坏':
      return { issue: '归还器具存在损坏，已停止使用', action: '送修检定；无法修复的办理报废补购，明确责任人' }
    case '器具缺失':
      return { issue: '器具归还缺失，机坪上无编号器具占道/失联', action: '划定区域排查找回；无法找回的按编号注销并补购、追责' }
    case '正常归还':
    default:
      return { issue: '器具按期完好归还，无异常', action: '无需整改，归档备查' }
  }
}

/**
 * 核库闭环（待归还 -> 已归还）的内部实现，跑在外部事务草稿上：
 * 同一笔事务里完成——借用单状态推进、时间/结论落账、器具台账核减、
 * 巡查整改清单生成。任何一处失败整笔回滚。
 */
function completeOrderInTx(draft: LedgerState, order: LoanOrder, condition: ReturnCondition, returnedAt: string): ReturnReceipt {
  const base = { orderId: order.id, orderCode: order.code, toolCode: order.toolCode, team: order.team }

  if (order.status === '已归还') {
    return {
      ...base,
      ok: true,
      duplicated: true,
      fromStatus: '已归还',
      toStatus: '已归还',
      conclusion: order.conclusion,
      rectificationCode: draft.rectifications.find((item) => item.orderCode === order.code)?.code,
      message: `借用单 ${order.code} 已归还闭环，重复提交只记一次`,
    }
  }
  if (order.status !== '待归还') {
    return {
      ...base,
      ok: false,
      fromStatus: order.status,
      message: `借用单 ${order.code} 当前「${order.status}」：必须先登记归还，不能跳过核库（也不允许倒着改）`,
    }
  }

  const tool = findTool(draft, order.toolCode)
  if (!tool) {
    return { ...base, ok: false, fromStatus: order.status, message: `器具 ${order.toolCode} 档案不存在，拒绝闭环` }
  }

  const overdue = isOverdue(order.expectedReturn, returnedAt)
  let conclusion: ReturnConclusion
  if (condition === '损坏') conclusion = '器具损坏'
  else if (condition === '缺失') conclusion = '器具缺失'
  else if (overdue) conclusion = '逾期归还'
  else conclusion = '正常归还'

  // ① 借用单侧推进
  order.status = '已归还'
  order.returnedAt = returnedAt
  order.condition = condition
  order.conclusion = conclusion

  // ② 器具在册侧联动（与①同一事务）
  if (condition === '损坏') tool.status = '损坏停用'
  if (condition === '缺失') tool.status = '缺失注销'

  // ③ 归还结论落到机坪安全巡查整改清单（与①②同一事务）
  const { issue, action } = describeIssue(conclusion)
  draft.seq.rect += 1
  const rect: RectificationItem = {
    id: draft.seq.rect,
    code: rectCode(draft.seq.rect),
    source: '借用归还',
    orderCode: order.code,
    toolCode: order.toolCode,
    team: order.team,
    borrower: order.borrower,
    expectedReturn: order.expectedReturn,
    returnedAt: dateOnly(returnedAt),
    conclusion,
    issue,
    action,
    // 按期完好：登记即闭环；异常结论：进安全巡查整改清单，待整改。
    status: conclusion === '正常归还' ? '已闭环' : '待整改',
    createdAt: returnedAt,
    closedAt: conclusion === '正常归还' ? returnedAt : undefined,
  }
  draft.rectifications.push(rect)

  return {
    ...base,
    ok: true,
    fromStatus: '待归还',
    toStatus: '已归还',
    conclusion,
    rectificationCode: rect.code,
    message:
      conclusion === '正常归还'
        ? `借用单 ${order.code} 已按期完好归还，器具回到可借池`
        : `借用单 ${order.code} 已归还，结论「${conclusion}」，已生成巡查整改单 ${rect.code}`,
  }
}

/**
 * 批量归还：一次选中多条借用单整组提交。
 * - 「已借出」：本事务内顺序完成 登记归还 -> 核库闭环，不留中间态；
 * - 「待归还」：直接核库闭环；
 * - 「已归还」：幂等回执（重复提交只记一次）；
 * - 其余状态（待领用 / 不存在）：逐条跳过、逐条说明，不影响组内其它单。
 * 返回按提交顺序排列的逐条回执；conditionMap 提供单条现场核库结论，缺省「完好」。
 */
export function completeReturns(
  state: LedgerState,
  lines: ReturnLine[],
  options: { idempotencyKey?: string } = {},
): { state: LedgerState; receipts: ReturnReceipt[] } {
  const key = options.idempotencyKey
  if (key && state.processedKeys[key]) {
    return {
      state,
      receipts: state.processedKeys[key].receipts.map((item) =>
        item.ok ? { ...item, duplicated: true } : item,
      ),
    }
  }

  const returnedAt = nowIso()
  const receipts: ReturnReceipt[] = []

  const next = commit(state, (draft) => {
    for (const line of lines) {
      const order = draft.orders.find((row) => row.id === line.orderId)
      if (!order) {
        receipts.push({
          orderId: line.orderId,
          orderCode: '—',
          toolCode: '—',
          team: '—',
          ok: false,
          fromStatus: '不存在',
          message: `借用单 #${line.orderId} 不存在，已跳过`,
        })
        continue
      }

      // 已借出：同事务先补「登记归还」这一步，再闭环——状态机仍严格按序，只是不留停顿。
      if (order.status === '已借出') {
        order.status = '待归还'
        order.returnRegisteredAt = returnedAt
      }
      receipts.push(completeOrderInTx(draft, order, line.condition ?? '完好', returnedAt))
    }

    if (key) {
      draft.processedKeys[key] = { at: returnedAt, receipts: JSON.parse(JSON.stringify(receipts)) as ReturnReceipt[] }
    }
  })

  return { state: next, receipts }
}

/** 单条便捷封装。 */
export function completeReturn(state: LedgerState, orderId: number, condition: ReturnCondition = '完好', idempotencyKey?: string): { state: LedgerState; receipt: ReturnReceipt } {
  const { state: next, receipts } = completeReturns(state, [{ orderId, condition }], idempotencyKey ? { idempotencyKey } : {})
  return { state: next, receipt: receipts[0] }
}

// ---------------------------------------------------------------------------
// 巡查整改清单闭环
// ---------------------------------------------------------------------------

export function updateRectification(state: LedgerState, rectId: number, status: '整改中' | '已闭环'): LedgerState {
  return commit(state, (draft) => {
    const item = draft.rectifications.find((row) => row.id === rectId)
    if (!item) throw new Error(`整改单 #${rectId} 不存在`)
    if (item.status === '已闭环' && status !== '已闭环') throw new Error('整改单已闭环，不允许回退')
    item.status = status
    if (status === '已闭环') item.closedAt = nowIso()
  })
}

export function rectificationsFor(state: LedgerState): RectificationItem[] {
  return [...state.rectifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function mustFindOrder(state: LedgerState, orderId: number): LoanOrder {
  const order = state.orders.find((row) => row.id === orderId)
  if (!order) throw new Error(`借用单 #${orderId} 不存在`)
  return order
}
