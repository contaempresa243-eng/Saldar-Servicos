// =====================================================================
// SALDAR SERVIÇOS — app.js (v6 + patches 1–6 + diagnóstico login)
// =====================================================================

const LOCAL_KEY = 'saldar-servicos-v5-local';
const SETTINGS_KEY = 'saldar-servicos-v5-settings';
const LEGACY_KEYS = ['saldar-servicos-v4-local', 'saldar-servicos-v3-local', 'saldar-servicos-v2', 'saldar-servicos-v1'];
const LEGACY_SETTING_KEYS = ['saldar-servicos-v4-settings', 'saldar-servicos-v3-settings'];

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const money = (v) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'AOA', maximumFractionDigits: 2 }).format(Number(v || 0));

// ---------- Utilitários de segurança ----------

const uid = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

async function hashPassword(pass) {
  const data = new TextEncoder().encode('saldar-salt-v6::' + String(pass));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const isHash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);

// =====================================================================
// Estado inicial
// =====================================================================

function defaults() {
  return {
    products: [
      { id: uid(), name: 'Afrimoney', category: 'RL', stock: 0, minStock: 0, price: 0 },
      { id: uid(), name: 'Unitel Money', category: 'RL', stock: 0, minStock: 0, price: 0 },
      { id: uid(), name: 'Unitel mSeller', category: 'RL', stock: 0, minStock: 0, price: 0 },
      { id: uid(), name: 'ZAP', category: 'RL', stock: 0, minStock: 0, price: 0 },
      { id: uid(), name: 'DStv', category: 'RL', stock: 0, minStock: 0, price: 0 },
      { id: uid(), name: 'Africel 1000', category: 'CF', stock: 0, minStock: 0, price: 1000 },
      { id: uid(), name: 'Africel 500', category: 'CF', stock: 0, minStock: 0, price: 500 },
      { id: uid(), name: 'Africel 200', category: 'CF', stock: 0, minStock: 0, price: 200 },
      { id: uid(), name: 'Unitel 1000', category: 'CF', stock: 0, minStock: 0, price: 1000 },
      { id: uid(), name: 'Unitel 500', category: 'CF', stock: 0, minStock: 0, price: 500 },
      { id: uid(), name: 'Unitel 200', category: 'CF', stock: 0, minStock: 0, price: 200 }
    ],
    history: [],
    cashMovements: [],
    users: [
      { id: uid(), fullName: 'Administrador Geral', username: 'admin', password: 'admin123', role: 'admin', active: true, createdAt: now() },
      { id: uid(), fullName: 'Operador de Balcão', username: 'operador', password: '1234', role: 'operador', active: true, createdAt: now() }
    ],
    currentUserId: null
  };
}

function normalize(raw) {
  const base = defaults();
  return {
    products: Array.isArray(raw?.products) && raw.products.length ? raw.products : base.products,
    history: Array.isArray(raw?.history) ? raw.history : [],
    cashMovements: Array.isArray(raw?.cashMovements) ? raw.cashMovements : [],
    users: Array.isArray(raw?.users) && raw.users.length ? raw.users : base.users,
    currentUserId: raw?.currentUserId || null
  };
}

function loadLocal() {
  const current = localStorage.getItem(LOCAL_KEY);
  if (current) {
    try {
      return normalize(JSON.parse(current));
    } catch {
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
    } catch {
      continue;
    }
  }
  const fresh = defaults();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(fresh));
  return fresh;
}

function loadSettings() {
  const current = localStorage.getItem(SETTINGS_KEY);
  if (current) {
    try {
      return JSON.parse(current) || { cloudEnabled: false, firebaseConfig: '', adminEmails: '' };
    } catch {
      return { cloudEnabled: false, firebaseConfig: '', adminEmails: '' };
    }
  }
  for (const key of LEGACY_SETTING_KEYS) {
    const legacy = localStorage.getItem(key);
    if (!legacy) continue;
    try {
      const migrated = JSON.parse(legacy) || { cloudEnabled: false, firebaseConfig: '' };
      migrated.adminEmails = migrated.adminEmails || '';
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      continue;
    }
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
  lastAuthError: null  // <-- DIAGNÓSTICO
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
    backup: true, nuvem: true
  },
  operador: {
    admin: false, dashboard: true, verFinanceiro: false, verSaldoCaixa: false,
    produtos: false, stock: false, venda: true, vendaDesconto: false, caixa: false,
    historico: true, historicoTodos: false, relatorio: false, usuarios: false,
    backup: false, nuvem: true
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
    if (input.type === 'password') {
      input.type = 'text';
      iconElement.textContent = '🙈';
    } else {
      input.type = 'password';
      iconElement.textContent = '👁️';
    }
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
  historyList: document.getElementById('historyList'),
  historyFilter: document.getElementById('historyFilter'),
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
  receiptModal: document.getElementById('receiptModal'),
  receiptContent: document.getElementById('receiptContent'),
  closeModal: document.querySelector('.close-modal'),
  forgotPasswordLink: document.getElementById('forgotPasswordLink'),
  resendVerifyLink: document.getElementById('resendVerifyLink')
};

function toast(message, duration = 4000) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => els.toast.classList.add('hidden'), duration);
}

