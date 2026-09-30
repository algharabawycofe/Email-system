/* ═══════════════════════════════════════════════════════════
   Mail System v9.7 - Enterprise Application
   Features: Pro Compose + Permissions + GoFile Uploads
             Mobile Drawer + Drafts + Notifications
   ═══════════════════════════════════════════════════════════ */

import {
  auth, db, messaging,
  EMAIL_DOMAIN, VAPID_KEY, SW_PATH, APP_URL,
  createAuthUser, resetUserPassword,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  getToken, onMessage,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, onSnapshot, writeBatch
} from './firebase.js';

import {
  state, $, $$, show, hide, showStyle, hideStyle,
  esc, initials, truncate, timeAgo, formatDate, formatDateLong, todayArabic,
  isOwner, isAdmin, isDeptManager, isManagerOrAbove,
  isChairman, isViceChairman, isExecutiveBoard,
  canSendTo, getAllowedRecipients,
  DEFAULT_PERMISSIONS, PERMISSION_LABELS, isActualDeptManager,
  roleLabels, roleColors, icons,
  applyTheme, loadTheme, toggleDarkMode, loadSoundSetting, toggleSound, playNotifSound,
  confirmDialog, showToast,
  loadUsersCache, loadDepartmentsCache, getUserById, getUserName, getUsersByDept, getDeptById,
  getMyManagedDepts, isManagerOfDept, getMyTeamMembers,
  saveSession, loadLastUser, copyToClipboard,
  matchesSearch, sanitizeUsername, validateUsername, validatePassword,
  getAvatarColor, unlockAudioOnFirstClick
} from './utils.js';

/* ═══════ STATE ═══════ */
let deferredPrompt = null;
let pendingSendTimeout = null;
let lastSentData = null;
let attachedFiles = [];
let userTags = [];
let selectedTags = [];
let currentTagFilter = null;

let recipientChips = { to: [], cc: [], bcc: [] };
let activeChipField = 'to';
let activeSuggestionIdx = -1;
let currentSuggestions = [];

/* ═══════ ADMIN TEMPLATES ═══════ */
const ADMIN_MESSAGE_TEMPLATES = [
  { id: 'complaint', label: 'شكوى', icon: 'alert-triangle', body: 'أود التقدم بشكوى بخصوص:\n\n\n\n\nالتفاصيل:\n' },
  { id: 'inquiry', label: 'استفسار', icon: 'help-circle', body: 'أرجو الإفادة بخصوص:\n\n\n\n\nالتفاصيل:\n' }
];

/* ═══════ HELPERS ═══════ */
function getAvatarGradient(name) {
  let hash = 0;
  const str = name || '?';
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return 'gradient-' + ((Math.abs(hash) % 12) + 1);
}

function applyAvatar(el, name) {
  if (!el) return;
  el.className = el.className.replace(/gradient-\d+/g, '');
  el.classList.add(getAvatarGradient(name));
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getFileIcon(type = '', name = '') {
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.includes('word') || name.match(/\.(doc|docx)$/i)) return 'doc';
  if (type.includes('excel') || name.match(/\.(xls|xlsx|csv)$/i)) return 'sheet';
  if (type.includes('zip') || type.includes('rar')) return 'archive';
  return 'file';
}

function getFileIconLucide(type = '', name = '') {
  const cat = getFileIcon(type, name);
  if (cat === 'image') return 'image';
  if (cat === 'pdf') return 'file-text';
  if (cat === 'doc') return 'file-type';
  if (cat === 'sheet') return 'file-spreadsheet';
  if (cat === 'archive') return 'file-archive';
  return 'file';
}

function highlightText(text, query) {
  if (!query || !text) return esc(text);
  const safe = esc(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${q})`, 'gi');
  return safe.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function isHiddenFromMe(msg) {
  if (!msg || !state.currentUser) return false;
  if (isAdmin()) return false;
  const deletedBy = msg.deletedBy || {};
  return !!deletedBy[state.currentUser.uid];
}

function getDeletedByNames(msg) {
  if (!msg || !msg.deletedBy) return [];
  return Object.keys(msg.deletedBy).map(uid => {
    const u = state.allUsersCache.find(x => x.id === uid);
    return u ? u.name : 'مستخدم';
  });
}

function roleNeedsDept(role) {
  return role === 'user' || role === 'manager';
}

function showLoader() {
  const l = document.getElementById('globalLoader');
  if (l) l.classList.remove('hidden');
}
function hideLoader() {
  const l = document.getElementById('globalLoader');
  if (l) l.classList.add('hidden');
}

/* ═══════ SKELETONS ═══════ */
function renderSkeletonInbox() {
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `
      <div class="skeleton-msg">
        <div class="skeleton skeleton-avatar"></div>
        <div class="skeleton-lines">
          <div class="skeleton skeleton-line medium"></div>
          <div class="skeleton skeleton-line long"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>
    `;
  }
  return html;
}

function renderSkeletonTable() {
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `<tr>
      <td><div class="skeleton skeleton-line long"></div></td>
      <td><div class="skeleton skeleton-line medium"></div></td>
      <td><div class="skeleton skeleton-line short"></div></td>
      <td><div class="skeleton skeleton-line short"></div></td>
      <td><div class="skeleton skeleton-line short"></div></td>
      <td><div class="skeleton skeleton-line short"></div></td>
    </tr>`;
  }
  return html;
}

/* ═══════ ADVANCED TOAST ═══════ */
function showToastAdvanced(title, body, options = {}) {
  const {
    type = 'info', icon = 'mail', actionLabel = null,
    onAction = null, duration = 5000, onClick = null
  } = options;

  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const iconClass = type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : '';

  toast.innerHTML = `
    <div class="toast-icon ${iconClass}"><i data-lucide="${icon}" class="w-4 h-4"></i></div>
    <div class="toast-content">
      <div class="toast-title">${esc(title)}</div>
      ${body ? `<div class="toast-body">${esc(body)}</div>` : ''}
    </div>
    ${actionLabel ? `<button class="toast-action">${esc(actionLabel)}</button>` : ''}
    <button class="toast-close"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
  `;

  toast.querySelector('.toast-close').onclick = (e) => { e.stopPropagation(); toast.remove(); };
  const actionBtn = toast.querySelector('.toast-action');
  if (actionBtn && onAction) actionBtn.onclick = (e) => { e.stopPropagation(); onAction(); toast.remove(); };
  if (onClick) toast.onclick = () => { onClick(); toast.remove(); };

  container.appendChild(toast);
  icons();
  if (duration > 0) setTimeout(() => { if (toast.parentElement) toast.remove(); }, duration);
}

/* ═══════ INIT ═══════ */
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadSoundSetting();
  unlockAudioOnFirstClick();
  setupLoginUI();
  setupGlobalListeners();
  setupServiceWorkerMessages();
  setupPWAHandlers();
  setupKeyboardShortcuts();
  icons();

  const lastUser = loadLastUser();
  if (lastUser) {
    const inp = $('#loginUser');
    if (inp) inp.value = lastUser;
    const pass = $('#loginPass');
    if (pass) pass.focus();
  }

  checkAuthState();
});

/* ═══════ KEYBOARD SHORTCUTS ═══════ */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const s = $('#globalSearch');
      if (s && state.currentUser) { s.focus(); s.select(); }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      if (state.currentUser) openCompose();
    }
    if (e.key === 'Escape') {
      const cm = $('#composeModal');
      if (cm && cm.style.display === 'flex') {
        const openSuggestions = document.querySelector('.chips-suggestions:not(.hidden)');
        if (!openSuggestions) closeCompose();
      }
      hide($('#profileModal'));
      hide($('#settingsModal'));
      hide($('#forgotModal'));
      hide($('#tagsModal'));
      closeMobileDrawer();
      closeImageViewer();
    }
  });
}

/* ═══════ PWA ═══════ */
function setupPWAHandlers() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('installPwaBtn');
    if (btn) btn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = document.getElementById('installPwaBtn');
    if (btn) btn.classList.add('hidden');
    showToastAdvanced('تم التثبيت 🎉', 'التطبيق مثبّت على جهازك', { type: 'success', icon: 'check' });
  });

  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    document.body.classList.add('pwa-mode');
  }
}

window.installPWA = async () => {
  if (!deferredPrompt) {
    showToastAdvanced('التثبيت غير متاح', 'استخدم قائمة المتصفح', { type: 'warning', icon: 'alert-triangle' });
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  const btn = document.getElementById('installPwaBtn');
  if (btn) btn.classList.add('hidden');
};

/* ═══════ LOGIN ═══════ */
function setupLoginUI() {
  const loginBtn = $('#loginBtn');
  if (loginBtn) loginBtn.onclick = handleLogin;

  const passInput = $('#loginPass');
  if (passInput) passInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleLogin(); });

  const togglePassBtn = $('#togglePassBtn');
  if (togglePassBtn) {
    togglePassBtn.onclick = () => {
      const inp = $('#loginPass');
      const eye = $('#eyeIcon');
      if (!inp) return;
      if (inp.type === 'password') { inp.type = 'text'; eye?.setAttribute('data-lucide', 'eye-off'); }
      else { inp.type = 'password'; eye?.setAttribute('data-lucide', 'eye'); }
      icons();
    };
  }

  const forgotBtn = $('#forgotPassBtn');
  if (forgotBtn) forgotBtn.onclick = () => { show($('#forgotModal')); icons(); };
}

async function handleLogin() {
  const u = ($('#loginUser')?.value || '').trim().toLowerCase();
  const p = $('#loginPass')?.value || '';
  const err = $('#loginError');
  const btn = $('#loginBtn');

  hide(err);
  if (!u || !p) { err.textContent = 'املأ البيانات'; show(err); return; }

  const email = u.includes('@') ? u : `${u}@${EMAIL_DOMAIN}`;
  const remember = $('#rememberMe')?.checked;

  btn.disabled = true;
  btn.querySelector('span').textContent = 'جاري الدخول...';

  try {
    try { await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence); } catch (e) {}
    await signInWithEmailAndPassword(auth, email, p);
  } catch (e) {
    const messages = {
      'auth/user-not-found': 'المستخدم غير موجود',
      'auth/wrong-password': 'كلمة السر غلط',
      'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
      'auth/invalid-email': 'الإيميل غير صحيح',
      'auth/unauthorized-domain': 'الدومين غير مسموح',
      'auth/too-many-requests': 'محاولات كتير — استنى شوية',
      'auth/network-request-failed': 'مشكلة في الاتصال'
    };
    err.textContent = messages[e.code] || `خطأ: ${e.code}`;
    show(err);
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'تسجيل الدخول';
  }
}

window.closeForgotModal = () => {
  hide($('#forgotModal'));
  const inp = $('#forgotEmail'); if (inp) inp.value = '';
  const st = $('#forgotStatus'); if (st) { st.classList.add('hidden'); st.textContent = ''; }
};

window.sendPasswordReset = async () => {
  const email = ($('#forgotEmail')?.value || '').trim().toLowerCase();
  const status = $('#forgotStatus');
  if (!email) { status.className = 'alert alert-error'; status.textContent = 'اكتب الإيميل'; show(status); return; }
  status.className = 'alert alert-info'; status.textContent = 'جاري الإرسال...'; show(status);

  const result = await resetUserPassword(email);
  if (result.success) { status.className = 'alert alert-success'; status.textContent = '✅ تم إرسال رابط الاستعادة'; }
  else {
    status.className = 'alert alert-error';
    if (result.error === 'auth/user-not-found') status.textContent = 'الإيميل غير مسجل';
    else if (result.error === 'auth/invalid-email') status.textContent = 'الإيميل غير صحيح';
    else status.textContent = result.message || 'خطأ';
  }
};

/* ═══════ AUTH STATE ═══════ */
function checkAuthState() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.currentUser = null;
      if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
      show($('#loginScreen'));
      hide($('#app'));
      return;
    }

    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) { alert('لا يوجد ملف مستخدم في Firestore'); await signOut(auth); return; }

    state.currentUser = { uid: user.uid, ...snap.data() };
    if (state.currentUser.isActive === false) { alert('الحساب معطّل'); await signOut(auth); return; }

    saveSession(state.currentUser);
    await loadUsersCache();
    await loadDepartmentsCache();
    await loadUserTags();

    updateUIForRole();
    hide($('#loginScreen'));
    show($('#app'));
    icons();
    initSidebar();
    navigate('inbox');

    startMessagesListener();
    setTimeout(registerFCMToken, 1500);
    setTimeout(() => updateDraftsBadge(), 2000);
  });
}

function updateUIForRole() {
  const initial = initials(state.currentUser.name);
  const nameEl = $('#userName');
  const roleEl = $('#userRole');
  const avatarEl = $('#userAvatar');
  const menuName = $('#menuUserName');
  const menuEmail = $('#menuUserEmail');
  const menuAvatar = $('#menuUserAvatar');

  if (nameEl) nameEl.textContent = state.currentUser.name;
  if (roleEl) roleEl.textContent = roleLabels[state.currentUser.role] || state.currentUser.role;
  if (avatarEl) { avatarEl.textContent = initial; applyAvatar(avatarEl, state.currentUser.name); }
  if (menuName) menuName.textContent = state.currentUser.name;
  if (menuEmail) menuEmail.textContent = state.currentUser.email || '';
  if (menuAvatar) { menuAvatar.textContent = initial; applyAvatar(menuAvatar, state.currentUser.name); }

  // Drawer
  const drawerNameEl = document.getElementById('drawerName');
  const drawerRoleEl = document.getElementById('drawerRole');
  const drawerAvatarEl = document.getElementById('drawerAvatar');
  if (drawerNameEl) drawerNameEl.textContent = state.currentUser.name;
  if (drawerRoleEl) drawerRoleEl.textContent = roleLabels[state.currentUser.role] || state.currentUser.role;
  if (drawerAvatarEl) { drawerAvatarEl.textContent = initial; applyAvatar(drawerAvatarEl, state.currentUser.name); }

  const admin = isAdmin();
  $$('[data-admin-only]').forEach(el => admin ? el.classList.remove('hidden') : el.classList.add('hidden'));

  const manager = isManagerOrAbove();
  $$('[data-manager-only]').forEach(el => manager ? el.classList.remove('hidden') : el.classList.add('hidden'));
}

/* ═══════ TAGS ═══════ */
async function loadUserTags() {
  try {
    const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'tags'));
    userTags = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebarTags();
  } catch (e) {
    console.error('Tags load error:', e);
    userTags = [];
  }
}

function renderSidebarTags() {
  const container = document.getElementById('sidebarTags');
  if (!container) return;
  if (userTags.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = userTags.map(tag => `
    <button class="nav-tag ${currentTagFilter === tag.id ? 'active' : ''}"
            style="--tag-color: ${tag.color};"
            onclick="filterByTag('${tag.id}')">
      <span class="nav-tag-color" style="background: ${tag.color};"></span>
      <span class="nav-label">${esc(tag.name)}</span>
    </button>
  `).join('');
}

window.openTagsManager = () => { show($('#tagsModal')); renderTagsManager(); icons(); };
window.closeTagsManager = () => hide($('#tagsModal'));

function renderTagsManager() {
  const list = document.getElementById('tagsList');
  if (!list) return;

  if (userTags.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:20px;"><p style="font-size:13px;">لا توجد تصنيفات بعد</p></div>';
    return;
  }

  list.innerHTML = userTags.map(tag => `
    <div class="tag-manage-item">
      <div class="tag-manage-color" style="background: ${tag.color};"></div>
      <div class="tag-manage-name">${esc(tag.name)}</div>
      <span class="tag-manage-count">${tag.count || 0}</span>
      <button onclick="deleteTag('${tag.id}')" class="row-action danger" title="حذف">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `).join('');
  icons();
}

window.createTag = async () => {
  const name = $('#newTagName').value.trim();
  const color = $('#newTagColor').value;
  if (!name) { alert('اكتب اسم التصنيف'); return; }
  if (userTags.length >= 20) { alert('أقصى 20 تصنيف'); return; }

  try {
    const r = await addDoc(collection(db, 'users', state.currentUser.uid, 'tags'), {
      name, color, count: 0, createdAt: serverTimestamp()
    });
    userTags.push({ id: r.id, name, color, count: 0 });
    $('#newTagName').value = '';
    $('#newTagColor').value = '#0078D4';
    renderTagsManager();
    renderSidebarTags();
    showToastAdvanced('تم الإضافة ✅', `"${name}" اتعمل`, { type: 'success', icon: 'tag', duration: 2500 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.deleteTag = async (tagId) => {
  const tag = userTags.find(t => t.id === tagId);
  if (!tag) return;
  const ok = await confirmDialog('حذف التصنيف', `حذف "${tag.name}"؟`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'tags', tagId));
    userTags = userTags.filter(t => t.id !== tagId);
    renderTagsManager();
    renderSidebarTags();
    if (currentTagFilter === tagId) { currentTagFilter = null; navigate('inbox'); }
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.filterByTag = (tagId) => {
  currentTagFilter = currentTagFilter === tagId ? null : tagId;
  renderSidebarTags();
  navigate('inbox');
};

/* ═══════ SIDEBAR + MOBILE DRAWER ═══════ */
function initSidebar() {
  const sidebar = $('#sidebar');
  const mobileNav = $('#mobileNav');

  try {
    if (localStorage.getItem('sidebarCollapsed') === '1') {
      state.sidebarCollapsed = true;
      sidebar.classList.add('collapsed');
    }
  } catch (e) {}

  const update = () => {
    if (window.innerWidth < 768) {
      sidebar.style.display = 'none';
      mobileNav.style.display = 'flex';
    } else {
      sidebar.style.display = 'flex';
      mobileNav.style.display = 'none';
    }
  };
  update();
  window.addEventListener('resize', update);
}

window.toggleSidebar = function () {
  if (window.innerWidth < 768) {
    openMobileDrawer();
    return;
  }
  const sidebar = $('#sidebar');
  state.sidebarCollapsed = !state.sidebarCollapsed;
  sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
  try { localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed ? '1' : '0'); } catch (e) {}
};

window.openMobileDrawer = () => {
  const drawer = document.getElementById('mobileDrawer');
  if (!drawer) return;

  const u = state.currentUser;
  if (u) {
    const avatar = document.getElementById('drawerAvatar');
    const nameEl = document.getElementById('drawerName');
    const roleEl = document.getElementById('drawerRole');
    if (avatar) { avatar.textContent = initials(u.name); applyAvatar(avatar, u.name); }
    if (nameEl) nameEl.textContent = u.name;
    if (roleEl) roleEl.textContent = roleLabels[u.role] || u.role;
  }

  const c = state.unreadMessages.length;
  const el = document.getElementById('drawerInboxCount');
  if (el) {
    if (c > 0) { el.textContent = c; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }

  updateDraftsBadge();
  drawer.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  icons();
};

window.closeMobileDrawer = (event) => {
  if (event && event.target && event.target.id !== 'mobileDrawer') return;
  const drawer = document.getElementById('mobileDrawer');
  if (drawer) drawer.classList.add('hidden');
  document.body.style.overflow = '';
};

window.drawerNavigate = (page) => {
  closeMobileDrawer();
  setTimeout(() => navigate(page), 100);
};

/* ═══════ GLOBAL LISTENERS ═══════ */
function setupGlobalListeners() {
  const toggleBtn = $('#toggleSidebar');
  if (toggleBtn) toggleBtn.onclick = window.toggleSidebar;

  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  const nav = $('#nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (btn) { currentTagFilter = null; navigate(btn.dataset.page); }
    });
  }

  const mobileNav = $('#mobileNav');
  if (mobileNav) {
    mobileNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.mnav-item');
      if (btn && btn.dataset.page) navigate(btn.dataset.page);
    });
  }

  const notifBtn = $('#notifBtn');
  if (notifBtn) {
    notifBtn.onclick = (e) => {
      e.stopPropagation();
      const dd = $('#notifDropdown');
      dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
    };
  }

  const userMenuBtn = $('#userMenuBtn');
  if (userMenuBtn) {
    userMenuBtn.onclick = (e) => {
      e.stopPropagation();
      const menu = $('#userMenu');
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    };
  }

  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.onclick = () => {
      const isDark = toggleDarkMode();
      const icon = themeToggle.querySelector('i');
      if (icon) icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
      icons();
    };
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifBtn') && !e.target.closest('#notifDropdown')) hideStyle($('#notifDropdown'));
    if (!e.target.closest('#userMenuBtn') && !e.target.closest('#userMenu')) hideStyle($('#userMenu'));
    if (!e.target.closest('.header-search')) {
      const sr = $('#searchResults');
      if (sr) sr.style.display = 'none';
    }
  });

  setupInstantSearch();

  const composeModal = $('#composeModal');
  if (composeModal) {
    composeModal.addEventListener('click', (e) => {
      if (e.target.id === 'composeModal') closeCompose();
    });
  }
}

/* ═══════ INSTANT SEARCH ═══════ */
function setupInstantSearch() {
  const input = $('#globalSearch');
  const clearBtn = $('#clearSearchBtn');
  const resultsBox = $('#searchResults');
  if (!input || !resultsBox) return;

  let searchDebounce;

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);
    clearTimeout(searchDebounce);
    if (!q) { resultsBox.style.display = 'none'; return; }
    searchDebounce = setTimeout(() => performInstantSearch(q), 250);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim() && resultsBox.innerHTML) resultsBox.style.display = 'block';
  });

  if (clearBtn) {
    clearBtn.onclick = () => {
      input.value = '';
      clearBtn.classList.add('hidden');
      resultsBox.style.display = 'none';
      state.searchQuery = '';
      if (state.currentFilter === 'search') navigate('inbox');
    };
  }
}

async function performInstantSearch(query) {
  const resultsBox = $('#searchResults');
  if (!resultsBox) return;

  resultsBox.innerHTML = '<div class="search-empty"><div class="spinner" style="margin:0 auto;"></div></div>';
  resultsBox.style.display = 'block';

  try {
    const q1 = query(collection(db, 'messages'), where('toUserId', '==', state.currentUser.uid));
    const q2 = query(collection(db, 'messages'), where('fromUserId', '==', state.currentUser.uid));
    const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);

    const all = new Map();
    [...s1.docs, ...s2.docs].forEach(d => all.set(d.id, { id: d.id, ...d.data() }));

    const matches = Array.from(all.values())
      .filter(m => !isHiddenFromMe(m) && matchesSearch(m, query))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 15);

    if (matches.length === 0) {
      resultsBox.innerHTML = '<div class="search-empty">لا نتائج</div>';
      return;
    }

    resultsBox.innerHTML = matches.map(m => {
      const isFromMe = m.fromUserId === state.currentUser.uid;
      const otherName = isFromMe ? m.toUserName : m.fromUserName;
      const avatarClass = getAvatarGradient(otherName);
      const snippet = (m.body || '').slice(0, 80);

      return `
        <div class="search-result-item" onclick="goToSearchResult('${m.threadId || m.id}')">
          <div class="msg-avatar ${avatarClass}" style="width:32px;height:32px;font-size:11px;">${initials(otherName)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
              <span style="font-weight:600;font-size:12.5px;">${highlightText(otherName, query)}</span>
              <span style="font-size:10.5px;color:var(--text-tertiary);flex-shrink:0;">${timeAgo(m.createdAt)}</span>
            </div>
            <div style="font-size:12.5px;font-weight:600;margin-top:2px;">${highlightText(m.subject, query)}</div>
            <div style="font-size:11.5px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${highlightText(snippet, query)}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    resultsBox.innerHTML = '<div class="search-empty">خطأ في البحث</div>';
  }
}

