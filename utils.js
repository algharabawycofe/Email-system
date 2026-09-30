/* ═══════════════════════════════════════════════════════════
   Mail System v9.2 - Utilities & Helpers
   WhatsApp-style Notification Sound + Advanced Permissions
   ═══════════════════════════════════════════════════════════ */

import { auth, db, doc, getDoc, updateDoc, collection, getDocs, query, where, serverTimestamp } from './firebase.js';

/* ═══════════════════════════════════════════════════════
   GLOBAL STATE
   ═══════════════════════════════════════════════════════ */
export const state = {
  currentUser: null,
  allUsersCache: [],
  allDeptsCache: [],
  sidebarCollapsed: false,
  unsubMessages: null,
  unreadMessages: [],
  lastUnreadCount: 0,
  selectedThreadId: null,
  threadsCache: [],
  expandedMsgs: new Set(),
  currentFilter: 'inbox',
  searchQuery: '',
  settings: {
    darkMode: false,
    soundEnabled: true
  }
};

/* ═══════════════════════════════════════════════════════
   DOM HELPERS
   ═══════════════════════════════════════════════════════ */
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => document.querySelectorAll(s);

export const show = (el) => { if (el) el.classList.remove('hidden'); };
export const hide = (el) => { if (el) el.classList.add('hidden'); };

export const showStyle = (el, display = 'block') => { if (el) el.style.display = display; };
export const hideStyle = (el) => { if (el) el.style.display = 'none'; };

/* ═══════════════════════════════════════════════════════
   STRING HELPERS
   ═══════════════════════════════════════════════════════ */
export const esc = (s = '') => s.toString().replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

export const initials = (name = '') => {
  const n = (name || '').trim();
  if (!n) return '?';
  return n.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
};

export const truncate = (str, len = 60) => {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
};

/* ═══════════════════════════════════════════════════════
   DATE HELPERS
   ═══════════════════════════════════════════════════════ */
export const timeAgo = (ts) => {
  if (!ts || !ts.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} س`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} ي`;
  return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
};

