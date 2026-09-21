// =====================================================================
// SALDAR SERVIÇOS — app.js (v21)
// =====================================================================

// ============================================================
// LOG DE ERROS — silencioso em produção
// ============================================================
const _origConsoleError = console.error.bind(console);

// ============================================================
// APP
// ============================================================

const LOCAL_KEY = 'saldar-servicos-v5-local';
const SETTINGS_KEY = 'saldar-servicos-v5-settings';
const LEGACY_KEYS = ['saldar-servicos-v4-local', 'saldar-servicos-v3-local', 'saldar-servicos-v2', 'saldar-servicos-v1'];
const LEGACY_SETTING_KEYS = ['saldar-servicos-v4-settings', 'saldar-servicos-v3-settings'];

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const money = (v) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'AOA', maximumFractionDigits: 2 }).format(Number(v || 0));

const uid = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

async function hashPassword(pass) {
  const data = new TextEncoder().encode('saldar-salt-v6::' + String(pass));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const isHash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);

// =====================================================================
// SESSÃO — Timeout por inatividade (Patch 8)
// =====================================================================
const IDLE_TIMEOUT_MIN = 30;       // ⏱️ 30 minutos em produção
const IDLE_WARNING_SEC = 60;       // ⚠️ Aviso 1 minuto antes de expirar
const IDLE_CHECK_INTERVAL_MS = 15 * 1000;

const idleState = {
  lastActivity: Date.now(),
  checkTimer: null,
  warningShown: false,
  listenersAttached: false
};

// =====================================================================
// CARRINHO DE VENDAS — Patch 10
// =====================================================================
const cart = {
  items: []   // { productId, productName, category, quantity, unitPrice, total }
};

// =====================================================================
// PATCH 16 — Instâncias dos gráficos (Chart.js)
// =====================================================================
const chartInstances = {
  sales7d: null,
  topProducts: null
};
// =====================================================================
// Defaults
// =====================================================================

function defaults() {
  return {
    products: [
      { id: uid(), name: 'Afrimoney', category: 'RL', stock: 0, minStock: 0, price: 0, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Unitel Money', category: 'RL', stock: 0, minStock: 0, price: 0, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Unitel mSeller', category: 'RL', stock: 0, minStock: 0, price: 0, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'ZAP', category: 'RL', stock: 0, minStock: 0, price: 0, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'DStv', category: 'RL', stock: 0, minStock: 0, price: 0, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Africel 1000', category: 'CF', stock: 0, minStock: 0, price: 1000, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Africel 500', category: 'CF', stock: 0, minStock: 0, price: 500, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Africel 200', category: 'CF', stock: 0, minStock: 0, price: 200, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Unitel 1000', category: 'CF', stock: 0, minStock: 0, price: 1000, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Unitel 500', category: 'CF', stock: 0, minStock: 0, price: 500, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 },
{ id: uid(), name: 'Unitel 200', category: 'CF', stock: 0, minStock: 0, price: 200, priceWholesale: 0, wholesaleQty: 5, priceVip: 0 }
    ],
    history: [],
    cashMovements: [],
    users: [
  { id: uid(), fullName: 'Administrador Geral', username: 'admin', password: 'admin123', role: 'admin', active: true, createdAt: now() },
  { id: uid(), fullName: 'Operador de Balcão', username: 'operador', password: '1234', role: 'operador', active: true, createdAt: now() }
],
  currentUserId: null,
  auditLog: [],
  clients: [],
  expenses: []
};
}

function normalize(raw) {
  const base = defaults();
  let products = Array.isArray(raw?.products) && raw.products.length ? raw.products : base.products;

  // Patch 17: garantir que todos os produtos têm os campos de multi-preço
  products = products.map(p => ({
    ...p,
    priceWholesale: Number(p.priceWholesale ?? 0),
    wholesaleQty: Number(p.wholesaleQty ?? 5),
    priceVip: Number(p.priceVip ?? 0)
  }));

  return {
    products,
    history: Array.isArray(raw?.history) ? raw.history : [],
    cashMovements: Array.isArray(raw?.cashMovements) ? raw.cashMovements : [],
    users: Array.isArray(raw?.users) && raw.users.length ? raw.users : base.users,
    currentUserId: raw?.currentUserId || null,
      auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [],
  clients: Array.isArray(raw?.clients) ? raw.clients : [],
  expenses: Array.isArray(raw?.expenses) ? raw.expenses : []
};
}

function loadLocal() {
  const current = localStorage.getItem(LOCAL_KEY);
  if (current) {
    try { return normalize(JSON.parse(current)); }
    catch {
      const fresh = defaults();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(fresh));
      return fresh;
    }
  }
  for (const key of LEGACY_KEYS) {
    const legacy = localStorage.getItem(key);
    if (!legacy) continue;
    try {
      const migrated = normalize(JSON.parse(legacy));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(migrated));
      return migrated;
    } catch { continue; }
  }
  const fresh = defaults();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(fresh));
  return fresh;
}

function loadSettings() {
  const current = localStorage.getItem(SETTINGS_KEY);
  if (current) {
    try { return JSON.parse(current) || { cloudEnabled: false, firebaseConfig: '', adminEmails: '' }; }
    catch { return { cloudEnabled: false, firebaseConfig: '', adminEmails: '' }; }
  }
  for (const key of LEGACY_SETTING_KEYS) {
    const legacy = localStorage.getItem(key);
    if (!legacy) continue;
    try {
      const migrated = JSON.parse(legacy) || { cloudEnabled: false, firebaseConfig: '' };
      migrated.adminEmails = migrated.adminEmails || '';
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      return migrated;
    } catch { continue; }
  }
  return { cloudEnabled: false, firebaseConfig: '', adminEmails: '' };
}

let state = loadLocal();
let settings = loadSettings();

const session = {
  authView: 'login',
  currentUser: null,
  pendingName: '',
  fbReady: false,
  app: null,
  auth: null,
  db: null,
  api: null,
  cloudUsers: [],
  unsubAuth: null,
  lastAuthError: null
};

const saveLocal = () => localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
const cloudMode = () => Boolean(settings.cloudEnabled && String(settings.firebaseConfig || '').trim());
const roleLabel = (role) => role === 'admin' ? 'Administrador' : 'Operador';
const byId = (id) => state.products.find((p) => p.id === id);
const getCurrentUser = () => cloudMode() ? session.currentUser : (state.users.find((u) => u.id === state.currentUserId) || null);
const isAdmin = () => getCurrentUser()?.role === 'admin';

// =====================================================================
// Permissões
// =====================================================================

const PERMISSIONS = {
  admin: {
    admin: true, dashboard: true, verFinanceiro: true, verSaldoCaixa: true,
    produtos: true, stock: true, venda: true, vendaDesconto: true, caixa: true,
    historico: true, historicoTodos: true, relatorio: true, usuarios: true,
    clientes: true, despesas: true, exportar: true, backup: true, nuvem: true, auditoria: true, comissoes: true
  },
  operador: {
    admin: false, dashboard: true, verFinanceiro: false, verSaldoCaixa: false,
    produtos: false, stock: false, venda: true, vendaDesconto: false, caixa: false,
    historico: true, historicoTodos: false, relatorio: false, usuarios: false,
    clientes: false, despesas: false, exportar: false, backup: false, nuvem: false, auditoria: false, comissoes: false
  }
};

function can(feature) {
  const role = getCurrentUser()?.role || 'operador';
  return PERMISSIONS[role]?.[feature] === true;
}

// =====================================================================
// Toggle password
// =====================================================================

window.togglePassword = function(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (input) {
    if (input.type === 'password') { input.type = 'text'; iconElement.textContent = '🙈'; }
    else { input.type = 'password'; iconElement.textContent = '👁️'; }
  }
};

// =====================================================================
// DOM
// =====================================================================

const els = {
  authShell: document.getElementById('authShell'),
  appShell: document.getElementById('appShell'),
  loginForm: document.getElementById('loginForm'),
  loginLabel: document.getElementById('loginLabel'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  fullNameWrap: document.getElementById('fullNameWrap'),
  registerFullName: document.getElementById('registerFullName'),
  confirmWrap: document.getElementById('confirmWrap'),
  confirmPassword: document.getElementById('confirmPassword'),
  switchAuthModeBtn: document.getElementById('switchAuthModeBtn'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),
  authHint: document.getElementById('authHint'),
  modeBadge: document.getElementById('modeBadge'),
  localAccessBox: document.getElementById('localAccessBox'),
  cloudEnabled: document.getElementById('cloudEnabled'),
  firebaseConfigInput: document.getElementById('firebaseConfigInput'),
  adminEmailsInput: document.getElementById('adminEmailsInput'),
  saveCloudConfigBtn: document.getElementById('saveCloudConfigBtn'),
  cloudStatusText: document.getElementById('cloudStatusText'),
  cloudTopBadge: document.getElementById('cloudTopBadge'),
  logoutBtn: document.getElementById('logoutBtn'),
  currentUserName: document.getElementById('currentUserName'),
  currentUserRole: document.getElementById('currentUserRole'),
  statsGrid: document.getElementById('statsGrid'),
  productSummary: document.getElementById('productSummary'),
  lowStockList: document.getElementById('lowStockList'),
  topSalesList: document.getElementById('topSalesList'),
  paymentSummary: document.getElementById('paymentSummary'),
  recentActivity: document.getElementById('recentActivity'),
  productForm: document.getElementById('productForm'),
  productEditId: document.getElementById('productEditId'),
  productName: document.getElementById('productName'),
  productCategory: document.getElementById('productCategory'),
  productStock: document.getElementById('productStock'),
  productMinStock: document.getElementById('productMinStock'),
  productPrice: document.getElementById('productPrice'),
  productPriceWholesale: document.getElementById('productPriceWholesale'),
productWholesaleQty: document.getElementById('productWholesaleQty'),
productPriceVip: document.getElementById('productPriceVip'),
  productSearch: document.getElementById('productSearch'),
  productCards: document.getElementById('productCards'),
  productFormMode: document.getElementById('productFormMode'),
  cancelProductEditBtn: document.getElementById('cancelProductEditBtn'),
  stockTable: document.getElementById('stockTable'),
  stockProduct: document.getElementById('stockProduct'),
  stockQty: document.getElementById('stockQty'),
  stockMin: document.getElementById('stockMin'),
  stockNote: document.getElementById('stockNote'),
  saleProduct: document.getElementById('saleProduct'),
  saleQty: document.getElementById('saleQty'),
  salePrice: document.getElementById('salePrice'),
  saleMethod: document.getElementById('saleMethod'),
  saleNote: document.getElementById('saleNote'),
  saleStockHint: document.getElementById('saleStockHint'),
  salePriceHint: document.getElementById('salePriceHint'),
  historyList: document.getElementById('historyList'),
  historyFilter: document.getElementById('historyFilter'),
  historyDateFrom: document.getElementById('historyDateFrom'),
historyDateTo: document.getElementById('historyDateTo'),
historyOperator: document.getElementById('historyOperator'),
historyClient: document.getElementById('historyClient'),
historyPayment: document.getElementById('historyPayment'),
clearHistoryFiltersBtn: document.getElementById('clearHistoryFiltersBtn'),
  dailyReport: document.getElementById('dailyReport'),
  reportRange: document.getElementById('reportRange'),
  cashSummary: document.getElementById('cashSummary'),
  cashType: document.getElementById('cashType'),
  cashAmount: document.getElementById('cashAmount'),
  cashNote: document.getElementById('cashNote'),
  userForm: document.getElementById('userForm'),
  userEditId: document.getElementById('userEditId'),
  userFullName: document.getElementById('userFullName'),
  userUsername: document.getElementById('userUsername'),
  userRole: document.getElementById('userRole'),
  userPassword: document.getElementById('userPassword'),
  userSubmitBtn: document.getElementById('userSubmitBtn'),
  userList: document.getElementById('userList'),
  userLoginLabel: document.getElementById('userLoginLabel'),
  userPassLabel: document.getElementById('userPassLabel'),
  cloudUserNotice: document.getElementById('cloudUserNotice'),
  cancelUserEditBtn: document.getElementById('cancelUserEditBtn'),
  exportBackupBtn: document.getElementById('exportBackupBtn'),
  importBackupFile: document.getElementById('importBackupFile'),
  importBackupBtn: document.getElementById('importBackupBtn'),
  cloudPanel: document.getElementById('cloudPanel'),
  toast: document.getElementById('toast'),
  installBtn: document.getElementById('installBtn'),
  exportPdfBtn: document.getElementById('exportPdfBtn'),
  pdfIconBtn: document.getElementById('pdfIconBtn'),
pdfPanel: document.getElementById('pdfPanel'),
  reportRangeBtn: document.getElementById('reportRangeBtn'),
reportRangeLabel: document.getElementById('reportRangeLabel'),
reportRangeModal: document.getElementById('reportRangeModal'),
reportRangeCancelBtn: document.getElementById('reportRangeCancelBtn'),
  appAlertModal: document.getElementById('appAlertModal'),
appAlertIcon: document.getElementById('appAlertIcon'),
appAlertTitle: document.getElementById('appAlertTitle'),
appAlertMessage: document.getElementById('appAlertMessage'),
appAlertOkBtn: document.getElementById('appAlertOkBtn'),
appConfirmModal: document.getElementById('appConfirmModal'),
appConfirmIcon: document.getElementById('appConfirmIcon'),
appConfirmTitle: document.getElementById('appConfirmTitle'),
appConfirmMessage: document.getElementById('appConfirmMessage'),
appConfirmOkBtn: document.getElementById('appConfirmOkBtn'),
appConfirmCancelBtn: document.getElementById('appConfirmCancelBtn'),
  pdfIncludeSummary: document.getElementById('pdfIncludeSummary'),
pdfIncludeByProduct: document.getElementById('pdfIncludeByProduct'),
pdfIncludeByClient: document.getElementById('pdfIncludeByClient'),
pdfIncludeByOperator: document.getElementById('pdfIncludeByOperator'),
pdfIncludeExpenses: document.getElementById('pdfIncludeExpenses'),
pdfIncludeSales: document.getElementById('pdfIncludeSales'),
  receiptModal: document.getElementById('receiptModal'),
  receiptContent: document.getElementById('receiptContent'),
  closeModal: document.querySelector('.close-modal'),
  forgotPasswordLink: document.getElementById('forgotPasswordLink'),
  resendVerifyLink: document.getElementById('resendVerifyLink'),
  financeiroContent: document.getElementById('financeiroContent'),
  auditLogList: document.getElementById('auditLogList'),
  auditLogFilter: document.getElementById('auditLogFilter'),
  idleWarningModal: document.getElementById('idleWarningModal'),
  idleWarningCountdown: document.getElementById('idleWarningCountdown'),
  connectivityBadge: document.getElementById('connectivityBadge'),
  drawerMenu: document.getElementById('drawerMenu'),
  drawerOverlay: document.getElementById('drawerOverlay'),
  openMenuBtn: document.getElementById('openMenuBtn'),
    closeMenuBtn: document.getElementById('closeMenuBtn'),
  cartList: document.getElementById('cartList'),
  cartSummary: document.getElementById('cartSummary'),
  cartTotalValue: document.getElementById('cartTotalValue'),
  cartItemCount: document.getElementById('cartItemCount'),
  clearCartBtn: document.getElementById('clearCartBtn'),
  finalizeSaleBtn: document.getElementById('finalizeSaleBtn'),
    lowStockModalList: document.getElementById('lowStockModalList'),
  clientForm: document.getElementById('clientForm'),
  clientEditId: document.getElementById('clientEditId'),
  clientName: document.getElementById('clientName'),
  clientPhone: document.getElementById('clientPhone'),
  clientEmail: document.getElementById('clientEmail'),
  clientNif: document.getElementById('clientNif'),
  clientVip: document.getElementById('clientVip'),
  clientNotes: document.getElementById('clientNotes'),
  clientSearch: document.getElementById('clientSearch'),
  clientCards: document.getElementById('clientCards'),
  clientFormMode: document.getElementById('clientFormMode'),
  cancelClientEditBtn: document.getElementById('cancelClientEditBtn'),
  saleClient: document.getElementById('saleClient'),
  pickClientBtn: document.getElementById('pickClientBtn'),
  pickClientModal: document.getElementById('pickClientModal'),
  pickClientSearch: document.getElementById('pickClientSearch'),
  pickClientList: document.getElementById('pickClientList'),
  pickClientNoneBtn: document.getElementById('pickClientNoneBtn'),
  pickClientNewBtn: document.getElementById('pickClientNewBtn'),
  newClientModal: document.getElementById('newClientModal'),
  quickClientName: document.getElementById('quickClientName'),
  quickClientPhone: document.getElementById('quickClientPhone'),
  quickClientNif: document.getElementById('quickClientNif'),
  quickClientCancelBtn: document.getElementById('quickClientCancelBtn'),
  quickClientSaveBtn: document.getElementById('quickClientSaveBtn'),
  clientHistoryModal: document.getElementById('clientHistoryModal'),
  clientHistoryContent: document.getElementById('clientHistoryContent'),
  expenseForm: document.getElementById('expenseForm'),
expenseEditId: document.getElementById('expenseEditId'),
expenseDate: document.getElementById('expenseDate'),
expenseCategory: document.getElementById('expenseCategory'),
expenseAmount: document.getElementById('expenseAmount'),
expenseDescription: document.getElementById('expenseDescription'),
expenseNotes: document.getElementById('expenseNotes'),
expenseFormMode: document.getElementById('expenseFormMode'),
cancelExpenseEditBtn: document.getElementById('cancelExpenseEditBtn'),
expenseRange: document.getElementById('expenseRange'),
expenseSummary: document.getElementById('expenseSummary'),
expenseFilter: document.getElementById('expenseFilter'),
expenseList: document.getElementById('expenseList'),
exportSalesCsvBtn: document.getElementById('exportSalesCsvBtn'),
exportStockCsvBtn: document.getElementById('exportStockCsvBtn'),
exportClientsCsvBtn: document.getElementById('exportClientsCsvBtn'),
exportAuditCsvBtn: document.getElementById('exportAuditCsvBtn'),
monthComparison: document.getElementById('monthComparison'),
chartSales7d: document.getElementById('chartSales7d'),
chartTopProducts: document.getElementById('chartTopProducts'),
  panelDetailModal: document.getElementById('panelDetailModal'),
panelDetailTitle: document.getElementById('panelDetailTitle'),
panelDetailBody: document.getElementById('panelDetailBody'),
panelDetailClose: document.getElementById('panelDetailClose'),
panelProductsCount: document.getElementById('panelProductsCount'),
panelLowStockCount: document.getElementById('panelLowStockCount'),
panelTopSalesCount: document.getElementById('panelTopSalesCount'),
panelPaymentsTotal: document.getElementById('panelPaymentsTotal'),
panelActivityCount: document.getElementById('panelActivityCount'),
panelFinanceiroTotal: document.getElementById('panelFinanceiroTotal'),
  stockEntryModal: document.getElementById('stockEntryModal'),
stockEntryClose: document.getElementById('stockEntryClose'),
openStockEntryBtn: document.getElementById('openStockEntryBtn'),
  userCommission: document.getElementById('userCommission'),
commissionRange: document.getElementById('commissionRange'),
commissionSummary: document.getElementById('commissionSummary'),
commissionList: document.getElementById('commissionList')
};

function toast(message, duration = 8000) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => els.toast.classList.add('hidden'), duration);
}

// =====================================================================
// PATCH 21 — Modais customizados
// =====================================================================

/**
 * Modal de alerta customizado (substitui alert()).
 * Devolve uma Promise que resolve quando o utilizador clica OK.
 */