window.goToSearchResult = (threadId) => {
  const sr = $('#searchResults');
  if (sr) sr.style.display = 'none';
  navigate('inbox');
  setTimeout(() => window.openThread(threadId), 300);
};

async function handleLogout() {
  const ok = await confirmDialog('تسجيل الخروج', 'هل أنت متأكد؟');
  if (!ok) return;

  try {
    if (messaging && state.currentUser) {
      const reg = await navigator.serviceWorker.getRegistration('/Email-system/');
      if (reg) {
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg }).catch(() => null);
        if (token) await deleteDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token));
      }
    }
  } catch (e) {}

  await signOut(auth);
}

window.signOutApp = handleLogout;

/* ═══════ NAVIGATION ═══════ */
const ROUTES = {
  inbox: renderInbox,
  sent: renderSent,
  starred: renderStarred,
  trash: renderTrash,
  drafts: renderDrafts,
  myteam: renderMyTeam,
  users: renderUsers,
  departments: renderDepartments,
  deletedlog: renderDeletedLog
};

export function navigate(page) {
  state.currentFilter = page;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.mnav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const route = ROUTES[page];
  if (route) route();
  icons();
}

window.navigate = navigate;

/* ═══════ DRAFTS ═══════ */
async function renderDrafts() {
  $('#pageContent').innerHTML = `
    <div class="dashboard" style="max-width:900px;">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div>
          <h1 class="dashboard-title">المسودات</h1>
          <p class="dashboard-date">جاري التحميل...</p>
        </div>
      </div>
      <div class="data-table-wrapper" style="padding:20px;">
        ${renderSkeletonInbox()}
      </div>
    </div>
  `;
  icons();

  try {
    const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'drafts'));
    const drafts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

    if (drafts.length === 0) {
      $('#pageContent').innerHTML = `
        <div class="dashboard" style="max-width:900px;">
          <div class="page-header" style="padding:0 0 20px;border:none;">
            <div>
              <h1 class="dashboard-title">المسودات</h1>
              <p class="dashboard-date">0 مسودة</p>
            </div>
          </div>
          <div class="empty-state" style="padding:60px 20px;">
            <i data-lucide="file-text" style="width:64px;height:64px;"></i>
            <p style="margin-top:12px;">لا توجد مسودات</p>
            <button onclick="openCompose()" class="btn btn-primary" style="margin-top:16px;">
              <i data-lucide="pencil" class="w-4 h-4"></i>
              <span>إنشاء مسودة جديدة</span>
            </button>
          </div>
        </div>
      `;
      icons();
      return;
    }

    const rows = drafts.map(d => {
      const toUser = d.toUserId ? state.allUsersCache.find(u => u.id === d.toUserId) : null;
      const toName = toUser ? toUser.name : '— لم يُحدد —';
      return `
        <div class="draft-item" onclick="openDraft('${d.id}')">
          <div class="draft-avatar">
            <i data-lucide="file-text" class="w-5 h-5"></i>
          </div>
          <div class="draft-info">
            <div class="draft-to">إلى: ${esc(toName)}</div>
            <div class="draft-subject">${esc(d.subject || '(بدون موضوع)')}</div>
            <div class="draft-preview">${esc((d.body || '').slice(0, 80))}</div>
          </div>
          <div class="draft-time">${timeAgo(d.updatedAt || d.createdAt)}</div>
          <button class="draft-delete" onclick="event.stopPropagation(); deleteDraft('${d.id}')" title="حذف">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `;
    }).join('');

    $('#pageContent').innerHTML = `
      <div class="dashboard" style="max-width:900px;">
        <div class="page-header" style="padding:0 0 20px;border:none;">
          <div>
            <h1 class="dashboard-title">المسودات</h1>
            <p class="dashboard-date">${drafts.length} مسودة</p>
          </div>
          <button onclick="openCompose()" class="btn btn-primary btn-sm">
            <i data-lucide="pencil" class="w-4 h-4"></i>
            <span>جديدة</span>
          </button>
        </div>
        <div class="data-table-wrapper" style="padding:0;overflow:hidden;">
          ${rows}
        </div>
      </div>
    `;
    icons();
    updateDraftsBadge(drafts.length);
  } catch (e) {
    console.error('Drafts load error:', e);
    $('#pageContent').innerHTML = `
      <div class="dashboard">
        <div class="empty-state">
          <i data-lucide="alert-circle" style="width:64px;height:64px;color:var(--danger);"></i>
          <p>خطأ في تحميل المسودات</p>
        </div>
      </div>
    `;
    icons();
  }
}

window.renderDrafts = renderDrafts;

