<template>
  <section class="page" data-module="loan">
    <header class="page-head">
      <div>
        <h2>机坪工器具借用台账</h2>
        <p class="page-desc">
          反光锥、轮挡、牵引杆按编号建档；在册数 / 已借出数 / 可借出数三处同源，
          归还时借用单、器具台账、巡查整改清单一笔事务联动。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="resetAll">恢复演示数据</button>
      </div>
    </header>

    <!-- 三处同源计数：全部由同一份状态推导，页面没有第二处计数 -->
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在册数（按编号建档）</span>
        <strong class="stat-value">{{ store.stock.registered }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已借出数（已借出+待归还）</span>
        <strong class="stat-value">{{ store.stock.lentOut + store.stock.pendingReturn }}</strong>
        <span class="stat-sub">已借出 {{ store.stock.lentOut }} · 待归还核库 {{ store.stock.pendingReturn }}</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">可借出数（在册 − 占用 − 锁定）</span>
        <strong class="stat-value">{{ store.stock.available }}</strong>
        <span class="stat-sub">已申领待领用锁定 {{ store.stock.reserved }} 件</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">巡查整改待办</span>
        <strong class="stat-value">{{ store.pendingRectificationCount }}</strong>
      </article>
    </div>
    <p class="source-note">
      同源校验：在册 {{ store.stock.registered }} = 可借出 {{ store.stock.available }} + 已借出
      {{ store.stock.lentOut }} + 待归还 {{ store.stock.pendingReturn }} + 待领用锁定
      {{ store.stock.reserved }}（该等式由数据层不变量强制，每次写入后校验）
    </p>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ===================== 器具档案 ===================== -->
    <template v-if="activeTab === 'tools'">
      <form class="filter-bar" @submit.prevent="addTool">
        <label class="filter-item">
          <span>器具编号 *</span>
          <input v-model="toolForm.code" placeholder="如 FGZ-003" />
        </label>
        <label class="filter-item">
          <span>器具名称 *</span>
          <input v-model="toolForm.name" placeholder="反光锥 / 轮挡 / 牵引杆" />
        </label>
        <label class="filter-item">
          <span>规格</span>
          <input v-model="toolForm.spec" placeholder="如 70cm 橡胶底座" />
        </label>
        <button class="btn primary" type="submit">按编号建档</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>器具编号</th><th>名称</th><th>规格</th><th>档案状态</th>
            <th>在册</th><th>已借出</th><th>待归还</th><th>待领用锁定</th><th>可借出</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tool in store.tools" :key="tool.id">
            <td>{{ tool.code }}</td>
            <td>{{ tool.name }}</td>
            <td>{{ tool.spec || '—' }}</td>
            <td>
              <span class="tag" :class="tool.status === '在册' ? 'ok' : 'bad'">{{ tool.status }}</span>
            </td>
            <td>{{ itemStock(tool.code).registered }}</td>
            <td>{{ itemStock(tool.code).lentOut }}</td>
            <td>{{ itemStock(tool.code).pendingReturn }}</td>
            <td>{{ itemStock(tool.code).reserved }}</td>
            <td><strong>{{ itemStock(tool.code).available }}</strong></td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- ===================== 借用单 ===================== -->
    <template v-if="activeTab === 'orders'">
      <!-- 申领：支持一次录入多条并发申领，统一裁定排序 -->
      <div class="panel">
        <h3>申领登记（可一次提交多个班组的并发申领，按统一规则裁定）</h3>
        <p class="rule-note">
          互斥规则：同一器具同一时段只允许一个班组占用。同时申领排序：
          ① 申领时间早者优先 → ② 预计归还日期早者优先（快借快还）→ ③ 按提交序号兜底。
        </p>
        <table class="data-table inner">
          <thead>
            <tr>
              <th>器具编号</th><th>借用班组</th><th>借用人</th><th>申领时间</th><th>预计归还日期</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in claimRows" :key="idx">
              <td><input v-model="row.toolCode" list="tool-code-list" placeholder="选择/输入编号" /></td>
              <td><input v-model="row.team" placeholder="如 航线一班组" /></td>
              <td><input v-model="row.borrower" placeholder="借用人" /></td>
              <td>
                <input v-model="row.appliedAtLocal" type="datetime-local" />
                <span class="hint">留空取受理时刻</span>
              </td>
              <td><input v-model="row.expectedReturn" type="date" /></td>
              <td>
                <button class="link danger" type="button" @click="removeClaimRow(idx)" :disabled="claimRows.length === 1">
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <datalist id="tool-code-list">
          <option v-for="tool in store.tools" :key="tool.code" :value="tool.code">{{ tool.name }} {{ tool.spec }}</option>
        </datalist>
        <div class="panel-actions">
          <button class="btn" type="button" @click="addClaimRow">增加一行申领</button>
          <button class="btn primary" type="button" @click="submitClaims">整组提交申领</button>
        </div>
        <ul v-if="claimReceipts.length" class="receipt-list">
          <li v-for="r in claimReceipts" :key="r.index" :class="r.ok ? 'ok' : 'bad'">
            第 {{ r.index + 1 }} 条 · {{ r.toolCode }} · {{ r.team }}：{{ r.message }}
          </li>
        </ul>
      </div>

      <!-- 借用单：按序四步流转 + 批量归还 -->
      <div class="panel">
        <div class="panel-head">
          <h3>借用单（待领用 → 已借出 → 待归还 → 已归还，禁止倒着改）</h3>
          <div class="panel-actions">
            <label class="filter-item inline">
              <span>批量核库结论</span>
              <select v-model="batchCondition">
                <option value="完好">完好</option>
                <option value="损坏">损坏</option>
                <option value="缺失">缺失</option>
              </select>
            </label>
            <button class="btn primary" type="button" :disabled="!selected.size" @click="submitBatchReturn">
              批量归还（{{ selected.size }} 张）
            </button>
          </div>
        </div>
        <p class="rule-note">
          「已借出」可勾选后整组登记并闭环归还；「待归还」直接核库闭环；「待领用」会被逐条跳过，
          「已归还」重复提交只记一次。每条都有独立回执，不满足条件的条不影响其余条。
        </p>
        <table class="data-table">
          <thead>
            <tr>
              <th class="check-col"><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
              <th>借用单号</th><th>器具编号</th><th>借用班组</th><th>借用人</th>
              <th>申领时间</th><th>预计归还</th><th>状态</th><th>归还结论</th><th>操作（按序）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orderedOrders" :key="order.id">
              <td>
                <input
                  type="checkbox"
                  :checked="selected.has(order.id)"
                  :disabled="order.status === '待领用'"
                  @change="toggleOne(order.id)"
                />
              </td>
              <td>{{ order.code }}</td>
              <td>{{ order.toolCode }}</td>
              <td>{{ order.team }}</td>
              <td>{{ order.borrower }}</td>
              <td>{{ formatDateTime(order.appliedAt) }}</td>
              <td :class="isOverdueOrder(order) ? 'overdue' : ''">{{ order.expectedReturn }}</td>
              <td><span class="tag" :class="statusClass(order.status)">{{ order.status }}</span></td>
              <td>{{ order.conclusion || '—' }}</td>
              <td class="row-actions">
                <button
                  v-if="order.status === '待领用'"
                  class="link"
                  type="button"
                  @click="doLend(order.id)"
                >领用出库</button>
                <button
                  v-if="order.status === '已借出'"
                  class="link"
                  type="button"
                  @click="doRegisterReturn(order.id)"
                >登记归还</button>
                <template v-if="order.status === '待归还'">
                  <select
                    class="inline-select"
                    :value="singleCondition(order.id)"
                    @change="onSingleConditionChange(order.id, $event)"
                  >
                    <option value="完好">完好</option>
                    <option value="损坏">损坏</option>
                    <option value="缺失">缺失</option>
                  </select>
                  <button class="link" type="button" @click="doComplete(order.id, singleCondition(order.id))">
                    核库闭环
                  </button>
                </template>
                <button
                  v-if="order.status === '已借出' || order.status === '待归还'"
                  class="link"
                  type="button"
                  @click="selectAndReturn(order.id)"
                >一键归还</button>
                <span v-if="order.status === '已归还'" class="muted">已闭环</span>
              </td>
            </tr>
          </tbody>
        </table>
        <ul v-if="returnReceipts.length" class="receipt-list">
          <li v-for="(r, i) in returnReceipts" :key="i" :class="r.ok ? 'ok' : 'bad'">
            {{ r.orderCode }} · {{ r.toolCode }} · {{ r.team }}：{{ r.message }}
          </li>
        </ul>
      </div>
    </template>

    <!-- ===================== 巡查整改清单 ===================== -->
    <template v-if="activeTab === 'rects'">
      <p class="rule-note">
        以下整改项全部来源于借用归还闭环：每次核库都登记一条；逾期、损坏、缺失为「待整改」，
        与机坪安全巡查模块共用同一份清单（见「机坪安全巡查」页底部）。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>整改单号</th><th>来源借用单</th><th>器具编号</th><th>班组/借用人</th>
            <th>应还/实还</th><th>归还结论</th><th>问题描述</th><th>整改措施</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in store.rectificationList" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.orderCode }}</td>
            <td>{{ item.toolCode }}</td>
            <td>{{ item.team }} / {{ item.borrower }}</td>
            <td>{{ item.expectedReturn }} / {{ item.returnedAt }}</td>
            <td><span class="tag" :class="item.conclusion === '正常归还' ? 'ok' : 'warn'">{{ item.conclusion }}</span></td>
            <td>{{ item.issue }}</td>
            <td>{{ item.action }}</td>
            <td><span class="tag" :class="rectClass(item.status)">{{ item.status }}</span></td>
            <td class="row-actions">
              <button v-if="item.status === '待整改'" class="link" type="button" @click="setRect(item.id, '整改中')">开始整改</button>
              <button v-if="item.status !== '已闭环'" class="link" type="button" @click="setRect(item.id, '已闭环')">复查闭环</button>
              <span v-else class="muted">已闭环 {{ item.closedAt ? formatDate(item.closedAt) : '' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span>所有写入均经数据层不变量校验；校验不通过的操作整笔不落盘。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { useLoanStore } from '@/stores/loan'
import type { ClaimReceipt, LoanStatus, ReturnCondition, ReturnReceipt } from '@/data/loan/types'

const store = useLoanStore()

const tabs = [
  { key: 'tools', label: '器具档案（在册台账）' },
  { key: 'orders', label: '借用单（申领/借出/归还）' },
  { key: 'rects', label: '巡查整改清单' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('tools')

const errorMessage = ref('')

function fail(error: unknown) {
  errorMessage.value = error instanceof Error ? error.message : '操作失败'
  // eslint-disable-next-line no-console
  console.error(error)
}

function itemStock(code: string) {
  return store.toolStock(code)
}

// ---------------- 器具建档 ----------------
const toolForm = reactive({ code: '', name: '', spec: '' })

function addTool() {
  errorMessage.value = ''
  try {
    store.addTool({ code: toolForm.code, name: toolForm.name, spec: toolForm.spec })
    toolForm.code = ''
    toolForm.name = ''
    toolForm.spec = ''
  } catch (error) {
    fail(error)
  }
}

// ---------------- 申领 ----------------
interface ClaimRow {
  toolCode: string
  team: string
  borrower: string
  appliedAtLocal: string
  expectedReturn: string
}

function emptyClaimRow(): ClaimRow {
  return { toolCode: '', team: '', borrower: '', appliedAtLocal: '', expectedReturn: '' }
}

const claimRows = ref<ClaimRow[]>([emptyClaimRow()])
const claimReceipts = ref<ClaimReceipt[]>([])

function addClaimRow() {
  claimRows.value.push(emptyClaimRow())
}

function removeClaimRow(index: number) {
  claimRows.value.splice(index, 1)
}

function submitClaims() {
  errorMessage.value = ''
  try {
    const requests = claimRows.value.map((row) => ({
      toolCode: row.toolCode,
      team: row.team,
      borrower: row.borrower,
      expectedReturn: row.expectedReturn,
      appliedAt: row.appliedAtLocal ? new Date(row.appliedAtLocal).toISOString() : undefined,
    }))
    claimReceipts.value = store.claimBatch(requests)
    claimRows.value = [emptyClaimRow()]
  } catch (error) {
    fail(error)
  }
}

// ---------------- 借用单流转 ----------------
const orderedOrders = computed(() =>
  [...store.orders].sort((a, b) => b.id - a.id),
)

function isOverdueOrder(order: { status: LoanStatus; expectedReturn: string; returnedAt?: string }): boolean {
  if (order.status === '已归还') return false
  const today = new Date().toISOString().slice(0, 10)
  return today > order.expectedReturn
}

function doLend(orderId: number) {
  errorMessage.value = ''
  try {
    store.lend(orderId)
  } catch (error) {
    fail(error)
  }
}

function doRegisterReturn(orderId: number) {
  errorMessage.value = ''
  try {
    store.registerReturn(orderId)
  } catch (error) {
    fail(error)
  }
}

function doComplete(orderId: number, condition: ReturnCondition = '完好') {
  errorMessage.value = ''
  try {
    returnReceipts.value = store.batchReturn([{ orderId, condition }], `ui-${orderId}-${Date.now()}`)
  } catch (error) {
    fail(error)
  }
}

// 待归还行就地选择的核库结论
const singleConditions = reactive(new Map<number, ReturnCondition>())
function singleCondition(orderId: number): ReturnCondition {
  return singleConditions.get(orderId) ?? '完好'
}
function setSingleCondition(orderId: number, condition: ReturnCondition) {
  singleConditions.set(orderId, condition)
}
function onSingleConditionChange(orderId: number, event: Event) {
  setSingleCondition(orderId, (event.target as HTMLSelectElement).value as ReturnCondition)
}

function selectAndReturn(orderId: number) {
  selected.value = new Set([orderId])
  submitBatchReturn()
}

// 批量归还勾选
const selected = ref<Set<number>>(new Set())
const batchCondition = ref<ReturnCondition>('完好')
const returnReceipts = ref<ReturnReceipt[]>([])

const allChecked = computed(() =>
  orderedOrders.value
    .filter((order) => order.status !== '待领用')
    .every((order) => selected.value.has(order.id)),
)

function toggleOne(orderId: number) {
  const next = new Set(selected.value)
  if (next.has(orderId)) next.delete(orderId)
  else next.add(orderId)
  selected.value = next
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selected.value = checked
    ? new Set(orderedOrders.value.filter((order) => order.status !== '待领用').map((order) => order.id))
    : new Set()
}

function submitBatchReturn() {
  errorMessage.value = ''
  try {
    const lines = orderedOrders
      .value.filter((order) => selected.value.has(order.id))
      .map((order) => ({ orderId: order.id, condition: batchCondition.value }))
    if (!lines.length) return
    returnReceipts.value = store.batchReturn(lines, `ui-batch-${Date.now()}`)
    selected.value = new Set()
  } catch (error) {
    fail(error)
  }
}

// ---------------- 整改清单 ----------------
function setRect(rectId: number, status: '整改中' | '已闭环') {
  errorMessage.value = ''
  try {
    store.setRectificationStatus(rectId, status)
  } catch (error) {
    fail(error)
  }
}

// ---------------- 杂项 ----------------
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function statusClass(status: LoanStatus): string {
  if (status === '已归还') return 'ok'
  if (status === '待归还') return 'warn'
  if (status === '已借出') return 'info'
  return 'muted-tag'
}

function rectClass(status: string): string {
  if (status === '已闭环') return 'ok'
  if (status === '整改中') return 'info'
  return 'warn'
}

function resetAll() {
  errorMessage.value = ''
  claimReceipts.value = []
  returnReceipts.value = []
  selected.value = new Set()
  store.resetAll()
}
</script>

<style scoped>
.stat-sub { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
.source-note { font-size: 12px; color: #334e7d; background: #eef4ff; border: 1px solid #cdddff; border-radius: 6px; padding: 6px 10px; margin: 0 0 12px; }
.tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tab { border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 8px 14px; cursor: pointer; font-size: 13px; color: var(--muted); }
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 14px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.panel h3 { margin: 0 0 6px; font-size: 14px; }
.panel-actions { display: flex; gap: 8px; align-items: flex-end; margin-top: 10px; }
.rule-note { font-size: 12px; color: var(--muted); margin: 0 0 10px; }
.data-table.inner { margin-bottom: 0; }
.filter-item.inline span { display: inline; margin-right: 6px; }
.hint { font-size: 11px; color: var(--muted); margin-left: 6px; }
.check-col { width: 36px; text-align: center; }
.inline-select { font-size: 12px; margin-right: 4px; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.tag.ok { background: #e7f6ec; color: #1d7a3d; }
.tag.warn { background: #fff3e0; color: #b15a00; }
.tag.bad { background: #fdeceb; color: #b42318; }
.tag.info { background: #e8f0fe; color: #1f5ec9; }
.tag.muted-tag { background: #eef2f7; color: #536071; }
.muted { color: var(--muted); font-size: 12px; }
.overdue { color: #b42318; font-weight: 600; }
.link.danger { color: #b42318; }
.receipt-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.receipt-list li { font-size: 13px; border-radius: 6px; padding: 6px 10px; border: 1px solid; }
.receipt-list li.ok { background: #f3fbf5; border-color: #bfe6cb; color: #1d7a3d; }
.receipt-list li.bad { background: #fff5f4; border-color: #f3c4bf; color: #b42318; }
</style>
