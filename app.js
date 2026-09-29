/* ═══════════════════════════════════════════════════════════
   Mail System v8.0 - Enterprise Application
   Features: Avatars, CC/BCC, Reply All, Inline Reply,
             Undo Send, Swipe Actions, Skeleton Loaders
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
  roleLabels, roleColors, icons,
  applyTheme, loadTheme, toggleDarkMode, loadSoundSetting, toggleSound, playNotifSound,
  confirmDialog, showToast,
  loadUsersCache, loadDepartmentsCache, getUserById, getUserName, getUsersByDept, getDeptById,
  getMyManagedDepts, isManagerOfDept, getMyTeamMembers,
  saveSession, loadLastUser, copyToClipboard,
  matchesSearch, sanitizeUsername, validateUsername, validatePassword,
  getAvatarColor, unlockAudioOnFirstClick
} from './utils.js';

/* ═══════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════ */
let deferredPrompt = null;
let pendingSendTimeout = null;
let lastSentData = null;

/* ═══════════════════════════════════════════════════════
   AVATAR COLOR HELPER (12 gradients)
   ═══════════════════════════════════════════════════════ */
function getAvatarGradient(name) {
  let hash = 0;
  const str = name || '?';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = (Math.abs(hash) % 12) + 1;
  return 'gradient-' + idx;
}

function applyAvatar(el, name) {
  if (!el) return;
  // Remove all gradient classes
  el.className = el.className.replace(/gradient-\d+/g, '');
  el.classList.add(getAvatarGradient(name));
}

/* ═══════════════════════════════════════════════════════
   GLOBAL LOADER
   ═══════════════════════════════════════════════════════ */
function showLoader() {
  const loader = document.getElementById('globalLoader');
  if (loader) loader.classList.remove('hidden');
}
function hideLoader() {
  const loader = document.getElementById('globalLoader');
  if (loader) loader.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════
   SKELETON LOADER
   ═══════════════════════════════════════════════════════ */
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
    html += `
      <tr>
        <td><div class="skeleton skeleton-line long"></div></td>
        <td><div class="skeleton skeleton-line medium"></div></td>
        <td><div class="skeleton skeleton-line short"></div></td>
        <td><div class="skeleton skeleton-line short"></div></td>
        <td><div class="skeleton skeleton-line short"></div></td>
        <td><div class="skeleton skeleton-line short"></div></td>
      </tr>
    `;
  }
  return html;
}

/* ═══════════════════════════════════════════════════════
   TOAST WITH ACTION
   ═══════════════════════════════════════════════════════ */
