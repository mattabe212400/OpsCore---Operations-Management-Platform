// ══════════════════════════════════════════════
// auth.js
// Authentication, Role-Based Access Control (RBAC), and app initialization.
//
//   - CURRENT_USER      — the signed-in user object (set after login)
//   - ROLE_ACCESS       — page permission map for every role (admin → viewer)
//   - getRoleAccess()   — resolves fuzzy role strings to a permission set
//   - canAccess(page)   — checks if CURRENT_USER can view a page
//   - rbacApplySidebar()— hides/shows nav items based on role
//   - rbacNav(page,el)  — navigates with RBAC guard (redirects if no access)
//   - lgLogin()         — Firebase email/password login + demo mode entry
//   - lgApplyUser()     — hydrates CURRENT_USER from Firestore user record
//   - lgLogout()        — signs out and reloads the page
//   - lgResetTimer()    — resets the 4-hour inactivity auto-logout timer
//   - init()            — bootstraps the full app on page load
//   - injectDemoData()  — seeds the in-memory D store with realistic sample data
//   - enterDemoMode()   — activates demo mode (no Firebase required)
// ══════════════════════════════════════════════
const TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
let CURRENT_USER = null;
let _fbAuth = null;
let _inactTimer;

// ── ROLE ACCESS MAP ──
const ALL_PAGES = ['dashboard','attendance','calendar','tasks','notes','finance','judicial','sober','members','recruitment','academics','committees','analytics','files','transition','settings','philanthropy','alumni','ritual','healthscore'];

const ROLE_ACCESS = {
  'admin':                  ALL_PAGES,
  'exec':                   ALL_PAGES,
  'President':              ALL_PAGES,
  'Vice President':         ALL_PAGES,
  'Treasurer':              ['dashboard','finance','tasks','files','settings','analytics'],
  'Operations Director':           ['dashboard','sober','calendar','files','settings','analytics'],
  'Executive Secretary':              ['dashboard','notes','attendance','calendar','files','settings','ritual'],
  'Academic Chair':      ['dashboard','academics','members','files','settings','analytics'],
  'Talent Acquisition Lead':      ['dashboard','recruitment','calendar','members','committees','files','settings'],
  'Chaplain':               ['dashboard','ritual','members','committees','files','settings'],
  'Community Service Chair':['dashboard','philanthropy','committees','calendar','files','settings'],
  'Community Outreach Lead':     ['dashboard','philanthropy','committees','calendar','files','settings'],
  'Alumni Relations Chair': ['dashboard','alumni','members','files','settings'],
  'New Member Educator':    ['dashboard','ritual','members','committees','calendar','files','settings'],
  'Social Chair':           ['dashboard','sober','calendar','files','settings'],
  'viewer':                 ['dashboard','attendance','calendar','analytics','files','settings'],
  '_default_chair':         ['dashboard','committees','calendar','files','settings','philanthropy','ritual'],
};

function getRoleAccess(role){
  if(!role) return ROLE_ACCESS['viewer'];
  // Direct match first
  if(ROLE_ACCESS[role]) return ROLE_ACCESS[role];
  // Case-insensitive match
  const lower = role.toLowerCase();
  const match = Object.keys(ROLE_ACCESS).find(k => k.toLowerCase() === lower);
  if(match) return ROLE_ACCESS[match];
  // Pattern match for common exec roles
  if(/president|vice.?pres|vp/i.test(role)) return ALL_PAGES;
  if(/admin/i.test(role)) return ALL_PAGES;
  if(/exec|officer/i.test(role)) return ALL_PAGES;
  if(/treasurer/i.test(role)) return ROLE_ACCESS['Treasurer'];
  if(/secretary/i.test(role)) return ROLE_ACCESS['Secretary'];
  if(/risk/i.test(role)) return ROLE_ACCESS['Risk Manager'];
  if(/recruitment/i.test(role)) return ROLE_ACCESS['Recruitment Chair'];
  if(/scholarship|academic/i.test(role)) return ROLE_ACCESS['Scholarship Chair'];
  if(/chaplain/i.test(role)) return ROLE_ACCESS['Chaplain'];
  if(/philanthropy/i.test(role)) return ROLE_ACCESS['Philanthropy Chair'];
  if(/alumni/i.test(role)) return ROLE_ACCESS['Alumni Relations Chair'];
  if(/educator|nme|new.?member/i.test(role)) return ROLE_ACCESS['New Member Educator'];
  if(/social/i.test(role)) return ROLE_ACCESS['Social Chair'];
  if(/chair|officer|educator|chaplain/i.test(role)) return ROLE_ACCESS['_default_chair'];
  // Unknown role — give reasonable read-only exec access (not just dashboard+settings)
  return ROLE_ACCESS['viewer'];
}

function canAccess(page){
  if(!CURRENT_USER) return false;
  // Try role first, then title as fallback
  const roleKey = CURRENT_USER.role||'';
  const titleKey = CURRENT_USER.title||'';
  const allowed = getRoleAccess(roleKey) || getRoleAccess(titleKey) || ROLE_ACCESS['viewer'];
  return allowed.includes(page);
}