function appAlert(message, title = 'Aviso', icon = 'ℹ️') {
  return new Promise((resolve) => {
    if (!els.appAlertModal) {
      alert(message);
      return resolve();
    }

    if (els.appAlertIcon) els.appAlertIcon.textContent = icon;
    if (els.appAlertTitle) els.appAlertTitle.textContent = title;
    if (els.appAlertMessage) els.appAlertMessage.textContent = String(message || '');

    els.appAlertModal.classList.remove('hidden');

    const cleanup = () => {
      els.appAlertModal.classList.add('hidden');
      els.appAlertOkBtn?.removeEventListener('click', onOk);
      els.appAlertModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);
      resolve();
    };

    const onOk = () => cleanup();

    const onBackdrop = (e) => {
      if (e.target === els.appAlertModal) cleanup();
    };

    const onEsc = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    els.appAlertOkBtn?.addEventListener('click', onOk);
    els.appAlertModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
  });
}

/**
 * Modal de confirmação customizado (substitui confirm()).
 * Devolve uma Promise que resolve com true (OK) ou false (Cancelar).
 */
function appConfirm(message, title = 'Confirmar', icon = '❓') {
  return new Promise((resolve) => {
    if (!els.appConfirmModal) {
      return resolve(confirm(message));
    }

    if (els.appConfirmIcon) els.appConfirmIcon.textContent = icon;
    if (els.appConfirmTitle) els.appConfirmTitle.textContent = title;
    if (els.appConfirmMessage) els.appConfirmMessage.textContent = String(message || '');

    els.appConfirmModal.classList.remove('hidden');

    const cleanup = (result) => {
      els.appConfirmModal.classList.add('hidden');
      els.appConfirmOkBtn?.removeEventListener('click', onOk);
      els.appConfirmCancelBtn?.removeEventListener('click', onCancel);
      els.appConfirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    const onBackdrop = (e) => {
      if (e.target === els.appConfirmModal) cleanup(false);
    };

    const onEsc = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };

    els.appConfirmOkBtn?.addEventListener('click', onOk);
    els.appConfirmCancelBtn?.addEventListener('click', onCancel);
    els.appConfirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
  });
}

// =====================================================================
// Diagnóstico
// =====================================================================

window.__saldarDebug = function() {
  const cfg = parseFirebaseConfig();
  const info = {
    cloudMode: cloudMode(),
    fbReady: session.fbReady,
    hasApp: !!session.app,
    hasAuth: !!session.auth,
    hasDb: !!session.db,
    hasApi: !!session.api,
    currentUser: session.currentUser?.email || null,
    currentRole: session.currentUser?.role || null,
    lastAuthError: session.lastAuthError,
    configValid: !!cfg,
    projectId: cfg?.projectId || null,
    idleTimeout: IDLE_TIMEOUT_MIN + ' min',
    idleWarning: IDLE_WARNING_SEC + ' s',
    navigatorOnline: navigator.onLine
  };
  _origConsoleError('[__saldarDebug]', info);
  return info;
};

window.__saldarLimparCache = async function() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
      await appAlert('Cache limpo. A recarregar...', 'Sucesso', '✅');
  location.reload(true);
} catch (e) {
  await appAlert('Erro ao limpar: ' + e.message, 'Erro', '❌');
  }
};

window.__saldarContinueSession = function() {
  resetIdleActivity();
  toast('Sessão renovada.');
};

// =====================================================================
// Firebase config
// =====================================================================

function parseFirebaseConfig() {
  try {
    const parsed = JSON.parse(settings.firebaseConfig || '{}');
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    _origConsoleError('[parseFirebaseConfig] JSON inválido:', err);
    return null;
  }
}

function cloudProjectName() {
  const cfg = parseFirebaseConfig();
  return cfg?.projectId || 'não configurado';
}

function markMode() {
  const online = cloudMode();
  if (els.modeBadge) els.modeBadge.textContent = online ? 'Modo online' : 'Modo local';
  if (els.cloudTopBadge) els.cloudTopBadge.textContent = online ? 'Firebase' : 'Local';
  if (els.authHint) els.authHint.textContent = online
    ? 'Use email e palavra-passe para entrar no modo online.'
    : 'Use os acessos locais ou ative o modo online com Firebase.';
  if (els.localAccessBox) els.localAccessBox.classList.toggle('hidden', online);
  if (els.cloudStatusText) els.cloudStatusText.textContent = online
    ? `Configuração online salva para o projeto ${cloudProjectName()}.`
    : 'Sem configuração online ativa.';
  if (els.forgotPasswordLink) els.forgotPasswordLink.classList.toggle('hidden', !online);
  if (els.resendVerifyLink) els.resendVerifyLink.classList.toggle('hidden', !online);
  updateConnectivityBadge();
}

function updateConnectivityBadge() {
  const badge = els.connectivityBadge;
  if (!badge) return;
  const configured = cloudMode();
  const online = navigator.onLine;
  let text = '';
  let cls = '';
  if (configured && online) {
    text = '🟢 Firebase ativo';
    cls = 'online';
  } else if (configured && !online) {
    text = '🟡 Offline — a usar cache';
    cls = 'offline-cache';
  } else {
    text = '⚪ Modo local';
    cls = 'local';
  }
  badge.textContent = text;
  badge.className = 'connectivity-badge ' + cls;
}

function switchAuthView(view = 'login') {
  session.authView = view;
  const online = cloudMode();
  if (els.loginLabel) els.loginLabel.textContent = online ? 'Email' : 'Usuário';
  if (els.userLoginLabel) els.userLoginLabel.textContent = online ? 'Email (apenas online)' : 'Nome de usuário';
  if (els.userPassLabel) els.userPassLabel.textContent = online ? 'Palavra-passe' : 'Palavra-passe';
  if (els.switchAuthModeBtn) els.switchAuthModeBtn.classList.toggle('hidden', !online);

  if (!online) {
    els.fullNameWrap?.classList.add('hidden');
    els.confirmWrap?.classList.add('hidden');
    if (els.loginSubmitBtn) els.loginSubmitBtn.textContent = 'Entrar';
    if (els.switchAuthModeBtn) els.switchAuthModeBtn.textContent = 'Criar conta online';
    if (els.userSubmitBtn) els.userSubmitBtn.textContent = 'Criar usuário';
    els.forgotPasswordLink?.classList.add('hidden');
    els.resendVerifyLink?.classList.add('hidden');
    return;
  }

  const register = view === 'register';
  els.fullNameWrap?.classList.toggle('hidden', !register);
  els.confirmWrap?.classList.toggle('hidden', !register);
  if (els.loginSubmitBtn) els.loginSubmitBtn.textContent = register ? 'Criar conta online' : 'Entrar';
  if (els.switchAuthModeBtn) els.switchAuthModeBtn.textContent = register ? 'Voltar ao login' : 'Criar conta online';
}

// =====================================================================
// Shell
// =====================================================================

function showApp(show) {
  els.authShell?.classList.toggle('hidden', show);
  els.appShell?.classList.toggle('hidden', !show);
  if (show) {
    const user = getCurrentUser();
    if (user) document.body.setAttribute('data-role', user.role);
    renderAll();
    setTimeout(() => hookIdleTimerToSession(), 500);
  } else {
    document.body.removeAttribute('data-role');
    stopIdleTimer();
    detachIdleListeners();
  }
}

function activate(tabId) {
  const tabBtn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  const group = tabBtn?.dataset.group;

  // 1. Sincronizar o grupo de navegação (nível 1)
  if (group) {
    document.querySelectorAll('.group-tab').forEach((g) => {
      g.classList.toggle('active', g.dataset.group === group);
    });
    // Mostrar apenas sub-tabs do grupo ativo
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.group) {
        t.classList.toggle('hidden', t.dataset.group !== group);
      }
    });
  }

  // 2. Ativar o painel e o sub-tab
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  tabBtn?.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
}
function applyPermissions() {
  document.querySelectorAll('[data-role="admin"]').forEach((el) => {
    el.classList.toggle('hidden', !can('admin'));
  });
  document.querySelectorAll('[data-perm]').forEach((el) => {
    el.classList.toggle('hidden', !can(el.dataset.perm));
  });

  // Esconder grupos que não têm nenhuma sub-tab permitida
document.querySelectorAll('.group-tab').forEach((groupBtn) => {
  const group = groupBtn.dataset.group;
  const allowedTabs = Array.from(document.querySelectorAll(`.tab[data-group="${group}"]`))
    .filter((t) => can(t.dataset.tab));
  groupBtn.classList.toggle('hidden', allowedTabs.length === 0);
});

    // Se o tab ativo já não é acessível, voltar ao dashboard
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  if (activeTab && !can(activeTab)) {
    activate('dashboard');
  } else {
    // Garantir que o grupo ativo está sincronizado no arranque
    const current = document.querySelector('.tab.active')?.dataset.tab || 'dashboard';
    activate(current);
  }
}

// =====================================================================
// PATCH 9 — Navegação por grupos
// =====================================================================

document.querySelectorAll('.group-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.group;
    // Encontrar a primeira sub-tab PERMITIDA deste grupo
    const firstTab = Array.from(document.querySelectorAll(`.tab[data-group="${group}"]`))
      .find((t) => can(t.dataset.tab));
    if (firstTab) activate(firstTab.dataset.tab);
  });
});

function requireAdmin() {
  if (!can('admin')) {
    toast('Apenas administradores podem usar esta área.');
    activate('dashboard');
    return false;
  }
  return true;
}

function require(feature, msg) {
  if (!can(feature)) { toast(msg || 'Sem permissão para esta ação.'); return false; }
  return true;
}

// =====================================================================
// DRAWER (menu lateral) — v11
// =====================================================================

function openDrawer() {
  els.drawerMenu?.classList.add('open');
  els.drawerOverlay?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  els.drawerMenu?.classList.remove('open');
  els.drawerOverlay?.classList.add('hidden');
  document.body.style.overflow = '';
}

els.openMenuBtn?.addEventListener('click', openDrawer);
els.closeMenuBtn?.addEventListener('click', closeDrawer);
els.drawerOverlay?.addEventListener('click', closeDrawer);

window.addEventListener('online', updateConnectivityBadge);
window.addEventListener('offline', updateConnectivityBadge);

// =====================================================================
// SESSÃO — Sistema de timeout (Patch 8)
// =====================================================================

function startIdleTimer() {
  stopIdleTimer();
  idleState.lastActivity = Date.now();
  idleState.warningShown = false;

  idleState.checkTimer = setInterval(() => {
    const inactiveSec = (Date.now() - idleState.lastActivity) / 1000;
    const limitSec = IDLE_TIMEOUT_MIN * 60;
    const warnAtSec = Math.max(0, limitSec - IDLE_WARNING_SEC);

    if (inactiveSec < warnAtSec) {
      idleState.warningShown = false;
      return;
    }

    if (inactiveSec >= warnAtSec && inactiveSec < limitSec) {
      const secondsLeft = Math.ceil(limitSec - inactiveSec);
      if (!idleState.warningShown) {
        idleState.warningShown = true;
        showIdleWarning(secondsLeft);
        _origConsoleError('[idle] Aviso mostrado. Segundos restantes:', secondsLeft);
      } else {
        if (els.idleWarningCountdown) els.idleWarningCountdown.textContent = secondsLeft;
      }
      return;
    }

    if (inactiveSec >= limitSec) {
      _origConsoleError('[idle] Timeout atingido. A terminar sessão...');
      handleIdleTimeout();
    }
  }, IDLE_CHECK_INTERVAL_MS);

  attachIdleListeners();
  _origConsoleError(`[idle] Timer iniciado (${IDLE_TIMEOUT_MIN} min / aviso ${IDLE_WARNING_SEC}s).`);
}

function stopIdleTimer() {
  if (idleState.checkTimer) {
    clearInterval(idleState.checkTimer);
    idleState.checkTimer = null;
  }
  hideIdleWarning();
  idleState.warningShown = false;
  _origConsoleError('[idle] Timer parado.');
}

function resetIdleActivity() {
  idleState.lastActivity = Date.now();
  if (idleState.warningShown) {
    idleState.warningShown = false;
    hideIdleWarning();
  }
}

function attachIdleListeners() {
  if (idleState.listenersAttached) return;
  idleState.listenersAttached = true;
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  events.forEach((evt) => {
    document.addEventListener(evt, resetIdleActivity, { passive: true });
  });
}

function detachIdleListeners() {
  if (!idleState.listenersAttached) return;
  idleState.listenersAttached = false;
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  events.forEach((evt) => {
    document.removeEventListener(evt, resetIdleActivity);
  });
}

function showIdleWarning(secondsLeft) {
  if (!els.idleWarningModal) return;
  els.idleWarningModal.classList.remove('hidden');
  if (els.idleWarningCountdown) els.idleWarningCountdown.textContent = secondsLeft;
}

function hideIdleWarning() {
  if (!els.idleWarningModal) return;
  els.idleWarningModal.classList.add('hidden');
}

async function handleIdleTimeout() {
  stopIdleTimer();
  detachIdleListeners();
  try {
    await logAudit('session-timeout', {
      minutes: IDLE_TIMEOUT_MIN,
      mode: cloudMode() ? 'online' : 'local'
    });
  } catch {}
  await logout();
  hideIdleWarning();
  toast(`Sessão expirada após ${IDLE_TIMEOUT_MIN} minutos de inatividade.`, 8000);
}

function hookIdleTimerToSession() {
  const user = getCurrentUser();
  if (user) startIdleTimer();
  else { stopIdleTimer(); detachIdleListeners(); }
}

// =====================================================================
// AUDITORIA — Patch 7
// =====================================================================

async function logAudit(action, details = {}) {
  const user = getCurrentUser();
  if (!user) return;

  const entry = {
    id: uid(),
    action: String(action || 'desconhecida'),
    userId: String(user.id || ''),
    userName: String(user.fullName || user.email || 'Desconhecido'),
    userRole: String(user.role || 'operador'),
    date: now(),
    details: details || {}
  };

  if (!Array.isArray(state.auditLog)) state.auditLog = [];
  state.auditLog.unshift(entry);
  if (state.auditLog.length > 1000) state.auditLog = state.auditLog.slice(0, 1000);
  saveLocal();

  if (!cloudMode() || !session.fbReady || !session.db || !session.api) return;
  try {
    const { doc, setDoc } = session.api;
    await setDoc(doc(session.db, 'auditLog', entry.id), {
      action: entry.action,
      userId: entry.userId,
      userName: entry.userName,
      userRole: entry.userRole,
      date: entry.date,
      details: entry.details
    });
    _origConsoleError('[logAudit] ✅', action);
  } catch (err) {
    _origConsoleError('[logAudit] ❌ Falha:', err?.code || err?.message);
  }
}

// =====================================================================
// Renders
// =====================================================================

function renderUserHeader() {
  const current = getCurrentUser();
  if (els.currentUserName) els.currentUserName.textContent = current?.fullName || 'Sem sessão';
  if (els.currentUserRole) els.currentUserRole.textContent = roleLabel(current?.role || 'operador');
}

function renderSelectOptions() {
  const options = state.products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (els.stockProduct) els.stockProduct.innerHTML = options;
  if (els.saleProduct) els.saleProduct.innerHTML = options;
  syncPrice();
  syncMin();
  updateSaleHint();
}

function getTodaySales() {
  return state.history.filter((item) => item.type === 'venda' && item.date.startsWith(today()));
}

function getCashBalance() {
  const salesCash = state.history.filter((item) => item.type === 'venda').reduce((sum, item) => sum + Number(item.total || 0), 0);
  const manualCash = state.cashMovements.reduce((sum, item) => sum + (item.kind === 'entrada' ? Number(item.amount || 0) : -Number(item.amount || 0)), 0);
  return salesCash + manualCash;
}

function rangeStart(range) {
  const end = new Date();
  const start = new Date(end);
  if (range === '7d') start.setDate(end.getDate() - 6);
  if (range === '30d') start.setDate(end.getDate() - 29);
  start.setHours(0, 0, 0, 0);
  return start;
}

function salesForRange(range) {
  if (range === 'today') return getTodaySales();
  const start = rangeStart(range);
  return state.history.filter((item) => item.type === 'venda' && new Date(item.date) >= start);
}

function cashForRange(range) {
  if (range === 'today') return state.cashMovements.filter((item) => item.date.startsWith(today()));
  const start = rangeStart(range);
  return state.cashMovements.filter((item) => new Date(item.date) >= start);
}

