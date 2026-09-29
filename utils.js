/* ═══════════════════════════════════════════════════════════
   Mail System v4.3 - Utilities & Helpers
   Soft Notification Sound (Mac/iPhone style)
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
export const isDeptManager = () => {
  if (!state.currentUser) return false;
  return state.currentUser.role === 'manager' ||
    state.allDeptsCache.some(d => d.managerId === state.currentUser.uid);
};
export const isManagerOrAbove = () => isAdmin() || isDeptManager();

export const roleLabels = {
  owner: 'صاحب الشركة',
  admin: 'مدير النظام',
  manager: 'مدير قسم',
  user: 'مستخدم'
};

export const roleColors = {
  owner: 'bg-amber-100 text-amber-800',
  admin: 'bg-red-50 text-red-700',
  manager: 'bg-purple-50 text-purple-700',
  user: 'bg-slate-100 text-slate-700'
};

/* ═══════════════════════════════════════════════════════
   ICONS
   ═══════════════════════════════════════════════════════ */
export const icons = () => {
  if (window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons();
  }
};

/* ═══════════════════════════════════════════════════════
   THEME (Dark Mode)
   ═══════════════════════════════════════════════════════ */
export function applyTheme(dark) {
  state.settings.darkMode = dark;
  if (dark) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  try {
    localStorage.setItem('darkMode', dark ? '1' : '0');
  } catch (e) {}
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
   SOUND - Soft Notification (Mac/iPhone style)
   Cross-platform: PC, Android, iOS
   ═══════════════════════════════════════════════════════ */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch (e) {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playNotifSound() {
  if (!state.settings.soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) {
      playAudioFallback();
      return;
    }

    const now = ctx.currentTime;

    // 🎵 نغمة ناعمة - Soft Chime (زي Mac/iPhone)
    // C5 (دافئة) → E5 (هادية)
playSoftTone(ctx, now, 523.25, 0.55, 0.09);      
playSoftTone(ctx, now + 0.10, 659.25, 0.65, 0.07); 
  } catch (e) {
    console.warn('Web Audio error:', e);
    playAudioFallback();
  }
}

function playSoftTone(ctx, startTime, freq, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  // sine = الصوت الأنعم والأهدى
  osc.type = 'sine';
  osc.frequency.value = freq;

  // Envelope ناعم جداً
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.03);
  gain.gain.setValueAtTime(volume, startTime + duration * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function playAudioFallback() {
  try {
    const audio = document.getElementById('notifSound');
    if (!audio) return;
    audio.currentTime = 0;
    audio.volume = 0.3;
    audio.play().catch(e => console.warn('Sound blocked:', e));
  } catch (e) {}
}

export function toggleSound() {
  state.settings.soundEnabled = !state.settings.soundEnabled;
  try {
    localStorage.setItem('soundEnabled', state.settings.soundEnabled ? '1' : '0');
  } catch (e) {}
  const toggle = document.getElementById('soundToggle');
  if (toggle) toggle.checked = state.settings.soundEnabled;
  return state.settings.soundEnabled;
}

export function loadSoundSetting() {
  try {
    const saved = localStorage.getItem('soundEnabled');
    if (saved === '0') state.settings.soundEnabled = false;
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
  toast.className = 'bg-white rounded shadow-2xl border-r-4 border-[#0078D4] p-3 min-w-[280px] max-w-sm cursor-pointer fade-in';
  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-9 h-9 rounded-full bg-[#e5f0fa] flex items-center justify-center flex-shrink-0">
        <i data-lucide="mail" class="w-4 h-4 text-[#0078D4]"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-bold text-xs text-slate-800 truncate">${esc(title)}</div>
        <div class="text-xs text-slate-600 mt-0.5 truncate">${esc(body)}</div>
      </div>
      <button class="p-1 hover:bg-slate-100 rounded flex-shrink-0">
        <i data-lucide="x" class="w-3.5 h-3.5 text-slate-400"></i>
      </button>
    </div>
  `;
  toast.querySelector('button').onclick = (e) => {
    e.stopPropagation();
    toast.remove();
  };
  if (onClick) {
    toast.onclick = () => {
      onClick();
      toast.remove();
    };
  }
  container.appendChild(toast);
  icons();
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 6000);
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
  try {
    return localStorage.getItem('lastUser') || '';
  } catch (e) {
    return '';
  }
}

/* ═══════════════════════════════════════════════════════
   COPY TO CLIPBOARD
   ═══════════════════════════════════════════════════════ */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
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
   SANITIZE INPUT
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
   INITIALS COLOR (Avatar gradient)
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
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
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

    const audio = document.getElementById('notifSound');
    if (audio) {
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
      }).catch(() => {});
    }

    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
  };

  document.addEventListener('click', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

console.log('🛠️ Utils v4.3 loaded - Soft Sound');