function showToastAdvanced(title, body, options = {}) {
  const {
    type = 'info',
    icon = 'mail',
    actionLabel = null,
    onAction = null,
    duration = 5000,
    onClick = null
  } = options;

  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconClass = type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : '';

  toast.innerHTML = `
    <div class="toast-icon ${iconClass}">
      <i data-lucide="${icon}" class="w-4 h-4"></i>
    </div>
    <div class="toast-content">
      <div class="toast-title">${esc(title)}</div>
      ${body ? `<div class="toast-body">${esc(body)}</div>` : ''}
    </div>
    ${actionLabel ? `<button class="toast-action">${esc(actionLabel)}</button>` : ''}
    <button class="toast-close">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    toast.remove();
  };

  const actionBtn = toast.querySelector('.toast-action');
  if (actionBtn && onAction) {
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      onAction();
      toast.remove();
    };
  }

  if (onClick) {
    toast.onclick = () => {
      onClick();
      toast.remove();
    };
  }

  container.appendChild(toast);
  icons();

  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, duration);
  }
}

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════ */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const search = $('#globalSearch');
      if (search && state.currentUser) {
        search.focus();
        search.select();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      if (state.currentUser) openCompose();
    }
    if (e.key === 'Escape') {
      const composeModal = $('#composeModal');
      if (composeModal && composeModal.style.display === 'flex') closeCompose();
      hide($('#profileModal'));
      hide($('#settingsModal'));
      hide($('#forgotModal'));
    }
  });
}

/* ═══════════════════════════════════════════════════════
   PWA HANDLERS
   ═══════════════════════════════════════════════════════ */
function setupPWAHandlers() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('📱 PWA Install prompt captured');
    const installBtn = document.getElementById('installPwaBtn');
    if (installBtn) installBtn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    console.log('✅ PWA Installed');
    deferredPrompt = null;
    const installBtn = document.getElementById('installPwaBtn');
    if (installBtn) installBtn.classList.add('hidden');
    showToastAdvanced('تم التثبيت 🎉', 'التطبيق مثبّت على جهازك', { type: 'success', icon: 'check' });
  });

  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    console.log('📱 Running as PWA');
    document.body.classList.add('pwa-mode');
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'compose') {
    setTimeout(() => { if (state.currentUser) openCompose(); }, 2000);
    window.history.replaceState({}, '', '/Email-system/');
  } else if (params.get('page') === 'inbox') {
    setTimeout(() => { if (state.currentUser) navigate('inbox'); }, 1500);
    window.history.replaceState({}, '', '/Email-system/');
  }
}

window.installPWA = async () => {
  if (!deferredPrompt) {
    showToastAdvanced('التثبيت غير متاح', 'استخدم قائمة المتصفح للإضافة للشاشة الرئيسية', { type: 'warning', icon: 'alert-triangle' });
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log('📱 Install outcome:', outcome);
  deferredPrompt = null;
  const installBtn = document.getElementById('installPwaBtn');
  if (installBtn) installBtn.classList.add('hidden');
};

/* ═══════════════════════════════════════════════════════
   LOGIN UI
   ═══════════════════════════════════════════════════════ */
function setupLoginUI() {
  const loginBtn = $('#loginBtn');
  if (loginBtn) loginBtn.onclick = handleLogin;

  const passInput = $('#loginPass');
  if (passInput) {
    passInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }

  const togglePassBtn = $('#togglePassBtn');
  if (togglePassBtn) {
    togglePassBtn.onclick = () => {
      const inp = $('#loginPass');
      const eye = $('#eyeIcon');
      if (!inp) return;
      if (inp.type === 'password') {
        inp.type = 'text';
        if (eye) eye.setAttribute('data-lucide', 'eye-off');
      } else {
        inp.type = 'password';
        if (eye) eye.setAttribute('data-lucide', 'eye');
      }
      icons();
    };
  }

  const forgotBtn = $('#forgotPassBtn');
  if (forgotBtn) {
    forgotBtn.onclick = () => { show($('#forgotModal')); icons(); };
  }
}

/* ═══════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════ */
async function handleLogin() {
  const u = ($('#loginUser')?.value || '').trim().toLowerCase();
  const p = $('#loginPass')?.value || '';
  const err = $('#loginError');
  const btn = $('#loginBtn');

  hide(err);
  if (!u || !p) {
    err.textContent = 'املأ البيانات';
    show(err);
    return;
  }

  const email = u.includes('@') ? u : `${u}@${EMAIL_DOMAIN}`;
  const remember = $('#rememberMe')?.checked;

  btn.disabled = true;
  btn.querySelector('span').textContent = 'جاري الدخول...';

  try {
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    } catch (e) {}
    await signInWithEmailAndPassword(auth, email, p);
  } catch (e) {
    const messages = {
      'auth/user-not-found': 'المستخدم غير موجود',
      'auth/wrong-password': 'كلمة السر غلط',
      'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
      'auth/invalid-email': 'الإيميل غير صحيح',
      'auth/unauthorized-domain': 'الدومين غير مسموح في Firebase',
      'auth/too-many-requests': 'محاولات كتير — استنى شوية',
      'auth/network-request-failed': 'مشكلة في الاتصال بالإنترنت'
    };
    err.textContent = messages[e.code] || `خطأ: ${e.code}`;
    show(err);
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'تسجيل الدخول';
  }
}

/* ═══════════════════════════════════════════════════════
   FORGOT PASSWORD
   ═══════════════════════════════════════════════════════ */
window.closeForgotModal = () => {
  hide($('#forgotModal'));
  const inp = $('#forgotEmail');
  if (inp) inp.value = '';
  const st = $('#forgotStatus');
  if (st) { st.classList.add('hidden'); st.textContent = ''; }
};

window.sendPasswordReset = async () => {
  const email = ($('#forgotEmail')?.value || '').trim().toLowerCase();
  const status = $('#forgotStatus');
  if (!email) {
    status.className = 'alert alert-error';
    status.textContent = 'اكتب الإيميل';
    show(status);
    return;
  }
  status.className = 'alert alert-info';
  status.textContent = 'جاري الإرسال...';
  show(status);

  const result = await resetUserPassword(email);
  if (result.success) {
    status.className = 'alert alert-success';
    status.textContent = '✅ تم إرسال رابط الاستعادة للإيميل';
  } else {
    status.className = 'alert alert-error';
    if (result.error === 'auth/user-not-found') status.textContent = 'الإيميل غير مسجل';
    else if (result.error === 'auth/invalid-email') status.textContent = 'الإيميل غير صحيح';
    else status.textContent = result.message || 'خطأ في الإرسال';
  }
};

/* ═══════════════════════════════════════════════════════
   AUTH STATE
   ═══════════════════════════════════════════════════════ */
function checkAuthState() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.currentUser = null;
      if (state.unsubMessages) {
        state.unsubMessages();
        state.unsubMessages = null;
      }
      show($('#loginScreen'));
      hide($('#app'));
      return;
    }

    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
      alert('لا يوجد ملف مستخدم في Firestore لهذا الحساب\nUID: ' + user.uid);
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
    updateUIForRole();

    hide($('#loginScreen'));
    show($('#app'));
    icons();
    initSidebar();
    navigate('inbox');

    startMessagesListener();
    setTimeout(registerFCMToken, 1500);
  });
}

/* ═══════════════════════════════════════════════════════
   UPDATE UI FOR ROLE
   ═══════════════════════════════════════════════════════ */
function updateUIForRole() {
  const nameEl = $('#userName');
  const roleEl = $('#userRole');
  const avatarEl = $('#userAvatar');
  const menuName = $('#menuUserName');
  const menuEmail = $('#menuUserEmail');
  const menuAvatar = $('#menuUserAvatar');
  const initial = initials(state.currentUser.name);

  if (nameEl) nameEl.textContent = state.currentUser.name;
  if (roleEl) roleEl.textContent = roleLabels[state.currentUser.role] || state.currentUser.role;
  if (avatarEl) {
    avatarEl.textContent = initial;
    applyAvatar(avatarEl, state.currentUser.name);
  }
  if (menuName) menuName.textContent = state.currentUser.name;
  if (menuEmail) menuEmail.textContent = state.currentUser.email || '';
  if (menuAvatar) {
    menuAvatar.textContent = initial;
    applyAvatar(menuAvatar, state.currentUser.name);
  }

  const admin = isAdmin();
  $$('[data-admin-only]').forEach(el => {
    if (admin) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  const manager = isManagerOrAbove();
  $$('[data-manager-only]').forEach(el => {
    if (manager) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

/* ═══════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════ */
function initSidebar() {
  const sidebar = $('#sidebar');
  const mobileNav = $('#mobileNav');
  const main = $('#mainContent');

  try {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved === '1') {
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
  const sidebar = $('#sidebar');
  state.sidebarCollapsed = !state.sidebarCollapsed;
  if (state.sidebarCollapsed) sidebar.classList.add('collapsed');
  else sidebar.classList.remove('collapsed');
  try {
    localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed ? '1' : '0');
  } catch (e) {}
};

/* ═══════════════════════════════════════════════════════
   GLOBAL LISTENERS
   ═══════════════════════════════════════════════════════ */
function setupGlobalListeners() {
  const toggleBtn = $('#toggleSidebar');
  if (toggleBtn) toggleBtn.onclick = window.toggleSidebar;

  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  const nav = $('#nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (btn) navigate(btn.dataset.page);
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
      if (dd.style.display === 'block') hideStyle(dd);
      else showStyle(dd);
    };
  }

  const userMenuBtn = $('#userMenuBtn');
  if (userMenuBtn) {
    userMenuBtn.onclick = (e) => {
      e.stopPropagation();
      const menu = $('#userMenu');
      if (menu.style.display === 'block') hideStyle(menu);
      else showStyle(menu);
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
    if (!e.target.closest('#notifBtn') && !e.target.closest('#notifDropdown')) {
      hideStyle($('#notifDropdown'));
    }
    if (!e.target.closest('#userMenuBtn') && !e.target.closest('#userMenu')) {
      hideStyle($('#userMenu'));
    }
  });

  const searchInput = $('#globalSearch');
  if (searchInput) {
    let searchTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = e.target.value.trim();
        if (q) {
          state.searchQuery = q;
          navigate('inbox');
        } else {
          state.searchQuery = '';
          if (state.currentFilter === 'search') navigate('inbox');
        }
      }, 400);
    });
  }

  const composeModal = $('#composeModal');
  if (composeModal) {
    composeModal.addEventListener('click', (e) => {
      if (e.target.id === 'composeModal') closeCompose();
    });
  }
}

async function handleLogout() {
  const ok = await confirmDialog('تسجيل الخروج', 'هل أنت متأكد إنك عايز تسجل خروج؟');
  if (!ok) return;

  try {
    if (messaging && state.currentUser) {
      const reg = await navigator.serviceWorker.getRegistration('/Email-system/');
      if (reg) {
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: reg
        }).catch(() => null);
        if (token) {
          await deleteDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token));
        }
      }
    }
  } catch (e) {}

  await signOut(auth);
}

window.signOutApp = handleLogout;

/* ═══════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════ */
const ROUTES = {
  inbox: renderInbox,
  sent: renderSent,
  starred: renderStarred,
  trash: renderTrash,
  myteam: renderMyTeam,
  users: renderUsers,
  departments: renderDepartments
};

export function navigate(page) {
  state.currentFilter = page;

  $$('.nav-item').forEach(b => {
    const active = b.dataset.page === page;
    b.classList.toggle('active', active);
  });
  $$('.mnav-item').forEach(b => {
    const active = b.dataset.page === page;
    b.classList.toggle('active', active);
  });

  const route = ROUTES[page];
  if (route) route();
  icons();
}

window.navigate = navigate;

/* ═══════════════════════════════════════════════════════
   MY TEAM
   ═══════════════════════════════════════════════════════ */
async function renderMyTeam() {
  await loadUsersCache();
  await loadDepartmentsCache();

  const myDepts = getMyManagedDepts();
  const team = getMyTeamMembers();

  const byDept = {};
  myDepts.forEach(d => byDept[d.id] = []);
  team.forEach(u => {
    if (u.departmentId && byDept[u.departmentId]) byDept[u.departmentId].push(u);
  });

  const deptSections = myDepts.map(d => {
    const members = byDept[d.id] || [];
    const memberRows = members.map(m => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);">
        <div class="user-cell-avatar ${getAvatarGradient(m.name)}">${initials(m.name)}</div>
        <div style="flex:1;min-width:0;">
          <div class="user-cell-name">${esc(m.name)}</div>
          <div class="user-cell-email">@${esc(m.username)}</div>
        </div>
        <button onclick="quickSendToUser('${m.id}')" class="row-action primary" title="إرسال رسالة">
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
          <div style="font-size:13px;color:var(--text-tertiary);">تواصل مع الأدمن لتعيينك مدير قسم</div>
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
  const sel = $('#cTo');
  if (sel) sel.value = userId;
};

window.quickSendToDept = async (deptId) => {
  await window.openCompose();
  const deptCheckbox = $('#cDept');
  const deptSelect = $('#deptSelect');
  if (deptCheckbox && deptSelect) {
    deptSelect.value = deptId;
    deptCheckbox.checked = true;
    window.toggleDeptSend();
  }
};

window.quickSendToTeam = async () => {
  await window.openCompose();
  const deptCheckbox = $('#cDept');
  if (deptCheckbox) {
    deptCheckbox.checked = true;
    window.toggleDeptSend();
  }
};

/* ═══════════════════════════════════════════════════════
   USERS MANAGEMENT
   ═══════════════════════════════════════════════════════ */
async function renderUsers() {
  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div>
          <h1 class="dashboard-title">المستخدمين</h1>
          <p class="dashboard-date">جاري التحميل...</p>
        </div>
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
    const roleClass = `role-${u.role}`;
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
        <td style="font-family:monospace;font-size:12.5px;color:var(--text-secondary);">${esc(u.username)}</td>
        <td>
          ${dept ? `<span style="font-size:11.5px;background:#E5F0FA;color:var(--brand-primary);padding:3px 8px;border-radius:4px;font-weight:600;">${esc(dept.name)}</span>` : '<span style="color:var(--text-disabled);">—</span>'}
        </td>
        <td><span class="role-badge ${roleClass}">${uLabel}</span></td>
        <td>
          <span class="status-cell ${u.isActive === false ? 'status-inactive' : 'status-active'}">
            <span class="status-dot"></span>
            ${u.isActive === false ? 'معطّل' : 'نشط'}
          </span>
        </td>
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

  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div>
          <h1 class="dashboard-title">المستخدمين</h1>
          <p class="dashboard-date">${state.allUsersCache.length} مستخدم</p>
        </div>
        <button onclick="openAddUser()" class="btn btn-primary">
          <i data-lucide="user-plus" class="w-4 h-4"></i>
          <span>إضافة مستخدم</span>
        </button>
      </div>

      <div id="addUserForm" class="section hidden fade-in">
        <h3 class="section-title">مستخدم جديد</h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group">
            <label class="form-label">الاسم الكامل</label>
            <input id="nuName" class="form-input" placeholder="محمد أحمد" />
          </div>
          <div class="form-group">
            <label class="form-label">اسم المستخدم</label>
            <input id="nuUser" class="form-input" placeholder="mohamed" />
          </div>
          <div class="form-group">
            <label class="form-label">كلمة السر</label>
            <input id="nuPass" type="text" class="form-input" placeholder="6 حروف على الأقل" />
          </div>
          <div class="form-group">
            <label class="form-label">الدور</label>
            <select id="nuRole" class="form-input">
              <option value="user">مستخدم عادي</option>
              <option value="manager">مدير قسم</option>
              ${isOwner() ? '<option value="admin">أدمن</option>' : ''}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">القسم</label>
            <select id="nuDept" class="form-input"><option value="">— بدون قسم —</option></select>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-tertiary);margin:12px 0 0;">
          الإيميل: <span style="font-family:monospace;">username@${EMAIL_DOMAIN}</span>
        </p>
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
          <div class="form-group">
            <label class="form-label">الاسم</label>
            <input id="euName" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label">اسم المستخدم</label>
            <input id="euUser" class="form-input form-input-disabled" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">الدور</label>
            <select id="euRole" class="form-input">
              <option value="user">مستخدم عادي</option>
              <option value="manager">مدير قسم</option>
              ${isOwner() ? '<option value="admin">أدمن</option>' : ''}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">القسم</label>
            <select id="euDept" class="form-input"><option value="">— بدون قسم —</option></select>
          </div>
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
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>اسم المستخدم</th>
                <th>القسم</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th style="text-align:left;">إجراءات</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text-tertiary);">لا يوجد مستخدمين</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  fillDeptSelects();
  icons();
}

function fillDeptSelects() {
  const opts = state.allDeptsCache.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  ['nuDept', 'euDept'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel && sel.options.length === 1) {
      sel.innerHTML = '<option value="">— بدون قسم —</option>' + opts;
    }
  });
}

window.openAddUser = () => { show($('#addUserForm')); hide($('#editUserForm')); fillDeptSelects(); };
window.closeAddUser = () => hide($('#addUserForm'));

window.createNewUser = async () => {
  const name = $('#nuName').value.trim();
  const user = sanitizeUsername($('#nuUser').value);
  const pass = $('#nuPass').value;
  const role = $('#nuRole').value;
  const deptId = $('#nuDept').value;
  const err = $('#nuErr');
  hide(err);

  if (!name || !user || !pass) { err.className = 'alert alert-error'; err.textContent = 'املأ كل البيانات'; show(err); return; }
  if (!validateUsername(user)) { err.className = 'alert alert-error'; err.textContent = 'اسم المستخدم بحروف إنجليزية (3-30 حرف)'; show(err); return; }
  if (!validatePassword(pass)) { err.className = 'alert alert-error'; err.textContent = 'كلمة السر 6 حروف على الأقل'; show(err); return; }

  err.className = 'alert alert-info'; err.textContent = 'جاري الإنشاء...'; show(err);

  try {
    const email = `${user}@${EMAIL_DOMAIN}`;
    const uid = await createAuthUser(email, pass);
    await setDoc(doc(db, 'users', uid), {
      name, username: user, email, role,
      departmentId: deptId || null,
      isActive: true, createdAt: serverTimestamp()
    });
    err.className = 'alert alert-success'; err.textContent = `✅ تم إنشاء ${user} بنجاح!`;
    $('#nuName').value = ''; $('#nuUser').value = ''; $('#nuPass').value = '';
    showToastAdvanced('تم الإنشاء ✅', `${user} أضيف للنظام بنجاح`, { type: 'success', icon: 'user-check', duration: 3000 });
    setTimeout(() => { hide($('#addUserForm')); renderUsers(); }, 1200);
  } catch (e) {
    err.className = 'alert alert-error';
    err.textContent = e.code === 'auth/email-already-in-use' ? 'اسم المستخدم مستخدم قبل كده' : e.message;
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
  show($('#editUserForm'));
  hide($('#addUserForm'));
  $('#editUserForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
window.closeEditUser = () => hide($('#editUserForm'));

window.saveEditUser = async () => {
  const uid = $('#euId').value;
  const name = $('#euName').value.trim();
  const role = $('#euRole').value;
  const deptId = $('#euDept').value;
  const err = $('#euErr');
  hide(err);
  if (!name) { err.className = 'alert alert-error'; err.textContent = 'اكتب الاسم'; show(err); return; }
  try {
    await updateDoc(doc(db, 'users', uid), { name, role, departmentId: deptId || null });
    hide($('#editUserForm'));
    showToastAdvanced('تم الحفظ ✅', 'التعديلات اتحفظت', { type: 'success', icon: 'check', duration: 2000 });
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

/* ═══════════════════════════════════════════════════════
   DEPARTMENTS
   ═══════════════════════════════════════════════════════ */
async function renderDepartments() {
  await loadDepartmentsCache();
  await loadUsersCache();

  const cards = state.allDeptsCache.map(d => {
    const members = getUsersByDept(d.id);
    const manager = d.managerId ? getUserById(d.managerId) : null;
    return `
      <div class="dept-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;">
          <div class="dept-card-icon">
            <i data-lucide="building-2" class="w-5 h-5"></i>
          </div>
          <div style="display:flex;gap:4px;">
            <button onclick="editDept('${d.id}')" class="row-action primary" title="تعديل"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
            <button onclick="deleteDept('${d.id}')" class="row-action danger" title="حذف"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>
        </div>
        <div class="dept-card-name">${esc(d.name)}</div>
        <div class="dept-card-desc">${esc(d.description || 'بدون وصف')}</div>
        <div class="dept-card-footer">
          <div style="display:flex;align-items:center;gap:6px;">
            <i data-lucide="users" class="w-3.5 h-3.5"></i>
            <span>${members.length} عضو</span>
          </div>
          ${manager ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="width:22px;height:22px;border-radius:50%;background:#8764B8;color:white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${initials(manager.name)}</div>
              <span style="font-size:11.5px;color:#8764B8;font-weight:600;">${esc(manager.name)}</span>
            </div>
          ` : `
            <button onclick="editDept('${d.id}')" style="background:none;border:none;color:#E8A100;font-size:11.5px;cursor:pointer;font-weight:600;">
              ⚠ بدون مدير
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="dashboard">
      <div class="page-header" style="padding:0 0 20px;border:none;">
        <div>
          <h1 class="dashboard-title">الأقسام</h1>
          <p class="dashboard-date">${state.allDeptsCache.length} قسم</p>
        </div>
      </div>

      <div class="section">
        <h3 class="section-title">إضافة قسم جديد</h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end;">
          <div class="form-group">
            <label class="form-label">اسم القسم</label>
            <input id="dName" class="form-input" placeholder="تكنولوجيا المعلومات" />
          </div>
          <div class="form-group">
            <label class="form-label">وصف (اختياري)</label>
            <input id="dDesc" class="form-input" placeholder="وصف مختصر" />
          </div>
          <div class="form-group">
            <label class="form-label">مدير القسم</label>
            <select id="dManager" class="form-input"><option value="">— بدون مدير —</option></select>
          </div>
          <button onclick="addDept()" class="btn btn-primary" style="height:36px;">
            <i data-lucide="plus" class="w-4 h-4"></i>
            <span>إضافة</span>
          </button>
        </div>
      </div>

      <div class="dept-grid">
        ${cards || '<div class="empty-state" style="grid-column:1/-1;"><i data-lucide="building-2"></i><p>لا يوجد أقسام بعد</p></div>'}
      </div>
    </div>
  `;

  const managerOpts = state.allUsersCache
    .filter(u => u.isActive !== false)
    .map(u => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)})</option>`)
    .join('');
  const dManager = document.getElementById('dManager');
  if (dManager) dManager.innerHTML = '<option value="">— بدون مدير —</option>' + managerOpts;

  icons();
}

