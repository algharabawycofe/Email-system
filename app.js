/* ═══════════════════════════════════════════════════════════
   Mail System v5.0 - Main Application
   Features: PWA Support + Dept Manager + Full Mail System
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
   PWA STATE
   ═══════════════════════════════════════════════════════ */
let deferredPrompt = null;

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
   PWA HANDLERS
   ═══════════════════════════════════════════════════════ */
function setupPWAHandlers() {
  // Capture install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('📱 PWA Install prompt captured');

    // Show install button
    const installBtn = document.getElementById('installPwaBtn');
    if (installBtn) installBtn.classList.remove('hidden');
  });

  // App installed
  window.addEventListener('appinstalled', () => {
    console.log('✅ PWA Installed');
    deferredPrompt = null;
    const installBtn = document.getElementById('installPwaBtn');
    if (installBtn) installBtn.classList.add('hidden');
    showToast('تم التثبيت 🎉', 'التطبيق مثبّت على جهازك', null, false);
  });

  // Detect if already installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    console.log('📱 Running as PWA');
    document.body.classList.add('pwa-mode');
  }

  // Handle URL parameters (shortcuts)
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'compose') {
    setTimeout(() => {
      if (state.currentUser) openCompose();
    }, 2000);
    // Clear URL
    window.history.replaceState({}, '', '/Email-system/');
  } else if (params.get('page') === 'inbox') {
    setTimeout(() => {
      if (state.currentUser) navigate('inbox');
    }, 1500);
    window.history.replaceState({}, '', '/Email-system/');
  }
}

window.installPWA = async () => {
  if (!deferredPrompt) {
    showToast('التثبيت غير متاح', 'استخدم قائمة المتصفح للإضافة للشاشة الرئيسية', null, false);
    return;
  }

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log('📱 Install outcome:', outcome);

  if (outcome === 'accepted') {
    console.log('✅ User accepted install');
  } else {
    console.log('❌ User dismissed install');
  }

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
    forgotBtn.onclick = () => {
      show($('#forgotModal'));
      icons();
    };
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
    btn.querySelector('span').textContent = 'دخول';
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
  if (st) {
    st.classList.add('hidden');
    st.textContent = '';
  }
};

window.sendPasswordReset = async () => {
  const email = ($('#forgotEmail')?.value || '').trim().toLowerCase();
  const status = $('#forgotStatus');
  if (!email) {
    status.className = 'text-sm mb-3 text-red-600';
    status.textContent = 'اكتب الإيميل';
    show(status);
    return;
  }
  status.className = 'text-sm mb-3 text-blue-600';
  status.textContent = 'جاري الإرسال...';
  show(status);

  const result = await resetUserPassword(email);
  if (result.success) {
    status.className = 'text-sm mb-3 text-green-600';
    status.textContent = '✅ تم إرسال رابط الاستعادة للإيميل';
  } else {
    status.className = 'text-sm mb-3 text-red-600';
    if (result.error === 'auth/user-not-found') {
      status.textContent = 'الإيميل غير مسجل';
    } else if (result.error === 'auth/invalid-email') {
      status.textContent = 'الإيميل غير صحيح';
    } else {
      status.textContent = result.message || 'خطأ في الإرسال';
    }
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
    navigate('dashboard');

    startMessagesListener();
    setTimeout(registerFCMToken, 1500);
  });
}

/* ═══════════════════════════════════════════════════════
   UPDATE UI BASED ON ROLE
   ═══════════════════════════════════════════════════════ */
function updateUIForRole() {
  const nameEl = $('#userName');
  const roleEl = $('#userRole');
  const avatarEl = $('#userAvatar');
  const menuName = $('#menuUserName');
  const menuEmail = $('#menuUserEmail');

  if (nameEl) nameEl.textContent = state.currentUser.name;
  if (roleEl) roleEl.textContent = roleLabels[state.currentUser.role] || state.currentUser.role;
  if (avatarEl) avatarEl.textContent = initials(state.currentUser.name);
  if (menuName) menuName.textContent = state.currentUser.name;
  if (menuEmail) menuEmail.textContent = state.currentUser.email || '';

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
      main.classList.add('pb-16');
    } else {
      sidebar.style.display = 'flex';
      mobileNav.style.display = 'none';
      main.classList.remove('pb-16');
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
      const btn = e.target.closest('.nav-btn');
      if (btn) navigate(btn.dataset.page);
    });
  }

  const mobileNav = $('#mobileNav');
  if (mobileNav) {
    mobileNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.mnav-btn');
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
          if (state.currentFilter === 'search') {
            navigate('inbox');
          }
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
  dashboard: renderDashboard,
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

  $$('.nav-btn').forEach(b => {
    const active = b.dataset.page === page;
    b.classList.toggle('active', active);
  });
  $$('.mnav-btn').forEach(b => {
    const active = b.dataset.page === page;
    b.classList.toggle('active', active);
  });

  const route = ROUTES[page];
  if (route) route();
  icons();
}

window.navigate = navigate;

