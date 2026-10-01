/* Mail System — Internal Messaging Platform */

import {
  auth, db, messaging,
  EMAIL_DOMAIN, VAPID_KEY, SW_PATH, APP_URL,
  firebaseConfig,
  createAuthUser, resetUserPassword,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  getToken, onMessage,
  initializeApp, getAuth, updatePassword, deleteApp,
  sendPasswordResetEmail,
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

/* State */
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

let autoSaveInterval = null;
let lastAutoSavedHash = '';
let scheduledCheckInterval = null;
let userGroupsCache = [];
let autoReplyChecked = new Set();

/* Admin Templates */
const ADMIN_MESSAGE_TEMPLATES = [
  { id: 'complaint', label: 'شكوى', icon: 'alert-triangle', body: 'أود التقدم بشكوى بخصوص:\n\n\n\n\nالتفاصيل:\n' },
  { id: 'inquiry', label: 'استفسار', icon: 'help-circle', body: 'أرجو الإفادة بخصوص:\n\n\n\n\nالتفاصيل:\n' }
];

/* Helpers */
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
  const permanentlyDeletedBy = msg.permanentlyDeletedBy || {};
  return !!(deletedBy[state.currentUser.uid] || permanentlyDeletedBy[state.currentUser.uid]);
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

/* Skeletons */
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

/* Toast */
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

/* Rate Limiting */
async function checkRateLimit() {
  const user = state.currentUser;
  const limit = user.rateLimitPerHour || 50;

  if (user.role === 'admin' || user.role === 'owner') {
    return { allowed: true };
  }

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const q = query(
      collection(db, 'messages'),
      where('fromUserId', '==', state.currentUser.uid),
      where('createdAt', '>=', oneHourAgo)
    );
    const snap = await getDocs(q);

    if (snap.size >= limit) {
      const oldestDoc = snap.docs.reduce((oldest, d) => {
        const t = d.data().createdAt?.toDate?.() || new Date();
        return !oldest || t < oldest ? t : oldest;
      }, null);

      const minutesLeft = oldestDoc
        ? Math.ceil((oldestDoc.getTime() + 3600000 - Date.now()) / 60000)
        : 60;

      return {
        allowed: false,
        message: `تجاوزت الحد الأقصى (${limit} رسالة/ساعة). جرب تاني بعد ${minutesLeft} دقيقة`
      };
    }

    return { allowed: true, remaining: limit - snap.size };
  } catch (e) {
    console.warn('Rate limit check failed:', e);
    return { allowed: true };
  }
}

/* Init */
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
  }

  checkAuthState();
});

/* Keyboard Shortcuts */
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
      hide($('#changePasswordModal'));
      hide($('#groupsModal'));
      closeMobileDrawer();
      closeImageViewer();
    }
  });
}

/* PWA */
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
    showToastAdvanced('تم التثبيت', 'التطبيق مثبّت على جهازك', { type: 'success', icon: 'check' });
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

/* Login */
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

  btn.disabled = true;
  btn.querySelector('span').textContent = 'جاري الدخول...';

  try {
    try { await setPersistence(auth, browserLocalPersistence); } catch (e) {}
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
  const username = ($('#forgotEmail')?.value || '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  const status = $('#forgotStatus');

  if (!username) {
    status.className = 'alert alert-error';
    status.textContent = 'اكتب اسم المستخدم';
    show(status);
    return;
  }

  status.className = 'alert alert-info';
  status.textContent = 'جاري الإرسال...';
  show(status);

  try {
    const email = `${username}@${EMAIL_DOMAIN}`;
    await sendPasswordResetEmail(auth, email);

    status.className = 'alert alert-success';
    status.textContent = 'تم إرسال رابط استعادة كلمة السر لإيميلك الرسمي';
    show(status);
    setTimeout(() => closeForgotModal(), 5000);

  } catch (e) {
    console.error('Password reset error:', e);
    const msgs = {
      'auth/user-not-found': 'اسم المستخدم غير مسجل في النظام',
      'auth/invalid-email': 'صيغة الإيميل غير صحيحة',
      'auth/too-many-requests': 'محاولات كثيرة، استنى شوية'
    };
    status.className = 'alert alert-error';
    status.textContent = msgs[e.code] || `خطأ: ${e.message}`;
    show(status);
  }
};

/* Auth State */
async function checkAuthState() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn('setPersistence init error:', e);
  }

  let initialCheckDone = false;

  const authTimeout = setTimeout(() => {
    if (!initialCheckDone) {
      initialCheckDone = true;
      hide(document.getElementById('authLoading'));
      show($('#loginScreen'));
      hide($('#app'));
    }
  }, 3000);

  onAuthStateChanged(auth, async (user) => {
    if (!initialCheckDone) {
      initialCheckDone = true;
      clearTimeout(authTimeout);
      hide(document.getElementById('authLoading'));
    }

    if (!user) {
      state.currentUser = null;
      if (state.unsubMessages) {
        state.unsubMessages();
        state.unsubMessages = null;
      }
      if (autoSaveInterval) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
      if (scheduledCheckInterval) { clearInterval(scheduledCheckInterval); scheduledCheckInterval = null; }
      hide($('#app'));
      show($('#loginScreen'));
      return;
    }

    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) {
        alert('لا يوجد ملف مستخدم في قاعدة البيانات');
        await signOut(auth);
        return;
      }

      state.currentUser = { uid: user.uid, ...snap.data() };
      if (state.currentUser.isActive === false) {
        alert('الحساب معطّل');
        await signOut(auth);
        return;
      }

      saveSession(state.currentUser);
      await loadUsersCache();
      await loadDepartmentsCache();
      await loadUserTags();
      await loadUserGroups();

      updateUIForRole();
      hide($('#loginScreen'));
      show($('#app'));
      icons();
      initSidebar();
      navigate('inbox');

      startMessagesListener();
      startScheduledMessagesChecker();
      setTimeout(registerFCMToken, 1500);
      setTimeout(() => updateDraftsBadge(), 2000);
      setTimeout(() => updateDeletedLogBadge(), 2500);
      setTimeout(() => updatePasswordResetBadge(), 2800);
      setTimeout(() => updateScheduledBadge(), 3000);
    } catch (e) {
      console.error('Auth state error:', e);
      hide($('#app'));
      show($('#loginScreen'));
    }
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

  if (admin) {
    setTimeout(() => updateDeletedLogBadge(), 500);
    setTimeout(() => updatePasswordResetBadge(), 700);
  }
}

