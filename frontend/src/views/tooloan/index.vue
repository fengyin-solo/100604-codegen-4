<template>
  <section class="page tool-loan-page">
    <header class="page-head">
      <div>
        <h2>机坪工器具借用台账</h2>
        <p class="page-desc">
          器具档案、借用单与安全巡查整改清单串成一条链路；在册数、已借出数、可借出数均由器具档案和有效借用单同源计算。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="showToolForm = !showToolForm">器具建档</button>
        <button class="btn primary" type="button" @click="showLoanForm = !showLoanForm">申领借用</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">器具在册数</span>
        <strong class="stat-value">{{ ledger.totalRegistered }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已借出数</span>
        <strong class="stat-value">{{ ledger.totalBorrowed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">可借出数</span>
        <strong class="stat-value">{{ ledger.totalAvailable }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">同源校验</span>
        <strong class="stat-value" :class="{ 'ok-text': inventoryBalanced }">
          {{ inventoryBalanced ? '一致' : '不平' }}
        </strong>
      </article>
    </div>

    <form v-if="showToolForm" class="editor-card" @submit.prevent="submitTool">
      <h3>器具按编号建档</h3>
      <div class="form-grid">
        <label>
          <span>器具编号</span>
          <input v-model="toolForm.code" placeholder="如 FGC-0003" />
        </label>
        <label>
          <span>器具名称</span>
          <input v-model="toolForm.name" placeholder="反光锥 / 轮挡 / 牵引杆" />
        </label>
        <label>
          <span>器具类型</span>
          <input v-model="toolForm.type" placeholder="警示器具" />
        </label>
        <label>
          <span>存放区域</span>
          <input v-model="toolForm.area" placeholder="A区工具柜" />
        </label>
        <label>
          <span>建档日期</span>
          <input v-model="toolForm.createdDate" type="date" />
        </label>
      </div>
      <div class="form-actions">
        <button class="btn primary" type="submit">保存档案</button>
        <button class="btn ghost" type="button" @click="showToolForm = false">取消</button>
      </div>
    </form>

    <form v-if="showLoanForm" class="editor-card" @submit.prevent="submitLoan">
      <h3>登记借用单</h3>
      <div class="form-grid">
        <label>
          <span>器具编号</span>
          <select v-model="loanForm.toolCode">
            <option value="" disabled>请选择器具</option>
            <option v-for="tool in ledger.tools" :key="tool.器具编号" :value="tool.器具编号">
              {{ tool.器具编号 }}｜{{ tool.器具名称 }}｜{{ tool.器具状态 }}
            </option>
          </select>
        </label>
        <label>
          <span>借用班组</span>
          <input v-model="loanForm.team" placeholder="如 航线一班" />
        </label>
        <label>
          <span>借用人</span>
          <input v-model="loanForm.borrower" placeholder="借用人姓名" />
        </label>
        <label>
          <span>借用日期</span>
          <input v-model="loanForm.borrowDate" type="date" />
        </label>
        <label>
          <span>预计归还日期</span>
          <input v-model="loanForm.expectedReturnDate" type="date" :min="loanForm.borrowDate" />
        </label>
      </div>
      <p class="rule-text">{{ selectedToolQueue }}</p>
      <div class="form-actions">
        <button class="btn primary" type="submit">提交到待领用队列</button>
        <button class="btn ghost" type="button" @click="showLoanForm = false">取消</button>
      </div>
    </form>

    <section class="table-card">
      <h3>器具档案与同源库存</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>器具编号</th>
            <th>器具名称</th>
            <th>类型</th>
            <th>存放区域</th>
            <th>建档日期</th>
            <th>在册数量</th>
            <th>已借出数</th>
            <th>可借出数</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tool in ledger.tools" :key="tool.器具编号">
            <td>{{ tool.器具编号 }}</td>
            <td>{{ tool.器具名称 }}</td>
            <td>{{ tool.器具类型 }}</td>
            <td>{{ tool.存放区域 }}</td>
            <td>{{ tool.建档日期 }}</td>
            <td>{{ tool.在册数量 }}</td>
            <td>{{ tool.已借出数 }}</td>
            <td>{{ tool.可借出数 }}</td>
            <td>
              <span class="status-pill" :class="statusClass(tool.status)">{{ tool.status }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="table-card">
      <div class="section-head">
        <div>
          <h3>借用单链路</h3>
          <p class="rule-text">
            排序规则：同一件器具同时申领时，先按预计归还日期升序，再按申领时间升序，最后按借用单号升序。
          </p>
        </div>
        <div class="batch-bar">
          <select v-model="returnConclusion" aria-label="归还结论">
            <option value="完好">归还结论：完好</option>
            <option value="逾期">归还结论：逾期</option>
          </select>
          <button class="btn" type="button" :disabled="!selectedIds.length" @click="submitRegisterReturns">
            批量登记归还
          </button>
          <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="submitConfirmReturns">
            批量确认归还
          </button>
        </div>
      </div>

      <div class="flow-bar">
        <span v-for="(status, index) in statusFlow" :key="status">
          <em>{{ index + 1 }}</em>{{ status }}
        </span>
      </div>

      <form class="filter-bar compact" @submit.prevent>
        <label class="filter-item">
          <span>器具 / 单号 / 班组</span>
          <input v-model="keyword" placeholder="输入关键词检索" />
        </label>
        <label class="filter-item">
          <span>状态</span>
          <select v-model="statusFilter">
            <option value="">全部状态</option>
            <option v-for="status in statusFlow" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="clearFilters">清空筛选</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th class="check-cell">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate.prop="someVisibleSelected"
                @change="toggleAllVisible"
              />
            </th>
            <th>借用单号</th>
            <th>器具编号</th>
            <th>器具名称</th>
            <th>借用班组</th>
            <th>借用人</th>
            <th>借用日期</th>
            <th>预计归还</th>
            <th>申领时间</th>
            <th>归还日期</th>
            <th>当前状态</th>
            <th>归还结论 / 整改单</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="loan in filteredLoans" :key="String(loan.id)">
            <td class="check-cell">
              <input v-model="selectedIds" type="checkbox" :value="Number(loan.id)" />
            </td>
            <td>{{ loan.借用单号 }}</td>
            <td>{{ loan.器具编号 }}</td>
            <td>{{ loan.器具名称 }}</td>
            <td>{{ loan.借用班组 }}</td>
            <td>{{ loan.借用人 }}</td>
            <td>{{ loan.借用日期 }}</td>
            <td>{{ loan.预计归还日期 }}</td>
            <td>{{ loan.申领时间 }}</td>
            <td>{{ loan.归还日期 || '—' }}</td>
            <td>
              <span class="status-pill" :class="statusClass(loan.status)">{{ loan.status }}</span>
            </td>
            <td>
              <template v-if="loan.归还结论">
                {{ loan.归还结论 }}<br />
                <span class="muted-text">{{ loan.整改单号 }}</span>
              </template>
              <span v-else class="muted-text">—</span>
            </td>
            <td class="row-actions">
              <button v-if="loan.status === '待领用'" class="link" type="button" @click="issue(loan)">
                领用出库
              </button>
              <button v-else-if="loan.status === '已借出'" class="link" type="button" @click="registerOne(loan)">
                登记归还
              </button>
              <button v-else-if="loan.status === '待归还'" class="link" type="button" @click="confirmOne(loan)">
                确认归还
              </button>
              <span v-else class="muted-text">已闭环</span>
            </td>
          </tr>
          <tr v-if="!filteredLoans.length">
            <td :colspan="13" class="empty-state">暂无符合条件的借用单</td>
          </tr>
        </tbody>
      </table>
      <footer class="table-foot">
        <span>已选 {{ selectedIds.length }} 张；批量操作会逐条回执，只跳过不满足条件的借用单。</span>
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      </footer>
    </section>

    <section v-if="receipts.length" class="table-card receipt-card">
      <div class="section-head">
        <h3>批量处理逐条回执</h3>
        <button class="btn ghost" type="button" @click="receipts = []">清除回执</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>借用单号</th>
            <th>环节</th>
            <th>结果</th>
            <th>说明</th>
            <th>安全巡查整改单</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="receipt in receipts" :key="`${receipt.stage}-${receipt.id}`">
            <td>{{ receipt.借用单号 }}</td>
            <td>{{ receipt.stage }}</td>
            <td>
              <span class="receipt-result" :class="receipt.ok ? 'ok-text' : 'skip-text'">
                {{ receipt.ok ? '成功' : '跳过' }}
              </span>
            </td>
            <td>{{ receipt.message }}</td>
            <td>{{ receipt.整改单号 || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  LOAN_STATUSES,
  confirmReturns,
  createLoan,
  createTool,
  issueLoan,
  loadLedger,
  queueHint,
  registerReturns,
} from '@/api/tool-loan-service'
import type { ActionResult, LoanBatchResult, LoanOrder, LoanReceipt } from '@/data/types'

const statusFlow = [...LOAN_STATUSES]
const today = '2026-10-04'

const ledger = ref(loadLedger())
const keyword = ref('')
const statusFilter = ref('')
const selectedIds = ref<number[]>([])
const returnConclusion = ref('完好')
const receipts = ref<LoanReceipt[]>([])
const message = ref('')
const messageOk = ref(false)
const showToolForm = ref(false)
const showLoanForm = ref(false)

const toolForm = reactive({
  code: '',
  name: '',
  type: '',
  area: '',
  createdDate: today,
})

const loanForm = reactive({
  toolCode: '',
  team: '',
  borrower: '',
  borrowDate: today,
  expectedReturnDate: today,
})

const inventoryBalanced = computed(
  () =>
    ledger.value.totalRegistered ===
      ledger.value.totalBorrowed + ledger.value.totalAvailable &&
    ledger.value.tools.every((tool) => tool.在册数量 === tool.已借出数 + tool.可借出数),
)

const filteredLoans = computed(() => {
  const text = keyword.value.trim().toUpperCase()
  return [...ledger.value.loans]
    .sort((a, b) => b.申领时间.localeCompare(a.申领时间) || b.id - a.id)
    .filter((loan) => {
      const matchStatus = statusFilter.value ? loan.status === statusFilter.value : true
      const searchable = [
        loan.借用单号,
        loan.器具编号,
        loan.器具名称,
        loan.借用班组,
        loan.借用人,
      ].join(' ').toUpperCase()
      return matchStatus && (!text || searchable.includes(text))
    })
})

const visibleIds = computed(() => filteredLoans.value.map((loan) => Number(loan.id)))
const allVisibleSelected = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.includes(id)),
)
const someVisibleSelected = computed(
  () => visibleIds.value.some((id) => selectedIds.value.includes(id)) && !allVisibleSelected.value,
)
const selectedToolQueue = computed(() =>
  loanForm.toolCode ? queueHint(ledger.value.loans, loanForm.toolCode) : '请选择器具后查看待领用队首',
)

function reload(clearSelection = false) {
  ledger.value = loadLedger()
  if (clearSelection) selectedIds.value = []
}

function notify(result: ActionResult) {
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) reload()
}

function resetToolForm() {
  Object.assign(toolForm, { code: '', name: '', type: '', area: '', createdDate: today })
}

function resetLoanForm() {
  Object.assign(loanForm, {
    toolCode: '',
    team: '',
    borrower: '',
    borrowDate: today,
    expectedReturnDate: today,
  })
}

function submitTool() {
  const result = createTool(toolForm)
  notify(result)
  if (result.ok) {
    resetToolForm()
    showToolForm.value = false
  }
}

function submitLoan() {
  const result = createLoan(loanForm)
  notify(result)
  if (result.ok) {
    resetLoanForm()
    showLoanForm.value = false
  }
}

function issue(loan: LoanOrder) {
  notify(issueLoan(Number(loan.id)))
}

function appendReceipts(result: LoanBatchResult) {
  receipts.value = [...result.receipts, ...receipts.value]
  message.value = `提交完成：成功 ${result.successCount} 张，跳过 ${result.skippedCount} 张`
  messageOk.value = result.skippedCount === 0
  reload()
}

function registerOne(loan: LoanOrder) {
  appendReceipts(registerReturns([Number(loan.id)]))
}

function confirmOne(loan: LoanOrder) {
  appendReceipts(confirmReturns([Number(loan.id)], returnConclusion.value))
}

function submitRegisterReturns() {
  appendReceipts(registerReturns(selectedIds.value))
}

function submitConfirmReturns() {
  appendReceipts(confirmReturns(selectedIds.value, returnConclusion.value))
}

function toggleAllVisible(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const current = new Set(selectedIds.value)
  visibleIds.value.forEach((id) => {
    if (checked) current.add(id)
    else current.delete(id)
  })
  selectedIds.value = [...current]
}

function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
}

function statusClass(status: string): string {
  return {
    待领用: 'status-pending',
    已借出: 'status-active',
    待归还: 'status-warning',
    已归还: 'status-done',
    可借出: 'status-done',
  }[status] ?? ''
}
</script>

<style scoped>
.tool-loan-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-card,
.table-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}

.editor-card h3,
.table-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.form-grid label span,
.filter-item span {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 12px;
}

input,
select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}

.form-actions,
.section-head,
.batch-bar,
.table-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-actions {
  justify-content: flex-end;
  margin-top: 10px;
}

.section-head {
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.batch-bar {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.rule-text,
.muted-text {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 0;
}

.flow-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.flow-bar span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #eef2f7;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}

.flow-bar em {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-style: normal;
  font-size: 11px;
}

.filter-bar.compact {
  margin: 0 0 10px;
}

.check-cell {
  width: 36px;
  text-align: center;
}

.check-cell input {
  width: auto;
}

.status-pill {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  white-space: nowrap;
}

.status-pending {
  background: #e0f2fe;
  color: #0369a1;
}

.status-active {
  background: #fef3c7;
  color: #a16207;
}

.status-warning {
  background: #ffedd5;
  color: #c2410c;
}

.status-done {
  background: #dcfce7;
  color: #15803d;
}

.ok-text {
  color: #15803d;
}

.skip-text,
.error-text {
  color: #b42318;
}

.receipt-result {
  font-weight: 600;
}

.table-foot {
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: var(--muted);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 1280px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