window.openDraft = async (draftId) => {
  try {
    const snap = await getDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId));
    if (!snap.exists()) {
      showToastAdvanced('المسودة مش موجودة', '', { type: 'error', icon: 'alert-circle' });
      return;
    }
    const d = snap.data();

    await window.openCompose();

    if (d.toUserId) {
      const toUser = state.allUsersCache.find(u => u.id === d.toUserId);
      if (toUser) window.addRecipient('to', toUser);
    }
    $('#cSubject').value = d.subject || '';
    $('#cBody').value = d.body || '';
    $('#cDraftId').value = draftId;
    $('#composeTitle').textContent = 'تعديل مسودة';

    showToastAdvanced('تم فتح المسودة ✅', 'تعديل وحفظ', { type: 'info', icon: 'file-text', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.deleteDraft = async (draftId) => {
  const ok = await confirmDialog('حذف المسودة', 'هيتم حذف المسودة نهائياً. متأكد؟');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId));
    showToastAdvanced('تم الحذف 🗑️', '', { type: 'success', icon: 'trash-2', duration: 2000 });
    renderDrafts();
    updateDraftsBadge();
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

async function updateDraftsBadge(count) {
  const drawerEl = document.getElementById('drawerDraftsCount');
  const sidebarEl = document.getElementById('sidebarDraftsCount');

  if (typeof count !== 'number') {
    try {
      const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'drafts'));
      count = snap.size;
    } catch (e) { count = 0; }
  }

  [drawerEl, sidebarEl].forEach(el => {
    if (!el) return;
    if (count > 0) {
      el.textContent = count;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

/* ═══════ MY TEAM ═══════ */
async function renderMyTeam() {
  await loadUsersCache();
  await loadDepartmentsCache();

  const myDepts = getMyManagedDepts();
  const team = getMyTeamMembers().filter(u => canSendTo(u));

  const byDept = {};
  myDepts.forEach(d => byDept[d.id] = []);
  team.forEach(u => { if (u.departmentId && byDept[u.departmentId]) byDept[u.departmentId].push(u); });

  const deptSections = myDepts.map(d => {
    const members = byDept[d.id] || [];
    const memberRows = members.map(m => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);">
        <div class="user-cell-avatar ${getAvatarGradient(m.name)}">${initials(m.name)}</div>
        <div style="flex:1;min-width:0;">
          <div class="user-cell-name">${esc(m.name)}</div>
          <div class="user-cell-email">@${esc(m.username)}</div>
        </div>
        <button onclick="quickSendToUser('${m.id}')" class="row-action primary" title="إرسال">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </div>
    `).join('');

    return `
      <div class="section" style="padding:0;overflow:hidden;">
        <div style="padding:14px 18px;background:var(--bg-subtle);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-default);">
          <div style="display:flex;align-items:center;gap:10px;">
            <i data-lucide="building-2" class="w-4 h-4" style="color:#8764B8;"></i>
            <span style="font-weight:700;font-size:14px;">${esc(d.name)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:12px;color:var(--text-tertiary);">${members.length} عضو</span>
            ${members.length > 0 ? `
              <button onclick="quickSendToDept('${d.id}')" class="btn btn-primary btn-sm">
                <i data-lucide="megaphone" class="w-3 h-3"></i>
                <span>إرسال للقسم</span>
              </button>
            ` : ''}
          </div>
        </div>
        <div>${memberRows || '<div class="empty-state" style="padding:32px;"><p>لا يوجد أعضاء</p></div>'}</div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <h1 class="dashboard-title">فريقي</h1>
        <p class="dashboard-date">${team.length} عضو · ${myDepts.length} قسم</p>
      </div>
      ${myDepts.length === 0 ? `
        <div class="section" style="text-align:center;padding:40px;">
          <i data-lucide="alert-circle" class="w-12 h-12" style="color:var(--warning);margin-bottom:12px;"></i>
          <div style="font-weight:700;margin-bottom:4px;">لم يتم تعيينك مديرًا لأي قسم</div>
        </div>
      ` : deptSections}
      ${team.length > 0 ? `
        <div class="section">
          <h3 class="section-title">إجراءات جماعية</h3>
          <button onclick="quickSendToTeam()" class="btn btn-primary">
            <i data-lucide="megaphone" class="w-4 h-4"></i>
            <span>إرسال لكل فريقي (${team.length})</span>
          </button>
        </div>
      ` : ''}
    </div>
  `;
  icons();
}

window.quickSendToUser = async (userId) => {
  await window.openCompose();
  const u = state.allUsersCache.find(x => x.id === userId);
  if (u) window.addRecipient('to', u);
};

window.quickSendToDept = async (deptId) => {
  await window.openCompose();
  const cb = $('#cDept'); const sel = $('#deptSelect');
  if (cb && sel) { sel.value = deptId; cb.checked = true; window.toggleDeptSend(); }
  const optionsField = $('#optionsField');
  if (optionsField) show(optionsField);
};

window.quickSendToTeam = async () => {
  await window.openCompose();
  const cb = $('#cDept'); if (cb) { cb.checked = true; window.toggleDeptSend(); }
  const optionsField = $('#optionsField');
  if (optionsField) show(optionsField);
};

/* ═══════ USERS MANAGEMENT ═══════ */
async function renderUsers() {
  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div><h1 class="dashboard-title">المستخدمين</h1><p class="dashboard-date">جاري التحميل...</p></div>
      </div>
      <div class="data-table-wrapper">
        <div class="data-table-scroll">
          <table class="data-table">
            <thead><tr><th>المستخدم</th><th>اسم المستخدم</th><th>القسم</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>
            <tbody>${renderSkeletonTable()}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  await loadUsersCache();
  await loadDepartmentsCache();

  const rows = state.allUsersCache.map(u => {
    const uLabel = roleLabels[u.role] || u.role;
    const dept = u.departmentId ? getDeptById(u.departmentId) : null;
    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar ${getAvatarGradient(u.name)}">${initials(u.name)}</div>
            <div style="min-width:0;">
              <div class="user-cell-name">${esc(u.name)}</div>
              <div class="user-cell-email">${esc(u.email || '')}</div>
            </div>
          </div>
        </td>
        <td style="font-family:monospace;font-size:12.5px;">${esc(u.username)}</td>
        <td>${dept ? `<span style="font-size:11.5px;background:#E5F0FA;color:var(--brand-primary);padding:3px 8px;border-radius:4px;font-weight:600;">${esc(dept.name)}</span>` : '—'}</td>
        <td><span class="role-badge role-${u.role}">${uLabel}</span></td>
        <td><span class="status-cell ${u.isActive === false ? 'status-inactive' : 'status-active'}"><span class="status-dot"></span>${u.isActive === false ? 'معطّل' : 'نشط'}</span></td>
        <td>
          <div class="row-actions">
            <button onclick="editUser('${u.id}')" class="row-action primary" title="تعديل"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
            <button onclick="toggleUser('${u.id}', ${u.isActive === false})" class="row-action" title="${u.isActive === false ? 'تفعيل' : 'تعطيل'}"><i data-lucide="${u.isActive === false ? 'user-check' : 'user-x'}" class="w-3.5 h-3.5"></i></button>
            <button onclick="deleteUserDoc('${u.id}')" class="row-action danger" title="حذف"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const roleOptions = `
    <option value="user">مستخدم</option>
    <option value="manager">مدير قسم</option>
    <option value="chairman">رئيس مجلس الإدارة</option>
    <option value="vice_chairman">نائب رئيس مجلس الإدارة</option>
    <option value="admin">مسئول السيستم</option>
  `;

  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div><h1 class="dashboard-title">المستخدمين</h1><p class="dashboard-date">${state.allUsersCache.length} مستخدم</p></div>
        <button onclick="openAddUser()" class="btn btn-primary"><i data-lucide="user-plus" class="w-4 h-4"></i><span>إضافة مستخدم</span></button>
      </div>

      <div id="addUserForm" class="section hidden fade-in">
        <h3 class="section-title">مستخدم جديد</h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group"><label class="form-label">الاسم</label><input id="nuName" class="form-input" placeholder="محمد أحمد" /></div>
          <div class="form-group"><label class="form-label">اسم المستخدم</label><input id="nuUser" class="form-input" placeholder="mohamed" /></div>
          <div class="form-group"><label class="form-label">كلمة السر</label><input id="nuPass" type="text" class="form-input" placeholder="6+ حروف" /></div>
          <div class="form-group"><label class="form-label">الدور</label><select id="nuRole" class="form-input" onchange="onRoleChange('nu')">
            ${roleOptions}
          </select></div>
        </div>

        <div class="form-group" id="nuDeptGroup" style="margin-top:14px;">
          <label class="form-label">القسم</label>
          <select id="nuDept" class="form-input"><option value="">— بدون قسم —</option></select>
        </div>

        <div style="margin-top:14px;padding:12px;background:var(--bg-subtle);border-radius:8px;">
          <label class="check-inline" style="cursor:pointer;">
            <input type="checkbox" id="nuIsManager" class="check-input" onchange="onIsManagerChange('nu')" />
            <span class="check-box"></span>
            <span class="check-label" style="font-weight:700;color:var(--text-primary);">👔 مدير قسم</span>
          </label>
          <p style="font-size:11.5px;color:var(--text-tertiary);margin:6px 24px 0 0;">
            لو متحدد، المستخدم هيبقى مدير القسم المختار تلقائياً
          </p>
        </div>

        <div style="margin-top:16px;padding:14px;background:var(--bg-subtle);border-radius:8px;border:1px solid var(--border-default);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-weight:700;font-size:13px;">🔐 صلاحيات الإرسال</span>
            <span style="font-size:11px;color:var(--text-tertiary);">هيتم تعبئتها تلقائياً حسب الدور</span>
          </div>
          <div id="nuPermissionsList" class="permissions-list"></div>
        </div>

        <p style="font-size:12px;color:var(--text-tertiary);margin:12px 0 0;">الإيميل: <span style="font-family:monospace;">username@${EMAIL_DOMAIN}</span></p>
        <p id="nuErr" class="alert hidden" style="margin-top:12px;"></p>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button onclick="createNewUser()" class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i><span>حفظ</span></button>
          <button onclick="closeAddUser()" class="btn btn-ghost">إلغاء</button>
        </div>
      </div>

      <div id="editUserForm" class="section hidden fade-in">
        <h3 class="section-title">تعديل مستخدم</h3>
        <input type="hidden" id="euId" />
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group"><label class="form-label">الاسم</label><input id="euName" class="form-input" /></div>
          <div class="form-group"><label class="form-label">اسم المستخدم</label><input id="euUser" class="form-input form-input-disabled" disabled /></div>
          <div class="form-group"><label class="form-label">الدور</label><select id="euRole" class="form-input" onchange="onRoleChange('eu')">
            ${roleOptions}
          </select></div>
        </div>

        <div class="form-group" id="euDeptGroup" style="margin-top:14px;">
          <label class="form-label">القسم</label>
          <select id="euDept" class="form-input"><option value="">— بدون قسم —</option></select>
        </div>

        <div style="margin-top:14px;padding:12px;background:var(--bg-subtle);border-radius:8px;">
          <label class="check-inline" style="cursor:pointer;">
            <input type="checkbox" id="euIsManager" class="check-input" onchange="onIsManagerChange('eu')" />
            <span class="check-box"></span>
            <span class="check-label" style="font-weight:700;color:var(--text-primary);">👔 مدير قسم</span>
          </label>
          <p style="font-size:11.5px;color:var(--text-tertiary);margin:6px 24px 0 0;">
            لو متحدد، المستخدم هيبقى مدير القسم المختار تلقائياً
          </p>
        </div>

        <div style="margin-top:16px;padding:14px;background:var(--bg-subtle);border-radius:8px;border:1px solid var(--border-default);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-weight:700;font-size:13px;">🔐 صلاحيات الإرسال</span>
            <span style="font-size:11px;color:var(--text-tertiary);">تقدر تعدلها يدوياً</span>
          </div>
          <div id="euPermissionsList" class="permissions-list"></div>
        </div>

        <p id="euErr" class="alert hidden" style="margin-top:12px;"></p>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button onclick="saveEditUser()" class="btn btn-success"><i data-lucide="check" class="w-4 h-4"></i><span>حفظ</span></button>
          <button onclick="closeEditUser()" class="btn btn-ghost">إلغاء</button>
        </div>
      </div>

      <div class="data-table-wrapper">
        <div class="data-table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>المستخدم</th><th>اسم المستخدم</th><th>القسم</th><th>الدور</th><th>الحالة</th><th style="text-align:left;">إجراءات</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text-tertiary);">لا يوجد مستخدمين</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  fillDeptSelects();
  icons();
}

function renderPermissionsList(containerId, selectedPerms) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = Object.entries(PERMISSION_LABELS).map(([key, info]) => `
    <label class="permission-item">
      <input type="checkbox" value="${key}" ${selectedPerms.includes(key) ? 'checked' : ''} />
      <span class="permission-box"></span>
      <i data-lucide="${info.icon}" class="permission-icon"></i>
      <span class="permission-label">${esc(info.label)}</span>
    </label>
  `).join('');
  icons();
}

function readPermissions(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.value);
}

window.onRoleChange = (prefix) => {
  const roleEl = document.getElementById(prefix + 'Role');
  const deptGroup = document.getElementById(prefix + 'DeptGroup');
  const isMgrCb = document.getElementById(prefix + 'IsManager');
  if (!roleEl || !deptGroup) return;

  const role = roleEl.value;
  const needsDept = roleNeedsDept(role);
  deptGroup.style.display = needsDept ? 'flex' : 'none';

  if (isMgrCb) {
    isMgrCb.checked = (role === 'manager');
  }

  const defaults = DEFAULT_PERMISSIONS[role] || [];
  renderPermissionsList(prefix + 'PermissionsList', defaults);
};

window.onIsManagerChange = (prefix) => {
  const isMgrCb = document.getElementById(prefix + 'IsManager');
  const roleEl = document.getElementById(prefix + 'Role');
  if (!isMgrCb || !roleEl) return;

  if (isMgrCb.checked) {
    if (Array.from(roleEl.options).some(o => o.value === 'manager')) {
      roleEl.value = 'manager';
    }
  } else {
    if (roleEl.value === 'manager') {
      roleEl.value = 'user';
    }
  }

  const defaults = DEFAULT_PERMISSIONS[roleEl.value] || [];
  renderPermissionsList(prefix + 'PermissionsList', defaults);

  const deptGroup = document.getElementById(prefix + 'DeptGroup');
  if (deptGroup) deptGroup.style.display = roleNeedsDept(roleEl.value) ? 'flex' : 'none';
};

function fillDeptSelects() {
  const opts = state.allDeptsCache.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  ['nuDept', 'euDept'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel && sel.options.length === 1) sel.innerHTML = '<option value="">— بدون قسم —</option>' + opts;
  });
}

window.openAddUser = () => {
  show($('#addUserForm'));
  hide($('#editUserForm'));
  fillDeptSelects();
  const isMgrCb = document.getElementById('nuIsManager');
  if (isMgrCb) isMgrCb.checked = false;
  document.getElementById('nuRole').value = 'user';
  window.onRoleChange('nu');
};
window.closeAddUser = () => hide($('#addUserForm'));

window.createNewUser = async () => {
  const name = $('#nuName').value.trim();
  const user = sanitizeUsername($('#nuUser').value);
  const pass = $('#nuPass').value;
  let role = $('#nuRole').value;
  const deptId = $('#nuDept').value;
  const isManager = document.getElementById('nuIsManager')?.checked;
  const permissions = readPermissions('nuPermissionsList');
  const err = $('#nuErr');
  hide(err);

  if (isManager) role = 'manager';

  if (!name || !user || !pass) { err.className = 'alert alert-error'; err.textContent = 'املأ كل البيانات'; show(err); return; }
  if (!validateUsername(user)) { err.className = 'alert alert-error'; err.textContent = 'اسم المستخدم غير صالح'; show(err); return; }
  if (!validatePassword(pass)) { err.className = 'alert alert-error'; err.textContent = 'كلمة السر 6 حروف'; show(err); return; }
  if (roleNeedsDept(role) && !deptId) {
    err.className = 'alert alert-error';
    err.textContent = 'لازم تختار قسم للدور ده';
    show(err); return;
  }

  err.className = 'alert alert-info'; err.textContent = 'جاري الإنشاء...'; show(err);

  try {
    const email = `${user}@${EMAIL_DOMAIN}`;
    const uid = await createAuthUser(email, pass);

    await setDoc(doc(db, 'users', uid), {
      name, username: user, email, role,
      departmentId: deptId || null,
      permissions: permissions,
      isActive: true,
      createdAt: serverTimestamp()
    });

    if (role === 'manager' && deptId) {
      await updateDoc(doc(db, 'departments', deptId), { managerId: uid });
    }

    err.className = 'alert alert-success'; err.textContent = `✅ تم إنشاء ${user}`;
    showToastAdvanced('تم الإنشاء ✅', `${user} أضيف`, { type: 'success', icon: 'user-check', duration: 2500 });
    $('#nuName').value = ''; $('#nuUser').value = ''; $('#nuPass').value = '';
    setTimeout(() => { hide($('#addUserForm')); renderUsers(); }, 1200);
  } catch (e) {
    err.className = 'alert alert-error';
    err.textContent = e.code === 'auth/email-already-in-use' ? 'اسم المستخدم مستخدم' : e.message;
    show(err);
  }
};

window.editUser = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid));
  const u = snap.data();
  $('#euId').value = uid;
  $('#euName').value = u.name || '';
  $('#euUser').value = u.username || '';
  $('#euRole').value = u.role || 'user';

  fillDeptSelects();
  $('#euDept').value = u.departmentId || '';

  const isMgrCb = document.getElementById('euIsManager');
  if (isMgrCb) isMgrCb.checked = (u.role === 'manager');

  const perms = Array.isArray(u.permissions) && u.permissions.length > 0
    ? u.permissions
    : (DEFAULT_PERMISSIONS[u.role] || []);
  renderPermissionsList('euPermissionsList', perms);

  show($('#editUserForm'));
  hide($('#addUserForm'));

  const deptGroup = document.getElementById('euDeptGroup');
  if (deptGroup) deptGroup.style.display = roleNeedsDept(u.role) ? 'flex' : 'none';

  $('#editUserForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
window.closeEditUser = () => hide($('#editUserForm'));

window.saveEditUser = async () => {
  const uid = $('#euId').value;
  const name = $('#euName').value.trim();
  let role = $('#euRole').value;
  const deptId = $('#euDept').value;
  const isManager = document.getElementById('euIsManager')?.checked;
  const permissions = readPermissions('euPermissionsList');
  const err = $('#euErr');
  hide(err);

  if (isManager) role = 'manager';

  if (!name) { err.className = 'alert alert-error'; err.textContent = 'اكتب الاسم'; show(err); return; }
  if (roleNeedsDept(role) && !deptId) {
    err.className = 'alert alert-error';
    err.textContent = 'لازم تختار قسم';
    show(err); return;
  }

  try {
    const oldSnap = await getDoc(doc(db, 'users', uid));
    const oldData = oldSnap.data() || {};

    if (oldData.role === 'manager' && oldData.departmentId) {
      const changed = role !== 'manager' || oldData.departmentId !== deptId;
      if (changed) {
        const oldDeptRef = doc(db, 'departments', oldData.departmentId);
        const oldDeptSnap = await getDoc(oldDeptRef);
        if (oldDeptSnap.exists() && oldDeptSnap.data().managerId === uid) {
          await updateDoc(oldDeptRef, { managerId: null });
        }
      }
    }

    await updateDoc(doc(db, 'users', uid), {
      name, role,
      departmentId: deptId || null,
      permissions: permissions
    });

    if (role === 'manager' && deptId) {
      await updateDoc(doc(db, 'departments', deptId), { managerId: uid });
    }

    hide($('#editUserForm'));
    showToastAdvanced('تم الحفظ ✅', '', { type: 'success', icon: 'check', duration: 2000 });
    renderUsers();
  } catch (e) {
    err.className = 'alert alert-error'; err.textContent = e.message; show(err);
  }
};

window.toggleUser = async (uid, activate) => {
  await updateDoc(doc(db, 'users', uid), { isActive: activate });
  renderUsers();
};

window.deleteUserDoc = async (uid) => {
  const ok = await confirmDialog('حذف المستخدم', 'هيتحذف من Firestore فقط. متأكد؟');
  if (!ok) return;
  await deleteDoc(doc(db, 'users', uid));
  renderUsers();
};

/* ═══════ DEPARTMENTS ═══════ */
async function renderDepartments() {
  await loadDepartmentsCache();
  await loadUsersCache();

  const cards = state.allDeptsCache.map(d => {
    const members = getUsersByDept(d.id);
    const manager = d.managerId ? getUserById(d.managerId) : null;
    return `
      <div class="dept-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;">
          <div class="dept-card-icon"><i data-lucide="building-2" class="w-5 h-5"></i></div>
          <div style="display:flex;gap:4px;">
            <button onclick="editDept('${d.id}')" class="row-action primary" title="تعديل"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
            <button onclick="deleteDept('${d.id}')" class="row-action danger" title="حذف"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>
        </div>
        <div class="dept-card-name">${esc(d.name)}</div>
        <div class="dept-card-desc">${esc(d.description || 'بدون وصف')}</div>
        <div class="dept-card-footer">
          <div style="display:flex;align-items:center;gap:6px;"><i data-lucide="users" class="w-3.5 h-3.5"></i><span>${members.length} عضو</span></div>
          ${manager ? `<div style="display:flex;align-items:center;gap:6px;"><div style="width:22px;height:22px;border-radius:50%;background:#8764B8;color:white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${initials(manager.name)}</div><span style="font-size:11.5px;color:#8764B8;font-weight:600;">${esc(manager.name)}</span></div>` : `<button onclick="editDept('${d.id}')" style="background:none;border:none;color:#E8A100;font-size:11.5px;cursor:pointer;font-weight:600;">⚠ بدون مدير</button>`}
        </div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div><h1 class="dashboard-title">الأقسام</h1><p class="dashboard-date">${state.allDeptsCache.length} قسم</p></div>
      </div>
      <div class="section">
        <h3 class="section-title">إضافة قسم جديد</h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end;">
          <div class="form-group"><label class="form-label">اسم القسم</label><input id="dName" class="form-input" placeholder="تكنولوجيا المعلومات" /></div>
          <div class="form-group"><label class="form-label">وصف (اختياري)</label><input id="dDesc" class="form-input" placeholder="وصف مختصر" /></div>
          <div class="form-group"><label class="form-label">مدير القسم</label><select id="dManager" class="form-input"><option value="">— بدون مدير —</option></select></div>
          <button onclick="addDept()" class="btn btn-primary" style="height:36px;"><i data-lucide="plus" class="w-4 h-4"></i><span>إضافة</span></button>
        </div>
      </div>
      <div class="dept-grid">${cards || '<div class="empty-state" style="grid-column:1/-1;"><i data-lucide="building-2"></i><p>لا يوجد أقسام بعد</p></div>'}</div>
    </div>
  `;

  const managerOpts = state.allUsersCache
    .filter(u => u.isActive !== false && (u.role === 'manager' || isActualDeptManager(u)))
    .map(u => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)})</option>`).join('');
  const dm = document.getElementById('dManager');
  if (dm) dm.innerHTML = '<option value="">— بدون مدير —</option>' + managerOpts;

  icons();
}

window.addDept = async () => {
  const name = $('#dName').value.trim();
  const description = $('#dDesc').value.trim();
  const managerId = $('#dManager').value;
  if (!name) return alert('اكتب اسم القسم');
  await addDoc(collection(db, 'departments'), { name, description, managerId: managerId || null, createdAt: serverTimestamp() });
  showToastAdvanced('تم الإضافة ✅', `قسم ${name}`, { type: 'success', icon: 'building-2', duration: 2500 });
  renderDepartments();
};

window.editDept = async (id) => {
  const d = state.allDeptsCache.find(x => x.id === id);
  if (!d) return;

  const managerOpts = state.allUsersCache
    .filter(u => u.isActive !== false && (u.role === 'manager' || isActualDeptManager(u)))
    .map(u => `<option value="${u.id}" ${u.id === d.managerId ? 'selected' : ''}>${esc(u.name)} (@${esc(u.username)})</option>`).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'deptEditModal';
  modal.innerHTML = `
    <div class="modal-panel modal-md fade-in">
      <div class="modal-header">
        <div><h2 class="modal-title">تعديل القسم</h2><p class="modal-subtitle">${esc(d.name)}</p></div>
        <button onclick="document.getElementById('deptEditModal').remove()" class="icon-btn icon-btn-ghost"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">اسم القسم</label><input id="editDeptName" class="form-input" value="${esc(d.name)}" /></div>
        <div class="form-group"><label class="form-label">الوصف</label><input id="editDeptDesc" class="form-input" value="${esc(d.description || '')}" /></div>
        <div class="form-group"><label class="form-label">مدير القسم</label><select id="editDeptManager" class="form-input"><option value="">— بدون مدير —</option>${managerOpts}</select></div>
      </div>
      <div class="modal-footer">
        <button onclick="document.getElementById('deptEditModal').remove()" class="btn btn-ghost">إلغاء</button>
        <button onclick="saveEditDept('${id}')" class="btn btn-primary">حفظ</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  icons();
};

window.saveEditDept = async (id) => {
  const name = $('#editDeptName').value.trim();
  const description = $('#editDeptDesc').value.trim();
  const managerId = $('#editDeptManager').value;
  if (!name) { alert('اكتب اسم القسم'); return; }
  await updateDoc(doc(db, 'departments', id), { name, description, managerId: managerId || null });
  const m = document.getElementById('deptEditModal');
  if (m) m.remove();
  renderDepartments();
};

window.deleteDept = async (id) => {
  const ok = await confirmDialog('حذف القسم', 'متأكد؟');
  if (!ok) return;
  await deleteDoc(doc(db, 'departments', id));
  renderDepartments();
};

/* ═══════ INBOX ═══════ */
async function renderInbox() {
  const filter = state.currentFilter;
  const title = currentTagFilter
    ? (userTags.find(t => t.id === currentTagFilter)?.name || 'التصنيف')
    : {
        inbox: 'صندوق الوارد',
        sent: 'المُرسلة',
        starred: 'المميزة',
        trash: 'سلة المهملات',
        drafts: 'المسودات',
        search: 'نتائج البحث'
      }[filter] || 'صندوق الوارد';

  $('#pageContent').innerHTML = `
    <div class="inbox-shell fade-in">
      <div id="inboxList" class="inbox-list">
        <div class="inbox-list-header">
          <div>
            <div class="inbox-list-title">${title}</div>
            <div class="inbox-list-meta">جاري التحميل...</div>
          </div>
        </div>
        <div class="inbox-list-body">${renderSkeletonInbox()}</div>
      </div>
      <div id="inboxReading" class="reading-pane">
        <div class="empty-state" style="flex:1;min-height:400px;"><i data-lucide="mail-open"></i><p>جاري التحميل...</p></div>
      </div>
    </div>
  `;
  icons();

  const q1 = query(collection(db, 'messages'), where('toUserId', '==', state.currentUser.uid));
  const q2 = query(collection(db, 'messages'), where('fromUserId', '==', state.currentUser.uid));
  const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);

  const all = new Map();
  [...s1.docs, ...s2.docs].forEach(d => all.set(d.id, { id: d.id, ...d.data() }));

  const isAdminUser = isAdmin();
  const myUID = state.currentUser.uid;

  const visible = Array.from(all.values()).filter(m => {
    const deletedBy = m.deletedBy || {};
    if (state.currentFilter === 'trash') {
      if (isAdminUser) return Object.keys(deletedBy).length > 0;
      return !!deletedBy[myUID];
    }
    if (isAdminUser) return true;
    return !deletedBy[myUID];
  });

  const threadsMap = {};
  visible.forEach(m => {
    const tid = m.threadId || m.id;
    if (!threadsMap[tid]) threadsMap[tid] = { threadId: tid, messages: [], subject: m.subject, firstAt: Infinity };
    threadsMap[tid].messages.push(m);
    if (m.createdAt?.seconds && m.createdAt.seconds < threadsMap[tid].firstAt) {
      threadsMap[tid].subject = m.subject;
      threadsMap[tid].firstAt = m.createdAt.seconds;
    }
  });

  let threads = Object.values(threadsMap).map(t => {
    t.messages.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    const mine = t.messages.filter(m => m.toUserId === state.currentUser.uid);
    t.unread = mine.filter(m => !m.read).length;
    t.starred = t.messages.some(m => m.starred && m.toUserId === state.currentUser.uid);
    t.lastMsg = t.messages[t.messages.length - 1];
    t.lastAt = t.lastMsg.createdAt?.seconds || 0;
    t.isFromMe = t.lastMsg.fromUserId === state.currentUser.uid;
    t.tags = t.lastMsg.tags || [];
    return t;
  }).sort((a, b) => b.lastAt - a.lastAt);

  if (state.searchQuery) threads = threads.filter(t => t.messages.some(m => matchesSearch(m, state.searchQuery)));
  if (currentTagFilter) threads = threads.filter(t => t.tags.includes(currentTagFilter) || t.messages.some(m => (m.tags || []).includes(currentTagFilter)));

  state.threadsCache = threads;
  renderThreadList();
}

function renderThreadList() {
  const filter = state.currentFilter;
  const title = currentTagFilter
    ? (userTags.find(t => t.id === currentTagFilter)?.name || 'التصنيف')
    : {
        inbox: 'صندوق الوارد',
        sent: 'المُرسلة',
        starred: 'المميزة',
        trash: 'سلة المهملات',
        search: 'نتائج البحث'
      }[filter] || 'صندوق الوارد';

  const listHtml = state.threadsCache.map(t => {
    const last = t.lastMsg;
    const otherName = t.isFromMe ? last.toUserName : last.fromUserName;
    const unreadClass = t.unread > 0 ? 'unread' : '';
    const avatarClass = getAvatarGradient(otherName);

    const tagsHtml = (t.tags || []).length > 0 ? `
      <div class="msg-tags">
        ${(t.tags || []).slice(0, 3).map(tagId => {
          const tag = userTags.find(x => x.id === tagId);
          if (!tag) return '';
          return `<span class="msg-tag" style="--tag-color: ${tag.color};">${esc(tag.name)}</span>`;
        }).join('')}
      </div>
    ` : '';

    let deletedBadgeHtml = '';
    if (isAdmin()) {
      const deletedNames = getDeletedByNames(last);
      if (deletedNames.length > 0) {
        deletedBadgeHtml = `
          <div style="margin-top:6px;font-size:11px;color:var(--danger);display:flex;align-items:center;gap:4px;">
            <i data-lucide="trash-2" style="width:11px;height:11px;"></i>
            <span>محذوفة من: ${deletedNames.map(esc).join('، ')}</span>
          </div>
        `;
      }
    }

    return `
      <div class="msg-item ${t.threadId === state.selectedThreadId ? 'active' : ''} ${unreadClass}" data-thread="${t.threadId}">
        <div class="msg-swipe-actions right">
          <button class="swipe-action star" onclick="event.stopPropagation(); swipeStar('${t.threadId}')">
            <i data-lucide="star" class="w-5 h-5"></i><span>تمييز</span>
          </button>
          <button class="swipe-action delete" onclick="event.stopPropagation(); swipeDelete('${t.threadId}')">
            <i data-lucide="trash-2" class="w-5 h-5"></i><span>حذف</span>
          </button>
        </div>
        <div class="msg-item-inner" onclick="openThread('${t.threadId}')">
          <div class="msg-avatar ${avatarClass}">${initials(otherName)}</div>
          <div class="msg-content">
            <div class="msg-row-1">
              <span class="msg-from">${esc(otherName || '')}</span>
              <span class="msg-time">${timeAgo(last.createdAt)}</span>
            </div>
            <div class="msg-subject">
              ${t.starred ? '⭐ ' : ''}
              ${last.priority === 'urgent' ? '🔴 ' : ''}
              ${esc(t.subject)}
            </div>
            <div class="msg-preview">${t.isFromMe ? 'أنت: ' : ''}${esc((last.body || '').slice(0, 60))}</div>
            ${deletedBadgeHtml}
            ${tagsHtml}
            <div class="msg-meta">
              ${t.messages.length > 1 ? `<span class="msg-thread-count">💬 ${t.messages.length}</span>` : ''}
              ${t.unread ? `<span class="msg-unread-badge">${t.unread}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="inbox-shell fade-in">
      <div id="inboxList" class="inbox-list">
        <div class="inbox-list-header">
          <div>
            <div class="inbox-list-title">${title}</div>
            <div class="inbox-list-meta">${state.threadsCache.length} محادثة${state.searchQuery ? ` · "${esc(state.searchQuery)}"` : ''}</div>
          </div>
          <button onclick="renderInbox()" class="icon-btn icon-btn-ghost" title="تحديث"><i data-lucide="refresh-cw" class="w-4 h-4"></i></button>
        </div>
        <div class="inbox-list-body" id="inboxListBody">
          ${listHtml || '<div class="empty-state"><i data-lucide="mail-open"></i><p>لا رسائل</p></div>'}
        </div>
      </div>
      <div id="inboxReading" class="reading-pane">
        <div id="readingContent" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>
      </div>
    </div>
  `;
  renderThreadReading();
  icons();
  setupSwipeGestures();
}

function setupSwipeGestures() {
  if (window.innerWidth >= 768) return;

  document.querySelectorAll('.msg-item').forEach(item => {
    const inner = item.querySelector('.msg-item-inner');
    if (!inner) return;

    let startX = 0, currentX = 0, isDragging = false;

    const onStart = (e) => { startX = e.touches ? e.touches[0].clientX : e.clientX; currentX = 0; isDragging = true; inner.style.transition = 'none'; };
    const onMove = (e) => {
      if (!isDragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      currentX = Math.max(-160, Math.min(0, x - startX));
      inner.style.transform = `translateX(${currentX}px)`;
    };
    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      inner.style.transition = 'transform 0.2s ease';
      inner.style.transform = currentX < -80 ? 'translateX(-160px)' : 'translateX(0)';
    };

    inner.addEventListener('touchstart', onStart, { passive: true });
    inner.addEventListener('touchmove', onMove, { passive: true });
    inner.addEventListener('touchend', onEnd);
  });
}

window.swipeStar = async (threadId) => { await window.toggleStar(threadId); showToastAdvanced('تم التمييز ⭐', '', { type: 'success', icon: 'star', duration: 1500 }); };

window.swipeDelete = async (threadId) => {
  const ok = await confirmDialog('حذف المحادثة', 'متأكد؟');
  if (!ok) return;
  await window.trashThread(threadId, false);
  showToastAdvanced('تم الحذف 🗑️', '', { type: 'success', icon: 'trash-2', duration: 1500 });
};

window.renderInbox = renderInbox;

window.openThread = (threadId) => {
  state.selectedThreadId = threadId;
  state.expandedMsgs.clear();
  renderThreadList();
  if (window.innerWidth < 768) {
    $('#inboxList')?.classList.add('mobile-hidden');
    $('#inboxReading')?.classList.add('mobile-show');
  }
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (t) {
    t.messages.filter(m => m.toUserId === state.currentUser.uid && !m.read).forEach(m => {
      updateDoc(doc(db, 'messages', m.id), { read: true }).catch(() => {});
      m.read = true;
    });
    setTimeout(updateNotificationUI, 300);
  }
};

function renderThreadReading() {
  const t = state.threadsCache.find(x => x.threadId === state.selectedThreadId);
  const content = $('#readingContent');
  if (!content) return;

  if (!t) {
    content.innerHTML = `<div class="empty-state" style="flex:1;min-height:400px;"><i data-lucide="mail-open"></i><p>اختر رسالة لعرضها</p></div>`;
    icons();
    return;
  }

  state._currentThreadLastMsgId = t.lastMsg.id;
  const lastIdx = t.messages.length - 1;
  const isTrash = state.currentFilter === 'trash';

  const replyUserId = t.lastMsg.fromUserId === state.currentUser.uid ? t.lastMsg.toUserId : t.lastMsg.fromUserId;
  const replyUserName = t.lastMsg.fromUserId === state.currentUser.uid ? t.lastMsg.toUserName : t.lastMsg.fromUserName;

  const replyUserObj = state.allUsersCache.find(u => u.id === replyUserId);
  const canReply = replyUserObj ? canSendTo(replyUserObj) : false;

  const allDeletedByUIDs = new Set();
  t.messages.forEach(m => {
    Object.keys(m.deletedBy || {}).forEach(uid => allDeletedByUIDs.add(uid));
  });

  const deletedUsers = Array.from(allDeletedByUIDs).map(uid => {
    const u = state.allUsersCache.find(x => x.id === uid);
    return u || { id: uid, name: 'مستخدم' };
  });

  const showDeletedInfo = isAdmin() && deletedUsers.length > 0;

  const messagesHtml = t.messages.map((m, idx) => {
    const isMe = m.fromUserId === state.currentUser.uid;
    const isLatest = idx === lastIdx;
    const isExpanded = state.expandedMsgs.has(idx);
    const open = isLatest || isExpanded;
    const senderEmail = m.fromUserUsername ? `${m.fromUserUsername}@${EMAIL_DOMAIN}` : '';
    const dateStr = formatDate(m.createdAt);
    const avatarClass = getAvatarGradient(m.fromUserName);

    const msgTagsHtml = (m.tags || []).length > 0 ? `
      <div class="msg-tags" style="margin-top:8px;">
        ${(m.tags || []).map(tagId => {
          const tag = userTags.find(x => x.id === tagId);
          if (!tag) return '';
          return `<span class="msg-tag" style="--tag-color: ${tag.color};">${esc(tag.name)}</span>`;
        }).join('')}
      </div>
    ` : '';

    const attachmentsHtml = (m.attachments || []).length > 0 ? `
      <div class="message-attachments">
        <div class="message-attachments-title">📎 ${m.attachments.length} مرفق</div>
        <div class="message-attachments-grid">
          ${m.attachments.map(att => {
            const iconName = getFileIconLucide(att.type, att.name);
            const isImage = (att.type || '').startsWith('image/');
            return `
              <div class="message-attachment" onclick="window.open('${att.url}', '_blank')">
                ${isImage
                  ? `<div class="message-attachment-thumb-icon"><i data-lucide="image" class="w-5 h-5"></i></div>`
                  : `<div class="message-attachment-thumb-icon"><i data-lucide="${iconName}" class="w-5 h-5"></i></div>`}
                <div class="message-attachment-info">
                  <div class="message-attachment-name">${esc(att.name)}</div>
                  <div class="message-attachment-size">${formatFileSize(att.size || 0)}</div>
                </div>
                <i data-lucide="external-link" class="message-attachment-download w-4 h-4"></i>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : '';

    const msgDeletedNames = getDeletedByNames(m);
    const showMsgDeleteInfo = isAdmin() && msgDeletedNames.length > 0;
    const msgDeletedHtml = showMsgDeleteInfo ? `
      <div style="margin-top:12px;padding:8px 12px;background:var(--danger-bg);border-radius:6px;font-size:11.5px;color:var(--danger);display:flex;align-items:center;gap:6px;">
        <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
        <span>حذفها: ${msgDeletedNames.map(esc).join('، ')}</span>
      </div>
    ` : '';

    return `
      <div class="email-message">
        <div class="email-message-header" onclick="toggleMsgBody(${idx}, ${isLatest})">
          <div class="email-message-avatar ${avatarClass}">${initials(m.fromUserName)}</div>
          <div class="email-message-info">
            <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
              <span class="email-message-from">${isMe ? 'أنت' : esc(m.fromUserName)}</span>
              ${!isMe && senderEmail ? `<span style="font-size:11.5px;color:var(--text-tertiary);font-family:monospace;direction:ltr;">&lt;${esc(senderEmail)}&gt;</span>` : ''}
              ${m.priority === 'urgent' ? '<span class="priority-urgent">🔴 عاجل</span>' : ''}
              ${isLatest && t.messages.length > 1 ? '<span style="font-size:10.5px;background:var(--brand-primary-light);color:var(--brand-primary);padding:2px 8px;border-radius:4px;font-weight:600;">الأحدث</span>' : ''}
            </div>
            <div class="email-message-to">إلى: ${isMe ? esc(m.toUserName) : esc(state.currentUser.name)}</div>
            ${!open ? `<div class="email-message-preview">${esc((m.body || '').slice(0, 120))}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span class="email-message-time">${dateStr}</span>
            <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4" style="color:var(--text-tertiary);"></i>
          </div>
        </div>
        ${open ? `
          <div class="email-message-body">
            ${esc(m.body || '')}
            ${msgDeletedHtml}
            ${msgTagsHtml}
            ${attachmentsHtml}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const threadStarred = t.messages.some(m => m.starred);

  const inlineReplyHtml = !isTrash && !showDeletedInfo && canReply ? `
    <div class="inline-reply">
      <div class="inline-reply-header" onclick="toggleInlineReply()">
        <i data-lucide="reply" class="w-4 h-4"></i>
        <span>رد سريع على ${esc(replyUserName)}</span>
        <i data-lucide="chevron-down" class="w-4 h-4" style="margin-right:auto;" id="inlineReplyChevron"></i>
      </div>
      <div class="inline-reply-body" id="inlineReplyBody" style="display:none;">
        <textarea id="inlineReplyText" class="inline-reply-input" placeholder="اكتب ردك..."></textarea>
        <div class="inline-reply-actions">
          <button onclick="sendInlineReply('${replyUserId}', '${t.threadId}', '${esc(t.subject).replace(/'/g, "\\'")}')" class="btn-send-primary">
            <i data-lucide="send" class="w-4 h-4"></i><span>إرسال الرد</span>
          </button>
          <button onclick="toggleInlineReply()" class="btn-text">إلغاء</button>
        </div>
        <p id="inlineReplyStatus" class="send-status"></p>
      </div>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="reading-toolbar">
      <button onclick="backToList()" class="toolbar-btn" style="display:none;" id="mobileBackBtn"><i data-lucide="arrow-right" class="w-4 h-4"></i></button>

      ${!isTrash && !showDeletedInfo && canReply ? `
        <button onclick="replyToThread('${replyUserId}', '${esc(replyUserName).replace(/'/g, "\\'")}', '${t.threadId}', '${esc(t.subject).replace(/'/g, "\\'")}')" class="toolbar-btn primary"><i data-lucide="reply" class="w-4 h-4"></i><span>رد</span></button>
        <button onclick="replyAllToThread('${t.threadId}')" class="toolbar-btn primary"><i data-lucide="reply-all" class="w-4 h-4"></i><span>رد على الكل</span></button>
        <button onclick="toggleStar('${t.threadId}')" class="toolbar-btn ${threadStarred ? 'primary' : ''}"><i data-lucide="star" class="w-4 h-4" ${threadStarred ? 'fill="currentColor"' : ''}></i><span>${threadStarred ? 'مميزة' : 'تمييز'}</span></button>
      ` : ''}

      <button onclick="trashThread('${t.threadId}', ${isTrash})" class="toolbar-btn ${isTrash ? 'primary' : 'danger'}">
        <i data-lucide="${isTrash ? 'rotate-ccw' : 'trash-2'}" class="w-4 h-4"></i><span>${isTrash ? 'استعادة' : 'حذف'}</span>
      </button>

      ${isAdmin() && (deletedUsers.length > 0 || t.messages.some(m => Object.keys(m.deletedBy || {}).length > 0)) ? `
        <button onclick="restoreThreadForAll('${t.threadId}')" class="toolbar-btn primary" title="استعادة الرسائل للجميع">
          <i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>استعادة للكل</span>
        </button>
      ` : ''}

      ${isTrash && isAdmin() ? `<button onclick="permanentDelete('${t.threadId}')" class="toolbar-btn danger"><i data-lucide="x-circle" class="w-4 h-4"></i><span>حذف نهائي</span></button>` : ''}

      <div class="toolbar-spacer"></div>

      <button onclick="toggleAllMsgs()" class="toolbar-btn" title="فتح/طي الكل"><i data-lucide="chevrons-down-up" class="w-4 h-4"></i></button>
    </div>

    <div class="reading-body">
      <h1 class="reading-subject">${esc(t.subject)}</h1>
      <div class="reading-meta">
        <span><i data-lucide="message-square" class="w-3 h-3 inline"></i> ${t.messages.length} رسالة</span>
        <span><i data-lucide="clock" class="w-3 h-3 inline"></i> ${timeAgo(t.lastMsg.createdAt)}</span>
      </div>

      ${showDeletedInfo ? `
        <div style="background:var(--danger-bg);border:1px solid #F0B8BB;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:10px;">
          <i data-lucide="trash-2" class="w-5 h-5" style="color:var(--danger);flex-shrink:0;margin-top:2px;"></i>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:13px;color:var(--danger);">رسالة محذوفة (للأرشيف)</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
              حذفها من عندهم: <strong>${deletedUsers.map(u => esc(u.name)).join('، ')}</strong>
            </div>
          </div>
        </div>
      ` : ''}

      ${!canReply && !isTrash && !showDeletedInfo ? `
        <div style="background:var(--warning-bg);border:1px solid #F0DDA0;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:#7A5D00;">
          <i data-lucide="shield-alert" class="w-4 h-4" style="flex-shrink:0;"></i>
          <span>مش مسموحلك ترد على هذه المحادثة حسب صلاحياتك.</span>
        </div>
      ` : ''}

      ${messagesHtml}
      ${inlineReplyHtml}
    </div>
  `;

  const mobileBackBtn = document.getElementById('mobileBackBtn');
  if (mobileBackBtn && window.innerWidth < 768) mobileBackBtn.style.display = 'inline-flex';

  icons();
}

window.toggleInlineReply = () => {
  const body = document.getElementById('inlineReplyBody');
  const ch = document.getElementById('inlineReplyChevron');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = 'flex';
    ch?.setAttribute('data-lucide', 'chevron-up');
    setTimeout(() => document.getElementById('inlineReplyText')?.focus(), 100);
  } else {
    body.style.display = 'none';
    ch?.setAttribute('data-lucide', 'chevron-down');
  }
  icons();
};

window.sendInlineReply = async (toUserId, threadId, subject) => {
  const text = document.getElementById('inlineReplyText')?.value.trim();
  const status = document.getElementById('inlineReplyStatus');
  if (!text) { if (status) { status.style.color = 'var(--danger)'; status.textContent = 'اكتب رد'; } return; }

  const recipient = state.allUsersCache.find(u => u.id === toUserId);
  if (!canSendTo(recipient)) {
    if (status) { status.style.color = 'var(--danger)'; status.textContent = 'غير مسموح'; }
    return;
  }

  try {
    const toUser = state.allUsersCache.find(u => u.id === toUserId);
    const msgRef = doc(collection(db, 'messages'));
    await setDoc(msgRef, {
      subject: subject.startsWith('رد:') ? subject : 'رد: ' + subject,
      body: text, priority: 'normal',
      fromUserId: state.currentUser.uid,
      fromUserName: state.currentUser.name,
      fromUserUsername: state.currentUser.username,
      toUserId, toUserName: toUser?.name || '',
      read: false, threadId,
      parentId: state._currentThreadLastMsgId,
      notified: false, starred: false,
      deletedBy: {},
      attachments: [], tags: [],
      createdAt: serverTimestamp()
    });

    if (status) { status.style.color = 'var(--success)'; status.textContent = '✅ تم الإرسال!'; }
    showToastAdvanced('تم الإرسال ✅', '', { type: 'success', icon: 'send', duration: 2000 });
    document.getElementById('inlineReplyText').value = '';
    setTimeout(() => { toggleInlineReply(); renderInbox(); }, 800);
  } catch (e) {
    if (status) { status.style.color = 'var(--danger)'; status.textContent = e.message; }
  }
};

window.replyAllToThread = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  const participants = new Set();
  t.messages.forEach(m => {
    if (m.fromUserId && m.fromUserId !== state.currentUser.uid) participants.add(m.fromUserId);
    if (m.toUserId && m.toUserId !== state.currentUser.uid) participants.add(m.toUserId);
  });

  await window.openCompose();
  $('#cThreadId').value = threadId;
  $('#cSubject').value = t.subject.startsWith('رد:') ? t.subject : 'رد: ' + t.subject;

  const list = Array.from(participants).filter(uid => {
    const u = state.allUsersCache.find(x => x.id === uid);
    return u && canSendTo(u);
  });

  if (list.length > 0) {
    const u = state.allUsersCache.find(x => x.id === list[0]);
    if (u) window.addRecipient('to', u);
  }
  if (list.length > 1) {
    const u2 = state.allUsersCache.find(x => x.id === list[1]);
    if (u2) window.addRecipient('cc', u2);
  }
  $('#composeTitle').textContent = 'رد على الكل';
};

window.toggleMsgBody = (idx, isLatest) => {
  if (isLatest) return;
  if (state.expandedMsgs.has(idx)) state.expandedMsgs.delete(idx);
  else state.expandedMsgs.add(idx);
  renderThreadReading();
};

window.toggleAllMsgs = () => {
  const t = state.threadsCache.find(x => x.threadId === state.selectedThreadId);
  if (!t) return;
  const lastIdx = t.messages.length - 1;
  let allOpen = true;
  for (let i = 0; i < lastIdx; i++) if (!state.expandedMsgs.has(i)) { allOpen = false; break; }
  if (allOpen) state.expandedMsgs.clear();
  else for (let i = 0; i < lastIdx; i++) state.expandedMsgs.add(i);
  renderThreadReading();
};

window.backToList = () => {
  $('#inboxList')?.classList.remove('mobile-hidden');
  $('#inboxReading')?.classList.remove('mobile-show');
  state.selectedThreadId = null;
  state.expandedMsgs.clear();
  renderThreadList();
};

window.toggleStar = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  const newVal = !t.messages.some(m => m.starred);
  for (const m of t.messages) {
    if (m.toUserId === state.currentUser.uid || m.fromUserId === state.currentUser.uid) {
      await updateDoc(doc(db, 'messages', m.id), { starred: newVal }).catch(() => {});
      m.starred = newVal;
    }
  }
  renderThreadReading();
};

/* ═══════ TRASH ═══════ */
window.trashThread = async (threadId, isTrash) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  const myUID = state.currentUser.uid;

  for (const m of t.messages) {
    const deletedBy = m.deletedBy || {};

    if (isTrash) {
      const newDeletedBy = { ...deletedBy };
      delete newDeletedBy[myUID];
      await updateDoc(doc(db, 'messages', m.id), { deletedBy: newDeletedBy }).catch(() => {});
      m.deletedBy = newDeletedBy;
    } else {
      const newDeletedBy = { ...deletedBy, [myUID]: new Date().toISOString() };
      await updateDoc(doc(db, 'messages', m.id), { deletedBy: newDeletedBy }).catch(() => {});
      m.deletedBy = newDeletedBy;
    }
  }

  if (state.currentFilter === 'trash' && isTrash) renderInbox();
  else if (state.currentFilter !== 'trash' && !isTrash) renderInbox();
  else renderThreadReading();
};

window.permanentDelete = async (threadId) => {
  if (!isAdmin()) {
    showToastAdvanced('غير مسموح', 'الأدمن بس اللي يقدر يحذف نهائياً', { type: 'error', icon: 'shield-x' });
    return;
  }

  const ok = await confirmDialog('حذف نهائي', 'هيتم حذف الرسائل نهائيًا من النظام (لكل المستخدمين). متأكد؟');
  if (!ok) return;

  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  for (const m of t.messages) {
    await deleteDoc(doc(db, 'messages', m.id));
  }

  state.selectedThreadId = null;
  showToastAdvanced('تم الحذف النهائي 🗑️', '', { type: 'success', icon: 'trash-2', duration: 2500 });
  renderInbox();
};

window.restoreThreadForAll = async (threadId) => {
  if (!isAdmin()) {
    showToastAdvanced('غير مسموح', '', { type: 'error', icon: 'shield-x' });
    return;
  }

  const ok = await confirmDialog('استعادة للكل', 'هيتم إرجاع الرسائل لكل المستخدمين اللي حذفوها. متأكد؟');
  if (!ok) return;

  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  for (const m of t.messages) {
    await updateDoc(doc(db, 'messages', m.id), { deletedBy: {} }).catch(() => {});
    m.deletedBy = {};
  }

  showToastAdvanced('تم الاستعادة ✅', 'الرسائل رجعت للكل', { type: 'success', icon: 'check-circle', duration: 2500 });
  renderThreadReading();
};

async function renderStarred() { state.currentFilter = 'starred'; state.searchQuery = ''; await renderInbox(); }
async function renderTrash() { state.currentFilter = 'trash'; state.searchQuery = ''; await renderInbox(); }

/* ═══════ SENT ═══════ */
async function renderSent() {
  const q = query(collection(db, 'messages'), where('fromUserId', '==', state.currentUser.uid));
  const snap = await getDocs(q);
  const list = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(m => !isHiddenFromMe(m))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const grouped = {};
  const unique = [];
  list.forEach(m => {
    if (m.isBroadcast && m.createdAt?.seconds) {
      const key = `${m.subject}_${m.createdAt.seconds}_${m.body?.slice(0, 20)}`;
      if (!grouped[key]) { grouped[key] = { ...m, count: 1 }; unique.push(grouped[key]); }
      else grouped[key].count++;
    } else unique.push({ ...m, count: 1 });
  });

  const rows = unique.map(m => `
    <div class="msg-item" onclick="openThread('${m.threadId || m.id}')">
      <div class="msg-item-inner">
        <div class="msg-avatar" style="${m.isBroadcast ? 'background:linear-gradient(135deg,#FA709A,#FEE140);' : 'background:linear-gradient(135deg,#43E97B,#38F9D7);'}">
          <i data-lucide="${m.isBroadcast ? 'megaphone' : 'send'}" class="w-4 h-4"></i>
        </div>
        <div class="msg-content">
          <div class="msg-row-1">
            <span class="msg-from">${m.isBroadcast ? `📢 إعلان عام (${m.count})` : `إلى: ${esc(m.toUserName || '')}`}</span>
            <span class="msg-time">${timeAgo(m.createdAt)}</span>
          </div>
          <div class="msg-subject">${esc(m.subject)}</div>
          <div class="msg-preview">${esc((m.body || '').slice(0, 80))}</div>
        </div>
      </div>
    </div>
  `).join('');

  $('#pageContent').innerHTML = `
    <div class="dashboard" style="max-width:900px;">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div><h1 class="dashboard-title">الرسائل المُرسلة</h1><p class="dashboard-date">${list.length} رسالة</p></div>
      </div>
      <div class="data-table-wrapper" style="padding:0;">
        ${rows || '<div class="empty-state"><i data-lucide="send"></i><p>لا رسائل مُرسلة</p></div>'}
      </div>
    </div>
  `;
  icons();
}

/* ═══════ COMPOSE ═══════ */
window.openCompose = async () => {
  await loadUsersCache();
  await loadDepartmentsCache();

  recipientChips = { to: [], cc: [], bcc: [] };
  activeChipField = 'to';
  activeSuggestionIdx = -1;
  currentSuggestions = [];

  $('#cSubject').value = '';
  $('#cBody').value = '';
  $('#cBody').dataset.fromTemplate = '';
  $('#cThreadId').value = '';
  $('#cDraftId').value = '';
  $('#cUrgent').checked = false;
  $('#cDept').checked = false;
  $('#cBroadcast').checked = false;

  $('#toChips').innerHTML = '';
  $('#ccChips').innerHTML = '';
  $('#bccChips').innerHTML = '';
  $('#toInput').value = '';
  $('#ccInput').value = '';
  $('#bccInput').value = '';
  $('#toChipsWrapper').style.opacity = '1';
  $('#toInput').disabled = false;

  hide($('#ccRow'));
  hide($('#bccRow'));
  hide($('#optionsField'));
  hide($('#templateRow'));
  $('#extraFieldsIcon')?.setAttribute('data-lucide', 'plus');

  const deptSel = $('#deptSelect');
  const deptToggleWrap = $('#deptToggleWrap');
  if (isAdmin()) {
    if (deptSel) deptSel.innerHTML = '<option value="">— اختر قسم —</option>' + state.allDeptsCache.map(d => `<option value="${d.id}">${esc(d.name)} (${getUsersByDept(d.id).length})</option>`).join('');
    const label = $('#deptSendLabel'); if (label) label.textContent = '📢 قسم كامل';
    if (deptToggleWrap) deptToggleWrap.style.display = 'inline-flex';
  } else if (isDeptManager()) {
    const myDepts = getMyManagedDepts();
    if (deptSel) deptSel.innerHTML = '<option value="">— اختر قسم —</option>' + myDepts.map(d => `<option value="${d.id}">${esc(d.name)} (${getUsersByDept(d.id).length})</option>`).join('');
    const label = $('#deptSendLabel'); if (label) label.textContent = '📢 فريقي';
    if (deptToggleWrap) deptToggleWrap.style.display = 'inline-flex';
  } else {
    if (deptToggleWrap) deptToggleWrap.style.display = 'none';
  }

  const broadcastWrap = $('#broadcastToggleWrap');
  if (broadcastWrap) {
    const canBroadcast = isOwner() || (state.currentUser?.permissions || []).includes('can_broadcast');
    broadcastWrap.style.display = canBroadcast ? 'inline-flex' : 'none';
    if (canBroadcast) {
      const cntEl = $('#broadcastCount');
      if (cntEl) cntEl.textContent = state.allUsersCache.filter(u => u.id !== state.currentUser.uid && u.isActive !== false).length;
    }
  }

  attachedFiles = [];
  selectedTags = [];
  renderAttachments();

  $('#composeTitle').textContent = 'رسالة جديدة';
  const statusEl = $('#cStatus');
  statusEl.textContent = '';
  statusEl.style.color = '';

  $('#composeModal').style.display = 'flex';
  icons();
  setTimeout(() => $('#toInput').focus(), 150);

  setupChipInput('to');
  setupChipInput('cc');
  setupChipInput('bcc');
};

window.closeCompose = () => {
  $('#composeModal').style.display = 'none';
  $('#composeTitle').textContent = 'رسالة جديدة';
  attachedFiles = [];
  selectedTags = [];
};

/* ═══════ RECIPIENT CHIPS ═══════ */
function renderRecipientChips() {
  ['to', 'cc', 'bcc'].forEach(field => {
    const container = document.getElementById(field + 'Chips');
    if (!container) return;

    container.innerHTML = recipientChips[field].map((u, idx) => {
      let chipClass = '';
      if (u.role === 'admin') chipClass = 'admin-chip';
      else if (u.role === 'owner') chipClass = 'owner-chip';

      return `
        <span class="recipient-chip ${chipClass}" data-uid="${u.id}">
          <span class="chip-avatar ${getAvatarGradient(u.name)}">${initials(u.name)}</span>
          <span class="chip-name">${esc(u.name)}</span>
          <button type="button" class="chip-remove" onclick="removeRecipient('${field}', ${idx})" title="حذف">
            <i data-lucide="x" class="w-3 h-3"></i>
          </button>
        </span>
      `;
    }).join('');
  });
  icons();
}

function setupChipInput(field) {
  const input = document.getElementById(field + 'Input');
  const suggestions = document.getElementById(field + 'Suggestions');
  if (!input || !suggestions) return;

  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  newInput.addEventListener('focus', () => {
    activeChipField = field;
  });

  newInput.addEventListener('input', () => {
    const q = newInput.value.trim();
    if (!q) {
      suggestions.classList.add('hidden');
      currentSuggestions = [];
      return;
    }
    showSuggestions(field, q);
  });

  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentSuggestions.length > 0) {
        const pick = activeSuggestionIdx >= 0 ? currentSuggestions[activeSuggestionIdx] : currentSuggestions[0];
        addRecipient(field, pick);
      }
      newInput.value = '';
      suggestions.classList.add('hidden');
      currentSuggestions = [];
      activeSuggestionIdx = -1;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentSuggestions.length > 0) {
        activeSuggestionIdx = Math.min(activeSuggestionIdx + 1, currentSuggestions.length - 1);
        updateSuggestionHighlight();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentSuggestions.length > 0) {
        activeSuggestionIdx = Math.max(activeSuggestionIdx - 1, 0);
        updateSuggestionHighlight();
      }
    } else if (e.key === 'Backspace' && !newInput.value && recipientChips[field].length > 0) {
      recipientChips[field].pop();
      renderRecipientChips();
      onChipsChanged();
    } else if (e.key === 'Escape') {
      suggestions.classList.add('hidden');
      currentSuggestions = [];
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#' + field + 'ChipsWrapper')) {
      suggestions.classList.add('hidden');
    }
  }, { capture: true });
}

function showSuggestions(field, query) {
  const suggestions = document.getElementById(field + 'Suggestions');
  if (!suggestions) return;

  const allUsers = getAllowedRecipients();
  const alreadyAdded = recipientChips[field].map(u => u.id);

  const q = query.toLowerCase();
  const matches = allUsers
    .filter(u => !alreadyAdded.includes(u.id))
    .filter(u => {
      const name = (u.name || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      return name.includes(q) || username.includes(q);
    })
    .slice(0, 8);

  currentSuggestions = matches;
  activeSuggestionIdx = -1;

  if (matches.length === 0) {
    suggestions.innerHTML = '<div class="suggestions-empty">لا نتائج</div>';
    suggestions.classList.remove('hidden');
    return;
  }

  const roleTagMap = {
    owner: '👑',
    chairman: '🎩',
    vice_chairman: '🎗️',
    admin: '🛡️',
    manager: '👔',
    user: '👤'
  };

  suggestions.innerHTML = matches.map((u, idx) => {
    const dept = u.departmentId ? getDeptById(u.departmentId) : null;
    return `
      <div class="suggestion-item" data-idx="${idx}" onmousedown="event.preventDefault()" onclick="addRecipientFromSuggestion('${field}', ${idx})">
        <div class="suggestion-avatar ${getAvatarGradient(u.name)}">${initials(u.name)}</div>
        <div class="suggestion-info">
          <div class="suggestion-name">${esc(u.name)} <span class="suggestion-role-tag">${roleTagMap[u.role] || ''} ${roleLabels[u.role] || ''}</span></div>
          <div class="suggestion-sub">@${esc(u.username)}${dept ? ' · ' + esc(dept.name) : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  suggestions.classList.remove('hidden');
  icons();
}

function updateSuggestionHighlight() {
  const suggestions = document.getElementById(activeChipField + 'Suggestions');
  if (!suggestions) return;
  suggestions.querySelectorAll('.suggestion-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === activeSuggestionIdx);
  });
}

window.addRecipientFromSuggestion = (field, idx) => {
  const user = currentSuggestions[idx];
  if (user) window.addRecipient(field, user);
};

window.addRecipient = (field, user) => {
  if (!user) return;
  const alreadyAdded = recipientChips[field].some(u => u.id === user.id);
  if (alreadyAdded) return;

  recipientChips[field].push(user);
  renderRecipientChips();

  const input = document.getElementById(field + 'Input');
  if (input) input.value = '';

  const suggestions = document.getElementById(field + 'Suggestions');
  if (suggestions) suggestions.classList.add('hidden');
  currentSuggestions = [];
  activeSuggestionIdx = -1;

  onChipsChanged();
  if (input) input.focus();
};

window.removeRecipient = (field, idx) => {
  recipientChips[field].splice(idx, 1);
  renderRecipientChips();
  onChipsChanged();
};

function onChipsChanged() {
  const hasAdminRecipient = recipientChips.to.some(u => u.role === 'admin' || u.role === 'owner');
  const senderRole = state.currentUser?.role;
  const senderIsDeptMgr = state.allDeptsCache.some(d => d.managerId === state.currentUser?.uid);
  const canUseTemplates = senderRole === 'user' || senderRole === 'manager' || senderIsDeptMgr;

  if (hasAdminRecipient && canUseTemplates) {
    renderAdminTemplates();
    show($('#templateRow'));
  } else {
    hide($('#templateRow'));
  }
}

window.toggleExtraFields = () => {
  const ccRow = $('#ccRow');
  const bccRow = $('#bccRow');
  const optionsField = $('#optionsField');

  const isHidden = ccRow.classList.contains('hidden');
  if (isHidden) {
    show(ccRow);
    show(bccRow);
    show(optionsField);
    $('#extraFieldsIcon')?.setAttribute('data-lucide', 'x');
  } else {
    hide(ccRow);
    hide(bccRow);
    hide(optionsField);
    recipientChips.cc = [];
    recipientChips.bcc = [];
    renderRecipientChips();
    $('#extraFieldsIcon')?.setAttribute('data-lucide', 'plus');
  }
  icons();
};

function renderAdminTemplates() {
  const picker = $('#templatePicker');
  if (!picker) return;

  picker.innerHTML = ADMIN_MESSAGE_TEMPLATES.map(t => `
    <button type="button" class="template-btn" onclick="applyAdminTemplate('${t.id}')">
      <i data-lucide="${t.icon}"></i>
      <span>${esc(t.label)}</span>
    </button>
  `).join('');
  icons();
}

window.applyAdminTemplate = (templateId) => {
  const tpl = ADMIN_MESSAGE_TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return;

  const subjEl = $('#cSubject');
  const bodyEl = $('#cBody');

  if (!subjEl.value.trim()) subjEl.value = tpl.label;

  if (!bodyEl.value.trim() || bodyEl.dataset.fromTemplate === '1') {
    bodyEl.value = tpl.body;
    bodyEl.dataset.fromTemplate = '1';
  } else {
    bodyEl.value = tpl.body + '\n' + bodyEl.value;
  }

  bodyEl.focus();
  bodyEl.setSelectionRange(bodyEl.value.length, bodyEl.value.length);

  showToastAdvanced('تم تطبيق القالب ✅', `${tpl.label} — أضف ملاحظتك`, {
    type: 'info', icon: 'file-text', duration: 2500
  });
};

window.toggleBroadcast = () => {
  const checked = $('#cBroadcast').checked;
  if (checked) {
    $('#cDept').checked = false;
    $('#toChipsWrapper').style.opacity = '0.5';
    $('#toInput').disabled = true;
  } else {
    $('#toChipsWrapper').style.opacity = '1';
    $('#toInput').disabled = false;
  }
};

window.toggleDeptSend = () => {
  const checked = $('#cDept').checked;
  if (checked) {
    $('#cBroadcast').checked = false;
    $('#toChipsWrapper').style.opacity = '0.5';
    $('#toInput').disabled = true;
  } else {
    $('#toChipsWrapper').style.opacity = '1';
    $('#toInput').disabled = false;
  }
};

/* ═══════ FILE UPLOAD — GoFile ═══════ */
window.handleFiles = async (event) => {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const maxSize = 100 * 1024 * 1024;
  const maxFiles = 10;

  for (const file of files) {
    if (attachedFiles.length >= maxFiles) {
      showToastAdvanced('تجاوزت الحد الأقصى', `أقصى عدد ${maxFiles} ملفات`, { type: 'warning', icon: 'alert-triangle' });
      break;
    }
    if (file.size > maxSize) {
      showToastAdvanced('الملف كبير', `${file.name} أكبر من 100MB`, { type: 'error', icon: 'alert-circle' });
      continue;
    }

    const fileObj = {
      id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0,
      status: 'pending',
      url: null,
      path: null
    };
    attachedFiles.push(fileObj);
    renderAttachments();
    uploadFile(fileObj);
  }

  event.target.value = '';
};

async function uploadFile(fileObj) {
  try {
    fileObj.status = 'uploading';
    fileObj.progress = 10;
    renderAttachments();

    const formData = new FormData();
    formData.append('file', fileObj.file);

    const response = await fetch('https://upload.gofile.io/uploadfile', {
      method: 'POST',
      body: formData
    });

    fileObj.progress = 90;
    renderAttachments();

    if (!response.ok) {
      throw new Error(`فشل الرفع: ${response.status}`);
    }

    const result = await response.json();

    if (result.status !== 'ok') {
      throw new Error(result.status || 'فشل الرفع');
    }

    fileObj.url = result.data.downloadPage;
    fileObj.path = result.data.id;
    fileObj.size = result.data.size || fileObj.size;
    fileObj.status = 'done';
    fileObj.progress = 100;
    renderAttachments();

    showToastAdvanced('تم الرفع ✅', fileObj.name, {
      type: 'success', icon: 'check-circle', duration: 2000
    });
  } catch (e) {
    console.error('GoFile upload error:', e);
    fileObj.status = 'error';
    renderAttachments();
    showToastAdvanced('فشل الرفع', e.message, { type: 'error', icon: 'alert-circle' });
  }
}

function renderAttachments() {
  const section = document.getElementById('attachmentsSection');
  const list = document.getElementById('attachmentsList');
  const count = document.getElementById('attachmentsCount');

  if (!section || !list) return;

  if (attachedFiles.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  if (count) count.textContent = attachedFiles.length;

  list.innerHTML = attachedFiles.map(f => {
    const cat = getFileIcon(f.type, f.name);
    const iconName = getFileIconLucide(f.type, f.name);
    const sizeText = f.status === 'uploading' ? `جاري الرفع... ${f.progress}%` : formatFileSize(f.size);
    return `
      <div class="attachment-item ${f.status === 'uploading' ? 'uploading' : ''} ${f.status === 'error' ? 'error' : ''}" data-file-id="${f.id}">
        <div class="attachment-icon ${cat}"><i data-lucide="${iconName}" class="w-4 h-4"></i></div>
        <div class="attachment-info">
          <div class="attachment-name">${esc(f.name)}</div>
          <div class="attachment-size">${sizeText}</div>
          ${f.status === 'uploading' ? `<div class="attachment-progress"><div class="attachment-progress-bar" style="width: ${f.progress}%;"></div></div>` : ''}
        </div>
        <button type="button" class="attachment-remove" onclick="removeAttachment('${f.id}')" title="حذف">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
    `;
  }).join('');
  icons();
}

window.removeAttachment = (fileId) => {
  const idx = attachedFiles.findIndex(f => f.id === fileId);
  if (idx === -1) return;
  attachedFiles.splice(idx, 1);
  renderAttachments();
};

window.clearAttachments = () => {
  attachedFiles = [];
  renderAttachments();
};

/* ═══════ SEND ═══════ */
window.sendMessage = async () => {
  const broadcast = $('#cBroadcast').checked && (isOwner() || (state.currentUser?.permissions || []).includes('can_broadcast'));
  const deptSend = $('#cDept').checked;
  const toUserId = recipientChips.to[0]?.id || '';
  const ccUserId = recipientChips.cc[0]?.id || '';
  const bccUserId = recipientChips.bcc[0]?.id || '';
  const deptId = $('#deptSelect').value;
  const subject = $('#cSubject').value.trim();
  const body = $('#cBody').value.trim();
  const replyToThread = $('#cThreadId')?.value || null;
  const priority = $('#cUrgent').checked ? 'urgent' : 'normal';
  const status = $('#cStatus');

  status.style.color = '';
  status.textContent = '';

  if (!broadcast && !deptSend && recipientChips.to.length === 0) {
    status.style.color = 'var(--danger)';
    status.textContent = 'أضف مستلم';
    return;
  }
  if (deptSend && !deptId) {
    status.style.color = 'var(--danger)';
    status.textContent = 'اختر القسم';
    return;
  }
  if (!subject) {
    status.style.color = 'var(--danger)';
    status.textContent = 'اكتب الموضوع';
    return;
  }

  if (!broadcast && !deptSend) {
    for (const recipient of recipientChips.to) {
      if (!canSendTo(recipient)) {
        status.style.color = 'var(--danger)';
        status.textContent = `غير مسموح: ${recipient.name}`;
        showToastAdvanced('غير مسموح', `مش مسموحلك تبعت لـ ${recipient.name}`, {
          type: 'error', icon: 'shield-x', duration: 4000
        });
        return;
      }
    }
  }

  const uploading = attachedFiles.some(f => f.status === 'uploading');
  if (uploading) {
    status.style.color = 'var(--danger)';
    status.textContent = 'استنى المرفقات';
    return;
  }

  const attachmentsData = attachedFiles.filter(f => f.status === 'done').map(f => ({
    name: f.name, size: f.size, type: f.type, url: f.url, path: f.path
  }));

  const emailData = {
    subject, body, priority,
    toUserId: toUserId || null,
    ccUserId: ccUserId || null,
    bccUserId: bccUserId || null,
    replyToThread, broadcast, deptSend, deptId,
    isBroadcast: broadcast,
    fromUserId: state.currentUser.uid,
    fromUserName: state.currentUser.name,
    fromUserUsername: state.currentUser.username,
    attachments: attachmentsData,
    tags: selectedTags.slice()
  };

  closeCompose();

  const undoToast = document.createElement('div');
  undoToast.className = 'toast toast-warning';
  undoToast.id = 'undoSendToast';
  undoToast.innerHTML = `
    <div class="toast-icon warning"><i data-lucide="clock" class="w-4 h-4"></i></div>
    <div class="toast-content">
      <div class="toast-title">جاري الإرسال...</div>
      <div class="toast-body">اضغط "تراجع" لإلغاء</div>
    </div>
    <button class="toast-action" onclick="undoSend()">تراجع</button>
  `;
  document.getElementById('toastContainer').appendChild(undoToast);
  icons();

  lastSentData = emailData;

  pendingSendTimeout = setTimeout(async () => {
    await performSend(emailData);
    const t = document.getElementById('undoSendToast');
    if (t) t.remove();
  }, 5000);
};

window.undoSend = () => {
  if (pendingSendTimeout) {
    clearTimeout(pendingSendTimeout);
    pendingSendTimeout = null;
    lastSentData = null;
    document.getElementById('undoSendToast')?.remove();
    showToastAdvanced('تم الإلغاء ⏹️', '', { type: 'info', icon: 'x-circle', duration: 2500 });
  }
};

async function performSend(data) {
  try {
    if (data.broadcast) {
      const recipients = state.allUsersCache.filter(u => u.id !== state.currentUser.uid && u.isActive !== false);
      for (const u of recipients) {
        const msgRef = doc(collection(db, 'messages'));
        await setDoc(msgRef, {
          subject: data.subject, body: data.body, priority: data.priority,
          fromUserId: data.fromUserId,
          fromUserName: data.fromUserName,
          fromUserUsername: data.fromUserUsername,
          toUserId: u.id, toUserName: u.name,
          read: false, isBroadcast: true,
          threadId: msgRef.id,
          notified: false, starred: false,
          deletedBy: {},
          attachments: data.attachments || [],
          tags: data.tags || [],
          createdAt: serverTimestamp()
        });
      }
      showToastAdvanced('تم الإرسال ✅', `وصلت لـ ${recipients.length} مستخدم`, { type: 'success', icon: 'check-circle', duration: 3500 });
    } else if (data.deptSend) {
      const recipients = getUsersByDept(data.deptId).filter(u => u.id !== state.currentUser.uid);
      for (const u of recipients) {
        const msgRef = doc(collection(db, 'messages'));
        await setDoc(msgRef, {
          subject: data.subject, body: data.body, priority: data.priority,
          fromUserId: data.fromUserId,
          fromUserName: data.fromUserName,
          fromUserUsername: data.fromUserUsername,
          toUserId: u.id, toUserName: u.name,
          read: false, isBroadcast: false,
          threadId: msgRef.id,
          notified: false, starred: false,
          deletedBy: {},
          attachments: data.attachments || [],
          tags: data.tags || [],
          createdAt: serverTimestamp()
        });
      }
      showToastAdvanced('تم الإرسال ✅', `وصلت لـ ${recipients.length} موظف`, { type: 'success', icon: 'check-circle', duration: 3500 });
    } else {
      const toUser = state.allUsersCache.find(u => u.id === data.toUserId);
      const ccUser = data.ccUserId ? state.allUsersCache.find(u => u.id === data.ccUserId) : null;
      const bccUser = data.bccUserId ? state.allUsersCache.find(u => u.id === data.bccUserId) : null;

      const msgRef = doc(collection(db, 'messages'));
      await setDoc(msgRef, {
        subject: data.subject, body: data.body, priority: data.priority,
        fromUserId: data.fromUserId,
        fromUserName: data.fromUserName,
        fromUserUsername: data.fromUserUsername,
        toUserId: data.toUserId, toUserName: toUser?.name || '',
        ccUserId: data.ccUserId || null,
        ccUserName: ccUser?.name || null,
        bccUserId: data.bccUserId || null,
        bccUserName: bccUser?.name || null,
        read: false,
        threadId: data.replyToThread || msgRef.id,
        parentId: data.replyToThread ? (state._currentThreadLastMsgId || null) : null,
        notified: false, starred: false,
        deletedBy: {},
        attachments: data.attachments || [],
        tags: data.tags || [],
        createdAt: serverTimestamp()
      });

      showToastAdvanced('تم الإرسال ✅', `وصلت لـ ${toUser?.name || ''}`, { type: 'success', icon: 'check-circle', duration: 3000 });
    }

    if (document.getElementById('inboxList')) renderInbox();
  } catch (e) {
    console.error('SEND ERROR:', e);
    showToastAdvanced('خطأ في الإرسال', e.message, {
      type: 'error', icon: 'alert-circle',
      actionLabel: 'إعادة',
      onAction: () => performSend(data),
      duration: 8000
    });
  }
}

window.saveDraft = async () => {
  const toUserId = recipientChips.to[0]?.id || '';
  const subject = $('#cSubject').value.trim();
  const body = $('#cBody').value.trim();
  const status = $('#cStatus');

  if (!subject && !body) {
    status.style.color = 'var(--danger)';
    status.textContent = 'اكتب حاجة';
    return;
  }

  try {
    const draftId = $('#cDraftId').value;
    const draftData = {
      toUserId: toUserId || null,
      subject,
      body,
      updatedAt: serverTimestamp()
    };

    if (draftId) {
      await updateDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId), draftData);
    } else {
      draftData.createdAt = serverTimestamp();
      const r = await addDoc(collection(db, 'users', state.currentUser.uid, 'drafts'), draftData);
      $('#cDraftId').value = r.id;
    }

    showToastAdvanced('تم الحفظ ✅', 'المسودة محفوظة في "المسودات"', {
      type: 'success', icon: 'file-text', duration: 2500
    });

    updateDraftsBadge();
    setTimeout(() => closeCompose(), 1000);
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = e.message;
  }
};

window.replyToThread = async (userId, userName, threadId, subject) => {
  await window.openCompose();
  const recipient = state.allUsersCache.find(u => u.id === userId);
  if (recipient) {
    window.addRecipient('to', recipient);
  }
  $('#cSubject').value = subject.startsWith('رد:') ? subject : 'رد: ' + subject;
  $('#cThreadId').value = threadId;
  $('#composeTitle').textContent = `رد على ${userName}`;
  setTimeout(() => $('#cBody').focus(), 200);
};

/* ═══════ IMAGE VIEWER ═══════ */
window.openImageViewer = (url) => {
  const viewer = document.getElementById('imageViewer');
  const img = document.getElementById('imageViewerImg');
  if (!viewer || !img) return;
  img.src = url;
  viewer.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  icons();
};

window.closeImageViewer = () => {
  const viewer = document.getElementById('imageViewer');
  if (viewer) viewer.style.display = 'none';
  document.body.style.overflow = '';
};

/* ═══════ PROFILE / SETTINGS ═══════ */
window.openProfile = () => {
  const u = state.currentUser;
  if (!u) return;
  $('#profileName').value = u.name || '';
  $('#profileUsername').value = u.username || '';
  $('#profileEmail').value = u.email || '';
  $('#profileRole').value = roleLabels[u.role] || u.role;
  const avatarEl = $('#profileAvatar');
  if (avatarEl) { avatarEl.textContent = initials(u.name); applyAvatar(avatarEl, u.name); }
  hideStyle($('#userMenu'));
  show($('#profileModal'));
  icons();
};

window.closeProfile = () => hide($('#profileModal'));

window.saveProfile = async () => {
  const name = $('#profileName').value.trim();
  const status = $('#profileStatus');
  if (!name) { status.className = 'alert alert-error'; status.textContent = 'اكتب الاسم'; show(status); return; }
  try {
    await updateDoc(doc(db, 'users', state.currentUser.uid), { name });
    state.currentUser.name = name;
    status.className = 'alert alert-success';
    status.textContent = '✅ تم الحفظ';
    show(status);
    showToastAdvanced('تم الحفظ ✅', 'الاسم اتحدّث', { type: 'success', icon: 'check', duration: 2000 });
    setTimeout(() => { hide($('#profileModal')); location.reload(); }, 1000);
  } catch (e) {
    status.className = 'alert alert-error'; status.textContent = e.message; show(status);
  }
};

window.openSettings = () => {
  hideStyle($('#userMenu'));
  $('#darkModeToggle').checked = state.settings.darkMode;
  const installBtn = $('#installPwaBtn');
  if (installBtn) installBtn.classList.toggle('hidden', !deferredPrompt);
  show($('#settingsModal'));
  icons();
};

window.closeSettings = () => hide($('#settingsModal'));

window.toggleDarkMode = () => {
  const isDark = toggleDarkMode();
  const icon = $('#themeToggle i');
  if (icon) icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
  icons();
};

window.enablePushNotifications = async () => {
  const btn = $('#enablePushBtn');
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { btn.textContent = 'مرفوض'; btn.className = 'btn btn-sm btn-danger'; return; }
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), { token, createdAt: serverTimestamp(), userAgent: navigator.userAgent });
      btn.textContent = '✅ مفعّل';
      btn.className = 'btn btn-sm btn-success';
    } else { btn.textContent = 'فشل'; btn.className = 'btn btn-sm btn-danger'; }
  } catch (e) {
    btn.textContent = 'خطأ'; btn.className = 'btn btn-sm btn-danger';
  }
};

/* ═══════ NOTIFICATIONS ═══════ */
async function registerFCMToken() {
  try {
    if (!messaging) return;
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;
    await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), { token, createdAt: serverTimestamp(), userAgent: navigator.userAgent });
    console.log('✅ FCM Token saved');
  } catch (e) { console.error('FCM error:', e); }
}

if (messaging) {
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    const data = payload.data || {};
    showToastAdvanced(title || 'رسالة جديدة', body || '', {
      type: 'info', icon: 'mail', duration: 6000,
      onClick: () => { navigate('inbox'); if (data.threadId) setTimeout(() => window.openThread(data.threadId), 300); }
    });
  });
}