window.addDept = async () => {
  const name = $('#dName').value.trim();
  const description = $('#dDesc').value.trim();
  const managerId = $('#dManager').value;
  if (!name) return alert('اكتب اسم القسم');
  await addDoc(collection(db, 'departments'), {
    name, description, managerId: managerId || null, createdAt: serverTimestamp()
  });
  showToastAdvanced('تم الإضافة ✅', `قسم ${name} اتعمل`, { type: 'success', icon: 'building-2', duration: 2500 });
  renderDepartments();
};

window.editDept = async (id) => {
  const d = state.allDeptsCache.find(x => x.id === id);
  if (!d) return;

  const managerOpts = state.allUsersCache
    .filter(u => u.isActive !== false)
    .map(u => `<option value="${u.id}" ${u.id === d.managerId ? 'selected' : ''}>${esc(u.name)} (@${esc(u.username)})</option>`)
    .join('');

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'deptEditModal';
  modal.innerHTML = `
    <div class="modal-panel modal-md fade-in">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">تعديل القسم</h2>
          <p class="modal-subtitle">${esc(d.name)}</p>
        </div>
        <button onclick="document.getElementById('deptEditModal').remove()" class="icon-btn icon-btn-ghost">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">اسم القسم</label>
          <input id="editDeptName" class="form-input" value="${esc(d.name)}" />
        </div>
        <div class="form-group">
          <label class="form-label">الوصف</label>
          <input id="editDeptDesc" class="form-input" value="${esc(d.description || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">مدير القسم</label>
          <select id="editDeptManager" class="form-input">
            <option value="">— بدون مدير —</option>
            ${managerOpts}
          </select>
        </div>
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
  const modal = document.getElementById('deptEditModal');
  if (modal) modal.remove();
  renderDepartments();
};

window.deleteDept = async (id) => {
  const ok = await confirmDialog('حذف القسم', 'متأكد من حذف القسم؟');
  if (!ok) return;
  await deleteDoc(doc(db, 'departments', id));
  renderDepartments();
};

/* ═══════════════════════════════════════════════════════
   INBOX (Threads)
   ═══════════════════════════════════════════════════════ */
async function renderInbox() {
  // Show skeleton immediately
  const filter = state.currentFilter;
  const title = {
    inbox: 'صندوق الوارد',
    sent: 'المُرسلة',
    starred: 'المميزة',
    trash: 'سلة المهملات',
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
        <div class="empty-state" style="flex:1;min-height:400px;">
          <i data-lucide="mail-open"></i>
          <p>جاري التحميل...</p>
        </div>
      </div>
    </div>
  `;
  icons();

  const q1 = query(collection(db, 'messages'), where('toUserId', '==', state.currentUser.uid));
  const q2 = query(collection(db, 'messages'), where('fromUserId', '==', state.currentUser.uid));
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

  const all = new Map();
  [...snap1.docs, ...snap2.docs].forEach(d => {
    all.set(d.id, { id: d.id, ...d.data() });
  });

  const visible = Array.from(all.values()).filter(m => {
    if (state.currentFilter === 'trash') return m.deleted;
    return !m.deleted;
  });

  const threadsMap = {};
  visible.forEach(m => {
    const tid = m.threadId || m.id;
    if (!threadsMap[tid]) {
      threadsMap[tid] = { threadId: tid, messages: [], subject: m.subject, firstAt: Infinity };
    }
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
    return t;
  }).sort((a, b) => b.lastAt - a.lastAt);

  if (state.searchQuery) {
    threads = threads.filter(t => t.messages.some(m => matchesSearch(m, state.searchQuery)));
  }

  state.threadsCache = threads;
  renderThreadList();
}