function paymentBreakdownToday() {
  const map = {};
  getTodaySales().forEach((sale) => {
    map[sale.paymentMethod] = (map[sale.paymentMethod] || 0) + Number(sale.total || 0);
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function topSalesToday() {
  const map = {};
  getTodaySales().forEach((sale) => {
    map[sale.productName] = (map[sale.productName] || 0) + Number(sale.quantity || 0);
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function recentActivities() {
  const records = [
    ...state.history.map((item) => ({ ...item, group: item.type })),
    ...state.cashMovements.map((item) => ({ ...item, group: 'caixa' }))
  ];
  return records.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
}

function renderStats() {
  if (!els.statsGrid) return;
  const totalUnits = state.products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  const lowCount = state.products.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)).length;
  const todayRevenue = getTodaySales().reduce((sum, item) => sum + Number(item.total || 0), 0);
  const activeUsers = (cloudMode() ? session.cloudUsers : state.users).filter((u) => u.active !== false).length || 1;

  // Ajuste A — "Mais vendido hoje" com valor total
  const topSalesData = topSalesToday()[0];
  const topProductName = topSalesData?.[0] || 'Sem vendas hoje';
  const topProductQty = topSalesData?.[1] || 0;
  const topProductValue = topProductQty > 0
    ? getTodaySales()
        .filter((s) => s.productName === topProductName)
        .reduce((s, i) => s + Number(i.total || 0), 0)
    : 0;
  const topProduct = topProductQty > 0
    ? `${topProductName} — ${money(topProductValue)}`
    : 'Sem vendas hoje';

  const stats = [
    { label: 'Total em stock', value: totalUnits },
    { label: 'Alertas ativos', value: lowCount, action: 'openLowStockModal' },
    { label: 'Vendas hoje', value: money(todayRevenue) },
    { label: 'Usuários ativos', value: activeUsers },
    { label: 'Mais vendido hoje', value: topProduct }
  ];
  if (can('verSaldoCaixa')) stats.splice(3, 0, { label: 'Caixa acumulado', value: money(getCashBalance()) });

  els.statsGrid.innerHTML = stats
    .map((s) => {
      const clickable = s.action ? ` style="cursor:pointer;" data-action="${esc(s.action)}"` : '';
      return `<div class="stat"${clickable}><small>${esc(s.label)}</small><strong>${esc(s.value)}</strong></div>`;
    })
    .join('');
}

function renderDashboard() {
  if (els.productSummary) {
    els.productSummary.innerHTML = state.products.length
      ? state.products.map((p) => `<div class="item"><strong>${esc(p.name)}</strong><span>${esc(p.category)}</span><br /><span>${p.category === 'RL' ? money(p.stock) + ' (saldo)' : p.stock + ' un.'} • ${p.category === 'RL' ? 'Preço variável' : money(p.price)}</span></div>`).join('')
      : '<div class="item empty-state">Sem produtos cadastrados.</div>';
  }
  if (els.lowStockList) {
    const lows = state.products.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0));
    els.lowStockList.innerHTML = lows.length
      ? lows.map((p) => `<div class="item"><strong>${esc(p.name)}</strong><span class="badge low">Stock baixo: ${p.category === 'RL' ? money(p.stock) : p.stock}</span></div>`).join('')
      : '<div class="item"><strong>Sem alertas</strong><span>Todos os produtos estão acima do mínimo.</span></div>';
  }
  if (els.topSalesList) {
    const tops = topSalesToday();
    els.topSalesList.innerHTML = tops.length
      ? tops.map(([name, qty]) => `<div class="item"><strong>${esc(name)}</strong><span>${qty} ${qty === 1 ? 'unidade' : 'unidades'} vendidas hoje</span></div>`).join('')
      : '<div class="item"><strong>Sem vendas hoje</strong><span>Registre vendas para visualizar o ranking.</span></div>';
  }
  if (els.paymentSummary) {
    const payments = paymentBreakdownToday();
    els.paymentSummary.innerHTML = payments.length
      ? payments.map(([method, total]) => `<div class="item"><strong>${esc(method)}</strong><span>${money(total)}</span></div>`).join('')
      : '<div class="item"><strong>Sem pagamentos hoje</strong><span>Nenhuma venda registrada.</span></div>';
  }
  if (els.recentActivity) {
    const activities = recentActivities();
    els.recentActivity.innerHTML = activities.length
      ? activities.map((item) => {
          if (item.group === 'venda') return `<div class="item"><strong>Venda • ${esc(item.productName)}</strong><span>${esc(item.quantity)} x ${money(item.unitPrice)} = ${money(item.total)}</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span></div>`;
          if (item.group === 'stock') return `<div class="item"><strong>Entrada de stock • ${esc(item.productName)}</strong><span>+${esc(item.quantity)} unidades</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span></div>`;
          return `<div class="item"><strong>Caixa • ${item.kind === 'entrada' ? 'Entrada' : 'Saída'}</strong><span>${money(item.amount)}</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span></div>`;
        }).join('')
      : '<div class="item"><strong>Sem movimentações</strong><span>As últimas ações do sistema aparecerão aqui.</span></div>';
  }
  // Mini-cartões do Painel
if (els.panelProductsCount) {
  els.panelProductsCount.textContent =
    `${state.products.length} ${state.products.length === 1 ? 'produto' : 'produtos'}`;
}
if (els.panelLowStockCount) {
  const n = state.products.filter(p => Number(p.stock || 0) <= Number(p.minStock || 0)).length;
  els.panelLowStockCount.textContent = n === 0 ? 'Sem alertas' : `${n} ${n === 1 ? 'alerta' : 'alertas'}`;
}
if (els.panelTopSalesCount) {
  const t = topSalesToday();
  els.panelTopSalesCount.textContent = t.length === 0 ? 'Sem vendas' : `Top: ${t[0][0]}`;
}
if (els.panelPaymentsTotal) {
  const p = paymentBreakdownToday();
  const total = p.reduce((s, [, v]) => s + v, 0);
  els.panelPaymentsTotal.textContent = p.length === 0 ? 'Sem pagamentos' : money(total);
}
if (els.panelActivityCount) {
  els.panelActivityCount.textContent = `${recentActivities().length} recentes`;
}
}

function renderProductCards() {
  if (!els.productCards) return;
  const term = els.productSearch?.value.trim().toLowerCase() || '';
  const products = state.products.filter((p) => {
    if (!term) return true;
    return p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term);
  });
  els.productCards.classList.remove('compact');
  els.productCards.classList.add('carousel-slider');
  els.productCards.innerHTML = products.length
    ? products.map((p) => `
      <div class="item">
        <div class="product-name-row">
          <strong>${esc(p.name)}</strong>
          <span class="badge ${Number(p.stock) <= Number(p.minStock) ? 'low' : 'info'}">${p.category === 'RL' ? money(p.stock) : p.stock + ' un.'}</span>
        </div>
        <span>${esc(p.category)}</span><br />
        <span>${p.category === 'RL' ? 'Preço variável' : money(p.price)}</span>
        <div class="meta-row">
          <span class="badge warning">Mínimo: ${p.category === 'RL' ? money(p.minStock) : p.minStock}</span>
        </div>
        <div class="card-actions">
          <button class="secondary-btn" data-action="edit-product" data-id="${esc(p.id)}">Editar</button>
          <button class="danger-btn" data-action="delete-product" data-id="${esc(p.id)}">Remover</button>
        </div>
      </div>
    `).join('')
    : '<div class="item empty-state">Nenhum produto encontrado.</div>';
}

function renderStock() {
  if (!els.stockTable) return;
  els.stockTable.innerHTML = state.products.map((p) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.category)}</td>
      <td>${p.category === 'RL' ? money(p.stock) : p.stock}</td>
      <td>${p.category === 'RL' ? money(p.minStock) : p.minStock}</td>
      <td>${p.category === 'RL' ? 'Variável' : money(p.price)}</td>
    </tr>
  `).join('');
}

function normalizeHistory() {
  const user = getCurrentUser();
  let combined = [
    ...state.history.map((item) => ({ ...item, group: item.type })),
    ...state.cashMovements.map((item) => ({ ...item, group: 'caixa' }))
  ];

  // Patch 19: filtros avançados
  const typeFilter = els.historyFilter?.value || 'todos';
  const dateFrom = els.historyDateFrom?.value || '';
  const dateTo = els.historyDateTo?.value || '';
  const operatorFilter = els.historyOperator?.value || '';
  const clientFilter = els.historyClient?.value || '';
  const paymentFilter = els.historyPayment?.value || '';

  combined.sort((a, b) => new Date(b.date) - new Date(a.date));

  return combined.filter((item) => {
    // Operador vê apenas o que criou
    if (!can('historicoTodos') && user && item.createdById !== user.id) return false;

    // Tipo
    if (typeFilter !== 'todos' && item.group !== typeFilter) return false;

    // Operador
    if (operatorFilter && item.createdById !== operatorFilter) return false;

    // Data início
    if (dateFrom) {
      const itemDate = (item.date || '').slice(0, 10);
      if (itemDate < dateFrom) return false;
    }

    // Data fim
    if (dateTo) {
      const itemDate = (item.date || '').slice(0, 10);
      if (itemDate > dateTo) return false;
    }

    // Cliente (só vendas têm clientId)
    if (clientFilter) {
      if (item.type !== 'venda' || item.clientId !== clientFilter) return false;
    }

    // Método de pagamento (só vendas têm paymentMethod)
    if (paymentFilter) {
      if (item.type !== 'venda' || item.paymentMethod !== paymentFilter) return false;
    }

    return true;
  });
}

// =====================================================================
// PATCH 19 — Popular dropdowns de operadores e clientes
// =====================================================================

function populateHistoryFilters() {
  // 1. Operadores (a partir do histórico)
  if (els.historyOperator) {
    const current = els.historyOperator.value;
    const operators = new Map();

    (state.history || []).forEach(h => {
      if (h.createdById && h.createdByName) {
        operators.set(h.createdById, h.createdByName);
      }
    });

    const options = Array.from(operators.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`)
      .join('');

    els.historyOperator.innerHTML = `<option value="">Todos os operadores</option>${options}`;

    if (current && operators.has(current)) {
      els.historyOperator.value = current;
    }
  }

  // 2. Clientes (a partir do state.clients)
  if (els.historyClient) {
    const current = els.historyClient.value;
    const clients = (state.clients || []).slice().sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );

    const options = clients
      .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
      .join('');

    els.historyClient.innerHTML = `<option value="">Todos os clientes</option>${options}`;

    if (current && clients.some(c => c.id === current)) {
      els.historyClient.value = current;
    }
  }
}

function renderHistory() {
  if (!els.historyList) return;
  populateHistoryFilters();
  const records = normalizeHistory();
  els.historyList.innerHTML = records.length
    ? records.map((item) => {
        if (item.group === 'venda') {
          return `<div class="item"><strong>Venda • ${esc(item.productName)}</strong><span>${esc(item.quantity)} x ${money(item.unitPrice)} = ${money(item.total)}</span><br /><span>${esc(item.paymentMethod)} • ${new Date(item.date).toLocaleString('pt-PT')}</span>${item.note ? `<br /><span>${esc(item.note)}</span>` : ''}<div class="meta-row"><span class="badge info">Por: ${esc(item.createdByName || 'Sistema')}</span><button class="secondary-btn" style="padding: 4px 10px; font-size: 12px; margin-left: 8px;" onclick="window.imprimirRecibo('${esc(item.id)}')">🧾 Recibo</button></div></div>`;
        }
        if (item.group === 'stock') {
          return `<div class="item"><strong>Entrada de stock • ${esc(item.productName)}</strong><span>+${esc(item.quantity)} unidades</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span>${item.note ? `<br /><span>${esc(item.note)}</span>` : ''}<div class="meta-row"><span class="badge info">Por: ${esc(item.createdByName || 'Sistema')}</span></div></div>`;
        }
        return `<div class="item"><strong>Caixa • ${item.kind === 'entrada' ? 'Entrada' : 'Saída'}</strong><span class="badge ${item.kind === 'saida' ? 'out' : ''}">${money(item.amount)}</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span><br /><span>${esc(item.note)}</span><div class="meta-row"><span class="badge info">Por: ${esc(item.createdByName || 'Sistema')}</span></div></div>`;
      }).join('')
    : '<div class="item"><strong>Sem registros</strong><span>Nenhuma movimentação encontrada.</span></div>';
}

function renderCash() {
  if (!els.cashSummary) return;
  const entradas = state.cashMovements.filter((m) => m.kind === 'entrada').reduce((s, m) => s + Number(m.amount || 0), 0);
  const saidas = state.cashMovements.filter((m) => m.kind === 'saida').reduce((s, m) => s + Number(m.amount || 0), 0);
  const vendas = state.history.filter((m) => m.type === 'venda').reduce((s, m) => s + Number(m.total || 0), 0);
  els.cashSummary.innerHTML = `
    <div class="item"><strong>Total de vendas</strong><span>${money(vendas)}</span></div>
    <div class="item"><strong>Entradas manuais</strong><span>${money(entradas)}</span></div>
    <div class="item"><strong>Saídas manuais</strong><span>${money(saidas)}</span></div>
    <div class="item"><strong>Saldo atual</strong><span class="badge">${money(getCashBalance())}</span></div>
  `;
}

function renderReport() {
  if (!els.dailyReport) return;

  if (!can('relatorio')) {
    els.dailyReport.classList.remove('hidden');
    els.dailyReport.innerHTML = '<div class="item empty-state"><strong>Sem permissão</strong><span>Apenas administradores podem ver relatórios.</span></div>';
    return;
  }

  const range = els.reportRange?.value || '';

  // Patch 20.1: nada selecionado → esconder o grid
  if (!range) {
    els.dailyReport.classList.add('hidden');
    els.dailyReport.innerHTML = '';
    return;
  }

  els.dailyReport.classList.remove('hidden');

  const sales = salesForRange(range);
  const cashMovements = cashForRange(range);
  const revenue = sales.reduce((s, item) => s + Number(item.total || 0), 0);
  const qty = sales.reduce((s, item) => s + Number(item.quantity || 0), 0);
  const cashOut = cashMovements.filter((m) => m.kind === 'saida').reduce((s, m) => s + Number(m.amount || 0), 0);
  const cashIn = cashMovements.filter((m) => m.kind === 'entrada').reduce((s, m) => s + Number(m.amount || 0), 0);
  const grouped = sales.reduce((acc, item) => {
    acc[item.productName] = (acc[item.productName] || 0) + Number(item.quantity || 0);
    return acc;
  }, {});
  const payments = sales.reduce((acc, item) => {
    acc[item.paymentMethod] = (acc[item.paymentMethod] || 0) + Number(item.total || 0);
    return acc;
  }, {});
  const label = range === 'today' ? 'Hoje' : range === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias';
  const top = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const payRows = Object.entries(payments).sort((a, b) => b[1] - a[1]);

  els.dailyReport.innerHTML = `
    <div class="item"><strong>Período</strong><span>${esc(label)}</span></div>
    <div class="item"><strong>Total vendido</strong><span>${qty} ${qty === 1 ? 'unidade' : 'unidades'}</span></div>
    <div class="item"><strong>Faturamento</strong><span>${money(revenue)}</span></div>
    <div class="item"><strong>Entradas de caixa</strong><span>${money(cashIn)}</span></div>
    <div class="item"><strong>Saídas de caixa</strong><span>${money(cashOut)}</span></div>
    ${top.map(([name, count]) => `<div class="item"><strong>${esc(name)}</strong><span>${count} ${count === 1 ? 'unidade' : 'unidades'}</span></div>`).join('')}
    ${payRows.map(([name, total]) => `<div class="item"><strong>Pagamento: ${esc(name)}</strong><span>${money(total)}</span></div>`).join('')}
  `;
}

function renderDashboardFinanceiro() {
  if (!els.financeiroContent) return;
  if (!can('verFinanceiro')) {
    els.financeiroContent.innerHTML = `
      <div class="item empty-state">
        <strong>Sem permissão</strong>
        <span>O resumo financeiro é visível apenas a administradores.</span>
      </div>`;
    return;
  }
  const todaySales = getTodaySales();
  const allTimeVendas = state.history.filter((item) => item.type === 'venda').reduce((s, i) => s + Number(i.total || 0), 0);
  const totalEntradas = state.cashMovements.filter((m) => m.kind === 'entrada').reduce((s, m) => s + Number(m.amount || 0), 0);
  const totalSaidas = state.cashMovements.filter((m) => m.kind === 'saida').reduce((s, m) => s + Number(m.amount || 0), 0);
  const saldoLiquido = allTimeVendas + totalEntradas - totalSaidas;

  const payments = paymentBreakdownToday();
  const totalPago = payments.reduce((s, p) => s + p[1], 0);
  let pieGradient = '';
  let legend = '';
  let acc = 0;
  const colors = ['var(--primary)', '#f59e0b', '#3b82f6', '#8b5cf6'];
  if (totalPago > 0) {
    payments.forEach(([method, value], index) => {
      const percent = (value / totalPago) * 100;
      const color = colors[index % colors.length];
      pieGradient += ` ${color} ${acc}% ${acc + percent}%,`;
      legend += `<span style="color:${color}">■ ${esc(method)}</span> `;
      acc += percent;
    });
    pieGradient = pieGradient.slice(0, -1);
  } else {
    pieGradient = '#d1d5db 0% 100%';
    legend = '<span>Sem pagamentos hoje</span>';
  }
  els.financeiroContent.innerHTML = `
    <div class="item">
      <div class="financeiro-item"><strong>Faturamento Hoje:</strong> <span>${money(todaySales.reduce((s, i) => s + Number(i.total || 0), 0))}</span></div>
      <div class="financeiro-item"><strong>Faturamento Total:</strong> <span>${money(allTimeVendas)}</span></div>
      <div class="financeiro-item"><strong>Entradas (Manuais):</strong> <span>${money(totalEntradas)}</span></div>
      <div class="financeiro-item"><strong>Saídas (Manuais):</strong> <span style="color:var(--danger)">${money(totalSaidas)}</span></div>
      <div class="financeiro-item" style="font-weight:700; border-top: 2px solid var(--primary); padding-top:10px;"><strong>Saldo Líquido:</strong> <span>${money(saldoLiquido)}</span></div>
      <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 10px;">
        <strong style="display:block; text-align:center;">Métodos de Pagamento (Hoje)</strong>
        <div class="pie-chart" style="background: conic-gradient(${pieGradient});"></div>
        <div class="pie-legend">${legend}</div>
      </div>
    </div>
  `;
  // Mini-cartão financeiro
if (els.panelFinanceiroTotal && can('verFinanceiro')) {
  const vendas   = state.history.filter(h => h.type === 'venda').reduce((s, i) => s + Number(i.total || 0), 0);
  const entradas = state.cashMovements.filter(m => m.kind === 'entrada').reduce((s, m) => s + Number(m.amount || 0), 0);
  const saidas   = state.cashMovements.filter(m => m.kind === 'saida').reduce((s, m) => s + Number(m.amount || 0), 0);
  els.panelFinanceiroTotal.textContent = money(vendas + entradas - saidas);
}
}

function renderUsers() {
  if (!els.userList) return;
  const userSource = cloudMode() ? session.cloudUsers : state.users;
  els.userList.innerHTML = userSource.length
    ? userSource.map((user) => `
      <div class="item">
        <strong>${esc(user.fullName)}</strong>
        <span>${esc(cloudMode() ? user.email || user.username || '' : '@' + user.username)}</span>
        <div class="meta-row">
          <span class="badge">${esc(roleLabel(user.role))}</span>
          <span class="badge info">${user.active !== false ? 'Ativo' : 'Inativo'}</span>
        </div>
        ${isAdmin() ? `<div class="card-actions">
          <button class="secondary-btn" data-action="edit-user" data-id="${esc(user.id)}">Editar</button>
          <button class="danger-btn" data-action="delete-user" data-id="${esc(user.id)}">Remover</button>
          <button class="ghost" data-action="reset-pass" data-id="${esc(user.id)}">Repor senha</button>
        </div>` : ''}
      </div>
    `).join('')
    : '<div class="item empty-state">Sem usuários cadastrados.</div>';
}

// =====================================================================
// DESPESAS — Cálculos e render (Patch 18)
// =====================================================================

/**
 * Devolve as despesas filtradas por período.
 * range: 'today' | '7d' | '30d' | 'month'
 */
function getExpensesInRange(range) {
  const all = state.expenses || [];
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === 'today') {
    const iso = today();
    return all.filter(e => (e.date || '').slice(0, 10) === iso);
  }
  if (range === '7d') start.setDate(start.getDate() - 6);
  if (range === '30d') start.setDate(start.getDate() - 29);
  if (range === 'month') {
    start.setDate(1);
    start.setMonth(now.getMonth());
  }

  return all.filter(e => {
    const d = new Date(e.date);
    return d >= start;
  });
}

function renderExpenseSummary() {
  if (!els.expenseSummary) return;

  const range = els.expenseRange?.value || 'month';
  const expenses = getExpensesInRange(range);
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const count = expenses.length;

  const sales = range === 'today' ? getTodaySales() : salesForRange(range);
  const salesTotal = sales.reduce((s, h) => s + Number(h.total || 0), 0);
  const profit = salesTotal - total;

  const byCategory = {};
  expenses.forEach(e => {
    const cat = e.category || 'outra';
    byCategory[cat] = (byCategory[cat] || 0) + Number(e.amount || 0);
  });

  const catRows = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => {
      const info = EXPENSE_CATEGORIES[cat] || EXPENSE_CATEGORIES.outra;
      return `
        <div class="expense-category-total">
          <strong>${esc(info.label)}</strong>
          <span>${money(val)}</span>
        </div>
      `;
    }).join('');

  const profitClass = profit >= 0 ? 'positive' : 'negative';

  els.expenseSummary.innerHTML = `
    <div class="expense-summary-grid">
      <div class="expense-summary-box">
        <small>Total de despesas</small>
        <strong>${money(total)}</strong>
      </div>
      <div class="expense-summary-box">
        <small>Nº de despesas</small>
        <strong>${count}</strong>
      </div>
      <div class="expense-summary-box">
        <small>Vendas no período</small>
        <strong>${money(salesTotal)}</strong>
      </div>
      <div class="expense-summary-box highlight ${profitClass}">
        <small>Lucro real</small>
        <strong>${money(profit)}</strong>
      </div>
    </div>
    ${catRows || '<div class="item empty-state">Sem despesas no período.</div>'}
  `;
}