/* Tags */
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
    showToastAdvanced('تم الإضافة', `"${name}" اتعمل`, { type: 'success', icon: 'tag', duration: 2500 });
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

/* Contact Groups */
async function loadUserGroups() {
  try {
    const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'groups'));
    userGroupsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Groups load error:', e);
    userGroupsCache = [];
  }
}

window.openGroupsManager = async () => {
  await loadUserGroups();
  show($('#groupsModal'));
  renderGroupsManager();
  icons();
};

window.closeGroupsManager = () => hide($('#groupsModal'));

function renderGroupsManager() {
  const list = document.getElementById('groupsList');
  if (!list) return;

  if (userGroupsCache.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:20px;"><p style="font-size:13px;">لا توجد مجموعات بعد</p></div>';
    return;
  }

  list.innerHTML = userGroupsCache.map(g => `
    <div class="tag-manage-item">
      <div class="tag-manage-color" style="background: #0078D4;display:flex;align-items:center;justify-content:center;">
        <i data-lucide="users" style="width:14px;height:14px;color:white;"></i>
      </div>
      <div class="tag-manage-name">
        ${esc(g.name)}
        <div style="font-size:11px;color:var(--text-tertiary);">${(g.members || []).length} عضو</div>
      </div>
      <button onclick="useGroupInCompose('${g.id}')" class="row-action primary" title="استخدام">
        <i data-lucide="send" class="w-3.5 h-3.5"></i>
      </button>
      <button onclick="deleteGroup('${g.id}')" class="row-action danger" title="حذف">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `).join('');
  icons();
}