// =====================================================================
// Diagnóstico (útil enquanto resolvemos o login)
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
    lastAuthError: session.lastAuthError,
    configValid: !!cfg,
    configKeys: cfg ? Object.keys(cfg) : [],
    missingKeys: cfg ? ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId']
      .filter(k => !cfg[k]) : ['TODAS (JSON inválido)'],
    projectId: cfg?.projectId || null,
    settingsRaw: settings.firebaseConfig?.slice(0, 80) + '...'
  };
  console.table(info);
  return info;
};

// =====================================================================
// Firebase config
// =====================================================================

function parseFirebaseConfig() {
  try {
    const parsed = JSON.parse(settings.firebaseConfig || '{}');
    // Validação básica
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error('[parseFirebaseConfig] JSON inválido:', err, 'Conteúdo:', settings.firebaseConfig);
    return null;
  }
}

function cloudProjectName() {
  const cfg = parseFirebaseConfig();
  return cfg?.projectId || 'não configurado';
}

function markMode() {
  const online = cloudMode();
  els.modeBadge.textContent = online ? 'Modo online' : 'Modo local';
  els.cloudTopBadge.textContent = online ? 'Firebase' : 'Local';
  els.authHint.textContent = online ? 'Use email e palavra-passe para entrar no modo online.' : 'Use os acessos locais ou ative o modo online com Firebase.';
  els.localAccessBox.classList.toggle('hidden', online);
  els.cloudStatusText.textContent = online ? `Configuração online salva para o projeto ${cloudProjectName()}.` : 'Sem configuração online ativa.';
  els.forgotPasswordLink.classList.toggle('hidden', !online);
  els.resendVerifyLink.classList.toggle('hidden', !online);
}

function switchAuthView(view = 'login') {
  session.authView = view;
  const online = cloudMode();
  els.loginLabel.textContent = online ? 'Email' : 'Usuário';
  els.userLoginLabel.textContent = online ? 'Email (apenas online)' : 'Nome de usuário';
  els.userPassLabel.textContent = online ? 'Palavra-passe' : 'Palavra-passe';
  els.switchAuthModeBtn.classList.toggle('hidden', !online);

  if (!online) {
    els.fullNameWrap.classList.add('hidden');
    els.confirmWrap.classList.add('hidden');
    els.loginSubmitBtn.textContent = 'Entrar';
    els.switchAuthModeBtn.textContent = 'Criar conta online';
    els.userSubmitBtn.textContent = 'Criar usuário';
    els.forgotPasswordLink.classList.add('hidden');
    els.resendVerifyLink.classList.add('hidden');
    return;
  }

  const register = view === 'register';
  els.fullNameWrap.classList.toggle('hidden', !register);
  els.confirmWrap.classList.toggle('hidden', !register);
  els.loginSubmitBtn.textContent = register ? 'Criar conta online' : 'Entrar';
  els.switchAuthModeBtn.textContent = register ? 'Voltar ao login' : 'Criar conta online';
}

// =====================================================================
// Shell / Permissões aplicadas
// =====================================================================

function showApp(show) {
  els.authShell.classList.toggle('hidden', show);
  els.appShell.classList.toggle('hidden', !show);
  if (show) {
    const user = getCurrentUser();
    if (user) document.body.setAttribute('data-role', user.role);
    renderAll();
  } else {
    document.body.removeAttribute('data-role');
  }
}

function activate(tabId) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabId}"]`)?.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
}

function applyPermissions() {
  document.querySelectorAll('[data-role="admin"]').forEach((el) => {
    el.classList.toggle('hidden', !can('admin'));
  });
  document.querySelectorAll('[data-perm]').forEach((el) => {
    el.classList.toggle('hidden', !can(el.dataset.perm));
  });
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  if (activeTab && !can(activeTab)) activate('dashboard');
}

function requireAdmin() {
  if (!can('admin')) {
    toast('Apenas administradores podem usar esta área.');
    activate('dashboard');
    return false;
  }
  return true;
}

function require(feature, msg) {
  if (!can(feature)) {
    toast(msg || 'Sem permissão para esta ação.');
    return false;
  }
  return true;
}

// =====================================================================
// Renders
// =====================================================================

function renderUserHeader() {
  const current = getCurrentUser();
  els.currentUserName.textContent = current?.fullName || 'Sem sessão';
  els.currentUserRole.textContent = roleLabel(current?.role || 'operador');
}

function renderSelectOptions() {
  const options = state.products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  els.stockProduct.innerHTML = options;
  els.saleProduct.innerHTML = options;
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
  const totalUnits = state.products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  const lowCount = state.products.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)).length;
  const todayRevenue = getTodaySales().reduce((sum, item) => sum + Number(item.total || 0), 0);
  const activeUsers = (cloudMode() ? session.cloudUsers : state.users).filter((u) => u.active !== false).length || 1;
  const topProduct = topSalesToday()[0]?.[0] || 'Sem vendas hoje';

  const stats = [
    { label: 'Total em stock', value: totalUnits },
    { label: 'Alertas ativos', value: lowCount },
    { label: 'Vendas hoje', value: money(todayRevenue) },
    { label: 'Usuários ativos', value: activeUsers },
    { label: 'Mais vendido hoje', value: topProduct }
  ];

  if (can('verSaldoCaixa')) {
    stats.splice(3, 0, { label: 'Caixa acumulado', value: money(getCashBalance()) });
  }

  els.statsGrid.innerHTML = stats
    .map((s) => `<div class="stat"><small>${esc(s.label)}</small><strong>${esc(s.value)}</strong></div>`)
    .join('');
}