function renderThreadList() {
  const filter = state.currentFilter;
  const title = {
    inbox: 'صندوق الوارد',
    sent: 'المُرسلة',
    starred: 'المميزة',
    trash: 'سلة المهملات',
    search: 'نتائج البحث'
  }[filter] || 'صندوق الوارد';

  const listHtml = state.threadsCache.map(t => {
    const last = t.lastMsg;
    const otherName = t.isFromMe ? last.toUserName : last.fromUserName;
    const otherInitial = initials(otherName);
    const unreadClass = t.unread > 0 ? 'unread' : '';
    const avatarClass = getAvatarGradient(otherName);

    return `
      <div class="msg-item ${t.threadId === state.selectedThreadId ? 'active' : ''} ${unreadClass}" data-thread="${t.threadId}">
        <div class="msg-swipe-actions right">
          <button class="swipe-action star" onclick="event.stopPropagation(); swipeStar('${t.threadId}')">
            <i data-lucide="star" class="w-5 h-5"></i>
            <span>تمييز</span>
          </button>
          <button class="swipe-action delete" onclick="event.stopPropagation(); swipeDelete('${t.threadId}')">
            <i data-lucide="trash-2" class="w-5 h-5"></i>
            <span>حذف</span>
          </button>
        </div>
        <div class="msg-item-inner" onclick="openThread('${t.threadId}')">
          <div class="msg-avatar ${avatarClass}">${otherInitial}</div>
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
            <div class="msg-preview">
              ${t.isFromMe ? 'أنت: ' : ''}${esc((last.body || '').slice(0, 60))}
            </div>
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
          <button onclick="renderInbox()" class="icon-btn icon-btn-ghost" title="تحديث">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
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

/* ═══════════════════════════════════════════════════════
   SWIPE GESTURES (Mobile)
   ═══════════════════════════════════════════════════════ */
function setupSwipeGestures() {
  if (window.innerWidth >= 768) return; // Desktop only no swipe

  document.querySelectorAll('.msg-item').forEach(item => {
    const inner = item.querySelector('.msg-item-inner');
    if (!inner) return;

    let startX = 0;
    let currentX = 0;
    let isDragging = false;

    const onStart = (e) => {
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      currentX = 0;
      isDragging = true;
      inner.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!isDragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      currentX = x - startX;

      // Only allow left swipe (RTL: shows actions on right)
      if (currentX > 0) currentX = 0;
      if (currentX < -160) currentX = -160;

      inner.style.transform = `translateX(${currentX}px)`;
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      inner.style.transition = 'transform 0.2s ease';

      if (currentX < -80) {
        inner.style.transform = 'translateX(-160px)';
      } else {
        inner.style.transform = 'translateX(0)';
      }
    };

    inner.addEventListener('touchstart', onStart, { passive: true });
    inner.addEventListener('touchmove', onMove, { passive: true });
    inner.addEventListener('touchend', onEnd);

    // Close on outside touch
    document.addEventListener('touchstart', (e) => {
      if (!item.contains(e.target)) {
        inner.style.transition = 'transform 0.2s ease';
        inner.style.transform = 'translateX(0)';
      }
    }, { passive: true });
  });
}

window.swipeStar = async (threadId) => {
  await window.toggleStar(threadId);
  showToastAdvanced('تم التمييز ⭐', '', { type: 'success', icon: 'star', duration: 1500 });
};

window.swipeDelete = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  const ok = await confirmDialog('حذف المحادثة', 'هيتم نقل الرسائل للسلة. متأكد؟');
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
    content.innerHTML = `
      <div class="empty-state" style="flex:1;min-height:400px;">
        <i data-lucide="mail-open"></i>
        <p>اختر رسالة لعرضها</p>
      </div>`;
    icons();
    return;
  }

  state._currentThreadLastMsgId = t.lastMsg.id;
  const lastIdx = t.messages.length - 1;
  const isTrash = state.currentFilter === 'trash';

  const replyUserId = t.lastMsg.fromUserId === state.currentUser.uid ? t.lastMsg.toUserId : t.lastMsg.fromUserId;
  const replyUserName = t.lastMsg.fromUserId === state.currentUser.uid ? t.lastMsg.toUserName : t.lastMsg.fromUserName;

  const messagesHtml = t.messages.map((m, idx) => {
    const isMe = m.fromUserId === state.currentUser.uid;
    const isLatest = idx === lastIdx;
    const isExpanded = state.expandedMsgs.has(idx);
    const open = isLatest || isExpanded;
    const senderEmail = m.fromUserUsername ? `${m.fromUserUsername}@${EMAIL_DOMAIN}` : '';
    const dateStr = formatDate(m.createdAt);
    const avatarClass = getAvatarGradient(m.fromUserName);

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
          <div class="email-message-body">${esc(m.body || '')}</div>
        ` : ''}
      </div>
    `;
  }).join('');

  const threadStarred = t.messages.some(m => m.starred);

  // Inline reply box
  const inlineReplyHtml = !isTrash ? `
    <div class="inline-reply" id="inlineReplyBox">
      <div class="inline-reply-header" onclick="toggleInlineReply()">
        <i data-lucide="reply" class="w-4 h-4"></i>
        <span>رد سريع على ${esc(replyUserName)}</span>
        <i data-lucide="chevron-down" class="w-4 h-4" style="margin-right:auto;" id="inlineReplyChevron"></i>
      </div>
      <div class="inline-reply-body" id="inlineReplyBody" style="display:none;">
        <textarea id="inlineReplyText" class="inline-reply-input" placeholder="اكتب ردك هنا..."></textarea>
        <div class="inline-reply-actions">
          <button onclick="sendInlineReply('${replyUserId}', '${t.threadId}', '${esc(t.subject).replace(/'/g, "\\'")}')" class="btn-send-primary">
            <i data-lucide="send" class="w-4 h-4"></i>
            <span>إرسال الرد</span>
          </button>
          <button onclick="toggleInlineReply()" class="btn-text">إلغاء</button>
        </div>
        <p id="inlineReplyStatus" class="send-status"></p>
      </div>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="reading-toolbar">
      <button onclick="backToList()" class="toolbar-btn" style="display:none;" id="mobileBackBtn">
        <i data-lucide="arrow-right" class="w-4 h-4"></i>
      </button>

      ${!isTrash ? `
        <button onclick="replyToThread('${replyUserId}', '${esc(replyUserName).replace(/'/g, "\\'")}', '${t.threadId}', '${esc(t.subject).replace(/'/g, "\\'")}')" class="toolbar-btn primary">
          <i data-lucide="reply" class="w-4 h-4"></i>
          <span>رد</span>
        </button>
        <button onclick="replyAllToThread('${t.threadId}')" class="toolbar-btn primary">
          <i data-lucide="reply-all" class="w-4 h-4"></i>
          <span>رد على الكل</span>
        </button>
        <button onclick="toggleStar('${t.threadId}')" class="toolbar-btn ${threadStarred ? 'primary' : ''}">
          <i data-lucide="star" class="w-4 h-4" ${threadStarred ? 'fill="currentColor"' : ''}></i>
          <span>${threadStarred ? 'مميزة' : 'تمييز'}</span>
        </button>
      ` : ''}

      <button onclick="trashThread('${t.threadId}', ${isTrash})" class="toolbar-btn ${isTrash ? 'primary' : 'danger'}">
        <i data-lucide="${isTrash ? 'rotate-ccw' : 'trash-2'}" class="w-4 h-4"></i>
        <span>${isTrash ? 'استعادة' : 'حذف'}</span>
      </button>

      ${isTrash ? `
        <button onclick="permanentDelete('${t.threadId}')" class="toolbar-btn danger">
          <i data-lucide="x-circle" class="w-4 h-4"></i>
          <span>حذف نهائي</span>
        </button>
      ` : ''}

      <div class="toolbar-spacer"></div>

      <button onclick="toggleAllMsgs()" class="toolbar-btn" title="فتح/طي الكل">
        <i data-lucide="chevrons-down-up" class="w-4 h-4"></i>
      </button>
    </div>

    <div class="reading-body">
      <h1 class="reading-subject">${esc(t.subject)}</h1>
      <div class="reading-meta">
        <span><i data-lucide="message-square" class="w-3 h-3 inline"></i> ${t.messages.length} رسالة</span>
        <span><i data-lucide="clock" class="w-3 h-3 inline"></i> آخر تحديث ${timeAgo(t.lastMsg.createdAt)}</span>
      </div>
      ${messagesHtml}
      ${inlineReplyHtml}
    </div>
  `;

  // Show mobile back button
  const mobileBackBtn = document.getElementById('mobileBackBtn');
  if (mobileBackBtn && window.innerWidth < 768) {
    mobileBackBtn.style.display = 'inline-flex';
  }

  icons();
}

window.toggleInlineReply = () => {
  const body = document.getElementById('inlineReplyBody');
  const chevron = document.getElementById('inlineReplyChevron');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = 'flex';
    if (chevron) chevron.setAttribute('data-lucide', 'chevron-up');
    setTimeout(() => document.getElementById('inlineReplyText')?.focus(), 100);
  } else {
    body.style.display = 'none';
    if (chevron) chevron.setAttribute('data-lucide', 'chevron-down');
  }
  icons();
};

window.sendInlineReply = async (toUserId, threadId, subject) => {
  const text = document.getElementById('inlineReplyText')?.value.trim();
  const status = document.getElementById('inlineReplyStatus');
  if (!text) {
    if (status) { status.style.color = 'var(--danger)'; status.textContent = 'اكتب رد'; }
    return;
  }

  try {
    const toUser = state.allUsersCache.find(u => u.id === toUserId);
    const msgRef = doc(collection(db, 'messages'));
    await setDoc(msgRef, {
      subject: subject.startsWith('رد:') ? subject : 'رد: ' + subject,
      body: text,
      priority: 'normal',
      fromUserId: state.currentUser.uid,
      fromUserName: state.currentUser.name,
      fromUserUsername: state.currentUser.username,
      toUserId,
      toUserName: toUser?.name || '',
      read: false,
      threadId,
      parentId: state._currentThreadLastMsgId,
      notified: false,
      starred: false, deleted: false,
      createdAt: serverTimestamp()
    });

    if (status) { status.style.color = 'var(--success)'; status.textContent = '✅ تم إرسال الرد!'; }
    showToastAdvanced('تم الإرسال ✅', 'الرد اتبعت بنجاح', { type: 'success', icon: 'send', duration: 2000 });

    // Clear + close
    document.getElementById('inlineReplyText').value = '';
    setTimeout(() => {
      toggleInlineReply();
      renderInbox();
    }, 800);
  } catch (e) {
    if (status) { status.style.color = 'var(--danger)'; status.textContent = e.message; }
  }
};

window.replyAllToThread = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;

  // Collect all unique participants
  const participants = new Set();
  t.messages.forEach(m => {
    if (m.fromUserId && m.fromUserId !== state.currentUser.uid) participants.add(m.fromUserId);
    if (m.toUserId && m.toUserId !== state.currentUser.uid) participants.add(m.toUserId);
  });

  await window.openCompose();
  $('#cThreadId').value = threadId;
  $('#cSubject').value = t.subject.startsWith('رد:') ? t.subject : 'رد: ' + t.subject;

  // Show CC field and put extra participants there
  const ccbccFields = $('#ccbccFields');
  if (ccbccFields) ccbccFields.classList.remove('hidden');

  // Set first participant as primary "To", rest as CC
  const list = Array.from(participants);
  if (list.length > 0) {
    $('#cTo').value = list[0];
    if (list.length > 1 && $('#cCC')) {
      // Put first extra in CC (single select limitation)
      $('#cCC').value = list[1];
    }
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
  for (let i = 0; i < lastIdx; i++) {
    if (!state.expandedMsgs.has(i)) { allOpen = false; break; }
  }
  if (allOpen) state.expandedMsgs.clear();
  else { for (let i = 0; i < lastIdx; i++) state.expandedMsgs.add(i); }
  renderThreadReading();
};

window.backToList = () => {
  $('#inboxList')?.classList.remove('mobile-hidden');
  $('#inboxReading')?.classList.remove('mobile-show');
  state.selectedThreadId = null;
  state.expandedMsgs.clear();
  renderThreadList();
};

/* ═══════════════════════════════════════════════════════
   STAR / TRASH
   ═══════════════════════════════════════════════════════ */
window.toggleStar = async (threadId) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  const anyStarred = t.messages.some(m => m.starred);
  const newVal = !anyStarred;
  for (const m of t.messages) {
    if (m.toUserId === state.currentUser.uid || m.fromUserId === state.currentUser.uid) {
      await updateDoc(doc(db, 'messages', m.id), { starred: newVal }).catch(() => {});
      m.starred = newVal;
    }
  }
  renderThreadReading();
};

window.trashThread = async (threadId, isTrash) => {
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  const newVal = !isTrash;
  for (const m of t.messages) {
    await updateDoc(doc(db, 'messages', m.id), {
      deleted: newVal,
      deletedAt: newVal ? serverTimestamp() : null
    }).catch(() => {});
    m.deleted = newVal;
  }
  if (state.currentFilter === 'trash' && !newVal) renderInbox();
  else if (state.currentFilter !== 'trash' && newVal) renderInbox();
  else renderThreadReading();
};

window.permanentDelete = async (threadId) => {
  const ok = await confirmDialog('حذف نهائي', 'هيتم حذف الرسائل نهائيًا. متأكد؟');
  if (!ok) return;
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  for (const m of t.messages) await deleteDoc(doc(db, 'messages', m.id));
  state.selectedThreadId = null;
  renderInbox();
};

/* ═══════════════════════════════════════════════════════
   STARRED & TRASH
   ═══════════════════════════════════════════════════════ */
async function renderStarred() {
  state.currentFilter = 'starred';
  state.searchQuery = '';
  await renderInbox();
}

async function renderTrash() {
  state.currentFilter = 'trash';
  state.searchQuery = '';
  await renderInbox();
}

/* ═══════════════════════════════════════════════════════
   SENT
   ═══════════════════════════════════════════════════════ */
async function renderSent() {
  const q = query(collection(db, 'messages'), where('fromUserId', '==', state.currentUser.uid));
  const snap = await getDocs(q);
  const list = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(m => !m.deleted)
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
        <div>
          <h1 class="dashboard-title">الرسائل المُرسلة</h1>
          <p class="dashboard-date">${list.length} رسالة</p>
        </div>
      </div>
      <div class="data-table-wrapper" style="padding:0;">
        ${rows || '<div class="empty-state"><i data-lucide="send"></i><p>لا رسائل مُرسلة</p></div>'}
      </div>
    </div>
  `;
  icons();
}

