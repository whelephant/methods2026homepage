// ── CONFIG ────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://gdxrfbjavtuivaarzvjl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkeHJmYmphdnR1aXZhYXJ6dmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNTAxNDUsImV4cCI6MjA5MDgyNjE0NX0.UwTbld0t0L6_tYRiiI0OsOQIkvUdnfRfxI-EXviXfTI';
const STORAGE_BUCKET    = 'resources';
// VCE Methods exam date — update when VCAA confirms the 2026 timetable.
const EXAM_DATE  = '2026-10-29';
const EXAM_LABEL = 'Methods Exam 1';
// ─────────────────────────────────────────────────────────────────────

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let homeworkItems = [];
let progressMap = {};
let schedData = [];
let hwData = [];
let currentScheduleRows = [];
let studyAreas = [];
let studyPoints = [];
let studyStatusMap = {};
let trialExams = [];
let teProgressMap = {};      // key = `${exam_id}:${paper}` -> boolean
let teMistakeCounts = {};    // key = `${exam_id}:${paper}` -> number (for badge)
let teData = [];             // admin draft buffer
let usersData = [];          // admin users list
let mbEditing = null;        // {examId, paper, examLabel, rows: [...]}

// ── SCREEN HELPER ─────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── STARTUP ───────────────────────────────────────────────────────────
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await enterApp();
  }
})();

// ── ADMIN ─────────────────────────────────────────────────────────────
document.getElementById('admin-email').addEventListener('keydown', e => { if (e.key === 'Enter') checkAdmin(); });
document.getElementById('admin-pw').addEventListener('keydown', e => { if (e.key === 'Enter') checkAdmin(); });

async function checkAdmin() {
  const email = document.getElementById('admin-email').value.trim();
  const pw    = document.getElementById('admin-pw').value;
  const errEl = document.getElementById('admin-login-err');
  const btn   = document.getElementById('admin-login-btn');
  errEl.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { errEl.textContent = error.message; return; }
    const { data: isAdmin, error: rpcErr } = await sb.rpc('is_admin');
    if (rpcErr) { errEl.textContent = rpcErr.message; await sb.auth.signOut(); return; }
    if (!isAdmin) { errEl.textContent = 'This account is not an admin.'; await sb.auth.signOut(); return; }
    currentUser = data.user;
    document.getElementById('admin-pw').value = '';
    showScreen('screen-admin');
    await loadAdminData();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enter Admin Panel';
  }
}

async function exitAdmin() {
  await sb.auth.signOut();
  currentUser = null;
  showScreen('screen-login');
}

// ── REGISTER ──────────────────────────────────────────────────────────
async function doRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw    = document.getElementById('reg-pw').value;
  const msgEl = document.getElementById('reg-msg');
  const btn   = document.getElementById('reg-btn');
  if (!name)         { showMsg(msgEl, 'Please enter your name.', 'error'); return; }
  if (!email)        { showMsg(msgEl, 'Please enter your email.', 'error'); return; }
  if (pw.length < 6) { showMsg(msgEl, 'Password must be at least 6 characters.', 'error'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account…';
  const { error } = await sb.auth.signUp({ email, password: pw, options: { data: { display_name: name } } });
  btn.disabled = false; btn.textContent = 'Create Account';
  if (error) { showMsg(msgEl, error.message, 'error'); return; }
  showMsg(msgEl, 'Account created! Check your email to confirm, then sign in.', 'success');
}

// ── LOGIN ─────────────────────────────────────────────────────────────
document.getElementById('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-err');
  const btn   = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { showMsg(errEl, error.message, 'error'); return; }
  errEl.textContent = '';
  currentUser = data.user;
  await enterApp();
}

// ── LOGOUT ────────────────────────────────────────────────────────────
async function doLogout() {
  await sb.auth.signOut();
  currentUser = null;
  showScreen('screen-login');
}

// ── APP ENTRY ─────────────────────────────────────────────────────────
async function enterApp() {
  const name = currentUser.user_metadata?.display_name || currentUser.email;
  document.getElementById('user-label').textContent = name;
  showScreen('screen-app');
  updateExamCountdown();
  await Promise.all([loadSchedule(), loadHomework(), loadStudyDesign(), loadTrialExams()]);
}

function updateExamCountdown() {
  const el = document.getElementById('exam-countdown');
  if (!el || !EXAM_DATE) return;
  const exam  = new Date(EXAM_DATE + 'T00:00:00');
  if (isNaN(exam)) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((exam - today) / 86400000);
  let num;
  if (days > 0)       num = `${days} day${days === 1 ? '' : 's'}`;
  else if (days === 0) num = 'today';
  else                 num = `${-days} day${days === -1 ? '' : 's'} ago`;
  el.classList.toggle('past', days < 0);
  el.innerHTML = `<span class="ec-label">${escapeHtml(EXAM_LABEL)}</span><span class="ec-num">${num}</span>`;
  el.hidden = false;
}

// ── TABS ──────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ── FILE UTILS ────────────────────────────────────────────────────────
function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return '📄';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['ppt','pptx'].includes(ext)) return '📊';
  if (['xls','xlsx'].includes(ext)) return '📈';
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) return '🖼️';
  return '📎';
}

function storagePath(rowId, fileName) {
  return `week-${rowId}/${fileName}`;
}