function setupServiceWorkerMessages() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => { if (event.data?.type === 'PLAY_SOUND') playNotifSound(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.__refreshing) return;
    window.__refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register(SW_PATH).then(() => console.log('✅ SW registered')).catch(() => {});
}

function startMessagesListener() {
  if (state.unsubMessages) state.unsubMessages();
  const q = query(collection(db, 'messages'), where('toUserId', '==', state.currentUser.uid));
  state.unsubMessages = onSnapshot(q, (snap) => {
    const all = [];
    snap.forEach(d => all.push({ id: d.id, ...d.data() }));
    all.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const visibleUnread = all.filter(m => !m.read && !isHiddenFromMe(m));
    state.unreadMessages = visibleUnread;
    updateNotificationUI();

    if (state.lastUnreadCount > 0 && visibleUnread.length > state.lastUnreadCount) {
      const m = visibleUnread[0];
      if (m && m.fromUserId !== state.currentUser.uid) {
        showToastAdvanced(`رسالة من ${m.fromUserName}`, m.subject, {
          type: 'info', icon: 'mail', actionLabel: 'فتح',
          onAction: () => { navigate('inbox'); setTimeout(() => window.openThread(m.threadId || m.id), 300); },
          duration: 6000
        });
      }
    }
    state.lastUnreadCount = visibleUnread.length;

    if (document.getElementById('inboxList')) renderInbox();
  });
}