/* ═══════════════════════════════════════════════════════
   COMPOSE v8.0 (with CC/BCC + Undo Send)
   ═══════════════════════════════════════════════════════ */
window.openCompose = async () => {
  await loadUsersCache();
  await loadDepartmentsCache();

  const others = state.allUsersCache.filter(u =>
    u.id !== state.currentUser.uid && u.isActive !== false
  );

  const userOptions = (includeEmpty = true) => {
    return (includeEmpty ? '<option value="">— اختر —</option>' : '') + others.map(u => {
      const roleTag = u.role === 'owner' ? ' 👑' : u.role === 'admin' ? ' 🛡️' : u.role === 'manager' ? ' 👔' : '';
      const deptName = u.departmentId ? (getDeptById(u.departmentId)?.name || '') : '';
      const deptTag = deptName ? ` · ${deptName}` : '';
      return `<option value="${u.id}">${esc(u.name)}${roleTag} (${esc(u.username)}${deptTag})</option>`;
    }).join('');
  };

  $('#cTo').innerHTML = userOptions();
  if ($('#cCC')) $('#cCC').innerHTML = userOptions();
  if ($('#cBCC')) $('#cBCC').innerHTML = userOptions();

  // Hide CC/BCC by default
  const ccbccFields = $('#ccbccFields');
  if (ccbccFields) ccbccFields.classList.add('hidden');
  const ccbccIcon = $('#ccbccIcon');
  if (ccbccIcon) ccbccIcon.setAttribute('data-lucide', 'chevron-down');

  const deptSel = $('#deptSelect');
  const deptBox = $('#deptBox');

  if (isAdmin()) {
    if (deptSel) {
      deptSel.innerHTML = '<option value="">— اختر قسم —</option>' + state.allDeptsCache.map(d =>
        `<option value="${d.id}">${esc(d.name)} (${getUsersByDept(d.id).length})</option>`
      ).join('');
    }
    if (deptBox) deptBox.style.display = 'flex';
    const label = $('#deptSendLabel');
    if (label) label.textContent = 'إرسال لكل موظفي قسم';
  } else if (isDeptManager()) {
    const myDepts = getMyManagedDepts();
    if (deptSel) {
      deptSel.innerHTML = '<option value="">— اختر قسم —</option>' + myDepts.map(d =>
        `<option value="${d.id}">${esc(d.name)} (${getUsersByDept(d.id).length})</option>`
      ).join('');
    }
    if (deptBox) deptBox.style.display = 'flex';
    const label = $('#deptSendLabel');
    if (label) label.textContent = 'إرسال لكل فريقي';
  } else {
    if (deptBox) deptBox.style.display = 'none';
  }

  $('#cSubject').value = '';
  $('#cBody').value = '';
  $('#cThreadId').value = '';
  $('#cDraftId').value = '';
  $('#cBroadcast').checked = false;
  $('#cDept').checked = false;
  $('#toBox').classList.remove('hidden');
  $('#composeTitle').textContent = 'رسالة جديدة';
  const statusEl = $('#cStatus');
  statusEl.textContent = '';
  statusEl.style.color = '';

  document.querySelectorAll('input[name="priority"]').forEach(r => r.checked = r.value === 'normal');

  const broadcastBox = $('#broadcastBox');
  if (isOwner()) {
    $('#broadcastCount').textContent = others.length;
    broadcastBox.style.display = 'flex';
  } else {
    broadcastBox.style.display = 'none';
  }

  $('#composeModal').style.display = 'flex';
  icons();
  setTimeout(() => $('#cTo').focus(), 100);
};