function renderExpenses() {
  if (!els.expenseList) return;

  const filter = els.expenseFilter?.value || 'todas';
  let expenses = (state.expenses || []).slice();

  if (filter !== 'todas') {
    expenses = expenses.filter(e => e.category === filter);
  }

  expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (expenses.length === 0) {
    els.expenseList.innerHTML = '<div class="item empty-state">Nenhuma despesa registada.</div>';
    return;
  }

  els.expenseList.innerHTML = expenses.slice(0, 100).map(e => {
    const info = EXPENSE_CATEGORIES[e.category] || EXPENSE_CATEGORIES.outra;
    const dateStr = new Date(e.date).toLocaleDateString('pt-PT');
    return `
      <div class="item">
        <div class="expense-item-row">
          <div class="expense-item-info">
            <strong>${esc(e.description || 'Sem descrição')}</strong>
            <small>${esc(dateStr)} • <span class="expense-category-badge ${esc(info.class)}">${esc(info.label)}</span></small>
            ${e.notes ? `<small>📝 ${esc(e.notes)}</small>` : ''}
          </div>
          <div class="expense-item-meta">
            <span class="expense-amount">${money(e.amount)}</span>
          </div>
        </div>
        <div class="expense-item-actions">
          <button type="button" class="secondary-btn" data-action="edit-expense" data-id="${esc(e.id)}">Editar</button>
          <button type="button" class="danger-btn" data-action="delete-expense" data-id="${esc(e.id)}">Remover</button>
        </div>
      </div>
    `;
  }).join('');
}

// =====================================================================
// CLIENTES — Render (Patch 13)
// =====================================================================