function renderDashboard() {
  els.productSummary.innerHTML = state.products.length
    ? state.products.map((p) => `<div class="item"><strong>${esc(p.name)}</strong><span>${esc(p.category)}</span><br /><span>${p.category === 'RL' ? money(p.stock) + ' (saldo)' : p.stock + ' un.'} • ${p.category === 'RL' ? 'Preço variável' : money(p.price)}</span></div>`).join('')
    : '<div class="item empty-state">Sem produtos cadastrados.</div>';

  const lows = state.products.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0));
  els.lowStockList.innerHTML = lows.length
    ? lows.map((p) => `<div class="item"><strong>${esc(p.name)}</strong><span class="badge low">Stock baixo: ${p.category === 'RL' ? money(p.stock) : p.stock}</span></div>`).join('')
    : '<div class="item"><strong>Sem alertas</strong><span>Todos os produtos estão acima do mínimo.</span></div>';

  const tops = topSalesToday();
  els.topSalesList.innerHTML = tops.length
    ? tops.map(([name, qty]) => `<div class="item"><strong>${esc(name)}</strong><span>${qty} ${qty === 1 ? 'unidade' : 'unidades'} vendidas hoje</span></div>`).join('')
    : '<div class="item"><strong>Sem vendas hoje</strong><span>Registre vendas para visualizar o ranking.</span></div>';

  const payments = paymentBreakdownToday();
  els.paymentSummary.innerHTML = payments.length
    ? payments.map(([method, total]) => `<div class="item"><strong>${esc(method)}</strong><span>${money(total)}</span></div>`).join('')
    : '<div class="item"><strong>Sem pagamentos hoje</strong><span>Nenhuma venda registrada.</span></div>';

  const activities = recentActivities();
  els.recentActivity.innerHTML = activities.length
    ? activities.map((item) => {
        if (item.group === 'venda') return `<div class="item"><strong>Venda • ${esc(item.productName)}</strong><span>${esc(item.quantity)} x ${money(item.unitPrice)} = ${money(item.total)}</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span></div>`;
        if (item.group === 'stock') return `<div class="item"><strong>Entrada de stock • ${esc(item.productName)}</strong><span>+${esc(item.quantity)} unidades</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span></div>`;
        return `<div class="item"><strong>Caixa • ${item.kind === 'entrada' ? 'Entrada' : 'Saída'}</strong><span>${money(item.amount)}</span><br /><span>${new Date(item.date).toLocaleString('pt-PT')}</span></div>`;
      }).join('')
    : '<div class="item"><strong>Sem movimentações</strong><span>As últimas ações do sistema aparecerão aqui.</span></div>';
}

function renderProductCards() {
  const term = els.productSearch.value.trim().toLowerCase();
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
  if (!can('historicoTodos') && user) {
    combined = combined.filter((item) => item.createdById === user.id);
  }
  combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  const filter = els.historyFilter.value;
  return combined.filter((item) => filter === 'todos' || item.group === filter);
}

function renderHistory() {
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
  if (!can('relatorio')) {
    els.dailyReport.innerHTML = '<div class="item empty-state"><strong>Sem permissão</strong><span>Apenas administradores podem ver relatórios.</span></div>';
    return;
  }

  const range = els.reportRange.value;
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
    <div class="item"><strong>Entradas de caixa manuais</strong><span>${money(cashIn)}</span></div>
    <div class="item"><strong>Saídas de caixa manuais</strong><span>${money(cashOut)}</span></div>
    ${top.length ? top.map(([name, count]) => `<div class="item"><strong>${esc(name)}</strong><span>${count} ${count === 1 ? 'unidade' : 'unidades'} no período</span></div>`).join('') : '<div class="item"><strong>Sem vendas</strong><span>Nenhuma venda encontrada no período selecionado.</span></div>'}
    ${payRows.length ? payRows.map(([name, total]) => `<div class="item"><strong>Pagamento: ${esc(name)}</strong><span>${money(total)}</span></div>`).join('') : ''}
  `;
}

function renderDashboardFinanceiro() {
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
}

function renderUsers() {
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

function renderCloudPanel() {
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
    ${online ? diag : ''}
  `;
}

function renderAll() {
  renderUserHeader();
  applyPermissions();
  renderSelectOptions();
  renderStats();
  renderDashboard();
  renderProductCards();
  renderStock();
  renderHistory();
  renderCash();
  renderReport();
  renderUsers();
  renderCloudPanel();
  renderDashboardFinanceiro();
}

// =====================================================================
// Forms — sincronização
// =====================================================================

function syncPrice() {
  const product = byId(els.saleProduct.value);
  if (product) els.salePrice.value = product.price;
}

function syncMin() {
  const product = byId(els.stockProduct.value);
  if (product) els.stockMin.value = product.minStock;
}