window.closeCompose = () => {
  $('#composeModal').style.display = 'none';
  $('#composeTitle').textContent = 'رسالة جديدة';
};

window.toggleCCBCC = () => {
  const fields = $('#ccbccFields');
  const icon = $('#ccbccIcon');
  if (!fields) return;
  if (fields.classList.contains('hidden')) {
    fields.classList.remove('hidden');
    if (icon) icon.setAttribute('data-lucide', 'chevron-up');
  } else {
    fields.classList.add('hidden');
    if (icon) icon.setAttribute('data-lucide', 'chevron-down');
  }
  icons();
};

window.toggleBroadcast = () => {
  const checked = $('#cBroadcast').checked;
  if (checked) {
    hide($('#toBox'));
    hide($('#deptBox'));
    $('#cDept').checked = false;
  } else {
    show($('#toBox'));
    if (isAdmin() || isDeptManager()) show($('#deptBox'));
  }
};

window.toggleDeptSend = () => {
  const checked = $('#cDept').checked;
  if (checked) {
    hide($('#toBox'));
    hide($('#broadcastBox'));
    $('#cBroadcast').checked = false;
  } else {
    show($('#toBox'));
  }
};

/* ═══════════════════════════════════════════════════════
   SEND with UNDO (5 seconds)
   ═══════════════════════════════════════════════════════ */