function getPublicUrl(path) {
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ── FILE MODAL ────────────────────────────────────────────────────────
// iOS Safari and most mobile browsers refuse to scroll PDFs rendered inside
// an <iframe> — only the first page is shown. Detect that case and hand the
// file off to the OS-level viewer in a new tab instead.
function isMobileDevice() {
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  if (navigator.userAgent.includes('Mac') && 'ontouchend' in document) return true;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function openModal(url, name) {
  let parsed;
  try {
    parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  } catch { return; }
  const isPdf = /\.pdf$/i.test(parsed.pathname) || /\.pdf$/i.test(String(name || ''));
  if (isPdf && isMobileDevice()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  document.getElementById('modal-title').textContent = name;
  document.getElementById('modal-frame').src = url;
  document.getElementById('file-modal').classList.add('open');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe interpolation of user data inside inline JS handlers (e.g. onclick="fn(${jsAttr(x)})").
// JSON.stringify gives a safe JS string literal; escapeHtml then makes it safe inside an HTML attribute.
function jsAttr(s) {
  return escapeHtml(JSON.stringify(String(s ?? '')));
}

function formatNotes(text) {
  if (!text) return '';
  let safe = escapeHtml(text);
  // images: ![alt](url) — must run before link regex
  safe = safe.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" referrerpolicy="no-referrer" loading="lazy" style="max-width:100%;height:auto;display:block;margin:0.5rem 0;border:1px solid #e5e7eb;">');
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  safe = safe.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');
  safe = safe.replace(/__([\s\S]+?)__/g, '<u>$1</u>');
  return safe.replace(/\n/g, '<br>');
}

function getYoutubeEmbed(url) {
  try {
    const parsed = new URL(url);
    let id = null;
    if (parsed.hostname === 'youtu.be' || parsed.hostname.endsWith('.youtu.be')) {
      id = parsed.pathname.slice(1).split('/')[0];
    } else if (parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com')) {
      id = new URLSearchParams(parsed.search).get('v');
      if (!id && parsed.pathname.startsWith('/embed/')) {
        id = parsed.pathname.slice('/embed/'.length).split('/')[0];
      }
    }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return `https://www.youtube.com/embed/${id}?rel=0`;
  } catch { return null; }
}

function openVideo(event, url, title) {
  event.stopPropagation();
  if (!url) return;
  const embedUrl = getYoutubeEmbed(url);
  if (!embedUrl) { alert('Only YouTube URLs are supported for inline playback.'); return; }
  openModal(embedUrl, title);
}

function closeModal(e) {
  if (e.target === document.getElementById('file-modal')) closeModalDirect();
}

function closeModalDirect() {
  document.getElementById('file-modal').classList.remove('open');
  document.getElementById('modal-frame').src = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalDirect(); });

// ── SCHEDULE: LOAD FILES FOR A ROW ────────────────────────────────────
const _fileCache = new Map();  // rowId -> files[] (per-session)

async function loadRowFiles(rowId, { force = false } = {}) {
  if (!force && _fileCache.has(rowId)) return _fileCache.get(rowId);
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).list(`week-${rowId}`);
  if (error || !data) return [];
  const files = data.filter(f => f.name && !f.name.startsWith('.'));
  _fileCache.set(rowId, files);
  return files;
}

function renderFileChips(files, rowId, row) {
  const notesHtml = row?.notes ? `<div class="week-note"><strong>Class Notes</strong><br>${formatNotes(row.notes)}</div>` : '';
  if (!files.length) {
    return '<span class="file-drawer-empty">No files uploaded for this week yet.</span>' + notesHtml;
  }
  return files.map(f => {
    const url = getPublicUrl(storagePath(rowId, f.name));
    const icon = fileIcon(f.name);
    return `<a class="file-chip" onclick="openModal(${jsAttr(url)}, ${jsAttr(f.name)})">
      <span class="file-chip-icon">${icon}</span>${escapeHtml(f.name)}
    </a>`;
  }).join('') + notesHtml;
}

// ── SCHEDULE (student view) ───────────────────────────────────────────
async function loadSchedule() {
  const { data, error } = await sb.from('schedule').select('*').eq('published', true).order('sort_order');
  if (error) { document.getElementById('schedule-content').innerHTML = '<div class="empty-state">Error loading schedule.</div>'; return; }
  currentScheduleRows = data || [];
  renderSchedule(currentScheduleRows);
}

const TERM_META = { 1:{label:'Term 1',cls:'t1'}, 2:{label:'Term 2',cls:'t2'}, 3:{label:'Term 3',cls:'t3'}, 4:{label:'Term 4',cls:'t4'} };

function renderSchedule(rows) {
  let html = '';
  [1,2,3,4].forEach(t => {
    const group = rows.filter(r => r.term === t);
    if (!group.length) return;
    const { label, cls } = TERM_META[t];
    const hasDates = group.some(r => r.week_commencing);
    const hasVcaa  = group.some(r => r.vcaa_exam);
    const hasYoutube = group.some(r => r.youtube_link);
    const colCount = (hasDates ? 1 : 0) + 3 + (hasVcaa ? 1 : 0) + (hasYoutube ? 1 : 0);

    html += `<div class="term-block collapsed" data-term="${t}"><div class="term-label ${cls}" onclick="toggleTerm(${t})">${label}</div>
    <table class="schedule-table"><thead><tr>`;
    if (hasDates) html += `<th>Week Commencing</th>`;
    html += `<th>Week</th><th>Content</th><th>Homework</th>`;
    if (hasVcaa)  html += `<th>VCAA Exam</th>`;
    if (hasYoutube) html += `<th>Recording</th>`;
    html += `</tr></thead><tbody>`;

    group.forEach(r => {
      const rid = r.id;
      html += `<tr class="week-row" onclick="toggleDrawer(${jsAttr(rid)}, ${colCount})">`;
      if (hasDates) html += `<td class="dt" data-label="Week Commencing">${escapeHtml(r.week_commencing||'')}</td>`;
      html += `<td class="wk" data-label="Week">Week ${escapeHtml(r.week_number||'')}</td><td data-label="Content">${escapeHtml(r.content||'')}</td><td data-label="Homework">${escapeHtml(r.homework||'')}</td>`;
      if (hasVcaa)  html += `<td data-label="VCAA Exam">${escapeHtml(r.vcaa_exam||'')}</td>`;
      if (hasYoutube) html += `<td data-label="Recording">${r.youtube_link ? `<button class="btn-files" onclick="openVideo(event, ${jsAttr(r.youtube_link)}, 'Lesson video')">▶ Watch</button>` : ''}</td>`;
      html += `</tr>`;
      // file drawer row (hidden until clicked)
      html += `<tr class="file-drawer-row" id="drawer-${escapeHtml(rid)}">
        <td colspan="${colCount}">
          <div class="file-drawer">
            <div class="file-drawer-inner" id="drawer-inner-${escapeHtml(rid)}">
              <span class="file-drawer-loading"><span class="spinner"></span> Loading files…</span>
            </div>
          </div>
        </td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
  });

  if (!html) html = '<div class="empty-state">No schedule yet — check back soon.</div>';
  document.getElementById('schedule-content').innerHTML = html;
}

function toggleTerm(t) {
  const block = document.querySelector(`.term-block[data-term="${t}"]`);
  if (block) block.classList.toggle('collapsed');
}

async function toggleDrawer(rowId, colCount) {
  const drawerRow = document.getElementById(`drawer-${rowId}`);
  const weekRow   = drawerRow.previousElementSibling;
  const isOpen    = drawerRow.classList.contains('open');

  // Accordion: close any other open drawer before opening this one
  document.querySelectorAll('.file-drawer-row.open').forEach(d => {
    if (d !== drawerRow) {
      d.classList.remove('open');
      d.previousElementSibling?.classList.remove('open');
    }
  });

  if (isOpen) {
    drawerRow.classList.remove('open');
    weekRow.classList.remove('open');
    return;
  }

  drawerRow.classList.add('open');
  weekRow.classList.add('open');

  const inner = document.getElementById(`drawer-inner-${rowId}`);
  const row = currentScheduleRows.find(r => String(r.id) === String(rowId));

  // Use cache if available (no spinner flash on re-open)
  if (_fileCache.has(rowId)) {
    inner.innerHTML = renderFileChips(_fileCache.get(rowId), rowId, row);
    return;
  }

  inner.innerHTML = '<span class="file-drawer-loading"><span class="spinner"></span> Loading files…</span>';
  const files = await loadRowFiles(rowId);
  inner.innerHTML = renderFileChips(files, rowId, row);
}

// ── HOMEWORK ──────────────────────────────────────────────────────────
async function loadHomework() {
  const [itemsRes, progressRes] = await Promise.all([
    sb.from('homework_items').select('*').order('sort_order'),
    sb.from('homework_progress').select('*').eq('user_id', currentUser.id)
  ]);
  homeworkItems = itemsRes.data || [];
  progressMap = {};
  (progressRes.data || []).forEach(p => { progressMap[p.homework_id] = p.completed; });
  renderHomework();
}

function renderHomework() {
  const list = document.getElementById('hw-list');
  if (!homeworkItems.length) { list.innerHTML = '<div class="empty-state">No homework items yet.</div>'; updateProgress(); return; }
  list.innerHTML = '';
  homeworkItems.forEach(item => {
    const done = !!progressMap[item.id];
    const div = document.createElement('div');
    div.className = 'hw-item' + (done ? ' done' : '');
    div.dataset.id = item.id;
    div.innerHTML = `<div class="hw-check">${done?'✓':''}</div><div><div class="hw-text">${escapeHtml(item.text||'')}</div><span class="hw-tag t${parseInt(item.term)||1}">${escapeHtml(item.week_label||'')}</span></div>`;
    div.addEventListener('click', () => toggleHW(item.id));
    list.appendChild(div);
  });
  updateProgress();
}

async function toggleHW(id) {
  const newVal = !progressMap[id];
  progressMap[id] = newVal;
  const el = document.querySelector(`.hw-item[data-id="${id}"]`);
  el.classList.toggle('done', newVal);
  el.querySelector('.hw-check').textContent = newVal ? '✓' : '';
  updateProgress();
  await sb.from('homework_progress').upsert(
    { user_id: currentUser.id, homework_id: id, completed: newVal, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,homework_id' }
  );
}

function updateProgress() {
  const total = homeworkItems.length;
  const done  = homeworkItems.filter(h => progressMap[h.id]).length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  document.getElementById('hw-fill').style.width = pct + '%';
  document.getElementById('hw-count').textContent = `${done} of ${total} complete`;
  document.getElementById('hw-pct').textContent = total ? pct + '%' : '';
}

async function resetHomework() {
  if (!confirm('Reset all your homework progress?')) return;
  homeworkItems.forEach(h => { progressMap[h.id] = false; });
  await sb.from('homework_progress').delete().eq('user_id', currentUser.id);
  renderHomework();
}

// ── STUDY DESIGN TRACKER ──────────────────────────────────────────────
const SD_AOS_META = { 1: 't1', 2: 't2', 3: 't3', 4: 't4' };

async function loadStudyDesign() {
  const [areasRes, pointsRes, progressRes] = await Promise.all([
    sb.from('study_areas').select('*').order('aos'),
    sb.from('study_points').select('*').order('aos').order('sort_order'),
    sb.from('study_progress').select('*').eq('user_id', currentUser.id)
  ]);
  if (areasRes.error || pointsRes.error) {
    document.getElementById('sd-content').innerHTML = '<div class="empty-state">Error loading study design.</div>';
    return;
  }
  studyAreas = areasRes.data || [];
  studyPoints = pointsRes.data || [];
  studyStatusMap = {};
  (progressRes.data || []).forEach(p => { studyStatusMap[p.point_id] = p.status; });
  renderStudyDesign();
}

function renderStudyDesign() {
  const container = document.getElementById('sd-content');
  if (!studyAreas.length || !studyPoints.length) {
    container.innerHTML = '<div class="empty-state">Study design not seeded yet. Run study_design_seed.sql against Supabase.</div>';
    updateStudyProgress();
    return;
  }
  let html = '';
  studyAreas.forEach(area => {
    const cls = SD_AOS_META[area.aos] || 't1';
    const points = studyPoints.filter(p => p.aos === area.aos);
    html += `<div class="term-block collapsed" data-sd-aos="${area.aos}">
      <div class="term-label ${cls}" onclick="toggleSdBlock(${area.aos})">AOS ${area.aos} · ${escapeHtml(area.title)}</div>
      <div class="sd-intro">${escapeHtml(area.intro)}</div>
      <div class="sd-list">`;
    points.forEach(p => {
      if (p.is_header) {
        html += `<div class="sd-group-head">${escapeHtml(p.text)}</div>`;
      } else {
        const cur = studyStatusMap[p.id] || '';
        html += `<div class="sd-item" data-sd-id="${escapeHtml(p.id)}">
          <div class="sd-text">${escapeHtml(p.text)}</div>
          <div class="tl-pill" role="radiogroup" aria-label="Confidence">
            <button class="tl red${cur==='red'?' active':''}"     onclick="cycleStatus(${jsAttr(p.id)},'red')"   aria-label="Needs work"     title="Needs work"></button>
            <button class="tl amber${cur==='amber'?' active':''}" onclick="cycleStatus(${jsAttr(p.id)},'amber')" aria-label="Getting there" title="Getting there"></button>
            <button class="tl green${cur==='green'?' active':''}" onclick="cycleStatus(${jsAttr(p.id)},'green')" aria-label="Confident"     title="Confident"></button>
          </div>
        </div>`;
      }
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;
  updateStudyProgress();
  ensureKatex().then(renderStudyDesignMath);
}

// Lazy-load KaTeX (CSS + JS + auto-render) on first Study Design render.
let _katexLoading = null;
function ensureKatex() {
  if (window.renderMathInElement) return Promise.resolve();
  if (_katexLoading) return _katexLoading;
  _katexLoading = new Promise(resolve => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
    js.onload = () => {
      const ar = document.createElement('script');
      ar.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';
      ar.onload = resolve;
      document.head.appendChild(ar);
    };
    document.head.appendChild(js);
  });
  return _katexLoading;
}

function renderStudyDesignMath() {
  const el = document.getElementById('sd-content');
  if (!el || !window.renderMathInElement) return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false }
      ],
      throwOnError: false,
      ignoredTags: ['script','noscript','style','textarea','pre','code']
    });
  } catch (e) { console.warn('KaTeX render failed', e); }
}

function toggleSdBlock(aos) {
  const block = document.querySelector(`.term-block[data-sd-aos="${aos}"]`);
  if (block) block.classList.toggle('collapsed');
}

async function cycleStatus(pointId, target) {
  const current = studyStatusMap[pointId];
  const newStatus = (current === target) ? null : target;
  // Optimistic UI update
  if (newStatus === null) delete studyStatusMap[pointId];
  else studyStatusMap[pointId] = newStatus;
  applyStatusToRow(pointId, newStatus);
  updateStudyProgress();
  // Persist
  if (newStatus === null) {
    await sb.from('study_progress').delete().eq('user_id', currentUser.id).eq('point_id', pointId);
  } else {
    await sb.from('study_progress').upsert(
      { user_id: currentUser.id, point_id: pointId, status: newStatus, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,point_id' }
    );
  }
}

function applyStatusToRow(pointId, status) {
  const row = document.querySelector(`.sd-item[data-sd-id="${CSS.escape(pointId)}"]`);
  if (!row) return;
  row.querySelectorAll('.tl').forEach(btn => btn.classList.remove('active'));
  if (!status) return;
  const active = row.querySelector(`.tl.${status}`);
  if (active) active.classList.add('active');
}

function updateStudyProgress() {
  const trackable = studyPoints.filter(p => !p.is_header);
  const total = trackable.length;
  let red = 0, amber = 0, green = 0;
  trackable.forEach(p => {
    const s = studyStatusMap[p.id];
    if (s === 'red')   red++;
    else if (s === 'amber') amber++;
    else if (s === 'green') green++;
  });
  const untouched = total - red - amber - green;
  document.getElementById('sd-fill-green').style.width = total ? `${(green/total)*100}%` : '0%';
  document.getElementById('sd-fill-amber').style.width = total ? `${(amber/total)*100}%` : '0%';
  document.getElementById('sd-fill-red').style.width   = total ? `${(red  /total)*100}%` : '0%';
  const pct = total ? Math.round((green/total)*100) : 0;
  document.getElementById('sd-pct').textContent = total ? `${pct}% green` : '';
  document.getElementById('sd-summary').innerHTML = total
    ? `<span class="sd-summary-pills">
        <span class="sd-summary-pill green">${green} green</span>
        <span class="sd-summary-pill amber">${amber} amber</span>
        <span class="sd-summary-pill red">${red} red</span>
        <span class="sd-summary-pill muted">${untouched} untouched</span>
      </span>`
    : 'Loading…';
}

async function resetStudyDesign() {
  if (!confirm('Reset all your study design progress?')) return;
  studyStatusMap = {};
  await sb.from('study_progress').delete().eq('user_id', currentUser.id);
  renderStudyDesign();
}

// ── ADMIN: LOAD ───────────────────────────────────────────────────────
// `only` may be 'schedule' | 'homework' | 'trialexams' | 'users' | undefined (load all).
async function loadAdminData(only) {
  const loadSched = !only || only === 'schedule';
  const loadHw    = !only || only === 'homework';
  const loadTe    = !only || only === 'trialexams';
  const loadUsers = !only || only === 'users';
  const ops = [];
  if (loadSched) ops.push(sb.from('schedule').select('*').order('sort_order'));
  if (loadHw)    ops.push(sb.from('homework_items').select('*').order('sort_order'));
  if (loadTe)    ops.push(sb.from('trial_exams').select('*').order('sort_order'));
  if (loadUsers) ops.push(sb.rpc('admin_list_users'));
  const results = await Promise.all(ops);
  let i = 0;
  if (loadSched) renderAdminSchedule(results[i++].data || []);
  if (loadHw)    renderAdminHomework(results[i++].data || []);
  if (loadTe)    renderAdminTrialExams(results[i++].data || []);
  if (loadUsers) { usersData = results[i++].data || []; renderAdminUsers(); }
}

async function loadAdminUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--dim)"><span class="spinner"></span> Loading…</td></tr>';
  const { data, error } = await sb.rpc('admin_list_users');
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--dim)">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  usersData = data || [];
  renderAdminUsers();
}

function renderAdminUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  const q = (document.getElementById('users-search')?.value || '').trim().toLowerCase();
  const rows = q
    ? usersData.filter(u => (u.email || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q))
    : usersData;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;font-style:italic;color:var(--dim)">No users found.</td></tr>';
    return;
  }
  const fmt = ts => ts ? new Date(ts).toLocaleDateString() : '—';
  const isBanned = u => u.banned_until && new Date(u.banned_until) > new Date();
  tbody.innerHTML = rows.map(u => {
    const banned = isBanned(u);
    const isSelf = currentUser && u.id === currentUser.id;
    const statusHtml = banned
      ? '<span style="color:var(--amber);font-weight:900">Disabled</span>'
      : (u.email_confirmed_at ? '<span style="color:var(--dim)">Active</span>' : '<span style="color:var(--dim);font-style:italic">Unconfirmed</span>');
    const actionHtml = isSelf
      ? '<span style="font-size:0.72rem;color:var(--dim);font-style:italic">(you)</span>'
      : `<button class="btn-files" onclick="toggleUserBanned(${jsAttr(u.id)}, ${banned})">${banned ? 'Enable' : 'Disable'}</button>`;
    return `<tr>
      <td>${escapeHtml(u.email || '')}</td>
      <td>${escapeHtml(u.display_name || '')}</td>
      <td>${fmt(u.created_at)}</td>
      <td>${fmt(u.last_sign_in_at)}</td>
      <td>${statusHtml}</td>
      <td>${actionHtml}</td>
    </tr>`;
  }).join('');
}

async function toggleUserBanned(userId, currentlyBanned) {
  const action = currentlyBanned ? 'enable' : 'disable';
  if (!confirm(`Are you sure you want to ${action} this user?`)) return;
  const { error } = await sb.rpc('admin_set_user_banned', { target_user: userId, banned: !currentlyBanned });
  if (error) { alert(`Failed to ${action} user: ${error.message}`); return; }
  await loadAdminUsers();
}

// ── ADMIN: SCHEDULE ───────────────────────────────────────────────────
function renderAdminSchedule(rows) {
  schedData = rows.map(r => ({...r}));
  redrawSchedTable();
}

// Track which term groups the admin has collapsed in the schedule editor.
// Persists across redraws within the session so collapse state survives edits.
const _adminSchedCollapsed = new Set();

function redrawSchedTableWithFiles() {
  const tbody = document.getElementById('sched-tbody');
  const visible = schedData.filter(r => !r._deleted);
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:1.5rem;font-style:italic;color:var(--dim)">No rows yet. Click + Add Row.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  [1, 2, 3, 4].forEach(t => {
    const groupCount = schedData.filter(r => !r._deleted && r.term === t).length;
    if (!groupCount) return;
    const collapsed = _adminSchedCollapsed.has(t);

    const draftCount = schedData.filter(r => !r._deleted && r.term === t && r.published === false).length;
    const draftHtml = draftCount ? `<span class="draft-count">${draftCount} draft${draftCount === 1 ? '' : 's'}</span>` : '';

    const headerTr = document.createElement('tr');
    headerTr.className = `admin-term-header t${t}${collapsed ? ' collapsed' : ''}`;
    headerTr.dataset.term = t;
    headerTr.innerHTML = `<td colspan="10" onclick="toggleAdminSchedTerm(${t})">Term ${t}<span class="admin-term-count">${groupCount} ${groupCount === 1 ? 'row' : 'rows'}${draftHtml}</span></td>`;
    tbody.appendChild(headerTr);

    schedData.forEach((r, i) => {
      if (r._deleted || r.term !== t) return;
      const tr = makeSchedRow(r, i);
      tr.classList.add('admin-term-row');
      tr.dataset.termRow = t;
      if (collapsed) tr.classList.add('collapsed');
      tbody.appendChild(tr);
      if (tr._fileRow) {
        tr._fileRow.dataset.termRow = t;
        if (collapsed) tr._fileRow.classList.add('collapsed');
        tbody.appendChild(tr._fileRow);
      }
    });
  });
}

function toggleAdminSchedTerm(t) {
  const willCollapse = !_adminSchedCollapsed.has(t);
  if (willCollapse) _adminSchedCollapsed.add(t); else _adminSchedCollapsed.delete(t);
  const tbody = document.getElementById('sched-tbody');
  tbody.querySelector(`.admin-term-header[data-term="${t}"]`)?.classList.toggle('collapsed', willCollapse);
  tbody.querySelectorAll(`tr[data-term-row="${t}"]`).forEach(r => r.classList.toggle('collapsed', willCollapse));
}

// redrawSchedTable is an alias for redrawSchedTableWithFiles
function redrawSchedTable() { redrawSchedTableWithFiles(); }

function makeSchedRow(r, i) {
  const tr = document.createElement('tr');
  if (r._new) tr.classList.add('new-row');
  if (r.published === false) tr.classList.add('draft-row');
  tr.ondragover = (e) => onRowDragOver(e, i, 'sched');
  tr.ondrop     = (e) => onRowDrop(e, i, 'sched');
  tr.ondragleave = (e) => onRowDragLeave(e);
  const visibleIndex = schedData.filter((row, idx) => !row._deleted && idx <= i).length - 1;
  const visibleTotal = schedData.filter(row => !row._deleted).length;
  const isLive = r.published !== false;
  const publishBtn = `<button class="btn-publish ${isLive ? 'live' : 'draft'}" onclick="togglePublished(${i})" title="${isLive ? 'Visible to students — click to hide' : 'Hidden from students — click to publish'}">${isLive ? '● LIVE' : '○ DRAFT'}</button>`;
  tr.innerHTML = `
    <td><select class="admin-select" onchange="onSchedTermChange(${i}, this.value)">
      <option value="1" ${r.term===1?'selected':''}>Term 1</option>
      <option value="2" ${r.term===2?'selected':''}>Term 2</option>
      <option value="3" ${r.term===3?'selected':''}>Term 3</option>
      <option value="4" ${r.term===4?'selected':''}>Term 4</option>
    </select></td>
    <td><input class="admin-input" type="number" value="${escapeHtml(r.week_number||'')}" oninput="schedData[${i}].week_number=parseInt(this.value)||0" style="width:48px"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.week_commencing||'')}" placeholder="d/m/yyyy" oninput="schedData[${i}].week_commencing=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.content||'')}" oninput="schedData[${i}].content=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.homework||'')}" oninput="schedData[${i}].homework=this.value"></td>
    <td>${notesButtonHtml(i, r.notes)}</td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.vcaa_exam||'')}" oninput="schedData[${i}].vcaa_exam=this.value"></td>
    <td><input class="admin-input" type="url" value="${escapeHtml(r.youtube_link||'')}" placeholder="https://youtube.com/..." oninput="schedData[${i}].youtube_link=this.value"></td>
    <td>${r.id && !r._new ? `<button class="btn-files" onclick="toggleAdminFiles(${jsAttr(r.id)}, ${i})">📎 Files</button>` : '<span style="font-size:0.75rem;color:var(--dim)">Save first</span>'}</td>
    <td style="display:flex;gap:0.3rem;align-items:center;">
      ${publishBtn}
      <span class="drag-handle" draggable="true" ondragstart="onRowDragStart(event, ${i}, 'sched')" ondragend="onRowDragEnd(event)" title="Drag to reorder">⋮⋮</span>
      ${visibleIndex > 0 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveSchedRow(${i},-1)" title="Move up">▲</button>` : '<span style="width:1.8rem"></span>'}
      ${visibleIndex < visibleTotal - 1 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveSchedRow(${i},1)" title="Move down">▼</button>` : '<span style="width:1.8rem"></span>'}
      <button class="btn-delete" onclick="deleteSchedRow(${i})">✕</button>
    </td>`;

  // Append the file panel row right after (only for saved rows)
  if (r.id && !r._new) {
    const fileRow = document.createElement('tr');
    fileRow.className = 'admin-file-row';
    fileRow.id = `admin-file-row-${r.id}`;
    fileRow.innerHTML = `<td colspan="10"><div class="admin-file-panel" id="admin-file-panel-${r.id}"></div></td>`;
    tr._fileRow = fileRow;
  }

  return tr;
}

async function toggleAdminFiles(rowId, idx) {
  const fileRow   = document.getElementById(`admin-file-row-${rowId}`);
  const filePanel = document.getElementById(`admin-file-panel-${rowId}`);
  if (!fileRow) return;

  const isOpen = fileRow.classList.contains('open');
  if (isOpen) { fileRow.classList.remove('open'); return; }

  fileRow.classList.add('open');
  filePanel.innerHTML = '<span class="upload-status"><span class="spinner"></span> Loading…</span>';

  const files = await loadRowFiles(rowId);
  renderAdminFilePanel(filePanel, rowId, files);
}

function renderAdminFilePanel(panel, rowId, files) {
  panel.innerHTML = `
    <div class="admin-file-list" id="admin-chips-${rowId}">${renderAdminChips(rowId, files)}</div>
    <div class="admin-upload-area drop-zone" id="dropzone-${rowId}"
         ondragover="dropZoneOver(event)" ondragleave="dropZoneLeave(event)" ondrop="dropZoneDrop(event, ${jsAttr(rowId)})">
      <input type="file" id="admin-upload-input-${rowId}" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg">
      <button class="btn-upload" id="admin-upload-btn-${rowId}" onclick="adminUploadFiles(${jsAttr(rowId)})">Upload</button>
      <span class="drop-hint">or drop files here</span>
      <span class="upload-status" id="admin-upload-status-${rowId}"></span>
    </div>`;
}

function renderAdminChips(rowId, files) {
  return files.length
    ? files.map(f => `
        <div class="admin-file-chip">
          ${fileIcon(f.name)} ${escapeHtml(f.name)}
          <button onclick="adminDeleteFile(${jsAttr(rowId)}, ${jsAttr(f.name)}, this)" title="Delete">✕</button>
        </div>`).join('')
    : '<span class="upload-status" style="font-style:italic">No files yet.</span>';
}

async function uploadFilesToRow(rowId, files) {
  const btn    = document.getElementById(`admin-upload-btn-${rowId}`);
  const status = document.getElementById(`admin-upload-status-${rowId}`);
  const input  = document.getElementById(`admin-upload-input-${rowId}`);
  if (!files.length) { if (status) status.textContent = 'No files selected.'; return; }

  if (btn) btn.disabled = true;
  if (status) status.textContent = `Uploading ${files.length} file(s)…`;

  const results = await Promise.all(files.map(file =>
    sb.storage.from(STORAGE_BUCKET).upload(storagePath(rowId, file.name), file, { upsert: true })
  ));

  const failed = results.filter(r => r.error);
  if (status) {
    if (failed.length) {
      status.textContent = `${failed.length} upload(s) failed. Check console.`;
      failed.forEach(r => console.error(r.error));
    } else {
      status.textContent = '✓ Uploaded!';
      if (input) input.value = '';
    }
  }

  if (btn) btn.disabled = false;
  _fileCache.delete(rowId);
  const updatedFiles = await loadRowFiles(rowId, { force: true });
  const chipsEl = document.getElementById(`admin-chips-${rowId}`);
  if (chipsEl) chipsEl.innerHTML = renderAdminChips(rowId, updatedFiles);

  setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

async function adminUploadFiles(rowId) {
  const input = document.getElementById(`admin-upload-input-${rowId}`);
  await uploadFilesToRow(rowId, Array.from(input?.files || []));
}

async function adminDeleteFile(rowId, fileName, btn) {
  if (!confirm(`Delete "${fileName}"?`)) return;
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([storagePath(rowId, fileName)]);
  if (error) { alert('Delete failed: ' + error.message); return; }
  _fileCache.delete(rowId);
  btn.closest('.admin-file-chip').remove();
}

// ── ADMIN: ADD / DELETE SCHEDULE ROW ─────────────────────────────────

// Safe ID generator that works in all contexts (no crypto.randomUUID dependency)
function generateSchedTempId() {
  return 'sched-new-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
}

function addScheduleRow() {
  schedData.push({
    id: null,
    term: 2,
    week_number: schedData.filter(r => !r._deleted).length,
    week_commencing: '', content: '', homework: '', notes: '', vcaa_exam: '',
    youtube_link: '', sort_order: schedData.length, _new: true,
    published: false  // start as draft so admins can plan without it going live
  });
  // Make sure the user can see the row they just added.
  _adminSchedCollapsed.delete(2);
  redrawSchedTable();
}

function togglePublished(i) {
  schedData[i].published = schedData[i].published === false ? true : false;
  redrawSchedTable();
}

function onSchedTermChange(i, value) {
  schedData[i].term = parseInt(value);
  // Expand the destination term so the moved row stays visible.
  _adminSchedCollapsed.delete(schedData[i].term);
  redrawSchedTable();
}

function deleteSchedRow(i) {
  schedData[i]._deleted = true;
  redrawSchedTable();
}

function moveSchedRow(i, direction) {
  const visibleIndices = schedData.map((r, idx) => !r._deleted ? idx : null).filter(idx => idx !== null);
  const currentPos = visibleIndices.indexOf(i);

  if (direction === -1 && currentPos > 0) {
    const swapIdx = visibleIndices[currentPos - 1];
    [schedData[i], schedData[swapIdx]] = [schedData[swapIdx], schedData[i]];
    redrawSchedTable();
  } else if (direction === 1 && currentPos < visibleIndices.length - 1) {
    const swapIdx = visibleIndices[currentPos + 1];
    [schedData[i], schedData[swapIdx]] = [schedData[swapIdx], schedData[i]];
    redrawSchedTable();
  }
}

async function saveSchedule() {
  const statusEl = document.getElementById('sched-saved');
  const toDelete = schedData.filter(r => r._deleted && r.id);
  const toUpsert = schedData.filter(r => !r._deleted).map((r, i) => {
    // Only assign a UUID at save time, not before
    const id = r.id || (
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : generateSchedTempId()
    );
    return {
      id,
      term: r.term, week_number: r.week_number,
      week_commencing: r.week_commencing || null,
      content: r.content || null, homework: r.homework || null,
      notes: r.notes || null, vcaa_exam: r.vcaa_exam || null,
      youtube_link: r.youtube_link || null, sort_order: i,
      published: r.published !== false
    };
  });
  const ops = [];
  if (toDelete.length) ops.push(sb.from('schedule').delete().in('id', toDelete.map(r => r.id)));
  if (toUpsert.length) ops.push(sb.from('schedule').upsert(toUpsert));
  try {
    const results = await Promise.all(ops);
    const failed = results.find(r => r?.error);
    if (failed) throw failed.error;
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2500);
    await loadAdminData('schedule');
  } catch (err) {
    console.error(err);
    alert('Save failed: ' + (err?.message || err));
  }
}

// ── ADMIN: HOMEWORK ───────────────────────────────────────────────────
function renderAdminHomework(rows) {
  hwData = rows.map(r => ({...r}));
  redrawHwTable();
}

// Track which term groups the admin has collapsed in the homework editor.
const _adminHwCollapsed = new Set();

function redrawHwTable() {
  const tbody = document.getElementById('hw-tbody');
  const visible = hwData.filter(r => !r._deleted);
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1.5rem;font-style:italic;color:var(--dim)">No items yet. Click + Add Item.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  [1, 2, 3, 4].forEach(t => {
    const groupCount = hwData.filter(r => !r._deleted && r.term === t).length;
    if (!groupCount) return;
    const collapsed = _adminHwCollapsed.has(t);

    const headerTr = document.createElement('tr');
    headerTr.className = `admin-term-header t${t}${collapsed ? ' collapsed' : ''}`;
    headerTr.dataset.term = t;
    headerTr.innerHTML = `<td colspan="4" onclick="toggleAdminHwTerm(${t})">Term ${t}<span class="admin-term-count">${groupCount} ${groupCount === 1 ? 'item' : 'items'}</span></td>`;
    tbody.appendChild(headerTr);

    hwData.forEach((r, i) => {
      if (r._deleted || r.term !== t) return;
      const tr = makeHwRow(r, i);
      tr.classList.add('admin-term-row');
      tr.dataset.termRow = t;
      if (collapsed) tr.classList.add('collapsed');
      tbody.appendChild(tr);
    });
  });
}

function toggleAdminHwTerm(t) {
  const willCollapse = !_adminHwCollapsed.has(t);
  if (willCollapse) _adminHwCollapsed.add(t); else _adminHwCollapsed.delete(t);
  const tbody = document.getElementById('hw-tbody');
  tbody.querySelector(`.admin-term-header[data-term="${t}"]`)?.classList.toggle('collapsed', willCollapse);
  tbody.querySelectorAll(`tr[data-term-row="${t}"]`).forEach(r => r.classList.toggle('collapsed', willCollapse));
}

function makeHwRow(r, i) {
  const tr = document.createElement('tr');
  if (r._new) tr.classList.add('new-row');
  tr.ondragover = (e) => onRowDragOver(e, i, 'hw');
  tr.ondrop     = (e) => onRowDrop(e, i, 'hw');
  tr.ondragleave = (e) => onRowDragLeave(e);
  const visibleIndex = hwData.filter((row, idx) => !row._deleted && idx <= i).length - 1;
  const visibleTotal = hwData.filter(row => !row._deleted).length;
  tr.innerHTML = `
    <td><select class="admin-select" onchange="onHwTermChange(${i}, this.value)">
      <option value="1" ${r.term===1?'selected':''}>Term 1</option>
      <option value="2" ${r.term===2?'selected':''}>Term 2</option>
      <option value="3" ${r.term===3?'selected':''}>Term 3</option>
      <option value="4" ${r.term===4?'selected':''}>Term 4</option>
    </select></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.week_label||'')}" placeholder="T2 · Week 3" oninput="hwData[${i}].week_label=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.text||'')}" oninput="hwData[${i}].text=this.value"></td>
    <td style="display:flex;gap:0.3rem;align-items:center;">
      <span class="drag-handle" draggable="true" ondragstart="onRowDragStart(event, ${i}, 'hw')" ondragend="onRowDragEnd(event)" title="Drag to reorder">⋮⋮</span>
      ${visibleIndex > 0 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveHwRow(${i},-1)" title="Move up">▲</button>` : '<span style="width:1.8rem"></span>'}
      ${visibleIndex < visibleTotal - 1 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveHwRow(${i},1)" title="Move down">▼</button>` : '<span style="width:1.8rem"></span>'}
      <button class="btn-delete" onclick="deleteHwRow(${i})">✕</button>
    </td>`;
  return tr;
}

function addHomeworkRow() {
  hwData.push({ id: null, term: 2, week_label: '', text: '', sort_order: hwData.length, _new: true });
  _adminHwCollapsed.delete(2);
  redrawHwTable();
}

function onHwTermChange(i, value) {
  hwData[i].term = parseInt(value);
  _adminHwCollapsed.delete(hwData[i].term);
  redrawHwTable();
}

function deleteHwRow(i) {
  hwData[i]._deleted = true;
  redrawHwTable();
}

function moveHwRow(i, direction) {
  const visibleIndices = hwData.map((r, idx) => !r._deleted ? idx : null).filter(idx => idx !== null);
  const currentPos = visibleIndices.indexOf(i);

  if (direction === -1 && currentPos > 0) {
    const swapIdx = visibleIndices[currentPos - 1];
    [hwData[i], hwData[swapIdx]] = [hwData[swapIdx], hwData[i]];
    redrawHwTable();
  } else if (direction === 1 && currentPos < visibleIndices.length - 1) {
    const swapIdx = visibleIndices[currentPos + 1];
    [hwData[i], hwData[swapIdx]] = [hwData[swapIdx], hwData[i]];
    redrawHwTable();
  }
}

async function saveHomework() {
  const statusEl = document.getElementById('hw-saved');
  const toDelete  = hwData.filter(r => r._deleted && r.id && !r._new);
  const toInsert  = hwData.filter(r => !r._deleted && r._new).map((r, i) => ({
    id: generateHomeworkId(),
    term: r.term, week_label: r.week_label || null, text: r.text || '', sort_order: i
  }));
  const toUpdate  = hwData.filter(r => !r._deleted && !r._new && r.id).map((r, i) => ({
    id: r.id, term: r.term, week_label: r.week_label || null, text: r.text || '', sort_order: i
  }));
  try {
    if (toDelete.length) {
      const { error } = await sb.from('homework_items').delete().in('id', toDelete.map(r=>r.id));
      if (error) throw error;
    }
    if (toInsert.length) {
      const { error } = await sb.from('homework_items').insert(toInsert);
      if (error) throw error;
    }
    if (toUpdate.length) {
      const { error } = await sb.from('homework_items').upsert(toUpdate);
      if (error) throw error;
    }
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2500);
    await loadAdminData('homework');
  } catch (err) {
    console.error(err);
    alert('Save failed: ' + (err?.message || err));
  }
}

// ── UTILS ─────────────────────────────────────────────────────────────
function generateHomeworkId() {
  const existingIds = hwData.map(r => r.id).filter(id => id && id.startsWith('hw')).map(id => parseInt(id.replace('hw', '')) || 0);
  const maxNum = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  return 'hw' + (maxNum + 1);
}

function showMsg(el, text, type) { el.textContent = text; el.className = 'msg ' + type; }

// ── NOTES EDITOR ──────────────────────────────────────────────────────
let notesEditingIdx = null;

function notesButtonHtml(i, notes) {
  if (notes && notes.trim()) {
    const trimmed = notes.replace(/\s+/g, ' ').trim();
    const snippet = trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
    return `<button type="button" class="btn-notes-edit" onclick="openNotesEditor(${i})" title="Click to edit notes"><span class="notes-snippet">${escapeHtml(snippet)}</span></button>`;
  }
  return `<button type="button" class="btn-notes-edit" onclick="openNotesEditor(${i})"><span class="notes-empty">+ Add notes</span></button>`;
}

function openNotesEditor(idx) {
  notesEditingIdx = idx;
  const ta = document.getElementById('notes-editor');
  ta.value = schedData[idx]?.notes || '';
  updateNotesPreview();
  document.getElementById('notes-modal').classList.add('open');
  setTimeout(() => ta.focus(), 50);
}

function closeNotesEditor() {
  document.getElementById('notes-modal').classList.remove('open');
  notesEditingIdx = null;
}

function notesModalBackdrop(e) {
  if (e.target.id === 'notes-modal') closeNotesEditor();
}

function saveNotesEditor() {
  if (notesEditingIdx == null) return;
  schedData[notesEditingIdx].notes = document.getElementById('notes-editor').value;
  closeNotesEditor();
  redrawSchedTable();
}

function updateNotesPreview() {
  const text = document.getElementById('notes-editor').value;
  const out = formatNotes(text);
  document.getElementById('notes-preview').innerHTML = out || '<span class="preview-empty">Preview will appear here…</span>';
}

function notesFmt(type) {
  const ta = document.getElementById('notes-editor');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const sel = text.slice(start, end);

  if (type === 'link') {
    const url = prompt('Link URL:', 'https://');
    if (!url) return;
    const label = sel || prompt('Link text:', 'click here') || 'link';
    const inserted = `[${label}](${url})`;
    ta.value = text.slice(0, start) + inserted + text.slice(end);
    const pos = start + inserted.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    updateNotesPreview();
    return;
  }
  if (type === 'image') {
    const url = prompt('Image URL (must be a public link):', 'https://');
    if (!url) return;
    const alt = prompt('Alt text (optional):', '') || '';
    const inserted = `![${alt}](${url})`;
    ta.value = text.slice(0, start) + inserted + text.slice(end);
    const pos = start + inserted.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    updateNotesPreview();
    return;
  }

  let before = '', after = '', placeholder = '';
  if      (type === 'bold')      { before = '**'; after = '**'; placeholder = 'bold text'; }
  else if (type === 'italic')    { before = '*';  after = '*';  placeholder = 'italic text'; }
  else if (type === 'underline') { before = '__'; after = '__'; placeholder = 'underlined text'; }
  else return;

  const inner = sel || placeholder;
  ta.value = text.slice(0, start) + before + inner + after + text.slice(end);
  ta.focus();
  ta.setSelectionRange(start + before.length, start + before.length + inner.length);
  updateNotesPreview();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('notes-modal')?.classList.contains('open')) {
    closeNotesEditor();
  }
});

// ── THEME ─────────────────────────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', 'light'); } catch(e) {}
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('theme', 'dark'); } catch(e) {}
  }
}

// ── DRAG-AND-DROP: ROW REORDER ────────────────────────────────────────
let _dragSrcIdx = null;
let _dragKind = null;  // 'sched' | 'hw' | 'te'

function onRowDragStart(e, idx, kind) {
  _dragSrcIdx = idx;
  _dragKind = kind;
  e.dataTransfer.effectAllowed = 'move';
  // setData is required by Firefox to actually start the drag
  try { e.dataTransfer.setData('text/plain', String(idx)); } catch(_) {}
  const tr = e.currentTarget.closest('tr');
  if (tr) tr.classList.add('dragging');
}

function onRowDragOver(e, idx, kind) {
  if (_dragKind !== kind || _dragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (idx === _dragSrcIdx) return;
  const tbody = e.currentTarget.parentNode;
  if (!tbody) return;
  tbody.querySelectorAll('tr.drop-target').forEach(el => el.classList.remove('drop-target'));
  e.currentTarget.classList.add('drop-target');
}

function onRowDragLeave(e) {
  // Only clear if we're actually leaving the row (not entering a child)
  if (e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drop-target');
}

function onRowDrop(e, idx, kind) {
  e.preventDefault();
  const srcIdx = _dragSrcIdx;
  const srcKind = _dragKind;
  cleanupDragState();
  if (srcKind !== kind || srcIdx === null || srcIdx === idx) return;
  const arr = kind === 'sched' ? schedData : (kind === 'hw' ? hwData : teData);
  if (srcIdx < 0 || srcIdx >= arr.length || idx < 0 || idx >= arr.length) return;
  const [moved] = arr.splice(srcIdx, 1);
  const insertAt = srcIdx < idx ? idx - 1 : idx;
  arr.splice(insertAt, 0, moved);
  if (kind === 'sched') redrawSchedTable();
  else if (kind === 'hw') redrawHwTable();
  else redrawTeTable();
}

function onRowDragEnd(e) {
  cleanupDragState();
}

function cleanupDragState() {
  document.querySelectorAll('tr.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('tr.drop-target').forEach(el => el.classList.remove('drop-target'));
  _dragSrcIdx = null;
  _dragKind = null;
}

// ── DRAG-AND-DROP: FILE UPLOAD ────────────────────────────────────────
function dropZoneOver(e) {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function dropZoneLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drag-over');
}
async function dropZoneDrop(e, rowId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  await uploadFilesToRow(rowId, files);
}

// Prevent the browser from navigating away when files are dropped outside a drop zone
window.addEventListener('dragover', e => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
});
window.addEventListener('drop', e => {
  if (!e.target.closest?.('.drop-zone')) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
  }
});

// ── TRIAL EXAMS: SLOT CONFIG ──────────────────────────────────────────
const TE_SLOT_TYPES = ['paper', 'solutions', 'report'];
const TE_SLOT_LABELS = { paper: 'Question Paper', solutions: 'Solutions', report: "Examiner's Report" };
const TE_SLOT_ICONS  = { paper: '📄',            solutions: '📝',        report: '📊' };

function teSlotPath(rowId, paper, type) {
  return `trial-exam-${rowId}/exam${paper}-${type}.pdf`;
}
function teSlotKey(rowId, paper, type) {
  return `${rowId}:${paper}:${type}`;
}

// teFileMap[`${rowId}:${paper}:${type}`] = true (file present) | undefined
let teFileMap = {};

async function teListRowFiles(rowId) {
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).list(`trial-exam-${rowId}`);
  if (error || !data) return [];
  return data.filter(f => f.name && !f.name.startsWith('.'));
}

// Parse "exam1-paper.pdf" → { paper: 1, type: 'paper' }
function teParseFilename(name) {
  const m = /^exam([12])-(paper|solutions|report)\.pdf$/i.exec(name);
  if (!m) return null;
  return { paper: parseInt(m[1], 10), type: m[2].toLowerCase() };
}

// ── TRIAL EXAMS (student view) ────────────────────────────────────────
async function loadTrialExams() {
  const [examsRes, progRes, mistakesRes] = await Promise.all([
    sb.from('trial_exams').select('*').eq('published', true).order('sort_order'),
    sb.from('trial_exam_progress').select('*').eq('user_id', currentUser.id),
    sb.from('trial_exam_mistakes').select('exam_id,paper').eq('user_id', currentUser.id)
  ]);
  if (examsRes.error) {
    document.getElementById('te-content').innerHTML = '<div class="empty-state">Error loading trial exams.</div>';
    return;
  }
  trialExams = examsRes.data || [];
  teProgressMap = {};
  (progRes.data || []).forEach(p => { teProgressMap[`${p.exam_id}:${p.paper}`] = p.completed; });
  teMistakeCounts = {};
  (mistakesRes.data || []).forEach(m => {
    const k = `${m.exam_id}:${m.paper}`;
    teMistakeCounts[k] = (teMistakeCounts[k] || 0) + 1;
  });
  // Fetch storage contents for all exam rows in parallel — populates teFileMap
  teFileMap = {};
  const lists = await Promise.all(trialExams.map(r => teListRowFiles(r.id)));
  trialExams.forEach((r, i) => {
    (lists[i] || []).forEach(f => {
      const parsed = teParseFilename(f.name);
      if (parsed) teFileMap[teSlotKey(r.id, parsed.paper, parsed.type)] = true;
    });
  });
  renderTrialExams();
}

function renderTrialExams() {
  const el = document.getElementById('te-content');
  if (!trialExams.length) {
    el.innerHTML = '<div class="empty-state">No trial exams yet — check back soon.</div>';
    updateTrialExamProgress();
    return;
  }
  let html = `<table class="te-table"><thead><tr>
    <th>Week Commencing</th><th>Year / Paper</th><th>Exams to Complete</th>
  </tr></thead><tbody>`;
  trialExams.forEach(r => {
    const isHoliday = /holiday/i.test(r.week_commencing || '');
    const weekText = (r.week_commencing || '').replace(/\s*\(School Holidays\)\s*/i, '').trim();
    html += `<tr${isHoliday ? ' class="holiday"' : ''}>
      <td class="te-week" data-label="Week Commencing">${escapeHtml(weekText)}</td>
      <td class="te-year" data-label="Year / Paper">${escapeHtml(r.paper_year || '')}</td>
      <td class="te-papers" data-label="Exams">${renderPaperCells(r)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  el.innerHTML = html;
  updateTrialExamProgress();
}

function renderPaperCells(r) {
  let out = '';
  [1, 2].forEach(p => {
    if (p === 1 && r.has_exam1 === false) return;
    if (p === 2 && r.has_exam2 === false) return;
    const k = `${r.id}:${p}`;
    const done = !!teProgressMap[k];
    const mc = teMistakeCounts[k] || 0;
    const btnCls = mc > 0 ? 'btn-mistakes has-mistakes' : 'btn-mistakes';
    out += `<span class="te-paper-cell">
      <span class="te-check${done ? ' done' : ''}" onclick="toggleTrialExam(${jsAttr(r.id)}, ${p})">${done ? '✓' : ''}</span>
      <span class="te-paper-label${done ? ' done' : ''}">Exam ${p}</span>
      <button class="${btnCls}" onclick="openMistakeModal(${jsAttr(r.id)}, ${p})">Log mistakes${mc ? `<span class="mistake-count">${mc}</span>` : ''}</button>
      ${renderPaperFileChips(r.id, p)}
    </span>`;
  });
  return out || '<span style="color:var(--dim);font-size:0.8rem;font-style:italic">—</span>';
}

function renderPaperFileChips(rowId, paper) {
  const chips = TE_SLOT_TYPES
    .filter(t => teFileMap[teSlotKey(rowId, paper, t)])
    .map(t => {
      const url = getPublicUrl(teSlotPath(rowId, paper, t));
      const fname = `Exam ${paper} — ${TE_SLOT_LABELS[t]}.pdf`;
      return `<a class="te-file-chip" onclick="openModal(${jsAttr(url)}, ${jsAttr(fname)})" title="${escapeHtml(TE_SLOT_LABELS[t])}">
        <span class="te-chip-icon">${TE_SLOT_ICONS[t]}</span>${escapeHtml(TE_SLOT_LABELS[t])}
      </a>`;
    });
  if (!chips.length) return '';
  return `<span class="te-files-inline">${chips.join('')}</span>`;
}

async function toggleTrialExam(examId, paper) {
  const k = `${examId}:${paper}`;
  const newVal = !teProgressMap[k];
  teProgressMap[k] = newVal;
  renderTrialExams();
  const { error } = await sb.from('trial_exam_progress').upsert(
    { user_id: currentUser.id, exam_id: examId, paper, completed: newVal, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,exam_id,paper' }
  );
  if (error) { console.error(error); alert('Could not save: ' + error.message); }
}

function updateTrialExamProgress() {
  let total = 0, done = 0;
  trialExams.forEach(r => {
    [1, 2].forEach(p => {
      if (p === 1 && r.has_exam1 === false) return;
      if (p === 2 && r.has_exam2 === false) return;
      total++;
      if (teProgressMap[`${r.id}:${p}`]) done++;
    });
  });
  const pct = total ? Math.round(done / total * 100) : 0;
  const fill = document.getElementById('te-fill');
  if (fill) fill.style.width = pct + '%';
  const count = document.getElementById('te-count');
  if (count) count.textContent = total ? `${done} of ${total} papers complete` : 'No exams yet';
  const pctEl = document.getElementById('te-pct');
  if (pctEl) pctEl.textContent = total ? pct + '%' : '';
}

// ── MISTAKE BOOK MODAL ────────────────────────────────────────────────
function examLabelFor(examId, paper) {
  const e = trialExams.find(r => r.id === examId);
  return e ? `${e.paper_year} — Exam ${paper}` : `Exam ${paper}`;
}

async function openMistakeModal(examId, paper) {
  mbEditing = { examId, paper, examLabel: examLabelFor(examId, paper), rows: [] };
  document.getElementById('mb-title').textContent = `Mistakes — ${mbEditing.examLabel}`;
  document.getElementById('mb-modal').classList.add('open');
  document.getElementById('mb-body').innerHTML = '<div class="mb-empty"><span class="spinner"></span> Loading…</div>';
  const { data, error } = await sb.from('trial_exam_mistakes')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('exam_id', examId)
    .eq('paper', paper)
    .order('created_at');
  if (error) {
    document.getElementById('mb-body').innerHTML = '<div class="mb-empty">Error loading mistakes.</div>';
    return;
  }
  mbEditing.rows = (data || []).map(r => ({ ...r }));
  if (!mbEditing.rows.length) mbEditing.rows.push(makeBlankMistakeRow());
  renderMistakeTable();
}

function makeBlankMistakeRow() {
  return { id: null, question: '', mistake: '', learning: '', _new: true };
}

function renderMistakeTable() {
  const body = document.getElementById('mb-body');
  if (!mbEditing) return;
  const visible = mbEditing.rows.filter(r => !r._deleted);
  if (!visible.length) {
    body.innerHTML = '<div class="mb-empty">No mistakes logged. Click <strong>+ Add Mistake</strong> below.</div>';
    return;
  }
  let html = `<table class="mb-table"><thead><tr>
    <th style="width:90px">Question</th>
    <th>Mistake</th>
    <th>Learning for next time</th>
    <th style="width:36px"></th>
  </tr></thead><tbody>`;
  mbEditing.rows.forEach((r, i) => {
    if (r._deleted) return;
    html += `<tr>
      <td data-label="Question"><textarea oninput="mbEditing.rows[${i}].question=this.value" placeholder="Q3a">${escapeHtml(r.question || '')}</textarea></td>
      <td data-label="Mistake"><textarea oninput="mbEditing.rows[${i}].mistake=this.value" placeholder="What did you get wrong?">${escapeHtml(r.mistake || '')}</textarea></td>
      <td data-label="Learning"><textarea oninput="mbEditing.rows[${i}].learning=this.value" placeholder="What to remember next time">${escapeHtml(r.learning || '')}</textarea></td>
      <td class="mb-actions"><button class="btn-delete" onclick="deleteMistakeRow(${i})" title="Delete">✕</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  body.innerHTML = html;
}

function addMistakeRow() {
  if (!mbEditing) return;
  mbEditing.rows.push(makeBlankMistakeRow());
  renderMistakeTable();
  // Focus the first textarea of the new row
  const tbody = document.querySelector('#mb-body .mb-table tbody');
  if (tbody) {
    const last = tbody.lastElementChild;
    if (last) last.querySelector('textarea')?.focus();
  }
}

function deleteMistakeRow(i) {
  if (!mbEditing) return;
  const row = mbEditing.rows[i];
  if (!row) return;
  if (row._new) {
    // Not saved yet — just drop it
    mbEditing.rows.splice(i, 1);
  } else {
    row._deleted = true;
  }
  renderMistakeTable();
}

function closeMistakeModal() {
  document.getElementById('mb-modal').classList.remove('open');
  mbEditing = null;
}

function mbModalBackdrop(e) {
  if (e.target.id === 'mb-modal') closeMistakeModal();
}

async function saveMistakes() {
  if (!mbEditing) return;
  const { examId, paper } = mbEditing;
  const isFilled = r => (r.question && r.question.trim()) || (r.mistake && r.mistake.trim()) || (r.learning && r.learning.trim());
  const toDelete = mbEditing.rows.filter(r => r._deleted && r.id);
  const toInsert = mbEditing.rows
    .filter(r => !r._deleted && r._new && isFilled(r))
    .map(r => ({
      user_id: currentUser.id, exam_id: examId, paper,
      question: r.question || null, mistake: r.mistake || null, learning: r.learning || null
    }));
  const toUpdate = mbEditing.rows
    .filter(r => !r._deleted && !r._new && r.id)
    .map(r => ({
      id: r.id, user_id: currentUser.id, exam_id: examId, paper,
      question: r.question || null, mistake: r.mistake || null, learning: r.learning || null,
      updated_at: new Date().toISOString()
    }));
  try {
    if (toDelete.length) {
      const { error } = await sb.from('trial_exam_mistakes').delete().in('id', toDelete.map(r => r.id));
      if (error) throw error;
    }
    if (toInsert.length) {
      const { error } = await sb.from('trial_exam_mistakes').insert(toInsert);
      if (error) throw error;
    }
    if (toUpdate.length) {
      const { error } = await sb.from('trial_exam_mistakes').upsert(toUpdate);
      if (error) throw error;
    }
    const k = `${examId}:${paper}`;
    const keptCount = mbEditing.rows.filter(r => !r._deleted && isFilled(r)).length;
    teMistakeCounts[k] = keptCount;
    const statusEl = document.getElementById('mb-saved');
    if (statusEl) {
      statusEl.classList.add('show');
      setTimeout(() => statusEl.classList.remove('show'), 1800);
    }
    renderTrialExams();
    closeMistakeModal();
  } catch (err) {
    console.error(err);
    alert('Save failed: ' + (err?.message || err));
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('mb-modal')?.classList.contains('open')) {
    closeMistakeModal();
  }
});

// ── PRINT MISTAKE BOOK ────────────────────────────────────────────────
async function openMistakeBookPrint() {
  const container = document.getElementById('print-mistake-book');
  if (!container) return;
  // Build off-screen first, then trigger print.
  const { data, error } = await sb.from('trial_exam_mistakes')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('exam_id').order('paper').order('created_at');
  if (error) { alert('Could not load mistakes: ' + error.message); return; }
  const grouped = new Map();
  (data || []).forEach(m => {
    const k = `${m.exam_id}:${m.paper}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(m);
  });
  const studentName = currentUser.user_metadata?.display_name || currentUser.email || '';
  const today = new Date().toLocaleDateString('en-AU');
  let html = `<h1>Trial Exam Mistake Book</h1>
    <div class="pb-meta">${escapeHtml(studentName)} · Generated ${escapeHtml(today)}</div>`;
  let any = false;
  trialExams.forEach(r => {
    [1, 2].forEach(p => {
      if (p === 1 && r.has_exam1 === false) return;
      if (p === 2 && r.has_exam2 === false) return;
      const rows = grouped.get(`${r.id}:${p}`);
      if (!rows || !rows.length) return;
      any = true;
      html += `<h2>${escapeHtml(r.paper_year || '')} — Exam ${p}</h2>
        <table><thead><tr>
          <th style="width:14%">Question</th>
          <th style="width:43%">Mistake</th>
          <th style="width:43%">Learning</th>
        </tr></thead><tbody>`;
      rows.forEach(m => {
        html += `<tr>
          <td>${escapeHtml(m.question || '')}</td>
          <td>${escapeHtml(m.mistake || '')}</td>
          <td>${escapeHtml(m.learning || '')}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    });
  });
  if (!any) html += '<p class="pb-empty">No mistakes logged yet.</p>';
  container.innerHTML = html;
  document.body.classList.add('printing-mistake-book');
  const cleanup = () => {
    document.body.classList.remove('printing-mistake-book');
    container.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}

// ── ADMIN: TRIAL EXAMS ────────────────────────────────────────────────
function renderAdminTrialExams(rows) {
  teData = rows.map(r => ({ ...r }));
  redrawTeTable();
}

function redrawTeTable() {
  const tbody = document.getElementById('te-tbody');
  if (!tbody) return;
  const visible = teData.filter(r => !r._deleted);
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1.5rem;font-style:italic;color:var(--dim)">No exams yet. Click + Add Exam.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  teData.forEach((r, i) => {
    if (r._deleted) return;
    const tr = makeTeRow(r, i);
    tbody.appendChild(tr);
    if (tr._fileRow) tbody.appendChild(tr._fileRow);
  });
}

function makeTeRow(r, i) {
  const tr = document.createElement('tr');
  if (r._new) tr.classList.add('new-row');
  tr.ondragover  = (e) => onRowDragOver(e, i, 'te');
  tr.ondrop      = (e) => onRowDrop(e, i, 'te');
  tr.ondragleave = (e) => onRowDragLeave(e);
  const visibleIndices = teData.map((row, idx) => !row._deleted ? idx : null).filter(idx => idx !== null);
  const visiblePos = visibleIndices.indexOf(i);
  const visibleTotal = visibleIndices.length;
  const filesBtn = r.id && !r._new
    ? `<button class="btn-files" onclick="toggleAdminTeFiles(${jsAttr(r.id)}, ${i})">📎 Files</button>`
    : '<span style="font-size:0.72rem;color:var(--dim)">Save first</span>';
  tr.innerHTML = `
    <td><input class="admin-input" type="text" value="${escapeHtml(r.week_commencing || '')}" placeholder="17/5/2026" oninput="teData[${i}].week_commencing=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.paper_year || '')}" placeholder="2017 - NHT" oninput="teData[${i}].paper_year=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.exams_label || '')}" placeholder="Exams 1 & 2" oninput="teData[${i}].exams_label=this.value"></td>
    <td style="text-align:center"><input type="checkbox" ${r.has_exam1 === false ? '' : 'checked'} onchange="teData[${i}].has_exam1=this.checked"></td>
    <td style="text-align:center"><input type="checkbox" ${r.has_exam2 === false ? '' : 'checked'} onchange="teData[${i}].has_exam2=this.checked"></td>
    <td>${filesBtn}</td>
    <td style="display:flex;gap:0.3rem;align-items:center;">
      <span class="drag-handle" draggable="true" ondragstart="onRowDragStart(event, ${i}, 'te')" ondragend="onRowDragEnd(event)" title="Drag to reorder">⋮⋮</span>
      ${visiblePos > 0 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveTeRow(${i},-1)" title="Move up">▲</button>` : '<span style="width:1.8rem"></span>'}
      ${visiblePos < visibleTotal - 1 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveTeRow(${i},1)" title="Move down">▼</button>` : '<span style="width:1.8rem"></span>'}
      <button class="btn-delete" onclick="deleteTeRow(${i})">✕</button>
    </td>`;
  if (r.id && !r._new) {
    const fileRow = document.createElement('tr');
    fileRow.className = 'admin-file-row';
    fileRow.id = `admin-te-file-row-${r.id}`;
    fileRow.innerHTML = `<td colspan="7"><div class="admin-file-panel" id="admin-te-file-panel-${r.id}"></div></td>`;
    tr._fileRow = fileRow;
  }
  return tr;
}

async function toggleAdminTeFiles(rowId, idx) {
  const fileRow   = document.getElementById(`admin-te-file-row-${rowId}`);
  const filePanel = document.getElementById(`admin-te-file-panel-${rowId}`);
  if (!fileRow) return;
  const isOpen = fileRow.classList.contains('open');
  if (isOpen) { fileRow.classList.remove('open'); return; }
  fileRow.classList.add('open');
  filePanel.innerHTML = '<span class="upload-status"><span class="spinner"></span> Loading…</span>';
  const files = await teListRowFiles(rowId);
  renderAdminTeFilePanel(filePanel, rowId, idx, files);
}

function renderAdminTeFilePanel(panel, rowId, idx, files) {
  const r = teData[idx] || {};
  const present = {}; // {`${paper}:${type}`: true}
  (files || []).forEach(f => {
    const parsed = teParseFilename(f.name);
    if (parsed) present[`${parsed.paper}:${parsed.type}`] = true;
  });
  // Sync presence into global teFileMap so student view reflects it after upload/delete
  TE_SLOT_TYPES.forEach(t => {
    [1, 2].forEach(p => {
      if (present[`${p}:${t}`]) teFileMap[teSlotKey(rowId, p, t)] = true;
      else delete teFileMap[teSlotKey(rowId, p, t)];
    });
  });

  const showExam1 = r.has_exam1 !== false;
  const showExam2 = r.has_exam2 !== false;
  let html = '';
  if (showExam1) html += renderAdminTeSlotGroup(rowId, 1, present);
  if (showExam2) html += renderAdminTeSlotGroup(rowId, 2, present);
  if (!showExam1 && !showExam2) html = '<span class="upload-status" style="font-style:italic">No papers enabled for this row.</span>';
  panel.innerHTML = html;
}

function renderAdminTeSlotGroup(rowId, paper, present) {
  let inner = '';
  TE_SLOT_TYPES.forEach(t => {
    const has = !!present[`${paper}:${t}`];
    const slotId = `te-slot-${rowId}-${paper}-${t}`;
    const inputId = `${slotId}-input`;
    const statusId = `${slotId}-status`;
    const fileCell = has
      ? `<span class="te-slot-file">
          <a class="file-link" onclick="openModal(${jsAttr(getPublicUrl(teSlotPath(rowId, paper, t)))}, ${jsAttr(`Exam ${paper} — ${TE_SLOT_LABELS[t]}.pdf`)})">${TE_SLOT_ICONS[t]} View</a>
          <button class="btn-delete" onclick="adminDeleteTeSlot(${jsAttr(rowId)}, ${paper}, ${jsAttr(t)})" title="Delete">✕</button>
        </span>`
      : `<span class="te-slot-empty">No file yet</span>`;
    inner += `<div class="te-slot" id="${slotId}">
      <div class="te-slot-label">${TE_SLOT_ICONS[t]} ${TE_SLOT_LABELS[t]}</div>
      <div>${fileCell}</div>
      <div class="te-slot-actions">
        <input type="file" id="${inputId}" accept=".pdf" onchange="adminUploadTeSlot(${jsAttr(rowId)}, ${paper}, ${jsAttr(t)}, this)">
        <button class="btn-upload-slot" onclick="document.getElementById('${inputId}').click()">${has ? 'Replace' : 'Upload PDF'}</button>
        <span class="te-slot-status" id="${statusId}"></span>
      </div>
    </div>`;
  });
  return `<div class="te-slot-group">
    <div class="te-slot-group-label">Exam ${paper}</div>
    ${inner}
  </div>`;
}

async function adminUploadTeSlot(rowId, paper, type, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name)) { alert('Only PDF files are accepted.'); inputEl.value = ''; return; }
  const statusEl = document.getElementById(`te-slot-${rowId}-${paper}-${type}-status`);
  if (statusEl) statusEl.textContent = 'Uploading…';
  const path = teSlotPath(rowId, paper, type);
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: true, contentType: 'application/pdf' });
  if (error) {
    if (statusEl) statusEl.textContent = '';
    alert('Upload failed: ' + error.message);
    return;
  }
  teFileMap[teSlotKey(rowId, paper, type)] = true;
  if (statusEl) {
    statusEl.textContent = '✓ Uploaded';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  }
  inputEl.value = '';
  // Refresh the panel so the View link appears
  const files = await teListRowFiles(rowId);
  const idx = teData.findIndex(r => r.id === rowId);
  const panel = document.getElementById(`admin-te-file-panel-${rowId}`);
  if (panel && idx >= 0) renderAdminTeFilePanel(panel, rowId, idx, files);
}

async function adminDeleteTeSlot(rowId, paper, type) {
  if (!confirm(`Delete ${TE_SLOT_LABELS[type]} for Exam ${paper}?`)) return;
  const path = teSlotPath(rowId, paper, type);
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) { alert('Delete failed: ' + error.message); return; }
  delete teFileMap[teSlotKey(rowId, paper, type)];
  const files = await teListRowFiles(rowId);
  const idx = teData.findIndex(r => r.id === rowId);
  const panel = document.getElementById(`admin-te-file-panel-${rowId}`);
  if (panel && idx >= 0) renderAdminTeFilePanel(panel, rowId, idx, files);
}

function addTrialExamRow() {
  teData.push({
    id: null,
    week_commencing: '',
    paper_year: '',
    exams_label: 'Exams 1 & 2',
    has_exam1: true,
    has_exam2: true,
    sort_order: teData.length,
    published: true,
    _new: true
  });
  redrawTeTable();
}

function deleteTeRow(i) {
  if (!teData[i]) return;
  if (teData[i]._new) {
    teData.splice(i, 1);
  } else {
    teData[i]._deleted = true;
  }
  redrawTeTable();
}

function moveTeRow(i, direction) {
  const visibleIndices = teData.map((r, idx) => !r._deleted ? idx : null).filter(idx => idx !== null);
  const currentPos = visibleIndices.indexOf(i);
  if (direction === -1 && currentPos > 0) {
    const swapIdx = visibleIndices[currentPos - 1];
    [teData[i], teData[swapIdx]] = [teData[swapIdx], teData[i]];
    redrawTeTable();
  } else if (direction === 1 && currentPos < visibleIndices.length - 1) {
    const swapIdx = visibleIndices[currentPos + 1];
    [teData[i], teData[swapIdx]] = [teData[swapIdx], teData[i]];
    redrawTeTable();
  }
}

async function saveTrialExams() {
  const statusEl = document.getElementById('te-saved');
  const toDelete = teData.filter(r => r._deleted && r.id);
  let order = 0;
  const toInsert = [];
  const toUpdate = [];
  teData.forEach(r => {
    if (r._deleted) return;
    const payload = {
      week_commencing: r.week_commencing || null,
      paper_year: r.paper_year || '',
      exams_label: r.exams_label || '',
      has_exam1: r.has_exam1 !== false,
      has_exam2: r.has_exam2 !== false,
      sort_order: order++,
      published: r.published !== false
    };
    if (r._new) toInsert.push(payload);
    else toUpdate.push({ id: r.id, ...payload });
  });
  try {
    if (toDelete.length) {
      const { error } = await sb.from('trial_exams').delete().in('id', toDelete.map(r => r.id));
      if (error) throw error;
    }
    if (toInsert.length) {
      const { error } = await sb.from('trial_exams').insert(toInsert);
      if (error) throw error;
    }
    if (toUpdate.length) {
      const { error } = await sb.from('trial_exams').upsert(toUpdate);
      if (error) throw error;
    }
    if (statusEl) {
      statusEl.classList.add('show');
      setTimeout(() => statusEl.classList.remove('show'), 2500);
    }
    await loadAdminData('trialexams');
  } catch (err) {
    console.error(err);
    alert('Save failed: ' + (err?.message || err));
  }
}