function rbacApplySidebar(){
  if(!CURRENT_USER) return;
  const roleKey = CURRENT_USER.role||'';
  const titleKey = CURRENT_USER.title||'';
  const allowed = getRoleAccess(roleKey) || getRoleAccess(titleKey) || ROLE_ACCESS['viewer'];
  document.querySelectorAll('.ni[data-page]').forEach(el=>{
    const pg = el.getAttribute('data-page');
    el.classList.toggle('nav-hidden', !allowed.includes(pg));
  });
  document.querySelectorAll('.ns[data-section]').forEach(section=>{
    const items = section.querySelectorAll('.ni[data-page]');
    const anyVisible = [...items].some(i=>!i.classList.contains('nav-hidden'));
    section.style.display = anyVisible ? '' : 'none';
  });
}

function rbacNav(page, el){
  if(!canAccess(page)){
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
    const denied = document.getElementById('page-access-denied');
    if(denied){
      denied.classList.add('active');
      document.getElementById('pg-title').textContent = 'Access Restricted';
      document.getElementById('ad-role').textContent = PT[page]||page;
    }
    return;
  }
  nav(page, el);
}

// ── LOGIN WITH FIREBASE EMAIL/PASSWORD ──
async function lgLogin(){
  const email = document.getElementById('lg-user').value.trim();
  const password = document.getElementById('lg-pass').value;
  const err = document.getElementById('lg-err');
  const btn = document.getElementById('lg-btn');
  err.textContent = '';
  if(!email||!password){err.textContent='Please enter your email and password.';return;}

  // ── DEMO MODE: accept any credentials and load demo data ──
  if(window._IS_DEMO){
    btn.textContent='Loading demo…';btn.disabled=true;
    setTimeout(()=>enterDemoMode(),300);
    return;
  }

  // ── LIVE MODE: Firebase sign-in ──
  if(!window._fbAuth||!window._fbFns){err.textContent='Auth not ready. Please wait a moment.';return;}
  btn.textContent='Signing in…';btn.disabled=true;
  try{
    await window._fbFns.signInWithEmailAndPassword(window._fbAuth, email, password);
    // onAuthStateChanged will handle the rest
  } catch(e){
    btn.textContent='Sign In';btn.disabled=false;
    const codeMap={
      'auth/user-not-found':'No account found for this email.',
      'auth/wrong-password':'Incorrect password.',
      'auth/invalid-email':'Please enter a valid email address.',
      'auth/too-many-requests':'Too many attempts. Please wait and try again.',
      'auth/invalid-credential':'Invalid email or password.',
      'auth/network-request-failed':'Network error. Check your connection.',
    };
    err.textContent = codeMap[e.code] || 'Sign-in failed: '+e.message;
    document.getElementById('lg-pass').value='';
    document.getElementById('lg-pass').focus();
  }
}

// ── APPLY LOGGED-IN USER ──
async function lgApplyUser(firebaseUser){
  // Load user profile from Firestore users/{uid}
  let userProfile = null;
  let profileExists = false;
  try{
    if(_db && _fbFns){
      const {doc,getDoc} = _fbFns;
      const snap = await getDoc(doc(_db,'users',firebaseUser.uid));
      if(snap.exists()){
        userProfile = snap.data();
        profileExists = true;
      }
    }
  } catch(e){console.warn('Could not load user profile:',e.message);}

  // Block access if no users/{uid} doc exists in Firestore
  if(!profileExists){
    if(window._fbFns && window._fbAuth) await window._fbFns.signOut(window._fbAuth);
    const gate = document.getElementById('login-gate');
    gate.style.display = 'flex';
    document.querySelectorAll('.lg-fld').forEach(el=>el.style.display='');
    const btn = document.getElementById('lg-btn');
    if(btn){btn.style.display='block';btn.textContent='Sign In';btn.disabled=false;}
    document.getElementById('lg-err').textContent =
      'Your account is not authorized. Contact the chapter admin to be granted access.';
    return;
  }

  // Role comes strictly from Firestore — no unsafe default
  const role = userProfile.role || 'viewer';
  const displayName = userProfile.name || firebaseUser.displayName || firebaseUser.email.split('@')[0];
  const title = userProfile.title || (role==='admin'?'President':role==='exec'?'Officer':'Member');

  CURRENT_USER = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    name: displayName,
    title,
    role,
    mid: userProfile.memberId || null,
    lastLogin: userProfile.lastLogin || null,
  };

  // Update last login in Firestore (non-critical — silent on failure)
  try{
    if(_db && _fbFns){
      const {doc,setDoc} = _fbFns;
      await setDoc(doc(_db,'users',firebaseUser.uid),
        {lastLogin:new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})},
        {merge:true});
    }
  }catch(e){ /* non-critical */ }

  // Show the app
  const appNav=document.getElementById('app-nav');
  const appMain=document.getElementById('app-main');
  if(appNav) appNav.style.display='flex';
  if(appMain) appMain.style.display='flex';

  // Update sidebar user display
  const ini = displayName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()||'?';
  document.getElementById('u-av').textContent = ini;
  document.getElementById('u-name').textContent = displayName;
  document.getElementById('u-role').textContent = title;
  document.getElementById('tb-av').textContent = ini;

  rbacApplySidebar();
}

// ── LOGOUT ──
async function lgLogout(){
  _unsubs.forEach(u=>u());_unsubs=[];
  if(window._fbAuth && window._fbFns){
    try{ await window._fbFns.signOut(window._fbAuth); }catch(e){}
  }
  CURRENT_USER = null;
  location.reload();
}

// ── INACTIVITY TIMEOUT ──
function lgResetTimer(){
  if(!CURRENT_USER) return;
  clearTimeout(_inactTimer);
  _inactTimer = setTimeout(()=>{
    lgLogout();
  }, TIMEOUT_MS);
}
['mousemove','keydown','click','scroll'].forEach(ev=>document.addEventListener(ev,lgResetTimer,{passive:true}));