function updateSaleHint() {
  const product = byId(els.saleProduct.value);
  if (!product) {
    els.saleStockHint.textContent = 'Selecione um produto para ver stock e preço.';
    return;
  }
  const stockDisplay = product.category === 'RL' ? money(product.stock) : product.stock + ' un.';
  els.saleStockHint.textContent = `Stock atual: ${stockDisplay} • ${product.category === 'RL' ? 'Preço variável (defina abaixo)' : 'Preço padrão: ' + money(product.price)}`;
}

function resetProductForm() {
  els.productForm.reset();
  els.productEditId.value = '';
  els.productFormMode.textContent = 'Novo produto';
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
    console.warn('Alteração guardada localmente. Sincronização com a nuvem falhou.', error);
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
    const adminEmails = String(settings.adminEmails || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (adminEmails.length === 0) {
      console.warn('[SEGURANÇA] Nenhuma whitelist de admins. O primeiro registo será admin.');
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
    role,
    active: true,
    createdAt: now()
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
// Firebase init (com diagnóstico detalhado)
// =====================================================================

async function initFirebase() {
  console.log('[initFirebase] Início. cloudMode:', cloudMode());

  if (!cloudMode()) {
    console.log('[initFirebase] cloudMode() = false. A ignorar.');
    return;
  }

  const cfg = parseFirebaseConfig();
  console.log('[initFirebase] Config parseada:', cfg);

  if (!cfg) {
    session.lastAuthError = { code: 'config/parse-error', message: 'JSON do Firebase inválido.' };
    toast('JSON do Firebase inválido. Verifica a configuração.');
    return;
  }

  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    const faltam = ['apiKey', 'projectId', 'appId'].filter(k => !cfg[k]);
    session.lastAuthError = { code: 'config/missing-keys', message: 'Faltam: ' + faltam.join(', ') };
    toast(`Configuração Firebase incompleta: falta ${faltam.join(', ')}.`);
    console.error('[initFirebase] Faltam chaves:', faltam, 'Config recebida:', cfg);
    return;
  }

  try {
    console.log('[initFirebase] A importar módulos do Firebase...');
    const appModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const firestoreModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    console.log('[initFirebase] Módulos importados.');

    const { initializeApp, getApps } = appModule;
    const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification } = authModule;
    const { getFirestore, doc, setDoc, getDoc, collection, getDocs, enableIndexedDbPersistence, deleteDoc } = firestoreModule;

    session.api = { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification, doc, setDoc, getDoc, collection, getDocs, deleteDoc };

    const existing = getApps().find((app) => app.name === 'saldar-servicos-v5');
    session.app = existing || initializeApp(cfg, 'saldar-servicos-v5');
    session.auth = getAuth(session.app);
    session.db = getFirestore(session.app);
    console.log('[initFirebase] App/Auth/Firestore criados.');

    try {
      await enableIndexedDbPersistence(session.db);
      console.log('[initFirebase] Persistência offline ativada.');
    } catch (err) {
      if (err.code === 'failed-precondition') console.warn('[initFirebase] Persistência falhou: múltiplas abas.');
      else if (err.code === 'unimplemented') console.warn('[initFirebase] Persistência não suportada.');
      else console.warn('[initFirebase] Persistência erro:', err);
    }

    session.fbReady = true;

    if (typeof session.unsubAuth === 'function') session.unsubAuth();
    session.unsubAuth = onAuthStateChanged(session.auth, async (user) => {
      console.log('[onAuthStateChanged] User:', user ? user.email : '(null)');

      if (!user) {
        session.currentUser = null;
        session.cloudUsers = [];
        showApp(false);
        return;
      }

      session.lastAuthError = null;

      if (user.email && user.emailVerified === false && user.providerData?.[0]?.providerId === 'password') {
        const ageMs = Date.now() - new Date(user.metadata.creationTime).getTime();
        const isFresh = ageMs < 60 * 1000;
        if (!isFresh) {
          toast('Confirme o seu email antes de entrar. Verifique a caixa de entrada.');
          try { await session.api.signOut(session.auth); } catch {}
          session.currentUser = null;
          showApp(false);
          return;
        }
      }

      try {
        session.currentUser = await ensureCloudProfile(user);
        await fetchCloudUsers();
        await loadCloudState();
        showApp(true);
        toast(`Sessão online iniciada para ${session.currentUser.fullName}.`);
        session.pendingName = '';
      } catch (err) {
        console.error('[onAuthStateChanged] Erro ao carregar perfil/dados:', err);
        session.lastAuthError = { code: err.code || 'profile/error', message: err.message || String(err) };
        toast('Erro ao carregar perfil: ' + (err.message || err.code || 'desconhecido'));
      }
    });

    console.log('[initFirebase] Concluído com sucesso.');
  } catch (error) {
    console.error('[initFirebase] Falha fatal:', error);
    session.lastAuthError = { code: error.code || 'init/error', message: error.message || String(error) };
    toast('Falha ao iniciar Firebase: ' + (error.message || error.code || 'erro desconhecido'));
  }
}

// =====================================================================
// Logout
// =====================================================================

async function logout() {
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
// Backup
// =====================================================================

function downloadBackup() {
  const safeUsers = state.users.map(({ password, ...rest }) => rest);
  const payload = {
    version: 6,
    exportedAt: now(),
    data: {
      products: state.products,
      history: state.history,
      cashMovements: state.cashMovements,
      users: safeUsers
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
  try {
    parsed = JSON.parse(text);
  } catch {
    return toast('Arquivo JSON inválido.');
  }
  const source = parsed.data || parsed;

  state = normalize({
    products: source.products,
    history: source.history,
    cashMovements: source.cashMovements,
    users: source.users,
    currentUserId: state.currentUserId
  });

  state.users = state.users.map((u) => ({ ...u, password: u.password || '' }));

  saveLocal();
  await saveState();
  renderAll();
  toast('Backup importado com sucesso.');
}

// =====================================================================
// Eventos — Config cloud
// =====================================================================

els.saveCloudConfigBtn.addEventListener('click', async () => {
  settings.cloudEnabled = els.cloudEnabled.checked;
  settings.firebaseConfig = els.firebaseConfigInput.value.trim();
  settings.adminEmails = (els.adminEmailsInput?.value || '').trim();
  saveSettings();
  markMode();
  switchAuthView('login');

  if (cloudMode()) {
    await initFirebase();
    showApp(false);
    if (session.fbReady) {
      toast('Modo online configurado. Faça login com email.');
    } else {
      toast('Configuração salva, mas Firebase não inicializou. Vê a consola.', 6000);
    }
  } else {
    session.currentUser = state.users.find((u) => u.id === state.currentUserId) || null;
    showApp(Boolean(session.currentUser));
    toast('Modo local ativado.');
  }
});

els.switchAuthModeBtn.addEventListener('click', () => {
  switchAuthView(session.authView === 'login' ? 'register' : 'login');
});

// =====================================================================
// Login (com mensagens de erro detalhadas)
// =====================================================================

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = els.loginUsername.value.trim();
  const pass = els.loginPassword.value.trim();

  els.loginSubmitBtn.textContent = 'Aguarde...';
  els.loginSubmitBtn.disabled = true;

  // ---------- MODO ONLINE ----------
  if (cloudMode()) {
    // Diagnóstico: se o Firebase não estiver pronto, mostra o motivo exato
    if (!session.api || !session.auth) {
      const cfg = parseFirebaseConfig();
      let motivo = 'desconhecido';

      if (!cfg) motivo = 'JSON do Firebase inválido (não faz parse)';
      else if (!cfg.apiKey) motivo = 'falta "apiKey" no JSON';
      else if (!cfg.projectId) motivo = 'falta "projectId" no JSON';
      else if (!cfg.appId) motivo = 'falta "appId" no JSON';
      else if (!session.fbReady) motivo = 'initFirebase não concluiu (ver consola)';
      else motivo = 'api/auth ausente após init';

      console.error('[Login] Firebase não pronto. Motivo:', motivo);
      console.error('[Login] session.api:', session.api, 'auth:', session.auth, 'fbReady:', session.fbReady);
      console.error('[Login] Config parseada:', cfg);
      console.error('[Login] Config raw:', settings.firebaseConfig);

      toast(`Falha: ${motivo}. Abre a consola (F12) para ver detalhes.`, 8000);
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
          console.warn('Erro ao enviar verificação:', verifyErr);
          toast('Conta criada, mas não foi possível enviar o e-mail de verificação.');
        }
      } else {
        await session.api.signInWithEmailAndPassword(session.auth, login, pass);
      }
      e.target.reset();
      switchAuthView('login');
    } catch (error) {
      console.error('[Login] Erro completo:', error);
      session.lastAuthError = { code: error?.code || 'unknown', message: error?.message || String(error) };

      const mensagens = {
        'auth/invalid-api-key': 'API Key inválida. Verifica o JSON do Firebase.',
        'auth/api-key-not-valid': 'API Key inválida. Verifica o JSON do Firebase.',
        'auth/invalid-email': 'Formato de e-mail inválido.',
        'auth/user-disabled': 'Esta conta foi desativada.',
        'auth/user-not-found': 'Utilizador não encontrado. Verifica o e-mail.',
        'auth/wrong-password': 'Palavra-passe incorreta.',
        'auth/invalid-credential': 'E-mail ou palavra-passe incorretos.',
        'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
        'auth/weak-password': 'Palavra-passe demasiado fraca (mínimo 6 caracteres).',
        'auth/too-many-requests': 'Demasiadas tentativas. Tente novamente mais tarde.',
        'auth/network-request-failed': 'Sem ligação à internet. Verifica a rede.',
        'auth/operation-not-allowed': 'Login por email/senha não está ativo no Firebase Console.',
        'auth/configuration-not-found': 'Configuração do Firebase Auth incompleta. Verifica o Console.',
        'auth/unauthorized-domain': 'Domínio não autorizado no Firebase Auth. Adiciona-o em Authentication → Settings → Authorized domains.',
        'app/missing-name': 'Informe o nome completo.',
        'app/pass-mismatch': 'As palavras-passe não coincidem.',
        'app/invalid-email': 'Insira um e-mail válido.'
      };

      const msg = mensagens[error?.code] || error?.message || 'Falha no login online.';
      toast(msg, 6000);
    } finally {
      els.loginSubmitBtn.textContent = session.authView === 'register' ? 'Criar conta online' : 'Entrar';
      els.loginSubmitBtn.disabled = false;
    }
    return;
  }

  // ---------- MODO LOCAL ----------
  const candidate = state.users.find(
    (item) => item.username.toLowerCase() === login.toLowerCase() && item.active !== false
  );

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
});