function updateNotificationUI() {
  const count = state.unreadMessages.length;
  const el = $('#inboxCount');
  const elM = $('#inboxCountM');
  const notifBadge = $('#notifBadge');
  const drawerCount = document.getElementById('drawerInboxCount');

  if (count > 0) {
    if (el) { el.textContent = count; show(el); }
    if (elM) { elM.textContent = count; show(elM); }
    if (notifBadge) { notifBadge.textContent = count > 9 ? '9+' : count; notifBadge.classList.remove('hidden'); }
    if (drawerCount) { drawerCount.textContent = count; drawerCount.classList.remove('hidden'); }
  } else {
    if (el) hide(el);
    if (elM) hide(elM);
    if (notifBadge) notifBadge.classList.add('hidden');
    if (drawerCount) drawerCount.classList.add('hidden');
  }
  renderNotifDropdown();
}

function renderNotifDropdown() {
  const list = $('#notifList');
  if (!list) return;

  if (state.unreadMessages.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:40px 20px;"><i data-lucide="bell-off" style="width:40px;height:40px;"></i><p style="font-size:13px;">لا إشعارات</p></div>`;
    icons();
    return;
  }

  list.innerHTML = state.unreadMessages.slice(0, 10).map(m => `
    <div onclick="openNotifMsg('${m.id}', '${m.threadId || m.id}')" style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer;display:flex;gap:12px;">
      <div class="msg-avatar ${getAvatarGradient(m.fromUserName)}" style="width:36px;height:36px;font-size:13px;">${initials(m.fromUserName)}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.fromUserName)}</span>
          <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0;">${timeAgo(m.createdAt)}</span>
        </div>
        <div style="font-size:12.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${esc(m.subject)}</div>
      </div>
    </div>
  `).join('');
  icons();
}