function lgTimeOfDay(){
  const h = new Date().getHours();
  if(h < 12) return 'morning';
  if(h < 17) return 'afternoon';
  return 'evening';
}

function getSemester(){
  const m=new Date().getMonth();
  return m>=7&&m<=11?'Fall '+new Date().getFullYear():'Spring '+new Date().getFullYear();
}

// ── SETTINGS: show Firebase users from Firestore ──
async function seRenderUsers(){
  const el=document.getElementById('se-users');if(!el)return;
  el.innerHTML=`<div style="font-size:11.5px;color:var(--mt);padding:9px 0">Logged in as <strong>${CURRENT_USER?.email||'—'}</strong><br>Role: <strong>${CURRENT_USER?.role||'—'}</strong> · ${CURRENT_USER?.title||'—'}</div>
  <div style="font-size:11px;color:var(--ht);margin-top:6px">User accounts are managed in Firebase Authentication. Roles are stored in Firestore users/{uid}.</div>`;
}

// ── OFFLINE DETECTION ──
window.addEventListener('online', ()=>{
  document.getElementById('offline-banner').classList.remove('show');
  toast('Back online — syncing changes…','success',3000);
  // Re-save to flush any locally-cached changes
  saveD();
});
window.addEventListener('offline', ()=>{
  document.getElementById('offline-banner').classList.add('show');
});
// Set initial state on load
if(!navigator.onLine){
  document.getElementById('offline-banner').classList.add('show');
}

// ── INIT ──
async function init(){
  const gate = document.getElementById('login-gate');
  const authLoading = document.getElementById('auth-loading');

  // ── DEMO MODE: completely bypass Firebase, show login immediately ──
  if(window._IS_DEMO){
    dDefaults(); // ensure D is initialised
    if(authLoading){ authLoading.classList.add('hidden'); setTimeout(()=>authLoading.remove(),400); }
    gate.style.display = 'flex';
    document.getElementById('lg-loading').style.display = 'none';
    const lgBtn = document.getElementById('lg-btn');
    if(lgBtn){ lgBtn.style.display='block'; lgBtn.textContent='Sign In'; lgBtn.disabled=false; }
    document.querySelectorAll('.lg-fld').forEach(el=>el.style.display='');
    setTimeout(()=>{ const u=document.getElementById('lg-user'); if(u)u.focus(); },150);
    return; // ← never touches onAuthStateChanged
  }

  // ── LIVE MODE: Firebase path ──
  gate.style.display = 'none';
  document.getElementById('lg-loading').style.display = 'none';
  document.querySelectorAll('.lg-fld').forEach(el=>el.style.display='none');

  // Wait for Firebase SDK to signal ready
  await new Promise(resolve=>{
    if(window._fbReady){ resolve(); return; }
    document.addEventListener('firebase-ready', resolve, {once:true});
    setTimeout(resolve, 6000); // hard fallback
  });

  _db = window._fbDb;
  _fbFns = window._fbFns;
  _fbAuth = window._fbAuth;

  // Guard: if Firebase still not ready (e.g. ad-blocker, network error), show login
  if(!_fbAuth || !_fbFns){
    if(authLoading){ authLoading.classList.add('hidden'); setTimeout(()=>authLoading.remove(),400); }
    gate.style.display = 'flex';
    document.getElementById('lg-loading').style.display = 'none';
    const lgBtn = document.getElementById('lg-btn');
    if(lgBtn){ lgBtn.style.display='block'; lgBtn.textContent='Sign In'; lgBtn.disabled=false; }
    document.querySelectorAll('.lg-fld').forEach(el=>el.style.display='');
    document.getElementById('lg-err').textContent = 'Firebase unavailable. Set _IS_DEMO=true for offline demo.';
    return;
  }

  loadDCache();

  // Safe Firebase auth observer
  _fbFns.onAuthStateChanged(_fbAuth, async (firebaseUser)=>{
    if(authLoading){ authLoading.classList.add('hidden'); setTimeout(()=>authLoading.remove(),400); }

    if(firebaseUser){
      _firebaseConfirmed = true;
      const btn = document.getElementById('lg-btn');
      if(btn){btn.textContent='Sign In';btn.disabled=false;}
      await loadD();
      startRealtimeSync();
      await lgApplyUser(firebaseUser);
      gate.classList.add('fade-out');
      setTimeout(()=>{gate.style.display='none';},360);
      const now=new Date();const sem=getSemester();
      document.getElementById('tb-date').textContent=now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' · '+sem;
      const sbSem=document.getElementById('sb-sem');if(sbSem)sbSem.textContent='Acme Corp · '+sem;
      const ned=document.getElementById('ne-d');if(ned)ned.value=now.toISOString().split('T')[0];
      const mnd=document.getElementById('mn-d');if(mnd)mnd.value=now.toISOString().split('T')[0];
      renderDash();updateBadges();lgResetTimer();
    } else {
      _firebaseConfirmed = true;
      CURRENT_USER = null;
      const appNav=document.getElementById('app-nav');
      const appMain=document.getElementById('app-main');
      if(appNav)appNav.style.display='none';
      if(appMain)appMain.style.display='none';
      gate.style.display='flex';
      document.getElementById('lg-loading').style.display='none';
      const lgBtn = document.getElementById('lg-btn');
      if(lgBtn){lgBtn.style.display='block';lgBtn.textContent='Sign In';lgBtn.disabled=false;}
      document.querySelectorAll('.lg-fld').forEach(el=>el.style.display='');
      setTimeout(()=>{ const u=document.getElementById('lg-user');if(u)u.focus(); },100);
    }
  });
}