export const formatDate = (ts) => {
  if (!ts || !ts.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleString('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

export const formatDateLong = (ts) => {
  if (!ts || !ts.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

export const todayArabic = () => {
  return new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
};

/* ═══════════════════════════════════════════════════════
   ROLE HELPERS
   ═══════════════════════════════════════════════════════ */
export const isOwner = () => state.currentUser?.role === 'owner';
export const isAdmin = () => state.currentUser?.role === 'admin' || isOwner();
export const isChairman = () => state.currentUser?.role === 'chairman';
export const isViceChairman = () => state.currentUser?.role === 'vice_chairman';
export const isExecutiveBoard = () => isChairman() || isViceChairman();

export const isDeptManager = () => {
  if (!state.currentUser) return false;
  return state.currentUser.role === 'manager' ||
    state.allDeptsCache.some(d => d.managerId === state.currentUser.uid);
};
export const isManagerOrAbove = () => isAdmin() || isDeptManager() || isExecutiveBoard();

export const roleLabels = {
  owner: 'صاحب الشركة',
  chairman: 'رئيس مجلس الإدارة',
  vice_chairman: 'نائب رئيس مجلس الإدارة',
  admin: 'مدير النظام',
  manager: 'مدير قسم',
  user: 'مستخدم'
};

export const roleColors = {
  owner: 'bg-amber-100 text-amber-800',
  chairman: 'bg-yellow-100 text-yellow-800',
  vice_chairman: 'bg-lime-100 text-lime-800',
  admin: 'bg-red-50 text-red-700',
  manager: 'bg-purple-50 text-purple-700',
  user: 'bg-slate-100 text-slate-700'
};

/* ═══════════════════════════════════════════════════════
   ICONS
   ═══════════════════════════════════════════════════════ */
let iconsScheduled = false;
export const icons = () => {
  if (!window.lucide || !window.lucide.createIcons) return;
  if (iconsScheduled) return;
  iconsScheduled = true;
  requestAnimationFrame(() => {
    iconsScheduled = false;
    try { window.lucide.createIcons(); } catch (e) {}
  });
};

/* ═══════════════════════════════════════════════════════
   THEME
   ═══════════════════════════════════════════════════════ */
export function applyTheme(dark) {
  state.settings.darkMode = dark;
  if (dark) document.body.classList.add('dark');
  else document.body.classList.remove('dark');
  try { localStorage.setItem('darkMode', dark ? '1' : '0'); } catch (e) {}
}

export function loadTheme() {
  try {
    const saved = localStorage.getItem('darkMode');
    if (saved === '1') {
      state.settings.darkMode = true;
      document.body.classList.add('dark');
    }
  } catch (e) {}
}

export function toggleDarkMode() {
  const isDark = !state.settings.darkMode;
  applyTheme(isDark);
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = isDark;
  return isDark;
}

/* ═══════════════════════════════════════════════════════
   SOUND - WhatsApp-style Notification
   ═══════════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { audioCtx = new Ctx(); } catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function playNotifSound() {
  if (!state.settings.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, now,        1318.51, 0.10, 0.18);
    playTone(ctx, now + 0.09, 1108.73, 0.22, 0.20);
    playTone(ctx, now + 0.13, 1108.73, 0.18, 0.10);
  } catch (e) { console.warn('Sound error:', e); }
}

function playTone(ctx, startTime, freq, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.setValueAtTime(volume, startTime + duration * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

export function toggleSound() {
  state.settings.soundEnabled = !state.settings.soundEnabled;
  try { localStorage.setItem('soundEnabled', state.settings.soundEnabled ? '1' : '0'); } catch (e) {}
  const toggle = document.getElementById('soundToggle');
  if (toggle) toggle.checked = state.settings.soundEnabled;
  return state.settings.soundEnabled;
}

export function loadSoundSetting() {
  try {
    const saved = localStorage.getItem('soundEnabled');
    state.settings.soundEnabled = saved !== '0';
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════
   CONFIRM MODAL
   ═══════════════════════════════════════════════════════ */
export function confirmDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYes');
    const noBtn = document.getElementById('confirmNo');

    titleEl.textContent = title || 'تأكيد';
    msgEl.textContent = message || 'هل أنت متأكد؟';
    show(modal);
    icons();

    const cleanup = () => {
      hide(modal);
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
    };
    const onYes = () => { cleanup(); resolve(true); };
    const onNo = () => { cleanup(); resolve(false); };
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

/* ═══════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════ */
export function showToast(title, body, onClick, playSound = true) {
  if (playSound) playNotifSound();
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon"><i data-lucide="mail" class="w-4 h-4"></i></div>
    <div class="toast-content">
      <div class="toast-title">${esc(title)}</div>
      ${body ? `<div class="toast-body">${esc(body)}</div>` : ''}
    </div>
    <button class="toast-close"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
  `;
  toast.querySelector('.toast-close').onclick = (e) => { e.stopPropagation(); toast.remove(); };
  if (onClick) toast.onclick = () => { onClick(); toast.remove(); };
  container.appendChild(toast);
  icons();
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 6000);
}

/* ═══════════════════════════════════════════════════════
   CACHE LOADERS
   ═══════════════════════════════════════════════════════ */
export async function loadUsersCache() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    state.allUsersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return state.allUsersCache;
  } catch (e) {
    console.error('loadUsersCache error:', e);
    return [];
  }
}

export async function loadDepartmentsCache() {
  try {
    const snap = await getDocs(collection(db, 'departments'));
    state.allDeptsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return state.allDeptsCache;
  } catch (e) {
    console.error('loadDepartmentsCache error:', e);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════
   USER LOOKUP
   ═══════════════════════════════════════════════════════ */
export function getUserById(uid) {
  return state.allUsersCache.find(u => u.id === uid);
}

export function getUserName(uid) {
  const u = getUserById(uid);
  return u ? u.name : 'مستخدم';
}

export function getUserByUsername(username) {
  return state.allUsersCache.find(u => u.username === username);
}

export function getUsersByDept(deptId) {
  return state.allUsersCache.filter(u => u.departmentId === deptId && u.isActive !== false);
}

export function getDeptById(id) {
  return state.allDeptsCache.find(d => d.id === id);
}

/* ═══════════════════════════════════════════════════════
   DEPT MANAGER HELPERS
   ═══════════════════════════════════════════════════════ */
export function getMyManagedDepts() {
  if (!state.currentUser) return [];
  return state.allDeptsCache.filter(d => d.managerId === state.currentUser.uid);
}

export function isManagerOfDept(deptId) {
  if (!state.currentUser) return false;
  if (isOwner()) return true;
  const dept = getDeptById(deptId);
  return dept && dept.managerId === state.currentUser.uid;
}

export function getMyTeamMembers() {
  if (!state.currentUser) return [];
  if (isAdmin()) return state.allUsersCache.filter(u => u.isActive !== false && u.id !== state.currentUser.uid);
  const myDepts = getMyManagedDepts();
  if (myDepts.length === 0) return [];
  const myDeptIds = myDepts.map(d => d.id);
  return state.allUsersCache.filter(u =>
    myDeptIds.includes(u.departmentId) &&
    u.isActive !== false &&
    u.id !== state.currentUser.uid
  );
}

/* ═══════════════════════════════════════════════════════
   SESSION
   ═══════════════════════════════════════════════════════ */
export function saveSession(user) {
  try {
    localStorage.setItem('lastUser', user.username || '');
    localStorage.setItem('lastEmail', user.email || '');
  } catch (e) {}
}

export function loadLastUser() {
  try { return localStorage.getItem('lastUser') || ''; } catch (e) { return ''; }
}

/* ═══════════════════════════════════════════════════════
   COPY TO CLIPBOARD
   ═══════════════════════════════════════════════════════ */
export async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { return false; }
}

/* ═══════════════════════════════════════════════════════
   SEARCH
   ═══════════════════════════════════════════════════════ */
export function matchesSearch(msg, queryStr) {
  if (!queryStr) return true;
  const q = queryStr.toLowerCase().trim();
  if (!q) return true;
  return (
    (msg.subject || '').toLowerCase().includes(q) ||
    (msg.body || '').toLowerCase().includes(q) ||
    (msg.fromUserName || '').toLowerCase().includes(q) ||
    (msg.toUserName || '').toLowerCase().includes(q)
  );
}

/* ═══════════════════════════════════════════════════════
   SANITIZE
   ═══════════════════════════════════════════════════════ */
export function sanitizeUsername(username) {
  return username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
}

export function validateUsername(username) {
  return /^[a-z0-9_.]+$/.test(username) && username.length >= 3 && username.length <= 30;
}

export function validatePassword(password) {
  return password && password.length >= 6;
}

/* ═══════════════════════════════════════════════════════
   AVATAR COLORS
   ═══════════════════════════════════════════════════════ */
const AVATAR_COLORS = [
  'from-blue-500 to-blue-700',
  'from-green-500 to-green-700',
  'from-purple-500 to-purple-700',
  'from-pink-500 to-pink-700',
  'from-orange-500 to-orange-700',
  'from-teal-500 to-teal-700',
  'from-red-500 to-red-700',
  'from-indigo-500 to-indigo-700'
];

export function getAvatarColor(name) {
  let hash = 0;
  const str = name || '?';
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* ═══════════════════════════════════════════════════════
   UNLOCK AUDIO (First interaction)
   ═══════════════════════════════════════════════════════ */
export function unlockAudioOnFirstClick() {
  const unlock = () => {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
      }
    } catch (e) {}
    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('click', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

/* ═══════════════════════════════════════════════════════
   ⭐ PERMISSIONS — مين يبعت لمين (NEW v9.2)
   ═══════════════════════════════════════════════════════ */

/**
 * هل المُرسل الحالي يقدر يبعت للمستقبل ده؟
 * @param {Object} recipient — كائن المستخدم المستقبل (فيه id و role و departmentId)
 * @returns {boolean}
 */
export function canSendTo(recipient) {
  const sender = state.currentUser;
  if (!sender || !recipient) return false;
  if (sender.uid === recipient.id) return false;

  const sRole = sender.role;
  const rRole = recipient.role;

  // 👑 Owner → أي حد
  if (sRole === 'owner') return true;

  // 🛡️ Admin → أي حد
  if (sRole === 'admin') return true;

  // 🎩 Chairman / Vice Chairman → owner + admin + managers + بعضهم
  if (sRole === 'chairman' || sRole === 'vice_chairman') {
    return ['owner', 'admin', 'manager', 'chairman', 'vice_chairman'].includes(rRole);
  }

  // 👔 Manager (or user assigned as dept manager) → أي حد
  const isDeptMgr = sRole === 'manager' ||
    state.allDeptsCache.some(d => d.managerId === sender.uid);
  if (isDeptMgr) return true;

  // 👤 User العادي
  if (sRole === 'user') {
    // 1) owner + admin
    if (rRole === 'owner' || rRole === 'admin') return true;

    // 2) مدير قسمه
    if (rRole === 'manager') {
      const myDept = state.allDeptsCache.find(d => d.id === sender.departmentId);
      return !!(myDept && myDept.managerId === recipient.id);
    }

    // 3) أعضاء قسمه فقط
    if (rRole === 'user') {
      return !!sender.departmentId && sender.departmentId === recipient.departmentId;
    }

    // ❌ ممنوع: chairman / vice_chairman
    return false;
  }

  return false;
}

/**
 * كل المستخدمين اللي المُرسل الحالي يقدر يبعتلهم
 */
export function getAllowedRecipients() {
  if (!state.currentUser) return [];
  return state.allUsersCache.filter(u =>
    u.id !== state.currentUser.uid &&
    u.isActive !== false &&
    canSendTo(u)
  );
}

console.log('🛠️ Utils v9.2 loaded - Roles + Permissions + WhatsApp Sound 🔔');