function renderClients() {
  if (!els.clientCards) return;

  const term = (els.clientSearch?.value || '').trim().toLowerCase();
  const all = Array.isArray(state.clients) ? state.clients : [];

  const filtered = term
    ? all.filter((c) =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.phone || '').toLowerCase().includes(term) ||
        (c.nif || '').toLowerCase().includes(term)
      )
    : all;

  filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (filtered.length === 0) {
    els.clientCards.innerHTML = '<div class="item empty-state">Nenhum cliente encontrado.</div>';
    return;
  }

  els.clientCards.innerHTML = filtered.map((c) => {
    const sales = (state.history || []).filter((h) => h.clientId === c.id);
    const salesCount = sales.length;
    const totalSpent = sales.reduce((s, h) => s + Number(h.total || 0), 0);

    return `
      <div class="item" data-action="view-client" data-id="${esc(c.id)}">
        <div class="client-card-row">
          <div class="client-card-info">
            <strong>${esc(c.name)}</strong>
            ${c.phone ? `<small>📞 ${esc(c.phone)}</small>` : ''}
            ${c.nif ? `<small>NIF: ${esc(c.nif)}</small>` : ''}
          </div>
          <div class="client-card-meta">
            <span class="badge info">${salesCount} ${salesCount === 1 ? 'venda' : 'vendas'}</span>
            <span class="badge">${money(totalSpent)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCloudPanel() {
  if (!els.cloudPanel) return;
  if (!can('nuvem')) {
  els.cloudPanel.innerHTML = '<div class="item empty-state"><strong>Sem permissão</strong><span>Apenas administradores podem ver os detalhes do sistema.</span></div>';
  return;
  }
  const online = cloudMode();
  const current = getCurrentUser();
  const cfg = parseFirebaseConfig();
  const diag = `
    <div class="item"><strong>Diagnóstico</strong>
      <span>fbReady: ${session.fbReady ? '✅' : '❌'}</span><br />
      <span>app: ${session.app ? '✅' : '❌'}</span><br />
      <span>auth: ${session.auth ? '✅' : '❌'}</span><br />
      <span>db: ${session.db ? '✅' : '❌'}</span><br />
      <span>api: ${session.api ? '✅' : '❌'}</span><br />
      <span>apiKey: ${cfg?.apiKey ? '✅' : '❌'}</span><br />
      <span>projectId: ${esc(cfg?.projectId || '(vazio)')}</span>
      ${session.lastAuthError ? `<br /><span style="color:var(--danger)">Último erro: ${esc(session.lastAuthError.code)} — ${esc(session.lastAuthError.message)}</span>` : ''}
    </div>
  `;
  els.cloudPanel.innerHTML = `
    <div class="item"><strong>Modo atual</strong><span>${online ? 'Online com Firebase' : 'Local no dispositivo'}</span></div>
    <div class="item"><strong>Projeto</strong><span>${online ? esc(cloudProjectName()) : 'Não aplicado'}</span></div>
    <div class="item"><strong>Sessão</strong><span>${current ? esc(`${current.fullName} (${roleLabel(current.role)})`) : 'Nenhum usuário autenticado'}</span></div>
    <div class="item"><strong>Estado da sincronização</strong><span>${online ? (session.fbReady ? 'Sincronização ativa' : 'Inicializando conexão') : 'Dados guardados localmente'}</span></div>
    <div class="item"><strong>Timeout de sessão</strong><span>${IDLE_TIMEOUT_MIN} min (aviso ${IDLE_WARNING_SEC}s antes)</span></div>
    ${online ? diag : ''}
    <div class="item">
      <strong>Ferramentas</strong>
      <span>Se estiveres com problemas de cache, clica abaixo:</span>
      <div class="card-actions">
        <button type="button" class="ghost" onclick="window.__saldarLimparCache()">🧹 Limpar cache e recarregar</button>
        <button type="button" class="ghost" onclick="window.__saldarDebug()">🐛 Debug (ver consola)</button>
      </div>
    </div>
  `;
}

function renderAuditLog() {
  if (!els.auditLogList) return;
  if (!can('auditoria')) {
    els.auditLogList.innerHTML = '<div class="item empty-state"><strong>Sem permissão</strong><span>Só administradores veem a auditoria.</span></div>';
    return;
  }
  const filter = els.auditLogFilter?.value || 'todos';
  const all = Array.isArray(state.auditLog) ? state.auditLog : [];
  const filtered = filter === 'todos' ? all : all.filter((e) => e.action === filter);

  els.auditLogList.innerHTML = filtered.length
    ? filtered.slice(0, 200).map((entry) => {
        let detailsHtml = '';

        // Venda multi-item: mostrar todos os itens
        if (entry.action === 'venda' && entry.details?.items?.length) {
          const items = entry.details.items;
          const itemsHtml = items.map((i) => `
            <div class="cart-item-row" style="margin-top:6px;padding:6px 10px;background:#fff;border-radius:8px;border:1px solid var(--border);">
              <div class="cart-item-info">
                <strong>${esc(i.productName)}</strong>
                <small>${esc(i.quantity)} x ${money(i.unitPrice)}</small>
              </div>
              <span class="cart-item-total">${money(i.total)}</span>
            </div>
          `).join('');
          detailsHtml = `
            <div style="margin-top:8px;">
              <span class="badge warning">${items.length} ${items.length === 1 ? 'item' : 'itens'} • Total: ${money(entry.details.grandTotal || 0)}</span>
              ${itemsHtml}
              <div style="margin-top:8px;font-size:12px;color:var(--muted);">
                ${esc(entry.details.paymentMethod || '')}${entry.details.note ? ' • ' + esc(entry.details.note) : ''}
              </div>
            </div>
          `;
        } else if (entry.details && Object.keys(entry.details).length) {
          // Outros tipos: JSON truncado (comportamento antigo)
          detailsHtml = `<div class="meta-row"><span class="badge warning">${esc(JSON.stringify(entry.details).slice(0, 150))}</span></div>`;
        }

        return `
          <div class="item">
            <div class="product-name-row">
              <strong>${esc(entry.action)}</strong>
              <span class="badge info">${esc(entry.userRole || 'operador')}</span>
            </div>
            <span>${esc(entry.userName)} • ${new Date(entry.date).toLocaleString('pt-PT')}</span>
            ${detailsHtml}
          </div>
        `;
      }).join('')
    : '<div class="item empty-state"><strong>Sem registos</strong><span>Nenhuma ação de auditoria encontrada.</span></div>';
}

function renderAll() {
  try { renderUserHeader(); } catch (e) { _origConsoleError('[renderUserHeader]', e); }
  try { applyPermissions(); } catch (e) { _origConsoleError('[applyPermissions]', e); }
  try { renderSelectOptions(); } catch (e) { _origConsoleError('[renderSelectOptions]', e); }
  try { renderStats(); } catch (e) { _origConsoleError('[renderStats]', e); }
  try { renderDashboard(); } catch (e) { _origConsoleError('[renderDashboard]', e); }
  try { renderProductCards(); } catch (e) { _origConsoleError('[renderProductCards]', e); }
  try { renderStock(); } catch (e) { _origConsoleError('[renderStock]', e); }
  try { renderHistory(); } catch (e) { _origConsoleError('[renderHistory]', e); }
  try { renderCash(); } catch (e) { _origConsoleError('[renderCash]', e); }
  try { renderReport(); } catch (e) { _origConsoleError('[renderReport]', e); }
  try { renderUsers(); } catch (e) { _origConsoleError('[renderUsers]', e); }
  try { renderCloudPanel(); } catch (e) { _origConsoleError('[renderCloudPanel]', e); }
  try { renderDashboardFinanceiro(); } catch (e) { _origConsoleError('[renderDashboardFinanceiro]', e); }
  try { renderAuditLog(); } catch (e) { _origConsoleError('[renderAuditLog]', e); }
  try { renderClients(); } catch (e) { _origConsoleError('[renderClients]', e); }
  try { renderMonthComparison(); } catch (e) { _origConsoleError('[renderMonthComparison]', e); }
try { renderCharts(); } catch (e) { _origConsoleError('[renderCharts]', e); }
  try { renderExpenseSummary(); } catch (e) { _origConsoleError('[renderExpenseSummary]', e); }
try { renderExpenses(); } catch (e) { _origConsoleError('[renderExpenses]', e); }
  try { renderCommissions(); } catch (e) { _origConsoleError('[renderCommissions]', e); }
}
// =====================================================================
// Forms
// =====================================================================

function syncPrice() {
  const product = byId(els.saleProduct?.value);
  if (!product) return;

  // Patch 17: aplica preço consoante quantidade/cliente
  const qty = Number(els.saleQty?.value || 1);
  const isVip = isCurrentSaleClientVip();
  const result = getApplicablePrice(product, qty, isVip);

  if (els.salePrice) els.salePrice.value = result.price;
  updateSalePriceHint();
}

function syncMin() {
  const product = byId(els.stockProduct?.value);
  if (product && els.stockMin) els.stockMin.value = product.minStock;
}

function updateSaleHint() {
  if (!els.saleStockHint) return;
  const product = byId(els.saleProduct?.value);
  if (!product) {
    els.saleStockHint.textContent = 'Selecione um produto para ver stock e preço.';
    return;
  }
  const stockDisplay = product.category === 'RL' ? money(product.stock) : product.stock + ' un.';
  els.saleStockHint.textContent = `Stock atual: ${stockDisplay} • ${product.category === 'RL' ? 'Preço variável (defina abaixo)' : 'Preço padrão: ' + money(product.price)}`;
}

function resetProductForm() {
  els.productForm?.reset();
  if (els.productEditId) els.productEditId.value = '';
  if (els.productFormMode) els.productFormMode.textContent = 'Novo produto';
  // Patch 17: resetar os campos de multi-preço para os defaults
  if (els.productPriceWholesale) els.productPriceWholesale.value = '0';
  if (els.productWholesaleQty) els.productWholesaleQty.value = '5';
  if (els.productPriceVip) els.productPriceVip.value = '0';
}

function fillProductForm(id) {
  const product = byId(id);
  if (!product) return;
  els.productEditId.value = product.id;
  els.productName.value = product.name;
  els.productCategory.value = product.category;
  els.productStock.value = product.stock;
  els.productMinStock.value = product.minStock;
  els.productPrice.value = product.price;
  // Patch 17: preencher os campos de multi-preço
  if (els.productPriceWholesale) els.productPriceWholesale.value = product.priceWholesale ?? 0;
  if (els.productWholesaleQty) els.productWholesaleQty.value = product.wholesaleQty ?? 5;
  if (els.productPriceVip) els.productPriceVip.value = product.priceVip ?? 0;
  els.productFormMode.textContent = 'Editando produto';
  activate('produtos');
}

// =====================================================================
// Cloud sync
// =====================================================================

async function saveState() {
  saveLocal();
  if (!cloudMode() || !session.fbReady || !session.db || !session.api) return;
  try {
    const { doc, setDoc } = session.api;
    await setDoc(doc(session.db, 'appData', 'main'), {
      products: state.products,
      history: state.history,
      cashMovements: state.cashMovements
    });
  } catch (error) {
    _origConsoleError('[saveState]', error);
  }
}

async function fetchCloudUsers() {
  if (!cloudMode() || !session.db || !session.api) return;
  const { collection, getDocs } = session.api;
  const snapshot = await getDocs(collection(session.db, 'users'));
  session.cloudUsers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function ensureCloudProfile(user) {
  const { doc, getDoc, setDoc, collection, getDocs } = session.api;
  const profileRef = doc(session.db, 'users', user.uid);
  const profileSnap = await getDoc(profileRef);
  if (profileSnap.exists()) return { id: user.uid, ...profileSnap.data() };

  const usersSnap = await getDocs(collection(session.db, 'users'));
  let role = 'operador';
  if (usersSnap.empty) {
    const adminEmails = String(settings.adminEmails || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length === 0) {
      _origConsoleError('[SEGURANÇA] Nenhuma whitelist de admins. O primeiro registo será admin.');
      role = 'admin';
    } else if (adminEmails.includes(String(user.email || '').toLowerCase())) {
      role = 'admin';
    } else {
      toast('O sistema já tem administrador. A sua conta será criada como operador.');
    }
  }
  const profile = {
    fullName: session.pendingName || user.email || 'Usuário online',
    email: user.email,
    role, active: true, createdAt: now()
  };
  await setDoc(profileRef, profile);
  return { id: user.uid, ...profile };
}

async function loadCloudState() {
  const { doc, getDoc, setDoc } = session.api;
  const appRef = doc(session.db, 'appData', 'main');
  const snap = await getDoc(appRef);
  if (snap.exists()) {
    state = normalize({ ...state, ...snap.data(), currentUserId: state.currentUserId });
  } else {
    await setDoc(appRef, {
      products: state.products,
      history: state.history,
      cashMovements: state.cashMovements
    });
  }
  saveLocal();
}

// =====================================================================
// Firebase init
// =====================================================================

async function initFirebase() {
  _origConsoleError('[initFirebase] Início. cloudMode:', cloudMode());
  if (!cloudMode()) return;

  const cfg = parseFirebaseConfig();
  if (!cfg) {
    session.lastAuthError = { code: 'config/parse-error', message: 'JSON do Firebase inválido.' };
    return;
  }
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    const faltam = ['apiKey', 'projectId', 'appId'].filter(k => !cfg[k]);
    session.lastAuthError = { code: 'config/missing-keys', message: 'Faltam: ' + faltam.join(', ') };
    return;
  }

  try {
    const appModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const firestoreModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

    const { initializeApp, getApps } = appModule;
    const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification } = authModule;
    const { getFirestore, doc, setDoc, getDoc, collection, getDocs, enableIndexedDbPersistence, deleteDoc } = firestoreModule;

    session.api = { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification, doc, setDoc, getDoc, collection, getDocs, deleteDoc };

    const existing = getApps().find((app) => app.name === 'saldar-servicos-v5');
    session.app = existing || initializeApp(cfg, 'saldar-servicos-v5');
    session.auth = getAuth(session.app);
    session.db = getFirestore(session.app);

    try { await enableIndexedDbPersistence(session.db); }
    catch (err) { _origConsoleError('[initFirebase] Persistência:', err); }

    session.fbReady = true;

    if (typeof session.unsubAuth === 'function') session.unsubAuth();
    session.unsubAuth = onAuthStateChanged(session.auth, async (user) => {
      if (!user) {
        session.currentUser = null;
        session.cloudUsers = [];
        showApp(false);
        return;
      }
      session.lastAuthError = null;

      if (user.email && user.emailVerified === false && user.providerData?.[0]?.providerId === 'password') {
        const ageMs = Date.now() - new Date(user.metadata.creationTime).getTime();
        if (ageMs > 60 * 1000) {
          toast('Confirme o seu email antes de entrar.');
          try { await session.api.signOut(session.auth); } catch {}
          session.currentUser = null;
          showApp(false);
          return;
        }
      }

      try {
        const profile = await ensureCloudProfile(user);
        session.currentUser = profile;
        await fetchCloudUsers();
        await loadCloudState();
        showApp(true);
        toast(`Sessão online iniciada para ${profile.fullName || profile.email}.`);
        session.pendingName = '';
        await logAudit('login', { email: profile.email, mode: 'online' });
      } catch (err) {
        _origConsoleError('[onAuthStateChanged] Erro ao carregar perfil/dados:', err);
        session.lastAuthError = { code: err.code || 'profile/error', message: err.message || String(err) };
        toast('Erro ao carregar perfil: ' + (err.message || err.code || 'desconhecido'));
      }
    });
  } catch (error) {
    _origConsoleError('[initFirebase] Falha fatal:', error);
    session.lastAuthError = { code: error.code || 'init/error', message: error.message || String(error) };
    toast('Falha ao iniciar Firebase.');
  }
}

// =====================================================================
// Logout
// =====================================================================

async function logout() {
  try { await logAudit('logout', {}); } catch {}

  if (cloudMode() && session.api && session.auth) {
    await session.api.signOut(session.auth);
    session.currentUser = null;
    showApp(false);
    return;
  }
  state.currentUserId = null;
  session.currentUser = null;
  saveLocal();
  showApp(false);
}

// =====================================================================
// GRÁFICOS — Patch 16
// =====================================================================

/**
 * Devolve um array com as vendas agrupadas por dia dos últimos N dias.
 * Ex.: [{ label: '12/09', total: 15000 }, ...]
 */
function getSalesByDay(days = 7) {
  const result = [];
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });

    const total = (state.history || [])
      .filter(h => h.type === 'venda' && h.date && h.date.slice(0, 10) === iso)
      .reduce((s, h) => s + Number(h.total || 0), 0);

    result.push({ label, total });
  }
  return result;
}

/**
 * Devolve o total vendido dos últimos 30 dias por produto.
 */
function getTopProductsLast30Days() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  cutoff.setHours(0, 0, 0, 0);

  const map = {};
  (state.history || []).forEach(h => {
    if (h.type !== 'venda') return;
    const d = new Date(h.date);
    if (d < cutoff) return;
    const key = h.productName || 'Sem nome';
    map[key] = (map[key] || 0) + Number(h.total || 0);
  });

  return Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

/**
 * Calcula os totais dos últimos 2 meses para o card de comparação.
 */
function getMonthComparison() {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const sales = (state.history || []).filter(h => h.type === 'venda');

  const thisMonth = sales.filter(h => {
    const d = new Date(h.date);
    return d >= thisMonthStart;
  });
  const lastMonth = sales.filter(h => {
    const d = new Date(h.date);
    return d >= lastMonthStart && d < lastMonthEnd;
  });

  return {
    thisMonth: {
      total: thisMonth.reduce((s, h) => s + Number(h.total || 0), 0),
      count: thisMonth.length
    },
    lastMonth: {
      total: lastMonth.reduce((s, h) => s + Number(h.total || 0), 0),
      count: lastMonth.length
    }
  };
}

function renderMonthComparison() {
  if (!els.monthComparison) return;
  if (!can('verFinanceiro')) {
    els.monthComparison.innerHTML = '<div class="item empty-state">Sem permissão.</div>';
    return;
  }

  const { thisMonth, lastMonth } = getMonthComparison();
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const now = new Date();
  const thisMonthName = monthNames[now.getMonth()];
  const lastMonthName = monthNames[(now.getMonth() + 11) % 12];

  let trendClass = 'flat';
  let trendText = '= Igual';
  if (lastMonth.total > 0) {
    const change = ((thisMonth.total - lastMonth.total) / lastMonth.total) * 100;
    if (change > 1) {
      trendClass = 'up';
      trendText = `▲ +${change.toFixed(1)}%`;
    } else if (change < -1) {
      trendClass = 'down';
      trendText = `▼ ${change.toFixed(1)}%`;
    }
  } else if (thisMonth.total > 0) {
    trendClass = 'up';
    trendText = '▲ Novo';
  }

  els.monthComparison.innerHTML = `
    <div class="month-box">
      <small>${lastMonthName}</small>
      <strong>${money(lastMonth.total)}</strong>
      <div class="month-detail">${lastMonth.count} ${lastMonth.count === 1 ? 'venda' : 'vendas'}</div>
    </div>
    <div class="month-box highlight">
      <small>${thisMonthName} (atual)</small>
      <strong>${money(thisMonth.total)}</strong>
      <div class="month-detail">${thisMonth.count} ${thisMonth.count === 1 ? 'venda' : 'vendas'}</div>
    </div>
    <div class="month-box ${trendClass === 'up' ? 'positive' : trendClass === 'down' ? 'negative' : ''}">
      <small>Variação</small>
      <span class="trend ${trendClass}">${trendText}</span>
      <div class="month-detail">vs. mês anterior</div>
    </div>
  `;
}

function renderCharts() {
  if (!can('verFinanceiro')) return;
  if (typeof Chart === 'undefined') return;

  // ========== Gráfico 1: Vendas dos últimos 7 dias ==========
  if (els.chartSales7d) {
    const data7d = getSalesByDay(7);

    if (chartInstances.sales7d) chartInstances.sales7d.destroy();

    const ctx = els.chartSales7d.getContext('2d');
    chartInstances.sales7d = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data7d.map(d => d.label),
        datasets: [{
          label: 'Faturamento (AOA)',
          data: data7d.map(d => d.total),
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15, 118, 110, 0.12)',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#0f766e',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => money(ctx.parsed.y)
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => new Intl.NumberFormat('pt-PT', { notation: 'compact' }).format(v)
            }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ========== Gráfico 2: Top 5 produtos (30 dias) ==========
  if (els.chartTopProducts) {
    const tops = getTopProductsLast30Days();

    if (chartInstances.topProducts) chartInstances.topProducts.destroy();

    if (tops.length === 0) {
      els.chartTopProducts.parentElement.innerHTML =
        '<div class="item empty-state">Sem vendas nos últimos 30 dias.</div>';
    } else {
      const ctx = els.chartTopProducts.getContext('2d');
      chartInstances.topProducts = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: tops.map(t => t.name),
          datasets: [{
            label: 'Total vendido (AOA)',
            data: tops.map(t => t.total),
            backgroundColor: ['#0f766e', '#14b8a6', '#f59e0b', '#3b82f6', '#8b5cf6'],
            borderRadius: 8,
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => money(ctx.parsed.y)
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (v) => new Intl.NumberFormat('pt-PT', { notation: 'compact' }).format(v)
              }
            },
            x: { grid: { display: false } }
          }
        }
      });
    }
  }
}

// =====================================================================
// EXPORTAÇÃO CSV — Patch 14
// =====================================================================

/**
 * Converte uma lista de objetos em CSV.
 * Usa ";" como separador (compatível com Excel PT) e BOM UTF-8.
 */
function toCsv(rows, headers) {
  const escapeCell = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (s.includes('"')) s = s.replace(/"/g, '""');
    if (s.includes(';') || s.includes('\n') || s.includes('\r') || s.includes('"')) {
      s = '"' + s + '"';
    }
    return s;
  };

  const headerLine = headers.map(h => escapeCell(h.label)).join(';');
  const dataLines = rows.map(row => headers.map(h => escapeCell(row[h.key])).join(';'));
  return [headerLine, ...dataLines].join('\r\n');
}

/**
 * Codifica uma string como UTF-16LE com BOM (0xFF 0xFE).
 * Este formato é reconhecido automaticamente pelo Excel, Sheets e LibreOffice
 * em qualquer plataforma (desktop e mobile), evitando problemas com acentos.
 */
function encodeUtf16Le(text) {
  const str = String(text || '');
  const buffer = new ArrayBuffer((str.length + 1) * 2);
  const view = new DataView(buffer);
  view.setUint16(0, 0xFEFF, true);
  for (let i = 0; i < str.length; i++) {
    view.setUint16((i + 1) * 2, str.charCodeAt(i), true);
  }
  return buffer;
}

/**
 * Descarrega um CSV em UTF-16LE (compatível com Excel, Sheets, LibreOffice).
 */
function downloadCsv(filename, content) {
  const buffer = encodeUtf16Le(content);
  const blob = new Blob([buffer], { type: 'text/csv;charset=utf-16le;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatCsvDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-PT');
  } catch {
    return String(iso);
  }
}

async function exportSalesCsv() {
  if (!requireAdmin()) return;

  const sales = (state.history || [])
    .filter(h => h.type === 'venda')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sales.length === 0) return toast('Sem vendas para exportar.');

  const rows = sales.map(h => ({
    date: formatCsvDate(h.date),
    product: h.productName || '',
    quantity: h.quantity || 0,
    unitPrice: Number(h.unitPrice || 0).toFixed(2).replace('.', ','),
    total: Number(h.total || 0).toFixed(2).replace('.', ','),
    method: h.paymentMethod || '',
    client: h.clientName || '',
    note: h.note || '',
    operator: h.createdByName || ''
  }));

  const csv = toCsv(rows, [
    { key: 'date', label: 'Data' },
    { key: 'product', label: 'Produto' },
    { key: 'quantity', label: 'Quantidade' },
    { key: 'unitPrice', label: 'Preço Unitário (AOA)' },
    { key: 'total', label: 'Total (AOA)' },
    { key: 'method', label: 'Método' },
    { key: 'client', label: 'Cliente' },
    { key: 'note', label: 'Observação' },
    { key: 'operator', label: 'Operador' }
  ]);

  downloadCsv(`vendas_${today()}.csv`, csv);
  await logAudit('export-vendas-csv', { count: rows.length });
  toast(`${rows.length} vendas exportadas.`);
}

async function exportStockCsv() {
  if (!requireAdmin()) return;

  const products = state.products || [];
  if (products.length === 0) return toast('Sem produtos para exportar.');

  const rows = products.map(p => {
    const stock = Number(p.stock || 0);
    const min = Number(p.minStock || 0);
    let status = 'OK';
    if (stock <= 0) status = 'Esgotado';
    else if (stock <= min) status = 'Stock baixo';

    return {
      name: p.name || '',
      category: p.category === 'RL' ? 'Recarga' : 'Cartão',
      stock: p.category === 'RL' ? stock.toFixed(2).replace('.', ',') : stock,
      minStock: p.category === 'RL' ? min.toFixed(2).replace('.', ',') : min,
      price: p.category === 'RL' ? 'Variável' : Number(p.price || 0).toFixed(2).replace('.', ','),
      status
    };
  });

  const csv = toCsv(rows, [
    { key: 'name', label: 'Produto' },
    { key: 'category', label: 'Categoria' },
    { key: 'stock', label: 'Stock atual' },
    { key: 'minStock', label: 'Mínimo' },
    { key: 'price', label: 'Preço' },
    { key: 'status', label: 'Estado' }
  ]);

  downloadCsv(`stock_${today()}.csv`, csv);
  await logAudit('export-stock-csv', { count: rows.length });
  toast(`${rows.length} produtos exportados.`);
}

async function exportClientsCsv() {
  if (!requireAdmin()) return;

  const clients = state.clients || [];
  if (clients.length === 0) return toast('Sem clientes para exportar.');

  const rows = clients.map(c => {
    const sales = (state.history || []).filter(h => h.clientId === c.id);
    const totalSpent = sales.reduce((s, h) => s + Number(h.total || 0), 0);

    return {
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      nif: c.nif || '',
      notes: c.notes || '',
      salesCount: sales.length,
      totalSpent: totalSpent.toFixed(2).replace('.', ','),
      createdAt: formatCsvDate(c.createdAt)
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const csv = toCsv(rows, [
    { key: 'name', label: 'Nome' },
    { key: 'phone', label: 'Telefone' },
    { key: 'email', label: 'Email' },
    { key: 'nif', label: 'NIF' },
    { key: 'notes', label: 'Notas' },
    { key: 'salesCount', label: 'Nº Compras' },
    { key: 'totalSpent', label: 'Total Gasto (AOA)' },
    { key: 'createdAt', label: 'Criado em' }
  ]);

  downloadCsv(`clientes_${today()}.csv`, csv);
  await logAudit('export-clientes-csv', { count: rows.length });
  toast(`${rows.length} clientes exportados.`);
}

async function exportAuditCsv() {
  if (!requireAdmin()) return;

  const logs = state.auditLog || [];
  if (logs.length === 0) return toast('Sem auditoria para exportar.');

  const rows = logs.slice().reverse().map(l => ({
    date: formatCsvDate(l.date),
    action: l.action || '',
    userName: l.userName || '',
    userRole: l.userRole || '',
    details: l.details ? JSON.stringify(l.details) : ''
  }));

  const csv = toCsv(rows, [
    { key: 'date', label: 'Data' },
    { key: 'action', label: 'Ação' },
    { key: 'userName', label: 'Utilizador' },
    { key: 'userRole', label: 'Perfil' },
    { key: 'details', label: 'Detalhes' }
  ]);

  downloadCsv(`auditoria_${today()}.csv`, csv);
  await logAudit('export-auditoria-csv', { count: rows.length });
  toast(`${rows.length} registos exportados.`);
}

// =====================================================================
// Backup
// =====================================================================

function downloadBackup() {
  const safeUsers = state.users.map(({ password, ...rest }) => rest);
  const payload = {
    version: 11,
    exportedAt: now(),
    data: {
      products: state.products,
      history: state.history,
      cashMovements: state.cashMovements,
      users: safeUsers,
      auditLog: state.auditLog || []
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saldar-servicos-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackupFile(file) {
  if (!file) return toast('Selecione um arquivo de backup.');
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { return toast('Arquivo JSON inválido.'); }
  const source = parsed.data || parsed;
  state = normalize({
    products: source.products,
    history: source.history,
    cashMovements: source.cashMovements,
    users: source.users,
    currentUserId: state.currentUserId,
    auditLog: source.auditLog
  });
  state.users = state.users.map((u) => ({ ...u, password: u.password || '' }));
  saveLocal();
  await saveState();
  renderAll();
  toast('Backup importado com sucesso.');
}

// =====================================================================
// Eventos
// =====================================================================

els.saveCloudConfigBtn?.addEventListener('click', async () => {
  settings.cloudEnabled = els.cloudEnabled.checked;
  settings.firebaseConfig = els.firebaseConfigInput.value.trim();
  settings.adminEmails = (els.adminEmailsInput?.value || '').trim();
  saveSettings();
  markMode();
  switchAuthView('login');
  updateConnectivityBadge();

  if (cloudMode()) {
    await initFirebase();
    showApp(false);
    if (session.fbReady) toast('Modo online configurado. Faça login com email.');
    else toast('Configuração salva, mas Firebase não inicializou. Vê a consola.', 15000);
  } else {
    session.currentUser = state.users.find((u) => u.id === state.currentUserId) || null;
    showApp(Boolean(session.currentUser));
    toast('Modo local ativado.');
  }
});

els.switchAuthModeBtn?.addEventListener('click', () => {
  switchAuthView(session.authView === 'login' ? 'register' : 'login');
});

// =====================================================================
// Login
// =====================================================================

els.loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = els.loginUsername.value.trim();
  const pass = els.loginPassword.value.trim();

  els.loginSubmitBtn.textContent = 'Aguarde...';
  els.loginSubmitBtn.disabled = true;

  if (cloudMode()) {
    if (!session.api || !session.auth) {
      const cfg = parseFirebaseConfig();
      let motivo = 'desconhecido';
      if (!cfg) motivo = 'JSON do Firebase inválido';
      else if (!cfg.apiKey) motivo = 'falta "apiKey" no JSON';
      else if (!cfg.projectId) motivo = 'falta "projectId" no JSON';
      else if (!cfg.appId) motivo = 'falta "appId" no JSON';
      else if (!session.fbReady) motivo = 'initFirebase não concluiu';
      else motivo = 'api/auth ausente após init';
      _origConsoleError('[Login] Firebase não pronto. Motivo:', motivo);
      await appAlert('Firebase não está pronto.\n\nMotivo: ' + motivo, 'Erro de configuração', '❌');
      els.loginSubmitBtn.textContent = session.authView === 'register' ? 'Criar conta online' : 'Entrar';
      els.loginSubmitBtn.disabled = false;
      return;
    }

    try {
      if (session.authView === 'register') {
        const full = els.registerFullName.value.trim();
        const confirm = els.confirmPassword.value.trim();
        if (!full) throw { code: 'app/missing-name', message: 'Informe o nome completo.' };
        if (pass !== confirm) throw { code: 'app/pass-mismatch', message: 'As palavras-passe não coincidem.' };
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(login)) throw { code: 'app/invalid-email', message: 'Insira um e-mail válido.' };

        session.pendingName = full;
        const userCredential = await session.api.createUserWithEmailAndPassword(session.auth, login, pass);
        try {
          await session.api.sendEmailVerification(userCredential.user);
          toast('Conta criada! Verifique seu e-mail para confirmar o cadastro.');
        } catch (verifyErr) {
          _origConsoleError('Erro ao enviar verificação:', verifyErr);
        }
      } else {
        await session.api.signInWithEmailAndPassword(session.auth, login, pass);
      }
      e.target.reset();
      switchAuthView('login');
    } catch (error) {
      _origConsoleError('[Login] Erro completo:', error);
      session.lastAuthError = { code: error?.code || 'unknown', message: error?.message || String(error) };

      const mensagens = {
        'auth/invalid-api-key': 'API Key inválida.',
        'auth/api-key-not-valid': 'API Key inválida.',
        'auth/invalid-email': 'Formato de e-mail inválido.',
        'auth/user-disabled': 'Esta conta foi desativada.',
        'auth/user-not-found': 'Utilizador não encontrado.',
        'auth/wrong-password': 'Palavra-passe incorreta.',
        'auth/invalid-credential': 'E-mail ou palavra-passe incorretos.',
        'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
        'auth/weak-password': 'Palavra-passe fraca (mínimo 6 caracteres).',
        'auth/too-many-requests': 'Demasiadas tentativas.',
        'auth/network-request-failed': 'Sem ligação à internet.',
        'auth/operation-not-allowed': 'Login por email/senha não está ativo no Firebase Console.',
        'auth/unauthorized-domain': 'Domínio não autorizado. Adiciona em Authentication → Settings → Authorized domains.',
        'app/missing-name': 'Informe o nome completo.',
        'app/pass-mismatch': 'As palavras-passe não coincidem.',
        'app/invalid-email': 'Insira um e-mail válido.'
      };

      const msg = mensagens[error?.code] || error?.message || 'Falha no login online.';
      toast(msg, 10000);
    } finally {
      els.loginSubmitBtn.textContent = session.authView === 'register' ? 'Criar conta online' : 'Entrar';
      els.loginSubmitBtn.disabled = false;
    }
    return;
  }

  // MODO LOCAL
  const candidate = state.users.find((item) => item.username.toLowerCase() === login.toLowerCase() && item.active !== false);

  if (!candidate || !candidate.password) {
    toast('Usuário ou palavra-passe inválidos.');
    els.loginSubmitBtn.textContent = 'Entrar';
    els.loginSubmitBtn.disabled = false;
    return;
  }

  let ok = false;
  if (isHash(candidate.password)) {
    ok = (await hashPassword(pass)) === candidate.password;
  } else {
    ok = candidate.password === pass;
    if (ok) candidate.password = await hashPassword(pass);
  }

  if (!ok) {
    toast('Usuário ou palavra-passe inválidos.');
    els.loginSubmitBtn.textContent = 'Entrar';
    els.loginSubmitBtn.disabled = false;
    return;
  }

  state.currentUserId = candidate.id;
  session.currentUser = candidate;
  saveLocal();
  e.target.reset();
  showApp(true);
  toast(`Bem-vindo, ${candidate.fullName}.`);
  await logAudit('login', { username: candidate.username, mode: 'local' });
});

// =====================================================================
// Reset / verificação
// =====================================================================

els.forgotPasswordLink?.addEventListener('click', async () => {
  const email = els.loginUsername.value.trim();
  if (!email) return toast('Por favor, insira o seu e-mail no campo acima.');
  try {
    await session.api.sendPasswordResetEmail(session.auth, email);
    toast('E-mail de redefinição enviado com sucesso!');
  } catch (error) {
    _origConsoleError(error);
    toast('Erro ao enviar: ' + (error?.code || ''));
  }
});

els.resendVerifyLink?.addEventListener('click', async () => {
  const currentUser = session.auth.currentUser;
  if (!currentUser) return toast('Nenhum utilizador logado.');
  try {
    await session.api.sendEmailVerification(currentUser);
    toast('E-mail de verificação reenviado.');
  } catch (error) {
    _origConsoleError(error);
    toast('Erro ao reenviar: ' + (error?.code || ''));
  }
});

els.logoutBtn?.addEventListener('click', async () => {
  await logout();
  toast('Sessão terminada com sucesso.');
});

// =====================================================================
// Produtos
// =====================================================================

els.productForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const payload = {
    name: els.productName.value.trim(),
    category: els.productCategory.value,
    stock: Number(els.productStock.value),
    minStock: Number(els.productMinStock.value),
    price: Number(els.productPrice.value),
    priceWholesale: Number(els.productPriceWholesale?.value || 0),
wholesaleQty: Number(els.productWholesaleQty?.value || 5),
priceVip: Number(els.productPriceVip?.value || 0)
  };

  if (!payload.name) return toast('Preencha o nome do produto.');
  if (payload.category === 'CF' && payload.price <= 0) return toast('Produtos CF devem ter um preço fixo maior que zero.');

  const duplicateName = state.products.some((p) => p.name.toLowerCase() === payload.name.toLowerCase() && p.id !== els.productEditId.value);
  if (duplicateName) return toast('Já existe um produto com esse nome.');

  const editingId = els.productEditId.value;
  if (editingId) {
    const product = byId(editingId);
    if (!product) return toast('Produto não encontrado.');
    Object.assign(product, payload);
    await saveState();
    await logAudit('produto-editar', {
      productId: editingId,
      name: payload.name,
      category: payload.category
    });
    renderAll();
    resetProductForm();
    toast('Produto atualizado com sucesso.');
    return;
  }

  state.products.push({ id: uid(), ...payload });
  await saveState();
  await logAudit('produto-criar', {
    name: payload.name,
    category: payload.category,
    stock: payload.stock,
    minStock: payload.minStock,
    price: payload.price
  });
  renderAll();
  resetProductForm();
  toast('Produto criado com sucesso.');
});

els.cancelProductEditBtn?.addEventListener('click', () => resetProductForm());
els.productSearch?.addEventListener('input', renderProductCards);

els.productCards?.addEventListener('mousedown', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  e.preventDefault();
  if (!requireAdmin()) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === 'edit-product') return fillProductForm(id);

  if (action === 'delete-product') {
    const ok = await appConfirm('Tem certeza que deseja remover este produto?', 'Remover produto', '🗑️');
if (!ok) return;
    const hasHistory = state.history.some((item) => item.productId === id);
    if (hasHistory) return toast('Não é possível remover produto com histórico.');
    state.products = state.products.filter((p) => p.id !== id);
    await saveState();
    await logAudit('produto-remover', { productId: id });
    renderAll();
    resetProductForm();
    toast('Produto removido com sucesso.');
  }
});

// =====================================================================
// Stock
// =====================================================================

document.getElementById('stockForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const product = byId(els.stockProduct.value);
  const qty = Number(els.stockQty.value);
  const minStock = Number(els.stockMin.value);
  const user = getCurrentUser();
  if (!product || qty <= 0 || !user) return;

  product.stock += qty;
  product.minStock = minStock;
  state.history.push({
    id: uid(), type: 'stock', productId: product.id, productName: product.name,
    quantity: qty, note: els.stockNote.value.trim(),
    createdById: user.id, createdByName: user.fullName, date: now()
  });

  await saveState();
  await logAudit('stock', {
    productId: product.id,
    productName: product.name,
    quantity: qty,
    minStock
  });
  e.target.reset();
  syncMin();
  renderAll();
  toast('Entrada de stock registrada com sucesso.');
  closeStockEntrySheet();
});

// =====================================================================
// PATCH 17 — Aplicar preço conforme quantidade/cliente
// =====================================================================

/**
 * Devolve o preço aplicável para um produto, dada a quantidade e o cliente.
 * Prioridade: VIP > Grosso > Normal.
 * Devolve { price, label, badgeClass }.
 */
function getApplicablePrice(product, qty, isVipClient) {
  if (!product) return { price: 0, label: 'Sem produto', badgeClass: 'normal' };

  const priceNormal = Number(product.price || 0);
  const priceWholesale = Number(product.priceWholesale || 0);
  const priceVip = Number(product.priceVip || 0);
  const wholesaleQty = Number(product.wholesaleQty || 5);

  // VIP tem prioridade máxima
  if (isVipClient && priceVip > 0) {
    return { price: priceVip, label: '⭐ Preço VIP', badgeClass: 'vip' };
  }

  // Grosso por quantidade
  if (priceWholesale > 0 && qty >= wholesaleQty) {
    return { price: priceWholesale, label: `📦 Preço grosso (${wholesaleQty}+ un.)`, badgeClass: 'wholesale' };
  }

  // Normal
  return { price: priceNormal, label: 'Preço normal', badgeClass: 'normal' };
}

/**
 * Verifica se o cliente selecionado é VIP.
 */
function isCurrentSaleClientVip() {
  const clientId = els.saleClient?.dataset?.clientId;
  if (!clientId) return false;
  const client = (state.clients || []).find(c => c.id === clientId);
  return client?.vip === true;
}

/**
 * Atualiza o badge de preço do formulário de venda.
 */
function updateSalePriceHint() {
  if (!els.salePriceHint) return;

  const product = byId(els.saleProduct?.value);
  if (!product) {
    els.salePriceHint.classList.add('hidden');
    return;
  }

  const qty = Number(els.saleQty?.value || 1);
  const isVip = isCurrentSaleClientVip();
  const result = getApplicablePrice(product, qty, isVip);

  // Aplicar automaticamente o preço ao input
  if (els.salePrice) els.salePrice.value = result.price;

  // Mostrar badge
  els.salePriceHint.classList.remove('hidden');
  els.salePriceHint.innerHTML = `
    <span class="price-badge ${result.badgeClass}">${result.label}</span>
    <span style="color:var(--muted); font-size:12px;">${money(result.price)} / unidade</span>
  `;
}

// =====================================================================
// CARRINHO — Funções (Patch 10)
// =====================================================================

function renderCart() {
  if (!els.cartList) return;

  const count = cart.items.length;
  const total = cart.items.reduce((s, item) => s + Number(item.total || 0), 0);

  // Contador no topo do card
  if (els.cartItemCount) {
    els.cartItemCount.textContent = count === 0
      ? 'Nenhum produto adicionado'
      : `${count} ${count === 1 ? 'produto' : 'produtos'} no carrinho`;
  }

  // Lista de items
  if (count === 0) {
    els.cartList.innerHTML = '<div class="item empty-state">Adicione produtos usando o formulário acima.</div>';
  } else {
    els.cartList.innerHTML = cart.items.map((item, index) => `
      <div class="item">
        <div class="cart-item-row">
          <div class="cart-item-info">
            <strong>${esc(item.productName)}</strong>
            <small>${item.quantity} x ${money(item.unitPrice)}</small>
          </div>
          <span class="cart-item-total">${money(item.total)}</span>
          <button type="button" class="cart-item-remove" data-cart-index="${index}" title="Remover">✕</button>
        </div>
      </div>
    `).join('');
  }

  // Resumo (total + ações)
  if (els.cartSummary) {
    els.cartSummary.classList.toggle('hidden', count === 0);
  }
  if (els.cartTotalValue) {
    els.cartTotalValue.textContent = money(total);
  }
}

function addToCart(productId, qty, unitPrice) {
  const product = byId(productId);
  if (!product) return toast('Produto não encontrado.');

  const total = qty * unitPrice;

  // Verificar se já existe no carrinho (mesmo produto + mesmo preço)
  const existingIndex = cart.items.findIndex(
    (i) => i.productId === productId && Number(i.unitPrice) === Number(unitPrice)
  );

  if (existingIndex >= 0) {
    // Somar quantidade
    cart.items[existingIndex].quantity += qty;
    cart.items[existingIndex].total = cart.items[existingIndex].quantity * cart.items[existingIndex].unitPrice;
  } else {
    cart.items.push({
      productId: product.id,
      productName: product.name,
      category: product.category,
      quantity: qty,
      unitPrice,
      total
    });
  }

  renderCart();
}

function removeFromCart(index) {
  if (index < 0 || index >= cart.items.length) return;
  cart.items.splice(index, 1);
  renderCart();
}

async function clearCart() {
  if (cart.items.length === 0) return;
  const ok = await appConfirm('Tem certeza que deseja limpar o carrinho?', 'Limpar carrinho', '🗑️');
  if (!ok) return;
  cart.items = [];
  renderCart();
}

async function finalizeSale() {
  if (cart.items.length === 0) {
    toast('Adicione pelo menos um produto ao carrinho.');
    return;
  }

  const user = getCurrentUser();
  if (!user) return;

  const paymentMethod = els.saleMethod?.value || 'dinheiro';
const note = els.saleNote?.value.trim() || '';
const clientId = els.saleClient?.dataset.clientId || '';
const clientName = els.saleClient?.value.trim() || '';

  // VALIDAÇÃO: verificar stock de cada item
  for (const item of cart.items) {
    const product = byId(item.productId);
    if (!product) {
      toast(`Produto "${item.productName}" não encontrado.`);
      return;
    }
    if (product.category === 'RL') {
      if (Number(product.stock) < Number(item.total)) {
        toast(`Saldo insuficiente em ${product.name}. Disponível: ${money(product.stock)}.`);
        return;
      }
    } else {
      if (Number(product.stock) < Number(item.quantity)) {
        toast(`Stock insuficiente em ${product.name}. Disponível: ${product.stock} un.`);
        return;
      }
    }
  }

  // Aplicar desconto ao stock e criar registos no histórico
  const saleDate = now();
  const saleIds = [];

  for (const item of cart.items) {
    const product = byId(item.productId);
    if (!product) continue;

    if (product.category === 'RL') {
      product.stock -= item.total;
    } else {
      product.stock -= item.quantity;
    }

    const saleId = uid();
    saleIds.push(saleId);
    state.history.push({
  id: saleId,
  type: 'venda',
  productId: product.id,
  productName: product.name,
  quantity: item.quantity,
  unitPrice: item.unitPrice,
  total: item.total,
  paymentMethod,
  note,
  clientId,
  clientName,
  createdById: user.id,
  createdByName: user.fullName,
  date: saleDate
});
  }

  const grandTotal = cart.items.reduce((s, i) => s + Number(i.total || 0), 0);

  await saveState();

  // Auditoria (1 registo por venda com o resumo)
  await logAudit('venda', {
    items: cart.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.total
    })),
    grandTotal,
    paymentMethod,
    note,
    clientId,
    clientName,
    multiItem: true
  });

  // Limpar carrinho e formulário
  cart.items = [];
  renderCart();
  els.saleForm?.reset();
  syncPrice();
  updateSaleHint();

// Limpar cliente selecionado
if (els.saleClient) {
  els.saleClient.value = '';
  delete els.saleClient.dataset.clientId;
}
  renderAll();

  toast(`Venda registada: ${money(grandTotal)}`, 5000);

  // Abrir recibo do primeiro item (ou podíamos fazer recibo multi-item no futuro)
  if (saleIds.length >= 1) {
  // Abre recibo (multi-item ou single — a função trata os dois casos)
  window.imprimirRecibo?.(saleIds[0]);
  }
}

// Listeners do carrinho
els.clearCartBtn?.addEventListener('click', clearCart);
els.finalizeSaleBtn?.addEventListener('click', finalizeSale);

// Listener para remover item (delegação de eventos)
els.cartList?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cart-index]');
  if (!btn) return;
  const index = parseInt(btn.dataset.cartIndex, 10);
  removeFromCart(index);
});

// =====================================================================
// Venda
// =====================================================================

document.getElementById('saleForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const product = byId(els.saleProduct.value);
  const qty = Number(els.saleQty.value);
  const unitPrice = Number(els.salePrice.value);

  if (!product || qty <= 0 || unitPrice < 0) return;

  // Bloquear desconto a operadores em CF
  if (product.category === 'CF' && !can('vendaDesconto') && unitPrice < product.price) {
    return toast(`Sem permissão para desconto. Preço mínimo: ${money(product.price)}.`);
  }

  // Validar stock (sem descontar ainda — só no finalizeSale)
  const totalToAdd = qty * unitPrice;

  // Soma ao que já está no carrinho para validar
  const jaNoCarrinho = cart.items
    .filter((i) => i.productId === product.id)
    .reduce((s, i) => s + Number(i.category === 'RL' ? i.total : i.quantity), 0);

  if (product.category === 'RL') {
    if (Number(product.stock) < (jaNoCarrinho + totalToAdd)) {
      return toast(`Saldo insuficiente em ${product.name}. Disponível: ${money(product.stock - jaNoCarrinho)}.`);
    }
  } else {
    if (Number(product.stock) < (jaNoCarrinho + qty)) {
      return toast(`Stock insuficiente em ${product.name}. Disponível: ${product.stock - jaNoCarrinho} un.`);
    }
  }

  // Adicionar ao carrinho
  addToCart(product.id, qty, unitPrice);

  // Não fazer reset completo — só dos campos de produto/quantidade/preço
  els.saleQty.value = '1';
  syncPrice();
  updateSaleHint();

  toast(`${product.name} adicionado ao carrinho.`, 3000);
});

// =====================================================================
// Caixa
// =====================================================================

document.getElementById('cashForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const amount = Number(els.cashAmount.value);
  const user = getCurrentUser();
  if (amount <= 0 || !user) return;

  const kind = els.cashType.value;
  const note = els.cashNote.value.trim();

  state.cashMovements.push({
    id: uid(), kind, amount, note,
    createdById: user.id, createdByName: user.fullName, date: now()
  });

  await saveState();
  await logAudit('caixa', { kind, amount, note });
  e.target.reset();
  renderAll();
  toast('Movimento de caixa registrado.');
});

// =====================================================================
// DESPESAS — Patch 18
// =====================================================================

const EXPENSE_CATEGORIES = {
  luz:          { label: '💡 Luz',        class: 'luz' },
  agua:         { label: '💧 Água',       class: 'agua' },
  renda:        { label: '🏠 Renda',      class: 'renda' },
  salarios:     { label: '👥 Salários',   class: 'salarios' },
  internet:     { label: '🌐 Internet',   class: 'internet' },
  combustivel:  { label: '⛽ Combustível', class: 'combustivel' },
  manutencao:   { label: '🔧 Manutenção', class: 'manutencao' },
  outra:        { label: '📦 Outra',      class: 'outra' }
};

function resetExpenseForm() {
  els.expenseForm?.reset();
  if (els.expenseEditId) els.expenseEditId.value = '';
  if (els.expenseFormMode) els.expenseFormMode.textContent = 'Nova despesa';
  if (els.expenseDate) els.expenseDate.value = today();
}

function fillExpenseForm(id) {
  const expense = (state.expenses || []).find(e => e.id === id);
  if (!expense) return toast('Despesa não encontrada.');

  els.expenseEditId.value = expense.id;
  if (els.expenseDate) els.expenseDate.value = expense.date || today();
  if (els.expenseCategory) els.expenseCategory.value = expense.category || 'outra';
  if (els.expenseAmount) els.expenseAmount.value = expense.amount || 0;
  if (els.expenseDescription) els.expenseDescription.value = expense.description || '';
  if (els.expenseNotes) els.expenseNotes.value = expense.notes || '';
  if (els.expenseFormMode) els.expenseFormMode.textContent = 'Editando despesa';
  activate('despesas');
}

// =====================================================================
// CLIENTES — Patch 13
// =====================================================================

function resetClientForm() {
  els.clientForm?.reset();
  if (els.clientEditId) els.clientEditId.value = '';
  if (els.clientFormMode) els.clientFormMode.textContent = 'Novo cliente';
  if (els.clientVip) els.clientVip.checked = false;
}

function fillClientForm(id) {
  const client = (state.clients || []).find(c => c.id === id);
  if (!client) return toast('Cliente não encontrado.');

  els.clientEditId.value = client.id;
  els.clientName.value = client.name || '';
  els.clientPhone.value = client.phone || '';
  els.clientEmail.value = client.email || '';
  els.clientNif.value = client.nif || '';
  els.clientNotes.value = client.notes || '';
  if (els.clientVip) els.clientVip.checked = client.vip === true;
  els.clientFormMode.textContent = 'Editando cliente';
  activate('clientes');
}

async function saveClientFromForm(payload, editingId) {
  if (!state.clients) state.clients = [];

  if (editingId) {
    const client = state.clients.find(c => c.id === editingId);
    if (!client) return toast('Cliente não encontrado.');
    Object.assign(client, payload);
    await saveState();
    await logAudit('client-editar', {
      clientId: editingId,
      name: payload.name,
      phone: payload.phone || '',
      nif: payload.nif || ''
    });
    return client;
  }

  if (payload.phone) {
    const dup = state.clients.find(c => (c.phone || '').trim() === payload.phone.trim());
    if (dup) {
      toast('Já existe um cliente com esse telefone.');
      return null;
    }
  }

  const newClient = {
    id: uid(),
    name: payload.name,
    phone: payload.phone || '',
    email: payload.email || '',
    nif: payload.nif || '',
    notes: payload.notes || '',
    vip: payload.vip === true,
    createdAt: now(),
    createdById: getCurrentUser()?.id || '',
    createdByName: getCurrentUser()?.fullName || ''
  };

  state.clients.push(newClient);
  await saveState();
  await logAudit('client-criar', {
    clientId: newClient.id,
    name: newClient.name,
    phone: newClient.phone,
    nif: newClient.nif
  });
  return newClient;
}

// =====================================================================
// Utilizadores
// =====================================================================

function resetUserForm() {
  els.userForm?.reset();
  if (els.userEditId) els.userEditId.value = '';
  if (els.userPassword) els.userPassword.required = true;
  if (els.userSubmitBtn) els.userSubmitBtn.textContent = cloudMode() ? 'Criar usuário online' : 'Criar usuário';
  if (els.userCommission) els.userCommission.value = '0';
  els.cancelUserEditBtn?.classList.add('hidden');
}

function fillUserForm(id) {
  const userSource = cloudMode() ? session.cloudUsers : state.users;
  const user = userSource.find(u => u.id === id);
  if (!user) return toast('Usuário não encontrado.');

  els.userEditId.value = user.id;
  els.userFullName.value = user.fullName;
  els.userUsername.value = cloudMode() ? user.email : user.username;
  els.userRole.value = user.role;
  if (els.userCommission) els.userCommission.value = user.commission ?? 0;
  els.userPassword.required = false;
  els.userPassword.value = '';
  els.userSubmitBtn.textContent = 'Atualizar usuário';
  els.cancelUserEditBtn.classList.remove('hidden');
  activate('usuarios');
}

els.userForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const editingId = els.userEditId.value;
  const fullName = els.userFullName.value.trim();
  const emailOrUsername = els.userUsername.value.trim();
  const role = els.userRole.value;
  const commission = Number(els.userCommission?.value || 0);
  const password = els.userPassword.value.trim();

  if (!fullName || !emailOrUsername) return toast('Preencha o nome e o email/usuário.');
  if (cloudMode()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailOrUsername)) return toast('Insira um e-mail válido.');
  }

  if (editingId) {
    const userSource = cloudMode() ? session.cloudUsers : state.users;
    const user = userSource.find(u => u.id === editingId);
    if (!user) return toast('Usuário não encontrado.');

    user.fullName = fullName;
    user.role = role;
    user.commission = commission;

    if (cloudMode()) {
      user.email = emailOrUsername;
      try {
        const { doc, setDoc } = session.api;
        await setDoc(doc(session.db, 'users', user.id), user, { merge: true });
        await fetchCloudUsers();
        saveLocal();
      } catch { return toast('Erro ao atualizar usuário na nuvem.'); }
    } else {
      user.username = emailOrUsername;
      if (password) user.password = await hashPassword(password);
      saveLocal();
    }

    await logAudit('user-editar', {
      userId: editingId,
      fullName,
      role
    });

    renderAll();
    resetUserForm();
    toast('Usuário atualizado com sucesso.');
    return;
  }

  if (!password) return toast('A palavra-passe é obrigatória para criar um novo usuário.');

  if (cloudMode()) {
    try {
      const userCredential = await session.api.createUserWithEmailAndPassword(session.auth, emailOrUsername, password);
      const uid2 = userCredential.user.uid;
      const { doc, setDoc } = session.api;
      await setDoc(doc(session.db, 'users', uid2), {
        fullName, email: emailOrUsername, role, commission, active: true, createdAt: now()
      });
      await fetchCloudUsers();

      await logAudit('user-criar', {
        userId: uid2,
        fullName,
        email: emailOrUsername,
        role,
        mode: 'online'
      });

      resetUserForm();
      renderAll();
      toast('Usuário criado com sucesso online!');
    } catch (err) {
      _origConsoleError(err);
      if (err.code === 'auth/email-already-in-use') toast('Este e-mail já está cadastrado.');
      else toast('Erro ao criar usuário: ' + (err.code || err.message));
    }
  } else {
    const username = emailOrUsername.toLowerCase();
    if (state.users.some(u => u.username.toLowerCase() === username)) {
      return toast('Já existe um usuário com esse nome.');
    }
    state.users.push({
      id: uid(), fullName, username,
      password: await hashPassword(password),
      role, commission, active: true, createdAt: now()
    });
    saveLocal();

    await logAudit('user-criar', {
      fullName,
      email: emailOrUsername,
      role,
      mode: 'local'
    });

    resetUserForm();
    renderAll();
    toast('Usuário criado com sucesso!');
  }
});

els.cancelUserEditBtn?.addEventListener('click', resetUserForm);

els.userList?.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button || !isAdmin()) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === 'toggle-user') {
    const userSource = cloudMode() ? session.cloudUsers : state.users;
    const user = userSource.find(u => u.id === id);
    if (!user) return;
    const current = getCurrentUser();
    if (current?.id === user.id && user.active !== false) return toast('Não pode desativar o seu próprio utilizador.');
    if (user.role === 'admin' && user.active !== false && userSource.filter(u => u.role === 'admin' && u.active !== false).length <= 1) return toast('Tem de existir pelo menos um administrador ativo.');

    user.active = !(user.active !== false);
    if (cloudMode()) {
      try {
        const { doc, setDoc } = session.api;
        await setDoc(doc(session.db, 'users', user.id), user, { merge: true });
        await fetchCloudUsers();
      } catch { return toast('Erro ao atualizar utilizador na nuvem.'); }
    } else { saveLocal(); }

    await logAudit('user-toggle', { userId: id, active: user.active });

    renderAll();
    toast(`Usuário ${user.active !== false ? 'ativado' : 'desativado'} com sucesso.`);
    return;
  }

  if (action === 'edit-user') return fillUserForm(id);

  if (action === 'delete-user') {
    const ok = await appConfirm('Remover este usuário?', 'Remover utilizador', '🗑️');
if (!ok) return;
    const current = getCurrentUser();
    if (current?.id === id) return toast('Não pode remover o seu próprio utilizador.');

    if (cloudMode()) {
      try {
        const { deleteDoc, doc } = session.api;
        await deleteDoc(doc(session.db, 'users', id));
        await fetchCloudUsers();
        saveLocal();

        await logAudit('user-remover', { userId: id, mode: 'online' });

        renderAll();
        toast('Usuário removido da nuvem.');
      } catch { return toast('Erro ao remover da nuvem.'); }
    } else {
      state.users = state.users.filter(u => u.id !== id);
      saveLocal();

      await logAudit('user-remover', { userId: id, mode: 'local' });

      renderAll();
      toast('Usuário removido com sucesso.');
    }
    return;
  }

  if (action === 'reset-pass') {
    const userSource = cloudMode() ? session.cloudUsers : state.users;
    const user = userSource.find(u => u.id === id);
    if (!user) return;

    if (cloudMode()) {
      try {
        await session.api.sendPasswordResetEmail(session.auth, user.email || user.username);
        await logAudit('user-reset-pass', {
          userId: id,
          email: user.email || user.username,
          mode: 'email'
        });
        toast('Email de recuperação enviado.');
      } catch { toast('Erro ao enviar email.'); }
    } else {
      const tempPass = prompt('Nova palavra-passe temporária:', '1234');
      if (!tempPass) return;
      user.password = await hashPassword(tempPass);
      saveLocal();

      await logAudit('user-reset-pass', {
        userId: id,
        email: user.username,
        mode: 'local'
      });

      renderAll();
      toast('Palavra-passe local redefinida.');
    }
  }
});

// =====================================================================
// DESPESAS — Handlers (Patch 18)
// =====================================================================

els.expenseForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const editingId = els.expenseEditId.value;
  const payload = {
    date: els.expenseDate.value || today(),
    category: els.expenseCategory.value,
    amount: Number(els.expenseAmount.value),
    description: els.expenseDescription.value.trim(),
    notes: els.expenseNotes.value.trim()
  };

  if (!payload.amount || payload.amount <= 0) return toast('Insira um valor válido.');
  if (!payload.description) return toast('Preencha a descrição.');

  if (!state.expenses) state.expenses = [];

  if (editingId) {
    const expense = state.expenses.find(x => x.id === editingId);
    if (!expense) return toast('Despesa não encontrada.');
    Object.assign(expense, payload);
    await saveState();
    await logAudit('despesa-editar', {
      expenseId: editingId,
      category: payload.category,
      amount: payload.amount
    });
    resetExpenseForm();
    renderAll();
    toast('Despesa atualizada.');
    return;
  }

  const newExpense = {
    id: uid(),
    ...payload,
    createdById: getCurrentUser()?.id || '',
    createdByName: getCurrentUser()?.fullName || '',
    createdAt: now()
  };

  state.expenses.push(newExpense);
  await saveState();
  await logAudit('despesa-criar', {
    expenseId: newExpense.id,
    category: newExpense.category,
    amount: newExpense.amount,
    description: newExpense.description
  });

  resetExpenseForm();
  renderAll();
  toast('Despesa registada.');
});

els.cancelExpenseEditBtn?.addEventListener('click', resetExpenseForm);

els.expenseRange?.addEventListener('change', renderExpenseSummary);
els.expenseFilter?.addEventListener('change', renderExpenses);

els.expenseList?.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button || !isAdmin()) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === 'edit-expense') {
    fillExpenseForm(id);
    return;
  }

  if (action === 'delete-expense') {
    const ok = await appConfirm('Remover esta despesa?', 'Remover despesa', '🗑️');
if (!ok) return;
    const expense = (state.expenses || []).find(x => x.id === id);
    if (!expense) return;

    state.expenses = state.expenses.filter(x => x.id !== id);
    await saveState();
    await logAudit('despesa-remover', {
      expenseId: id,
      category: expense.category,
      amount: expense.amount
    });

    renderAll();
    toast('Despesa removida.');
  }
});

// =====================================================================
// CLIENTES — Handlers (Patch 13)
// =====================================================================

els.clientForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const editingId = els.clientEditId.value;
  const payload = {
    name: els.clientName.value.trim(),
    phone: els.clientPhone.value.trim(),
    email: els.clientEmail.value.trim(),
    nif: els.clientNif.value.trim(),
    notes: els.clientNotes.value.trim(),
    vip: els.clientVip?.checked === true
  };

  if (!payload.name) return toast('Preencha o nome do cliente.');

  const result = await saveClientFromForm(payload, editingId);
  if (!result) return;

  resetClientForm();
  renderAll();
  toast(editingId ? 'Cliente atualizado.' : 'Cliente criado.');
});

els.cancelClientEditBtn?.addEventListener('click', resetClientForm);

els.clientSearch?.addEventListener('input', renderClients);

els.clientCards?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="view-client"]');
  if (!card) return;
  const id = card.dataset.id;
  openClientHistory(id);
});

// =====================================================================
// CLIENTES — Modal pick + New + Histórico (Patch 13, parte 2)
// =====================================================================

function openClientHistory(id) {
  const client = (state.clients || []).find(c => c.id === id);
  if (!client) return toast('Cliente não encontrado.');

  const sales = (state.history || [])
    .filter(h => h.type === 'venda' && h.clientId === id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalSpent = sales.reduce((s, h) => s + Number(h.total || 0), 0);
  const lastSale = sales[0];
  const lastSaleDate = lastSale ? new Date(lastSale.date).toLocaleDateString('pt-PT') : '—';

  const salesHtml = sales.length
    ? sales.map(h => `
        <div class="item" style="margin-bottom:6px;">
          <div class="product-name-row">
            <strong>${esc(h.productName)}</strong>
            <span class="badge">${money(h.total)}</span>
          </div>
          <small>${new Date(h.date).toLocaleString('pt-PT')} • ${esc(h.paymentMethod || '')}</small>
        </div>
      `).join('')
    : '<div class="item empty-state">Sem compras registadas.</div>';

  els.clientHistoryContent.innerHTML = `
    <div class="client-history-header">
      <h3>${esc(client.name)}</h3>
      ${client.phone ? `<small>📞 ${esc(client.phone)}</small>` : ''}
      ${client.nif ? `<small>NIF: ${esc(client.nif)}</small>` : ''}
      ${client.email ? `<small>✉️ ${esc(client.email)}</small>` : ''}
      ${client.notes ? `<small>📝 ${esc(client.notes)}</small>` : ''}
    </div>

    <div class="client-history-summary">
      <div class="summary-box">
        <small>Total de compras</small>
        <strong>${sales.length}</strong>
      </div>
      <div class="summary-box">
        <small>Total gasto</small>
        <strong>${money(totalSpent)}</strong>
      </div>
    </div>

    <div class="client-history-list">
      ${salesHtml}
    </div>

    <div class="button-row" style="margin-top:12px;">
      <button type="button" class="ghost" onclick="window.__editarCliente('${esc(client.id)}')" style="flex:1;">✏️ Editar</button>
      <button type="button" class="danger-btn" onclick="window.__removerCliente('${esc(client.id)}')" style="flex:1;">🗑️ Remover</button>
    </div>
  `;

  els.clientHistoryModal?.classList.remove('hidden');
}

window.__editarCliente = function(id) {
  els.clientHistoryModal?.classList.add('hidden');
  fillClientForm(id);
};

window.__removerCliente = async function(id) {
  if (!requireAdmin()) return;
  const client = (state.clients || []).find(c => c.id === id);
  if (!client) return;
  const ok = await appConfirm(`Remover cliente "${client.name}"?`, 'Remover cliente', '🗑️');
if (!ok) return;

  state.clients = state.clients.filter(c => c.id !== id);
  await saveState();
  await logAudit('client-remover', { clientId: id, name: client.name });

  els.clientHistoryModal?.classList.add('hidden');
  renderAll();
  toast('Cliente removido.');
};

// ---------- Modal de escolher cliente ----------

function renderPickClientList(filter = '') {
  if (!els.pickClientList) return;
  const term = String(filter || '').trim().toLowerCase();
  const all = Array.isArray(state.clients) ? state.clients : [];

  const filtered = term
    ? all.filter(c =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.phone || '').toLowerCase().includes(term) ||
        (c.nif || '').toLowerCase().includes(term)
      )
    : all.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (filtered.length === 0) {
    els.pickClientList.innerHTML = '<div class="item empty-state">Nenhum cliente encontrado.</div>';
    return;
  }

  els.pickClientList.innerHTML = filtered.slice(0, 100).map(c => `
    <div class="item" data-client-pick="${esc(c.id)}" style="cursor:pointer;">
      <div class="pick-client-row">
        <div class="pick-client-info">
          <strong>${esc(c.name)}</strong>
          ${c.phone ? `<small>📞 ${esc(c.phone)}</small>` : ''}
          ${c.nif ? `<small>NIF: ${esc(c.nif)}</small>` : ''}
        </div>
        <span class="badge info">Escolher</span>
      </div>
    </div>
  `).join('');
}

function openPickClientModal() {
  renderPickClientList('');
  if (els.pickClientSearch) els.pickClientSearch.value = '';
  els.pickClientModal?.classList.remove('hidden');
}

els.pickClientBtn?.addEventListener('click', openPickClientModal);
els.pickClientSearch?.addEventListener('input', (e) => renderPickClientList(e.target.value));

els.pickClientList?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-client-pick]');
  if (!row) return;
  const clientId = row.dataset.clientPick;
  const client = (state.clients || []).find(c => c.id === clientId);
  if (!client) return;
  if (els.saleClient) els.saleClient.value = client.name;
  els.saleClient.dataset.clientId = client.id;
  els.pickClientModal?.classList.add('hidden');
  // Patch 17: recalcular preço se o cliente for VIP
syncPrice();
  toast(`Cliente: ${client.name}`, 3000);
});

els.pickClientNoneBtn?.addEventListener('click', () => {
  if (els.saleClient) {
    els.saleClient.value = '';
    delete els.saleClient.dataset.clientId;
  }
  els.pickClientModal?.classList.add('hidden');
});

els.pickClientNewBtn?.addEventListener('click', () => {
  els.pickClientModal?.classList.add('hidden');
  if (els.quickClientName) els.quickClientName.value = '';
  if (els.quickClientPhone) els.quickClientPhone.value = '';
  if (els.quickClientNif) els.quickClientNif.value = '';
  els.newClientModal?.classList.remove('hidden');
  setTimeout(() => els.quickClientName?.focus(), 200);
});

// ---------- Modal de novo cliente rápido ----------

els.quickClientCancelBtn?.addEventListener('click', () => {
  els.newClientModal?.classList.add('hidden');
});

els.quickClientSaveBtn?.addEventListener('click', async () => {
  const name = els.quickClientName?.value.trim();
  const phone = els.quickClientPhone?.value.trim();
  const nif = els.quickClientNif?.value.trim();
  if (!name) return toast('Informe o nome do cliente.');

  const result = await saveClientFromForm({ name, phone, email: '', nif, notes: '' }, '');
  if (!result) return;

  if (els.saleClient) {
    els.saleClient.value = result.name;
    els.saleClient.dataset.clientId = result.id;
  }

  els.newClientModal?.classList.add('hidden');
  renderAll();
  toast(`Cliente ${result.name} criado.`);
});

// ---------- Fechar modais (delegação) ----------

['pickClientModal', 'newClientModal', 'clientHistoryModal'].forEach((modalId) => {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target.closest('.close-modal') || e.target.classList.contains('modal')) {
      modal.classList.add('hidden');
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  ['pickClientModal', 'newClientModal', 'clientHistoryModal'].forEach((modalId) => {
    const modal = document.getElementById(modalId);
    if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
  });
});

// =====================================================================
// PATCH 20.2 — Seletor de período customizado
// =====================================================================

function openReportRangeModal() {
  if (!els.reportRangeModal) return;

  // Marcar a opção atual
  const currentValue = els.reportRange?.value || '';
  els.reportRangeModal.querySelectorAll('.range-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === currentValue);
  });

  els.reportRangeModal.classList.remove('hidden');
}

function closeReportRangeModal() {
  els.reportRangeModal?.classList.add('hidden');
}

els.reportRangeBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  openReportRangeModal();
});

els.reportRangeCancelBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeReportRangeModal();
});

els.reportRangeModal?.querySelectorAll('.range-option').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();

    const value = btn.dataset.value || '';
    const labelText = btn.textContent.trim();

    // Atualizar o input hidden
    if (els.reportRange) els.reportRange.value = value;

    // Atualizar o label visível
    if (els.reportRangeLabel) {
      els.reportRangeLabel.textContent = value
        ? labelText.replace(/^[^\s]+\s/, '') // remove o emoji do início
        : '— Escolher período —';
    }

    // Fechar modal
    closeReportRangeModal();

    // Renderizar o relatório
    renderReport();

    // Fechar painel PDF se estiver aberto
    els.pdfPanel?.classList.add('hidden');
  });
});

// Clicar no fundo escuro fecha o modal
els.reportRangeModal?.addEventListener('click', (e) => {
  if (e.target === els.reportRangeModal) {
    closeReportRangeModal();
  }
});

// ESC fecha o modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.reportRangeModal && !els.reportRangeModal.classList.contains('hidden')) {
    closeReportRangeModal();
  }
});

// =====================================================================
// ✅ Bónus: garantir que o botão "Cancelar" do formulário de utilizadores também está ligado
// (caso não esteja noutro sítio)
// =====================================================================

if (els.cancelUserEditBtn && !els.cancelUserEditBtn.dataset.bound) {
  els.cancelUserEditBtn.dataset.bound = '1';
  els.cancelUserEditBtn.addEventListener('click', resetUserForm);
}

// =====================================================================
// EXPORTAÇÃO CSV — Listeners (Patch 14)
// =====================================================================

els.exportSalesCsvBtn?.addEventListener('click', exportSalesCsv);
els.exportStockCsvBtn?.addEventListener('click', exportStockCsv);
els.exportClientsCsvBtn?.addEventListener('click', exportClientsCsv);
els.exportAuditCsvBtn?.addEventListener('click', exportAuditCsv);

// =====================================================================
// Backup
// =====================================================================

els.exportBackupBtn?.addEventListener('click', () => {
  if (!requireAdmin()) return;
  downloadBackup();
  toast('Backup exportado com sucesso.');
});

els.importBackupBtn?.addEventListener('click', async () => {
  if (!requireAdmin()) return;
  await importBackupFile(els.importBackupFile.files?.[0]);
});

// =====================================================================
// Eventos diversos
// =====================================================================

els.saleProduct?.addEventListener('change', () => { syncPrice(); updateSaleHint(); });
els.saleQty?.addEventListener('input', () => { syncPrice(); });
els.saleClient?.addEventListener('input', () => {
  if (!els.saleClient.value.trim()) delete els.saleClient.dataset.clientId;
  updateSalePriceHint();
});
els.stockProduct?.addEventListener('change', syncMin);
els.historyFilter?.addEventListener('change', renderHistory);
els.historyDateFrom?.addEventListener('change', renderHistory);
els.historyDateTo?.addEventListener('change', renderHistory);
els.historyOperator?.addEventListener('change', renderHistory);
els.historyClient?.addEventListener('change', renderHistory);
els.historyPayment?.addEventListener('change', renderHistory);
els.clearHistoryFiltersBtn?.addEventListener('click', () => {
  if (els.historyFilter) els.historyFilter.value = 'todos';
  if (els.historyDateFrom) els.historyDateFrom.value = '';
  if (els.historyDateTo) els.historyDateTo.value = '';
  if (els.historyOperator) els.historyOperator.value = '';
  if (els.historyClient) els.historyClient.value = '';
  if (els.historyPayment) els.historyPayment.value = '';
  renderHistory();
  toast('Filtros limpos.');
});
els.reportRange?.addEventListener('change', () => {
  renderReport();
  els.pdfPanel?.classList.add('hidden');
});
els.auditLogFilter?.addEventListener('change', renderAuditLog);
els.commissionRange?.addEventListener('change', renderCommissions);

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (!can(tab)) return toast('Área reservada ao administrador.');
    activate(tab);
  });
});

// =====================================================================
// PATCH 20.1 — Painel PDF flutuante
// =====================================================================

let pdfPanelJustOpened = false;

els.pdfIconBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (!can('relatorio')) return toast('Apenas administradores.');

  const isHidden = els.pdfPanel?.classList.contains('hidden');
  els.pdfPanel?.classList.toggle('hidden');

  // Se acabou de abrir, ignora cliques-outside durante 300ms
  if (isHidden) {
    pdfPanelJustOpened = true;
    setTimeout(() => { pdfPanelJustOpened = false; }, 300);
  }
});

document.addEventListener('click', (e) => {
  if (!els.pdfPanel || els.pdfPanel.classList.contains('hidden')) return;
  if (pdfPanelJustOpened) return;

  const insidePanel = els.pdfPanel.contains(e.target);
  const insideBtn = els.pdfIconBtn?.contains(e.target);

  if (!insidePanel && !insideBtn) {
    els.pdfPanel.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.pdfPanel && !els.pdfPanel.classList.contains('hidden')) {
    els.pdfPanel.classList.add('hidden');
  }
});

// =====================================================================
// PDF
// =====================================================================

els.exportPdfBtn?.addEventListener('click', () => {
  if (!requireAdmin()) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // ====== Configuração do período ======
  const range = els.reportRange.value;
  const label = range === 'today' ? 'Hoje' : range === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias';
  const sales = salesForRange(range);
  const expenses = getExpensesInRange(range);

  const revenue = sales.reduce((s, i) => s + Number(i.total || 0), 0);
  const qty = sales.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const profit = revenue - totalExpenses;

  const user = getCurrentUser();
  const emissionDate = new Date().toLocaleString('pt-PT');
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  let cursorY = 20;

  // ====== Cabeçalho ======
  // Logo (quadrado teal com SS)
  doc.setFillColor(15, 118, 110);
  doc.roundedRect(marginX, cursorY - 8, 16, 16, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('SS', marginX + 8, cursorY + 3, { align: 'center' });

  // Nome + slogan
  doc.setTextColor(15, 118, 110);
  doc.setFontSize(16);
  doc.text('SALDAR SERVIÇOS', marginX + 22, cursorY - 2);

  doc.setFontSize(9);
  doc.setFont(undefined, 'italic');
  doc.setTextColor(120, 120, 120);
  doc.text('Gestão simples, resultados reais.', marginX + 22, cursorY + 4);

  cursorY += 14;

  // Linha separadora
  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
  cursorY += 8;

  // Info de período
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(50, 50, 50);
  doc.text(`Período: ${label}`, marginX, cursorY);
  doc.text(`Emitido em: ${emissionDate}`, pageWidth - marginX, cursorY, { align: 'right' });
  cursorY += 5;
  doc.text(`Emitido por: ${user?.fullName || 'Sistema'}`, marginX, cursorY);
  cursorY += 10;

  // ====== Secções ======

  // 1. Resumo financeiro
  if (els.pdfIncludeSummary?.checked) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 118, 110);
    doc.text('RESUMO FINANCEIRO', marginX, cursorY);
    cursorY += 6;

    doc.autoTable({
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Métrica', 'Valor']],
      body: [
        ['Total de vendas', String(sales.length)],
        ['Unidades vendidas', String(qty)],
        ['Faturamento', money(revenue)],
        ['Total de despesas', money(totalExpenses)],
        ['Lucro real', money(profit)]
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110], fontSize: 10 },
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: { 1: { halign: 'right' } }
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  }

  // 2. Resumo por produto
  if (els.pdfIncludeByProduct?.checked && sales.length > 0) {
    const byProduct = {};
    sales.forEach(s => {
      const k = s.productName || 'Sem nome';
      if (!byProduct[k]) byProduct[k] = { qty: 0, total: 0 };
      byProduct[k].qty += Number(s.quantity || 0);
      byProduct[k].total += Number(s.total || 0);
    });
    const rows = Object.entries(byProduct)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => [name, String(d.qty), money(d.total)]);

    if (rows.length > 0) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 118, 110);
      doc.text('RESUMO POR PRODUTO', marginX, cursorY);
      cursorY += 6;

      doc.autoTable({
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Produto', 'Qtd', 'Total']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [15, 118, 110], fontSize: 10 },
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } }
      });
      cursorY = doc.lastAutoTable.finalY + 10;
    }
  }

  // 3. Resumo por cliente
  if (els.pdfIncludeByClient?.checked && sales.length > 0) {
    const byClient = {};
    sales.forEach(s => {
      const k = s.clientName || 'Sem cliente';
      if (!byClient[k]) byClient[k] = { count: 0, total: 0 };
      byClient[k].count += 1;
      byClient[k].total += Number(s.total || 0);
    });
    const rows = Object.entries(byClient)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => [name, String(d.count), money(d.total)]);

    if (rows.length > 0) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 118, 110);
      doc.text('RESUMO POR CLIENTE', marginX, cursorY);
      cursorY += 6;

      doc.autoTable({
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Cliente', 'Nº vendas', 'Total']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [15, 118, 110], fontSize: 10 },
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } }
      });
      cursorY = doc.lastAutoTable.finalY + 10;
    }
  }

  // 4. Resumo por operador
  if (els.pdfIncludeByOperator?.checked && sales.length > 0) {
    const byOp = {};
    sales.forEach(s => {
      const k = s.createdByName || 'Sem operador';
      if (!byOp[k]) byOp[k] = { count: 0, total: 0 };
      byOp[k].count += 1;
      byOp[k].total += Number(s.total || 0);
    });
    const rows = Object.entries(byOp)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => [name, String(d.count), money(d.total)]);

    if (rows.length > 0) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 118, 110);
      doc.text('RESUMO POR OPERADOR', marginX, cursorY);
      cursorY += 6;

      doc.autoTable({
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Operador', 'Nº vendas', 'Total']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [15, 118, 110], fontSize: 10 },
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } }
      });
      cursorY = doc.lastAutoTable.finalY + 10;
    }
  }

  // 5. Despesas detalhadas
  if (els.pdfIncludeExpenses?.checked && expenses.length > 0) {
    const rows = expenses
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(e => [
        new Date(e.date).toLocaleDateString('pt-PT'),
        EXPENSE_CATEGORIES[e.category]?.label || e.category,
        e.description || '',
        money(e.amount)
      ]);

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 118, 110);
    doc.text('DESPESAS DETALHADAS', marginX, cursorY);
    cursorY += 6;

    doc.autoTable({
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Data', 'Categoria', 'Descrição', 'Valor']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [220, 38, 38], fontSize: 10 },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 3: { halign: 'right' } }
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  }

  // 6. Vendas detalhadas
  if (els.pdfIncludeSales?.checked && sales.length > 0) {
    const rows = sales
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(s => [
        new Date(s.date).toLocaleString('pt-PT'),
        s.productName || '',
        String(s.quantity || 0),
        money(s.unitPrice),
        money(s.total),
        s.paymentMethod || '',
        s.clientName || '',
        s.createdByName || ''
      ]);

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 118, 110);
    doc.text('VENDAS DETALHADAS', marginX, cursorY);
    cursorY += 6;

    doc.autoTable({
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Data', 'Produto', 'Qtd', 'P. Unit.', 'Total', 'Método', 'Cliente', 'Operador']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [15, 118, 110], fontSize: 8 },
      styles: { fontSize: 7, cellPadding: 1.5 },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' }
      }
    });
  }

  // ====== Rodapé com paginação ======
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont(undefined, 'italic');
    doc.text(
      `© ${new Date().getFullYear()} Saldar Serviços — Gestão e controle`,
      marginX,
      pageHeight - 8
    );
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - marginX,
      pageHeight - 8,
      { align: 'right' }
    );
  }

    doc.save(`relatorio_${today()}_${Date.now()}.pdf`);
  toast('Relatório PDF gerado com sucesso!');
  els.pdfPanel?.classList.add('hidden');
});

// =====================================================================
// Recibo
// =====================================================================

window.imprimirRecibo = function(saleId) {
  const sale = state.history.find(item => item.id === saleId);
  if (!sale) return toast('Recibo não encontrado.');

  // Encontrar todos os itens da mesma venda (mesma data + mesmo utilizador)
  const siblings = state.history.filter(item =>
    item.type === 'venda' &&
    item.date === sale.date &&
    item.createdById === sale.createdById
  );

  const items = siblings.length > 1 ? siblings : [sale];
  const grandTotal = items.reduce((s, i) => s + Number(i.total || 0), 0);
  const date = new Date(sale.date).toLocaleString('pt-PT');

  const itemsHtml = items.map(i => `
    <div class="receipt-item">
      <div class="receipt-item-name">${esc(i.productName)}</div>
      <div class="receipt-item-line">
        <span>${esc(i.quantity)} x ${money(i.unitPrice)}</span>
        <span>${money(i.total)}</span>
      </div>
    </div>
  `).join('');

  els.receiptContent.innerHTML = `
    <div class="receipt-box">
      <h2>SALDAR SERVIÇOS</h2>
      <p class="receipt-slogan">Gestão simples, resultados reais.</p>
      <hr>
      <div class="receipt-meta">
  <div>Data: ${esc(date)}</div>
  <div>Operador: ${esc(sale.createdByName || 'Sistema')}</div>
  ${sale.clientName ? `<div>Cliente: ${esc(sale.clientName)}</div>` : ''}
  ${sale.clientId ? (() => {
    const c = (state.clients || []).find(x => x.id === sale.clientId);
    return c && c.nif ? `<div class="receipt-client-nif">NIF: ${esc(c.nif)}</div>` : '';
  })() : ''}
</div>
      <hr>
      ${itemsHtml}
      <hr>
      <div class="receipt-total-row">
        <span>TOTAL</span>
        <span>${money(grandTotal)}</span>
      </div>
      <div class="receipt-item-line" style="margin-top:4px;">
        <span>Método</span>
        <span>${esc(sale.paymentMethod)}</span>
      </div>
      <hr>
      <p class="receipt-footer">Obrigado pela preferência!</p>
      <p class="receipt-footer">©2026 Saldar Serviços</p>
    </div>
  `;

  // Configurar botão WhatsApp
  const waBtn = document.getElementById('sendWhatsAppBtn');
  if (waBtn) {
    const newBtn = waBtn.cloneNode(true);
    waBtn.parentNode.replaceChild(newBtn, waBtn);
    newBtn.addEventListener('click', () => {
      let text = `*SALDAR SERVIÇOS*\n`;
      text += `Gestão simples, resultados reais.\n\n`;
      text += `Data: ${date}\n`;
      text += `Operador: ${sale.createdByName || 'Sistema'}\n`;
      if (sale.note) text += `Cliente: ${sale.note}\n`;
      text += `-------------------\n`;
      items.forEach(i => {
        text += `${i.productName}\n`;
        text += `  ${i.quantity} x ${money(i.unitPrice)} = ${money(i.total)}\n`;
      });
      text += `-------------------\n`;
      text += `*TOTAL: ${money(grandTotal)}*\n`;
      text += `Método: ${sale.paymentMethod}\n`;
      text += `-------------------\n`;
      text += `Obrigado pela preferência!`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    });
  }

  els.receiptModal.classList.remove('hidden');
};

window.imprimir80mm = function() {
  if (!els.receiptModal || els.receiptModal.classList.contains('hidden')) {
    toast('Nenhum recibo aberto.');
    return;
  }
  window.print();
};

// =====================================================================
// FECHAR MODAL DE RECIBO (Patch 11)
// =====================================================================

els.receiptModal?.addEventListener('click', (e) => {
  // Fechar se clicar no X (qualquer elemento .close-modal)
  if (e.target.closest('.close-modal')) {
    els.receiptModal.classList.add('hidden');
    return;
  }
  // Fechar se clicar no fundo escuro
  if (e.target === els.receiptModal) {
    els.receiptModal.classList.add('hidden');
  }
});

// Tecla ESC (desktop)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.receiptModal && !els.receiptModal.classList.contains('hidden')) {
    els.receiptModal.classList.add('hidden');
  }
});

// =====================================================================
// MODAL DE ALERTAS DE STOCK BAIXO (Patch 12)
// =====================================================================

function openLowStockModal() {
  if (!els.lowStockModalList) return;

  const lows = state.products
    .filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0))
    .sort((a, b) => (Number(a.stock) - Number(a.minStock)) - (Number(b.stock) - Number(b.minStock)));

  if (lows.length === 0) {
    els.lowStockModalList.innerHTML = '<div class="item empty-state"><strong>Sem alertas</strong><span>Todos os produtos estão acima do mínimo.</span></div>';
  } else {
    els.lowStockModalList.innerHTML = lows.map((p) => {
      const stockDisplay = p.category === 'RL' ? money(p.stock) : p.stock + ' un.';
      const minDisplay = p.category === 'RL' ? money(p.minStock) : p.minStock + ' un.';
      return `
        <div class="item">
          <div class="stock-warning-item">
            <div style="flex:1;min-width:0;">
              <strong>${esc(p.name)}</strong>
              <small>${esc(p.category === 'RL' ? 'Recarga' : 'Cartão')} • Mín: ${esc(minDisplay)}</small>
            </div>
            <span class="stock-warning-badge">${esc(stockDisplay)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const modal = document.getElementById('lowStockModal');
  if (modal) modal.classList.remove('hidden');
}

// Delegação: clique em qualquer cartão com data-action
els.statsGrid?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action]');
  if (!card) return;
  const action = card.dataset.action;
  if (action === 'openLowStockModal') {
    openLowStockModal();
  }
});