// ══════════════════════════════════════════════
// DEMO DATA LAYER
// Populates the platform with realistic sample data
// for portfolio / showcase purposes.
// In production, all data comes from Firestore.
// ══════════════════════════════════════════════

/**
 * Injects realistic demo data into the in-memory D store.
 * Called when Firebase is unavailable (demo/offline mode).
 */
function injectDemoData() {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  const rel = (days) => fmt(new Date(today.getTime() + days * 86400000));

  D.members = [
    {id:'m1', name:'Alex Carter',    initials:'AC', role:'President',          year:2024, classYear:'Senior',   liveIn:true},
    {id:'m2', name:'Jordan Lee',     initials:'JL', role:'Vice President',     year:2025, classYear:'Junior',   liveIn:true},
    {id:'m3', name:'Taylor Morgan',  initials:'TM', role:'Executive Secretary',year:2025, classYear:'Junior',   liveIn:false},
    {id:'m4', name:'Chris Bennett',  initials:'CB', role:'Treasurer',          year:2026, classYear:'Sophomore', liveIn:false},
    {id:'m5', name:'Riley Hayes',    initials:'RH', role:'Operations Director', year:2024, classYear:'Senior',   liveIn:true},
    {id:'m6', name:'Morgan Ellis',   initials:'ME', role:'Academic Chair',     year:2026, classYear:'Sophomore', liveIn:false},
    {id:'m7', name:'Quinn Adams',    initials:'QA', role:'Talent Acquisition Lead',year:2025,classYear:'Junior',liveIn:true},
    {id:'m8', name:'Avery Thompson', initials:'AT', role:'Community Outreach Lead',year:2026,classYear:'Sophomore',liveIn:false},
    {id:'m9', name:'Sam Rivera',     initials:'SR', role:'Team Member',        year:2026, classYear:'Sophomore', liveIn:false},
    {id:'m10',name:'Drew Walker',    initials:'DW', role:'Team Member',        year:2025, classYear:'Junior',   liveIn:true},
    {id:'m11',name:'Jamie Foster',   initials:'JF', role:'Team Member',        year:2026, classYear:'Sophomore', liveIn:false},
    {id:'m12',name:'Casey Kim',      initials:'CK', role:'Team Member',        year:2024, classYear:'Senior',   liveIn:true},
    {id:'m13',name:'Parker Nguyen',  initials:'PN', role:'Team Member',        year:2027, classYear:'Freshman', liveIn:false},
    {id:'m14',name:'Blake Okafor',   initials:'BO', role:'Team Member',        year:2025, classYear:'Junior',   liveIn:true},
    {id:'m15',name:'Reese Sullivan', initials:'RS', role:'Team Member',        year:2027, classYear:'Freshman', liveIn:false},
  ];

  D.events = [
    {id:'e1',  title:'All-Hands Meeting',        type:'chapter',      date:rel(-21), start:'7:00 PM', location:'Main Conference Room', mandatory:true},
    {id:'e2',  title:'Q3 Planning Session',       type:'exec',         date:rel(-14), start:'6:00 PM', location:'Executive Suite',       mandatory:true},
    {id:'e3',  title:'Community Service Day',     type:'philanthropy', date:rel(-10), start:'9:00 AM', location:'City Park',             mandatory:false},
    {id:'e4',  title:'Team Building Retreat',     type:'teambuilding', date:rel(-7),  start:'11:00 AM',location:'Retreat Center',        mandatory:false},
    {id:'e5',  title:'Recruitment Info Night',    type:'recruitment',  date:rel(-3),  start:'7:30 PM', location:'Atrium Hall',           mandatory:true},
    {id:'e6',  title:'Weekly All-Hands',          type:'chapter',      date:rel(2),   start:'7:00 PM', location:'Main Conference Room',  mandatory:true},
    {id:'e7',  title:'Finance Review',            type:'exec',         date:rel(5),   start:'5:30 PM', location:'Executive Suite',       mandatory:false},
    {id:'e8',  title:'Leadership Workshop',       type:'chapter',      date:rel(9),   start:'4:00 PM', location:'Training Room B',       mandatory:false},
    {id:'e9',  title:'Networking Mixer',          type:'philanthropy', date:rel(12),  start:'6:00 PM', location:'Rooftop Lounge',        mandatory:false},
    {id:'e10', title:'Recruitment Final Round',   type:'recruitment',  date:rel(16),  start:'7:00 PM', location:'Atrium Hall',           mandatory:true},
    {id:'e11', title:'Q4 Kickoff Meeting',        type:'chapter',      date:rel(21),  start:'7:00 PM', location:'Main Conference Room',  mandatory:true},
    {id:'e12', title:'Annual Gala Planning',      type:'philanthropy', date:rel(28),  start:'6:30 PM', location:'Ballroom A',            mandatory:false},
  ];

  // Attendance for past mandatory events
  const buildAtt = (eventId, overrides={}) => {
    const att = {};
    D.members.forEach(m => { att[m.id] = 'present'; });
    Object.assign(att, overrides);
    return att;
  };
  D.attendance = {
    'e1': buildAtt('e1', {'m13':'absent','m15':'excused'}),
    'e2': buildAtt('e2', {'m9':'absent','m11':'absent'}),
    'e3': buildAtt('e3', {'m13':'absent','m15':'absent','m9':'excused'}),
    'e5': buildAtt('e5', {'m15':'absent'}),
  };

  D.tasks = [
    {id:'t1',title:'Submit Q3 budget report',assignedTo:'m4',priority:'urgent',status:'done',dueDate:rel(-5),desc:'Compile all expense data and submit to leadership.'},
    {id:'t2',title:'Update member roster in Firestore',assignedTo:'m3',priority:'high',status:'done',dueDate:rel(-2),desc:'Sync new member additions with database.'},
    {id:'t3',title:'Finalize recruitment event agenda',assignedTo:'m7',priority:'high',status:'inprogress',dueDate:rel(1),desc:'Coordinate speakers and logistics for info night.'},
    {id:'t4',title:'Draft leadership workshop curriculum',assignedTo:'m2',priority:'medium',status:'inprogress',dueDate:rel(4),desc:'Create 3-module curriculum for Q4 workshop series.'},
    {id:'t5',title:'Send community service summary report',assignedTo:'m8',priority:'medium',status:'todo',dueDate:rel(6),desc:'Summarize volunteer hours and send to org leadership.'},
    {id:'t6',title:'Plan Q4 team building event',assignedTo:'m5',priority:'medium',status:'todo',dueDate:rel(10),desc:'Research venues and get quotes for the retreat.'},
    {id:'t7',title:'Update alumni contact database',assignedTo:'m3',priority:'low',status:'todo',dueDate:rel(14),desc:'Add new contacts from recent networking event.'},
    {id:'t8',title:'Prepare annual gala sponsorship deck',assignedTo:'m1',priority:'high',status:'inprogress',dueDate:rel(3),desc:'Create pitch deck for corporate sponsors.'},
    {id:'t9',title:'Review compliance case CR-012',assignedTo:'m1',priority:'urgent',status:'todo',dueDate:rel(-1),desc:'OVERDUE: Review outstanding compliance case.'},
    {id:'t10',title:'Onboard three new team members',assignedTo:'m2',priority:'high',status:'todo',dueDate:rel(7),desc:'Schedule orientation sessions and assign mentors.'},
  ];

  D.goals = [
    {id:'g1',title:'Recruitment Target — New Members',category:'recruitment',target:20,current:14,unit:'members'},
    {id:'g2',title:'Attendance Rate',category:'operations',target:90,current:82,unit:'%'},
    {id:'g3',title:'Community Service Hours',category:'community',target:500,current:347,unit:'hrs'},
    {id:'g4',title:'Funds Raised — Annual Gala',category:'finance',target:10000,current:3800,unit:'$'},
    {id:'g5',title:'Task Completion Rate',category:'operations',target:85,current:72,unit:'%'},
  ];

  D.notes = [
    {
      id:'n1', title:'Weekly All-Hands — ' + rel(-7), type:'Chapter',
      date:rel(-7), chapter:'OpsCore — Nexus Chapter',
      announcements:'Q3 budget approved. New SOP templates distributed to all officers.',
      oldBusiness:'Community service day recap: 347 hours logged across 12 volunteers.',
      newBusiness:'Annual gala planning kickoff — committee assignments finalized. Recruitment final round scheduled.',
      ooh:'Remote members to dial in via Teams for Q4 kickoff.',
      botw:'Jordan Lee — exceptional leadership on Q3 planning session.',
      buffon:'',
      actions:['Submit sponsorship deck by EOW','Confirm venue for team building retreat','Follow up with 3 recruitment prospects'],
      officerReports:[
        {role:'Vice President',name:'Jordan Lee',notes:'Q4 roadmap drafted. Leadership workshop curriculum in progress.'},
        {role:'Treasurer',name:'Chris Bennett',notes:'Q3 budget report submitted. On track for Q4 targets.'},
        {role:'Operations Director',name:'Riley Hayes',notes:'Event Safety schedule published for all upcoming events.'},
      ],
      body:'Announcements: Q3 budget approved | Old Business: Community service recap | New Business: Gala planning, recruitment round'
    },
    {
      id:'n2', title:'Executive Committee — ' + rel(-14), type:'Exec',
      date:rel(-14), chapter:'OpsCore — Nexus Chapter',
      announcements:'Annual gala date confirmed. Sponsorship outreach begins next week.',
      oldBusiness:'Recruitment strategy review — pipeline at 14/20. Conversion rate: 68%.',
      newBusiness:'Compliance case CR-011 resolved. New compliance policy drafted for review.',
      ooh:'', botw:'', buffon:'',
      actions:['Distribute policy draft for member review','Begin sponsor outreach'],
      officerReports:[],
      body:'Exec meeting: gala confirmed, recruitment pipeline update, compliance case resolved'
    },
  ];

  D.cases = [
    {id:'c1',caseNum:'CR-010',type:'Policy Violation',member:'m9',desc:'Failure to complete mandatory volunteer hours for Q3. Member notified via email. Resolution pending follow-up.',status:'resolved',hearingDate:rel(-10),resolution:'Completed makeup hours on Sep 28. Case closed.',filedBy:'m1'},
    {id:'c2',caseNum:'CR-011',type:'Conduct Review',member:'m11',desc:'Disruptive behavior during leadership workshop. Formal warning issued.',status:'resolved',hearingDate:rel(-5),resolution:'Formal warning issued. Member acknowledged and signed conduct agreement.',filedBy:'m2'},
    {id:'c3',caseNum:'CR-012',type:'Policy Violation',member:'m13',desc:'Three consecutive unexcused absences from mandatory all-hands meetings. Review required.',status:'open',hearingDate:rel(3),resolution:'',filedBy:'m3'},
  ];

  D.shifts = [
    {id:'s1',event:'Recruitment Info Night',date:rel(-3),start:'6:30 PM',end:'10:00 PM',memberId:'m5',confirmed:true,noShow:false},
    {id:'s2',event:'Recruitment Info Night',date:rel(-3),start:'6:30 PM',end:'10:00 PM',memberId:'m10',confirmed:true,noShow:false},
    {id:'s3',event:'Weekly All-Hands',date:rel(2),start:'6:30 PM',end:'9:30 PM',memberId:'m14',confirmed:true,noShow:false},
    {id:'s4',event:'Weekly All-Hands',date:rel(2),start:'6:30 PM',end:'9:30 PM',memberId:null,confirmed:false,noShow:false},
    {id:'s5',event:'Recruitment Final Round',date:rel(16),start:'6:30 PM',end:'10:30 PM',memberId:'m5',confirmed:false,noShow:false},
    {id:'s6',event:'Recruitment Final Round',date:rel(16),start:'6:30 PM',end:'10:30 PM',memberId:null,confirmed:false,noShow:false},
  ];

  D.committees = [
    {id:'co1',name:'Finance Committee',desc:'Oversees budget management, dues collection, and financial reporting.',chair:'m4',members:['m4','m12','m9']},
    {id:'co2',name:'Recruitment Committee',desc:'Manages prospect pipeline, events, and new member onboarding.',chair:'m7',members:['m7','m10','m13','m15']},
    {id:'co3',name:'Community Outreach Committee',desc:'Coordinates service events, fundraising, and nonprofit partnerships.',chair:'m8',members:['m8','m11','m6']},
    {id:'co4',name:'Leadership Development Committee',desc:'Plans professional development sessions and mentorship programs.',chair:'m2',members:['m2','m6','m14']},
  ];

  D.academics = {
    gpas: {
      m1:{cumulativeGpa:'3.75',priorGpa:'3.70',major:'Management Information Systems'},
      m2:{cumulativeGpa:'3.60',priorGpa:'3.55',major:'Business Analytics'},
      m3:{cumulativeGpa:'3.45',priorGpa:'3.40',major:'Supply Chain Management'},
      m4:{cumulativeGpa:'3.80',priorGpa:'3.78',major:'Finance'},
      m5:{cumulativeGpa:'3.20',priorGpa:'3.15',major:'Operations Management'},
      m6:{cumulativeGpa:'3.90',priorGpa:'3.88',major:'Computer Science'},
      m7:{cumulativeGpa:'3.35',priorGpa:'3.30',major:'Marketing'},
      m8:{cumulativeGpa:'3.55',priorGpa:'3.50',major:'Communications'},
      m9:{cumulativeGpa:'2.90',priorGpa:'2.85',major:'Business Administration'},
      m10:{cumulativeGpa:'3.15',priorGpa:'3.10',major:'Accounting'},
      m11:{cumulativeGpa:'2.75',priorGpa:'2.70',major:'Economics'},
      m12:{cumulativeGpa:'3.65',priorGpa:'3.60',major:'Data Science'},
      m13:{cumulativeGpa:'3.00',priorGpa:'2.95',major:'Information Systems'},
      m14:{cumulativeGpa:'3.40',priorGpa:'3.35',major:'Project Management'},
      m15:{cumulativeGpa:'2.85',priorGpa:'2.80',major:'Organizational Behavior'},
    },
    history:[]
  };

  D.recruitment = {
    goal:{target:20,label:'New Members This Cycle'},
    rushees:[
      {id:'r1',name:'Tyler Brooks',major:'Business Admin',gpa:'3.4',hometown:'Chicago, IL',stage:'Bid Extended',bidScore:88,notes:'Excellent leadership background. Strong culture fit.',assignedTo:'m7',events:['e5'],tags:['leadership','finance']},
      {id:'r2',name:'Mackenzie Stone',major:'Computer Science',gpa:'3.8',hometown:'Austin, TX',stage:'Final Interview',bidScore:91,notes:'Top prospect. Developer background aligns with tech committee needs.',assignedTo:'m10',events:['e5'],tags:['tech','analytics']},
      {id:'r3',name:'Jordan Patel',major:'Finance',gpa:'3.5',hometown:'Detroit, MI',stage:'Offer Accepted',bidScore:84,notes:'Strong finance background. Will join Finance Committee.',assignedTo:'m7',events:['e5','e10'],tags:['finance']},
      {id:'r4',name:'Avery Collins',major:'MIS',gpa:'3.2',hometown:'Seattle, WA',stage:'First Contact',bidScore:72,notes:'Met at networking event. Interested in analytics role.',assignedTo:'m13',events:['e5'],tags:['tech']},
      {id:'r5',name:'Cameron Walsh',major:'Marketing',gpa:'3.1',hometown:'Boston, MA',stage:'Screening',bidScore:68,notes:'Good communicator. Needs follow-up after info night.',assignedTo:'m15',events:['e5'],tags:['marketing']},
      {id:'r6',name:'Riley Cheng',major:'Economics',gpa:'3.6',hometown:'San Francisco, CA',stage:'Offer Accepted',bidScore:87,notes:'Exceptional analytical skills. Referred by alumni.',assignedTo:'m7',events:['e5','e10'],tags:['analytics','finance']},
    ],
    events:[
      {id:'re1',title:'Information Night',date:rel(-3),location:'Atrium Hall',type:'info',attendees:34},
      {id:'re2',title:'Coffee Chat Series',date:rel(-8),location:'Campus Café',type:'social',attendees:18},
      {id:'re3',title:'Final Round Interviews',date:rel(16),location:'Atrium Hall',type:'interview',attendees:0},
    ]
  };

  D.philanthropy = {
    goals:[
      {id:'phg1',label:'Total Service Hours',target:500,unit:'hrs'},
      {id:'phg2',label:'Service Events',target:6,unit:'events'},
      {id:'phg3',label:'Avg Hours / Member',target:4,unit:'hrs'},
      {id:'phg4',label:'Fundraising Events',target:4,unit:'events'},
      {id:'phg5',label:'Total Funds Raised',target:10000,unit:'$'}
    ],
    events:[
      {id:'ph1',title:'City Park Cleanup',date:rel(-10),hours:4,participants:12,category:'service'},
      {id:'ph2',title:'Food Bank Volunteer Day',date:rel(-28),hours:3,participants:9,category:'service'},
    ],
    hours:[
      {id:'ph1',memberId:'m1',event:'ph1',hours:4},
      {id:'ph2',memberId:'m2',event:'ph1',hours:4},
      {id:'ph3',memberId:'m8',event:'ph1',hours:4},
    ],
    funds:[
      {id:'f1',label:'Annual Gala Ticket Sales',amount:2200,date:rel(-15)},
      {id:'f2',label:'Corporate Sponsorship — Acme Corp',amount:1600,date:rel(-8)},
    ]
  };

  D.alumni = {
    contacts:[
      {id:'a1',name:'Marcus Webb',classYear:'2018',employer:'McKinsey & Company',title:'Senior Associate',location:'Chicago, IL',email:'marcus.webb@example.com',engagement:'Active',notes:'Spoke at last leadership workshop. Available for mentorship.'},
      {id:'a2',name:'Priya Nair',classYear:'2016',employer:'Google',title:'Product Manager',location:'Mountain View, CA',email:'priya.nair@example.com',engagement:'Active',notes:'Assists with tech recruitment referrals.'},
      {id:'a3',name:'David Kim',classYear:'2020',employer:'Deloitte',title:'Consultant',location:'New York, NY',email:'david.kim@example.com',engagement:'Moderate',notes:'Connected on LinkedIn. Interested in gala sponsorship.'},
    ],
    events:[
      {id:'ae1',title:'Alumni Networking Mixer',date:rel(12),location:'Rooftop Lounge',rsvps:22},
    ],
    outreach:[]
  };

  D.finance = {
    dues: Object.fromEntries(D.members.map(m=>([m.id,{amount: m.liveIn?5050:450, paid: m.id!='m13'&&m.id!='m15', paidDate: m.id!='m13'&&m.id!='m15'?rel(-30):null}]))),
    fines:[
      {id:'f1',memberId:'m9',amount:25,reason:'Missed mandatory all-hands (unexcused)',date:rel(-20),status:'paid'},
      {id:'f2',memberId:'m13',amount:25,reason:'Missed mandatory all-hands (unexcused)',date:rel(-15),status:'unpaid'},
      {id:'f3',memberId:'m15',amount:25,reason:'Missed mandatory all-hands (unexcused)',date:rel(-12),status:'unpaid'},
    ],
    expenses:[
      {id:'ex1',category:'Operations',description:'Event supplies — all-hands Q3',amount:180,date:rel(-21),paidBy:'m4'},
      {id:'ex2',category:'Recruitment',description:'Info night catering & decorations',amount:420,date:rel(-3),paidBy:'m4'},
      {id:'ex3',category:'Community',description:'Park cleanup supplies',amount:85,date:rel(-10),paidBy:'m8'},
      {id:'ex4',category:'Leadership',description:'Workshop materials & printing',amount:95,date:rel(-14),paidBy:'m2'},
    ],
    plans:[],
    payments:[],
    nationalDues:{},
    nationalPayments:[],
    budget:{Operations:2000,Recruitment:1500,Community:800,Leadership:600,Social:1000,Events:1200}
  };

  D.files = [
    {id:'fi1',name:'Q3 Budget Report.pdf',folder:'Finance',size:'1.2 MB',date:rel(-5),uploadedBy:'m4',url:'#'},
    {id:'fi2',name:'Recruitment Strategy Deck.pptx',folder:'Recruitment',size:'3.4 MB',date:rel(-14),uploadedBy:'m7',url:'#'},
    {id:'fi3',name:'Community Service Summary.docx',folder:'Community Outreach',size:'0.8 MB',date:rel(-10),uploadedBy:'m8',url:'#'},
    {id:'fi4',name:'Leadership Workshop Curriculum.pdf',folder:'Leadership Development',size:'2.1 MB',date:rel(-7),uploadedBy:'m2',url:'#'},
    {id:'fi5',name:'Annual Gala Sponsorship Deck.pptx',folder:'Events',size:'4.7 MB',date:rel(-2),uploadedBy:'m1',url:'#'},
    {id:'fi6',name:'Member Handbook v4.pdf',folder:'Operations',size:'1.5 MB',date:rel(-60),uploadedBy:'m3',url:'#'},
  ];

  D.notifs = [];

  D.transitions = [
    {id:'tr1',role:'Treasurer',outgoing:'m4',incoming:null,content:'Q3 budget templates, dues tracking sheet, vendor contacts. Handoff meeting scheduled for end of term.',status:'in_progress'},
    {id:'tr2',role:'Talent Acquisition Lead',outgoing:'m7',incoming:null,content:'Recruitment pipeline in CRM, event playbooks, prospect scoring rubric.',status:'not_started'},
  ];

  D.playbooks = [
    {id:'p1',title:'All-Hands Meeting SOP',owner:'m3',purpose:'Standard procedure for running weekly all-hands meetings.',steps:['Send agenda 48h prior','Confirm AV setup','Take attendance at door','Record officer reports','Send meeting notes within 24h'],lastUpdated:rel(-14)},
    {id:'p2',title:'Recruitment Event Playbook',owner:'m7',purpose:'Step-by-step guide for hosting recruitment info nights.',steps:['Book venue 3 weeks out','Design event flyer','Set up CRM prospect tracking','Assign greeters & hosts','Collect interest forms','Follow up within 48h'],lastUpdated:rel(-21)},
  ];

  D.settings = {
    name:'', year:'', classYear:'Senior',
    notifAttendance:true, notifTasks:true, notifSober:true, notifWeekly:true,
    chapterName:'Nexus Chapter',
    university:'State University',
    chapterSize:'15',
    chapterFounded:'2018'
  };
}