// =====================================================================
// Reset password / verificação
// =====================================================================

els.forgotPasswordLink.addEventListener('click', async () => {
  const email = els.loginUsername.value.trim();
  if (!email) return toast('Por favor, insira o seu e-mail no campo acima.');
  try {
    await session.api.sendPasswordResetEmail(session.auth, email);
    toast('E-mail de redefinição de senha enviado com sucesso!');
  } catch (error) {
    console.error(error);
    toast('Erro ao enviar: ' + (error?.code || error?.message || 'desconhecido'));
  }
});

els.resendVerifyLink.addEventListener('click', async () => {
  const currentUser = session.auth.currentUser;
  if (!currentUser) return toast('Nenhum utilizador logado para reenviar verificação.');
  try {
    await session.api.sendEmailVerification(currentUser);
    toast('E-mail de verificação reenviado.');
  } catch (error) {
    console.error(error);
    toast('Erro ao reenviar: ' + (error?.code || error?.message || 'desconhecido'));
  }
});

els.logoutBtn.addEventListener('click', async () => {
  await logout();
  toast('Sessão terminada com sucesso.');
});

// =====================================================================
// Produtos
// =====================================================================

els.productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const payload = {
    name: els.productName.value.trim(),
    category: els.productCategory.value,
    stock: Number(els.productStock.value),
    minStock: Number(els.productMinStock.value),
    price: Number(els.productPrice.value)
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
    renderAll();
    resetProductForm();
    toast('Produto atualizado com sucesso.');
    return;
  }

  state.products.push({ id: uid(), ...payload });
  await saveState();
  renderAll();
  resetProductForm();
  toast('Produto criado com sucesso.');
});