// Fechar modal de alertas
document.getElementById('lowStockModal')?.addEventListener('click', (e) => {
  if (e.target.closest('.close-modal')) {
    e.target.closest('.modal').classList.add('hidden');
    return;
  }
  if (e.target.classList.contains('modal')) {
    e.target.classList.add('hidden');
  }
});

// ESC fecha o modal de alertas
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('lowStockModal');
    if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
  }
});

// =====================================================================
// PAINEL — Mini-cartões + sheet de detalhe
// =====================================================================

const PANEL_DETAILS = {
  products:   { title: '📦 Produtos cadastrados',
                render: () => els.productSummary?.innerHTML || '<div class="item empty-state">Sem produtos.</div>' },
  lowStock:   { title: '⚠️ Alertas de stock baixo',
                render: () => els.lowStockList?.innerHTML || '<div class="item empty-state">Sem alertas.</div>' },
  topSales:   { title: '🏆 Mais vendidos hoje',
                render: () => els.topSalesList?.innerHTML || '<div class="item empty-state">Sem vendas hoje.</div>' },
  payments:   { title: '💳 Pagamentos do dia',
                render: () => els.paymentSummary?.innerHTML || '<div class="item empty-state">Sem pagamentos hoje.</div>' },
  activity:   { title: '🕒 Atividade recente',
                render: () => els.recentActivity?.innerHTML || '<div class="item empty-state">Sem movimentações.</div>' },
  financeiro: { title: '💰 Dashboard financeiro',
                render: () => els.financeiroContent?.innerHTML || '<div class="item empty-state">Sem dados.</div>' }
};

