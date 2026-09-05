'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let webpush = null;
try { webpush = require('web-push'); } catch (_) { /* graceful fallback */ }

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA_DIR, 'stepflow-state.json');
const SECRET_FILE = path.join(DATA_DIR, 'stepflow-auth-secret.txt');
const VAPID_FILE = path.join(DATA_DIR, 'stepflow-vapid.json');

const VALID_USERS = {
  hy: { id: 'hy', role: 'student', displayName: 'hy' },
  yjw: { id: 'yjw', role: 'student', displayName: 'yjw' },
  nyj: { id: 'nyj', role: 'student', displayName: 'nyj' },
  nyj5004: { id: 'nyj5004', role: 'admin', displayName: '관리자' },
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function initialStudentData() {
  return {
    attendanceHistory: [],
    studySessions: [],
    activeStudy: null,
    plans: { long: [], month: [], week: [], day: [] },
    lectures: [],
    events: [],
    preferences: { weeklyStart: 1 },
    updatedAt: new Date().toISOString(),
  };
}

function initialState() {
  return {
    schemaVersion: 3,
    users: {
      hy: { ...VALID_USERS.hy, data: initialStudentData() },
      yjw: { ...VALID_USERS.yjw, data: initialStudentData() },
      nyj: { ...VALID_USERS.nyj, data: initialStudentData() },
      nyj5004: { ...VALID_USERS.nyj5004 },
    },
    globalEvents: [],
    adminNotifications: [],
    pushSubscriptions: { nyj5004: [] },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeStudentData(d) {
  const base = initialStudentData();
  d = d && typeof d === 'object' ? d : {};
  base.attendanceHistory = Array.isArray(d.attendanceHistory) ? d.attendanceHistory : [];
  base.studySessions = Array.isArray(d.studySessions) ? d.studySessions : [];
  base.activeStudy = d.activeStudy && typeof d.activeStudy === 'object' ? d.activeStudy : null;
  base.plans = d.plans && typeof d.plans === 'object' ? d.plans : base.plans;
  for (const k of ['long', 'month', 'week', 'day']) if (!Array.isArray(base.plans[k])) base.plans[k] = [];
  base.lectures = Array.isArray(d.lectures) ? d.lectures : [];
  base.events = Array.isArray(d.events) ? d.events : [];
  base.preferences = { ...base.preferences, ...(d.preferences || {}) };
  base.updatedAt = d.updatedAt || new Date().toISOString();
  return base;
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return initialState();
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const st = initialState();
    st.schemaVersion = 3;
    st.globalEvents = Array.isArray(parsed.globalEvents) ? parsed.globalEvents : [];
    st.adminNotifications = Array.isArray(parsed.adminNotifications) ? parsed.adminNotifications : [];
    st.pushSubscriptions = parsed.pushSubscriptions && typeof parsed.pushSubscriptions === 'object' ? parsed.pushSubscriptions : { nyj5004: [] };
    if (!Array.isArray(st.pushSubscriptions.nyj5004)) st.pushSubscriptions.nyj5004 = [];
    for (const id of ['hy', 'yjw', 'nyj']) {
      st.users[id] = { ...VALID_USERS[id], data: normalizeStudentData(parsed.users?.[id]?.data) };
    }
    st.users.nyj5004 = { ...VALID_USERS.nyj5004 };
    st.updatedAt = parsed.updatedAt || new Date().toISOString();
    return st;
  } catch (e) {
    console.error('Failed to load state:', e);
    return initialState();
  }
}

let state = loadState();

function saveState() {
  state.updatedAt = new Date().toISOString();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}
if (!fs.existsSync(STATE_FILE)) saveState();

function getSecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}
const AUTH_SECRET = getSecret();

let vapid = null;
if (webpush) {
  try {
    if (fs.existsSync(VAPID_FILE)) vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    else {
      vapid = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2), { mode: 0o600 });
    }
    webpush.setVapidDetails('mailto:stepflow@local.invalid', vapid.publicKey, vapid.privateKey);
  } catch (e) {
    console.error('Web push init failed:', e);
    vapid = null;
  }
}