els.cancelProductEditBtn.addEventListener('click', () => resetProductForm());
els.productSearch.addEventListener('input', renderProductCards);

els.productCards.addEventListener('mousedown', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  e.preventDefault();
  if (!requireAdmin()) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === 'edit-product') return fillProductForm(id);

  if (action === 'delete-product') {
    if (!confirm('Tem certeza que deseja remover este produto?')) return;
    const hasHistory = state.history.some((item) => item.productId === id);
    if (hasHistory) return toast('Não é possível remover produto com histórico.');
    state.products = state.products.filter((p) => p.id !== id);
    await saveState();
    renderAll();
    resetProductForm();
    toast('Produto removido com sucesso.');
  }
});

// =====================================================================
// Stock
// =====================================================================

document.getElementById('stockForm').addEventListener('submit', async (e) => {
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
    id: uid(),
    type: 'stock',
    productId: product.id,
    productName: product.name,
    quantity: qty,
    note: els.stockNote.value.trim(),
    createdById: user.id,
    createdByName: user.fullName,
    date: now()
  });

  await saveState();
  e.target.reset();
  syncMin();
  renderAll();
  toast('Entrada de stock registrada com sucesso.');
});

// =====================================================================
// Venda
// =====================================================================

document.getElementById('saleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const product = byId(els.saleProduct.value);
  const qty = Number(els.saleQty.value);
  const unitPrice = Number(els.salePrice.value);
  const user = getCurrentUser();

  if (!product || qty <= 0 || unitPrice < 0 || !user) return;

  if (product.category === 'CF' && !can('vendaDesconto') && unitPrice < product.price) {
    return toast(`Sem permissão para desconto. Preço mínimo: ${money(product.price)}.`);
  }

  const totalSale = qty * unitPrice;
  if (product.stock < totalSale) return toast(`Saldo insuficiente. Stock atual: ${money(product.stock)}.`);

  if (product.category === 'RL') product.stock -= totalSale;
  else product.stock -= qty;

  const saleId = uid();
  state.history.push({
    id: saleId,
    type: 'venda',
    productId: product.id,
    productName: product.name,
    quantity: qty,
    unitPrice,
    total: totalSale,
    paymentMethod: els.saleMethod.value,
    note: els.saleNote.value.trim(),
    createdById: user.id,
    createdByName: user.fullName,
    date: now()
  });

  await saveState();
  e.target.reset();
  syncPrice();
  updateSaleHint();
  renderAll();
  toast('Venda registrada com sucesso!');
});

// =====================================================================
// Caixa
// =====================================================================

document.getElementById('cashForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const amount = Number(els.cashAmount.value);
  const user = getCurrentUser();
  if (amount <= 0 || !user) return;

  state.cashMovements.push({
    id: uid(),
    kind: els.cashType.value,
    amount,
    note: els.cashNote.value.trim(),
    createdById: user.id,
    createdByName: user.fullName,
    date: now()
  });

  await saveState();
  e.target.reset();
  renderAll();
  toast('Movimento de caixa registrado.');
});

// =====================================================================
// Utilizadores
// =====================================================================

function resetUserForm() {
  els.userForm.reset();
  els.userEditId.value = '';
  els.userPassword.required = true;
  els.userSubmitBtn.textContent = cloudMode() ? 'Criar usuário online' : 'Criar usuário';
  els.cancelUserEditBtn.classList.add('hidden');
}