/* ═══════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════ */
async function renderDashboard() {
  const admin = isAdmin();
  const manager = isDeptManager();
  const today = todayArabic();
  const content = $('#pageContent');

  if (admin) {
    const [usersSnap, deptSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'departments'))
    ]);
    const total = usersSnap.size;
    const active = usersSnap.docs.filter(d => d.data().isActive !== false).length;

    content.innerHTML = `
      <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
        <div class="mb-6 md:mb-8">
          <h1 class="text-2xl md:text-3xl font-bold text-slate-800">أهلاً ${esc(state.currentUser.name)} 👋</h1>
          <p class="text-slate-500 mt-1 text-sm">${today}</p>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          ${statCard('users', 'إجمالي المستخدمين', total, 'bg-blue-50', 'text-blue-600', "navigate('users')")}
          ${statCard('user-check', 'نشط', active, 'bg-green-50', 'text-green-600', "navigate('users')")}
          ${statCard('building-2', 'الأقسام', deptSnap.size, 'bg-purple-50', 'text-purple-600', "navigate('departments')")}
          ${statCard('mail', 'غير مقروء', state.unreadMessages.length, 'bg-orange-50', 'text-orange-600', "navigate('inbox')")}
        </div>
        <div class="bg-white rounded border border-slate-200 p-5 md:p-6">
          <h2 class="font-bold text-base mb-4 text-slate-800">إجراءات سريعة</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${quickAction('pencil', 'رسالة جديدة', 'openCompose()')}
            ${quickAction('users', 'إدارة المستخدمين', "navigate('users')")}
            ${quickAction('building-2', 'الأقسام', "navigate('departments')")}
            ${quickAction('inbox', 'الوارد', "navigate('inbox')")}
          </div>
        </div>
      </div>
    `;
  } else if (manager) {
    const myDepts = getMyManagedDepts();
    const team = getMyTeamMembers();
    const unreadCount = state.unreadMessages.length;

    const deptCards = myDepts.map(d => {
      const members = getUsersByDept(d.id);
      return `
        <div class="bg-white rounded border border-slate-200 p-5 hover:shadow-md transition">
          <div class="flex items-start justify-between mb-3">
            <div class="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <i data-lucide="building-2" class="w-5 h-5"></i>
            </div>
            <span class="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold">${members.length} عضو</span>
          </div>
          <div class="font-bold text-slate-800">${esc(d.name)}</div>
          <div class="text-xs text-slate-500 mt-1">${esc(d.description || 'بدون وصف')}</div>
        </div>
      `;
    }).join('');

    content.innerHTML = `
      <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
        <div class="mb-6 md:mb-8">
          <h1 class="text-2xl md:text-3xl font-bold text-slate-800">أهلاً ${esc(state.currentUser.name)} 👋</h1>
          <p class="text-slate-500 mt-1 text-sm">${today} · <span class="text-purple-600 font-semibold">مدير ${myDepts.length} قسم</span></p>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          ${statCard('users-round', 'أعضاء فريقي', team.length, 'bg-purple-50', 'text-purple-600', "navigate('myteam')")}
          ${statCard('building-2', 'أقسامي', myDepts.length, 'bg-blue-50', 'text-blue-600', "navigate('myteam')")}
          ${statCard('mail', 'غير مقروء', unreadCount, 'bg-orange-50', 'text-orange-600', "navigate('inbox')")}
          ${statCard('send', 'مُرسلة', 0, 'bg-green-50', 'text-green-600', "navigate('sent')")}
        </div>
        <div class="mb-6">
          <h2 class="font-bold text-lg mb-3 text-slate-800">أقسامي</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${deptCards || '<div class="col-span-full text-center py-8 text-slate-400">لم يتم تعيينك مديرًا لأي قسم</div>'}
          </div>
        </div>
        <div class="bg-white rounded border border-slate-200 p-5 md:p-6">
          <h2 class="font-bold text-base mb-4 text-slate-800">إجراءات سريعة</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${quickAction('pencil', 'رسالة جديدة', 'openCompose()')}
            ${quickAction('users-round', 'فريقي', "navigate('myteam')")}
            ${quickAction('megaphone', 'إرسال للفريق', "quickSendToTeam()")}
            ${quickAction('inbox', 'الوارد', "navigate('inbox')")}
          </div>
        </div>
      </div>
    `;
  } else {
    const snap = await getDocs(query(collection(db, 'messages'), where('toUserId', '==', state.currentUser.uid)));
    const myDept = state.currentUser.departmentId ? getDeptById(state.currentUser.departmentId) : null;

    content.innerHTML = `
      <div class="p-4 md:p-8 max-w-5xl mx-auto fade-in">
        <div class="mb-6 md:mb-8">
          <h1 class="text-2xl md:text-3xl font-bold text-slate-800">أهلاً ${esc(state.currentUser.name)} 👋</h1>
          <p class="text-slate-500 mt-1 text-sm">${today}${myDept ? ` · <span class="text-blue-600 font-semibold">${esc(myDept.name)}</span>` : ''}</p>
        </div>
        <div class="grid grid-cols-2 gap-3 md:gap-4 mb-6 md:mb-8">
          ${statCard('inbox', 'رسائل الوارد', snap.size, 'bg-blue-50', 'text-blue-600', "navigate('inbox')")}
          ${statCard('mail', 'غير مقروءة', state.unreadMessages.length, 'bg-orange-50', 'text-orange-600', "navigate('inbox')")}
        </div>
        <div class="bg-white rounded border border-slate-200 p-5 md:p-6">
          <h2 class="font-bold text-base mb-4 text-slate-800">إجراءات سريعة</h2>
          <div class="grid grid-cols-2 gap-3">
            ${quickAction('pencil', 'رسالة جديدة', 'openCompose()')}
            ${quickAction('inbox', 'صندوق الوارد', "navigate('inbox')")}
          </div>
        </div>
      </div>
    `;
  }
  icons();
}

function statCard(icon, label, value, bg, fg, onClick) {
  const cursor = onClick ? 'cursor-pointer hover:border-[#0078D4] hover:shadow-md' : 'hover:shadow-md';
  const click = onClick ? `onclick="${onClick}"` : '';
  return `<div ${click} class="bg-white rounded border border-slate-200 p-4 md:p-5 transition ${cursor}">
    <div class="w-10 h-10 md:w-11 md:h-11 rounded ${bg} ${fg} flex items-center justify-center mb-3">
      <i data-lucide="${icon}" class="w-5 h-5"></i>
    </div>
    <div class="text-xs md:text-sm text-slate-500">${label}</div>
    <div class="text-2xl md:text-3xl font-bold text-slate-800 mt-1">${value}</div>
  </div>`;
}