function b64u(input) { return Buffer.from(input).toString('base64url'); }
function signPayload(payload) {
  const data = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!VALID_USERS[p.id]) return null;
    if (p.exp && Date.now() > p.exp) return null;
    return VALID_USERS[p.id];
  } catch (_) { return null; }
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('='); if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function auth(req) { return verifyToken(parseCookies(req).sf_session); }
function setSession(res, user) {
  const token = signPayload({ id: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  res.setHeader('Set-Cookie', `sf_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`);
}
function clearSession(res) { res.setHeader('Set-Cookie', 'sf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'); }

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}
function text(res, code, body, type='text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { reject(new Error('too_large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}
function safeStr(v, max=300) { return String(v ?? '').trim().slice(0, max); }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; }
function nowIso() { return new Date().toISOString(); }
function localDateFromISO(iso) {
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day}`;
  } catch (_) { return ''; }
}
function localHM(iso) {
  try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); }
  catch (_) { return ''; }
}
function todayKST() { return localDateFromISO(nowIso()); }
function uid(prefix='id') { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }

function sanitizePlans(input) {
  const out = { long: [], month: [], week: [], day: [] };
  if (!input || typeof input !== 'object') return out;
  for (const level of Object.keys(out)) {
    const arr = Array.isArray(input[level]) ? input[level] : [];
    out[level] = arr.slice(0, 1000).map(x => ({
      ...x,
      id: safeStr(x.id, 80) || uid(level[0]),
      title: safeStr(x.title, 160),
      parentId: safeStr(x.parentId, 80),
      parent: safeStr(x.parent, 160),
      startDate: isoDate(x.startDate),
      endDate: isoDate(x.endDate),
      date: isoDate(x.date),
      goalType: ['quantity','page','lecture','time','check'].includes(x.goalType) ? x.goalType : x.goalType,
      target: Number.isFinite(Number(x.target)) ? Math.max(0, Number(x.target)) : undefined,
      completed: Number.isFinite(Number(x.completed)) ? Math.max(0, Number(x.completed)) : undefined,
      goalTotal: Number.isFinite(Number(x.goalTotal)) ? Math.max(0, Number(x.goalTotal)) : undefined,
      manualProgress: Number.isFinite(Number(x.manualProgress)) ? Math.max(0, Math.min(100, Number(x.manualProgress))) : 0,
      unit: safeStr(x.unit, 20),
      subject: safeStr(x.subject, 60),
      goalId: safeStr(x.goalId, 80),
      carriedFrom: safeStr(x.carriedFrom, 80),
      lectureId: safeStr(x.lectureId, 80),
    }));
  }
  return out;
}
function sanitizeLectures(input) {
  return (Array.isArray(input) ? input : []).slice(0, 200).map(x => ({
    id: safeStr(x.id,80) || uid('lec'),
    title: safeStr(x.title,160), subject: safeStr(x.subject,60),
    total: Math.max(1, Math.min(1000, Number(x.total)||1)),
    done: Math.max(0, Math.min(1000, Number(x.done)||0)),
    days: (Array.isArray(x.days)?x.days:[]).map(Number).filter(n=>n>=0&&n<=6).slice(0,7),
    time: /^\d{2}:\d{2}$/.test(String(x.time||'')) ? String(x.time) : '20:00',
    startDate: isoDate(x.startDate), endDate: isoDate(x.endDate),
    parentPlanId: safeStr(x.parentPlanId,80),
  }));
}
function sanitizeEvent(x, createdBy) {
  const startDate = isoDate(x.startDate || x.date);
  let endDate = isoDate(x.endDate) || startDate;
  if (startDate && endDate < startDate) endDate = startDate;
  return {
    id: safeStr(x.id,80) || uid('evt'),
    title: safeStr(x.title,160),
    type: ['mock','exam','performance','academy','assignment','consult','other'].includes(x.type) ? x.type : 'other',
    subject: safeStr(x.subject,60),
    importance: ['normal','important','critical'].includes(x.importance) ? x.importance : 'normal',
    startDate, endDate,
    note: safeStr(x.note,500),
    createdBy: createdBy || safeStr(x.createdBy,80),
    createdAt: x.createdAt || nowIso(),
  };
}

function studentPayload(id) {
  const u = state.users[id];
  return {
    profile: { id: u.id, role: u.role, displayName: u.displayName },
    data: u.data,
    globalEvents: state.globalEvents,
    serverNow: nowIso(),
  };
}

function dayProgress(p) {
  if (p.goalType === 'check') return Number(p.completed || 0) >= 1 ? 100 : 0;
  const t = Number(p.target || 0), c = Number(p.completed || 0);
  return t > 0 ? Math.min(100, Math.round(c / t * 100)) : 0;
}
function todayPlanProgress(data, date=todayKST()) {
  const list = data.plans.day.filter(p => p.date === date);
  return list.length ? Math.round(list.reduce((a,p)=>a+dayProgress(p),0)/list.length) : 0;
}
function studySecondsOn(data, date=todayKST()) {
  return data.studySessions.filter(s => s.date === date).reduce((a,s)=>a + Math.max(0, Number(s.seconds)||0),0)
    + (data.activeStudy && localDateFromISO(data.activeStudy.startAt)===date ? Math.floor((Date.now()-new Date(data.activeStudy.startAt).getTime())/1000) : 0);
}
function attendanceSummary(data, date=todayKST()) {
  const recs = data.attendanceHistory.filter(r => r.date === date);
  const open = [...recs].reverse().find(r => r.inAt && !r.outAt);
  return { records: recs, checkedIn: !!open, current: open || null, firstIn: recs[0]?.inAt || null, lastOut: [...recs].reverse().find(r=>r.outAt)?.outAt || null };
}
function adminOverview() {
  const date = todayKST();
  return ['hy','yjw','nyj'].map(id => {
    const u = state.users[id], d = u.data, a = attendanceSummary(d,date);
    return {
      id, displayName: u.displayName,
      attendance: a,
      activeStudy: d.activeStudy,
      studySeconds: studySecondsOn(d,date),
      planProgress: todayPlanProgress(d,date),
      todayPlans: d.plans.day.filter(p=>p.date===date).length,
      updatedAt: d.updatedAt,
    };
  });
}

async function sendAdminPush(title, body, data={}) {
  if (!webpush || !vapid) return;
  const subs = state.pushSubscriptions.nyj5004 || [];
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, data });
  const keep = [];
  for (const sub of subs) {
    try { await webpush.sendNotification(sub.subscription, payload); keep.push(sub); }
    catch (e) {
      if (![404,410].includes(e.statusCode)) { console.error('push send failed', e.statusCode || e.message); keep.push(sub); }
    }
  }
  if (keep.length !== subs.length) { state.pushSubscriptions.nyj5004 = keep; saveState(); }
}
function addAdminNotification(studentId, kind, title, body) {
  const n = { id: uid('noti'), studentId, kind, title, body, createdAt: nowIso(), read: false };
  state.adminNotifications.unshift(n);
  state.adminNotifications = state.adminNotifications.slice(0, 500);
  saveState();
  sendAdminPush(title, body, { studentId, kind }).catch(()=>{});
  return n;
}

function requireUser(req,res) {
  const u = auth(req); if (!u) { json(res,401,{error:'login_required'}); return null; } return u;
}
function requireRole(req,res,role) {
  const u = requireUser(req,res); if (!u) return null;
  if (u.role !== role) { json(res,403,{error:'forbidden'}); return null; } return u;
}

const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml'
};
function serveStatic(req,res,urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return text(res,403,'Forbidden');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const cache = ['.png','.svg'].includes(ext) ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, {
    'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': cache,
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  });
  fs.createReadStream(file).pipe(res); return true;
}

async function handleApi(req,res,url) {
  const p = url.pathname;
  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req); const id = safeStr(b.id,40).toLowerCase();
    const user = VALID_USERS[id];
    if (!user) return json(res,401,{error:'invalid_id'});
    setSession(res,user); return json(res,200,{user});
  }
  if (p === '/api/logout' && req.method === 'POST') { clearSession(res); return json(res,200,{ok:true}); }
  if (p === '/api/session' && req.method === 'GET') {
    const u = auth(req); return u ? json(res,200,{user:u}) : json(res,401,{error:'login_required'});
  }

  if (p === '/api/me' && req.method === 'GET') {
    const u = requireRole(req,res,'student'); if (!u) return;
    return json(res,200,studentPayload(u.id));
  }
  if (p === '/api/plans' && req.method === 'PUT') {
    const u = requireRole(req,res,'student'); if (!u) return;
    const b = await readBody(req); state.users[u.id].data.plans = sanitizePlans(b.plans);
    state.users[u.id].data.updatedAt = nowIso(); saveState(); return json(res,200,studentPayload(u.id));
  }
  if (p === '/api/lectures' && req.method === 'PUT') {
    const u = requireRole(req,res,'student'); if (!u) return;
    const b = await readBody(req); state.users[u.id].data.lectures = sanitizeLectures(b.lectures);
    state.users[u.id].data.updatedAt = nowIso(); saveState(); return json(res,200,studentPayload(u.id));
  }
  if (p === '/api/attendance' && req.method === 'POST') {
    const u = requireRole(req,res,'student'); if (!u) return;
    const b = await readBody(req); const d = state.users[u.id].data, date = todayKST();
    if (b.action === 'in') {
      const open = d.attendanceHistory.find(r=>r.date===date && !r.outAt);
      if (!open) d.attendanceHistory.push({ id: uid('att'), date, inAt: nowIso(), outAt:null });
      d.updatedAt = nowIso(); saveState();
      addAdminNotification(u.id,'attendance_in','입실 알림',`${u.displayName} 학생이 ${localHM(nowIso())} 입실했습니다.`);
    } else if (b.action === 'out') {
      const open = [...d.attendanceHistory].reverse().find(r=>r.date===date && !r.outAt);
      if (!open) return json(res,409,{error:'not_checked_in'});
      open.outAt = nowIso(); d.updatedAt = nowIso(); saveState();
      addAdminNotification(u.id,'attendance_out','퇴실 알림',`${u.displayName} 학생이 ${localHM(open.outAt)} 퇴실했습니다.`);
    } else return json(res,400,{error:'bad_action'});
    return json(res,200,studentPayload(u.id));
  }
  if (p === '/api/study/start' && req.method === 'POST') {
    const u = requireRole(req,res,'student'); if (!u) return;
    const b = await readBody(req), d = state.users[u.id].data;
    if (d.activeStudy) return json(res,409,{error:'already_running'});
    d.activeStudy = { id: uid('run'), startAt: nowIso(), subject:safeStr(b.subject,60)||'공부', detail:safeStr(b.detail,180) };
    d.updatedAt=nowIso(); saveState(); return json(res,200,studentPayload(u.id));
  }
  if (p === '/api/study/finish' && req.method === 'POST') {
    const u = requireRole(req,res,'student'); if (!u) return;
    const b = await readBody(req), d = state.users[u.id].data, a=d.activeStudy;
    if (!a) return json(res,409,{error:'not_running'});
    const endAt=nowIso(), seconds=Math.max(1,Math.floor((new Date(endAt)-new Date(a.startAt))/1000));
    d.studySessions.push({ id:uid('ses'), date:localDateFromISO(a.startAt), startAt:a.startAt, endAt, seconds, subject:a.subject, detail:a.detail, note:safeStr(b.note,300), focus:Math.max(1,Math.min(3,Number(b.focus)||2)) });
    d.activeStudy=null; d.updatedAt=nowIso(); saveState(); return json(res,200,studentPayload(u.id));
  }
  if (p === '/api/events' && req.method === 'POST') {
    const u = requireRole(req,res,'student'); if (!u) return;
    const b=await readBody(req), ev=sanitizeEvent(b.event,u.id); if(!ev.title||!ev.startDate)return json(res,400,{error:'missing_fields'});
    state.users[u.id].data.events.push(ev); state.users[u.id].data.updatedAt=nowIso(); saveState(); return json(res,200,studentPayload(u.id));
  }
  if (p.startsWith('/api/events/') && req.method === 'DELETE') {
    const u=requireRole(req,res,'student'); if(!u)return; const id=decodeURIComponent(p.slice('/api/events/'.length));
    state.users[u.id].data.events=state.users[u.id].data.events.filter(e=>e.id!==id); state.users[u.id].data.updatedAt=nowIso(); saveState(); return json(res,200,studentPayload(u.id));
  }

  if (p === '/api/admin/overview' && req.method === 'GET') {
    const u=requireRole(req,res,'admin'); if(!u)return;
    return json(res,200,{students:adminOverview(),notifications:state.adminNotifications.slice(0,100),globalEvents:state.globalEvents,serverNow:nowIso()});
  }
  if (p === '/api/admin/student' && req.method === 'GET') {
    const u=requireRole(req,res,'admin'); if(!u)return; const id=safeStr(url.searchParams.get('id'),40);
    if(!['hy','yjw','nyj'].includes(id))return json(res,404,{error:'not_found'}); return json(res,200,studentPayload(id));
  }
  if (p === '/api/admin/event' && req.method === 'POST') {
    const u=requireRole(req,res,'admin'); if(!u)return; const b=await readBody(req), target=safeStr(b.target,40), ev=sanitizeEvent(b.event,u.id);
    if(!ev.title||!ev.startDate)return json(res,400,{error:'missing_fields'});
    if(target==='all') state.globalEvents.push(ev);
    else if(['hy','yjw','nyj'].includes(target)) state.users[target].data.events.push(ev);
    else return json(res,400,{error:'bad_target'});
    saveState(); return json(res,200,{ok:true});
  }
  if (p.startsWith('/api/admin/event/') && req.method === 'DELETE') {
    const u=requireRole(req,res,'admin'); if(!u)return; const id=decodeURIComponent(p.slice('/api/admin/event/'.length)), target=safeStr(url.searchParams.get('target'),40);
    if(target==='all') state.globalEvents=state.globalEvents.filter(e=>e.id!==id);
    else if(['hy','yjw','nyj'].includes(target)) state.users[target].data.events=state.users[target].data.events.filter(e=>e.id!==id);
    else return json(res,400,{error:'bad_target'});
    saveState(); return json(res,200,{ok:true});
  }
  if (p === '/api/admin/notifications/read' && req.method === 'POST') {
    const u=requireRole(req,res,'admin'); if(!u)return; state.adminNotifications.forEach(n=>n.read=true); saveState(); return json(res,200,{ok:true});
  }
  if (p === '/api/push/public-key' && req.method === 'GET') {
    const u=requireRole(req,res,'admin'); if(!u)return; return json(res,200,{available:!!(webpush&&vapid),publicKey:vapid?.publicKey||''});
  }
  if (p === '/api/push/subscribe' && req.method === 'POST') {
    const u=requireRole(req,res,'admin'); if(!u)return; const b=await readBody(req); const sub=b.subscription;
    if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return json(res,400,{error:'bad_subscription'});
    const arr=state.pushSubscriptions.nyj5004; const idx=arr.findIndex(x=>x.subscription?.endpoint===sub.endpoint);
    const item={subscription:sub,createdAt:nowIso(),ua:safeStr(req.headers['user-agent'],200)}; if(idx>=0)arr[idx]=item;else arr.push(item);
    state.pushSubscriptions.nyj5004=arr.slice(-20); saveState(); return json(res,200,{ok:true});
  }

  return json(res,404,{error:'not_found'});
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req,res,url);
    if (serveStatic(req,res,url.pathname)) return;
    // SPA fallback
    if (req.method==='GET') return serveStatic(req,res,'/index.html');
    return text(res,404,'Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.message==='too_large'?413:400, {error:e.message||'server_error'});
    else res.end();
  }
});

server.listen(PORT, () => console.log(`STEPFLOW listening on ${PORT}`));