function openPanelDetail(type) {
  const cfg = PANEL_DETAILS[type];
  if (!cfg || !els.panelDetailModal) return;

  try { renderDashboard(); } catch (e) { _origConsoleError('[openPanelDetail/renderDashboard]', e); }
  try { renderDashboardFinanceiro(); } catch (e) { _origConsoleError('[openPanelDetail/renderDashboardFinanceiro]', e); }

  if (els.panelDetailTitle) els.panelDetailTitle.textContent = cfg.title;
  if (els.panelDetailBody)  els.panelDetailBody.innerHTML = cfg.render();

  els.panelDetailModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePanelDetail() {
  if (!els.panelDetailModal) return;
  els.panelDetailModal.classList.add('hidden');
  document.body.style.overflow = '';
}

document.querySelectorAll('.panel-card').forEach((card) => {
  card.addEventListener('click', () => openPanelDetail(card.dataset.detail));
});

els.panelDetailClose?.addEventListener('click', closePanelDetail);

els.panelDetailModal?.addEventListener('click', (e) => {
  if (e.target === els.panelDetailModal) closePanelDetail();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.panelDetailModal && !els.panelDetailModal.classList.contains('hidden')) {
    closePanelDetail();
  }
});

// =====================================================================
// SHEET — Registar entrada de stock
// =====================================================================