window.sendMessage = async () => {
  const broadcast = isOwner() && $('#cBroadcast').checked;
  const deptSend = $('#cDept').checked;
  const toUserId = $('#cTo').value;
  const ccUserId = $('#cCC')?.value || '';
  const bccUserId = $('#cBCC')?.value || '';
  const deptId = $('#deptSelect').value;
  const subject = $('#cSubject').value.trim();
  const body = $('#cBody').value.trim();
  const replyToThread = $('#cThreadId')?.value || null;
  const priority = document.querySelector('input[name="priority"]:checked')?.value || 'normal';
  const status = $('#cStatus');
  const sendBtn = $('#sendBtn');

  status.style.color = '';
  status.textContent = '';

  if (!broadcast && !deptSend && !toUserId) {
    status.style.color = 'var(--danger)'; status.textContent = 'اختر المستلم'; return;
  }
  if (deptSend && !deptId) {
    status.style.color = 'var(--danger)'; status.textContent = 'اختر القسم'; return;
  }
  if (!subject) {
    status.style.color = 'var(--danger)'; status.textContent = 'اكتب الموضوع'; return;
  }

  // Prepare email data
  const emailData = {
    subject, body, priority,
    toUserId: toUserId || null,
    ccUserId: ccUserId || null,
    bccUserId: bccUserId || null,
    replyToThread, broadcast, deptSend, deptId,
    isBroadcast: broadcast,
    fromUserId: state.currentUser.uid,
    fromUserName: state.currentUser.name,
    fromUserUsername: state.currentUser.username
  };

  // Close compose immediately
  closeCompose();

  // Show UNDO toast (5 seconds)
  const undoToast = document.createElement('div');
  undoToast.className = 'toast toast-warning';
  undoToast.id = 'undoSendToast';
  undoToast.innerHTML = `
    <div class="toast-icon warning">
      <i data-lucide="clock" class="w-4 h-4"></i>
    </div>
    <div class="toast-content">
      <div class="toast-title">جاري الإرسال...</div>
      <div class="toast-body">اضغط "تراجع" لإلغاء الإرسال</div>
    </div>
    <button class="toast-action" onclick="undoSend()">تراجع</button>
  `;
  document.getElementById('toastContainer').appendChild(undoToast);
  icons();

  // Store for undo
  lastSentData = emailData;

  // Actually send after 5 seconds
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
    const t = document.getElementById('undoSendToast');
    if (t) t.remove();
    showToastAdvanced('تم الإلغاء ⏹️', 'الرسالة ملغية', { type: 'info', icon: 'x-circle', duration: 2500 });
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
          notified: false,
          starred: false, deleted: false,
          createdAt: serverTimestamp()
        });
      }
      showToastAdvanced('تم الإرسال ✅', `الرسالة وصلت لـ ${recipients.length} مستخدم`, { type: 'success', icon: 'check-circle', duration: 3500 });
    }
    else if (data.deptSend) {
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
          notified: false,
          starred: false, deleted: false,
          createdAt: serverTimestamp()
        });
      }
      showToastAdvanced('تم الإرسال ✅', `الرسالة وصلت لـ ${recipients.length} موظف`, { type: 'success', icon: 'check-circle', duration: 3500 });
    }
    else {
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
        notified: false,
        starred: false, deleted: false,
        createdAt: serverTimestamp()
      });

      showToastAdvanced('تم الإرسال ✅', `الرسالة وصلت لـ ${toUser?.name || ''}`, { type: 'success', icon: 'check-circle', duration: 3000 });
    }

    if (document.getElementById('inboxList')) renderInbox();
  } catch (e) {
    console.error('SEND ERROR:', e);
    showToastAdvanced('خطأ في الإرسال', e.message, {
      type: 'error',
      icon: 'alert-circle',
      actionLabel: 'إعادة المحاولة',
      onAction: () => performSend(data),
      duration: 8000
    });
  }
}

window.saveDraft = async () => {
  const toUserId = $('#cTo').value;
  const subject = $('#cSubject').value.trim();
  const body = $('#cBody').value.trim();
  const status = $('#cStatus');

  if (!subject && !body) {
    status.style.color = 'var(--danger)';
    status.textContent = 'اكتب حاجة الأول';
    return;
  }

  try {
    const draftId = $('#cDraftId').value;
    const draftData = { toUserId: toUserId || null, subject, body, updatedAt: serverTimestamp() };
    if (draftId) {
      await updateDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId), draftData);
    } else {
      draftData.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'users', state.currentUser.uid, 'drafts'), draftData);
      $('#cDraftId').value = ref.id;
    }
    status.style.color = 'var(--success)';
    status.textContent = '✅ تم حفظ المسودة';
    showToastAdvanced('تم الحفظ ✅', 'المسودة محفوظة', { type: 'success', icon: 'file-text', duration: 2000 });
    setTimeout(() => { closeCompose(); }, 1000);
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = 'خطأ: ' + e.message;
  }
};