window.openNotifMsg = (msgId, threadId) => {
  hideStyle($('#notifDropdown'));
  navigate('inbox');
  setTimeout(() => window.openThread(threadId), 400);
};

window.markAllRead = async () => {
  if (state.unreadMessages.length === 0) return;
  const batch = writeBatch(db);
  state.unreadMessages.forEach(m => batch.update(doc(db, 'messages', m.id), { read: true }));
  await batch.commit();
  hideStyle($('#notifDropdown'));
};
/* ═══════════════════════════════════════════════════════
   DELETED LOG (v9.9) — سجل المحذوفات
   ═══════════════════════════════════════════════════════ */
async function renderDeletedLog() {
  if (!isAdmin()) {
    $('#pageContent').innerHTML = `
      <div class="dashboard">
        <div class="empty-state" style="padding:60px 20px;">
          <i data-lucide="shield-x" style="width:64px;height:64px;color:var(--danger);"></i>
          <p style="margin-top:12px;">غير مسموح — مسئول السيستم بس</p>
        </div>
      </div>
    `;
    icons();
    return;
  }

  $('#pageContent').innerHTML = `
    <div class="dashboard" style="max-width:1100px;">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div>
          <h1 class="dashboard-title">سجل المحذوفات</h1>
          <p class="dashboard-date">جاري التحميل...</p>
        </div>
      </div>
      <div class="data-table-wrapper" style="padding:20px;">
        ${renderSkeletonInbox()}
      </div>
    </div>
  `;
  icons();

  try {
    const snap = await getDocs(collection(db, 'messages'));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const deleted = all.filter(m => m.deletedBy && Object.keys(m.deletedBy).length > 0);

    if (deleted.length === 0) {
      $('#pageContent').innerHTML = `
        <div class="dashboard" style="max-width:1100px;">
          <div class="page-header" style="padding:0 0 20px;border:none;">
            <div>
              <h1 class="dashboard-title">سجل المحذوفات</h1>
              <p class="dashboard-date">0 رسالة محذوفة</p>
            </div>
          </div>
          <div class="empty-state" style="padding:60px 20px;">
            <i data-lucide="archive" style="width:64px;height:64px;"></i>
            <p style="margin-top:12px;">لا توجد رسائل محذوفة</p>
          </div>
        </div>
      `;
      icons();
      updateDeletedLogBadge(0);
      return;
    }

    // تجميع حسب threadId
    const threadsMap = {};
    deleted.forEach(m => {
      const tid = m.threadId || m.id;
      if (!threadsMap[tid]) {
        threadsMap[tid] = {
          threadId: tid,
          messages: [],
          allDeleters: new Set(),
          latestDeleteTime: 0
        };
      }
      threadsMap[tid].messages.push(m);

      Object.entries(m.deletedBy).forEach(([uid, timeStr]) => {
        threadsMap[tid].allDeleters.add(uid);
        const t = timeStr ? new Date(timeStr).getTime() : 0;
        if (t > threadsMap[tid].latestDeleteTime) {
          threadsMap[tid].latestDeleteTime = t;
        }
      });
    });

    const threads = Object.values(threadsMap).sort((a, b) => b.latestDeleteTime - a.latestDeleteTime);

    const rows = threads.map(t => {
      const firstMsg = t.messages[0];
      const lastMsg = t.messages[t.messages.length - 1];
      const subject = firstMsg.subject || '(بدون موضوع)';
      const preview = (lastMsg.body || '').slice(0, 100);

      const deleters = Array.from(t.allDeleters).map(uid => {
        const u = state.allUsersCache.find(x => x.id === uid);
        return u ? u.name : 'مستخدم';
      });

      const sender = state.allUsersCache.find(u => u.id === firstMsg.fromUserId);
      const recipient = state.allUsersCache.find(u => u.id === firstMsg.toUserId);
      const fromName = sender ? sender.name : (firstMsg.fromUserName || 'مستخدم');
      const toName = recipient ? recipient.name : (firstMsg.toUserName || 'مستخدم');

      const timeStr = t.latestDeleteTime
        ? new Date(t.latestDeleteTime).toLocaleString('ar-EG', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : '—';

      return `
        <div class="deleted-log-item">
          <div class="deleted-log-header">
            <div class="deleted-log-avatars">
              <div class="user-cell-avatar ${getAvatarGradient(fromName)}" style="width:32px;height:32px;font-size:12px;">${initials(fromName)}</div>
              <i data-lucide="arrow-left" class="w-3 h-3 deleted-log-arrow"></i>
              <div class="user-cell-avatar ${getAvatarGradient(toName)}" style="width:32px;height:32px;font-size:12px;">${initials(toName)}</div>
            </div>
            <div class="deleted-log-main">
              <div class="deleted-log-subject">${esc(subject)}</div>
              <div class="deleted-log-preview">${esc(preview)}</div>
            </div>
          </div>

          <div class="deleted-log-meta">
            <div class="deleted-log-deleters">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              <span>حذفها من عندهم: <strong>${deleters.map(esc).join('، ')}</strong></span>
            </div>
            <div class="deleted-log-time">
              <i data-lucide="clock" class="w-3 h-3"></i>
              ${timeStr}
            </div>
          </div>

          <div class="deleted-log-actions">
            <button onclick="viewDeletedThread('${t.threadId}')" class="btn btn-ghost btn-sm">
              <i data-lucide="eye" class="w-3.5 h-3.5"></i>
              <span>عرض</span>
            </button>
            <button onclick="restoreDeletedThread('${t.threadId}')" class="btn btn-primary btn-sm">
              <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
              <span>استعادة للكل</span>
            </button>
            <button onclick="permanentDeleteThread('${t.threadId}')" class="btn btn-danger btn-sm">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
              <span>حذف نهائي</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    $('#pageContent').innerHTML = `
      <div class="dashboard" style="max-width:1100px;">
        <div class="page-header" style="padding:0 0 20px;border:none;">
          <div>
            <h1 class="dashboard-title">سجل المحذوفات</h1>
            <p class="dashboard-date">${threads.length} محادثة · ${deleted.length} رسالة</p>
          </div>
          <button onclick="renderDeletedLog()" class="btn btn-ghost btn-sm">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            <span>تحديث</span>
          </button>
        </div>

        <div class="deleted-log-list">
          ${rows}
        </div>
      </div>
    `;
    icons();
    updateDeletedLogBadge(deleted.length);

  } catch (e) {
    console.error('Deleted log error:', e);
    $('#pageContent').innerHTML = `
      <div class="dashboard">
        <div class="empty-state">
          <i data-lucide="alert-circle" style="width:64px;height:64px;color:var(--danger);"></i>
          <p>خطأ في تحميل السجل</p>
        </div>
      </div>
    `;
    icons();
  }
}
window.renderDeletedLog = renderDeletedLog;

window.viewDeletedThread = (threadId) => {
  state.currentFilter = 'inbox';
  navigate('inbox');
  setTimeout(() => {
    if (window.openThread) window.openThread(threadId);
  }, 400);
};

window.restoreDeletedThread = async (threadId) => {
  const ok = await confirmDialog('استعادة للكل', 'هيتم إرجاع الرسائل لكل المستخدمين. متأكد؟');
  if (!ok) return;

  try {
    const q = query(collection(db, 'messages'), where('threadId', '==', threadId));
    const snap = await getDocs(q);

    for (const d of snap.docs) {
      await updateDoc(doc(db, 'messages', d.id), { deletedBy: {} });
    }

    showToastAdvanced('تم الاستعادة ✅', 'الرسائل رجعت للكل', {
      type: 'success', icon: 'check-circle', duration: 2500
    });
    renderDeletedLog();
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.permanentDeleteThread = async (threadId) => {
  const ok = await confirmDialog('حذف نهائي', 'هيتم حذف الرسائل نهائياً من النظام. متأكد؟');
  if (!ok) return;

  try {
    const q = query(collection(db, 'messages'), where('threadId', '==', threadId));
    const snap = await getDocs(q);

    for (const d of snap.docs) {
      await deleteDoc(doc(db, 'messages', d.id));
    }

    showToastAdvanced('تم الحذف النهائي 🗑️', '', {
      type: 'success', icon: 'trash-2', duration: 2500
    });
    renderDeletedLog();
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

async function updateDeletedLogBadge(count) {
  if (!isAdmin()) return;

  if (typeof count !== 'number') {
    try {
      const snap = await getDocs(collection(db, 'messages'));
      count = snap.docs.filter(d => {
        const data = d.data();
        return data.deletedBy && Object.keys(data.deletedBy).length > 0;
      }).length;
    } catch (e) { count = 0; }
  }

  const els = [
    document.getElementById('sidebarDeletedLogCount'),
    document.getElementById('drawerDeletedLogCount')
  ];

  els.forEach(el => {
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : count;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}
console.log('🚀 Mail System v9.7 loaded — Drawer + Drafts + GoFile');