window.createGroup = async () => {
  const name = $('#newGroupName').value.trim();
  if (!name) { alert('اكتب اسم المجموعة'); return; }
  if (userGroupsCache.length >= 20) { alert('أقصى 20 مجموعة'); return; }

  try {
    const r = await addDoc(collection(db, 'users', state.currentUser.uid, 'groups'), {
      name, members: [], createdAt: serverTimestamp()
    });
    userGroupsCache.push({ id: r.id, name, members: [] });
    $('#newGroupName').value = '';
    renderGroupsManager();
    showToastAdvanced('تم الإضافة', `مجموعة "${name}" اتعملت`, { type: 'success', icon: 'users', duration: 2500 });
    window.editGroupMembers(r.id);
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.editGroupMembers = async (groupId) => {
  const g = userGroupsCache.find(x => x.id === groupId);
  if (!g) return;

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'groupMembersModal';
  modal.style.zIndex = '10000';
  const allowed = getAllowedRecipients();
  const currentMembers = g.members || [];

  modal.innerHTML = `
    <div class="modal-panel modal-md fade-in">
      <div class="modal-header">
        <div><h2 class="modal-title">أعضاء المجموعة</h2><p class="modal-subtitle">${esc(g.name)}</p></div>
        <button onclick="document.getElementById('groupMembersModal').remove()" class="icon-btn icon-btn-ghost"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="modal-body" style="max-height:400px;overflow-y:auto;">
        ${allowed.map(u => `
          <label class="check-inline" style="display:flex;align-items:center;padding:8px;cursor:pointer;">
            <input type="checkbox" class="groupMemberCheck" value="${u.id}" data-name="${esc(u.name)}" ${currentMembers.some(m => m.id === u.id) ? 'checked' : ''} />
            <span style="margin-right:10px;">${esc(u.name)} <span style="color:var(--text-tertiary);font-size:11px;">@${esc(u.username)}</span></span>
          </label>
        `).join('')}
      </div>
      <div class="modal-footer">
        <button onclick="document.getElementById('groupMembersModal').remove()" class="btn btn-ghost">إلغاء</button>
        <button onclick="saveGroupMembers('${groupId}')" class="btn btn-primary">حفظ</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  icons();
};

window.saveGroupMembers = async (groupId) => {
  const checks = document.querySelectorAll('.groupMemberCheck:checked');
  const members = Array.from(checks).map(c => ({ id: c.value, name: c.dataset.name }));

  try {
    await updateDoc(doc(db, 'users', state.currentUser.uid, 'groups', groupId), { members });
    const g = userGroupsCache.find(x => x.id === groupId);
    if (g) g.members = members;
    document.getElementById('groupMembersModal')?.remove();
    renderGroupsManager();
    showToastAdvanced('تم الحفظ', `${members.length} عضو`, { type: 'success', icon: 'users', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.deleteGroup = async (groupId) => {
  const g = userGroupsCache.find(x => x.id === groupId);
  if (!g) return;
  const ok = await confirmDialog('حذف المجموعة', `حذف "${g.name}"؟`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'groups', groupId));
    userGroupsCache = userGroupsCache.filter(x => x.id !== groupId);
    renderGroupsManager();
    showToastAdvanced('تم الحذف', '', { type: 'success', icon: 'trash-2', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.useGroupInCompose = async (groupId) => {
  const g = userGroupsCache.find(x => x.id === groupId);
  if (!g || !g.members || g.members.length === 0) {
    showToastAdvanced('المجموعة فاضية', 'ضيف أعضاء أول', { type: 'warning', icon: 'alert-triangle' });
    return;
  }
  closeGroupsManager();
  if ($('#composeModal').style.display !== 'flex') {
    await window.openCompose();
  }
  g.members.forEach(m => {
    const fullUser = state.allUsersCache.find(x => x.id === m.id);
    if (fullUser) window.addRecipient('to', fullUser);
  });
  showToastAdvanced('تم الإضافة', `${g.members.length} عضو من "${g.name}"`, { type: 'success', icon: 'users', duration: 2000 });
};

/* Sidebar */
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

/* Global Listeners */
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

/* Instant Search */
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
    const myUID = state.currentUser.uid;
    const queries = [
      query(collection(db, 'messages'), where('toUserId', '==', myUID)),
      query(collection(db, 'messages'), where('toUserIds', 'array-contains', myUID)),
      query(collection(db, 'messages'), where('ccUserIds', 'array-contains', myUID)),
      query(collection(db, 'messages'), where('bccUserIds', 'array-contains', myUID)),
      query(collection(db, 'messages'), where('fromUserId', '==', myUID))
    ];
    const results = await Promise.all(queries.map(q => getDocs(q).catch(() => ({ docs: [] }))));

    const all = new Map();
    results.forEach(snap => {
      snap.docs.forEach(d => all.set(d.id, { id: d.id, ...d.data() }));
    });

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

  if (autoSaveInterval) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
  if (scheduledCheckInterval) { clearInterval(scheduledCheckInterval); scheduledCheckInterval = null; }

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

/* Navigation */
const ROUTES = {
  inbox: renderInbox,
  sent: renderSent,
  starred: renderStarred,
  trash: renderTrash,
  drafts: renderDrafts,
  scheduled: renderScheduled,
  myteam: renderMyTeam,
  users: renderUsers,
  departments: renderDepartments,
  deletedlog: renderDeletedLog,
  passwordreset: renderPasswordResetRequests
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

/* Auto-Save Drafts */
async function autoSaveDraft() {
  const subject = $('#cSubject')?.value?.trim() || '';
  const body = $('#cBody')?.value?.trim() || '';
  const toUsers = recipientChips.to || [];
  const ccUsers = recipientChips.cc || [];
  const bccUsers = recipientChips.bcc || [];

  if (!subject && !body && toUsers.length === 0 && ccUsers.length === 0 && bccUsers.length === 0) return;

  const hash = JSON.stringify({
    s: subject, b: body,
    to: toUsers.map(u => u.id),
    cc: ccUsers.map(u => u.id),
    bcc: bccUsers.map(u => u.id)
  });
  if (hash === lastAutoSavedHash) return;

  try {
    const draftId = $('#cDraftId')?.value;
    const draftData = {
      toUsers: toUsers.map(u => ({ id: u.id, name: u.name })),
      ccUsers: ccUsers.map(u => ({ id: u.id, name: u.name })),
      bccUsers: bccUsers.map(u => ({ id: u.id, name: u.name })),
      toUserId: toUsers[0]?.id || null,
      subject, body,
      updatedAt: serverTimestamp(),
      autoSaved: true
    };

    if (draftId) {
      await updateDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId), draftData);
    } else {
      draftData.createdAt = serverTimestamp();
      const r = await addDoc(collection(db, 'users', state.currentUser.uid, 'drafts'), draftData);
      $('#cDraftId').value = r.id;
    }
    lastAutoSavedHash = hash;
    updateDraftsBadge();
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

/* Scheduled Messages */
function startScheduledMessagesChecker() {
  if (scheduledCheckInterval) clearInterval(scheduledCheckInterval);
  checkScheduledMessages();
  scheduledCheckInterval = setInterval(checkScheduledMessages, 60000);
}

async function checkScheduledMessages() {
  if (!state.currentUser) return;
  try {
    const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'scheduledMessages'));
    const now = Date.now();
    for (const d of snap.docs) {
      const data = d.data();
      const scheduledTime = data.scheduledFor?.toDate?.().getTime() || 0;
      if (scheduledTime > 0 && scheduledTime <= now) {
        try {
          await performSend(data.payload);
          await deleteDoc(doc(db, 'users', state.currentUser.uid, 'scheduledMessages', d.id));
          showToastAdvanced('تم إرسال رسالة مجدولة', data.payload.subject, {
            type: 'success', icon: 'send', duration: 4000
          });
          updateScheduledBadge();
        } catch (e) {
          console.error('Scheduled send error:', e);
        }
      }
    }
  } catch (e) {
    console.warn('Scheduled check error:', e);
  }
}

async function updateScheduledBadge(count) {
  if (typeof count !== 'number') {
    try {
      const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'scheduledMessages'));
      count = snap.size;
    } catch (e) { count = 0; }
  }
  ['sidebarScheduledCount', 'drawerScheduledCount'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });
}

async function renderScheduled() {
  $('#pageContent').innerHTML = `
    <div class="dashboard" style="max-width:900px;">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div><h1 class="dashboard-title">الرسائل المجدولة</h1><p class="dashboard-date">جاري التحميل...</p></div>
      </div>
      <div class="data-table-wrapper" style="padding:20px;">${renderSkeletonInbox()}</div>
    </div>
  `;
  icons();

  try {
    const snap = await getDocs(collection(db, 'users', state.currentUser.uid, 'scheduledMessages'));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.scheduledFor?.seconds || 0) - (b.scheduledFor?.seconds || 0));

    if (list.length === 0) {
      $('#pageContent').innerHTML = `
        <div class="dashboard" style="max-width:900px;">
          <div class="page-header" style="padding:0 0 20px;border:none;">
            <div><h1 class="dashboard-title">الرسائل المجدولة</h1><p class="dashboard-date">0 رسالة</p></div>
          </div>
          <div class="empty-state" style="padding:60px 20px;">
            <i data-lucide="clock" style="width:64px;height:64px;"></i>
            <p style="margin-top:12px;">لا توجد رسائل مجدولة</p>
          </div>
        </div>
      `;
      icons();
      updateScheduledBadge(0);
      return;
    }

    const rows = list.map(s => {
      const p = s.payload || {};
      const when = s.scheduledFor?.seconds
        ? new Date(s.scheduledFor.seconds * 1000).toLocaleString('ar-EG', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          }) : '—';

      return `
        <div class="draft-item">
          <div class="draft-avatar" style="background:#FFF4E5;color:#C28A2E;"><i data-lucide="clock" class="w-5 h-5"></i></div>
          <div class="draft-info">
            <div class="draft-to">${when}</div>
            <div class="draft-subject">${esc(p.subject || '(بدون موضوع)')}</div>
            <div class="draft-preview">${esc((p.body || '').slice(0, 80))}</div>
          </div>
          <button class="draft-delete" onclick="cancelScheduled('${s.id}')" title="إلغاء">
            <i data-lucide="x-circle" class="w-4 h-4"></i>
          </button>
        </div>
      `;
    }).join('');

    $('#pageContent').innerHTML = `
      <div class="dashboard" style="max-width:900px;">
        <div class="page-header" style="padding:0 0 20px;border:none;">
          <div><h1 class="dashboard-title">الرسائل المجدولة</h1><p class="dashboard-date">${list.length} رسالة</p></div>
        </div>
        <div class="data-table-wrapper" style="padding:0;overflow:hidden;">${rows}</div>
      </div>
    `;
    icons();
    updateScheduledBadge(list.length);
  } catch (e) {
    console.error(e);
  }
}
window.renderScheduled = renderScheduled;

window.cancelScheduled = async (id) => {
  const ok = await confirmDialog('إلغاء الرسالة', 'هل أنت متأكد؟');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'scheduledMessages', id));
    renderScheduled();
    showToastAdvanced('تم الإلغاء', '', { type: 'info', icon: 'x-circle', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

/* Drafts */
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
      const toName = toUser ? toUser.name : (Array.isArray(d.toUsers) && d.toUsers[0] ? d.toUsers[0].name : '— لم يُحدد —');
      return `
        <div class="draft-item" onclick="openDraft('${d.id}')">
          <div class="draft-avatar"><i data-lucide="file-text" class="w-5 h-5"></i></div>
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
        <div class="data-table-wrapper" style="padding:0;overflow:hidden;">${rows}</div>
      </div>
    `;
    icons();
    updateDraftsBadge(drafts.length);
  } catch (e) {
    console.error('Drafts load error:', e);
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

    if (Array.isArray(d.toUsers) && d.toUsers.length) {
      d.toUsers.forEach(u => {
        const fullUser = state.allUsersCache.find(x => x.id === u.id);
        if (fullUser) window.addRecipient('to', fullUser);
      });
    } else if (d.toUserId) {
      const toUser = state.allUsersCache.find(u => u.id === d.toUserId);
      if (toUser) window.addRecipient('to', toUser);
    }

    if (Array.isArray(d.ccUsers) && d.ccUsers.length) {
      d.ccUsers.forEach(u => {
        const fullUser = state.allUsersCache.find(x => x.id === u.id);
        if (fullUser) window.addRecipient('cc', fullUser);
      });
    }
    if (Array.isArray(d.bccUsers) && d.bccUsers.length) {
      d.bccUsers.forEach(u => {
        const fullUser = state.allUsersCache.find(x => x.id === u.id);
        if (fullUser) window.addRecipient('bcc', fullUser);
      });
    }

    if (recipientChips.cc.length > 0 || recipientChips.bcc.length > 0) {
      show($('#ccRow')); show($('#bccRow')); show($('#optionsField'));
    }

    $('#cSubject').value = d.subject || '';
    $('#cBody').value = d.body || '';
    $('#cDraftId').value = draftId;
    $('#composeTitle').textContent = 'تعديل مسودة';
    showToastAdvanced('تم فتح المسودة', 'تعديل وحفظ', { type: 'info', icon: 'file-text', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.deleteDraft = async (draftId) => {
  const ok = await confirmDialog('حذف المسودة', 'هيتم حذف المسودة نهائياً. متأكد؟');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId));
    showToastAdvanced('تم الحذف', '', { type: 'success', icon: 'trash-2', duration: 2000 });
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

/* My Team */
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

/* Users Management */
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
            <button onclick="openChangePasswordModal('${u.id}', '${esc(u.username)}', '${esc(u.email || '')}', '${esc(u.name)}')" class="row-action primary" title="استعادة كلمة السر"><i data-lucide="key-round" class="w-3.5 h-3.5"></i></button>
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
          <div class="form-group"><label class="form-label">الدور</label><select id="nuRole" class="form-input" onchange="onRoleChange('nu')">${roleOptions}</select></div>
        </div>

        <div class="form-group" id="nuDeptGroup" style="margin-top:14px;">
          <label class="form-label">القسم</label>
          <select id="nuDept" class="form-input"><option value="">— بدون قسم —</option></select>
        </div>

        <div style="margin-top:14px;padding:12px;background:var(--bg-subtle);border-radius:8px;">
          <label class="check-inline" style="cursor:pointer;">
            <input type="checkbox" id="nuIsManager" class="check-input" onchange="onIsManagerChange('nu')" />
            <span class="check-box"></span>
            <span class="check-label" style="font-weight:700;color:var(--text-primary);">مدير قسم</span>
          </label>
        </div>

        <div style="margin-top:16px;padding:14px;background:var(--bg-subtle);border-radius:8px;border:1px solid var(--border-default);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-weight:700;font-size:13px;">صلاحيات الإرسال</span>
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
          <div class="form-group"><label class="form-label">الدور</label><select id="euRole" class="form-input" onchange="onRoleChange('eu')">${roleOptions}</select></div>
        </div>

        <div class="form-group" id="euDeptGroup" style="margin-top:14px;">
          <label class="form-label">القسم</label>
          <select id="euDept" class="form-input"><option value="">— بدون قسم —</option></select>
        </div>

        <div style="margin-top:14px;padding:12px;background:var(--bg-subtle);border-radius:8px;">
          <label class="check-inline" style="cursor:pointer;">
            <input type="checkbox" id="euIsManager" class="check-input" onchange="onIsManagerChange('eu')" />
            <span class="check-box"></span>
            <span class="check-label" style="font-weight:700;color:var(--text-primary);">مدير قسم</span>
          </label>
        </div>

        <div style="margin-top:16px;padding:14px;background:var(--bg-subtle);border-radius:8px;border:1px solid var(--border-default);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-weight:700;font-size:13px;">صلاحيات الإرسال</span>
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
      autoReplyEnabled: false,
      autoReplyMessage: '',
      createdAt: serverTimestamp()
    });

    if (role === 'manager' && deptId) {
      await updateDoc(doc(db, 'departments', deptId), { managerId: uid });
    }

    err.className = 'alert alert-success'; err.textContent = `تم إنشاء ${user}`;
    showToastAdvanced('تم الإنشاء', `${user} أضيف`, { type: 'success', icon: 'user-check', duration: 2500 });
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
    showToastAdvanced('تم الحفظ', '', { type: 'success', icon: 'check', duration: 2000 });
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
  const ok = await confirmDialog('حذف المستخدم', 'هيتحذف من قاعدة البيانات. متأكد؟');
  if (!ok) return;
  await deleteDoc(doc(db, 'users', uid));
  renderUsers();
};

/* Departments */
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
          ${manager ? `<div style="display:flex;align-items:center;gap:6px;"><div style="width:22px;height:22px;border-radius:50%;background:#8764B8;color:white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${initials(manager.name)}</div><span style="font-size:11.5px;color:#8764B8;font-weight:600;">${esc(manager.name)}</span></div>` : `<button onclick="editDept('${d.id}')" style="background:none;border:none;color:#E8A100;font-size:11.5px;cursor:pointer;font-weight:600;">بدون مدير</button>`}
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
  showToastAdvanced('تم الإضافة', `قسم ${name}`, { type: 'success', icon: 'building-2', duration: 2500 });
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
  modal.style.zIndex = '10000';
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

/* Inbox */
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

  const myUID = state.currentUser.uid;

  const queries = [
    query(collection(db, 'messages'), where('toUserId', '==', myUID)),
    query(collection(db, 'messages'), where('toUserIds', 'array-contains', myUID)),
    query(collection(db, 'messages'), where('ccUserIds', 'array-contains', myUID)),
    query(collection(db, 'messages'), where('bccUserIds', 'array-contains', myUID)),
    query(collection(db, 'messages'), where('fromUserId', '==', myUID))
  ];

  const results = await Promise.all(queries.map(q => getDocs(q).catch(err => {
    console.warn('Query failed (need index?):', err.message);
    return { docs: [] };
  })));

  const all = new Map();
  results.forEach(snap => {
    snap.docs.forEach(d => all.set(d.id, { id: d.id, ...d.data() }));
  });

  const isAdminUser = isAdmin();

  const visible = Array.from(all.values()).filter(m => {
    const deletedBy = m.deletedBy || {};
    const permanentlyDeletedBy = m.permanentlyDeletedBy || {};

    if (!isAdminUser && permanentlyDeletedBy[myUID]) return false;

    if (state.currentFilter === 'trash') {
      if (isAdminUser) return Object.keys(deletedBy).length > 0;
      return !!deletedBy[myUID];
    }

    if (state.currentFilter === 'inbox') {
      if (m.fromUserId === myUID) return false;
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
    const mine = t.messages.filter(m => {
      const toIds = m.toUserIds || (m.toUserId ? [m.toUserId] : []);
      const ccIds = m.ccUserIds || [];
      const bccIds = m.bccUserIds || [];
      return toIds.includes(myUID) || ccIds.includes(myUID) || bccIds.includes(myUID);
    });
    t.unread = mine.filter(m => !m.read).length;
    t.starred = t.messages.some(m => m.starred);
    t.lastMsg = t.messages[t.messages.length - 1];
    t.lastAt = t.lastMsg.createdAt?.seconds || 0;
    t.isFromMe = t.lastMsg.fromUserId === myUID;
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
              ${t.starred ? '★ ' : ''}
              ${last.priority === 'urgent' ? '🔴 ' : ''}
              ${esc(t.subject)}
            </div>
            <div class="msg-preview">${t.isFromMe ? 'أنت: ' : ''}${esc((last.body || '').slice(0, 60))}</div>
            ${deletedBadgeHtml}
            ${tagsHtml}
            <div class="msg-meta">
              ${t.messages.length > 1 ? `<span class="msg-thread-count">${t.messages.length} رسائل</span>` : ''}
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

window.swipeStar = async (threadId) => { await window.toggleStar(threadId); showToastAdvanced('تم التمييز', '', { type: 'success', icon: 'star', duration: 1500 }); };

window.swipeDelete = async (threadId) => {
  const ok = await confirmDialog('حذف المحادثة', 'متأكد؟');
  if (!ok) return;
  await window.trashThread(threadId, false);
  showToastAdvanced('تم الحذف', '', { type: 'success', icon: 'trash-2', duration: 1500 });
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
    const myUID = state.currentUser.uid;
    t.messages.forEach(m => {
      const toIds = m.toUserIds || (m.toUserId ? [m.toUserId] : []);
      const ccIds = m.ccUserIds || [];
      const bccIds = m.bccUserIds || [];
      const isForMe = toIds.includes(myUID) || ccIds.includes(myUID) || bccIds.includes(myUID);
      if (isForMe && !m.read) {
        updateDoc(doc(db, 'messages', m.id), { read: true }).catch(() => {});
        m.read = true;
      }
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
  const myUID = state.currentUser.uid;

  const replyUserId = t.lastMsg.fromUserId === myUID ? t.lastMsg.toUserId : t.lastMsg.fromUserId;
  const replyUserName = t.lastMsg.fromUserId === myUID ? t.lastMsg.toUserName : t.lastMsg.fromUserName;

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
    const isMe = m.fromUserId === myUID;
    const isLatest = idx === lastIdx;
    const isExpanded = state.expandedMsgs.has(idx);
    const open = isLatest || isExpanded;
    const senderEmail = m.fromUserUsername ? `${m.fromUserUsername}@${EMAIL_DOMAIN}` : '';
    const dateStr = formatDate(m.createdAt);
    const avatarClass = getAvatarGradient(m.fromUserName);

    const toIds = m.toUserIds && m.toUserIds.length ? m.toUserIds : (m.toUserId ? [m.toUserId] : []);
    const toNames = m.toUserNames && m.toUserNames.length ? m.toUserNames : (m.toUserName ? [m.toUserName] : []);
    const toFormatted = toNames.map((n, i) => `<span style="font-weight:600;color:var(--text-primary);">${esc(n)}</span>`).join(', ');

    let ccFormatted = '';
    if (m.ccUserNames && m.ccUserNames.length > 0) {
      ccFormatted = m.ccUserNames.map(n => `<span style="font-weight:600;color:var(--text-primary);">${esc(n)}</span>`).join(', ');
    }

    let bccFormatted = '';
    if (m.bccUserNames && m.bccUserNames.length > 0 && (m.fromUserId === myUID || isAdmin())) {
      bccFormatted = m.bccUserNames.map(n => `<span style="font-weight:600;color:var(--text-primary);">${esc(n)}</span>`).join(', ');
    }

    const attachments = m.attachments || [];
    const attachmentsHtml = attachments.length > 0 ? `
      <div class="msg-attachments" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-subtle);">
        <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <i data-lucide="paperclip" class="w-3.5 h-3.5"></i>
          <span>المرفقات (${attachments.length})</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${attachments.map(f => `
            <a href="${esc(f.url)}" target="_blank" class="attachment-chip" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-subtle);border:1px solid var(--border-default);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px;">
              <i data-lucide="${getFileIconLucide(f.type, f.name)}" class="w-4 h-4" style="color:var(--brand-primary);"></i>
              <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
              <span style="color:var(--text-tertiary);font-size:10px;">(${formatFileSize(f.size || 0)})</span>
            </a>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="thread-message ${open ? 'expanded' : 'collapsed'}" data-idx="${idx}">
        <div class="thread-message-header" onclick="toggleMessageExpand('${t.threadId}', ${idx})">
          <div class="msg-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;">${initials(m.fromUserName)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span style="font-weight:700;font-size:13.5px;color:var(--text-primary);">${esc(m.fromUserName)}</span>
              <span style="font-size:11.5px;color:var(--text-tertiary);">${dateStr}</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-tertiary);margin-top:1px;">
              إلى: ${toFormatted}
              ${ccFormatted ? ` | نسخة: ${ccFormatted}` : ''}
              ${bccFormatted ? ` | نسخة مخفية: ${bccFormatted}` : ''}
            </div>
          </div>
          <button class="icon-btn icon-btn-ghost" style="flex-shrink:0;">
            <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4"></i>
          </button>
        </div>
        ${open ? `
          <div class="thread-message-body" style="padding:16px;line-height:1.6;font-size:13.5px;white-space:pre-wrap;word-break:break-word;">
            ${esc(m.body \vert{}\vert{} '')}${attachmentsHtml}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  content.innerHTML = `
    <div class="reading-pane-header" style="padding:16px 20px;border-bottom:1px solid var(--border-default);display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        <button onclick="closeThreadMobile()" class="icon-btn icon-btn-ghost mobile-back-btn" title="رجوع"><i data-lucide="arrow-right" class="w-4 h-4"></i></button>
        <h2 style="font-size:16px;font-weight:700;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.subject)}</h2>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <button onclick="toggleStar('${t.threadId}')" class="icon-btn icon-btn-ghost ${t.starred ? 'active' : ''}" title="تمييز"><i data-lucide="star" class="w-4 h-4" ${t.starred ? 'fill="currentColor"' : ''}></i></button>
        ${isTrash ? `
          <button onclick="restoreThread('${t.threadId}')" class="btn btn-ghost btn-sm" title="استعادة"><i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>استعادة</span></button>
          <button onclick="permanentlyDeleteThread('${t.threadId}')" class="btn btn-danger btn-sm" title="حذف نهائي"><i data-lucide="trash-2" class="w-4 h-4"></i><span>حذف نهائي</span></button>
        ` : `
          <button onclick="trashThread('${t.threadId}')" class="icon-btn icon-btn-ghost" title="حذف"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        `}
      </div>
    </div>

    ${showDeletedInfo ? `
      <div style="padding:10px 20px;background:#FFF4E5;border-bottom:1px solid var(--border-default);font-size:12px;color:#C28A2E;display:flex;align-items:center;gap:8px;">
        <i data-lucide="info" class="w-4 h-4"></i>
        <span>قام بالحذف: ${deletedUsers.map(u => esc(u.name)).join('، ')}</span>
      </div>
    ` : ''}

    <div style="flex:1;overflow-y:auto;padding:20px;" class="thread-messages-list">
      ${messagesHtml}
    </div>

    ${!isTrash && canReply ? `
      <div class="reading-reply-box" style="padding:16px 20px;border-top:1px solid var(--border-default);background:var(--bg-card);">
        <button onclick="replyToThread('${t.threadId}')" class="btn btn-primary">
          <i data-lucide="reply" class="w-4 h-4"></i>
          <span>رد على ${esc(replyUserName)}</span>
        </button>
      </div>
    ` : ''}
  `;
  icons();
}

window.toggleMessageExpand = (threadId, idx) => {
  if (state.expandedMsgs.has(idx)) {
    state.expandedMsgs.delete(idx);
  } else {
    state.expandedMsgs.add(idx);
  }
  renderThreadReading();
};

window.closeThreadMobile = () => {
  $('#inboxList')?.classList.remove('mobile-hidden');
  $('#inboxReading')?.classList.remove('mobile-show');
};

/* Actions on Threads */
window.toggleStar = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  const next = !t.starred;
  t.starred = next;

  try {
    const batch = writeBatch(db);
    t.messages.forEach(m => {
      batch.update(doc(db, 'messages', m.id), { starred: next });
    });
    await batch.commit();
    renderThreadList();
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.trashThread = async (threadId, showNotification = true) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  try {
    const batch = writeBatch(db);
    const myUID = state.currentUser.uid;
    t.messages.forEach(m => {
      batch.update(doc(db, 'messages', m.id), {
        [`deletedBy.${myUID}`]: true,
        [`deletedAt.${myUID}`]: serverTimestamp()
      });
    });
    await batch.commit();

    state.threadsCache = state.threadsCache.filter(x => x.threadId !== threadId);
    if (state.selectedThreadId === threadId) state.selectedThreadId = null;
    renderThreadList();
    if (showNotification) showToastAdvanced('تم النقل إلى سلة المهملات', '', { type: 'info', icon: 'trash-2', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.restoreThread = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  try {
    const batch = writeBatch(db);
    const myUID = state.currentUser.uid;
    t.messages.forEach(m => {
      batch.update(doc(db, 'messages', m.id), {
        [`deletedBy.${myUID}`]: deleteDoc ? null : false // updateField
      });
    });
    await batch.commit();

    state.threadsCache = state.threadsCache.filter(x => x.threadId !== threadId);
    if (state.selectedThreadId === threadId) state.selectedThreadId = null;
    renderThreadList();
    showToastAdvanced('تمت الاستعادة', '', { type: 'success', icon: 'rotate-ccw', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

window.permanentlyDeleteThread = async (threadId) => {
  const ok = await confirmDialog('حذف نهائي', 'لن تتمكن من استعادة هذه الرسائل نهائياً. متأكد؟');
  if (!ok) return;

  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  try {
    const batch = writeBatch(db);
    const myUID = state.currentUser.uid;
    t.messages.forEach(m => {
      if (isAdmin()) {
        batch.delete(doc(db, 'messages', m.id));
      } else {
        batch.update(doc(db, 'messages', m.id), {
          [`permanentlyDeletedBy.${myUID}`]: true
        });
      }
    });
    await batch.commit();

    state.threadsCache = state.threadsCache.filter(x => x.threadId !== threadId);
    if (state.selectedThreadId === threadId) state.selectedThreadId = null;
    renderThreadList();
    showToastAdvanced('تم الحذف النهائي', '', { type: 'success', icon: 'trash-2', duration: 2000 });
  } catch (e) {
    showToastAdvanced('خطأ', e.message, { type: 'error', icon: 'alert-circle' });
  }
};

/* Sent / Starred / Trash Navigation Helpers */
function renderSent() { renderInbox(); }
function renderStarred() { renderInbox(); }
function renderTrash() { renderInbox(); }

/* System Listeners & FCM */
function startMessagesListener() {
  if (state.unsubMessages) state.unsubMessages();
  const myUID = state.currentUser.uid;

  const q = query(collection(db, 'messages'), where('toUserId', '==', myUID));
  state.unsubMessages = onSnapshot(q, (snap) => {
    const unread = [];
    snap.docs.forEach(d => {
      const data = d.data();
      if (!data.read && !isHiddenFromMe(data)) {
        unread.push({ id: d.id, ...data });
      }
    });
    state.unreadMessages = unread;
    updateNotificationBadge();
  });
}

function updateNotificationBadge() {
  const count = state.unreadMessages.length;
  ['inboxBadge', 'drawerInboxCount'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });
}

function updateNotificationUI() {
  updateNotificationBadge();
}

async function registerFCMToken() {
  try {
    if (!messaging) return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, { vapidKey: VAPID_KEY });
      if (token && state.currentUser) {
        await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), {
          token, updatedAt: serverTimestamp()
        });
      }
    }
  } catch (e) {
    console.warn('FCM registration error:', e);
  }
}

function setupServiceWorkerMessages() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        const threadId = event.data.threadId;
        if (threadId) goToSearchResult(threadId);
      }
    });
  }
}

/* Compose Modal & Functions */
window.openCompose = async () => {
  await loadUsersCache();
  await loadDepartmentsCache();

  recipientChips = { to: [], cc: [], bcc: [] };
  attachedFiles = [];

  const cm = $('#composeModal');
  if (!cm) return;

  cm.style.display = 'flex';

  const toChipBox = $('#toChips');
  if (toChipBox) toChipBox.innerHTML = '<input type="text" id="toInput" class="chip-input" placeholder="اكتب اسم أو يوزر المتلقي..." />';
  const ccChipBox = $('#ccChips');
  if (ccChipBox) ccChipBox.innerHTML = '<input type="text" id="ccInput" class="chip-input" placeholder="إضافة نسخة..." />';
  const bccChipBox = $('#bccChips');
  if (bccChipBox) bccChipBox.innerHTML = '<input type="text" id="bccInput" class="chip-input" placeholder="إضافة نسخة مخفية..." />';

  $('#cSubject').value = '';
  $('#cBody').value = '';
  $('#cDraftId').value = '';

  setupChipInputs();
  icons();
};

window.closeCompose = () => {
  const cm = $('#composeModal');
  if (cm) cm.style.display = 'none';
};

function setupChipInputs() {
  ['to', 'cc', 'bcc'].forEach(field => {
    const input = document.getElementById(`${field}Input`);
    if (!input) return;

    input.addEventListener('focus', () => {
      activeChipField = field;
      showRecipientSuggestions(input.value.trim(), field);
    });

    input.addEventListener('input', (e) => {
      activeChipField = field;
      showRecipientSuggestions(e.target.value.trim(), field);
    });
  });
}

function showRecipientSuggestions(term, field) {
  const suggestionsBox = document.getElementById(`${field}Suggestions`);
  if (!suggestionsBox) return;

  const allowed = getAllowedRecipients().filter(u => {
    const alreadySelected = recipientChips[field].some(c => c.id === u.id);
    if (alreadySelected) return false;
    if (!term) return true;
    return u.name.toLowerCase().includes(term.toLowerCase()) || u.username.toLowerCase().includes(term.toLowerCase());
  });

  if (allowed.length === 0) {
    suggestionsBox.classList.add('hidden');
    return;
  }

  suggestionsBox.innerHTML = allowed.slice(0, 8).map((u, idx) => `
    <div class="suggestion-item" onclick="addRecipient('${field}', state.allUsersCache.find(x => x.id === '${u.id}'))">
      <div class="user-cell-avatar ${getAvatarGradient(u.name)}" style="width:28px;height:28px;font-size:10px;">${initials(u.name)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12.5px;font-weight:600;">${esc(u.name)}</div>
        <div style="font-size:10.5px;color:var(--text-tertiary);">@${esc(u.username)}</div>
      </div>
    </div>
  `).join('');

  suggestionsBox.classList.remove('hidden');
}

window.addRecipient = (field, user) => {
  if (!user || recipientChips[field].some(u => u.id === user.id)) return;
  recipientChips[field].push(user);
  renderChips(field);

  const input = document.getElementById(`${field}Input`);
  if (input) input.value = '';

  const suggestionsBox = document.getElementById(`${field}Suggestions`);
  if (suggestionsBox) suggestionsBox.classList.add('hidden');
};

function renderChips(field) {
  const chipContainer = document.getElementById(`${field}Chips`);
  const input = document.getElementById(`${field}Input`);
  if (!chipContainer) return;

  const chipsHtml = recipientChips[field].map(u => `
    <span class="chip">
      <span>${esc(u.name)}</span>
      <button type="button" onclick="removeRecipient('${field}', '${u.id}')">&times;</button>
    </span>
  `).join('');

  chipContainer.innerHTML = chipsHtml;
  if (input) chipContainer.appendChild(input);
}

window.removeRecipient = (field, userId) => {
  recipientChips[field] = recipientChips[field].filter(u => u.id !== userId);
  renderChips(field);
};

window.replyToThread = (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  window.openCompose().then(() => {
    const last = t.lastMsg;
    const replyUserId = last.fromUserId === state.currentUser.uid ? last.toUserId : last.fromUserId;
    const replyUser = state.allUsersCache.find(u => u.id === replyUserId);

    if (replyUser) window.addRecipient('to', replyUser);

    $('#cSubject').value = last.subject.startsWith('Re:') ? last.subject : `Re: ${last.subject}`;
    $('#cThreadId').value = threadId;
  });
};

/* Additional Admin Features placeholder definitions */
async function renderDeletedLog() {
  $('#pageContent').innerHTML = `<div class="dashboard"><h1 class="dashboard-title">سجل المحذوفات</h1><p>جاري العرض...</p></div>`;
}
async function renderPasswordResetRequests() {
  $('#pageContent').innerHTML = `<div class="dashboard"><h1 class="dashboard-title">طلبات تغيير كلمة السر</h1><p>جاري العرض...</p></div>`;
}
function updateDeletedLogBadge() {}
function updatePasswordResetBadge() {}
function closeImageViewer() {}

async function performSend(payload) {
  // Implementation for send action
  await addDoc(collection(db, 'messages'), {
    ...payload,
    createdAt: serverTimestamp()
  });
}
