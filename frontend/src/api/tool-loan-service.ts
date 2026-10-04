import { listRows, saveAll } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  LoanBatchResult,
  LoanDraft,
  LoanLedger,
  LoanOrder,
  LoanReceipt,
  ToolAsset,
  ToolDraft,
  ToolInventory,
} from '@/data/types'

const TOOL_KEY = 'tooloan_tool'
const LOAN_KEY = 'tooloan'
const APRON_KEY = 'apron'

export const LOAN_STATUSES = ['待领用', '已借出', '待归还', '已归还'] as const
const OCCUPYING_STATUSES = ['已借出']
const RETURN_CONCLUSIONS = ['完好', '逾期']
const TODAY = '2026-10-04'

function asTool(row: EntryRow): ToolAsset {
  return row as ToolAsset
}

function asLoan(row: EntryRow): LoanOrder {
  return row as LoanOrder
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function pad(value: number, length = 3): string {
  return String(value).padStart(length, '0')
}

function todayText(): string {
  return TODAY
}

function activeLoans(loans: LoanOrder[]): LoanOrder[] {
  return loans.filter((loan) => OCCUPYING_STATUSES.includes(String(loan.status) as typeof OCCUPYING_STATUSES[number]))
}

function pendingReturnLoans(loans: LoanOrder[]): LoanOrder[] {
  return loans.filter((loan) => loan.status === '待归还')
}

function withInventory(tools: ToolAsset[], loans: LoanOrder[]): ToolInventory[] {
  const borrowedByTool = new Map<string, number>()
  const waitingByTool = new Set<string>()
  for (const loan of activeLoans(loans)) {
    borrowedByTool.set(loan.器具编号, (borrowedByTool.get(loan.器具编号) ?? 0) + 1)
  }
  for (const loan of pendingReturnLoans(loans)) {
    waitingByTool.add(loan.器具编号)
  }

  return tools.map((tool) => {
    const borrowed = borrowedByTool.get(tool.器具编号) ?? 0
    const waitingReturn = waitingByTool.has(tool.器具编号)
    const status = waitingReturn ? '待归还' : borrowed > 0 ? '已借出' : '可借出'
    return {
      ...tool,
      status,
      器具状态: status,
      pending: borrowed === 0,
      在册数量: 1,
      已借出数: borrowed,
      可借出数: 1 - borrowed,
    }
  })
}

export function loadLedger(): LoanLedger {
  const tools = listRows(TOOL_KEY).map(asTool)
  const loans = listRows(LOAN_KEY).map(asLoan)
  const inventory = withInventory(tools, loans)
  const totalRegistered = inventory.reduce((sum, item) => sum + item.在册数量, 0)
  const totalBorrowed = inventory.reduce((sum, item) => sum + item.已借出数, 0)

  return {
    tools: inventory,
    loans,
    totalRegistered,
    totalBorrowed,
    totalAvailable: totalRegistered - totalBorrowed,
  }
}

function requireText(value: string, label: string): ActionResult | null {
  if (value.trim() === '') {
    return { ok: false, message: `${label}不能为空` }
  }
  return null
}

export function createTool(draft: ToolDraft): ActionResult {
  const fields: [string, string][] = [
    [draft.code, '器具编号'],
    [draft.name, '器具名称'],
    [draft.type, '器具类型'],
    [draft.area, '存放区域'],
    [draft.createdDate, '建档日期'],
  ]
  for (const [value, label] of fields) {
    const invalid = requireText(value, label)
    if (invalid) return invalid
  }

  const tools = listRows(TOOL_KEY).map(asTool)
  const code = draft.code.trim().toUpperCase()
  if (tools.some((tool) => tool.器具编号 === code)) {
    return { ok: false, message: `器具编号 ${code} 已建档，不能重复建档` }
  }

  const tool: ToolAsset = {
    id: nextId(tools),
    status: '可借出',
    pending: true,
    abnormal: false,
    器具编号: code,
    器具名称: draft.name.trim(),
    器具类型: draft.type.trim(),
    存放区域: draft.area.trim(),
    建档日期: draft.createdDate,
    器具状态: '可借出',
  }
  saveAll({ ...allTables(), [TOOL_KEY]: [...tools, tool] })
  return { ok: true, message: `器具 ${code} 已建档，当前可借出` }
}

function createLoanNo(loans: LoanOrder[], borrowDate: string): string {
  const prefix = `LN-${borrowDate.replace(/-/g, '')}-`
  const serial = loans.filter((loan) => loan.借用单号.startsWith(prefix)).length + 1
  return `${prefix}${pad(serial)}`
}

export function createLoan(draft: LoanDraft): ActionResult {
  const fields: [string, string][] = [
    [draft.toolCode, '器具编号'],
    [draft.team, '借用班组'],
    [draft.borrower, '借用人'],
    [draft.borrowDate, '借用日期'],
    [draft.expectedReturnDate, '预计归还日期'],
  ]
  for (const [value, label] of fields) {
    const invalid = requireText(value, label)
    if (invalid) return invalid
  }

  const tools = listRows(TOOL_KEY).map(asTool)
  const loans = listRows(LOAN_KEY).map(asLoan)
  const code = draft.toolCode.trim().toUpperCase()
  const tool = tools.find((item) => item.器具编号 === code)
  if (!tool) {
    return { ok: false, message: `器具编号 ${code} 尚未建档` }
  }
  if (draft.expectedReturnDate < draft.borrowDate) {
    return { ok: false, message: '预计归还日期不能早于借用日期' }
  }

  const appliedAt = `${todayText()} ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
  const loan: LoanOrder = {
    id: nextId(loans),
    status: '待领用',
    pending: true,
    abnormal: false,
    借用单号: createLoanNo(loans, draft.borrowDate),
    器具编号: code,
    器具名称: tool.器具名称,
    借用班组: draft.team.trim(),
    借用人: draft.borrower.trim(),
    借用日期: draft.borrowDate,
    预计归还日期: draft.expectedReturnDate,
    申领时间: appliedAt,
    归还日期: '',
    归还结论: '',
    整改单号: '',
  }
  saveAll({ ...allTables(), [LOAN_KEY]: [...loans, loan] })
  return { ok: true, message: `借用单 ${loan.借用单号} 已进入待领用队列` }
}

function queueFirst(loans: LoanOrder[], toolCode: string): LoanOrder | null {
  const pending = loans
    .filter((loan) => loan.器具编号 === toolCode && loan.status === '待领用')
    .sort((a, b) => {
      const due = a.预计归还日期.localeCompare(b.预计归还日期)
      if (due !== 0) return due
      const applied = a.申领时间.localeCompare(b.申领时间)
      if (applied !== 0) return applied
      return a.借用单号.localeCompare(b.借用单号, 'zh-CN')
    })
  return pending[0] ?? null
}

export function issueLoan(id: number): ActionResult {
  const tables = allTables()
  const tools = tables[TOOL_KEY].map(asTool)
  const loans = tables[LOAN_KEY].map(asLoan)
  const loan = loans.find((item) => Number(item.id) === id)
  if (!loan) {
    return { ok: false, message: `没有找到编号为 ${id} 的借用单` }
  }
  if (loan.status !== '待领用') {
    return { ok: false, message: `借用单 ${loan.借用单号} 当前为「${loan.status}」，只有待领用单可领用出库` }
  }
  if (loans.some((item) => item.器具编号 === loan.器具编号 && ['已借出', '待归还'].includes(String(item.status)))) {
    return { ok: false, message: `器具 ${loan.器具编号} 尚有未闭环借用单，需完成归还核验后再出库` }
  }
  const winner = queueFirst(loans, loan.器具编号)
  if (winner && Number(winner.id) !== Number(loan.id)) {
    return {
      ok: false,
      message: `同时申领按预计归还日期、申领时间、借用单号排序，应先出库 ${winner.借用单号}（${winner.借用班组}）`,
    }
  }

  const nextLoans = loans.map((item) =>
    item.id === loan.id ? { ...item, status: '已借出', pending: true } : item,
  )
  const nextTools = tools.map((item) =>
    item.器具编号 === loan.器具编号
      ? { ...item, status: '已借出', pending: true, 器具状态: '已借出' }
      : item,
  )
  saveAll({ ...tables, [LOAN_KEY]: nextLoans, [TOOL_KEY]: nextTools })
  return { ok: true, message: `借用单 ${loan.借用单号} 已出库，器具与借出数量同源更新` }
}

function allTables(): Record<string, EntryRow[]> {
  return {
    [TOOL_KEY]: listRows(TOOL_KEY),
    [LOAN_KEY]: listRows(LOAN_KEY),
    [APRON_KEY]: listRows(APRON_KEY),
  }
}

type BatchStage = LoanReceipt['stage']

function skippedReceipt(id: number, stage: BatchStage, message: string, loan?: LoanOrder): LoanReceipt {
  return {
    id,
    借用单号: loan?.借用单号 ?? `ID-${id}`,
    ok: false,
    stage,
    message,
  }
}

function buildBatchResult(receipts: LoanReceipt[]): LoanBatchResult {
  return {
    receipts,
    successCount: receipts.filter((item) => item.ok).length,
    skippedCount: receipts.filter((item) => !item.ok).length,
  }
}

export function registerReturns(ids: number[]): LoanBatchResult {
  const receipts: LoanReceipt[] = []
  if (ids.length === 0) {
    return buildBatchResult(receipts)
  }

  const tables = allTables()
  const tools = tables[TOOL_KEY].map(asTool)
  const loans = tables[LOAN_KEY].map(asLoan)
  const seen = new Set<number>()

  for (const id of ids) {
    const loan = loans.find((item) => Number(item.id) === id)
    if (!loan) {
      receipts.push(skippedReceipt(id, '登记归还', '借用单不存在'))
      continue
    }
    if (seen.has(id)) {
      receipts.push(skippedReceipt(id, '登记归还', '同一张借用单重复提交，只记一次', loan))
      continue
    }
    seen.add(id)

    if (loan.status === '待归还') {
      receipts.push(skippedReceipt(id, '登记归还', '已登记归还，不能重复登记', loan))
      continue
    }
    if (loan.status === '已归还') {
      receipts.push(skippedReceipt(id, '登记归还', '借用单已归还，禁止倒着改', loan))
      continue
    }
    if (loan.status === '待领用') {
      receipts.push(skippedReceipt(id, '登记归还', '借用单尚未出库，禁止先归还再借出', loan))
      continue
    }

    loans.splice(loans.findIndex((item) => item.id === id), 1, {
      ...loan,
      status: '待归还',
      pending: true,
      归还日期: todayText(),
    })
    const toolIndex = tools.findIndex((item) => item.器具编号 === loan.器具编号)
    if (toolIndex >= 0) {
      // 登记归还即释放可借出数；器具保留「待归还」标识，等待核验结论落入巡查整改清单。
      tools[toolIndex] = { ...tools[toolIndex], status: '待归还', pending: true, 器具状态: '待归还' }
    }
    receipts.push({
      id,
      借用单号: loan.借用单号,
      ok: true,
      stage: '登记归还',
      message: '已登记归还，进入待归还核验',
    })
  }

  saveAll({ ...tables, [TOOL_KEY]: tools, [LOAN_KEY]: loans })
  return buildBatchResult(receipts)
}

function nextApronCode(rows: EntryRow[]): string {
  const serial = rows.reduce((max, row) => {
    const code = String(row['整改单号'] ?? row['巡查编号'] ?? '')
    const matched = code.match(/^APRO-(\d+)$/)
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1
  return `APRO-${pad(serial, 4)}`
}

export function confirmReturns(ids: number[], conclusion: string): LoanBatchResult {
  const receipts: LoanReceipt[] = []
  if (ids.length === 0) {
    return buildBatchResult(receipts)
  }
  if (!RETURN_CONCLUSIONS.includes(conclusion)) {
    return buildBatchResult(ids.map((id) => skippedReceipt(id, '确认归还', '请选择归还结论')))
  }

  const tables = allTables()
  const tools = tables[TOOL_KEY].map(asTool)
  const loans = tables[LOAN_KEY].map(asLoan)
  const apronRows = [...tables[APRON_KEY]]
  const seen = new Set<number>()

  for (const id of ids) {
    const loan = loans.find((item) => Number(item.id) === id)
    if (!loan) {
      receipts.push(skippedReceipt(id, '确认归还', '借用单不存在'))
      continue
    }
    if (seen.has(id)) {
      receipts.push(skippedReceipt(id, '确认归还', '同一张借用单重复提交，只记一次', loan))
      continue
    }
    seen.add(id)

    if (loan.status === '已归还') {
      receipts.push(
        skippedReceipt(
          id,
          '确认归还',
          loan.整改单号 ? `已归还并已生成整改单 ${loan.整改单号}` : '借用单已归还，禁止重复提交',
          loan,
        ),
      )
      continue
    }
    if (loan.status === '已借出') {
      receipts.push(skippedReceipt(id, '确认归还', '借用单尚未登记归还，不能跳过待归还', loan))
      continue
    }
    if (loan.status === '待领用') {
      receipts.push(skippedReceipt(id, '确认归还', '借用单尚未出库，禁止倒着改', loan))
      continue
    }

    const tool = tools.find((item) => item.器具编号 === loan.器具编号)
    const rectificationNo = nextApronCode(apronRows)
    const overdue = conclusion === '逾期'
    const apronRow: EntryRow = {
      id: nextId(apronRows),
      status: overdue ? '待整改' : '已复查',
      pending: overdue,
      abnormal: overdue,
      巡查编号: rectificationNo,
      巡查区域: tool?.存放区域 ?? '机坪工具存放点',
      巡查人员: '系统-归还核验',
      发现问题数: overdue ? 1 : 0,
      整改单号: rectificationNo,
      巡查时间: todayText(),
      复查日期: overdue ? '' : todayText(),
      巡查状态: overdue ? `归还核验：${conclusion}，待安全复查` : `归还核验：${conclusion}`,
    }
    apronRows.push(apronRow)

    const loanIndex = loans.findIndex((item) => item.id === id)
    loans[loanIndex] = {
      ...loan,
      status: '已归还',
      pending: false,
      abnormal: overdue,
      归还日期: todayText(),
      归还结论: conclusion,
      整改单号: rectificationNo,
    }

    const toolIndex = tools.findIndex((item) => item.器具编号 === loan.器具编号)
    if (toolIndex >= 0) {
      tools[toolIndex] = {
        ...tools[toolIndex],
        status: '可借出',
        pending: true,
        abnormal: false,
        器具状态: '可借出',
      }
    }

    receipts.push({
      id,
      借用单号: loan.借用单号,
      ok: true,
      stage: '确认归还',
      message: `已归还，结论「${conclusion}」，已落入安全巡查整改清单`,
      整改单号: rectificationNo,
    })
  }

  // 器具档案、借用单、安全巡查整改清单一次提交，避免只改其中一处。
  saveAll({
    ...tables,
    [TOOL_KEY]: tools,
    [LOAN_KEY]: loans,
    [APRON_KEY]: apronRows,
  })
  return buildBatchResult(receipts)
}


export function queueHint(loans: LoanOrder[], toolCode: string): string {
  const winner = queueFirst(loans, toolCode.trim().toUpperCase())
  return winner
    ? `队首：${winner.借用单号}｜${winner.借用班组}｜应还 ${winner.预计归还日期}`
    : '当前没有待领用申请'
}