function fillUserForm(id) {
  const userSource = cloudMode() ? session.cloudUsers : state.users;
  const user = userSource.find(u => u.id === id);
  if (!user) return toast('Usuário não encontrado.');

  els.userEditId.value = user.id;
  els.userFullName.value = user.fullName;
  els.userUsername.value = cloudMode() ? user.email : user.username;
  els.userRole.value = user.role;
  els.userPassword.required = false;
  els.userPassword.value = '';
  els.userSubmitBtn.textContent = 'Atualizar usuário';
  els.cancelUserEditBtn.classList.remove('hidden');
  activate('usuarios');
}

els.userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireAdmin()) return;

  const editingId = els.userEditId.value;
  const fullName = els.userFullName.value.trim();
  const emailOrUsername = els.userUsername.value.trim();
  const role = els.userRole.value;
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

    if (cloudMode()) {
      user.email = emailOrUsername;
      try {
        const { doc, setDoc } = session.api;
        await setDoc(doc(session.db, 'users', user.id), user, { merge: true });
        await fetchCloudUsers();
        saveLocal();
      } catch {
        return toast('Erro ao atualizar usuário na nuvem.');
      }
    } else {
      user.username = emailOrUsername;
      if (password) user.password = await hashPassword(password);
      saveLocal();
    }

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
        fullName,
        email: emailOrUsername,
        role,
        active: true,
        createdAt: now()
      });

      await fetchCloudUsers();
      resetUserForm();
      renderAll();
      toast('Usuário criado com sucesso online!');
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') toast('Este e-mail já está cadastrado.');
      else toast('Erro ao criar usuário: ' + (err.code || err.message));
    }
  } else {
    const username = emailOrUsername.toLowerCase();
    if (state.users.some(u => u.username.toLowerCase() === username)) {
      return toast('Já existe um usuário com esse nome.');
    }

    state.users.push({
      id: uid(),
      fullName,
      username,
      password: await hashPassword(password),
      role,
      active: true,
      createdAt: now()
    });

    saveLocal();
    resetUserForm();
    renderAll();
    toast('Usuário criado com sucesso!');
  }
});

els.cancelUserEditBtn.addEventListener('click', resetUserForm);

els.userList.addEventListener('click', async (e) => {
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
    } else {
      saveLocal();
    }
    renderAll();
    toast(`Usuário ${user.active !== false ? 'ativado' : 'desativado'} com sucesso.`);
    return;
  }

  if (action === 'edit-user') return fillUserForm(id);

  if (action === 'delete-user') {
    if (!confirm('Tem certeza que deseja remover este usuário? Esta ação não pode ser desfeita.')) return;

    const current = getCurrentUser();
    if (current?.id === id) return toast('Não pode remover o seu próprio utilizador.');

    if (cloudMode()) {
      try {
        const { deleteDoc, doc } = session.api;
        await deleteDoc(doc(session.db, 'users', id));
        await fetchCloudUsers();
        saveLocal();
        renderAll();
        toast('Usuário removido da nuvem.');
      } catch { return toast('Erro ao remover da nuvem.'); }
    } else {
      state.users = state.users.filter(u => u.id !== id);
      saveLocal();
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
        toast('Email de recuperação de senha enviado para o utilizador.');
      } catch { toast('Erro ao enviar email. Verifique se o utilizador tem um email válido.'); }
    } else {
      const tempPass = prompt('Nova palavra-passe temporária para ' + user.fullName + ':', '1234');
      if (!tempPass) return;
      user.password = await hashPassword(tempPass);
      saveLocal();
      renderAll();
      toast('Palavra-passe local redefinida.');
    }
  }
});

// =====================================================================
// Backup
// =====================================================================

els.exportBackupBtn.addEventListener('click', () => {
  if (!requireAdmin()) return;
  downloadBackup();
  toast('Backup exportado com sucesso.');
});

els.importBackupBtn.addEventListener('click', async () => {
  if (!requireAdmin()) return;
  await importBackupFile(els.importBackupFile.files?.[0]);
});

// =====================================================================
// Eventos
// =====================================================================

els.saleProduct.addEventListener('change', () => {
  syncPrice();
  updateSaleHint();
});
els.stockProduct.addEventListener('change', syncMin);
els.historyFilter.addEventListener('change', renderHistory);
els.reportRange.addEventListener('change', renderReport);

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (!can(tab)) return toast('Área reservada ao administrador.');
    activate(tab);
  });
});

// =====================================================================
// PDF
// =====================================================================

els.exportPdfBtn.addEventListener('click', () => {
  if (!requireAdmin()) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const range = els.reportRange.value;
  const sales = salesForRange(range);
  const revenue = sales.reduce((s, item) => s + Number(item.total || 0), 0);
  const qty = sales.reduce((s, item) => s + Number(item.quantity || 0), 0);
  const label = range === 'today' ? 'Hoje' : range === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias';

  doc.setFontSize(18);
  doc.text('Saldar Serviços - Relatório', 14, 20);
  doc.setFontSize(12);
  doc.text(`Período: ${label}`, 14, 30);
  doc.text(`Data de emissão: ${new Date().toLocaleString('pt-PT')}`, 14, 37);
  doc.text(`Total de unidades vendidas: ${qty}`, 14, 44);
  doc.text(`Faturamento do período: ${money(revenue)}`, 14, 51);

  if (sales.length > 0) {
    const tableBody = sales.map(item => [
      item.productName, item.quantity, money(item.unitPrice), money(item.total),
      item.paymentMethod, new Date(item.date).toLocaleString('pt-PT')
    ]);
    doc.autoTable({
      startY: 58,
      head: [['Produto', 'Qtd', 'P. Unit.', 'Total', 'Método', 'Data']],
      body: tableBody,
      theme: 'striped',
      headStyles: { fillColor: '#0f766e' },
      styles: { fontSize: 9, cellPadding: 2 }
    });
  } else {
    doc.text('Nenhuma venda encontrada neste período.', 14, 58);
  }

  doc.save(`relatorio_${today()}.pdf`);
  toast('Relatório PDF exportado com sucesso!');
});