// ── DEMO MODE ENTRY POINT ──
// Called when _IS_DEMO=true and user clicks Sign In.
// Loads all demo data and shows the full application — no Firebase needed.
function enterDemoMode() {
  // 1. Inject realistic sample data into the in-memory D store
  injectDemoData();

  // 2. Create a fake logged-in admin user
  CURRENT_USER = {
    uid: 'demo_user',
    email: 'demo@opscore.app',
    displayName: 'Alex Carter',
    mid: 'm1',
    name: 'Alex Carter',
    role: 'admin',
    title: 'President',
    access: 'admin'
  };

  // 3. Hide auth loading overlay (may still be visible)
  const authLoading = document.getElementById('auth-loading');
  if(authLoading){ authLoading.classList.add('hidden'); setTimeout(()=>authLoading.remove(),400); }

  // 4. Hide login gate, show app shell
  const gate = document.getElementById('login-gate');
  const appNav = document.getElementById('app-nav');
  const appMain = document.getElementById('app-main');
  if(gate){ gate.classList.add('fade-out'); setTimeout(()=>{ gate.style.display='none'; }, 360); }
  if(appNav){ appNav.style.display=''; appNav.style.removeProperty('display'); appNav.removeAttribute('style'); appNav.style.display='flex'; }
  if(appMain){ appMain.style.display=''; appMain.style.removeProperty('display'); appMain.removeAttribute('style'); appMain.style.display='flex'; }

  // 5. Populate topbar date + semester
  const now = new Date();
  const sem = getSemester();
  const tbDate = document.getElementById('tb-date');
  if(tbDate) tbDate.textContent = now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' · '+sem;
  const sbSem = document.getElementById('sb-sem');
  if(sbSem) sbSem.textContent = 'Acme Corp · ' + sem;

  // 6. Set default date fields
  const today = now.toISOString().split('T')[0];
  const ned = document.getElementById('ne-d'); if(ned) ned.value = today;
  const mnd = document.getElementById('mn-d'); if(mnd) mnd.value = today;

  // 7. Apply user avatar + name to sidebar and topbar
  const ini = 'AC';
  const uAv = document.getElementById('u-av'); if(uAv) uAv.textContent = ini;
  const uName = document.getElementById('u-name'); if(uName) uName.textContent = 'Alex Carter';
  const uRole = document.getElementById('u-role'); if(uRole) uRole.textContent = 'President';
  const tbAv = document.getElementById('tb-av'); if(tbAv) tbAv.textContent = ini;

  // 8. Apply RBAC sidebar visibility
  rbacApplySidebar();

  // 9. Render the dashboard and update alert badges
  renderDash();
  updateBadges();

  // 10. Start inactivity timer
  lgResetTimer();
}