function openStockEntrySheet() {
  if (!els.stockEntryModal) return;
  els.stockEntryModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // Sincronizar o select de produto
  if (typeof renderSelectOptions === 'function') {
    try { renderSelectOptions(); } catch (e) { _origConsoleError('[openStockEntrySheet]', e); }
  }
  setTimeout(() => els.stockProduct?.focus(), 200);
}

function closeStockEntrySheet() {
  if (!els.stockEntryModal) return;
  els.stockEntryModal.classList.add('hidden');
  document.body.style.overflow = '';
}

els.openStockEntryBtn?.addEventListener('click', openStockEntrySheet);
els.stockEntryClose?.addEventListener('click', closeStockEntrySheet);

els.stockEntryModal?.addEventListener('click', (e) => {
  if (e.target === els.stockEntryModal) closeStockEntrySheet();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.stockEntryModal && !els.stockEntryModal.classList.contains('hidden')) {
    closeStockEntrySheet();
  }
});

// =====================================================================
// COMISSÕES — Cálculo e render (Patch 21)
// =====================================================================

/**
 * Devolve as vendas filtradas pelo período escolhido.
 * range: 'today' | '7d' | '30d' | 'month'
 */
function getSalesInCommissionRange(range) {
  const all = (state.history || []).filter(h => h.type === 'venda');
  const nowD = new Date();
  const start = new Date(nowD);
  start.setHours(0, 0, 0, 0);

  if (range === 'today') {
    const iso = today();
    return all.filter(h => (h.date || '').slice(0, 10) === iso);
  }
  if (range === '7d') start.setDate(start.getDate() - 6);
  if (range === '30d') start.setDate(start.getDate() - 29);
  if (range === 'month') {
    start.setDate(1);
    start.setMonth(nowD.getMonth());
  }

  return all.filter(h => new Date(h.date) >= start);
}

/**
 * Calcula as comissões por operador.
 * Devolve { rows, totalSales, totalCommission, salesCount }
 */
function calcularComissoes(range) {
  const sales = getSalesInCommissionRange(range);
  const users = cloudMode() ? (session.cloudUsers || []) : (state.users || []);
  const map = {};

  sales.forEach(sale => {
    const opId = sale.createdById || 'sem-operador';
    const opName = sale.createdByName || 'Sem operador';

    if (!map[opId]) {
      // Procurar a comissão do operador
      const user = users.find(u => u.id === opId);
      const commissionPct = Number(user?.commission || 0);
      map[opId] = {
        operatorId: opId,
        operatorName: opName,
        commissionPct,
        salesCount: 0,
        totalSales: 0,
        commission: 0
      };
    }

    map[opId].salesCount += 1;
    map[opId].totalSales += Number(sale.total || 0);
    map[opId].commission += Number(sale.total || 0) * (map[opId].commissionPct / 100);
  });

  const rows = Object.values(map).sort((a, b) => b.commission - a.commission);
  const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const salesCount = rows.reduce((s, r) => s + r.salesCount, 0);

  return { rows, totalSales, totalCommission, salesCount };
}

function renderCommissions() {
  if (!els.commissionSummary || !els.commissionList) return;
  if (!can('relatorio')) {
    els.commissionSummary.innerHTML = '<div class="item empty-state">Sem permissão.</div>';
    els.commissionList.innerHTML = '';
    return;
  }

  const range = els.commissionRange?.value || 'month';
  const { rows, totalSales, totalCommission, salesCount } = calcularComissoes(range);

  const labelRange = range === 'today' ? 'Hoje'
    : range === '7d' ? 'Últimos 7 dias'
    : range === '30d' ? 'Últimos 30 dias'
    : 'Este mês';

  // ===== Resumo =====
  els.commissionSummary.innerHTML = `
    <div class="item"><strong>Período</strong><span>${esc(labelRange)}</span></div>
    <div class="item"><strong>Total de vendas</strong><span>${salesCount} ${salesCount === 1 ? 'venda' : 'vendas'}</span></div>
    <div class="item"><strong>Faturamento do período</strong><span>${money(totalSales)}</span></div>
    <div class="item" style="font-weight:700; border-top:2px solid var(--primary); padding-top:10px;">
      <strong>Total de comissões</strong><span>${money(totalCommission)}</span>
    </div>
  `;

  // ===== Lista por operador =====
  if (rows.length === 0) {
    els.commissionList.innerHTML = '<div class="item empty-state">Nenhuma venda no período.</div>';
    return;
  }

  els.commissionList.innerHTML = rows.map(r => `
    <div class="item">
      <div class="product-name-row">
        <strong>👤 ${esc(r.operatorName)}</strong>
        <span class="badge info">${r.commissionPct.toFixed(2)}%</span>
      </div>
      <span>${r.salesCount} ${r.salesCount === 1 ? 'venda' : 'vendas'} • ${money(r.totalSales)} em faturamento</span>
      <div class="meta-row" style="margin-top:6px;">
        <span class="badge" style="background:var(--primary); color:#fff;">Comissão: ${money(r.commission)}</span>
      </div>
    </div>
  `).join('');
}

// =====================================================================
// PWA install
// =====================================================================

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn?.classList.remove('hidden');
});

els.installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn?.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => _origConsoleError('[SW]', e));
}

// =====================================================================
// Init
// =====================================================================

(async function init() {
  _origConsoleError('[init] A iniciar Saldar Serviços v11...');
  _origConsoleError(`[init] Timeout de sessão: ${IDLE_TIMEOUT_MIN} min (aviso ${IDLE_WARNING_SEC}s)`);

  if (els.cloudEnabled) els.cloudEnabled.checked = settings.cloudEnabled;
  if (els.firebaseConfigInput) els.firebaseConfigInput.value = settings.firebaseConfig || '';
  if (els.adminEmailsInput) els.adminEmailsInput.value = settings.adminEmails || '';
  markMode();
  updateConnectivityBadge();
  switchAuthView('login');
  // Patch 18: data default no form de despesas
if (els.expenseDate && !els.expenseDate.value) {
  els.expenseDate.value = today();
}

  if (cloudMode()) {
    await initFirebase();
  } else {
    session.currentUser = state.users.find((u) => u.id === state.currentUserId) || null;
    showApp(Boolean(session.currentUser));
  }

  _origConsoleError('[init] Pronto. Usa window.__saldarDebug() para diagnóstico.');
})();