// =====================================================================
// Recibo
// =====================================================================

window.imprimirRecibo = function(saleId) {
  const sale = state.history.find(item => item.id === saleId);
  if (!sale) return toast('Recibo não encontrado.');

  const modal = els.receiptModal;
  const content = els.receiptContent;
  const date = new Date(sale.date).toLocaleString('pt-PT');

  content.innerHTML = `
    <div class="receipt-box">
      <h2>Saldar Serviços</h2>
      <p>${esc(date)}</p>
      <hr>
      <div class="receipt-row"><span>Produto:</span><span><strong>${esc(sale.productName)}</strong></span></div>
      <div class="receipt-row"><span>Qtd:</span><span>${esc(sale.quantity)}</span></div>
      <div class="receipt-row"><span>P. Unit.:</span><span>${money(sale.unitPrice)}</span></div>
      <hr>
      <div class="receipt-row" style="font-weight:700; font-size:14px;"><span>TOTAL:</span><span>${money(sale.total)}</span></div>
      <div class="receipt-row"><span>Método:</span><span>${esc(sale.paymentMethod)}</span></div>
      ${sale.note ? `<div class="receipt-row"><span>Obs:</span><span>${esc(sale.note)}</span></div>` : ''}
      <hr>
      <p style="font-size:10px;">Obrigado pela preferência!</p>
      <div style="display:flex; justify-content:center; gap:8px; margin-top:12px;">
        <button class="secondary-btn" style="padding: 6px 12px; font-size:12px; cursor:pointer;" onclick="window.print()">🖨️ Imprimir</button>
        <button class="primary" id="sendWhatsAppBtn" style="padding: 6px 12px; font-size:12px; cursor:pointer;">📱 WhatsApp</button>
      </div>
    </div>
  `;

  const waBtn = document.getElementById('sendWhatsAppBtn');
  waBtn.addEventListener('click', () => {
    const whatsappText = `
*Saldar Serviços*
Data: ${date}
-------------------
Produto: ${sale.productName}
Qtd: ${sale.quantity}
P. Unit.: ${money(sale.unitPrice)}
-------------------
*TOTAL: ${money(sale.total)}*
Método: ${sale.paymentMethod}
${sale.note ? `Obs: ${sale.note}` : ''}
-------------------
Obrigado pela preferência!
    `;
    const encodedText = encodeURIComponent(whatsappText);
    window.open(`https://wa.me/?text=${encodedText}`, '_blank');
  });

  modal.classList.remove('hidden');
};

els.closeModal.addEventListener('click', () => els.receiptModal.classList.add('hidden'));
els.receiptModal.addEventListener('click', (e) => {
  if (e.target === els.receiptModal) els.receiptModal.classList.add('hidden');
});

// =====================================================================
// PWA install
// =====================================================================

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.classList.remove('hidden');
});

els.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// =====================================================================
// Init
// =====================================================================

(async function init() {
  console.log('[init] A iniciar Saldar Serviços...');
  console.log('[init] settings carregadas:', settings);

  els.cloudEnabled.checked = settings.cloudEnabled;
  els.firebaseConfigInput.value = settings.firebaseConfig || '';
  if (els.adminEmailsInput) els.adminEmailsInput.value = settings.adminEmails || '';
  markMode();
  switchAuthView('login');

  if (cloudMode()) {
    console.log('[init] Modo online detetado. A inicializar Firebase...');
    await initFirebase();
    console.log('[init] Pós-initFirebase. fbReady:', session.fbReady);
  } else {
    console.log('[init] Modo local.');
    session.currentUser = state.users.find((u) => u.id === state.currentUserId) || null;
    showApp(Boolean(session.currentUser));
  }

  // Expor diagnóstico global
  window.__saldarDebug = window.__saldarDebug || function() {
    const cfg = parseFirebaseConfig();
    const info = {
      cloudMode: cloudMode(),
      fbReady: session.fbReady,
      hasApp: !!session.app,
      hasAuth: !!session.auth,
      hasDb: !!session.db,
      hasApi: !!session.api,
      lastAuthError: session.lastAuthError,
      configValid: !!cfg,
      configKeys: cfg ? Object.keys(cfg) : [],
      missingKeys: cfg ? ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'].filter(k => !cfg[k]) : ['TODAS (JSON inválido)'],
      projectId: cfg?.projectId || null
    };
    console.table(info);
    return info;
  };

  console.log('[init] Pronto. Digita window.__saldarDebug() na consola para diagnóstico.');
})();