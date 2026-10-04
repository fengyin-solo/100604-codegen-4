/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type ToolAsset = EntryRow & {
  器具编号: string
  器具名称: string
  器具类型: string
  存放区域: string
  建档日期: string
  器具状态: string
}

export type LoanOrder = EntryRow & {
  借用单号: string
  器具编号: string
  器具名称: string
  借用班组: string
  借用人: string
  借用日期: string
  预计归还日期: string
  申领时间: string
  归还日期: string
  归还结论: string
  整改单号: string
}

export type ToolInventory = ToolAsset & {
  在册数量: number
  已借出数: number
  可借出数: number
}

export type LoanReceipt = {
  id: number
  借用单号: string
  ok: boolean
  stage: '登记归还' | '确认归还'
  message: string
  整改单号?: string
}

export type LoanBatchResult = {
  receipts: LoanReceipt[]
  successCount: number
  skippedCount: number
}

export type LoanLedger = {
  tools: ToolInventory[]
  loans: LoanOrder[]
  totalRegistered: number
  totalBorrowed: number
  totalAvailable: number
}

export type LoanDraft = {
  toolCode: string
  team: string
  borrower: string
  borrowDate: string
  expectedReturnDate: string
}

export type ToolDraft = {
  code: string
  name: string
  type: string
  area: string
  createdDate: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