window.replyToThread = async (userId, userName, threadId, subject) => {
  await window.openCompose();
  $('#cTo').value = userId;
  $('#cSubject').value = subject.startsWith('رد:') ? subject : 'رد: ' + subject;
  $('#cThreadId').value = threadId;
  $('#cBroadcast').checked = false;
  $('#cDept').checked = false;
  $('#toBox').classList.remove('hidden');
  $('#composeTitle').textContent = `رد على ${userName}`;
  setTimeout(() => $('#cBody').focus(), 150);
};

/* ═══════════════════════════════════════════════════════
   PROFILE
   ═══════════════════════════════════════════════════════ */
window.openProfile = () => {
  const u = state.currentUser;
  if (!u) return;
  $('#profileName').value = u.name || '';
  $('#profileUsername').value = u.username || '';
  $('#profileEmail').value = u.email || '';
  $('#profileRole').value = roleLabels[u.role] || u.role;
  const avatarEl = $('#profileAvatar');
  if (avatarEl) {
    avatarEl.textContent = initials(u.name);
    applyAvatar(avatarEl, u.name);
  }
  hideStyle($('#userMenu'));
  show($('#profileModal'));
  icons();
};

window.closeProfile = () => hide($('#profileModal'));

window.saveProfile = async () => {
  const name = $('#profileName').value.trim();
  const status = $('#profileStatus');
  if (!name) {
    status.className = 'alert alert-error';
    status.textContent = 'اكتب الاسم';
    show(status);
    return;
  }
  try {
    await updateDoc(doc(db, 'users', state.currentUser.uid), { name });
    state.currentUser.name = name;
    status.className = 'alert alert-success';
    status.textContent = '✅ تم الحفظ';
    show(status);
    showToastAdvanced('تم الحفظ ✅', 'الاسم اتحدّث', { type: 'success', icon: 'check', duration: 2000 });
    setTimeout(() => { hide($('#profileModal')); location.reload(); }, 1000);
  } catch (e) {
    status.className = 'alert alert-error';
    status.textContent = e.message;
    show(status);
  }
};

/* ═══════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════ */
window.openSettings = () => {
  hideStyle($('#userMenu'));
  $('#darkModeToggle').checked = state.settings.darkMode;
  const installBtn = $('#installPwaBtn');
  if (installBtn) {
    if (deferredPrompt) installBtn.classList.remove('hidden');
    else installBtn.classList.add('hidden');
  }
  show($('#settingsModal'));
  icons();
};

window.closeSettings = () => hide($('#settingsModal'));

window.toggleDarkMode = () => {
  const isDark = toggleDarkMode();
  const themeIcon = $('#themeToggle i');
  if (themeIcon) themeIcon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
  icons();
};

window.enablePushNotifications = async () => {
  const btn = $('#enablePushBtn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      btn.textContent = 'مرفوض';
      btn.className = 'btn btn-sm btn-danger';
      return;
    }
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), {
        token, createdAt: serverTimestamp(), userAgent: navigator.userAgent
      });
      btn.textContent = '✅ مفعّل';
      btn.className = 'btn btn-sm btn-success';
    } else {
      btn.textContent = 'فشل';
      btn.className = 'btn btn-sm btn-danger';
    }
  } catch (e) {
    console.error(e);
    btn.textContent = 'خطأ';
    btn.className = 'btn btn-sm btn-danger';
  }
};

/* ═══════════════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════════════ */
async function registerFCMToken() {
  try {
    if (!messaging) return;
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;
    await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), {
      token, createdAt: serverTimestamp(), userAgent: navigator.userAgent
    });
    console.log('✅ FCM Token saved');
  } catch (e) {
    console.error('FCM error:', e);
  }
}

if (messaging) {
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    const data = payload.data || {};
    showToastAdvanced(title || 'رسالة جديدة', body || '', {
      type: 'info',
      icon: 'mail',
      duration: 6000,
      onClick: () => {
        navigate('inbox');
        if (data.threadId) setTimeout(() => window.openThread(data.threadId), 300);
      }
    });
  });
}

function setupServiceWorkerMessages() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PLAY_SOUND') playNotifSound();
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.__refreshing) return;
    window.__refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register(SW_PATH).then((reg) => {
    console.log('✅ PWA Service Worker registered');
  }).catch((err) => {
    console.warn('SW registration failed:', err);
  });
}

function startMessagesListener() {
  if (state.unsubMessages) state.unsubMessages();
  const q = query(collection(db, 'messages'), where('toUserId', '==', state.currentUser.uid));
  state.unsubMessages = onSnapshot(q, (snap) => {
    const all = [];
    snap.forEach(d => all.push({ id: d.id, ...d.data() }));
    all.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    state.unreadMessages = all.filter(m => !m.read && !m.deleted);
    updateNotificationUI();

    if (state.lastUnreadCount > 0 && state.unreadMessages.length > state.lastUnreadCount) {
      const newMsg = state.unreadMessages[0];
      if (newMsg && newMsg.fromUserId !== state.currentUser.uid) {
        showToastAdvanced(
          `رسالة جديدة من ${newMsg.fromUserName}`,
          newMsg.subject,
          {
            type: 'info',
            icon: 'mail',
            actionLabel: 'فتح',
            onAction: () => {
              navigate('inbox');
              setTimeout(() => window.openThread(newMsg.threadId || newMsg.id), 300);
            },
            duration: 6000
          }
        );
      }
    }
    state.lastUnreadCount = state.unreadMessages.length;

    if (document.getElementById('inboxList')) renderInbox();
  });
}

function updateNotificationUI() {
  const count = state.unreadMessages.length;
  const el = $('#inboxCount');
  const elM = $('#inboxCountM');
  const notifBadge = $('#notifBadge');

  if (count > 0) {
    if (el) { el.textContent = count; show(el); }
    if (elM) { elM.textContent = count; show(elM); }
    if (notifBadge) {
      notifBadge.textContent = count > 9 ? '9+' : count;
      notifBadge.classList.remove('hidden');
    }
  } else {
    if (el) hide(el);
    if (elM) hide(elM);
    if (notifBadge) notifBadge.classList.add('hidden');
  }
  renderNotifDropdown();
}

function renderNotifDropdown() {
  const list = $('#notifList');
  if (!list) return;

  if (state.unreadMessages.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:40px 20px;">
      <i data-lucide="bell-off" style="width:40px;height:40px;"></i>
      <p style="font-size:13px;">لا إشعارات جديدة</p>
    </div>`;
    icons();
    return;
  }

  list.innerHTML = state.unreadMessages.slice(0, 10).map(m => {
    const avatarClass = getAvatarGradient(m.fromUserName);
    return `
      <div onclick="openNotifMsg('${m.id}', '${m.threadId || m.id}')" style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer;display:flex;gap:12px;">
        <div class="msg-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;">${initials(m.fromUserName)}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
            <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.fromUserName)}</span>
            <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0;">${timeAgo(m.createdAt)}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${esc(m.subject)}</div>
          <div style="font-size:11.5px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${esc((m.body || '').slice(0, 60))}</div>
        </div>
      </div>
    `;
  }).join('');
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

console.log('🚀 Mail System v8.0 loaded (Professional Enterprise)');