function quickAction(icon, label, action) {
  return `<button onclick="${action}" class="flex flex-col items-center gap-2 p-3 bg-slate-50 hover:bg-[#e5f0fa] rounded border border-slate-200 hover:border-[#0078D4] transition group">
    <i data-lucide="${icon}" class="w-5 h-5 text-slate-500 group-hover:text-[#0078D4]"></i>
    <span class="text-xs font-medium text-slate-700 group-hover:text-[#0078D4] text-center">${label}</span>
  </button>`;
}

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
    if (u.departmentId && byDept[u.departmentId]) {
      byDept[u.departmentId].push(u);
    }
  });

  const deptSections = myDepts.map(d => {
    const members = byDept[d.id] || [];
    const memberRows = members.map(m => `
      <div class="flex items-center gap-3 p-3 border-b border-slate-100 hover:bg-slate-50 transition">
        <div class="w-9 h-9 rounded-full bg-[#0070c0] text-white flex items-center justify-center font-bold text-xs">${initials(m.name)}</div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm text-slate-800 truncate">${esc(m.name)}</div>
          <div class="text-xs text-slate-400 font-mono truncate">@${esc(m.username)}</div>
        </div>
        <button onclick="quickSendToUser('${m.id}')" class="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="إرسال رسالة">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </div>
    `).join('');

    return `
      <div class="bg-white rounded border border-slate-200 overflow-hidden mb-4">
        <div class="px-4 py-3 bg-purple-50 border-b border-purple-200 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i data-lucide="building-2" class="w-4 h-4 text-purple-600"></i>
            <h3 class="font-bold text-purple-900">${esc(d.name)}</h3>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-purple-700">${members.length} عضو</span>
            ${members.length > 0 ? `
              <button onclick="quickSendToDept('${d.id}')" class="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded font-semibold flex items-center gap-1">
                <i data-lucide="megaphone" class="w-3 h-3"></i>
                إرسال للقسم
              </button>
            ` : ''}
          </div>
        </div>
        <div>
          ${memberRows || '<div class="text-center py-6 text-slate-400 text-sm">لا يوجد أعضاء في هذا القسم</div>'}
        </div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="p-4 md:p-8 max-w-5xl mx-auto fade-in">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-slate-800">فريقي</h1>
        <p class="text-slate-500 text-sm mt-1">${team.length} عضو · ${myDepts.length} قسم</p>
      </div>

      ${myDepts.length === 0 ? `
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
          <i data-lucide="alert-circle" class="w-12 h-12 text-amber-500 mx-auto mb-3"></i>
          <div class="font-bold text-amber-900 mb-1">لم يتم تعيينك مديرًا لأي قسم</div>
          <div class="text-sm text-amber-700">تواصل مع الأدمن لتعيينك مدير قسم</div>
        </div>
      ` : deptSections}

      ${team.length > 0 ? `
        <div class="mt-6 bg-white rounded border border-slate-200 p-5">
          <h3 class="font-bold text-slate-800 mb-3">إجراءات جماعية</h3>
          <div class="flex flex-wrap gap-2">
            <button onclick="quickSendToTeam()" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded text-sm font-semibold flex items-center gap-2">
              <i data-lucide="megaphone" class="w-4 h-4"></i>
              إرسال لكل فريقي (${team.length})
            </button>
          </div>
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
  await loadUsersCache();
  await loadDepartmentsCache();

  const rows = state.allUsersCache.map(u => {
    const uColor = roleColors[u.role] || roleColors.user;
    const uLabel = roleLabels[u.role] || u.role;
    const dept = u.departmentId ? getDeptById(u.departmentId) : null;
    return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition">
      <td class="px-4 py-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-[#0070c0] text-white flex items-center justify-center font-bold text-xs">${initials(u.name)}</div>
          <div class="min-w-0">
            <div class="font-medium text-slate-800 text-sm truncate">${esc(u.name)}</div>
            <div class="text-xs text-slate-400 font-mono truncate">${esc(u.email || '')}</div>
          </div>
        </div>
      </td>
      <td class="px-4 py-3 font-mono text-sm text-slate-600 hidden md:table-cell">${esc(u.username)}</td>
      <td class="px-4 py-3 hidden lg:table-cell">
        ${dept ? `<span class="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">${esc(dept.name)}</span>` : '<span class="text-xs text-slate-400">—</span>'}
      </td>
      <td class="px-4 py-3"><span class="px-2.5 py-1 rounded text-xs font-semibold ${uColor} whitespace-nowrap">${uLabel}</span></td>
      <td class="px-4 py-3 hidden sm:table-cell">
        ${u.isActive === false
          ? `<span class="flex items-center gap-1 text-xs text-red-600"><span class="w-2 h-2 rounded-full bg-red-500"></span>معطّل</span>`
          : `<span class="flex items-center gap-1 text-xs text-green-600"><span class="w-2 h-2 rounded-full bg-green-500"></span>نشط</span>`}
      </td>
      <td class="px-4 py-3 text-left">
        <div class="flex items-center justify-end gap-1">
          <button onclick="editUser('${u.id}')" class="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="تعديل"><i data-lucide="pencil" class="w-4 h-4"></i></button>
          <button onclick="toggleUser('${u.id}', ${u.isActive === false})" class="p-1.5 rounded hover:bg-amber-50 text-amber-600 transition" title="${u.isActive === false ? 'تفعيل' : 'تعطيل'}">
            <i data-lucide="${u.isActive === false ? 'user-check' : 'user-x'}" class="w-4 h-4"></i>
          </button>
          <button onclick="deleteUserDoc('${u.id}')" class="p-1.5 rounded hover:bg-red-50 text-red-600 transition" title="حذف"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-slate-800">المستخدمين</h1>
          <p class="text-slate-500 text-sm mt-1">${state.allUsersCache.length} مستخدم</p>
        </div>
        <button onclick="openAddUser()" class="bg-[#0078D4] hover:bg-[#106EBE] text-white px-3 md:px-4 py-2 rounded text-sm font-semibold flex items-center gap-2 transition shadow-sm">
          <i data-lucide="user-plus" class="w-4 h-4"></i>
          <span class="hidden md:inline">إضافة مستخدم</span>
        </button>
      </div>

      <div id="addUserForm" class="hidden bg-white rounded border border-slate-200 p-5 md:p-6 mb-6 fade-in">
        <h3 class="font-bold mb-4 text-slate-800">مستخدم جديد</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input id="nuName" placeholder="الاسم الكامل" class="input-field" />
          <input id="nuUser" placeholder="اسم المستخدم (إنجليزي)" class="input-field" />
          <input id="nuPass" type="text" placeholder="كلمة السر (6+ حروف)" class="input-field" />
          <select id="nuRole" class="input-field">
            <option value="user">مستخدم عادي</option>
            <option value="manager">مدير قسم</option>
            ${isOwner() ? '<option value="admin">أدمن</option>' : ''}
          </select>
          <select id="nuDept" class="input-field">
            <option value="">— بدون قسم —</option>
          </select>
        </div>
        <p class="text-xs text-slate-500 mt-2">الإيميل: <span class="font-mono">username@${EMAIL_DOMAIN}</span></p>
        <p id="nuErr" class="text-sm mt-3 hidden"></p>
        <div class="mt-4 flex gap-2">
          <button onclick="createNewUser()" class="bg-[#0078D4] hover:bg-[#106EBE] text-white px-4 py-2 rounded text-sm font-semibold">حفظ</button>
          <button onclick="closeAddUser()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded text-sm font-medium">إلغاء</button>
        </div>
      </div>

      <div id="editUserForm" class="hidden bg-white rounded border border-slate-200 p-5 md:p-6 mb-6 fade-in">
        <h3 class="font-bold mb-4 text-slate-800">تعديل مستخدم</h3>
        <input type="hidden" id="euId" />
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input id="euName" placeholder="الاسم" class="input-field" />
          <input id="euUser" class="input-field bg-slate-50 text-slate-500" disabled />
          <select id="euRole" class="input-field">
            <option value="user">مستخدم عادي</option>
            <option value="manager">مدير قسم</option>
            ${isOwner() ? '<option value="admin">أدمن</option>' : ''}
          </select>
          <select id="euDept" class="input-field">
            <option value="">— بدون قسم —</option>
          </select>
        </div>
        <p id="euErr" class="text-sm mt-3 hidden"></p>
        <div class="mt-4 flex gap-2">
          <button onclick="saveEditUser()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-semibold">حفظ</button>
          <button onclick="closeEditUser()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded text-sm font-medium">إلغاء</button>
        </div>
      </div>

      <div class="bg-white rounded border border-slate-200 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-right">
            <thead class="bg-slate-50 border-b border-slate-200">
              <tr class="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                <th class="px-4 py-3 text-right">المستخدم</th>
                <th class="px-4 py-3 text-right hidden md:table-cell">اسم المستخدم</th>
                <th class="px-4 py-3 text-right hidden lg:table-cell">القسم</th>
                <th class="px-4 py-3 text-right">الدور</th>
                <th class="px-4 py-3 text-right hidden sm:table-cell">الحالة</th>
                <th class="px-4 py-3 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6" class="text-center py-12 text-slate-400">لا يوجد مستخدمين</td></tr>'}</tbody>
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

window.openAddUser = () => {
  show($('#addUserForm'));
  hide($('#editUserForm'));
  fillDeptSelects();
};
window.closeAddUser = () => hide($('#addUserForm'));

window.createNewUser = async () => {
  const name = $('#nuName').value.trim();
  const user = sanitizeUsername($('#nuUser').value);
  const pass = $('#nuPass').value;
  const role = $('#nuRole').value;
  const deptId = $('#nuDept').value;
  const err = $('#nuErr');
  hide(err);

  if (!name || !user || !pass) {
    err.className = 'text-sm mt-3 text-red-600'; err.textContent = 'املأ كل البيانات'; show(err); return;
  }
  if (!validateUsername(user)) {
    err.className = 'text-sm mt-3 text-red-600'; err.textContent = 'اسم المستخدم بحروف إنجليزية وأرقام فقط (3-30 حرف)'; show(err); return;
  }
  if (!validatePassword(pass)) {
    err.className = 'text-sm mt-3 text-red-600'; err.textContent = 'كلمة السر 6 حروف على الأقل'; show(err); return;
  }

  err.className = 'text-sm mt-3 text-blue-600'; err.textContent = 'جاري الإنشاء...'; show(err);

  try {
    const email = `${user}@${EMAIL_DOMAIN}`;
    const uid = await createAuthUser(email, pass);
    await setDoc(doc(db, 'users', uid), {
      name, username: user, email, role,
      departmentId: deptId || null,
      isActive: true, createdAt: serverTimestamp()
    });
    err.className = 'text-sm mt-3 text-green-600'; err.textContent = `✅ تم إنشاء ${user} بنجاح!`;
    $('#nuName').value = ''; $('#nuUser').value = ''; $('#nuPass').value = '';
    setTimeout(() => { hide($('#addUserForm')); renderUsers(); }, 1200);
  } catch (e) {
    err.className = 'text-sm mt-3 text-red-600';
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
  if (!name) {
    err.className = 'text-sm mt-3 text-red-600'; err.textContent = 'اكتب الاسم'; show(err); return;
  }
  try {
    await updateDoc(doc(db, 'users', uid), {
      name, role, departmentId: deptId || null
    });
    hide($('#editUserForm'));
    renderUsers();
  } catch (e) {
    err.className = 'text-sm mt-3 text-red-600'; err.textContent = e.message; show(err);
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
      <div class="bg-white rounded border border-slate-200 p-4 hover:shadow-md transition group">
        <div class="flex items-start justify-between mb-3">
          <div class="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <i data-lucide="building-2" class="w-5 h-5"></i>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="editDept('${d.id}')" class="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="تعديل">
              <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button onclick="deleteDept('${d.id}')" class="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-50 text-red-600 transition" title="حذف">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <div class="font-bold text-slate-800">${esc(d.name)}</div>
        <div class="text-xs text-slate-500 mt-1 mb-3">${esc(d.description || 'بدون وصف')}</div>
        
        <div class="flex items-center justify-between pt-3 border-t border-slate-100">
          <div class="flex items-center gap-1.5">
            <i data-lucide="users" class="w-3.5 h-3.5 text-slate-400"></i>
            <span class="text-xs text-slate-500">${members.length} عضو</span>
          </div>
          ${manager ? `
            <div class="flex items-center gap-1.5">
              <div class="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold text-[9px]">${initials(manager.name)}</div>
              <span class="text-xs text-purple-700 font-medium truncate max-w-[80px]">${esc(manager.name)}</span>
            </div>
          ` : `
            <button onclick="editDept('${d.id}')" class="text-xs text-amber-600 hover:underline font-medium flex items-center gap-1">
              <i data-lucide="alert-circle" class="w-3 h-3"></i>
              بدون مدير
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-slate-800">الأقسام</h1>
        <p class="text-slate-500 text-sm mt-1">${state.allDeptsCache.length} قسم</p>
      </div>

      <div class="bg-white rounded border border-slate-200 p-4 mb-6">
        <h3 class="font-bold text-sm mb-3">إضافة قسم جديد</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input id="dName" placeholder="اسم القسم" class="input-field" />
          <input id="dDesc" placeholder="وصف (اختياري)" class="input-field" />
          <select id="dManager" class="input-field">
            <option value="">— بدون مدير —</option>
          </select>
          <button onclick="addDept()" class="bg-[#0078D4] hover:bg-[#106EBE] text-white rounded px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
            <i data-lucide="plus" class="w-4 h-4"></i>
            <span>إضافة</span>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${cards || '<div class="col-span-full text-center py-12 text-slate-400">لا يوجد أقسام بعد</div>'}
      </div>
    </div>
  `;

  const managerOpts = state.allUsersCache
    .filter(u => u.isActive !== false)
    .map(u => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)})</option>`)
    .join('');
  const dManager = document.getElementById('dManager');
  if (dManager) {
    dManager.innerHTML = '<option value="">— بدون مدير —</option>' + managerOpts;
  }

  icons();
}

window.addDept = async () => {
  const name = $('#dName').value.trim();
  const description = $('#dDesc').value.trim();
  const managerId = $('#dManager').value;
  if (!name) return alert('اكتب اسم القسم');
  await addDoc(collection(db, 'departments'), {
    name, description,
    managerId: managerId || null,
    createdAt: serverTimestamp()
  });
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
  modal.className = 'fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4 modal-overlay';
  modal.id = 'deptEditModal';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md fade-in">
      <div class="flex items-center justify-between mb-5">
        <h3 class="text-lg font-bold text-slate-800">تعديل القسم</h3>
        <button onclick="document.getElementById('deptEditModal').remove()" class="p-1 rounded hover:bg-slate-100">
          <i data-lucide="x" class="w-5 h-5 text-slate-500"></i>
        </button>
      </div>
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold mb-1 text-slate-600">اسم القسم</label>
          <input id="editDeptName" class="input-field" value="${esc(d.name)}" />
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 text-slate-600">الوصف</label>
          <input id="editDeptDesc" class="input-field" value="${esc(d.description || '')}" />
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 text-slate-600">مدير القسم</label>
          <select id="editDeptManager" class="input-field">
            <option value="">— بدون مدير —</option>
            ${managerOpts}
          </select>
        </div>
      </div>
      <div class="flex gap-2 mt-5">
        <button onclick="saveEditDept('${id}')" class="flex-1 bg-[#0078D4] hover:bg-[#106EBE] text-white font-semibold rounded-lg py-2.5 transition">
          حفظ
        </button>
        <button onclick="document.getElementById('deptEditModal').remove()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 rounded-lg transition">
          إلغاء
        </button>
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
  await updateDoc(doc(db, 'departments', id), {
    name, description,
    managerId: managerId || null
  });
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

    return `
      <div onclick="openThread('${t.threadId}')" class="msg-item ${t.threadId === state.selectedThreadId ? 'active' : ''} px-4 py-3">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-full bg-[#0078D4] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">${otherInitial}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm text-slate-800 truncate ${t.unread ? 'font-bold' : 'font-medium'}">${esc(otherName || '')}</span>
              <span class="text-xs text-slate-400 flex-shrink-0">${timeAgo(last.createdAt)}</span>
            </div>
            <div class="text-sm text-slate-700 truncate ${t.unread ? 'font-semibold' : ''}">
              ${t.starred ? '<span class="text-amber-500">⭐ </span>' : ''}
              ${last.priority === 'urgent' ? '<span class="text-red-500">🔴 </span>' : ''}
              ${esc(t.subject)}
            </div>
            <div class="text-xs text-slate-400 truncate mt-0.5">
              ${t.isFromMe ? '<span class="text-[#0078D4] font-medium">أنت: </span>' : ''}${esc((last.body || '').slice(0, 55))}
            </div>
            <div class="flex items-center gap-2 mt-1">
              ${t.messages.length > 1 ? `<span class="text-xs text-slate-400">💬 ${t.messages.length}</span>` : ''}
              ${t.unread ? `<span class="text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5">${t.unread}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  $('#pageContent').innerHTML = `
    <div id="inboxContainer" class="h-full flex fade-in">
      <div id="inboxList" class="inbox-list w-full md:w-96 border-l border-slate-200 bg-white flex-col">
        <div class="px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0 flex items-center justify-between">
          <div>
            <h2 class="font-bold text-slate-800 text-sm">${title}</h2>
            <p class="text-xs text-slate-500 mt-0.5">${state.threadsCache.length} محادثة${state.searchQuery ? ` · "${esc(state.searchQuery)}"` : ''}</p>
          </div>
          <button onclick="renderInbox()" class="p-1.5 rounded hover:bg-slate-100 text-slate-500 transition" title="تحديث">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          ${listHtml || '<div class="text-center py-12 text-slate-400 text-sm">لا رسائل</div>'}
        </div>
      </div>
      <div id="inboxReading" class="inbox-reading flex-1 bg-white overflow-y-auto flex-col">
        <div id="readingContent" class="flex-1"></div>
      </div>
    </div>
  `;
  renderThreadReading();
  icons();
}

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
      <div class="flex flex-col items-center justify-center h-full text-slate-400 p-8 min-h-[400px]">
        <i data-lucide="mail-open" class="w-16 h-16 mb-4 opacity-30"></i>
        <p class="text-sm">اختر رسالة لعرضها</p>
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

    return `
      <div class="email-card bg-white border border-slate-200 rounded mb-2 overflow-hidden">
        <div onclick="toggleMsgBody(${idx}, ${isLatest})" class="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition select-none">
          <div class="w-10 h-10 rounded-full bg-[#0078D4] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">${initials(m.fromUserName)}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span class="font-semibold text-sm text-slate-800">${isMe ? 'أنت' : esc(m.fromUserName)}</span>
              ${!isMe && senderEmail ? `<span class="text-xs text-slate-400 font-mono hidden sm:inline">&lt;${esc(senderEmail)}&gt;</span>` : ''}
              ${m.priority === 'urgent' ? '<span class="priority-urgent">🔴 عاجل</span>' : ''}
              ${isLatest && t.messages.length > 1 ? '<span class="text-[10px] bg-[#e5f0fa] text-[#0078D4] px-1.5 py-0.5 rounded font-semibold">الأحدث</span>' : ''}
            </div>
            <div class="text-xs text-slate-500 mt-0.5">إلى: ${isMe ? esc(m.toUserName) : esc(state.currentUser.name)}</div>
            ${!open ? `<div class="text-xs text-slate-400 mt-1 truncate">${esc((m.body || '').slice(0, 80))}</div>` : ''}
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-xs text-slate-400 whitespace-nowrap hidden sm:inline">${dateStr}</span>
            <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4 text-slate-400"></i>
          </div>
        </div>
        ${open ? `
          <div class="border-t border-slate-100 px-4 py-4 bg-slate-50/40">
            <div class="text-slate-700 whitespace-pre-line leading-relaxed text-sm">${esc(m.body || '')}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const threadStarred = t.messages.some(m => m.starred);

  content.innerHTML = `
    <div class="flex flex-col h-full bg-white">
      <div class="px-3 md:px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-1 flex-shrink-0">
        <button onclick="backToList()" class="md:hidden p-2 rounded hover:bg-slate-100 text-slate-600">
          <i data-lucide="arrow-right" class="w-4 h-4"></i>
        </button>

        ${!isTrash ? `
          <button onclick="replyToThread('${replyUserId}', '${esc(replyUserName).replace(/'/g, "\\'")}', '${t.threadId}', '${esc(t.subject).replace(/'/g, "\\'")}')" class="px-3 py-1.5 rounded hover:bg-[#e5f0fa] text-[#0078D4] font-semibold text-sm flex items-center gap-1.5 transition" title="رد">
            <i data-lucide="reply" class="w-4 h-4"></i>
            <span class="hidden md:inline">رد</span>
          </button>
          <button onclick="toggleStar('${t.threadId}')" class="px-3 py-1.5 rounded hover:bg-amber-50 ${threadStarred ? 'text-amber-500' : 'text-slate-500'} font-semibold text-sm flex items-center gap-1.5 transition" title="${threadStarred ? 'إزالة التمييز' : 'تمييز'}">
            <i data-lucide="star" class="w-4 h-4" ${threadStarred ? 'fill="currentColor"' : ''}></i>
            <span class="hidden md:inline">${threadStarred ? 'مميزة' : 'تمييز'}</span>
          </button>
        ` : ''}

        <button onclick="trashThread('${t.threadId}', ${isTrash})" class="px-3 py-1.5 rounded hover:${isTrash ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'} font-semibold text-sm flex items-center gap-1.5 transition">
          <i data-lucide="${isTrash ? 'rotate-ccw' : 'trash-2'}" class="w-4 h-4"></i>
          <span class="hidden md:inline">${isTrash ? 'استعادة' : 'حذف'}</span>
        </button>

        ${isTrash ? `
          <button onclick="permanentDelete('${t.threadId}')" class="px-3 py-1.5 rounded hover:bg-red-50 text-red-600 font-semibold text-sm flex items-center gap-1.5 transition">
            <i data-lucide="x-circle" class="w-4 h-4"></i>
            <span class="hidden md:inline">حذف نهائي</span>
          </button>
        ` : ''}

        <div class="flex-1"></div>
        <button onclick="toggleAllMsgs()" class="px-2 py-1.5 rounded hover:bg-slate-100 text-slate-600 text-xs transition" title="فتح/طي الكل">
          <i data-lucide="chevrons-down-up" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div class="p-4 md:p-6 max-w-4xl mx-auto">
          <div class="mb-5 pb-3">
            <h1 class="text-xl md:text-2xl font-bold text-slate-800 mb-2 break-words">${esc(t.subject)}</h1>
            <div class="flex items-center gap-3 text-xs text-slate-500">
              <span class="flex items-center gap-1"><i data-lucide="message-square" class="w-3 h-3"></i>${t.messages.length} رسالة</span>
              <span class="flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i>آخر تحديث ${timeAgo(t.lastMsg.createdAt)}</span>
            </div>
          </div>
          ${messagesHtml}
        </div>
      </div>
    </div>
  `;
  icons();
}

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
  if (state.currentFilter === 'trash' && !newVal) {
    renderInbox();
  } else if (state.currentFilter !== 'trash' && newVal) {
    renderInbox();
  } else {
    renderThreadReading();
  }
};

window.permanentDelete = async (threadId) => {
  const ok = await confirmDialog('حذف نهائي', 'هيتم حذف الرسائل نهائيًا. متأكد؟');
  if (!ok) return;
  const t = state.threadsCache.find(x => x.threadId === threadId);
  if (!t) return;
  for (const m of t.messages) {
    await deleteDoc(doc(db, 'messages', m.id));
  }
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
    <div class="px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition cursor-pointer" onclick="openThread('${m.threadId || m.id}')">
      <div class="flex items-start gap-3">
        <div class="w-9 h-9 rounded-full ${m.isBroadcast ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'} flex items-center justify-center flex-shrink-0">
          <i data-lucide="${m.isBroadcast ? 'megaphone' : 'send'}" class="w-4 h-4"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-sm text-slate-800 truncate">
              ${m.isBroadcast ? `📢 إعلان عام (${m.count} مستلم)` : `إلى: ${esc(m.toUserName || '')}`}
            </span>
            <span class="text-xs text-slate-400 flex-shrink-0">${timeAgo(m.createdAt)}</span>
          </div>
          <div class="text-sm text-slate-700 truncate">${esc(m.subject)}</div>
          <div class="text-xs text-slate-400 truncate mt-0.5">${esc((m.body || '').slice(0, 80))}</div>
        </div>
      </div>
    </div>
  `).join('');

  $('#pageContent').innerHTML = `
    <div class="p-4 md:p-8 max-w-4xl mx-auto fade-in">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-slate-800">الرسائل المُرسلة</h1>
        <p class="text-slate-500 text-sm mt-1">${list.length} رسالة</p>
      </div>
      <div class="bg-white rounded border border-slate-200 overflow-hidden">
        ${rows || '<div class="text-center py-12 text-slate-400">لا رسائل مُرسلة</div>'}
      </div>
    </div>
  `;
  icons();
}

/* ═══════════════════════════════════════════════════════
   COMPOSE
   ═══════════════════════════════════════════════════════ */
window.openCompose = async () => {
  await loadUsersCache();
  await loadDepartmentsCache();

  let others = [];
  if (isAdmin()) {
    others = state.allUsersCache.filter(u => u.id !== state.currentUser.uid && u.isActive !== false);
  } else if (isDeptManager()) {
    others = getMyTeamMembers();
  } else {
    others = state.allUsersCache.filter(u => u.id !== state.currentUser.uid && u.isActive !== false);
  }

  $('#cTo').innerHTML = `<option value="">— اختر المستلم —</option>` + others.map(u =>
    `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`
  ).join('');

  const deptSel = $('#deptSelect');
  const deptBox = $('#deptBox');

  if (isAdmin()) {
    if (deptSel) {
      deptSel.innerHTML = '<option value="">— اختر قسم —</option>' + state.allDeptsCache.map(d =>
        `<option value="${d.id}">${esc(d.name)} (${getUsersByDept(d.id).length} مستخدم)</option>`
      ).join('');
    }
    if (deptBox) deptBox.style.display = 'block';
    const label = $('#deptSendLabel');
    if (label) label.textContent = 'إرسال لكل موظفي قسم';
  } else if (isDeptManager()) {
    const myDepts = getMyManagedDepts();
    if (deptSel) {
      deptSel.innerHTML = '<option value="">— اختر قسم —</option>' + myDepts.map(d =>
        `<option value="${d.id}">${esc(d.name)} (${getUsersByDept(d.id).length} عضو)</option>`
      ).join('');
    }
    if (deptBox) deptBox.style.display = 'block';
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
  statusEl.className = 'text-xs text-slate-500';

  document.querySelectorAll('input[name="priority"]').forEach(r => r.checked = r.value === 'normal');

  const broadcastBox = $('#broadcastBox');
  if (isOwner()) {
    $('#broadcastCount').textContent = others.length;
    broadcastBox.style.display = 'block';
  } else {
    broadcastBox.style.display = 'none';
  }

  $('#composeModal').style.display = 'flex';
  icons();
  setTimeout(() => $('#cTo').focus(), 100);
};

window.closeCompose = () => {
  $('#composeModal').style.display = 'none';
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

window.sendMessage = async () => {
  const broadcast = isOwner() && $('#cBroadcast').checked;
  const deptSend = $('#cDept').checked;
  const toUserId = $('#cTo').value;
  const deptId = $('#deptSelect').value;
  const subject = $('#cSubject').value.trim();
  const body = $('#cBody').value.trim();
  const replyToThread = $('#cThreadId')?.value || null;
  const priority = document.querySelector('input[name="priority"]:checked')?.value || 'normal';
  const status = $('#cStatus');
  const sendBtn = $('#sendBtn');

  status.className = 'text-xs text-slate-500';
  status.textContent = '';

  if (!broadcast && !deptSend && !toUserId) {
    status.className = 'text-xs text-red-600'; status.textContent = 'اختر المستلم'; return;
  }
  if (deptSend && !deptId) {
    status.className = 'text-xs text-red-600'; status.textContent = 'اختر القسم'; return;
  }
  if (!subject) {
    status.className = 'text-xs text-red-600'; status.textContent = 'اكتب الموضوع'; return;
  }

  if (deptSend && !isAdmin() && !isManagerOfDept(deptId)) {
    status.className = 'text-xs text-red-600'; status.textContent = 'مش مسموحلك تبعت لهذا القسم'; return;
  }

  sendBtn.disabled = true;
  sendBtn.querySelector('span').textContent = 'جاري الإرسال...';

  try {
    if (broadcast) {
      const recipients = state.allUsersCache.filter(u => u.id !== state.currentUser.uid && u.isActive !== false);
      let sent = 0;
      for (const u of recipients) {
        const msgRef = doc(collection(db, 'messages'));
        await setDoc(msgRef, {
          subject, body, priority,
          fromUserId: state.currentUser.uid,
          fromUserName: state.currentUser.name,
          fromUserUsername: state.currentUser.username,
          toUserId: u.id, toUserName: u.name,
          read: false, isBroadcast: true,
          threadId: msgRef.id,
          notified: false,
          starred: false, deleted: false,
          createdAt: serverTimestamp()
        });
        sent++;
        status.className = 'text-xs text-blue-600';
        status.textContent = `جاري الإرسال... ${sent}/${recipients.length}`;
      }
      status.className = 'text-xs text-green-600';
      status.textContent = `✅ تم إرسال الرسالة إلى ${recipients.length} مستخدم!`;
    }
    else if (deptSend) {
      const recipients = getUsersByDept(deptId).filter(u => u.id !== state.currentUser.uid);
      let sent = 0;
      for (const u of recipients) {
        const msgRef = doc(collection(db, 'messages'));
        await setDoc(msgRef, {
          subject, body, priority,
          fromUserId: state.currentUser.uid,
          fromUserName: state.currentUser.name,
          fromUserUsername: state.currentUser.username,
          toUserId: u.id, toUserName: u.name,
          read: false, isBroadcast: false,
          threadId: msgRef.id,
          notified: false,
          starred: false, deleted: false,
          createdAt: serverTimestamp()
        });
        sent++;
        status.className = 'text-xs text-blue-600';
        status.textContent = `جاري الإرسال... ${sent}/${recipients.length}`;
      }
      status.className = 'text-xs text-green-600';
      status.textContent = `✅ تم إرسال الرسالة إلى ${recipients.length} موظف!`;
    }
    else {
      const toUser = state.allUsersCache.find(u => u.id === toUserId);
      const msgRef = doc(collection(db, 'messages'));
      await setDoc(msgRef, {
        subject, body, priority,
        fromUserId: state.currentUser.uid,
        fromUserName: state.currentUser.name,
        fromUserUsername: state.currentUser.username,
        toUserId, toUserName: toUser?.name || '',
        read: false,
        threadId: replyToThread || msgRef.id,
        parentId: replyToThread ? (state._currentThreadLastMsgId || null) : null,
        notified: false,
        starred: false, deleted: false,
        createdAt: serverTimestamp()
      });
      status.className = 'text-xs text-green-600';
      status.textContent = '✅ تم الإرسال!';
    }
    setTimeout(() => { closeCompose(); }, 1000);
  } catch (e) {
    console.error('SEND ERROR:', e);
    status.className = 'text-xs text-red-600';
    status.textContent = e.message;
  } finally {
    sendBtn.disabled = false;
    sendBtn.querySelector('span').textContent = 'إرسال';
  }
};

window.saveDraft = async () => {
  const toUserId = $('#cTo').value;
  const subject = $('#cSubject').value.trim();
  const body = $('#cBody').value.trim();
  const status = $('#cStatus');

  if (!subject && !body) {
    status.className = 'text-xs text-red-600';
    status.textContent = 'اكتب حاجة الأول';
    return;
  }

  try {
    const draftId = $('#cDraftId').value;
    const draftData = {
      toUserId: toUserId || null,
      subject, body,
      updatedAt: serverTimestamp()
    };
    if (draftId) {
      await updateDoc(doc(db, 'users', state.currentUser.uid, 'drafts', draftId), draftData);
    } else {
      draftData.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'users', state.currentUser.uid, 'drafts'), draftData);
      $('#cDraftId').value = ref.id;
    }
    status.className = 'text-xs text-green-600';
    status.textContent = '✅ تم حفظ المسودة';
    setTimeout(() => { closeCompose(); }, 1200);
  } catch (e) {
    status.className = 'text-xs text-red-600';
    status.textContent = 'خطأ في الحفظ: ' + e.message;
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
  $('#profileAvatar').textContent = initials(u.name);
  hideStyle($('#userMenu'));
  show($('#profileModal'));
  icons();
};

window.closeProfile = () => hide($('#profileModal'));

window.saveProfile = async () => {
  const name = $('#profileName').value.trim();
  const status = $('#profileStatus');
  if (!name) {
    status.className = 'text-xs mt-3 text-red-600';
    status.textContent = 'اكتب الاسم';
    show(status);
    return;
  }
  try {
    await updateDoc(doc(db, 'users', state.currentUser.uid), { name });
    state.currentUser.name = name;
    $('#userName').textContent = name;
    $('#userAvatar').textContent = initials(name);
    $('#profileAvatar').textContent = initials(name);
    status.className = 'text-xs mt-3 text-green-600';
    status.textContent = '✅ تم الحفظ';
    show(status);
    setTimeout(() => { hide($('#profileModal')); location.reload(); }, 1200);
  } catch (e) {
    status.className = 'text-xs mt-3 text-red-600';
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

  // Check PWA install availability
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
      btn.className = 'text-xs bg-red-500 text-white px-3 py-1.5 rounded font-semibold';
      return;
    }
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });
    if (token) {
      await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), {
        token,
        createdAt: serverTimestamp(),
        userAgent: navigator.userAgent
      });
      btn.textContent = '✅ مفعّل';
      btn.className = 'text-xs bg-green-500 text-white px-3 py-1.5 rounded font-semibold';
    } else {
      btn.textContent = 'فشل';
      btn.className = 'text-xs bg-red-500 text-white px-3 py-1.5 rounded font-semibold';
    }
  } catch (e) {
    console.error(e);
    btn.textContent = 'خطأ';
    btn.className = 'text-xs bg-red-500 text-white px-3 py-1.5 rounded font-semibold';
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
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });
    if (!token) return;

    await setDoc(doc(db, 'users', state.currentUser.uid, 'fcmTokens', token), {
      token,
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent
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
    showToast(title || 'رسالة جديدة', body || '', () => {
      navigate('inbox');
      if (data.threadId) setTimeout(() => window.openThread(data.threadId), 300);
    }, false);
  });
}

function setupServiceWorkerMessages() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PLAY_SOUND') {
      playNotifSound();
    }
  });

  // ✅ PWA: Detect new SW + reload
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.__refreshing) return;
    window.__refreshing = true;
    window.location.reload();
  });

  // ✅ PWA: Register SW
  navigator.serviceWorker.register(SW_PATH).then((reg) => {
    console.log('✅ PWA Service Worker registered');

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('🔄 New version available — will update on next visit');
        }
      });
    });
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
        showToast(`رسالة جديدة من ${newMsg.fromUserName}`, newMsg.subject, () => {
          navigate('inbox');
          setTimeout(() => window.openThread(newMsg.threadId || newMsg.id), 300);
        }, false);
      }
    }
    state.lastUnreadCount = state.unreadMessages.length;

    if (document.getElementById('inboxContainer')) renderInbox();
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
    list.innerHTML = `<div class="text-center py-12 text-slate-400 text-sm">
      <i data-lucide="bell-off" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
      <p>لا إشعارات جديدة</p>
    </div>`;
    icons();
    return;
  }

  list.innerHTML = state.unreadMessages.slice(0, 10).map(m => `
    <div onclick="openNotifMsg('${m.id}', '${m.threadId || m.id}')" class="px-4 py-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition flex items-start gap-3">
      <div class="w-9 h-9 rounded-full bg-[#0078D4] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">${initials(m.fromUserName)}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-xs text-slate-800 truncate">${esc(m.fromUserName)}</span>
          <span class="text-xs text-slate-400 flex-shrink-0">${timeAgo(m.createdAt)}</span>
        </div>
        <div class="text-xs text-slate-700 truncate">${esc(m.subject)}</div>
        <div class="text-xs text-slate-400 truncate mt-0.5">${esc((m.body || '').slice(0, 60))}</div>
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

console.log('🚀 Mail System v5.0 loaded (PWA)');