// Legacy alias kept for compatibility
function lgApplyUserDemo() {
  const ini = 'AC';
  const uAv = document.getElementById('u-av'); if(uAv) uAv.textContent = ini;
  const uName = document.getElementById('u-name'); if(uName) uName.textContent = 'Alex Carter';
  const uRole = document.getElementById('u-role'); if(uRole) uRole.textContent = 'President';
  const tbAv = document.getElementById('tb-av'); if(tbAv) tbAv.textContent = ini;
  rbacApplySidebar();
}

// ── PAGE RENDER DISPATCHER ──
// Maps each page name to its render function.
// Called by nav() in utils.js as: R[page] && R[page]()
// Defined here (last file to load) so all render functions from dashboard.js,
// calendar.js, tasks.js, members.js, and app.js are guaranteed to exist.
const R = {
  dashboard:     renderDash,
  attendance:    renderAttendance,
  finance:       renderFinance,
  calendar:      renderCalendar,
  tasks:         renderTasks,
  notes:         renderNotes,
  judicial:      renderJudicial,
  sober:         renderSober,
  members:       renderMembers,
  recruitment:   renderRecruitment,
  academics:     renderAcademics,
  committees:    renderCommittees,
  analytics:     renderAnalytics,
  files:         renderFiles,
  transition:    renderTransition,
  settings:      renderSettings,
  philanthropy:  renderPhilanthropy,
  alumni:        renderAlumni,
  ritual:        renderRitual,
  healthscore:   renderHealthScore,
  notifications: renderNotifications,
};

init();
