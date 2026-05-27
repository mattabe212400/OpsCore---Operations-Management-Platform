// ══════════════════════════════════════════════
// app.js
// Main application entry: Firebase/localStorage data sync, all page render functions
// for Files, Notifications, Transition Hub, Academics, Recruitment CRM, Finance,
// Settings, Philanthropy, Alumni, Ritual, Vendors, Health Scorecard, Playbooks,
// Attendance, and the Global Search system.
//
// Load order in index.html:
//   firebase-config.js → utils.js → auth.js → dashboard.js → calendar.js
//   → tasks.js → members.js → app.js
//
// The global D object is the single source of truth for all rendered data.
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// FIREBASE DATA LAYER
// ══════════════════════════════════════════════

const LS_CACHE = 'opscore_v1_cache'; // Portfolio demo cache key // localStorage key for offline cache only
let D = {}; // in-memory data store — always the truth for renders
let _db = null;   // Firestore instance (set after firebase-ready)
let _fbFns = null; // Firestore functions
let _unsubs = []; // active onSnapshot unsubscribers

// ── Default structure for empty collections ──
function dDefaults(){
  if(!D.members)D.members=[];
  if(!D.events)D.events=[];
  if(!D.tasks)D.tasks=[];
  if(!D.goals)D.goals=[];
  if(!D.notes)D.notes=[];
  if(!D.cases)D.cases=[];
  if(!D.shifts)D.shifts=[];
  if(!D.files)D.files=[];
  if(!D.notifs)D.notifs=[];
  if(!D.committees)D.committees=[];
  if(!D.transitions)D.transitions=[];
  if(!D.attendance)D.attendance={};
  if(!D.academics)D.academics={gpas:{},history:[]};
  if(!D.finance)D.finance={dues:{},fines:[],expenses:[],plans:[],payments:[],nationalDues:{},nationalPayments:[],budget:{Social:0,Recruitment:0,Philanthropy:0,House:0,'Team Building':0,Operations:0,Risk:0}};
  if(!D.finance.budget)D.finance.budget={};
  if(!D.finance.nationalDues)D.finance.nationalDues={};
  if(!D.finance.nationalPayments)D.finance.nationalPayments=[];
  if(!D.recruitment)D.recruitment={rushees:[],events:[],goal:{target:20,label:'New Members This Semester'}};
  if(!D.recruitment.rushees)D.recruitment.rushees=[];
  if(!D.recruitment.events)D.recruitment.events=[];
  if(!D.recruitment.goal)D.recruitment.goal={target:20,label:'New Members This Semester'};
  if(!D.philanthropy)D.philanthropy={events:[],hours:[],funds:[],goals:[
    {id:'phg1',label:'Total Service Hours',target:500,unit:'hrs'},
    {id:'phg2',label:'Service Events',target:6,unit:'events'},
    {id:'phg3',label:'Avg Hours / Member',target:4,unit:'hrs'},
    {id:'phg4',label:'Philanthropy Events',target:4,unit:'events'},
    {id:'phg5',label:'Total Funds Raised',target:2000,unit:'$'}
  ]};
  if(!D.philanthropy.funds)D.philanthropy.funds=[];
  if(!D.agenda)D.agenda={items:[],archived:[]};
  if(!D.alumni)D.alumni={contacts:[],events:[],outreach:[]};
  if(!D.ritual)D.ritual={items:[],sessions:[],nmProgress:{}};
  if(!D.vendors)D.vendors=[];
  if(!D.playbooks)D.playbooks=[];
  if(!D.transitionHub)D.transitionHub={deadlines:[],issues:[],archive:[]};
  if(!D.settings)D.settings={name:'',year:'',classYear:'Senior',notifAttendance:true,notifTasks:true,notifSober:true,notifWeekly:true,chapterName:'Nexus Chapter',university:'State University',chapterSize:'',chapterFounded:''};
}

// ── COLLECTION-BASED SAVE ──
// Collections stored as Firestore documents under a single chapter doc for simplicity.
// Layout: /settings/chapter (big doc with simple scalars),
//         /members/{id}, /events/{id}, /tasks/{id}, etc.

const FLAT_COLLECTIONS = [
  'members','events','tasks','goals','notes','attendance_data',
  'judicial_cases','sober_bros','recruitment','academics','committees',
  'philanthropy','alumni','ritual','files','transition','finance','notifs'
];

// Save entire D to localStorage as offline cache
function saveDCache(){
  try{localStorage.setItem(LS_CACHE,JSON.stringify(D));}catch(e){}
}

// Load D from localStorage cache (used before Firestore loads)
function loadDCache(){
  try{const c=localStorage.getItem(LS_CACHE);if(c){D=JSON.parse(c);}}catch{D={};}
  dDefaults();
}

// ── FIRESTORE: Save whole D as a single document per collection key ──
// We store everything in /chapters/nexus_chapter/{key} documents for simplicity.
// This avoids sub-collection complexity while supporting onSnapshot.
const FS_PATH = 'organizations'; // Firestore collection path
const FS_ID = 'demo_org'; // Firestore document ID

let _saveDPending = false;
let _saveDTimer = null;
let _saveDResolvers = [];
const _appStartTime = Date.now();
let _firebaseConfirmed = false; // set true once auth state resolves — errors before this are suppressed

async function saveD(){
  saveDCache(); // write to localStorage immediately, always

  // In demo mode or if no Firebase, resolve right away
  if(window._IS_DEMO || !_db || !_fbFns){
    return Promise.resolve();
  }

  // Return a promise that settles when the next Firestore write completes
  return new Promise((resolve, reject) => {
    _saveDResolvers.push({resolve, reject});

    // Debounce: cancel any pending timer and restart it
    // All resolvers queued so far will be flushed together in one write
    clearTimeout(_saveDTimer);
    _saveDTimer = setTimeout(_saveDFlush, 150);
  });
}

async function _saveDFlush(){
  // If a write is already in flight, reschedule — don't drop resolvers
  if(_saveDPending){
    clearTimeout(_saveDTimer);
    _saveDTimer = setTimeout(_saveDFlush, 200);
    return;
  }

  // Grab all waiting callers atomically
  const waiting = _saveDResolvers.splice(0);
  if(!waiting.length) return;

  _saveDPending = true;
  _saveInFlight = true;

  const {doc, setDoc} = _fbFns;
  try{
    await setDoc(doc(_db, FS_PATH, FS_ID), {
      members:      D.members||[],
      events:       D.events||[],
      tasks:        D.tasks||[],
      goals:        D.goals||[],
      notes:        D.notes||[],
      attendance:   D.attendance||{},
      cases:        D.cases||[],
      shifts:       D.shifts||[],
      files:        D.files||[],
      notifs:       D.notifs||[],
      committees:   D.committees||[],
      transitions:  D.transitions||[],
      academics:    D.academics||{gpas:{},history:[]},
      finance:      D.finance||{},
      recruitment:  D.recruitment||{rushees:[],events:[]},
      philanthropy: D.philanthropy||{events:[],hours:[],funds:[],goals:[]},
      agenda:       D.agenda||{items:[],archived:[]},
      alumni:       D.alumni||{contacts:[],events:[],outreach:[]},
      ritual:       D.ritual||{items:[],sessions:[],nmProgress:{}},
      vendors:      D.vendors||[],
      playbooks:    D.playbooks||[],
      transitionHub:D.transitionHub||{deadlines:[],issues:[],archive:[]},
      settings:     D.settings||{},
      updatedAt:    Date.now()
    });
    waiting.forEach(r => r.resolve());
  } catch(e){
    console.error('Firestore saveD error:', e.code, e.message);
    if(_firebaseConfirmed && (!_saveDLastErrToast || Date.now()-_saveDLastErrToast > 60000)){
      _saveDLastErrToast = Date.now();
      toast('Save failed: ' + (e.code || e.message || 'unknown error'), 'error', 8000);
    }
    waiting.forEach(r => r.reject(e));
  } finally {
    _saveDPending = false;
    setTimeout(()=>{ _saveInFlight = false; }, 800);
  }
}
let _saveDLastErrToast = 0;

async function loadD(){
  loadDCache(); // show cached data immediately
  if(!_db||!_fbFns) return;
  const {doc,getDoc} = _fbFns;
  try{
    const snap = await getDoc(doc(_db, FS_PATH, FS_ID));
    if(snap.exists()){
      const fd = snap.data();
      // Merge Firestore data into D
      Object.assign(D, fd);
      dDefaults();
      saveDCache();
    } else {
      // First time — initialize with defaults and push to Firestore
      dDefaults();
      await saveD();
    }
  } catch(e){
    console.warn('Firestore loadD error:', e.message);
    dDefaults();
    if(_firebaseConfirmed){
      toast('Could not reach the server — showing cached data. Changes will sync when reconnected.','error',6000);
    }
  }
}

// ── REAL-TIME LISTENER ──
let _saveInFlight = false; // true while our own saveD is writing
let _remoteRenderTimer = null;

function startRealtimeSync(){
  if(window._IS_DEMO) return; // no Firestore in demo mode
  if(!_db||!_fbFns) return;
  const {doc,onSnapshot} = _fbFns;
  // Stop any existing listeners
  _unsubs.forEach(u=>u());_unsubs=[];
  const unsub = onSnapshot(doc(_db, FS_PATH, FS_ID), (snap)=>{
    if(!snap.exists()) return;
    // Skip re-render if this snapshot was triggered by our own saveD()
    if(_saveInFlight) return;
    const fd = snap.data();
    Object.assign(D, fd);
    dDefaults();
    saveDCache();
    // Debounce remote re-renders to avoid rapid flicker from multi-field writes
    clearTimeout(_remoteRenderTimer);
    _remoteRenderTimer = setTimeout(()=>{
      const activePage = document.querySelector('.page.active');
      if(activePage){
        const pid = activePage.id.replace('page-','');
        if(R&&R[pid]) R[pid]();
      }
      updateBadges();
    }, 300);
  }, (err)=>{
    console.warn('onSnapshot error:', err.message);
    if(_firebaseConfirmed){
      toast('Real-time sync disconnected. Refresh to reconnect.','error',5000);
    }
  });
  _unsubs.push(unsub);
}

async function resetD(){
  if(!_db||!_fbFns){localStorage.removeItem(LS_CACHE);location.reload();return;}
  const {doc,deleteDoc} = _fbFns;
  try{
    await deleteDoc(doc(_db, FS_PATH, FS_ID));
  }catch(e){
    console.warn(e);
    toast('Reset failed — please try again.','error');
    return;
  }
  localStorage.removeItem(LS_CACHE);
  location.reload();
}

// Wire up Firebase once ready
document.addEventListener('firebase-ready', ()=>{
  _db = window._fbDb;
  _fbFns = window._fbFns;
});

async function addMem(){
  if(!canWrite()){toast('You do not have permission to add members.','error');return;}
  const name=document.getElementById('nm-n').value.trim();
  if(!name){toast('Name is required','error');return;}
  const ini=name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const member={id:uid(),name,year:+document.getElementById('nm-y').value,classYear:document.getElementById('nm-c').value,liveIn:document.getElementById('nm-l').value==='1',role:'Member',initials:ini};
  D.members.push(member);
  try{
    await saveD();
    closeM(null,document.getElementById('m-addmember'));document.getElementById('nm-n').value='';renderMembers();toast('Member added','success');
  }catch(e){
    D.members=D.members.filter(m=>m.id!==member.id);
    toast('Failed to add member. Please try again.','error');
  }
}
async function addEv(){
  if(!canWrite()){toast('You do not have permission to add events.','error');return;}
  const title=document.getElementById('ne-t').value.trim();
  if(!title){toast('Title is required','error');return;}
  const editId=document.getElementById('ne-edit-id')?.value;
  if(editId){
    const ev=D.events.find(e=>e.id===editId);
    if(!ev){toast('Event not found.','error');return;}
    // Snapshot for rollback
    const prev={title:ev.title,type:ev.type,date:ev.date,start:ev.start,location:ev.location,mandatory:ev.mandatory};
    ev.title=title;ev.type=document.getElementById('ne-tp').value;ev.date=document.getElementById('ne-d').value;ev.start=document.getElementById('ne-st').value;ev.location=document.getElementById('ne-l').value;ev.mandatory=document.getElementById('ne-m').value==='1';
    document.getElementById('ne-edit-id').value='';
    try{
      await saveD();
      closeM(null,document.getElementById('m-addevent'));renderCalendar();renderAttendance();renderDash();toast('Event updated','success');
    }catch(e){
      Object.assign(ev,prev);document.getElementById('ne-edit-id').value=editId;
      toast('Failed to save event. Please try again.','error');
    }
    return;
  }
  const ev={id:uid(),title,type:document.getElementById('ne-tp').value,date:document.getElementById('ne-d').value,start:document.getElementById('ne-st').value,location:document.getElementById('ne-l').value,mandatory:document.getElementById('ne-m').value==='1'};
  D.events.push(ev);
  try{
    await saveD();
    closeM(null,document.getElementById('m-addevent'));document.getElementById('ne-t').value='';renderCalendar();renderAttendance();renderDash();toast('Event created','success');
  }catch(e){
    D.events=D.events.filter(x=>x.id!==ev.id);
    toast('Failed to create event: '+(e.code||e.message||'unknown'),'error',8000);
  }
}
function openEditEvent(id){
  const ev=D.events.find(e=>e.id===id);if(!ev)return;
  if(!canWrite()){toast('You do not have permission to edit events.','error');return;}
  const m=document.getElementById('m-addevent');
  m.querySelector('.md-t').childNodes[0].textContent='Edit Event';
  document.getElementById('ne-t').value=ev.title;
  document.getElementById('ne-tp').value=ev.type||'chapter';
  document.getElementById('ne-d').value=ev.date;
  document.getElementById('ne-st').value=ev.start||'';
  document.getElementById('ne-l').value=ev.location||'';
  document.getElementById('ne-m').value=ev.mandatory?'1':'0';
  if(document.getElementById('ne-edit-id'))document.getElementById('ne-edit-id').value=id;
  m.classList.add('open');
}
async function deleteEvent(id){
  if(!canWrite()){toast('You do not have permission to delete events.','error');return;}
  const ok=await confirmDialog('Delete Event','Delete this event? Attendance records for it will also be removed.');
  if(!ok)return;
  const removed=D.events.find(e=>e.id===id);
  const removedAtt=D.attendance[id];
  D.events=D.events.filter(e=>e.id!==id);
  delete D.attendance[id];
  try{
    await saveD();
    document.getElementById('cal-detail').style.display='none';
    renderCalendar();renderAttendance();renderDash();toast('Event deleted','info');
  }catch(e){
    if(removed)D.events.push(removed);
    if(removedAtt)D.attendance[id]=removedAtt;
    toast('Failed to delete event. Please try again.','error');
  }
}
async function addTask(){
  if(!canWrite()){toast('You do not have permission to add tasks.','error');return;}
  const title=document.getElementById('nt-t').value.trim();
  if(!title){toast('Title is required','error');return;}
  const task={id:uid(),title,assignedTo:document.getElementById('nt-a').value,priority:document.getElementById('nt-p').value,status:document.getElementById('nt-s').value,dueDate:document.getElementById('nt-d').value,desc:document.getElementById('nt-ds').value};
  D.tasks.push(task);
  try{
    await saveD();
    closeM(null,document.getElementById('m-addtask'));document.getElementById('nt-t').value='';renderTasks();renderDash();toast('Task created','success');
  }catch(e){
    D.tasks=D.tasks.filter(t=>t.id!==task.id);
    toast('Failed to create task. Please try again.','error');
  }
}
async function addGoal(){
  if(!canWrite()){toast('You do not have permission to add goals.','error');return;}
  const title=document.getElementById('ng-t').value.trim();
  if(!title){toast('Title is required','error');return;}
  const goal={id:uid(),title,category:document.getElementById('ng-c').value,target:+document.getElementById('ng-tg').value,current:+document.getElementById('ng-cu').value,unit:document.getElementById('ng-u').value};
  D.goals.push(goal);
  try{
    await saveD();
    closeM(null,document.getElementById('m-addgoal'));document.getElementById('ng-t').value='';renderTasks();toast('Goal added','success');
  }catch(e){
    D.goals=D.goals.filter(g=>g.id!==goal.id);
    toast('Failed to add goal. Please try again.','error');
  }
}
function printNote(){
  const body=document.getElementById('nd-body');
  if(!body)return;
  const w=window.open('','_blank','width=800,height=700');
  w.document.write(`<!DOCTYPE html><html><head><title>Meeting Note</title><style>
    body{'font-family':'Segoe UI',system-ui,sans-serif;margin:0;padding:32px;font-size:13px;color:#1a1a18;line-height:1.6}
    .nd-header{background:#0c1d56;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px}
    .nd-sec-title{'font-size':10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b6b68;margin-bottom:9px;margin-top:18px;border-top:1px solid #e5e5e3;padding-top:14px}
    .nd-bullet{'margin-bottom':3px}
    .badge{display:inline-flex;font-size:9.5px;font-weight:500;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,.2);color:#fff}
    table{width:100%;border-collapse:collapse}td{padding:5px 8px;border-bottom:1px solid #e5e5e3;font-size:12px}
    @media print{body{padding:16px}}
  </style></head><body>${body.innerHTML}</body></html>`);
  w.document.close();
  setTimeout(()=>w.print(),400);
}

function openAddNote(){
  // Populate officer reports list from current exec members
  const officers=D.members.filter(m=>m.role!=='Member');
  document.getElementById('mn-officers-list').innerHTML=officers.map(o=>`
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex-shrink:0;padding-top:2px">
        <div class="sh-av" style="width:24px;height:24px;font-size:8px">${o.initials}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:11.5px;font-weight:500;margin-bottom:3px">${o.role} — ${o.name}</div>
        <textarea id="mn-off-${o.id}" style="width:100%;height:36px;padding:5px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:11.5px;font-family:inherit;resize:vertical;outline:none;transition:border .1s" placeholder="• Report notes..." onfocus="this.style.borderColor='var(--navy)'" onblur="this.style.borderColor='var(--bdr)'"></textarea>
      </div>
    </div>`).join('');
  openM('m-addnote');
}

async function addNote(){
  if(!canWrite()){toast('You do not have permission to add meeting notes.','error');return;}
  const title=document.getElementById('mn-t').value.trim();
  if(!title){toast('Meeting title is required','error');return;}
  const authorId=CURRENT_USER?CURRENT_USER.mid:null;
  const date=document.getElementById('mn-d').value||new Date().toISOString().split('T')[0];
  const chapter=document.getElementById('mn-chapter').value.trim()||'OpsCore — Nexus Chapter';

  // Collect officer reports
  const officers=D.members.filter(m=>m.role!=='Member');
  const officerReports=officers.map(o=>{
    const el=document.getElementById('mn-off-'+o.id);
    return{role:o.role,name:o.name,notes:el?el.value.trim():''};
  });

  const note={
    id:uid(),
    title,
    type:document.getElementById('mn-tp').value,
    date,
    chapter,
    officerReports,
    announcements:document.getElementById('mn-announcements').value.trim(),
    oldBusiness:document.getElementById('mn-oldbiz').value.trim(),
    newBusiness:document.getElementById('mn-newbiz').value.trim(),
    ooh:document.getElementById('mn-ooh').value.trim(),
    botw:document.getElementById('mn-botw').value.trim(),
    buffon:document.getElementById('mn-buffon').value.trim(),
    actions:document.getElementById('mn-a').value.split('\n').filter(Boolean),
    author:authorId,
    // Legacy body field — generated from structured data for compatibility
    body:''
  };
  note.body=buildNoteBody(note);

  D.notes.unshift(note);
  try{
    await saveD();
    closeM(null,document.getElementById('m-addnote'));
    ['mn-t','mn-announcements','mn-oldbiz','mn-newbiz','mn-ooh','mn-botw','mn-buffon','mn-a'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('mn-chapter').value='OpsCore — Nexus Chapter';
    renderNotes();
    toast('Meeting note saved','success');
  }catch(e){
    D.notes=D.notes.filter(n=>n.id!==note.id);
    toast('Failed to save note. Please try again.','error');
  }
}

function buildNoteBody(note){
  // Build a plain-text summary for preview/search purposes
  let parts=[];
  if(note.announcements)parts.push('Announcements: '+note.announcements);
  if(note.oldBusiness)parts.push('Old Business: '+note.oldBusiness);
  if(note.newBusiness)parts.push('New Business: '+note.newBusiness);
  if(note.ooh)parts.push('Remote Members: '+note.ooh);
  if(note.botw)parts.push('Member Recognition: '+note.botw);
  if(note.buffon)parts.push('Improvement Note: '+note.buffon);
  return parts.join(' | ');
}
function addCase(){
  const desc=document.getElementById('nc-d').value.trim();
  if(!desc){toast('Description is required','error');return;}
  const filedBy=CURRENT_USER?CURRENT_USER.mid:null;
  D.cases.push({id:uid(),caseNum:'CASE-0'+String(D.cases.length+10),type:document.getElementById('nc-t').value,member:document.getElementById('nc-m').value,desc,status:document.getElementById('nc-s').value,hearingDate:document.getElementById('nc-h').value,resolution:'',filedBy});
  saveD();closeM(null,document.getElementById('m-addcase'));document.getElementById('nc-d').value='';renderJudicial();toast('Case filed','success');
}
function addShift(){
  const ev=document.getElementById('ns-e').value.trim();
  if(!ev){toast('Event name is required','error');return;}
  D.shifts.push({id:uid(),event:ev,date:document.getElementById('ns-d').value,start:document.getElementById('ns-st').value,end:document.getElementById('ns-en').value,memberId:document.getElementById('ns-m').value||null,confirmed:false,noShow:false});
  saveD();closeM(null,document.getElementById('m-addshift'));document.getElementById('ns-e').value='';renderSober();toast('Shift added','success');
}
function addComm(){
  const name=document.getElementById('nco-n').value.trim();
  if(!name){toast('Name is required','error');return;}
  D.committees.push({id:uid(),name,desc:document.getElementById('nco-d').value,chair:document.getElementById('nco-c').value,members:[]});
  saveD();closeM(null,document.getElementById('m-addcomm'));document.getElementById('nco-n').value='';renderCommittees();toast('Committee created','success');
}
function addTrans(){
  const role=document.getElementById('ntr-r').value.trim();
  if(!role){toast('Role is required','error');return;}
  D.transitions.push({id:uid(),role,outgoing:document.getElementById('ntr-o').value||null,incoming:null,content:document.getElementById('ntr-c').value,status:document.getElementById('ntr-s').value});
  saveD();closeM(null,document.getElementById('m-addtrans'));document.getElementById('ntr-r').value='';renderTransition();toast('Transition doc added','success');
}
function toggleTask(id){if(!canWrite()){toast('You do not have permission to update tasks.','error');return;}const t=D.tasks.find(t=>t.id===id);if(t){t.status=t.status==='done'?'todo':'done';saveD();renderDash();renderTasks();}}

// ── EDIT TASK ──
function openEditTask(id){
  const t=D.tasks.find(t=>t.id===id);if(!t)return;
  const el=document.getElementById('m-edittask');
  el.querySelectorAll('select[id="et-a"]').forEach(s=>{s.innerHTML=mOpts();});
  document.getElementById('et-id').value=id;
  document.getElementById('et-t').value=t.title;
  document.getElementById('et-a').value=t.assignedTo;
  document.getElementById('et-p').value=t.priority;
  document.getElementById('et-d').value=t.dueDate||'';
  document.getElementById('et-s').value=t.status;
  document.getElementById('et-ds').value=t.desc||'';
  el.classList.add('open');
}
async function saveTask(){
  if(!canWrite()){toast('You do not have permission to edit tasks.','error');return;}
  const id=document.getElementById('et-id').value;
  const t=D.tasks.find(t=>t.id===id);if(!t)return;
  const title=document.getElementById('et-t').value.trim();
  if(!title){toast('Title is required','error');return;}
  const prev={title:t.title,assignedTo:t.assignedTo,priority:t.priority,dueDate:t.dueDate,status:t.status,desc:t.desc};
  t.title=title;t.assignedTo=document.getElementById('et-a').value;
  t.priority=document.getElementById('et-p').value;t.dueDate=document.getElementById('et-d').value;
  t.status=document.getElementById('et-s').value;t.desc=document.getElementById('et-ds').value;
  try{
    await saveD();
    closeM(null,document.getElementById('m-edittask'));renderTasks();renderDash();toast('Task saved','success');
  }catch(e){
    Object.assign(t,prev);
    toast('Failed to save task. Please try again.','error');
  }
}
async function deleteTask(id){
  if(!canWrite()){toast('You do not have permission to delete tasks.','error');return;}
  const ok=await confirmDialog('Delete Task','Are you sure you want to delete this task? This cannot be undone.');
  if(!ok)return;
  const removed=D.tasks.find(t=>t.id===id);
  D.tasks=D.tasks.filter(t=>t.id!==id);
  try{
    await saveD();
    closeM(null,document.getElementById('m-edittask'));renderTasks();renderDash();toast('Task deleted','info');
  }catch(e){
    if(removed)D.tasks.push(removed);
    toast('Failed to delete task. Please try again.','error');
  }
}

// ── EDIT MEMBER ──
function openEditMember(id){
  const m=D.members.find(m=>m.id===id);if(!m)return;
  const el=document.getElementById('m-editmember');
  document.getElementById('em-id').value=id;
  document.getElementById('em-n').value=m.name;
  // email/phone not shown in UI for privacy
  document.getElementById('em-y').value=m.year;
  document.getElementById('em-c').value=m.classYear;
  document.getElementById('em-l').value=m.liveIn?'1':'0';
  document.getElementById('em-r').value=m.role;
  el.classList.add('open');
}
async function saveMember(){
  if(!canWrite()){toast('You do not have permission to edit members.','error');return;}
  const id=document.getElementById('em-id').value;
  const m=D.members.find(m=>m.id===id);if(!m)return;
  const name=document.getElementById('em-n').value.trim();
  if(!name){toast('Name is required','error');return;}
  const prev={name:m.name,year:m.year,classYear:m.classYear,liveIn:m.liveIn,role:m.role,initials:m.initials};
  m.name=name;m.year=+document.getElementById('em-y').value;
  m.classYear=document.getElementById('em-c').value;m.liveIn=document.getElementById('em-l').value==='1';
  m.role=document.getElementById('em-r').value;
  m.initials=name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  try{
    await saveD();
    closeM(null,document.getElementById('m-editmember'));renderMembers();toast('Member saved','success');
  }catch(e){
    Object.assign(m,prev);
    toast('Failed to save member. Please try again.','error');
  }
}
async function deleteMember(id){
  if(!canWrite()){toast('You do not have permission to remove members.','error');return;}
  const ok=await confirmDialog('Remove Member','Are you sure you want to remove this member? This cannot be undone.');
  if(!ok)return;
  const removed=D.members.find(m=>m.id===id);
  D.members=D.members.filter(m=>m.id!==id);
  try{
    await saveD();
    closeM(null,document.getElementById('m-editmember'));renderMembers();toast('Member removed','info');
  }catch(e){
    if(removed)D.members.push(removed);
    toast('Failed to remove member. Please try again.','error');
  }
}

// ── RESOLVE CASE ──
function openResolveCase(id){
  const c=D.cases.find(c=>c.id===id);if(!c)return;
  document.getElementById('rc-id').value=id;
  document.getElementById('rc-r').value=c.resolution||'';
  document.getElementById('rc-s').value=c.status==='resolved'||c.status==='dismissed'?c.status:'resolved';
  document.getElementById('m-resolvecase').classList.add('open');
}
function resolveCase(){
  if(!canWrite()){toast('You do not have permission to resolve cases.','error');return;}
  const id=document.getElementById('rc-id').value;
  const c=D.cases.find(c=>c.id===id);if(!c)return;
  const res=document.getElementById('rc-r').value.trim();
  if(!res){toast('Resolution is required','error');return;}
  c.resolution=res;c.status=document.getElementById('rc-s').value;
  saveD();closeM(null,document.getElementById('m-resolvecase'));renderJudicial();toast('Case resolved','success');
}

// ── MARK ATTENDANCE ──
let _attTmp={};
function openMarkAttEv(evId){
  const ev=D.events.find(e=>e.id===evId);if(!ev)return;
  document.getElementById('ma-evid').value=evId;
  document.getElementById('ma-title').textContent='Mark Attendance — '+ev.title+' ('+fds(ev.date)+')';
  _attTmp={...(D.attendance[evId]||{})};
  renderAttList();
  document.getElementById('m-markatt').classList.add('open');
}
function openMarkAtt(){
  const past=D.events.filter(e=>e.mandatory&&!isUp(e.date)).sort((a,b)=>b.date.localeCompare(a.date));
  if(!past.length){toast('No past mandatory events to mark attendance for','info');return;}
  openMarkAttEv(past[0].id);
}
function renderAttList(){
  const evId=document.getElementById('ma-evid').value;
  document.getElementById('ma-list').innerHTML=D.members.map(m=>{
    const st=_attTmp[m.id]||'';
    const cls=st==='present'?'att-check present':st==='absent'?'att-check absent':st==='excused'?'att-check excused':'att-check';
    const lbl=st==='present'?'✓':st==='absent'?'✗':st==='excused'?'E':'';
    return`<div style="display:flex;align-items:center;gap:7px;padding:4px 0;cursor:pointer" onclick="cycleAtt('${m.id}')">
      <div class="${cls}" id="ac-${m.id}">${lbl}</div>
      <span style="font-size:12px">${m.name}</span>
    </div>`;
  }).join('');
}
function cycleAtt(mid){
  const cur=_attTmp[mid]||'';
  const next=cur===''?'present':cur==='present'?'absent':cur==='absent'?'excused':'';
  if(next==='')delete _attTmp[mid];else _attTmp[mid]=next;
  const el=document.getElementById('ac-'+mid);
  if(el){el.className=next==='present'?'att-check present':next==='absent'?'att-check absent':next==='excused'?'att-check excused':'att-check';el.textContent=next==='present'?'✓':next==='absent'?'✗':next==='excused'?'E':'';}
}
function saveAttendance(){
  if(!canWrite()){toast('You do not have permission to mark attendance.','error');return;}
  const evId=document.getElementById('ma-evid').value;
  if(!evId){toast('No event selected.','error');return;}
  if(!D.attendance)D.attendance={};
  D.attendance[evId]=_attTmp;
  saveD();closeM(null,document.getElementById('m-markatt'));renderAttendance();renderDash();toast('Attendance saved','success');
}

// ── EDIT COMMITTEE ──
function openEditComm(id){
  const c=D.committees.find(c=>c.id===id);if(!c)return;
  const el=document.getElementById('m-editcomm');
  document.getElementById('eco-id').value=id;
  document.getElementById('eco-n').value=c.name;
  document.getElementById('eco-d').value=c.desc||'';
  const msel=document.getElementById('eco-c');msel.innerHTML=mOpts();msel.value=c.chair;
  document.getElementById('eco-members').innerHTML=D.members.map(m=>`<label style="display:flex;align-items:center;gap:5px;font-size:12px;padding:2px 0;cursor:pointer"><input type="checkbox" value="${m.id}" ${(c.members||[]).includes(m.id)?'checked':''}>${m.name}</label>`).join('');
  el.classList.add('open');
}
function saveComm(){
  if(!canWrite()){toast('You do not have permission to edit committees.','error');return;}
  const id=document.getElementById('eco-id').value;
  const c=D.committees.find(c=>c.id===id);if(!c)return;
  const name=document.getElementById('eco-n').value.trim();
  if(!name){toast('Name is required','error');return;}
  c.name=name;c.desc=document.getElementById('eco-d').value;c.chair=document.getElementById('eco-c').value;
  c.members=[...document.getElementById('eco-members').querySelectorAll('input:checked')].map(cb=>cb.value);
  saveD();closeM(null,document.getElementById('m-editcomm'));renderCommittees();toast('Committee saved','success');
}
async function deleteComm(id){
  if(!canWrite()){toast('You do not have permission to delete committees.','error');return;}
  const ok=await confirmDialog('Delete Committee','Are you sure you want to delete this committee?');
  if(!ok)return;
  D.committees=D.committees.filter(c=>c.id!==id);
  saveD();closeM(null,document.getElementById('m-editcomm'));renderCommittees();toast('Committee deleted','info');
}

// ── EDIT TRANSITION ──
function openEditTrans(id){
  const t=D.transitions.find(t=>t.id===id);if(!t)return;
  const el=document.getElementById('m-edittrans');
  document.getElementById('etr-id').value=id;
  document.getElementById('etr-r').value=t.role;
  document.getElementById('etr-c').value=t.content||'';
  document.getElementById('etr-s').value=t.status;
  const o=document.getElementById('etr-o');o.innerHTML='<option value="">— Unassigned —</option>'+mOpts();o.value=t.outgoing||'';
  const i=document.getElementById('etr-i');i.innerHTML='<option value="">— TBD —</option>'+mOpts();i.value=t.incoming||'';
  el.classList.add('open');
}
function saveTrans(){
  if(!canWrite()){toast('You do not have permission to edit transition documents.','error');return;}
  const id=document.getElementById('etr-id').value;
  const t=D.transitions.find(t=>t.id===id);if(!t)return;
  const role=document.getElementById('etr-r').value.trim();
  if(!role){toast('Role is required','error');return;}
  t.role=role;t.outgoing=document.getElementById('etr-o').value||null;
  t.incoming=document.getElementById('etr-i').value||null;
  t.content=document.getElementById('etr-c').value;t.status=document.getElementById('etr-s').value;
  saveD();closeM(null,document.getElementById('m-edittrans'));renderTransition();toast('Transition doc saved','success');
}

// ── DELETE FILE WITH CONFIRM ──
async function fiDelete(id){
  if(!canWrite()){toast('You do not have permission to delete files.','error');return;}
  const ok=await confirmDialog('Delete File','Are you sure you want to remove this file?');
  if(!ok)return;
  D.files=D.files.filter(f=>f.id!==id);
  delete FI_STORE[id];
  saveD();renderFiles();
  toast('File removed','info');
}

// ── UPDATE NOTIFICATION BADGES ──
function updateBadges(){
  const attendBadge=document.getElementById('attend-sb-badge');
  const jbBadge=document.getElementById('judicial-sb-badge');
  if(attendBadge){const lowAtt=D.members.filter(m=>aR(m.id)<75).length;attendBadge.textContent=lowAtt;attendBadge.style.display=lowAtt?'':'none';}
  if(jbBadge){const oc=D.cases.filter(c=>!['resolved','dismissed'].includes(c.status)).length;jbBadge.textContent=oc;jbBadge.style.display=oc?'':'none';}
  autoGenerateNotifs();
}

// Auto-generate smart notifications from live data
function autoGenerateNotifs(){
  if(!D.notifs)D.notifs=[];
  const today=new Date().toISOString().split('T')[0];
  const existing=new Set(D.notifs.map(n=>n.autoKey||''));

  function pushAuto(autoKey,title,body,type='info',link=''){
    if(existing.has(autoKey))return;
    D.notifs.unshift({id:uid(),autoKey,title,body,type,link,read:false,date:today});
    existing.add(autoKey);
  }

  // Attendance: members below 75%
  const lowAtt=D.members.filter(m=>aR(m.id)<75);
  if(lowAtt.length){
    pushAuto('att_low_'+today,'Attendance Warning',`${lowAtt.length} member${lowAtt.length>1?'s':''} below 75%: ${lowAtt.slice(0,3).map(m=>m.name.split(' ')[0]).join(', ')}${lowAtt.length>3?'...':''}. Review required.`,'warning','attendance');
  }

  // Overdue tasks
  const ovT=D.tasks.filter(t=>isOv(t.dueDate)&&t.status!=='done');
  if(ovT.length){
    const top=ovT.sort((a,b)=>({urgent:0,high:1,medium:2,low:3}[a.priority]||2)-({urgent:0,high:1,medium:2,low:3}[b.priority]||2))[0];
    pushAuto('tasks_ov_'+today,'Overdue Tasks',`${ovT.length} task${ovT.length>1?'s':''} are past their due date. Highest priority: "${top.title}" (${top.priority}).`,'warning','tasks');
  }

  // Unassigned sober shifts
  const unassigned=D.shifts.filter(s=>isUp(s.date)&&!s.memberId);
  if(unassigned.length){
    pushAuto('sober_unassigned_'+today,'Unassigned Sober Shifts',`${unassigned.length} upcoming shift${unassigned.length>1?'s':''} have no safety officer assigned. Next: ${fds(unassigned[0].date)}.`,'warning','sober');
  }

  // Open judicial cases
  const openCases=D.cases.filter(c=>!['resolved','dismissed'].includes(c.status));
  if(openCases.length){
    pushAuto('jb_open_'+today,'Open Judicial Cases',`${openCases.length} case${openCases.length>1?'s':''} require attention. Access the Compliance Review to review.`,'info','judicial');
  }

  // Dues: unpaid members
  const dues=D.finance.dues||{};
  const unpaidCount=D.members.filter(m=>(dues[m.id]?.status||'Partial')!=='Paid').length;
  if(unpaidCount>D.members.length*0.3){
    pushAuto('dues_unpaid_'+today,'Dues Collection Alert',`${unpaidCount} members (${Math.round(unpaidCount/D.members.length*100)}%) have not paid semester dues. Follow up required.`,'warning','finance');
  }

  // Upcoming mandatory events (within 3 days)
  const soon=D.events.filter(e=>e.mandatory&&isUp(e.date)).filter(e=>{const d=Math.round((new Date(e.date+'T12:00:00')-new Date())/86400000);return d<=3&&d>=0;});
  soon.forEach(e=>{
    const days=Math.round((new Date(e.date+'T12:00:00')-new Date())/86400000);
    pushAuto('ev_soon_'+e.id,'Mandatory Event Soon',`"${e.title}" is ${days===0?'today':days===1?'tomorrow':'in '+days+' days'}${e.location?' at '+e.location:''}.`,'info','calendar');
  });

  // Trim auto-notifs older than 14 days to prevent bloat
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-14);
  D.notifs=D.notifs.filter(n=>!n.autoKey||new Date(n.date+'T12:00:00')>cutoff);

  // Keep max 50 notifs total
  if(D.notifs.length>50)D.notifs=D.notifs.slice(0,50);
  saveD();
}

function confirmShift(id){if(!canWrite()){toast('You do not have permission to confirm shifts.','error');return;}const s=D.shifts.find(s=>s.id===id);if(s){s.confirmed=!s.confirmed;saveD();renderSober();}}
function markRead(){if(!D.notifs)return;D.notifs.forEach(n=>n.read=true);saveD();renderNotifications();}
function nRead(id){const n=D.notifs&&D.notifs.find(n=>n.id===id);if(n){n.read=true;saveD();renderNotifications();}}
function saveProf(){
  if(!canWrite()){toast('You do not have permission to edit settings.','error');return;}
  D.settings.name=document.getElementById('se-name').value;
  D.settings.year=+document.getElementById('se-year').value;
  D.settings.classYear=document.getElementById('se-class').value;
  saveD();
  const ini=D.settings.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('u-name').textContent=D.settings.name;
  document.getElementById('u-av').textContent=ini;document.getElementById('tb-av').textContent=ini;
  toast('Profile saved','success');
}
function toggleSetting(k,el){D.settings[k]=!D.settings[k];el.className='tgl '+(D.settings[k]?'on':'off');saveD();}
function handleSI(input){
  if(!canWrite()){toast('You do not have permission to import shifts.','error');return;}
  const f=input.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=function(e){
    const lines=e.target.result.split('\n').filter(Boolean);
    let added=0;
    lines.slice(1).forEach(line=>{
      const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
      if(cols.length>=4&&cols[0]&&cols[1]){
        const memberMatch=D.members.find(m=>m.name.toLowerCase().includes((cols[4]||'').toLowerCase())&&cols[4]);
        D.shifts.push({id:uid(),event:cols[0],date:cols[1],start:cols[2]||'22:00',end:cols[3]||'02:00',memberId:memberMatch?memberMatch.id:null,confirmed:false,noShow:false});
        added++;
      }
    });
    if(added){saveD();renderSober();toast(added+' shift'+(added>1?'s':'')+' imported','success');closeM(null,document.getElementById('m-simport'));}
    else{document.getElementById('si-prev').innerHTML=`<div class="bnr danger"><i class="ti ti-alert-circle" style="font-size:13px"></i>Could not parse file. Expected columns: Event, Date, Start, End, Member</div>`;}
  };
  reader.readAsText(f);
}
function filterA(){const q=document.getElementById('a-search').value.toLowerCase();document.querySelectorAll('#a-table tbody tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');}
function filterN(){const q=document.getElementById('n-search').value.toLowerCase();document.querySelectorAll('#notes-g>div').forEach(el=>el.style.display=el.textContent.toLowerCase().includes(q)?'':'none');}
function filterM(){const q=document.getElementById('m-search').value.toLowerCase();document.querySelectorAll('#m-table tbody tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');}
function xport(type){
  let data='',fn='export.csv';
  if(type==='members'){data='Name,Class Year,Grad Year,Role,Live-In\n';D.members.forEach(m=>{data+=m.name+','+m.classYear+','+m.year+','+m.role+','+(m.liveIn?'Yes':'No')+'\n';});fn='members.csv';}
  else if(type==='attendance'){data='Member,Attendance Rate\n';D.members.forEach(m=>{data+=m.name+','+aR(m.id)+'%\n';});fn='attendance.csv';}
  else if(type==='finance'){
    const dues=D.finance.dues||{};
    data='Member,Class,Amount Owed,Paid,Balance,Status\n';
    D.members.forEach(m=>{const d=dues[m.id]||{};const owed=d.semesterDues||getSemDues(m.id);const paid=d.paid||0;data+=`"${m.name}",${m.classYear},${owed},${paid},${owed-paid},${d.status||'Partial'}\n`;});
    fn='dues.csv';
  }
  else if(type==='academics'){
    data='Member,Class,Cumulative GPA,Last Semester GPA\n';
    D.members.forEach(m=>{const g=D.academics.gpas[m.id]||{};data+=`"${m.name}",${m.classYear},${g.cumulativeGpa||''},${g.priorGpa||''}\n`;});
    fn='academics.csv';
  }
  else if(type==='recruitment'){
    data='Name,Stage,Major,Hometown,Bid Score,Last Contact,Recruiter\n';
    (D.recruitment.rushees||[]).forEach(r=>{const rec=mB(r.recruiter);data+=`"${r.name}","${r.stage}","${r.major||''}","${r.hometown||''}",${r.bidScore||0},${r.lastContact||''},"${rec.name||''}"\n`;});
    fn='recruitment.csv';
  }
  else if(type==='all'){const blob=new Blob([JSON.stringify(D,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ato_ops_data.json';a.click();return;}
  const blob=new Blob([data],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fn;a.click();
}

function kpi(label,val,sub,trend){
  const c=trend==='up'?'var(--gn)':trend==='down'?'var(--rd)':'var(--mt)';
  const ico=trend==='up'?'↑':trend==='down'?'↓':'';
  return`<div class="card"><div class="kl">${label}</div><div class="kv">${val}</div><div class="ks" style="color:${c}">${ico} ${sub}</div></div>`;
}

// ── SKELETON & EMPTY STATE HELPERS ──
function skKpi(n=4){return Array(n).fill(0).map(()=>`<div class="sk-kpi"><div class="sk sk-line w50"></div><div class="sk sk-kpi-val"></div><div class="sk sk-line w30"></div></div>`).join('');}
function skRows(n=5,cols=4){const cw=cols===4?'2fr 1fr 1fr 1fr':cols===3?'2fr 1fr 1fr':'2fr 1fr';return`<div style="padding:6px 0">${Array(n).fill(0).map(()=>`<div class="sk-table-row" style="grid-template-columns:${cw}">${Array(cols).fill(0).map((c,i)=>`<div class="sk sk-line ${i===0?'w90':i===1?'w70':i===2?'w50':'w30'}"></div>`).join('')}</div>`).join('')}</div>`;}
function skCards(n=3){return Array(n).fill(0).map(()=>`<div class="sk-card"><div class="sk sk-line w60" style="height:13px;margin-bottom:9px"></div><div class="sk sk-line w90"></div><div class="sk sk-line w70"></div></div>`).join('');}
function skCalendar(){const cells=Array(35).fill(0).map(()=>`<div class="sk-cal-cell"><div class="sk sk-line w30" style="height:9px;margin-bottom:5px"></div>${Math.random()>.6?`<div class="sk sk-cal-pip sk w80"></div>`:''}${Math.random()>.75?`<div class="sk sk-cal-pip sk w60"></div>`:''}</div>`).join('');return`<div style="display:grid;grid-template-columns:repeat(7,1fr)">${cells}</div>`;}
function skRows2(n=4){return Array(n).fill(0).map(()=>`<div class="sk-row"><div class="sk sk-av"></div><div style="flex:1"><div class="sk sk-line w70"></div><div class="sk sk-line w40" style="margin-top:5px"></div></div></div>`).join('');}

function es(icon,iconClass,title,sub,btnHtml=''){
  return`<div class="es"><div class="es-icon ${iconClass}"><i class="ti ${icon}"></i></div><div class="es-title">${title}</div><div class="es-sub">${sub}</div>${btnHtml}</div>`;
}

function withSkeleton(containerId,skHtml,renderFn,delay=0){
  const el=document.getElementById(containerId);
  if(el&&!el._hasData){el.innerHTML=skHtml;}
  if(delay){setTimeout(()=>{renderFn();if(el)el._hasData=true;},delay);}
  else{renderFn();if(el)el._hasData=true;}
}

function showPageSkeleton(pageId,slots){
  slots.forEach(({id,html})=>{const el=document.getElementById(id);if(el&&!el._hasData)el.innerHTML=html;});
}

function renderAttendance(){
  const tot=D.members.length;const avg=Math.round(D.members.reduce((s,m)=>s+aR(m.id),0)/tot);
  const excused=Object.values(D.attendance||{}).reduce((s,ev)=>s+Object.values(ev).filter(v=>v==='excused').length,0);
  const absent=Object.values(D.attendance||{}).reduce((s,ev)=>s+Object.values(ev).filter(v=>v==='absent').length,0);
  const attHd=document.getElementById('att-hd');if(attHd)attHd.textContent='Member Attendance — '+getSemester();
  document.getElementById('a-kpi').innerHTML=kpi('Semester avg',avg+'%',getSemester(),'neutral')+kpi('Excused absences',excused,'Semester total','neutral')+kpi('Unexcused',absent,'Semester total',absent>20?'down':'neutral')+kpi('Warnings issued',D.members.filter(m=>aR(m.id)<75).length,'Below 75%','down');
  document.getElementById('a-table').innerHTML=`<thead><tr><th>Member</th><th>Class</th><th>Attendance Rate</th><th>Status</th><th></th></tr></thead><tbody>${D.members.map(m=>{const r=aR(m.id);const s=r>=85?['Good','bg2']:r>=75?['Good','bg2']:r>=65?['At risk','ba2']:['Warning','br2'];return`<tr><td style="font-weight:500">${m.name}</td><td>${m.classYear}</td><td style="font-weight:500;color:${r>=85?'var(--gn)':r>=75?'var(--navy)':r>=65?'var(--am)':'var(--rd)'}">${r}%</td><td><span class="badge ${s[1]}">${s[0]}</span></td><td><button class="btn" style="height:23px;font-size:10.5px" onclick="openEditMember('${m.id}')"><i class="ti ti-pencil"></i></button></td></tr>`;}).join('')}</tbody>`;
  document.getElementById('a-events').innerHTML=`<thead><tr><th>Event</th><th>Type</th><th>Date</th><th>Mandatory</th><th></th></tr></thead><tbody>${D.events.map(e=>`<tr><td style="font-weight:500">${e.title}</td><td><span class="badge" style="${evCS(e.type)}">${e.type}</span></td><td>${fd(e.date)}</td><td>${e.mandatory?'<span class="badge br2">Required</span>':'—'}</td><td>${e.mandatory&&!isUp(e.date)?`<button class="btn" style="height:23px;font-size:10.5px" onclick="openMarkAttEv('${e.id}')"><i class="ti ti-checkbox"></i>Mark</button>`:'—'}</td></tr>`).join('')}</tbody>`;
  updateBadges();
}

// ── JUDICIAL BOARD PASSWORD ──
const JB_PW_HASH = ''; // password gate removed — access controlled by role/email
let JB_UNLOCKED = false;

// Compliance Review access: admin role OR explicitly allowed emails
// Add Lou's email to this list
const JB_ALLOWED_EMAILS = [
  'mabe2124@iastate.edu',   // Matt
  'loubrucc@iastate.edu',   // Lou
];

function crCanAccess(){
  if(!CURRENT_USER) return false;
  if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'exec') return true;
  if(CURRENT_USER.role === 'President' || CURRENT_USER.role === 'Vice President') return true;
  if(JB_ALLOWED_EMAILS.includes((CURRENT_USER.email||'').toLowerCase())) return true;
  return false;
}

async function hashStr(s){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function jbUnlock(){
  // No-op — kept for any legacy HTML references
}

function jbLock(){
  JB_UNLOCKED=false;
  document.getElementById('cr-gate').style.display='block';
  document.getElementById('cr-content').style.display='none';
}

function renderJudicial(){
  if(!crCanAccess()){
    // Show access denied instead of password gate
    document.getElementById('cr-gate').style.display='block';
    document.getElementById('cr-content').style.display='none';
    return;
  }
  JB_UNLOCKED=true;
  document.getElementById('cr-gate').style.display='none';
  document.getElementById('cr-content').style.display='block';
  renderJudicialContent();
}

function renderJudicialContent(){
  const open=D.cases.filter(c=>!['resolved','dismissed'].includes(c.status));
  const res=D.cases.filter(c=>['resolved','dismissed'].includes(c.status));
  const hearingSoon=open.filter(c=>c.hearingDate&&!isOv(c.hearingDate)&&(new Date(c.hearingDate+'T12:00:00')-new Date())<7*86400000).length;

  // KPIs
  document.getElementById('j-kpi').innerHTML=
    kpi('Open cases',open.length,open.length>0?'Requires attention':'All clear',open.length?'down':'neutral')+
    kpi('Hearings this week',hearingSoon,hearingSoon?'Scheduled':'None upcoming','neutral')+
    kpi('Resolved',res.length,'This semester','neutral')+
    kpi('Case types',D.cases.length?[...new Set(D.cases.map(c=>c.type))].length+' categories':'—','All types','neutral');

  // Type and status label maps
  const tl={conduct:'Conduct Violation',attendance:'Attendance',academic:'Academic Violation',financial:'Financial',hazing:'Hazing',risk:'Risk Management',other:'Other'};
  const sl={open:'Open',scheduled:'Hearing Scheduled',pending:'Pending Review',resolved:'Resolved',appealed:'Appealed',dismissed:'Dismissed'};
  const sc={open:'br2',scheduled:'ba2',pending:'bb2',resolved:'bg2',appealed:'bb2',dismissed:'bm2'};
  const dotCol={open:'var(--rd)',scheduled:'var(--am)',pending:'var(--bl)',resolved:'var(--gn)',appealed:'var(--bl)',dismissed:'#ccc'};

  // Active case cards
  const openCards=document.getElementById('j-open-cards');
  const openEmpty=document.getElementById('j-open-empty');
  if(open.length){
    openEmpty.style.display='none';
    openCards.style.display='flex';
    openCards.innerHTML=open.map(c=>`
      <div class="cr-case-card">
        <div class="case-header">
          <div>
            <div class="case-num">${c.caseNum}</div>
            <div class="case-name">${mB(c.member).name}</div>
          </div>
          <span class="badge ${sc[c.status]||'bm2'}">${sl[c.status]||c.status}</span>
        </div>
        <div class="case-meta">
          <span><i class="ti ti-tag" style="font-size:11px"></i> ${tl[c.type]||c.type}</span>
          ${c.hearingDate?`<span><i class="ti ti-calendar" style="font-size:11px"></i> Hearing: ${fd(c.hearingDate)}</span>`:''}
          <span><i class="ti ti-user" style="font-size:11px"></i> Filed by ${mB(c.filedBy).name}</span>
        </div>
        <div class="case-desc">${c.desc}</div>
        <div class="case-actions">
          <button class="btn btn-p" style="height:26px;font-size:11px" onclick="openResolveCase('${c.id}')"><i class="ti ti-gavel"></i>Resolve</button>
          <button class="btn" style="height:26px;font-size:11px" onclick="jbEditStatus('${c.id}')"><i class="ti ti-edit"></i>Update Status</button>
          <button class="btn btn-d" style="height:26px;font-size:11px" onclick="deleteCase('${c.id}')"><i class="ti ti-trash"></i>Delete</button>
        </div>
      </div>`).join('');
  } else {
    openEmpty.style.display='block';
    openEmpty.innerHTML=es('ti-circle-check','green','No active cases','All clear — no open judicial cases this semester.',`<button class="btn btn-p" onclick="openM('m-addcase')"><i class="ti ti-plus"></i>File a Case</button>`);
    openCards.style.display='none';
    openCards.innerHTML='';
  }

  // Pipeline: status breakdown
  const statuses=['open','scheduled','pending','resolved','dismissed','appealed'];
  const counts=statuses.map(s=>({s,label:sl[s],n:D.cases.filter(c=>c.status===s).length,col:dotCol[s]}));
  document.getElementById('j-pipeline').innerHTML=counts.filter(x=>x.n>0||x.s==='open').map(x=>`
    <div class="pipeline-row">
      <div style="display:flex;align-items:center;gap:8px">
        <div class="pipeline-dot" style="background:${x.col}"></div>
        <span style="font-size:12.5px">${x.label}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:80px;height:5px;background:#f0f0ee;border-radius:99px;overflow:hidden">
          <div style="height:100%;border-radius:99px;background:${x.col};width:${D.cases.length?Math.round(x.n/D.cases.length*100):0}%"></div>
        </div>
        <span style="font-size:12px;font-weight:500;width:20px;text-align:right">${x.n}</span>
      </div>
    </div>`).join('')||'<div style="color:var(--ht);font-size:12px;padding:16px 0;text-align:center">No cases filed yet.</div>';

  // Resolved table
  document.getElementById('j-res').innerHTML=`<thead><tr><th>Case #</th><th>Type</th><th>Member</th><th>Resolution</th><th>Outcome</th><th></th></tr></thead><tbody>${res.length?res.map(c=>`<tr><td class="cn">${c.caseNum}</td><td>${tl[c.type]||c.type}</td><td style="font-weight:500">${mB(c.member).name}</td><td style="color:var(--mt);max-width:220px;white-space:normal;line-height:1.4">${c.resolution||'—'}</td><td><span class="badge ${sc[c.status]||'bm2'}">${sl[c.status]||c.status}</span></td><td><button class="btn btn-d" style="height:23px;font-size:10px;padding:0 7px" onclick="deleteCase('${c.id}')"><i class="ti ti-trash"></i></button></td></tr>`).join(''):'<tr><td colspan="6" style="text-align:center;color:var(--mt);padding:18px">No resolved cases this semester</td></tr>'}</tbody>`;

  updateBadges();
}

function jbEditStatus(id){
  // Reuse the resolve modal for quick status updates too
  openResolveCase(id);
}

function renderFiles(){
  const iconMap={pdf:'ti-file-type-pdf',xlsx:'ti-file-spreadsheet',xls:'ti-file-spreadsheet',csv:'ti-file-spreadsheet',docx:'ti-file-type-doc',doc:'ti-file-type-doc',txt:'ti-file-text',png:'ti-photo',jpg:'ti-photo',jpeg:'ti-photo'};
  const colorMap={pdf:'color:var(--rd)',xlsx:'color:var(--gn)',xls:'color:var(--gn)',csv:'color:var(--gn)',docx:'color:var(--bl)',doc:'color:var(--bl)',txt:'color:var(--mt)',png:'color:var(--am)',jpg:'color:var(--am)',jpeg:'color:var(--am)'};

  function fileCard(f){
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    const icon=iconMap[ext]||'ti-file';const col=colorMap[ext]||'color:var(--ht)';const hasMem=!!FI_STORE[f.id];
    return`<div class="card" style="padding:10px 13px;display:flex;align-items:center;gap:10px">
      <i class="ti ${icon}" style="font-size:20px;flex-shrink:0;${col}"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div>
        <div style="font-size:10.5px;color:var(--mt);margin-top:1px">${f.folder} · ${f.size} · ${fds(f.date)}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${hasMem?`<button class="btn" style="height:25px;font-size:11px" onclick="fiOpenDoc('${f.id}')"><i class="ti ti-robot"></i>Ask AI</button>`:'<span style="font-size:10.5px;color:var(--ht);padding:0 4px">session only</span>'}
        <button class="btn btn-d" style="height:25px;font-size:11px;padding:0 8px" onclick="fiDelete('${f.id}')"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }

  if(FI_CURRENT_FOLDER){
    // Folder detail view
    const folderFiles=D.files.filter(f=>f.folder===FI_CURRENT_FOLDER);
    const list=document.getElementById('fi-list');
    const empty=document.getElementById('fi-empty');
    const cnt=document.getElementById('fi-folder-count');
    if(cnt)cnt.textContent=folderFiles.length+' file'+(folderFiles.length!==1?'s':'');
    if(list)list.innerHTML=folderFiles.map(fileCard).join('');
    if(empty){empty.innerHTML=folderFiles.length?'':es('ti-cloud-upload','slate','No files in this folder','Upload documents, spreadsheets, or PDFs to this position folder.',``);empty.style.display=folderFiles.length?'none':'block';}
  } else {
    // Root view: show folder cards + general files
    const _ff=getFileFolders();
    const allFolderNames=_ff.map(f=>f.name);
    D.files.forEach(f=>{if(!allFolderNames.includes(f.folder))allFolderNames.push(f.folder);});

    const folderCards=_ff.map(folder=>{
      const count=D.files.filter(f=>f.folder===folder.name).length;
      return`<div class="folder-card" style="position:relative">
        <div onclick="fiOpenFolder('${folder.name.replace(/'/g,"\\'")}')">
          <div class="folder-icon" style="background:${folder.bg};color:${folder.color}">${folder.icon}</div>
          <div>
            <div class="folder-name">${folder.name}</div>
            <div class="folder-meta">${count} file${count!==1?'s':''}</div>
          </div>
        </div>
        <button class="ib" style="position:absolute;top:6px;right:6px;width:20px;height:20px;font-size:11px;color:var(--ht)" onclick="event.stopPropagation();fiDeleteFolder('${folder.name.replace(/'/g,"\\'")}')"><i class="ti ti-x"></i></button>
      </div>`;
    });
    const foldersEl=document.getElementById('fi-folders');
    if(foldersEl)foldersEl.innerHTML=folderCards.join('');

    // General / uncategorized files in root
    const generalFiles=D.files.filter(f=>f.folder==='General'||!_ff.find(fl=>fl.name===f.folder));
    const totalFiles=D.files.length;
    const cntEl=document.getElementById('fi-count');
    if(cntEl)cntEl.textContent=totalFiles+' file'+(totalFiles!==1?'s':'')+' total';
    const rootList=document.getElementById('fi-list-root');
    const rootEmpty=document.getElementById('fi-empty-root');
    if(rootList)rootList.innerHTML=generalFiles.map(fileCard).join('');
    if(rootEmpty){rootEmpty.innerHTML=generalFiles.length?'':es('ti-files','slate','No general files yet','Drag and drop files here, or click to upload.',``);rootEmpty.style.display=generalFiles.length?'none':'block';}
  }
}

async function fiClearAll(){
  if(!canWrite()){toast('You do not have permission to clear files.','error');return;}
  if(!D.files.length)return;
  const ok=await confirmDialog('Clear All Files','Remove all '+D.files.length+' file(s)? This cannot be undone.');
  if(!ok)return;
  D.files=[];Object.keys(FI_STORE).forEach(k=>delete FI_STORE[k]);
  saveD();renderFiles();toast('All files removed','info');
}
function fiOpenAddFolder(){
  document.getElementById('fi-folder-name').value='';
  document.getElementById('fi-folder-icon').value='📁';
  document.getElementById('m-fi-addfolder').classList.add('open');
}
function fiAddFolder(){
  if(!canWrite()){toast('You do not have permission to create folders.','error');return;}
  const name=document.getElementById('fi-folder-name').value.trim();
  if(!name){toast('Folder name is required','error');return;}
  const folders=getFileFolders();
  if(folders.find(f=>f.name.toLowerCase()===name.toLowerCase())){toast('A folder with that name already exists','error');return;}
  const icon=document.getElementById('fi-folder-icon').value.trim()||'📁';
  if(!D.settings.fileFolders)D.settings.fileFolders=[...DEFAULT_FILE_FOLDERS];
  D.settings.fileFolders.push({name,icon,color:'#555',bg:'#f0f0ee'});
  saveD();closeM(null,document.getElementById('m-fi-addfolder'));renderFiles();toast('Folder created','success');
}
async function fiDeleteFolder(folderName){
  if(!canWrite()){toast('You do not have permission to delete folders.','error');return;}
  const count=D.files.filter(f=>f.folder===folderName).length;
  const ok=await confirmDialog('Delete Folder','Delete "'+folderName+'"?'+(count?' This folder has '+count+' file(s) that will be moved to General.':''),'Delete',true);
  if(!ok)return;
  D.files.forEach(f=>{if(f.folder===folderName)f.folder='General';});
  if(!D.settings.fileFolders)D.settings.fileFolders=[...DEFAULT_FILE_FOLDERS];
  D.settings.fileFolders=D.settings.fileFolders.filter(f=>f.name!==folderName);
  saveD();renderFiles();toast('Folder deleted','info');
}

function renderNotifications(){
  const visNotifs=D.notifs.filter(n=>n.type!=='judicial');
  const unr=visNotifs.filter(n=>!n.read).length;
  document.getElementById('no-cnt').textContent='Notifications'+(unr?' — '+unr+' new':'');
  const ic={attendance:'ti-alert-circle',task:'ti-clock',warning:'ti-alert-triangle',judicial:'ti-scale',sober:'ti-shield-check',general:'ti-bell',deadline:'ti-clock',finance:'ti-cash',info:'ti-info-circle'};
  const co={attendance:'background:var(--rd-bg);color:var(--rd-tx)',task:'background:var(--am-bg);color:var(--am-tx)',warning:'background:var(--am-bg);color:var(--am-tx)',judicial:'background:var(--bl-bg);color:var(--bl-tx)',sober:'background:var(--gn-bg);color:var(--gn-tx)',finance:'background:var(--gn-bg);color:var(--gn-tx)',info:'background:var(--bl-bg);color:var(--bl-tx)'};
  const visibleNotifs=D.notifs.filter(n=>n.type!=='judicial');
  document.getElementById('no-list').innerHTML=visibleNotifs.map(n=>{
    const linkClick=n.link?`onclick="nRead('${n.id}');rbacNav('${n.link}',null)"`:(`onclick="nRead('${n.id}')"`);
    return`<div class="ni-item ${n.read?'':'unread'}" ${linkClick} style="cursor:${n.link?'pointer':'default'}">
      <div class="al-ic" style="${co[n.type]||'background:#f0f0ee;color:var(--mt)'}"><i class="ti ${ic[n.type]||'ti-bell'}" style="font-size:13px"></i></div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:${n.read?400:500}">${n.title}${n.autoKey?'<span style="font-size:9px;color:var(--ht);margin-left:6px;font-weight:400">auto</span>':''}</div>
        <div style="font-size:11px;color:var(--mt);margin-top:2px">${n.body}</div>
        <div style="font-size:10px;color:var(--ht);margin-top:3px">${n.date||n.time||''}</div>
      </div>
      ${!n.read?'<div class="ni-dot"></div>':''}
    </div>`;
  }).join('')||es('ti-bell-off','slate','All caught up','No new notifications right now.','');
  updateBadges();
}

// ── EXEC POSITION FOLDERS ──
const EXEC_POSITIONS=[
  {role:'President',          icon:'👑', color:'#1a3a6b', bg:'#e8eef7',
   responsibilities:['Lead organization operations and exec team','Chair all organization and exec meetings','Represent organization to internal stakeholders and national leadership','Manage compliance review process','Final approval on all major organizational decisions'],
   recurringTasks:['Weekly exec check-ins (Monday)','Monthly report to executive leadership','Semester goal-setting with exec team','Sign all chapter contracts and official documents','IFC President meetings (bi-weekly)'],
   wishIKnew:'The job is 80% communication and follow-up. Your exec team will only move as fast as you hold them accountable. Set clear weekly expectations and never let a deadline slip twice.'},
  {role:'Vice President',     icon:'⭐', color:'#185fa5', bg:'#e6f1fb',
   responsibilities:['Run team meetings and set agendas','Track officer accountability and task completion','Serve as President backup at all events','Coordinate committee chairs and their reports','Manage chapter calendar and event scheduling'],
   recurringTasks:['Weekly VP checklist (see Playbooks)','Monday agenda prep and officer check-ins','Send weekly chapter digest email','Attendance follow-up for members below 75%','Coordinate with Secretary on meeting minutes'],
   wishIKnew:'Agenda discipline makes or breaks team meetings. Send the agenda 24 hours out, stick to time limits, and never let open forum run more than 5 minutes. Brothers appreciate efficiency.'},
  {role:'Treasurer',          icon:'💰', color:'#3b6d11', bg:'#eaf3de',
   responsibilities:['Manage all chapter finances and bank accounts','Collect and track semester dues','Approve all chapter expenditures','Maintain semester budget and financial reports','File all required financial reports with IFC and nationals'],
   recurringTasks:['Weekly dues reminder to unpaid members','Monthly budget vs. actuals report to exec','IFC financial reporting (semester deadlines)','Annual audit with chapter advisor','Semester budget planning before each semester'],
   wishIKnew:'Chase dues early and often. The first 3 weeks of the semester set the tone. Members who don\'t pay by Week 4 rarely pay voluntarily. Know exactly what IFC requires and when — late filings are a big deal.'},
  {role:'Secretary',          icon:'📋', color:'#854f0b', bg:'#faeeda',
   responsibilities:['Record and publish all team meeting minutes','Maintain official chapter roster and member records','Handle chapter correspondence and official communications','Track and submit all required reports to nationals','Manage chapter calendar accuracy'],
   recurringTasks:['Minutes published within 24 hours of each meeting','Roster update at start of each semester','Monthly reports to leadership','Attendance records kept current in platform','Email archive maintained for the semester'],
   wishIKnew:'The national portal deadlines sneak up on you. Build calendar reminders for every reporting deadline on Day 1. Keep the chapter roster obsessively up to date — everything else in the platform depends on it.'},
  {role:'Recruitment Chair',  icon:'🤝', color:'#3b6d11', bg:'#eaf3de',
   responsibilities:['Plan and execute all rush events each semester','Manage the recruitment CRM and rushee pipeline','Coordinate bid day and new member onboarding','Lead the recruitment committee','Track and report recruitment metrics'],
   recurringTasks:['Weekly CRM review and rushee follow-ups','Rush event debrief within 24 hours','Recruiter leaderboard and accountability tracking','IFC recruitment registration and compliance','Post-rush debrief report at end of each semester'],
   wishIKnew:'Relationships close bids, not events. Your brothers who personally invite rushees and follow up 1-on-1 are worth more than any event. Train every brother on how to have a conversation, not just a sales pitch.'},
  {role:'Risk Manager',       icon:'🛡️', color:'#a32d2d', bg:'#fcebeb',
   responsibilities:['Enforce all risk management policies at events','Schedule and manage Event Safety team rotations','Conduct event safety walkthroughs','Handle incident documentation and reporting','Liaise with university and national leadership on risk matters'],
   recurringTasks:['Safety officerther schedule filled 1 week in advance','Event approval sign-off for every social event','Weekly check of safety officerther confirmations','Risk policy review at start of each semester','Post-event incident reports (if applicable)'],
   wishIKnew:'The safety officer schedule is your most important recurring task. Never let it go unfilled. One incident without documentation ruins the chapter. Get your FIPG training done in the first week and make sure exec knows the policy cold.'},
  {role:'Social Chair',       icon:'🎉', color:'#854f0b', bg:'#faeeda',
   responsibilities:['Plan and execute all chapter social events','Coordinate with co-host organizations','Manage event budgets in coordination with Treasurer','Ensure all socials are approved by Risk Manager','Build and maintain vendor relationships'],
   recurringTasks:['Submit event proposals to exec 2 weeks in advance','Confirm venue, catering, and transportation 1 week out','Brief brothers on event logistics 48 hours before','Post-event debrief and vendor rating update','Semester event calendar submitted Week 1'],
   wishIKnew:'Book popular venues in the first week of the semester or they\'ll be gone. Always have a backup plan for venue and catering. Your vendor list in the platform is gold — update it after every event while details are fresh.'},
  {role:'Philanthropy Chair', icon:'❤️', color:'#a32d2d', bg:'#fcebeb',
   responsibilities:['Organize all chapter philanthropy and service events','Track and report individual and chapter service hours','Meet IFC and national service hour requirements','Build relationships with nonprofit partners','Run the philanthropy committee'],
   recurringTasks:['Service hour log updated within 24 hours of each event','IFC service hours reported each semester','At least 1 philanthropy event per month during semester','Chapter service hour goal tracked in platform','Thank-you notes sent to partner orgs within 48 hours'],
   wishIKnew:'IFC has a minimum hours requirement that can affect your chapter standing. Know the number on Day 1 and set your semester goal above it. Brothers participate more when you make it easy — transportation is usually the bottleneck.'},
  {role:'Scholarship Chair',  icon:'📚', color:'#185fa5', bg:'#e6f1fb',
   responsibilities:['Track and report all member GPAs each semester','Identify and support members on academic probation','Coordinate study resources','Run the scholarship committee and study programs','Submit GPA reports to organizational leadership','Coordinate academic support resources'],
   recurringTasks:['GPA collection within first 3 weeks of semester','Academic probation check-ins (weekly)','Study hours tracking if chapter policy requires','IFC GPA report (end of semester deadline)','Chapter GPA award at end-of-semester recognition night'],
   wishIKnew:'Collecting GPAs is harder than it sounds. Send a platform link and make it part of the first team meeting. Members on probation often hide it — check in with them privately, not in front of the chapter.'},
  {role:'House Manager',      icon:'🏠', color:'#555', bg:'#f0f0ee',
   responsibilities:['Manage chapter house maintenance and repairs','Coordinate with house corporation on major repairs','Enforce house rules and cleanliness standards','Manage room assignments and live-in rosters','Handle vendor relationships for house services'],
   recurringTasks:['Weekly house walkthrough and maintenance log','Monthly report to house corporation','Room assignment updates at semester start','Utilities and vendor payments tracked with Treasurer','Move-in and move-out inspection checklists'],
   wishIKnew:'Build a relationship with the house corporation contact in Week 1. Keep a running maintenance log — it protects you when something goes wrong. Never pay for a repair out of pocket without exec approval and documentation.'},
  {role:'New Member Educator',icon:'🎓', color:'#185fa5', bg:'#e6f1fb',
   responsibilities:['Design and run the semester leadership development program','Track new member progress through all developmental milestones','Coordinate leadership education curriculum','Ensure program is compliant with organizational standards','Manage mentor matching process'],
   recurringTasks:['Weekly NME session planning and facilitation','New member progress tracked in Leadership Development section','Big/little matching completed by Week 4','Standards tests administered and graded','Initiation logistics coordinated with Chaplain and President'],
   wishIKnew:'The new member experience sets the tone for how brothers engage with the chapter for their entire time here. Take it seriously. The ritual section in the platform helps track every milestone — use it every week, not just at initiation.'},
  {role:'Chaplain',           icon:'✝️', color:'#555', bg:'#f0f0ee',
   responsibilities:['Lead chapter in ritual and spiritual life','Coordinate all formal ritual ceremonies','Maintain ritual materials and ensure their security','Run the brother of the week and chapter prayer traditions','Support members through personal challenges'],
   recurringTasks:['Chapter opening and closing ritual at every meeting','Coordinate initiation ceremony logistics with NME','Member recognition nomination at every team meeting','Leadership development materials inventory at start of each semester','Support member wellness — connect struggling brothers to resources'],
   wishIKnew:'The ritual materials are your most important responsibility. Know where they are at all times. Initiation coordination with the NME takes 3-4 weeks of planning — start early. Your informal role supporting brothers personally matters more than most execs realize.'},
];

// Role contacts stored in D.transitions per role — no hardcoded defaults

const TR_ROLE_DEADLINES = [
  {id:'trd1',title:'Submit chapter roster to IFC',owner:'Secretary',when:'Week 1 of every semester',priority:'high',notes:'Late submission results in fines.'},
  {id:'trd2',title:'IFC dues payment',owner:'Treasurer',when:'Week 2 of every semester',priority:'high',notes:'Amount varies — check IFC invoice.'},
  {id:'trd3',title:'National member report',owner:'Executive Secretary',when:'Week 3 of every semester',priority:'high',notes:'Submit via member portal.'},
  {id:'trd4',title:'GPA collection from all members',owner:'Scholarship Chair',when:'Weeks 2-4 each semester',priority:'high',notes:'Needed for IFC and national reporting.'},
  {id:'trd5',title:'IFC GPA report submission',owner:'Scholarship Chair',when:'End of each semester',priority:'high',notes:'Submit to IFC by their posted deadline.'},
  {id:'trd6',title:'Philanthropy hours report to IFC',owner:'Philanthropy Chair',when:'End of each semester',priority:'medium',notes:'IFC minimum threshold required.'},
  {id:'trd7',title:'Semester budget submission',owner:'Treasurer',when:'Week 1 of every semester',priority:'high',notes:'Full budget presented at first exec meeting.'},
  {id:'trd8',title:'Risk management event pre-approvals',owner:'Risk Manager',when:'Before every social event',priority:'high',notes:'No event runs without signed RM approval.'},
  {id:'trd9',title:'Officer transition documents complete',owner:'Vice President',when:'Final 2 weeks of each semester',priority:'high',notes:'All outgoing officers must complete before changeover.'},
  {id:'trd10',title:'House inspection with house corporation',owner:'House Manager',when:'Start and end of each semester',priority:'medium',notes:'Document all damage with photos before move-in.'},
];

let TR_CURRENT = null;

function trGetTransData(){
  if(!D.transitionHub)D.transitionHub={deadlines:[],issues:[],archive:[]};
  if(!D.transitionHub.issues)D.transitionHub.issues=[];
  if(!D.transitionHub.archive)D.transitionHub.archive=[];
  if(!D.transitionHub.deadlines)D.transitionHub.deadlines=[];
  return D.transitionHub;
}

function renderTransition(){
  trGetTransData();
  const comp=D.transitions.filter(t=>t.status==='complete').length;
  const tot=Math.max(D.transitions.length,EXEC_POSITIONS.length);
  const pct=Math.round(comp/tot*100);
  document.getElementById('tr-bar').style.width=pct+'%';
  document.getElementById('tr-pct-label').textContent=pct+'%';
  document.getElementById('tr-sub').textContent=comp+' of '+EXEC_POSITIONS.length+' roles marked complete — all outgoing officers should finish before end of semester.';
  trNavRoot();
}

function trNavRoot(){
  TR_CURRENT=null;
  document.getElementById('tr-root-view').style.display='';
  document.getElementById('tr-folder-view').style.display='none';

  const hub=trGetTransData();
  const sl={not_started:'br2',in_progress:'bb2',review:'ba2',complete:'bg2'};
  const sn={not_started:'Not Started',in_progress:'In Progress',review:'In Review',complete:'Complete'};

  // Role cards
  const allRoles=[...EXEC_POSITIONS.map(p=>p.role)];
  D.transitions.forEach(t=>{if(!allRoles.includes(t.role))allRoles.push(t.role);});

  document.getElementById('tr-folders').innerHTML=allRoles.map(role=>{
    const pos=EXEC_POSITIONS.find(p=>p.role===role);
    const tr=D.transitions.find(t=>t.role===role);
    const icon=pos?pos.icon:'📁';
    const bg=pos?pos.bg:'#f0f0ee';
    const col=pos?pos.color:'#555';
    const status=tr?tr.status:'not_started';
    const out=tr&&tr.outgoing?mB(tr.outgoing).name:'—';
    const inc=tr&&tr.incoming?mB(tr.incoming).name:'TBD';
    const fileCount=D.files.filter(f=>f.folder===role).length;
    return`<div class="folder-card" style="gap:9px" onclick="trOpenFolder('${encodeURIComponent(role)}')">
      <div style="display:flex;align-items:center;gap:9px">
        <div class="folder-icon" style="background:${bg};color:${col};width:34px;height:34px;font-size:17px">${icon}</div>
        <div style="min-width:0"><div class="folder-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${role}</div>
          <span class="folder-status ${sl[status]||'bm2'}" style="margin-top:3px">${sn[status]||status}</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--mt);padding-top:6px;border-top:1px solid var(--bdr)">
        <span title="Outgoing → Incoming"><i class="ti ti-arrow-right" style="font-size:10px"></i> ${out.split(' ')[0]} → ${inc.split(' ')[0]}</span>
        <span><i class="ti ti-file" style="font-size:10px"></i> ${fileCount}</span>
      </div>
    </div>`;
  }).join('');

  // Deadlines table
  trRenderDeadlines();

  // Open Issues
  trRenderIssues();

  // Archive
  trRenderArchive();
}

function trRenderDeadlines(){
  const hub=trGetTransData();
  const dl=hub.deadlines||[];
  const priColor={high:'br2',medium:'ba2',low:'bm2'};
  document.getElementById('tr-deadlines-table').innerHTML=`<thead><tr><th>Deadline / Task</th><th>Owner</th><th>When</th><th>Priority</th><th>Notes</th><th></th></tr></thead>
    <tbody>${dl.length?dl.map(d=>`<tr>
      <td style="font-weight:500">${d.title}</td>
      <td style="color:var(--mt)">${d.owner}</td>
      <td style="color:var(--mt)">${d.when}</td>
      <td><span class="badge ${priColor[d.priority]||'bm2'}">${d.priority}</span></td>
      <td style="color:var(--mt);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.notes||'—'}</td>
      <td><div style="display:flex;gap:4px">
        <button class="btn" style="height:23px;font-size:10px" onclick="trEditDeadline('${d.id}')"><i class="ti ti-pencil"></i></button>
        <button class="btn btn-d" style="height:23px;font-size:10px;padding:0 6px" onclick="trDeleteDeadline('${d.id}')"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join(''):`<tr><td colspan="6" style="text-align:center;color:var(--ht);padding:22px">No deadlines yet. Add recurring semester deadlines here.</td></tr>`}</tbody>`;
}

function trRenderIssues(){
  const hub=trGetTransData();
  const issues=hub.issues||[];
  const priColor={urgent:'br2',high:'br2',medium:'ba2',low:'bm2'};
  const stColor={open:'br2',in_progress:'bb2',resolved:'bg2'};
  const stLabel={open:'Open',in_progress:'In Progress',resolved:'Resolved'};
  const el=document.getElementById('tr-issues-list');
  if(!issues.length){el.innerHTML=`<div class="card"><div style="padding:18px;text-align:center;color:var(--ht);font-size:12px"><i class="ti ti-circle-check" style="color:var(--gn);font-size:20px;display:block;margin:0 auto 6px"></i>No open issues — clean handoff!</div></div>`;return;}
  el.innerHTML=`<div class="card" style="padding:0;overflow:hidden"><div class="tw"><table class="tbl"><thead><tr><th>Issue</th><th>Owner</th><th>Priority</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>
    ${issues.map(iss=>`<tr>
      <td style="font-weight:500">${iss.title}</td>
      <td style="color:var(--mt)">${iss.owner||'—'}</td>
      <td><span class="badge ${priColor[iss.priority]||'bm2'}">${iss.priority}</span></td>
      <td><span class="badge ${stColor[iss.status]||'bm2'}">${stLabel[iss.status]||iss.status}</span></td>
      <td style="color:var(--mt);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${iss.notes||'—'}</td>
      <td><div style="display:flex;gap:4px">
        <button class="btn" style="height:23px;font-size:10px" onclick="trEditIssue('${iss.id}')"><i class="ti ti-pencil"></i></button>
        <button class="btn btn-d" style="height:23px;font-size:10px;padding:0 6px" onclick="trDeleteIssue('${iss.id}')"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join('')}
  </tbody></table></div></div>`;
}

function trRenderArchive(){
  const hub=trGetTransData();
  const arc=hub.archive||[];
  const el=document.getElementById('tr-archive-list');
  if(!arc.length){el.innerHTML=`<div class="card"><div style="padding:14px 15px;font-size:12px;color:var(--ht)">No archived semesters yet. Use "Archive Current Semester" at the end of each semester.</div></div>`;return;}
  el.innerHTML=arc.map(a=>`<div class="card" style="margin-bottom:9px">
    <div class="card-hd"><span class="card-t" style="font-size:12.5px;font-weight:600">${a.semester}</span><span style="font-size:10.5px;color:var(--mt)">Archived ${fds(a.date)}</span></div>
    <div style="display:flex;gap:18px;font-size:11.5px;color:var(--mt);margin-top:5px;flex-wrap:wrap">
      <span><i class="ti ti-users" style="font-size:11px;margin-right:3px"></i>${a.memberCount} members</span>
      <span><i class="ti ti-checkbox" style="font-size:11px;margin-right:3px"></i>${a.completedRoles} roles complete</span>
      <span><i class="ti ti-cash" style="font-size:11px;margin-right:3px"></i>${a.notes||'—'}</span>
    </div>
  </div>`).join('');
}

function trShowSection(id){
  const el=document.getElementById(id);
  if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
}

function trOpenFolder(encodedRole){
  const role=decodeURIComponent(encodedRole);
  TR_CURRENT=role;
  document.getElementById('tr-root-view').style.display='none';
  document.getElementById('tr-folder-view').style.display='';
  document.getElementById('tr-bc-name').textContent=role;

  const pos=EXEC_POSITIONS.find(p=>p.role===role);
  const tr=D.transitions.find(t=>t.role===role);
  const sl={not_started:'Not Started',in_progress:'In Progress',review:'In Review',complete:'Complete'};
  const sc={not_started:'bm2',in_progress:'bb2',review:'ba2',complete:'bg2'};
  const status=tr?tr.status:'not_started';
  const badge=document.getElementById('tr-role-status-badge');
  badge.className='badge '+sc[status];badge.textContent=sl[status];

  const memberFiles=D.files.filter(f=>f.folder===role);
  const iconMap={pdf:'ti-file-type-pdf',xlsx:'ti-file-spreadsheet',xls:'ti-file-spreadsheet',csv:'ti-file-spreadsheet',docx:'ti-file-type-doc',doc:'ti-file-type-doc',txt:'ti-file-text',png:'ti-photo',jpg:'ti-photo',jpeg:'ti-photo'};
  const colorMap={pdf:'color:var(--rd)',xlsx:'color:var(--gn)',xls:'color:var(--gn)',csv:'color:var(--gn)',docx:'color:var(--bl)',doc:'color:var(--bl)',txt:'color:var(--mt)',png:'color:var(--am)',jpg:'color:var(--am)',jpeg:'color:var(--am)'};

  // Build contacts list from stored transitions data
  const roleContacts=(tr&&tr.contacts)||[];
  const contactsHtml=roleContacts.length?roleContacts.map((c,ci)=>`<div class="sh-row">
    <div class="sh-av" style="background:#e8eef7;color:var(--navy);font-size:9px;font-weight:700">${c.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:500">${c.name}</div>
      <div style="font-size:10.5px;color:var(--mt)">${c.role||''}${c.email?' · '+c.email:''}${c.phone?' · '+c.phone:''}</div>
    </div>
    <button class="ib" style="width:22px;height:22px;font-size:11px;color:var(--rd)" onclick="trDeleteContact('${encodeURIComponent(role)}',${ci})" title="Remove"><i class="ti ti-x"></i></button>
  </div>`).join(''):`<div style="font-size:11.5px;color:var(--ht);padding:8px 0">No contacts added yet.</div>`;

  const posData=pos||{responsibilities:[],recurringTasks:[],wishIKnew:''};
  // Prefer stored user data over template defaults
  const responsibilities=(tr&&tr.responsibilities&&tr.responsibilities.length)?tr.responsibilities:posData.responsibilities;
  const recurringTasks=(tr&&tr.recurringTasks&&tr.recurringTasks.length)?tr.recurringTasks:posData.recurringTasks;

  document.getElementById('tr-folder-body').innerHTML=`
    <!-- Row 1: Outgoing/Incoming + Key Responsibilities -->
    <div class="g2" style="margin-bottom:13px">
      <!-- Handoff Details -->
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-arrow-right-circle" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Handoff Details</span>
          <button class="btn" style="height:24px;font-size:10.5px" onclick="openEditTransCurrent()"><i class="ti ti-pencil"></i>Edit</button>
        </div>
        ${tr?`
        <div style="display:flex;flex-direction:column;gap:0">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--bdr)">
            <span style="font-size:11.5px;color:var(--mt)">Outgoing Officer</span>
            <span style="font-size:12.5px;font-weight:600;color:var(--tx)">${tr.outgoing?mB(tr.outgoing).name:'Not assigned'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--bdr)">
            <span style="font-size:11.5px;color:var(--mt)">Incoming Officer</span>
            <span style="font-size:12.5px;font-weight:600;color:${tr.incoming?'var(--tx)':'var(--ht)'}">${tr.incoming?mB(tr.incoming).name:'TBD'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--bdr)">
            <span style="font-size:11.5px;color:var(--mt)">Status</span>
            <span class="badge ${sc[status]}">${sl[status]}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0">
            <span style="font-size:11.5px;color:var(--mt)">Notes / Docs</span>
            <span class="badge ${tr.content?'bg2':'br2'}">${tr.content?'Complete':'Missing'}</span>
          </div>
        </div>
        ${tr.content?`<div style="margin-top:11px;padding:10px 12px;background:#f8f8f7;border-radius:8px;font-size:12px;color:var(--tx);line-height:1.6;white-space:pre-wrap">${tr.content}</div>`:''}
        `:`<div style="padding:14px 0;font-size:12px;color:var(--mt)">No handoff doc created yet.</div>
        <button class="btn btn-p" onclick="openNewTransFor('${encodeURIComponent(role)}')"><i class="ti ti-plus"></i>Create Handoff Doc</button>`}
      </div>

      <!-- Key Responsibilities -->
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-list" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Key Responsibilities</span>
          <button class="btn" style="height:24px;font-size:10.5px" onclick="trEditList('${encodeURIComponent(role)}','responsibilities')"><i class="ti ti-pencil"></i>Edit</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:0">
          ${responsibilities.map((r,i)=>`<div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:${i<responsibilities.length-1?'1px solid var(--bdr)':'none'}">
            <div style="width:20px;height:20px;border-radius:50%;background:#e8eef7;color:var(--navy);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
            <div style="font-size:12px;line-height:1.5;color:var(--tx)">${r}</div>
          </div>`).join('')||'<div style="font-size:12px;color:var(--ht);padding:8px 0">No responsibilities defined. Click Edit to add.</div>'}
        </div>
      </div>
    </div>

    <!-- Row 2: Recurring Tasks + Wish I Knew -->
    <div class="g2" style="margin-bottom:13px">
      <!-- Recurring Tasks -->
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-refresh" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Important Recurring Tasks</span>
          <button class="btn" style="height:24px;font-size:10.5px" onclick="trEditList('${encodeURIComponent(role)}','recurringTasks')"><i class="ti ti-pencil"></i>Edit</button>
        </div>
        ${recurringTasks.map(t=>`<div class="tk-row" style="padding:7px 0">
          <div class="tc" style="background:var(--gn);border-color:var(--gn);color:#fff;width:15px;height:15px;flex-shrink:0"><i class="ti ti-check" style="font-size:9px"></i></div>
          <span style="font-size:12px;color:var(--tx);line-height:1.5">${t}</span>
        </div>`).join('')||'<div style="font-size:12px;color:var(--ht);padding:8px 0">No recurring tasks defined. Click Edit to add.</div>'}
      </div>

      <!-- What I Wish I Knew -->
      <div class="card" style="background:linear-gradient(135deg,#f8f9ff 0%,#eef1fb 100%);border-color:#d0d8f0">
        <div class="card-hd"><span class="card-t" style="color:var(--navy)"><i class="ti ti-bulb" style="font-size:12px;color:#f5a623;margin-right:4px"></i>What I Wish I Knew</span>
          <button class="btn" style="height:24px;font-size:10.5px" onclick="trEditWishIKnew('${encodeURIComponent(role)}')"><i class="ti ti-pencil"></i>Edit</button>
        </div>
        <p id="tr-wish-text-${role.replace(/\s+/g,'_')}" style="font-size:13px;line-height:1.8;color:var(--tx);font-style:${tr&&tr.wishIKnew?'normal':'italic'}">${(tr&&tr.wishIKnew)||posData.wishIKnew||'No advice written yet. Click Edit to add wisdom for your successor.'}</p>
      </div>
    </div>

    <!-- Row 3: Important Contacts + Key Documents -->
    <div class="g2" style="margin-bottom:13px">
      <!-- Important Contacts -->
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-address-book" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Important Contacts</span>
          <button class="btn" style="height:24px;font-size:10.5px" onclick="trOpenAddContact('${encodeURIComponent(role)}')"><i class="ti ti-plus"></i>Add</button>
        </div>
        ${contactsHtml}
      </div>

      <!-- Key Documents / Files -->
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-files" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Key Documents</span><span style="font-size:10.5px;color:var(--mt)">${memberFiles.length} file${memberFiles.length!==1?'s':''}</span></div>
        ${memberFiles.length?memberFiles.map(f=>{const ext=(f.name.split('.').pop()||'').toLowerCase();const icon=iconMap[ext]||'ti-file';const col=colorMap[ext]||'color:var(--ht)';return`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bdr)">
          <i class="ti ${icon}" style="font-size:16px;${col};flex-shrink:0"></i>
          <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div><div style="font-size:10px;color:var(--mt)">${f.size} · ${fds(f.date)}</div></div>
          <button class="btn btn-d" style="height:22px;font-size:10px;padding:0 6px" onclick="fiDelete('${f.id}')"><i class="ti ti-trash"></i></button>
        </div>`;}).join(''):`<div style="font-size:11.5px;color:var(--ht);padding:8px 0">No files uploaded to this role folder.</div>`}
        <div style="margin-top:9px;border:2px dashed var(--bdr);border-radius:8px;padding:12px;text-align:center;cursor:pointer" onclick="rbacNav('files',null);fiOpenFolderUpload('${encodeURIComponent(role)}')">
          <i class="ti ti-upload" style="font-size:14px;color:var(--ht);display:block;margin-bottom:3px"></i>
          <div style="font-size:11px;color:var(--mt)">Upload to this folder</div>
        </div>
      </div>
    </div>
  `;
}

function trEditWishIKnew(encodedRole){
  const role=decodeURIComponent(encodedRole);
  let tr=D.transitions.find(t=>t.role===role);
  const pos=EXEC_POSITIONS.find(p=>p.role===role);
  const current=(tr&&tr.wishIKnew)||(pos&&pos.wishIKnew)||'';
  const newVal=prompt('Edit "What I Wish I Knew" for '+role+':\n(This advice will be shown to your successor)',current);
  if(newVal===null)return;
  if(!tr){tr={id:uid(),role,outgoing:CURRENT_USER?CURRENT_USER.mid:null,incoming:null,content:'',status:'in_progress',wishIKnew:newVal};D.transitions.push(tr);}
  else tr.wishIKnew=newVal;
  saveD();trOpenFolder(encodedRole);toast('Advice saved','success');
}

function trEditList(encodedRole, field){
  const role=decodeURIComponent(encodedRole);
  let tr=D.transitions.find(t=>t.role===role);
  const pos=EXEC_POSITIONS.find(p=>p.role===role);
  const posData=pos||{responsibilities:[],recurringTasks:[]};
  const current=tr&&tr[field]&&tr[field].length?tr[field]:posData[field]||[];
  const label=field==='responsibilities'?'Key Responsibilities':'Recurring Tasks';
  document.getElementById('tr-list-role-enc').value=encodedRole;
  document.getElementById('tr-list-field').value=field;
  document.getElementById('tr-list-modal-title').textContent='Edit '+label;
  document.getElementById('tr-list-textarea').value=current.join('\n');
  document.getElementById('tr-list-hint').textContent='One item per line.';
  document.getElementById('m-tr-list').classList.add('open');
}
function trSaveList(){
  const encodedRole=document.getElementById('tr-list-role-enc').value;
  const role=decodeURIComponent(encodedRole);
  const field=document.getElementById('tr-list-field').value;
  const lines=document.getElementById('tr-list-textarea').value.split('\n').map(l=>l.trim()).filter(Boolean);
  let tr=D.transitions.find(t=>t.role===role);
  if(!tr){tr={id:uid(),role,outgoing:CURRENT_USER?CURRENT_USER.mid:null,incoming:null,content:'',status:'not_started'};D.transitions.push(tr);}
  tr[field]=lines;
  saveD();closeM(null,document.getElementById('m-tr-list'));trOpenFolder(encodedRole);toast('Saved','success');
}
function trOpenAddContact(encodedRole){
  const role=decodeURIComponent(encodedRole);
  document.getElementById('tr-contact-role-enc').value=encodedRole;
  ['tr-c-name','tr-c-role','tr-c-email','tr-c-phone'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('m-tr-contact').classList.add('open');
}
function trSaveContact(){
  const encodedRole=document.getElementById('tr-contact-role-enc').value;
  const role=decodeURIComponent(encodedRole);
  const name=document.getElementById('tr-c-name').value.trim();
  if(!name){toast('Name is required','error');return;}
  let tr=D.transitions.find(t=>t.role===role);
  if(!tr){tr={id:uid(),role,outgoing:CURRENT_USER?CURRENT_USER.mid:null,incoming:null,content:'',status:'not_started',contacts:[]};D.transitions.push(tr);}
  if(!tr.contacts)tr.contacts=[];
  tr.contacts.push({name,role:document.getElementById('tr-c-role').value.trim(),email:document.getElementById('tr-c-email').value.trim(),phone:document.getElementById('tr-c-phone').value.trim()});
  saveD();closeM(null,document.getElementById('m-tr-contact'));trOpenFolder(encodedRole);toast('Contact added','success');
}
async function trDeleteContact(encodedRole,idx){
  if(!canWrite()){toast('You do not have permission to remove contacts.','error');return;}
  const ok=await confirmDialog('Remove Contact','Remove this contact from the role?');
  if(!ok)return;
  const role=decodeURIComponent(encodedRole);
  const tr=D.transitions.find(t=>t.role===role);
  if(tr&&tr.contacts){tr.contacts.splice(idx,1);saveD();trOpenFolder(encodedRole);toast('Contact removed','info');}
}
function trOpenAddDeadline(){
  document.getElementById('tr-dl-id').value='';
  document.getElementById('tr-dl-modal-title').textContent='Add Recurring Deadline';
  ['tr-dl-title','tr-dl-owner','tr-dl-when','tr-dl-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('tr-dl-pri').value='medium';
  document.getElementById('m-tr-deadline').classList.add('open');
}
function trEditDeadline(id){
  const hub=trGetTransData();
  const d=hub.deadlines.find(x=>x.id===id);if(!d)return;
  document.getElementById('tr-dl-id').value=id;
  document.getElementById('tr-dl-modal-title').textContent='Edit Deadline';
  document.getElementById('tr-dl-title').value=d.title;
  document.getElementById('tr-dl-owner').value=d.owner;
  document.getElementById('tr-dl-when').value=d.when;
  document.getElementById('tr-dl-pri').value=d.priority;
  document.getElementById('tr-dl-notes').value=d.notes||'';
  document.getElementById('m-tr-deadline').classList.add('open');
}
function trSaveDeadline(){
  const title=document.getElementById('tr-dl-title').value.trim();
  if(!title){toast('Title required','error');return;}
  const hub=trGetTransData();
  const id=document.getElementById('tr-dl-id').value;
  const data={title,owner:document.getElementById('tr-dl-owner').value.trim(),when:document.getElementById('tr-dl-when').value.trim(),priority:document.getElementById('tr-dl-pri').value,notes:document.getElementById('tr-dl-notes').value.trim()};
  if(id){const d=hub.deadlines.find(x=>x.id===id);if(d)Object.assign(d,data);}
  else hub.deadlines.push({id:uid(),...data});
  saveD();closeM(null,document.getElementById('m-tr-deadline'));trRenderDeadlines();toast('Deadline saved','success');
}
async function trDeleteDeadline(id){
  if(!canWrite()){toast('You do not have permission to delete deadlines.','error');return;}
  const ok=await confirmDialog('Delete Deadline','Remove this recurring deadline?','Delete',true);
  if(!ok)return;
  const hub=trGetTransData();hub.deadlines=hub.deadlines.filter(d=>d.id!==id);
  saveD();trRenderDeadlines();toast('Deleted','info');
}

function trOpenAddIssue(){
  document.getElementById('tr-iss-id').value='';
  document.getElementById('tr-iss-modal-title').textContent='Add Open Issue';
  ['tr-iss-title','tr-iss-owner','tr-iss-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('tr-iss-pri').value='medium';
  document.getElementById('tr-iss-status').value='open';
  document.getElementById('m-tr-issue').classList.add('open');
}
function trEditIssue(id){
  const hub=trGetTransData();
  const iss=hub.issues.find(x=>x.id===id);if(!iss)return;
  document.getElementById('tr-iss-id').value=id;
  document.getElementById('tr-iss-modal-title').textContent='Edit Issue';
  document.getElementById('tr-iss-title').value=iss.title;
  document.getElementById('tr-iss-owner').value=iss.owner||'';
  document.getElementById('tr-iss-pri').value=iss.priority;
  document.getElementById('tr-iss-status').value=iss.status;
  document.getElementById('tr-iss-notes').value=iss.notes||'';
  document.getElementById('m-tr-issue').classList.add('open');
}
function trSaveIssue(){
  const title=document.getElementById('tr-iss-title').value.trim();
  if(!title){toast('Issue title required','error');return;}
  const hub=trGetTransData();
  const id=document.getElementById('tr-iss-id').value;
  const data={title,owner:document.getElementById('tr-iss-owner').value.trim(),priority:document.getElementById('tr-iss-pri').value,status:document.getElementById('tr-iss-status').value,notes:document.getElementById('tr-iss-notes').value.trim()};
  if(id){const iss=hub.issues.find(x=>x.id===id);if(iss)Object.assign(iss,data);}
  else hub.issues.push({id:uid(),...data});
  saveD();closeM(null,document.getElementById('m-tr-issue'));trRenderIssues();toast('Issue saved','success');
}
async function trDeleteIssue(id){
  if(!canWrite()){toast('You do not have permission to delete issues.','error');return;}
  const ok=await confirmDialog('Delete Issue','Remove this open issue?','Delete',true);
  if(!ok)return;
  const hub=trGetTransData();hub.issues=hub.issues.filter(i=>i.id!==id);
  saveD();trRenderIssues();toast('Deleted','info');
}

async function trArchiveSemester(){
  if(!canWrite()){toast('You do not have permission to archive semesters.','error');return;}
  const sem=getSemester();
  const ok=await confirmDialog('Archive Semester','Archive '+sem+'? A snapshot of current transition progress will be saved. You can still edit everything after archiving.','Archive',false);
  if(!ok)return;
  const hub=trGetTransData();
  hub.archive.unshift({id:uid(),semester:sem,date:new Date().toISOString().split('T')[0],memberCount:D.members.length,completedRoles:D.transitions.filter(t=>t.status==='complete').length,notes:''});
  saveD();trRenderArchive();toast(sem+' archived','success');
}

function trPrintRole(){
  if(!TR_CURRENT)return;
  const role=TR_CURRENT;
  const pos=EXEC_POSITIONS.find(p=>p.role===role);
  const tr=D.transitions.find(t=>t.role===role);
  const posData=pos||{responsibilities:[],recurringTasks:[],wishIKnew:''};
  const w=window.open('','_blank','width=800,height=700');
  w.document.write(`<!DOCTYPE html><html><head><title>${role} Transition Doc</title><style>
    body{'font-family':'Segoe UI',system-ui,sans-serif;margin:0;padding:32px;font-size:13px;color:#1a1a18;line-height:1.6;max-width:720px}
    .header{background:#0c1d56;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px}
    h1{'font-size':20px;font-weight:700;margin:0 0 5px}
    .meta{'font-size':11px;opacity:.75;display:flex;gap:16px;flex-wrap:wrap}
    h3{'font-size':10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b6b68;margin:0 0 8px;border-top:1px solid #e5e5e3;padding-top:12px}
    li{'margin-bottom':4px;line-height:1.5}
    .box{background:#f8f8f7;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.7}
    @media print{body{padding:16px}}
  </style></head><body>
  <div class="header">
    <h1>${role} — Transition Document</h1>
    <div class="meta">
      <span>Outgoing: ${tr&&tr.outgoing?mB(tr.outgoing).name:'—'}</span>
      <span>Incoming: ${tr&&tr.incoming?mB(tr.incoming).name:'TBD'}</span>
      <span>Semester: ${getSemester()}</span>
    </div>
  </div>
  <h3>Key Responsibilities</h3><ul>${posData.responsibilities.map(r=>`<li>${r}</li>`).join('')}</ul>
  <h3>Recurring Tasks</h3><ul>${posData.recurringTasks.map(t=>`<li>${t}</li>`).join('')}</ul>
  ${tr&&tr.content?`<h3>Handoff Notes</h3><div class="box">${tr.content}</div>`:''}
  <h3>What I Wish I Knew</h3><div class="box">${(tr&&tr.wishIKnew)||posData.wishIKnew||'No advice written.'}</div>
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e5e3;font-size:10px;color:#aaa">OpsCore Platform · Printed ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
  </body></html>`);
  w.document.close();setTimeout(()=>w.print(),400);
}

function openNewTransFor(encodedRole){
  const role=decodeURIComponent(encodedRole);
  document.getElementById('ntr-r').value=role;
  const o=document.getElementById('ntr-o');o.innerHTML='<option value="">— Unassigned —</option>'+mOpts();
  document.getElementById('m-addtrans').classList.add('open');
}
function openEditTransCurrent(){
  if(!TR_CURRENT)return;
  const tr=D.transitions.find(t=>t.role===TR_CURRENT);
  if(tr)openEditTrans(tr.id);
  else openNewTransFor(encodeURIComponent(TR_CURRENT));
}


// ── ACADEMICS ──
function gpaColor(gpa){
  if(gpa===null||gpa===undefined||gpa==='')return'gpa-none';
  const g=parseFloat(gpa);
  if(g>=3.5)return'gpa-high';
  if(g>=3.0)return'gpa-good';
  if(g>=2.75)return'gpa-warn';
  return'gpa-risk';
}
function gpaTrend(gpa){
  const g=parseFloat(gpa);
  if(isNaN(g))return'';
  if(g>=3.5)return'<span style="color:var(--gn);font-size:10px">Dean\'s List</span>';
  if(g>=3.0)return'<span style="color:var(--bl);font-size:10px">Good Standing</span>';
  if(g>=2.75)return'<span style="color:var(--am);font-size:10px">Watch</span>';
  return'<span style="color:var(--rd);font-size:10px;font-weight:600">Academic Warning</span>';
}

function openUpdateGpa(){
  const sem=document.getElementById('gpa-semester');
  if(sem)sem.value=getSemester();
  filterGpaModal();
  openM('m-updategpa');
}

function gpaVal(id,field){
  const rec=D.academics.gpas[id]||{};
  return rec[field]||'';
}

function filterGpaModal(){
  const q=(document.getElementById('gpa-search')||{value:''}).value.toLowerCase();
  const cls=(document.getElementById('gpa-class-filter')||{value:'all'}).value;
  const members=D.members.filter(m=>{
    if(cls!=='all'&&m.classYear!==cls)return false;
    return m.name.toLowerCase().includes(q)||m.role.toLowerCase().includes(q);
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const list=document.getElementById('gpa-modal-list');
  if(!list)return;

  function inp(id,field,label){
    const v=gpaVal(id,field);
    return`<input type="number" id="gpa-${field}-${id}" step="0.01" min="0" max="4" value="${v}" placeholder="—"
      title="${label}"
      style="width:68px;height:28px;padding:0 6px;border:1px solid var(--bdr);border-radius:6px;font-size:11.5px;font-family:inherit;text-align:center;outline:none;transition:border .1s"
      onfocus="this.style.borderColor='var(--navy)'" onblur="this.style.borderColor='var(--bdr)'">`;
  }

  list.innerHTML=members.map(m=>{
    const cumV=gpaVal(m.id,'cumulativeGpa');
    const priV=gpaVal(m.id,'priorGpa');
    // Warning flag: use semester GPA if present, else cumulative
    const isWarn=cumV&&parseFloat(cumV)<2.75||priV&&parseFloat(priV)<2.75;
    return`<div style="display:grid;grid-template-columns:1fr 68px 68px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--bdr);${isWarn?'background:var(--rd-bg);margin:0 -2px;padding:6px 4px;border-radius:5px;':''}">
      <div style="display:flex;align-items:center;gap:8px;min-width:0">
        <div class="sh-av" style="width:24px;height:24px;font-size:8.5px;flex-shrink:0">${m.initials}</div>
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</div>
          <div style="font-size:10px;color:var(--mt)">${m.classYear}</div>
        </div>
      </div>
      ${inp(m.id,'cumulativeGpa','Cumulative GPA')}
      ${inp(m.id,'priorGpa','Last Semester GPA')}
    </div>`;
  }).join('');
}

function saveGPAs(){
  if(!D.academics)D.academics={gpas:{},history:[]};
  const members=D.members;
  let changed=0;

  function parseGpa(v){
    if(!v||v.trim()==='')return null;
    const g=parseFloat(v);
    if(isNaN(g)||g<0||g>4)return 'err';
    return(Math.round(g*100)/100).toString();
  }

  for(const m of members){
    const cumV=parseGpa((document.getElementById('gpa-cumulativeGpa-'+m.id)||{value:''}).value);
    const priV=parseGpa((document.getElementById('gpa-priorGpa-'+m.id)||{value:''}).value);
    if(cumV==='err'||priV==='err'){toast('Invalid GPA for '+m.name+': must be 0.00–4.00','error');return;}
    const cur=D.academics.gpas[m.id]||{};
    const updated={
      semesterGpa:'',
      cumulativeGpa: cumV!==null?cumV:(cur.cumulativeGpa||''),
      priorGpa: priV!==null?priV:(cur.priorGpa||''),
    };
    if(JSON.stringify(cur)!==JSON.stringify(updated)){changed++;D.academics.gpas[m.id]=updated;}
  }

  // Snapshot: chapter GPA = avg of LAST SEMESTER GPAs
  const priorGpas=members.map(m=>(D.academics.gpas[m.id]||{}).priorGpa).filter(v=>v&&v!=='').map(v=>parseFloat(v)).filter(g=>!isNaN(g));
  const useGpas=priorGpas;

  if(useGpas.length){
    const avg=(useGpas.reduce((a,b)=>a+b,0)/useGpas.length).toFixed(3);
    const sem=(document.getElementById('gpa-semester')||{value:getSemester()}).value||getSemester();
    const cumGpas=members.map(m=>(D.academics.gpas[m.id]||{}).cumulativeGpa).filter(v=>v&&v!=='').map(v=>parseFloat(v)).filter(g=>!isNaN(g));
    const cumAvg=cumGpas.length?(cumGpas.reduce((a,b)=>a+b,0)/cumGpas.length).toFixed(3):null;
    const existing=D.academics.history.findIndex(h=>h.semester===sem);
    const entry={semester:sem,chapterGpa:avg,cumulativeChapterGpa:cumAvg,memberCount:useGpas.length,date:new Date().toISOString().split('T')[0]};
    if(existing>=0)D.academics.history[existing]=entry;
    else D.academics.history.unshift(entry);
  }

  saveD();
  closeM(null,document.getElementById('m-updategpa'));
  renderAcademics();
  toast('GPAs updated for '+changed+' member'+(changed!==1?'s':'')+(changed===0?' (no changes)':''),changed?'success':'info');
}

function filterAc(){
  const q=(document.getElementById('ac-search')||{value:''}).value.toLowerCase();
  const cls=(document.getElementById('ac-filter')||{value:'all'}).value;
  document.querySelectorAll('#ac-table tbody tr').forEach(tr=>{
    const matchQ=(tr.dataset.name||'').toLowerCase().includes(q);
    const matchC=cls==='all'||(tr.dataset.class||'')===cls;
    tr.style.display=(matchQ&&matchC)?'':'none';
  });
}

function renderAcademics(){
  if(!D.academics)D.academics={gpas:{},history:[]};

  // Build member GPA objects with all three values
  function getMemberGpas(m){
    const rec=D.academics.gpas[m.id]||{};
    const sem=rec.semesterGpa&&rec.semesterGpa!==''?parseFloat(rec.semesterGpa):null;
    const cum=rec.cumulativeGpa&&rec.cumulativeGpa!==''?parseFloat(rec.cumulativeGpa):null;
    const pri=rec.priorGpa&&rec.priorGpa!==''?parseFloat(rec.priorGpa):null;
    return{m,sem,cum,pri,hasAny:sem!==null||cum!==null||pri!==null};
  }
  const allMemberGpas=D.members.map(getMemberGpas);
  const withAny=allMemberGpas.filter(x=>x.hasAny);

  // Chapter GPA = prior semester avg (per spec); fallback to semester avg
  const hist=D.academics.history;
  const latestHist=hist[0]||null;
  const chapterGpaDisplay=latestHist?parseFloat(latestHist.chapterGpa).toFixed(2):null;

  // For KPIs: use semester GPA if present for warnings/deans list (current standing)
  const withCum=allMemberGpas.filter(x=>x.cum!==null);
  const withPri=allMemberGpas.filter(x=>x.pri!==null);
  const deansList=withCum.filter(x=>x.cum>=3.5).length;
  const goodStand=withCum.filter(x=>x.cum>=3.0&&x.cum<3.5).length;
  // Warning: flag by cumulative, or last semester if no cumulative
  const warnMembers=withAny.filter(x=>{
    const check=x.cum!==null?x.cum:(x.pri!==null?x.pri:null);
    return check!==null&&check<2.75;
  });

  // KPIs
  document.getElementById('ac-kpi').innerHTML=
    kpi('Chapter GPA',chapterGpaDisplay||'—',latestHist?'Prior semester · '+latestHist.semester:'No history yet — save GPAs to record','neutral')+
    kpi("Dean's List",deansList,'3.50 and above (cumulative)',deansList>0?'up':'neutral')+
    kpi('Good Standing',goodStand,'3.00 – 3.49 (cumulative)','neutral')+
    kpi('Academic Warnings',warnMembers.length,'Below 2.75',warnMembers.length>0?'down':'neutral');

  // Sort by cumulative GPA descending for ranking, then semester, then prior
  const ranked=[...withAny].sort((a,b)=>{
    const ag=a.cum??a.pri??0;
    const bg=b.cum??b.pri??0;
    return bg-ag;
  });
  const noGpa=allMemberGpas.filter(x=>!x.hasAny);

  // Main table
  document.getElementById('ac-table').innerHTML=`<thead><tr>
    <th>#</th><th>Member</th><th>Class</th>
    <th style="text-align:center">Cumulative GPA</th>
    <th style="text-align:center">Last Semester</th>
    <th>Status</th>
  </tr></thead><tbody>${[
    ...ranked.map((x,i)=>({...x,rank:i+1})),
    ...noGpa.map(x=>({...x,rank:null}))
  ].map(row=>{
    const warn=(row.cum!==null&&row.cum<2.75)||(row.cum===null&&row.pri!==null&&row.pri<2.75);
    const statusGpa=row.cum??row.pri??null;
    return`<tr data-name="${row.m.name}" data-class="${row.m.classYear}"${warn?' style="background:var(--rd-bg)"':''}>
      <td style="color:var(--ht);font-size:11px">${row.rank||'—'}</td>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div class="sh-av" style="width:24px;height:24px;font-size:8.5px${warn?';background:var(--rd);color:#fff':''}">${row.m.initials}</div>
        <span style="font-weight:500">${row.m.name}</span>
      </div></td>
      <td style="color:var(--mt)">${row.m.classYear}</td>
      <td style="text-align:center"><span class="gpa-badge ${gpaColor(row.cum)}">${row.cum!==null?row.cum.toFixed(2):'—'}</span></td>
      <td style="text-align:center"><span class="gpa-badge ${gpaColor(row.pri)}">${row.pri!==null?row.pri.toFixed(2):'—'}</span></td>
      <td>${gpaTrend(statusGpa)}</td>
    </tr>`;
  }).join('')}</tbody>`;

  // Top 5 by cumulative GPA
  const top=ranked.slice(0,5);
  document.getElementById('ac-top').innerHTML=top.length?top.map((x,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bdr)">
      <div class="ac-rank ac-rank-${i+1}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500">${x.m.name}</div>
        <div style="font-size:10px;color:var(--mt)">${x.m.classYear}</div>
      </div>
      <div style="text-align:right">
        ${x.cum!==null?`<span class="gpa-badge gpa-high" style="display:block;margin-bottom:2px">${x.cum.toFixed(2)} cum</span>`:''}
        ${x.pri!==null?`<span class="gpa-badge gpa-good" style="display:block">${x.pri.toFixed(2)} last sem</span>`:''}
      </div>
    </div>`).join(''):'<div style="color:var(--ht);font-size:12px;padding:8px 0;text-align:center">No GPAs entered yet</div>';

  // Warnings panel
  const warnEl=document.getElementById('ac-warn');
  const warnEmpty=document.getElementById('ac-warn-empty');
  if(warnMembers.length){
    warnEmpty.style.display='none';
    warnEl.innerHTML=warnMembers.sort((a,b)=>{
      const ag=a.cum??a.pri??4;const bg=b.cum??b.pri??4;return ag-bg;
    }).map(x=>`
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bdr)">
        <div class="sh-av" style="width:24px;height:24px;font-size:8.5px;background:var(--rd);color:#fff">${x.m.initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500">${x.m.name}</div>
          <div style="font-size:10px;color:var(--mt)">${x.m.classYear}</div>
        </div>
        <div style="text-align:right;display:flex;flex-direction:column;gap:2px">
          ${x.cum!==null?`<span class="gpa-badge gpa-risk" style="font-size:9px">${x.cum.toFixed(2)} cum</span>`:''}
          ${x.pri!==null?`<span class="gpa-badge ${gpaColor(x.pri)}" style="font-size:9px">${x.pri.toFixed(2)} last sem</span>`:''}
        </div>
      </div>`).join('');
  } else {
    warnEmpty.style.display='block';
    warnEmpty.innerHTML=es('ti-circle-check','green','All in good standing','No members below the 2.75 GPA threshold.','');
    warnEl.innerHTML='';
  }

  // Distribution (based on semester GPA; fallback to cumulative)
  const distGpas=withAny.map(x=>x.cum??x.pri??null).filter(g=>g!==null);
  const buckets=[
    {label:"3.50 – 4.00 (Dean's List)",min:3.5,max:4.01,color:'var(--gn)'},
    {label:'3.00 – 3.49 (Good Standing)',min:3.0,max:3.5,color:'var(--bl)'},
    {label:'2.75 – 2.99 (Watch)',min:2.75,max:3.0,color:'var(--am)'},
    {label:'Below 2.75 (Warning)',min:0,max:2.75,color:'var(--rd)'},
  ];
  document.getElementById('ac-dist').innerHTML=buckets.map(b=>{
    const n=distGpas.filter(g=>g>=b.min&&g<b.max).length;
    const pct=distGpas.length?Math.round(n/distGpas.length*100):0;
    return`<div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
        <span style="color:var(--mt)">${b.label}</span><span style="font-weight:500">${n}</span>
      </div>
      <div class="pb"><div class="pf" style="width:${pct}%;background:${b.color}"></div></div>
    </div>`;
  }).join('');

  // History table
  const histEl=document.getElementById('ac-history');
  const histEmpty=document.getElementById('ac-history-empty');
  if(hist.length){
    histEmpty.style.display='none';
    histEl.innerHTML=`<div class="tw"><table class="tbl">
      <thead><tr>
        <th>Semester</th>
        <th style="text-align:center">Chapter GPA<br><span style="font-weight:400;font-size:9px;color:var(--ht)">(last sem avg)</span></th>
        <th style="text-align:center">Cumulative Avg</th>
        <th>Members</th><th>Updated</th><th>vs Prior</th>
      </tr></thead>
      <tbody>${hist.map((h,i)=>{
        const prior=hist[i+1];
        let delta='';
        if(prior){const d=(parseFloat(h.chapterGpa)-parseFloat(prior.chapterGpa));delta=`<span style="color:${d>=0?'var(--gn)':'var(--rd)'}">${d>=0?'↑':'↓'}${Math.abs(d).toFixed(3)}</span>`;}
        return`<tr>
          <td style="font-weight:500">${h.semester}</td>
          <td style="text-align:center"><span class="gpa-badge ${gpaColor(h.chapterGpa)}">${parseFloat(h.chapterGpa).toFixed(2)}</span></td>
          <td style="text-align:center">${h.cumulativeChapterGpa?`<span class="gpa-badge ${gpaColor(h.cumulativeChapterGpa)}">${parseFloat(h.cumulativeChapterGpa).toFixed(2)}</span>`:'<span style="color:var(--ht)">—</span>'}</td>
          <td style="color:var(--mt)">${h.memberCount}</td>
          <td style="color:var(--ht)">${fds(h.date)}</td>
          <td>${delta||'<span style="color:var(--ht)">—</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  } else {
    histEmpty.style.display='block';
    histEmpty.innerHTML=es('ti-chart-line','blue','No GPA history yet','Use "Update GPAs" each semester to build a historical record of chapter academic performance.','');
    histEl.innerHTML='';
  }
}

// Redraw line chart on window resize
window.addEventListener('resize',()=>{
  if(document.getElementById('page-analytics')?.classList.contains('active')){
    anDrawLine();
  }
});

// ═══════════════════════════════════════════
// RECRUITMENT CRM
// ═══════════════════════════════════════════

const RC_STAGES=['New Lead','Contacted','Attended Event','Active Rush','Interviewed','Bid Ready','Bid Extended','Accepted'];
const RC_STAGE_COLORS=['#9eb5d8','#378add','#ef9f27','#1d9e75','#7b5ea7','#e24b4a','#0c1d56','#1d9e75'];
const RC_TAGS=['Athlete','Legacy','Leadership','Good Fit','Needs Follow-up','Academics','Social Fit','Hot Prospect','Greek Life','Community'];
const RC_TAG_CLASSES={Athlete:'athlete',Legacy:'legacy',Leadership:'leader','Hot Prospect':'hot','Good Fit':'active','Needs Follow-up':'dnb'};

let RC_DRAG_ID=null;
let RC_ACTIVE_TAB='rc-overview';

// Recruitment uses real data only — no seeded demo rushees or events

// ── BID SCORE HELPERS ──
function rcScoreBadge(score){
  if(score>=85)return{cls:'hot',label:'Strong Bid'};
  if(score>=70)return{cls:'good',label:'Possible Bid'};
  if(score>=50)return{cls:'mid',label:'Needs Eval'};
  if(score>=30)return{cls:'low',label:'Monitor'};
  return{cls:'dnb',label:'Do Not Bid'};
}
function rcScoreEl(score){const b=rcScoreBadge(score);return`<span class="rc-score ${b.cls}">${score}</span>`;}
function rcStageColor(stage){const i=RC_STAGES.indexOf(stage);return RC_STAGE_COLORS[i]||'#aaa';}
function rcStageBadgeStyle(stage){return`background:${rcStageColor(stage)}22;color:${rcStageColor(stage)};font-size:9.5px;font-weight:600;padding:2px 8px;border-radius:99px`;}

// ── TAB SWITCHER ──
function rcTab(btn,tabId){
  document.querySelectorAll('.rc-tab').forEach(t=>{
    t.style.color='var(--mt)';t.style.borderBottom='none';t.style.marginBottom='0';
  });
  if(btn){btn.style.color='var(--navy)';btn.style.borderBottom='2px solid var(--navy)';btn.style.marginBottom='-2px';}
  document.querySelectorAll('#page-recruitment > div[id^="rc-"]').forEach(d=>d.style.display='none');
  const el=document.getElementById(tabId);if(el)el.style.display='block';
  RC_ACTIVE_TAB=tabId;
  if(tabId==='rc-overview')rcRenderOverview();
  if(tabId==='rc-rushees')rcRenderTable();
  if(tabId==='rc-pipeline')rcRenderKanban();
  if(tabId==='rc-events')rcRenderEvents();
}

// ── MAIN RENDER ──
function renderRecruitment(){
  // Reset to overview tab
  document.querySelectorAll('.rc-tab').forEach((t,i)=>{
    t.style.color=i===0?'var(--navy)':'var(--mt)';
    t.style.borderBottom=i===0?'2px solid var(--navy)':'none';
    t.style.marginBottom=i===0?'-2px':'0';
  });
  document.querySelectorAll('#page-recruitment > div[id^="rc-"]').forEach((d,i)=>d.style.display=i===0?'block':'none');
  RC_ACTIVE_TAB='rc-overview';
  rcRenderOverview();
}

// ── OVERVIEW ──
function rcRenderOverview(){
  const rushees=D.recruitment.rushees||[];
  const hot=rushees.filter(r=>r.bidScore>=70).length;
  const bidReady=rushees.filter(r=>['Bid Ready','Bid Extended','Accepted'].includes(r.stage)).length;
  const totalEvAtt=rushees.reduce((s,r)=>s+r.eventsAttended,0);
  const RCG=D.recruitment.goal||{target:20,label:'New Members This Semester'};
  const paceColor=rushees.length>=RCG.target?'up':'neutral';
  document.getElementById('rc-kpi').innerHTML=
    kpi('Total Rushees',rushees.length,`${rushees.length} of ${RCG.target} goal`,rushees.length>=RCG.target?'up':'neutral')+
    kpi('Hot Prospects',hot,'Score 70+',hot>0?'up':'neutral')+
    kpi('Event Attendances',totalEvAtt,'Across all rushees','neutral')+
    kpi('Bid Ready',bidReady,'Ready to extend',bidReady>0?'up':'neutral');

  // Funnel
  const funnelEl=document.getElementById('rc-funnel-wrap');
  const stageCounts=RC_STAGES.map(s=>({stage:s,count:rushees.filter(r=>r.stage===s).length}));
  const maxCount=Math.max(...stageCounts.map(s=>s.count),1);
  funnelEl.innerHTML=`<div style="display:flex;gap:2px;margin-bottom:6px">${stageCounts.map((s,i)=>{
    const pct=Math.max(18,Math.round(s.count/maxCount*100));
    const col=RC_STAGE_COLORS[i];
    const name=s.stage.replace(' ','\n');
    return`<div class="rc-funnel-stage" onclick="rcFilterToStage('${s.stage}')">
      <div class="rc-funnel-bar" style="background:${col};height:${pct}px;border-radius:4px 4px 0 0;min-height:18px" title="${s.stage}: ${s.count}">
        <span style="font-size:9px;font-weight:700">${s.count||''}</span>
      </div>
      <div class="rc-funnel-label">${s.stage.replace(' ','<br>')}</div>
    </div>`;
  }).join('')}</div>`;

  // Alerts
  const alertsEl=document.getElementById('rc-alerts');
  const alerts=[];
  const stale=rushees.filter(r=>{if(!r.lastContact)return r.stage!=='New Lead';const days=Math.round((new Date()-new Date(r.lastContact+'T12:00:00'))/(86400000));return days>5&&!['Accepted','Bid Extended'].includes(r.stage);});
  if(stale.length)alerts.push({icon:'ti-clock',bg:'background:var(--am-bg)',ic:'color:var(--am-tx)',title:`${stale.length} rushee${stale.length>1?'s':''} not contacted in 5+ days`,body:stale.slice(0,2).map(r=>r.name).join(', ')+(stale.length>2?` +${stale.length-2} more`:'')});
  const br=rushees.filter(r=>r.stage==='Bid Ready');
  if(br.length)alerts.push({icon:'ti-star',bg:'background:var(--gn-bg)',ic:'color:var(--gn-tx)',title:`${br.length} rushee${br.length>1?'s':''} are Bid Ready`,body:br.map(r=>r.name).join(', ')});
  const nextEv=(D.recruitment.events||[]).filter(e=>isUp(e.date)).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(nextEv){const days=Math.round((new Date(nextEv.date+'T12:00:00')-new Date())/86400000);if(days<=2)alerts.push({icon:'ti-calendar-event',bg:'background:var(--bl-bg)',ic:'color:var(--bl-tx)',title:`"${nextEv.name}" ${days===0?'is today':days===1?'is tomorrow':'in '+days+' days'}`,body:nextEv.time+(nextEv.location?' · '+nextEv.location:'')});}
  const newNoContact=rushees.filter(r=>r.stage==='New Lead'&&!r.lastContact);
  if(newNoContact.length)alerts.push({icon:'ti-user-question',bg:'background:var(--rd-bg)',ic:'color:var(--rd-tx)',title:`${newNoContact.length} new lead${newNoContact.length>1?'s':''} never contacted`,body:'Assign recruiters and start conversations'});
  alertsEl.innerHTML=alerts.length?alerts.map(a=>`<div class="d-alert-row"><div class="d-alert-icon" style="${a.bg}"><i class="ti ${a.icon}" style="${a.ic}"></i></div><div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:500">${a.title}</div><div style="font-size:10.5px;color:var(--mt);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.body}</div></div></div>`).join(''):`<div style="padding:16px;text-align:center;color:var(--mt);font-size:11.5px"><i class="ti ti-circle-check" style="color:var(--gn);font-size:18px;display:block;margin:0 auto 5px"></i>No urgent alerts</div>`;

  // Upcoming events
  const upEvEl=document.getElementById('rc-upcoming-events');
  const upEv=(D.recruitment.events||[]).filter(e=>isUp(e.date)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  upEvEl.innerHTML=upEv.length?upEv.map(e=>{const days=Math.max(0,Math.round((new Date(e.date+'T12:00:00')-new Date())/86400000));const cls=days===0?'urgent':days<=3?'soon':'';return`<div class="ev-row"><div class="ev-dt"><div class="ev-day">${dom(e.date)}</div><div class="ev-mo">${mos(e.date)}</div></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.name}</div><div style="font-size:10.5px;color:var(--mt)">${e.time}${e.location?' · '+e.location:''}</div></div><span class="d-countdown ${cls}"><i class="ti ti-clock" style="font-size:9px"></i>${days===0?'Today':days===1?'Tomorrow':days+'d'}</span></div>`;}).join(''):es('ti-calendar-off','blue','No rush events scheduled','Add upcoming rush events to track your recruitment.',`<button class="btn" onclick="rcOpenAddEvent()"><i class="ti ti-plus"></i>Add Event</button>`);

  // Leaderboard — all members with Recruitment Chair role
  const ldrEl=document.getElementById('rc-leaderboard');
  const RECRUITERS=D.members.filter(m=>m.role==='Recruitment Chair').map(m=>m.id);
  const ldr=RECRUITERS.map(id=>{
    const m=mB(id);
    const assigned=rushees.filter(r=>r.recruiter===id).length;
    const bids=rushees.filter(r=>r.recruiter===id&&['Bid Ready','Bid Extended','Accepted'].includes(r.stage)).length;
    const convRate=assigned>0?Math.round(bids/assigned*100):0;
    return{m,assigned,bids,convRate};
  });
  const totalAccepted=rushees.filter(r=>r.stage==='Accepted').length;
  const RCG2=D.recruitment.goal||{target:20,label:'New Members This Semester'};
  const pctOfGoal=Math.round(rushees.length/RCG2.target*100);
  ldrEl.innerHTML=`
    <div style="background:linear-gradient(135deg,var(--navy) 0%,#1a3a8c 100%);border-radius:9px;padding:11px 13px;margin-bottom:11px;color:#fff">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;opacity:.7">${RCG2.label}</div>
        <button onclick="rcOpenGoalEdit()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:5px;color:#fff;font-size:10px;padding:2px 8px;cursor:pointer;font-family:inherit">Edit Goal</button>
      </div>
      <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:7px">
        <span style="font-size:24px;font-weight:700">${rushees.length}</span>
        <span style="font-size:12px;opacity:.7">/ ${RCG2.target} goal</span>
      </div>
      <div style="height:5px;background:rgba(255,255,255,.2);border-radius:99px;overflow:hidden">
        <div style="height:100%;background:#fff;border-radius:99px;width:${Math.min(100,pctOfGoal)}%;transition:width .6s ease"></div>
      </div>
      <div style="font-size:10px;opacity:.7;margin-top:5px">${pctOfGoal}% of goal · ${Math.max(0,RCG2.target-rushees.length)} more to hit target</div>
    </div>
    ${ldr.map((l,i)=>`<div class="rc-ldr-row">
      <div class="sh-av" style="width:28px;height:28px;font-size:9.5px">${l.m.initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500">${l.m.name}</div>
        <div style="font-size:10px;color:var(--ht)">${l.assigned} assigned · ${l.bids} bid ready</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;font-weight:600;color:var(--navy)">${l.convRate}%</div>
        <div style="font-size:9.5px;color:var(--ht)">conv. rate</div>
      </div>
    </div>`).join('')}`;
}

// ── RUSHEE TABLE ──
function rcFilterToStage(stage){
  rcTab(document.querySelector('[data-tab="rc-rushees"]'),'rc-rushees');
  setTimeout(()=>{document.getElementById('rc-filter-status').value=stage;rcFilterRushees();},50);
}

function rcRenderTable(){
  const rushees=rcGetFiltered();
  const el=document.getElementById('rc-table');
  if(!el)return;
  el.innerHTML=`<thead><tr><th>Name</th><th>Year</th><th>Major</th><th>Recruiter</th><th>Stage</th><th>Events</th><th>Score</th><th>Last Contact</th><th></th></tr></thead><tbody>${rushees.map(r=>{
    const recName=r.recruiter?mB(r.recruiter).name.split(' ')[0]:'—';
    const daysSince=r.lastContact?Math.round((new Date()-new Date(r.lastContact+'T12:00:00'))/86400000):null;
    const contactColor=daysSince===null?'var(--ht)':daysSince>7?'var(--rd)':daysSince>4?'var(--am)':'var(--gn)';
    return`<tr style="cursor:pointer" onclick="rcOpenProfile('${r.id}')">
      <td><div style="display:flex;align-items:center;gap:7px"><div class="sh-av" style="width:24px;height:24px;font-size:8.5px">${r.initials}</div><span style="font-weight:500">${r.name}</span></div></td>
      <td style="color:var(--mt)">${r.year}</td>
      <td style="color:var(--mt);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.major}</td>
      <td style="color:var(--mt)">${recName}</td>
      <td><span style="${rcStageBadgeStyle(r.stage)}">${r.stage}</span></td>
      <td style="text-align:center">${r.eventsAttended}</td>
      <td>${rcScoreEl(r.bidScore)}</td>
      <td style="color:${contactColor};font-size:11px">${r.lastContact?daysSince+'d ago':'Never'}</td>
      <td style="white-space:nowrap"><button class="btn" style="height:23px;font-size:10px;padding:0 7px;margin-right:3px" onclick="event.stopPropagation();rcOpenProfile('${r.id}')"><i class="ti ti-eye"></i></button><button class="btn btn-d" style="height:23px;font-size:10px;padding:0 7px" onclick="event.stopPropagation();deleteRushee('${r.id}')"><i class="ti ti-trash"></i></button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="9" style="text-align:center;padding:22px;color:var(--mt)">No rushees found</td></tr>'}</tbody>`;
}

function rcGetFiltered(){
  const q=(document.getElementById('rc-search')||{value:''}).value.toLowerCase();
  const st=(document.getElementById('rc-filter-status')||{value:''}).value;
  const sort=(document.getElementById('rc-sort')||{value:'score'}).value;
  let rushees=[...(D.recruitment.rushees||[])];
  if(q)rushees=rushees.filter(r=>r.name.toLowerCase().includes(q)||r.major.toLowerCase().includes(q)||r.hometown.toLowerCase().includes(q));
  if(st)rushees=rushees.filter(r=>r.stage===st);
  if(sort==='score')rushees.sort((a,b)=>b.bidScore-a.bidScore);
  else if(sort==='name')rushees.sort((a,b)=>a.name.localeCompare(b.name));
  else if(sort==='last')rushees.sort((a,b)=>(b.lastContact||'').localeCompare(a.lastContact||''));
  else if(sort==='events')rushees.sort((a,b)=>b.eventsAttended-a.eventsAttended);
  return rushees;
}

function rcFilterRushees(){rcRenderTable();}

// ── KANBAN ──
function rcRenderKanban(){
  const KANBAN_STAGES=['New Lead','Contacted','Active Rush','Interviewed','Bid Ready','Bid Extended'];
  const kanban=document.getElementById('rc-kanban');
  if(!kanban)return;
  const stageColors={};
  RC_STAGES.forEach((s,i)=>{stageColors[s]=RC_STAGE_COLORS[i];});
  kanban.innerHTML=KANBAN_STAGES.map(stage=>{
    const rushees=(D.recruitment.rushees||[]).filter(r=>r.stage===stage);
    const col=stageColors[stage]||'#aaa';
    return`<div class="rc-col">
      <div class="rc-col-head" style="border-top-color:${col}">
        <span style="font-size:11.5px;font-weight:500">${stage}</span>
        <span style="font-size:10.5px;color:var(--mt)">${rushees.length}</span>
      </div>
      <div class="rc-col-body rc-col-drop" id="kd-${stage.replace(/ /g,'_')}"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="rcDrop(event,'${stage}')">
        ${rushees.map(r=>`<div class="rc-card" draggable="true" id="kc-${r.id}"
          ondragstart="rcDragStart('${r.id}')"
          ondragend="document.querySelectorAll('.rc-col-drop').forEach(c=>c.classList.remove('drag-over'))"
          onclick="rcOpenProfile('${r.id}')">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:5px">
            <div style="display:flex;align-items:center;gap:6px">
              <div class="sh-av" style="width:22px;height:22px;font-size:8px;flex-shrink:0">${r.initials}</div>
              <span style="font-size:12px;font-weight:500;line-height:1.3">${r.name}</span>
            </div>
            ${rcScoreEl(r.bidScore)}
          </div>
          <div style="font-size:10.5px;color:var(--mt);margin-bottom:5px">${r.year} · ${r.major}</div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:10px;color:var(--ht)">${r.eventsAttended} event${r.eventsAttended!==1?'s':''} · ${r.recruiter?mB(r.recruiter).name.split(' ')[0]:'Unassigned'}</div>
            ${r.tags.length?`<span class="rc-tag ${RC_TAG_CLASSES[r.tags[0]]||''}" style="font-size:9px">${r.tags[0]}</span>`:''}
          </div>
        </div>`).join('')||`<div style="padding:14px;text-align:center;font-size:11px;color:var(--ht)">Drop here</div>`}
      </div>
    </div>`;
  }).join('');
}

function rcDragStart(id){RC_DRAG_ID=id;}
function rcDrop(event,stage){
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if(!RC_DRAG_ID)return;
  const r=D.recruitment.rushees.find(x=>x.id===RC_DRAG_ID);
  if(r&&r.stage!==stage){
    r.stage=stage;
    // Recalculate bid score when moving stages
    const baseScores={'New Lead':10,'Contacted':25,'Attended Event':45,'Active Rush':60,'Interviewed':72,'Bid Ready':82,'Bid Extended':88,'Accepted':92};
    if(baseScores[stage])r.bidScore=Math.max(r.bidScore,baseScores[stage]);
    r.lastContact=new Date().toISOString().split('T')[0];
    saveD();rcRenderKanban();
    toast(r.name+' moved to '+stage,'success');
  }
  RC_DRAG_ID=null;
}

// ── RUSH EVENTS ──
function rcRenderEvents(){
  const events=D.recruitment.events||[];
  const total=events.length;
  const upcoming=events.filter(e=>isUp(e.date)).length;
  const past=events.filter(e=>!isUp(e.date)).length;
  document.getElementById('rc-event-kpi').innerHTML=
    kpi('Total Events',total,'This semester','neutral')+
    kpi('Upcoming',upcoming,'Scheduled','neutral')+
    kpi('Completed',past,'Past events','neutral');
  const typeColors={'Open House':'var(--bl)','Team Building Event':'var(--gn)','Invite Only':'var(--navy)','Philanthropy':'var(--rd)','Athletics':'var(--am)','Study Event':'var(--mt)','Rush Dinner':'var(--navy)'};
  document.getElementById('rc-events-table').innerHTML=`<thead><tr><th>Event</th><th>Type</th><th>Date</th><th>Time</th><th>Location</th><th>RSVP</th><th>Recruiters</th></tr></thead><tbody>${events.sort((a,b)=>a.date.localeCompare(b.date)).map(e=>`<tr><td style="font-weight:500">${e.name}</td><td><span class="badge" style="background:${typeColors[e.type]||'#f0f0ee'}22;color:${typeColors[e.type]||'var(--mt)'}">${e.type}</span></td><td>${fd(e.date)}</td><td style="color:var(--mt)">${e.time}</td><td style="color:var(--mt)">${e.location||'—'}</td><td style="text-align:center">${e.rsvp||'—'}</td><td style="color:var(--mt)">${e.recruiters.map(id=>mB(id).name.split(' ')[0]).join(', ')||'—'}</td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--mt)">No events yet</td></tr>'}</tbody>`;
}

// ── RUSHEE PROFILE ──
function rcOpenProfile(id){
  const r=D.recruitment.rushees.find(x=>x.id===id);
  if(!r)return;
  const modal=document.getElementById('m-rc-profile');
  document.getElementById('rcp-av').textContent=r.initials;
  document.getElementById('rcp-name').textContent=r.name;
  document.getElementById('rcp-sub').textContent=r.year+' · '+r.major+(r.hometown?' · '+r.hometown:'');
  const sb=document.getElementById('rcp-stage-badge');
  sb.textContent=r.stage;sb.style.cssText=rcStageBadgeStyle(r.stage);
  const scoreEl=document.getElementById('rcp-score-badge');
  const bd=rcScoreBadge(r.bidScore);
  scoreEl.textContent=r.bidScore+' — '+bd.label;scoreEl.className='rc-score '+bd.cls;

  const recName=r.recruiter?mB(r.recruiter).name:'Unassigned';
  const daysSince=r.lastContact?Math.round((new Date()-new Date(r.lastContact+'T12:00:00'))/86400000):null;
  const rcEvents=(D.recruitment.events||[]).filter(e=>!isUp(e.date)).slice(0,r.eventsAttended);

  document.getElementById('rcp-body').innerHTML=`
    <div class="rc-profile-grid" style="margin-bottom:16px">
      <!-- Left: Info + scoring -->
      <div>
        <div class="card-t" style="margin-bottom:8px">Basic Info</div>
        <div class="rc-stat"><span style="color:var(--mt)">Year</span><span style="font-weight:500">${r.year}</span></div>
        <div class="rc-stat"><span style="color:var(--mt)">Major</span><span style="font-weight:500">${r.major}</span></div>
        <div class="rc-stat"><span style="color:var(--mt)">Hometown</span><span style="font-weight:500">${r.hometown||'—'}</span></div>
        <div class="rc-stat"><span style="color:var(--mt)">Interests</span><span style="font-weight:500;font-size:11px">${r.interests||'—'}</span></div>
        <div class="rc-stat"><span style="color:var(--mt)">Recruiter</span><span style="font-weight:500">${recName}</span></div>
        <div class="rc-stat"><span style="color:var(--mt)">Last Contact</span><span style="font-weight:500;color:${daysSince===null?'var(--ht)':daysSince>7?'var(--rd)':'var(--tx)'}">${daysSince===null?'Never':daysSince+'d ago'}</span></div>
        <div style="margin-top:11px"><div class="card-t" style="margin-bottom:7px">Tags</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">${(r.tags||[]).map(t=>`<span class="rc-tag ${RC_TAG_CLASSES[t]||''}">${t}</span>`).join('')||'<span style="font-size:11px;color:var(--ht)">No tags</span>'}
            <button class="rc-tag" onclick="rcAddTag('${r.id}')"><i class="ti ti-plus" style="font-size:9px"></i></button>
          </div>
        </div>
      </div>
      <!-- Right: Scoring breakdown -->
      <div>
        <div class="card-t" style="margin-bottom:8px">Bid Score Breakdown</div>
        <div style="text-align:center;margin-bottom:11px">
          <div style="font-size:32px;font-weight:700;color:${rcStageColor(r.stage)}">${r.bidScore}</div>
          <div style="font-size:11px;color:var(--mt)">${rcScoreBadge(r.bidScore).label}</div>
        </div>
        ${[
          {l:'Event Attendance',v:Math.min(100,r.eventsAttended*20)},
          {l:'Engagement',v:Math.min(100,(r.notes||[]).length*25)},
          {l:'Stage Progress',v:Math.round(RC_STAGES.indexOf(r.stage)/RC_STAGES.length*100)},
        ].map(x=>`<div class="pr"><span class="pl" style="width:120px">${x.l}</span><div class="pb"><div class="pf" style="width:${x.v}%;background:${rcStageColor(r.stage)}"></div></div><span class="pv">${x.v}%</span></div>`).join('')}
        <div style="margin-top:13px">
          <select id="rcp-stage-sel" style="width:100%;height:29px;padding:0 9px;border:1px solid var(--bdr);border-radius:7px;font-size:12px;font-family:inherit;background:var(--surf);color:var(--tx);outline:none;margin-bottom:6px" onchange="rcUpdateStage('${r.id}',this.value)">
            ${RC_STAGES.map(s=>`<option value="${s}"${s===r.stage?' selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <!-- Events attended -->
    <div style="margin-bottom:14px">
      <div class="card-t" style="margin-bottom:8px">Event Attendance (${r.eventsAttended})</div>
      ${rcEvents.length?rcEvents.map(e=>`<div class="d-feed-row"><div class="d-feed-av" style="background:var(--bl-bg);color:var(--bl)"><i class="ti ti-calendar-check" style="font-size:11px"></i></div><div style="flex:1"><div style="font-size:11.5px;font-weight:500">${e.name}</div><div style="font-size:10px;color:var(--ht)">${fd(e.date)} · ${e.type}</div></div></div>`).join(''):`<div style="font-size:11.5px;color:var(--ht)">No events attended yet</div>`}
    </div>
    <!-- Notes -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="card-t">Conversation Notes</div>
        <button class="btn" style="height:24px;font-size:10.5px" onclick="rcAddNote('${r.id}')"><i class="ti ti-plus"></i>Add Note</button>
      </div>
      <div id="rcp-notes">${(r.notes||[]).length?(r.notes||[]).slice().reverse().map(n=>`<div class="rc-note" style="margin-bottom:7px"><div class="rc-note-meta"><span>${mB(n.by).name}</span><span>${fds(n.date)}</span></div>${n.text}</div>`).join(''):`<div style="font-size:11.5px;color:var(--ht)">No notes yet — add your first observation.</div>`}
      </div>
    </div>`;

  modal.classList.add('open');
}

function rcUpdateStage(id,stage){
  const r=D.recruitment.rushees.find(x=>x.id===id);
  if(!r)return;
  r.stage=stage;r.lastContact=new Date().toISOString().split('T')[0];
  saveD();
  // Update badge in modal header
  const sb=document.getElementById('rcp-stage-badge');
  if(sb){sb.textContent=stage;sb.style.cssText=rcStageBadgeStyle(stage);}
  toast(r.name+' stage updated to '+stage,'success');
  if(RC_ACTIVE_TAB==='rc-rushees')rcRenderTable();
  if(RC_ACTIVE_TAB==='rc-pipeline')rcRenderKanban();
}

function rcAddNote(rusheeId){
  const text=prompt('Add note for this rushee:');
  if(!text||!text.trim())return;
  const r=D.recruitment.rushees.find(x=>x.id===rusheeId);
  if(!r)return;
  if(!r.notes)r.notes=[];
  r.notes.push({text:text.trim(),by:CURRENT_USER?CURRENT_USER.mid:null,date:new Date().toISOString().split('T')[0]});
  r.lastContact=new Date().toISOString().split('T')[0];
  saveD();rcOpenProfile(rusheeId);toast('Note added','success');
}

function rcAddTag(rusheeId){
  const r=D.recruitment.rushees.find(x=>x.id===rusheeId);
  if(!r)return;
  const available=RC_TAGS.filter(t=>!(r.tags||[]).includes(t));
  if(!available.length){toast('All tags already added','info');return;}
  const tag=prompt('Add tag:\n'+available.join(', '));
  if(!tag||!available.includes(tag)){toast('Invalid tag','error');return;}
  if(!r.tags)r.tags=[];
  r.tags.push(tag);saveD();rcOpenProfile(rusheeId);
}

// ── ADD RUSHEE ──
function rcOpenAdd(){
  const sel=document.getElementById('rca-rec');
  // Only Recruitment Chairs are recruiters
  const recruiters=D.members.filter(m=>m.role==='Recruitment Chair'||m.role==='President'||m.role==='Vice President');
  sel.innerHTML='<option value="">Unassigned</option>'+recruiters.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  const tagsEl=document.getElementById('rca-tags');
  tagsEl.innerHTML=RC_TAGS.map(t=>`<span class="rc-tag" onclick="this.classList.toggle('active')" data-tag="${t}">${t}</span>`).join('');
  ['rca-name','rca-major','rca-home','rca-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('m-rc-add').classList.add('open');
}

function rcAddRushee(){
  if(!canWrite()){toast('You do not have permission to add rushees.','error');return;}
  const name=document.getElementById('rca-name').value.trim();
  if(!name){toast('Name is required','error');return;}
  const tags=[...document.getElementById('rca-tags').querySelectorAll('.rc-tag.active')].map(t=>t.dataset.tag);
  const ini=name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const stage=document.getElementById('rca-stage').value;
  const scoreMap={'New Lead':10,'Contacted':25,'Attended Event':45,'Active Rush':60,'Interviewed':72,'Bid Ready':82,'Bid Extended':88,'Accepted':92};
  D.recruitment.rushees.push({id:'r'+uid(),name,firstName:name.split(' ')[0],lastName:name.split(' ').slice(1).join(' '),initials:ini,year:document.getElementById('rca-year').value,major:document.getElementById('rca-major').value,hometown:document.getElementById('rca-home').value,stage,recruiter:document.getElementById('rca-rec').value,eventsAttended:0,bidScore:scoreMap[stage]||10,lastContact:'',notes:document.getElementById('rca-notes').value.trim()?[{text:document.getElementById('rca-notes').value.trim(),by:CURRENT_USER?CURRENT_USER.mid:null,date:new Date().toISOString().split('T')[0]}]:[],tags,interests:''});
  saveD();closeM(null,document.getElementById('m-rc-add'));
  if(RC_ACTIVE_TAB==='rc-rushees')rcRenderTable();
  else if(RC_ACTIVE_TAB==='rc-pipeline')rcRenderKanban();
  else rcRenderOverview();
  toast(name+' added to recruitment pipeline','success');
}

// ── ADD RUSH EVENT ──
function rcOpenAddEvent(){
  const dateEl=document.getElementById('rce-date');if(dateEl)dateEl.value=new Date().toISOString().split('T')[0];
  ['rce-name','rce-time','rce-loc','rce-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('m-rc-event').classList.add('open');
}

function rcAddEvent(){
  if(!canWrite()){toast('You do not have permission to add rush events.','error');return;}
  const name=document.getElementById('rce-name').value.trim();
  if(!name){toast('Event name is required','error');return;}
  D.recruitment.events.push({id:'re'+uid(),name,type:document.getElementById('rce-type').value,date:document.getElementById('rce-date').value,time:document.getElementById('rce-time').value,location:document.getElementById('rce-loc').value,rsvp:parseInt(document.getElementById('rce-rsvp').value)||0,notes:document.getElementById('rce-notes').value,recruiters:[CURRENT_USER?CURRENT_USER.mid:null],attendees:[]});
  saveD();closeM(null,document.getElementById('m-rc-event'));
  if(RC_ACTIVE_TAB==='rc-events')rcRenderEvents();
  else rcRenderOverview();
  toast('Rush event added','success');
}

// ═══════════════════════════════════════════
// FINANCE & DUES MANAGEMENT
// ═══════════════════════════════════════════

const FIN_SEMESTER_DUES_DEFAULT = 0; // No default — must be set by Treasurer
const FIN_BUDGET_CATS = ['Housing Rent','Housing Upper Crust','Housing Mike','Housing Miscellaneous','Utilities Electric','Utilities Alliant Energy','Utilities Waste Management','Administrative IFC Dues','Administrative YouTube/TV','Events Greek Week','Events House Maintenance','Events Social','Events Chaplain','Events Philanthropy','Events Moms Day','Events Alumni','Scholarship','Miscellaneous'];
const FIN_CAT_COLORS = {'Housing Rent':'var(--navy)','Housing Upper Crust':'var(--navy)','Housing Mike':'var(--navy)','Housing Miscellaneous':'var(--navy)','Utilities Electric':'var(--am)','Utilities Alliant Energy':'var(--am)','Utilities Waste Management':'var(--am)','Administrative IFC Dues':'var(--mt)','Administrative YouTube/TV':'var(--mt)','Events Greek Week':'var(--bl)','Events House Maintenance':'var(--bl)','Events Social':'var(--bl)','Events Chaplain':'var(--bl)','Events Philanthropy':'var(--rd)','Events Moms Day':'var(--bl)','Events Alumni':'var(--bl)','Scholarship':'var(--gn)','Miscellaneous':'var(--ht)'};
const FIN_CAT_ICONS = {'Housing Rent':'ti-home','Housing Upper Crust':'ti-home','Housing Mike':'ti-home','Housing Miscellaneous':'ti-home','Utilities Electric':'ti-bolt','Utilities Alliant Energy':'ti-flame','Utilities Waste Management':'ti-recycle','Administrative IFC Dues':'ti-building','Administrative YouTube/TV':'ti-device-tv','Events Greek Week':'ti-trophy','Events House Maintenance':'ti-tool','Events Social':'ti-confetti','Events Chaplain':'ti-book','Events Philanthropy':'ti-heart','Events Moms Day':'ti-heart-handshake','Events Alumni':'ti-users-group','Scholarship':'ti-school','Miscellaneous':'ti-dots'};
let FIN_ACTIVE_TAB = 'fin-overview';
let FIN_CAN_EDIT = false;
// Dynamic dues — reads from D.settings based on member type (inHouse / outOfHouse / pledge)
function getSemDues(memberId){
  const m = memberId ? D.members.find(x=>x.id===memberId) : null;
  const s = D.settings||{};
  // Per-member override takes priority
  const override = D.finance?.dues?.[memberId]?.customDues;
  if(override) return override;
  // Determine type: pledge = Freshman, inHouse = liveIn, outOfHouse = !liveIn
  if(m) {
    if(m.classYear==='Freshman') return s.duesPledge||0;
    if(m.liveIn) return s.duesInHouse||0;
    return s.duesOutOfHouse||0;
  }
  // Fallback for overview: use in-house as representative
  return s.duesInHouse||s.duesOutOfHouse||s.duesPledge||0;
}
function getSemDuesDisplay(){
  const s=D.settings||{};
  const ih=s.duesInHouse||0; const oh=s.duesOutOfHouse||0; const pl=s.duesPledge||0;
  if(!ih&&!oh&&!pl) return 'Not set';
  return `In: $${ih} / Out: $${oh} / Pledge: $${pl}`;
}

// ── PERMISSION CHECK ──
function finCheckPerms(){
  if(!CURRENT_USER)return false;
  return['President','Vice President','Treasurer'].includes(CURRENT_USER.title);
}

// Finance uses real data only — no seeded demo content

// ── TAB SWITCHER ──
function finTab(btn,tabId){
  document.querySelectorAll('.fin-tab').forEach(t=>{t.classList.remove('active');});
  if(btn){btn.classList.add('active');}
  document.querySelectorAll('#page-finance > div[id^="fin-"]').forEach(d=>d.style.display='none');
  const el=document.getElementById(tabId);if(el)el.style.display='block';
  FIN_ACTIVE_TAB=tabId;
  const map={
    'fin-overview':finRenderOverview,
    'fin-dues':finRenderDues,
    'fin-national':finRenderNational,
    'fin-fines':finRenderFines,
    'fin-budget':finRenderBudget,
    'fin-plans':finRenderPlans,
    'fin-settings':finRenderSettings,
  };
  if(map[tabId])map[tabId]();
  // Show/hide edit controls based on permission
  ['fin-add-payment-btn','fin-add-fine-btn','fin-add-expense-btn','fin-add-plan-btn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=finCheckPerms()?'':'none';
  });
}

// ── MAIN RENDER ──
function renderFinance(){
  // Initialize empty collections — no seeded fake data
  if(!D.finance.dues)D.finance.dues={};
  if(!D.finance.fines)D.finance.fines=[];
  if(!D.finance.expenses)D.finance.expenses=[];
  if(!D.finance.payments)D.finance.payments=[];
  if(!D.finance.plans)D.finance.plans=[];
  // Reset tabs
  document.querySelectorAll('.fin-tab').forEach((t,i)=>{t.classList.toggle('active',i===0);});
  document.querySelectorAll('#page-finance > div[id^="fin-"]').forEach((d,i)=>d.style.display=i===0?'block':'none');
  FIN_ACTIVE_TAB='fin-overview';
  finRenderOverview();
}

// ── OVERVIEW ──
function finRenderOverview(){
  const dues=D.finance.dues||{};
  const members=D.members;
  const totalOwe=members.reduce((s,m)=>s+((dues[m.id]?.semesterDues||getSemDues(m.id))-(dues[m.id]?.paid||0)),0);
  const paidCount=members.filter(m=>(dues[m.id]?.status||'Partial')==='Paid').length;
  const paidPct=members.length?Math.round(paidCount/members.length*100):0;
  const totalFines=(D.finance.fines||[]).filter(f=>f.status==='Unpaid').reduce((s,f)=>s+f.amount,0);
  const totalCollected=members.reduce((s,m)=>s+(dues[m.id]?.paid||0),0);
  const budgetSpent=(D.finance.expenses||[]).reduce((s,e)=>s+e.amount,0);
  const totalBudget=Object.values(D.finance.budget||{}).reduce((a,b)=>a+b,0);
  const cashFlow=totalCollected-budgetSpent;

  document.getElementById('fin-kpi').innerHTML=
    kpi('Outstanding Dues','$'+totalOwe.toLocaleString(),members.length-paidCount+' members unpaid',totalOwe>2000?'down':'neutral')+
    kpi('Collection Rate',paidPct+'%',paidCount+' / '+members.length+' paid',paidPct>=85?'up':paidPct>=70?'neutral':'down')+
    kpi('Chapter Cash Flow','$'+cashFlow.toLocaleString(),'Collected minus spent',cashFlow>=0?'up':'down')+
    kpi('Outstanding Fines','$'+totalFines.toLocaleString(),(D.finance.fines||[]).filter(f=>f.status==='Unpaid').length+' unpaid fines',totalFines>200?'down':'neutral');

  // Health
  const healthEl=document.getElementById('fin-health');
  const health=paidPct>=80&&totalFines<500?{cls:'healthy',icon:'ti-circle-check',ic:'color:var(--gn)',label:'Healthy',desc:`${paidPct}% dues collected · Fines under control`}:paidPct>=60?{cls:'warning',icon:'ti-alert-triangle',ic:'color:var(--am-tx)',label:'Warning',desc:`${100-paidPct}% of members still owe dues · Monitor closely`}:{cls:'critical',icon:'ti-alert-circle',ic:'color:var(--rd)',label:'Critical',desc:`Low collection rate · Immediate action required`};
  healthEl.innerHTML=`<div class="fin-health ${health.cls}"><i class="ti ${health.icon}" style="${health.ic};font-size:18px"></i><div><div style="font-size:13px;font-weight:600">${health.label}</div><div style="font-size:11px;margin-top:2px">${health.desc}</div></div></div>`;

  // Alerts
  const alertsEl=document.getElementById('fin-alerts');
  const alerts=[];
  const overdue=members.filter(m=>dues[m.id]?.status==='Overdue');
  if(overdue.length)alerts.push({icon:'ti-alert-circle',bg:'background:var(--rd-bg)',ic:'color:var(--rd-tx)',title:`${overdue.length} member${overdue.length>1?'s':''} overdue on dues`,body:overdue.slice(0,2).map(m=>m.name.split(' ')[0]).join(', ')+(overdue.length>2?` +${overdue.length-2} more`:'')});
  const unpaidFines=(D.finance.fines||[]).filter(f=>f.status==='Unpaid');
  if(unpaidFines.length)alerts.push({icon:'ti-gavel',bg:'background:var(--am-bg)',ic:'color:var(--am-tx)',title:`$${unpaidFines.reduce((s,f)=>s+f.amount,0)} in unpaid fines`,body:`${unpaidFines.length} fine${unpaidFines.length>1?'s':''} outstanding`});
  const nearLimit=FIN_BUDGET_CATS.filter(cat=>{const sp=(D.finance.expenses||[]).filter(e=>e.category===cat).reduce((s,e)=>s+e.amount,0);const bud=D.finance.budget[cat]||0;return bud>0&&sp/bud>.85;});
  if(nearLimit.length)alerts.push({icon:'ti-chart-pie',bg:'background:var(--bl-bg)',ic:'color:var(--bl-tx)',title:`${nearLimit.join(', ')} budget${nearLimit.length>1?'s':''} near limit`,body:'Over 85% of budget spent'});
  alertsEl.innerHTML=alerts.length?alerts.map(a=>`<div class="d-alert-row"><div class="d-alert-icon" style="${a.bg}"><i class="ti ${a.icon}" style="${a.ic}"></i></div><div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:500">${a.title}</div><div style="font-size:10.5px;color:var(--mt);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.body}</div></div></div>`).join(''):`<div style="padding:14px;text-align:center;color:var(--mt);font-size:11.5px"><i class="ti ti-circle-check" style="color:var(--gn);font-size:17px;display:block;margin:0 auto 4px"></i>Finances in good shape</div>`;

  // Budget overview
  const budEl=document.getElementById('fin-budget-overview');
  budEl.innerHTML=FIN_BUDGET_CATS.map(cat=>{
    const spent=(D.finance.expenses||[]).filter(e=>e.category===cat).reduce((s,e)=>s+e.amount,0);
    const bud=D.finance.budget[cat]||0;
    const pct=bud?Math.min(100,Math.round(spent/bud*100)):0;
    const col=pct>=90?'var(--rd)':pct>=70?'var(--am)':FIN_CAT_COLORS[cat]||'var(--navy)';
    return`<div class="pr"><span class="pl" style="width:110px"><i class="ti ${FIN_CAT_ICONS[cat]} " style="font-size:11px;color:var(--ht);margin-right:4px"></i>${cat}</span><div class="pb"><div class="pf" style="width:${pct}%;background:${col}"></div></div><span style="font-size:10.5px;color:var(--mt);width:80px;text-align:right;flex-shrink:0">$${spent} / $${bud}</span></div>`;
  }).join('');

  // Recent payments feed
  const feedEl=document.getElementById('fin-feed');
  const payments=[...(D.finance.payments||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  feedEl.innerHTML=payments.length?payments.map(p=>`<div class="fin-pay-row"><div class="fin-pay-icon" style="background:var(--gn-bg)"><i class="ti ti-cash" style="color:var(--gn)"></i></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">${mB(p.memberId).name.split(' ')[0]} paid $${p.amount} <span style="font-weight:400;color:var(--mt)">(${p.type})</span></div><div style="font-size:10px;color:var(--ht)">${fds(p.date)} · via ${p.method}</div></div><span style="font-size:11px;font-weight:600;color:var(--gn)">+$${p.amount}</span></div>`).join(''):`<div style="color:var(--ht);font-size:11.5px;padding:10px 0">No payments recorded yet.</div>`;

  // Deadlines
  const dlEl=document.getElementById('fin-deadlines');
  const deadlines=[
    {label:'Fall Dues Deadline',date:'2026-10-01',type:'dues'},
    {label:'House Rent Payment',date:'2026-10-05',type:'house'},
    {label:'National Dues Remittance',date:'2026-10-15',type:'national'},
    {label:'Payment Plans Due',date:'2026-09-30',type:'plan'},
  ];
  dlEl.innerHTML=deadlines.map(d=>{
    const days=Math.max(0,Math.round((new Date(d.date+'T12:00:00')-new Date())/86400000));
    const cls=days===0?'urgent':days<=3?'soon':'';
    const icons={dues:'ti-cash',house:'ti-home',national:'ti-building-bank',plan:'ti-calendar'};
    return`<div class="ev-row"><div class="ev-dt"><div class="ev-day">${dom(d.date)}</div><div class="ev-mo">${mos(d.date)}</div></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">${d.label}</div><div style="font-size:10.5px;color:var(--mt)">${fd(d.date)}</div></div><span class="d-countdown ${cls}"><i class="ti ti-clock" style="font-size:9px"></i>${days===0?'Today':days+'d'}</span></div>`;
  }).join('');

  // Who Owes What — quick view
  const whoOwesEl=document.getElementById('fin-who-owes');
  if(whoOwesEl){
    const unpaid=members.filter(m=>(dues[m.id]?.status||'Partial')!=='Paid').sort((a,b)=>{
      const balA=(dues[a.id]?.semesterDues||getSemDues(a.id))-(dues[a.id]?.paid||0);
      const balB=(dues[b.id]?.semesterDues||getSemDues(b.id))-(dues[b.id]?.paid||0);
      return balB-balA;
    });
    if(!unpaid.length){whoOwesEl.innerHTML=`<div style="padding:14px;text-align:center;font-size:11.5px;color:var(--mt)"><i class="ti ti-circle-check" style="color:var(--gn);font-size:17px;display:block;margin:0 auto 4px"></i>All dues collected!</div>`;return;}
    whoOwesEl.innerHTML=unpaid.slice(0,12).map(m=>{
      const d=dues[m.id]||{};
      const owed=(d.semesterDues||getSemDues(m?.id||memberId))-(d.paid||0);
      const pct=Math.round((d.paid||0)/(d.semesterDues||getSemDues(m?.id||memberId))*100);
      const stat=d.status||'Partial';
      const sc={Overdue:'var(--rd)',Partial:'var(--am)',Paid:'var(--gn)','Payment Plan':'var(--bl)'}[stat]||'var(--mt)';
      return`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bdr)">
        <div class="sh-av" style="width:23px;height:23px;font-size:8px">${m.initials}</div>
        <div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</div></div>
        <div style="width:50px;height:4px;background:#f0f0ee;border-radius:99px;overflow:hidden;flex-shrink:0"><div style="height:100%;width:${pct}%;background:${sc};border-radius:99px"></div></div>
        <span style="font-size:11px;font-weight:700;color:${sc};width:36px;text-align:right;flex-shrink:0">$${owed}</span>
        <button class="btn" style="height:22px;font-size:10px;padding:0 7px;flex-shrink:0" onclick="finOpenProfile('${m.id}')"><i class="ti ti-edit"></i></button>
      </div>`;
    }).join('')+(unpaid.length>12?`<div style="font-size:11px;color:var(--mt);text-align:center;padding:7px 0;cursor:pointer" onclick="finTab(document.querySelector('[data-tab=fin-dues]'),'fin-dues')">+${unpaid.length-12} more → View all dues</div>`:'');
  }
}

// ── MEMBER DUES TABLE ──
function finRenderDues(){
  const dues=D.finance.dues||{};
  const paid=D.members.filter(m=>(dues[m.id]?.status||'Partial')==='Paid').length;
  const ov=D.members.filter(m=>dues[m.id]?.status==='Overdue').length;
  const total=D.members.reduce((s,m)=>s+(dues[m.id]?.paid||0),0);
  document.getElementById('fin-dues-kpi').innerHTML=
    kpi('Collected','$'+total.toLocaleString(),paid+' fully paid','neutral')+
    kpi('Outstanding','$'+D.members.reduce((s,m)=>s+((dues[m.id]?.semesterDues||getSemDues(m.id))-(dues[m.id]?.paid||0)),0).toLocaleString(),'Still owed','neutral')+
    kpi('Overdue',ov,'Past deadline',ov?'down':'neutral')+
    kpi('On Payment Plan',(D.finance.plans||[]).filter(p=>p.status!=='Completed').length,'Active plans','neutral');
  finFilterDues();
}

function finFilterDues(){
  const q=(document.getElementById('fin-search')||{value:''}).value.toLowerCase();
  const st=(document.getElementById('fin-filter-pay')||{value:''}).value;
  const dues=D.finance.dues||{};
  const statusBadge={Paid:'bg2',Partial:'ba2',Overdue:'br2','Payment Plan':'bb2'};
  let rows=D.members.filter(m=>{
    if(q&&!m.name.toLowerCase().includes(q))return false;
    if(st&&(dues[m.id]?.status||'Partial')!==st)return false;
    return true;
  });
  const tbl=document.getElementById('fin-dues-table');
  if(!tbl)return;
  tbl.innerHTML=`<thead><tr><th>Member</th><th>Class</th><th>Semester Dues</th><th>Paid</th><th>Balance</th><th>Status</th><th>Last Payment</th><th>Fines</th><th></th></tr></thead><tbody>${rows.map(m=>{
    const d=dues[m.id]||{semesterDues:getSemDues(m.id),paid:0,status:'Partial',lastPayment:'',fineCount:0};
    const bal=d.semesterDues-d.paid;
    const st=d.status||'Partial';
    return`<tr class="fin-member-row" onclick="finOpenProfile('${m.id}')">
      <td><div style="display:flex;align-items:center;gap:7px"><div class="sh-av" style="width:24px;height:24px;font-size:8.5px">${m.initials}</div><span style="font-weight:500">${m.name}</span></div></td>
      <td style="color:var(--mt)">${m.classYear}</td>
      <td>$${d.semesterDues}</td>
      <td style="color:var(--gn);font-weight:500">$${d.paid}</td>
      <td style="color:${bal>0?'var(--rd)':'var(--gn)'};font-weight:600">$${bal}</td>
      <td><span class="badge ${statusBadge[st]||'bm2'}">${st}</span></td>
      <td style="color:var(--mt)">${d.lastPayment?fds(d.lastPayment):'Never'}</td>
      <td style="text-align:center">${d.fineCount>0?`<span class="badge br2">${d.fineCount}</span>`:'—'}</td>
      <td><button class="btn" style="height:23px;font-size:10px;padding:0 7px" onclick="event.stopPropagation();finOpenProfile('${m.id}')"><i class="ti ti-eye"></i></button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="9" style="text-align:center;padding:22px;color:var(--mt)">No members found</td></tr>'}</tbody>`;
}

// ── FINES TABLE ──
function finRenderFines(){
  const fines=D.finance.fines||[];
  const unpaid=fines.filter(f=>f.status==='Unpaid');
  const total=fines.reduce((s,f)=>s+f.amount,0);
  const outstanding=unpaid.reduce((s,f)=>s+f.amount,0);
  document.getElementById('fin-fines-kpi').innerHTML=
    kpi('Total Fines',fines.length,'Issued this semester','neutral')+
    kpi('Outstanding','$'+outstanding,'Unpaid',outstanding?'down':'neutral')+
    kpi('Collected','$'+(total-outstanding),'Paid','neutral');
  const statusBadge={Paid:'bg2',Unpaid:'br2'};
  const typeColors={'Attendance':'var(--am)','Late Payment':'var(--rd)','Damage':'var(--rd)','Judicial':'var(--navy)','Other':'var(--mt)'};
  document.getElementById('fin-fines-table').innerHTML=`<thead><tr><th>Member</th><th>Type</th><th>Amount</th><th>Reason</th><th>Date Issued</th><th>Status</th><th></th></tr></thead><tbody>${fines.sort((a,b)=>b.date.localeCompare(a.date)).map(f=>{
    const m=mB(f.memberId);
    return`<tr><td><div style="display:flex;align-items:center;gap:6px"><div class="sh-av" style="width:22px;height:22px;font-size:8px">${m.initials}</div><span style="font-weight:500">${m.name}</span></div></td>
    <td><span style="font-size:10px;font-weight:500;color:${typeColors[f.type]||'var(--mt)'}">${f.type}</span></td>
    <td style="font-weight:600;color:var(--rd)">$${f.amount}</td>
    <td style="color:var(--mt)">${f.reason}</td>
    <td style="color:var(--mt)">${fds(f.date)}</td>
    <td><span class="badge ${statusBadge[f.status]||'bm2'}">${f.status}</span></td>
    <td style="white-space:nowrap">${f.status==='Unpaid'&&finCheckPerms()?`<button class="btn" style="height:22px;font-size:10px;padding:0 7px;margin-right:3px" onclick="finMarkFinePaid('${f.id}')"><i class="ti ti-check"></i>Paid</button>`:''}${finCheckPerms()?`<button class="btn btn-d" style="height:22px;font-size:10px;padding:0 7px" onclick="deleteFineFn('${f.id}')"><i class="ti ti-trash"></i></button>`:''}</td></tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--mt)">No fines issued</td></tr>'}</tbody>`;
}

// ── BUDGET ──
function finRenderBudget(){
  const budEl=document.getElementById('fin-budget-cards');
  budEl.innerHTML=`<div style="display:flex;flex-direction:column;gap:9px">${FIN_BUDGET_CATS.map(cat=>{
    const spent=(D.finance.expenses||[]).filter(e=>e.category===cat).reduce((s,e)=>s+e.amount,0);
    const bud=D.finance.budget[cat]||0;
    const pct=bud?Math.min(100,Math.round(spent/bud*100)):0;
    const rem=bud-spent;
    const col=pct>=90?'var(--rd)':pct>=70?'var(--am)':FIN_CAT_COLORS[cat]||'var(--navy)';
    return`<div class="card" style="padding:11px 13px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:7px"><i class="ti ${FIN_CAT_ICONS[cat]}" style="color:${col};font-size:14px"></i><span style="font-size:12.5px;font-weight:500">${cat}</span></div>
        <div style="font-size:11px;color:var(--mt)">$${spent} <span style="color:var(--ht)">/ $${bud}</span></div>
      </div>
      <div class="fin-budget-bar"><div class="fin-budget-fill" style="width:${pct}%;background:${col}"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10.5px">
        <span style="color:${pct>=90?'var(--rd)':'var(--mt)'}">${pct}% spent</span>
        <span style="color:${rem<0?'var(--rd)':'var(--gn)'};font-weight:600">$${rem} remaining</span>
      </div>
    </div>`;
  }).join('')}</div>`;

  // Expense log
  const exp=[...(D.finance.expenses||[])].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('fin-expense-log').innerHTML=`<thead><tr><th>Category</th><th>Description</th><th>Amount</th><th>Officer</th><th>Date</th><th></th></tr></thead><tbody>${exp.map(e=>`<tr><td><span style="font-size:10px;font-weight:600;color:${FIN_CAT_COLORS[e.category]||'var(--mt)'}">${e.category}</span></td><td style="font-weight:500">${e.desc}</td><td style="color:var(--rd);font-weight:600">$${e.amount}</td><td style="color:var(--mt)">${mB(e.officer).name.split(' ')[0]}</td><td style="color:var(--mt)">${fds(e.date)}</td><td>${finCheckPerms()?`<button class="btn btn-d" style="height:22px;font-size:10px;padding:0 7px" onclick="deleteExpense('${e.id}')"><i class="ti ti-trash"></i></button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--mt)">No expenses logged</td></tr>'}</tbody>`;
}

// ── FINANCE SETTINGS ──
function finRenderSettings(){
  if(!D.settings)D.settings={};
  const s=D.settings;
  // In-House
  const ih=document.getElementById('fin-dues-inhouse');if(ih)ih.value=s.duesInHouse||'';
  const ihd=document.getElementById('fin-dues-inhouse-date');if(ihd)ihd.value=s.duesInHouseDate||'';
  // Out-of-House
  const oh=document.getElementById('fin-dues-outofhouse');if(oh)oh.value=s.duesOutOfHouse||'';
  const ohd=document.getElementById('fin-dues-outofhouse-date');if(ohd)ohd.value=s.duesOutOfHouseDate||'';
  // Pledge
  const pl=document.getElementById('fin-dues-newmember');if(pl)pl.value=s.duesPledge||'';
  const pld=document.getElementById('fin-dues-newmember-date');if(pld)pld.value=s.duesPledgeDate||'';
  // National
  const na=document.getElementById('fin-dues-national');if(na)na.value=s.duesNational||'';
  const nad=document.getElementById('fin-dues-national-date');if(nad)nad.value=s.duesNationalDate||'';

  const statusEl=document.getElementById('fin-dues-status');
  if(statusEl){
    const ih=s.duesInHouse||0, oh=s.duesOutOfHouse||0, pl=s.duesPledge||0, na=s.duesNational||0;
    if(!ih&&!oh&&!pl){
      statusEl.textContent='Dues not yet configured. Set amounts above then click Save.';
      statusEl.style.color='var(--am-tx)';
    } else {
      statusEl.textContent=`In-House: $${ih} · Out-of-House: $${oh} · Pledge: $${pl} · National: $${na?'$'+na:'Not set'}`;
      statusEl.style.color='var(--gn-tx)';
    }
  }
  const budInputs=document.getElementById('fin-budget-inputs');
  if(budInputs){
    budInputs.innerHTML=FIN_BUDGET_CATS.map(cat=>`
      <div style="display:flex;align-items:center;gap:9px">
        <i class="ti ${FIN_CAT_ICONS[cat]||'ti-cash'}" style="font-size:13px;color:${FIN_CAT_COLORS[cat]||'var(--mt)'};width:16px;flex-shrink:0"></i>
        <label style="font-size:12px;font-weight:500;flex:1">${cat}</label>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:12px;color:var(--mt)">$</span>
          <input type="number" id="fin-bud-${cat.replace(/\s+/g,'-')}" value="${(D.finance.budget||{})[cat]||0}" min="0" step="50"
            style="width:90px;height:28px;padding:0 7px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;font-family:inherit;color:var(--tx);outline:none;text-align:right"
            oninput="finUpdateBudgetTotal()" onfocus="this.style.borderColor='var(--navy)'" onblur="this.style.borderColor='var(--bdr)'">
        </div>
      </div>`).join('');
    finUpdateBudgetTotal();
  }
}
function finUpdateBudgetTotal(){
  const totalEl=document.getElementById('fin-budget-total');if(!totalEl)return;
  const total=FIN_BUDGET_CATS.reduce((s,cat)=>{const el=document.getElementById('fin-bud-'+cat.replace(/\s+/g,'-'));return s+(el?parseFloat(el.value)||0:0);},0);
  totalEl.textContent='Total: $'+total.toLocaleString();
}
function finSaveDuesSettings(){
  if(!D.settings)D.settings={};
  D.settings.duesInHouse=parseFloat(document.getElementById('fin-dues-inhouse')?.value)||0;
  D.settings.duesInHouseDate=document.getElementById('fin-dues-inhouse-date')?.value||'';
  D.settings.duesOutOfHouse=parseFloat(document.getElementById('fin-dues-outofhouse')?.value)||0;
  D.settings.duesOutOfHouseDate=document.getElementById('fin-dues-outofhouse-date')?.value||'';
  D.settings.duesPledge=parseFloat(document.getElementById('fin-dues-newmember')?.value)||0;
  D.settings.duesPledgeDate=document.getElementById('fin-dues-newmember-date')?.value||'';
  D.settings.duesNational=parseFloat(document.getElementById('fin-dues-national')?.value)||0;
  D.settings.duesNationalDate=document.getElementById('fin-dues-national-date')?.value||'';
  saveD();finRenderSettings();toast('Dues settings saved','success');
}
function finApplyDuesToAll(){
  const s=D.settings||{};
  if(!s.duesInHouse&&!s.duesOutOfHouse&&!s.duesPledge){toast('Set dues amounts first then click Apply','error');return;}
  if(!D.finance.dues)D.finance.dues={};
  D.members.forEach(m=>{
    const amount=getSemDues(m.id);
    if(!D.finance.dues[m.id])D.finance.dues[m.id]={paid:0,status:'Partial',lastPayment:'',fineCount:0,notes:'',restriction:'None'};
    D.finance.dues[m.id].semesterDues=amount;
    const paid=D.finance.dues[m.id].paid||0;
    D.finance.dues[m.id].status=paid>=amount?'Paid':paid>0?'Partial':'Partial';
  });
  saveD();finRenderSettings();toast('Dues applied to all '+D.members.length+' members based on member type','success');
}
function finSaveBudget(){
  if(!D.finance.budget)D.finance.budget={};
  FIN_BUDGET_CATS.forEach(cat=>{const el=document.getElementById('fin-bud-'+cat.replace(/\s+/g,'-'));if(el)D.finance.budget[cat]=parseFloat(el.value)||0;});
  saveD();finRenderSettings();toast('Budget saved','success');
}

// ── NATIONAL DUES ──
function finRenderNational(){
  if(!D.finance.nationalDues)D.finance.nationalDues={};
  const natAmt=D.settings?.duesNational||0;
  const dues=D.finance.nationalDues;
  const paid=D.members.filter(m=>dues[m.id]?.status==='Paid').length;
  const total=D.members.length;
  const totalOwed=D.members.reduce((s,m)=>s+(natAmt-(dues[m.id]?.paid||0)),0);
  document.getElementById('fin-natl-kpi').innerHTML=
    kpi('National Dues Rate',natAmt?'$'+natAmt:'Not set','Per member this semester','neutral')+
    kpi('Paid',paid,paid+' / '+total+' members',paid===total&&total>0?'up':'neutral')+
    kpi('Outstanding','$'+Math.max(0,totalOwed).toLocaleString(),(total-paid)+' members unpaid',totalOwed>0?'down':'neutral')+
    kpi('Total Collected','$'+D.members.reduce((s,m)=>s+(dues[m.id]?.paid||0),0).toLocaleString(),'National dues received','neutral');
  finFilterNational();
}
function finFilterNational(){
  const q=(document.getElementById('fin-natl-search')||{value:''}).value.toLowerCase();
  const flt=(document.getElementById('fin-natl-filter')||{value:''}).value;
  const natAmt=D.settings?.duesNational||0;
  if(!D.finance.nationalDues)D.finance.nationalDues={};
  const dues=D.finance.nationalDues;
  let rows=D.members.map(m=>{
    const d=dues[m.id]||{paid:0,status:'Unpaid',lastPayment:''};
    return {m,d,owed:Math.max(0,natAmt-(d.paid||0)),status:d.paid>=(natAmt||Infinity)&&natAmt>0?'Paid':d.paid>0?'Partial':'Unpaid'};
  });
  if(q)rows=rows.filter(r=>r.m.name.toLowerCase().includes(q));
  if(flt)rows=rows.filter(r=>r.status===flt);
  const canEdit=finCheckPerms();
  const tbl=document.getElementById('fin-natl-table');if(!tbl)return;
  tbl.innerHTML=`<thead><tr><th>Member</th><th>Class</th><th>National Dues</th><th>Paid</th><th>Balance</th><th>Status</th><th>Last Payment</th>${canEdit?'<th></th>':''}</tr></thead>
  <tbody>${rows.map(({m,d,owed,status})=>`<tr>
    <td><div style="display:flex;align-items:center;gap:6px"><div class="sh-av" style="width:22px;height:22px;font-size:8px">${m.initials}</div><span style="font-weight:500">${m.name}</span></div></td>
    <td style="color:var(--mt)">${m.classYear}</td>
    <td style="color:var(--mt)">$${natAmt}</td>
    <td style="color:var(--gn);font-weight:500">$${d.paid||0}</td>
    <td style="color:${owed>0?'var(--rd)':'var(--gn)'};font-weight:600">$${owed}</td>
    <td><span class="badge ${status==='Paid'?'bg2':status==='Partial'?'ba2':'bm2'}">${status}</span></td>
    <td style="color:var(--ht)">${d.lastPayment?fds(d.lastPayment):'—'}</td>
    ${canEdit?`<td><button class="btn btn-p" style="height:22px;font-size:10px;padding:0 7px" onclick="finOpenNationalPaymentFor('${m.id}')"><i class="ti ti-plus"></i>Pay</button></td>`:''}
  </tr>`).join('')||`<tr><td colspan="8" style="text-align:center;padding:18px;color:var(--ht)">No members found.</td></tr>`}
  </tbody>`;
}
function finOpenNationalPayment(){
  const sel=document.getElementById('fnatl-member');if(!sel)return;
  sel.innerHTML=D.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  document.getElementById('fnatl-amount').value='';
  document.getElementById('fnatl-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('fnatl-notes').value='';
  document.getElementById('m-fin-national').classList.add('open');
}
function finOpenNationalPaymentFor(memberId){
  finOpenNationalPayment();
  const sel=document.getElementById('fnatl-member');if(sel)sel.value=memberId;
}
function finRecordNationalPayment(){
  const memberId=document.getElementById('fnatl-member').value;
  const amount=parseFloat(document.getElementById('fnatl-amount').value);
  if(!memberId||isNaN(amount)||amount<=0){toast('Member and amount are required','error');return;}
  const date=document.getElementById('fnatl-date').value||new Date().toISOString().split('T')[0];
  const notes=document.getElementById('fnatl-notes').value.trim();
  const natAmt=D.settings?.duesNational||0;
  if(!D.finance.nationalDues)D.finance.nationalDues={};
  if(!D.finance.nationalDues[memberId])D.finance.nationalDues[memberId]={paid:0,status:'Unpaid',lastPayment:''};
  D.finance.nationalDues[memberId].paid=(D.finance.nationalDues[memberId].paid||0)+amount;
  D.finance.nationalDues[memberId].lastPayment=date;
  D.finance.nationalDues[memberId].status=D.finance.nationalDues[memberId].paid>=natAmt&&natAmt>0?'Paid':D.finance.nationalDues[memberId].paid>0?'Partial':'Unpaid';
  if(notes)D.finance.nationalDues[memberId].notes=notes;
  if(!D.finance.nationalPayments)D.finance.nationalPayments=[];
  D.finance.nationalPayments.unshift({id:uid(),memberId,amount,date,notes});
  saveD();closeM(null,document.getElementById('m-fin-national'));
  toast('National dues payment of $'+amount+' recorded for '+mB(memberId).name.split(' ')[0],'success');
  finRenderNational();
}

// ── PAYMENT PLANS ──
function finRenderPlans(){
  const plans=D.finance.plans||[];
  const active=plans.filter(p=>p.status!=='Completed');
  const tbl=document.getElementById('fin-plans-table');
  if(!tbl)return;
  tbl.innerHTML=`<thead><tr><th>Member</th><th>Total</th><th>Paid</th><th>Remaining</th><th>Next Due</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody>${plans.length?plans.map(p=>{
    const m=mB(p.memberId);
    const rem=p.total-p.paid;
    const pct=Math.round(p.paid/p.total*100);
    const status=p.paid>=p.total?'complete':isOv(p.nextDue)?'late':'on-track';
    const labels={'on-track':'On Track','late':'Late','complete':'Completed'};
    return`<tr><td><div style="display:flex;align-items:center;gap:6px"><div class="sh-av" style="width:22px;height:22px;font-size:8px">${m.initials}</div><span style="font-weight:500">${m.name}</span></div></td>
    <td>$${p.total}</td><td style="color:var(--gn);font-weight:500">$${p.paid}</td>
    <td style="color:${rem>0?'var(--rd)':'var(--gn)'};font-weight:600">$${rem}</td>
    <td style="color:var(--mt)">${p.nextDue?fds(p.nextDue):'—'}</td>
    <td><span class="fin-plan-badge ${status}">${labels[status]}</span></td>
    <td><div style="width:80px;height:5px;background:#f0f0ee;border-radius:99px;overflow:hidden"><div style="height:100%;background:var(--gn);width:${pct}%;border-radius:99px"></div></div></td>
    <td>${finCheckPerms()?`<button class="btn btn-d" style="height:22px;font-size:10px;padding:0 7px" onclick="deletePlan('${p.id}')"><i class="ti ti-trash"></i></button>`:''}</td></tr>`;
  }).join(''):''}</tbody>${!plans.length?`<tfoot><tr><td colspan="8">${es('ti-calendar-dollar','blue','No payment plans','Create a plan for members who need installments.',finCheckPerms()?`<button class="btn btn-p" onclick="finOpenAddPlan()"><i class="ti ti-plus"></i>Create Plan</button>`:'')}</td></tr></tfoot>`:''} `;
}

// ── MEMBER FINANCIAL PROFILE ──
function finOpenProfile(memberId){
  const m=D.members.find(x=>x.id===memberId);
  if(!m)return;
  const dues=D.finance.dues||{};
  const d=dues[memberId]||{semesterDues:getSemDues(memberId),paid:0,status:'Partial',lastPayment:'',fineCount:0,notes:'',restriction:'None'};
  const fines=(D.finance.fines||[]).filter(f=>f.memberId===memberId);
  const payments=(D.finance.payments||[]).filter(p=>p.memberId===memberId);
  const plan=(D.finance.plans||[]).find(p=>p.memberId===memberId&&p.status!=='Completed');
  const statusBadge={Paid:'bg2',Partial:'ba2',Overdue:'br2','Payment Plan':'bb2'};
  const modal=document.getElementById('m-fin-profile');
  document.getElementById('fmp-av').textContent=m.initials;
  document.getElementById('fmp-name').textContent=m.name;
  document.getElementById('fmp-role').textContent=m.classYear+' · '+m.role;
  const sb=document.getElementById('fmp-status-badge');
  const st=d.status||'Partial';
  sb.textContent=st;sb.className='badge '+(statusBadge[st]||'bm2');
  const bal=d.semesterDues-d.paid;
  const canEdit=finCheckPerms();
  document.getElementById('fmp-body').innerHTML=`
    <div class="fin-profile-grid" style="margin-bottom:14px">
      <div>
        <div class="card-t" style="margin-bottom:8px">Current Semester</div>
        <div class="fin-stat"><span style="color:var(--mt)">Semester Dues</span><span style="font-weight:500">$${d.semesterDues}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Amount Paid</span><span style="font-weight:600;color:var(--gn)">$${d.paid}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Balance Due</span><span style="font-weight:700;color:${bal>0?'var(--rd)':'var(--gn)'}">$${bal}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Status</span><span class="badge ${statusBadge[st]||'bm2'}">${st}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Last Payment</span><span>${d.lastPayment?fds(d.lastPayment):'Never'}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Restriction</span><span style="color:${d.restriction&&d.restriction!=='None'?'var(--rd)':'var(--mt)'};font-weight:500">${d.restriction||'None'}</span></div>
        ${canEdit?`<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-p" style="height:26px;font-size:11px" onclick="finOpenPaymentFor('${memberId}')"><i class="ti ti-plus"></i>Record Payment</button>
          <button class="btn" style="height:26px;font-size:11px" onclick="finOpenFineFor('${memberId}')"><i class="ti ti-gavel"></i>Add Fine</button>
        </div>`:''}
      </div>
      <div>
        <div class="card-t" style="margin-bottom:8px">Outstanding Fines (${fines.filter(f=>f.status==='Unpaid').length})</div>
        ${fines.length?fines.map(f=>`<div class="fin-fine-row"><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">${f.type} — $${f.amount}</div><div style="font-size:10px;color:var(--ht)">${fds(f.date)} · ${f.reason}</div></div><span class="badge ${f.status==='Paid'?'bg2':'br2'}">${f.status}</span></div>`).join(''):`<div style="font-size:11.5px;color:var(--ht);padding:8px 0">No fines</div>`}
        ${plan?`<div class="card-t" style="margin-top:11px;margin-bottom:8px">Payment Plan</div>
        <div class="fin-stat"><span style="color:var(--mt)">Total</span><span>$${plan.total}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Paid</span><span style="color:var(--gn);font-weight:500">$${plan.paid}</span></div>
        <div class="fin-stat"><span style="color:var(--mt)">Next Due</span><span>${plan.nextDue?fds(plan.nextDue):'—'}</span></div>`:''}
      </div>
    </div>
    <div>
      <div class="card-t" style="margin-bottom:8px">Payment History (${payments.length})</div>
      ${payments.length?payments.map(p=>`<div class="fin-pay-row"><div class="fin-pay-icon" style="background:var(--gn-bg)"><i class="ti ti-cash" style="color:var(--gn)"></i></div><div style="flex:1"><div style="font-size:12px;font-weight:500">$${p.amount} — ${p.type}</div><div style="font-size:10px;color:var(--ht)">${fds(p.date)} · ${p.method}${p.notes?' · '+p.notes:''}</div></div><span style="font-size:11px;font-weight:600;color:var(--gn)">+$${p.amount}</span></div>`).join(''):`<div style="font-size:11.5px;color:var(--ht);padding:6px 0">No payment history</div>`}
    </div>`;
  modal.classList.add('open');
}

// ── RECORD PAYMENT ──
function finOpenPayment(){
  const sel=document.getElementById('fpay-member');
  sel.innerHTML=D.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  document.getElementById('fpay-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('fpay-amount').value='';
  document.getElementById('m-fin-payment').classList.add('open');
}
function finOpenPaymentFor(memberId){
  finOpenPayment();
  const sel=document.getElementById('fpay-member');if(sel)sel.value=memberId;
}

async function finRecordPayment(){
  if(!canWrite()||!finCheckPerms()){toast('Only Treasurer, President, or VP can record payments.','error');return;}
  const memberId=document.getElementById('fpay-member').value;
  const amount=parseFloat(document.getElementById('fpay-amount').value);
  if(!memberId||isNaN(amount)||amount<=0){toast('Member and amount are required','error');return;}
  const date=document.getElementById('fpay-date').value||new Date().toISOString().split('T')[0];
  const type=document.getElementById('fpay-type').value;
  const method=document.getElementById('fpay-method').value;
  const notes=document.getElementById('fpay-notes').value.trim();
  const payment={id:'py'+uid(),memberId,amount,type,method,date,notes,by:CURRENT_USER?CURRENT_USER.mid:'m3'};
  D.finance.payments.unshift(payment);
  if(!D.finance.dues[memberId])D.finance.dues[memberId]={semesterDues:getSemDues(memberId),paid:0,status:'Partial',lastPayment:'',fineCount:0,notes:'',restriction:'None'};
  const prevPaid=D.finance.dues[memberId].paid;
  const prevLastPayment=D.finance.dues[memberId].lastPayment;
  const prevStatus=D.finance.dues[memberId].status;
  D.finance.dues[memberId].paid=Math.min(D.finance.dues[memberId].semesterDues,D.finance.dues[memberId].paid+amount);
  D.finance.dues[memberId].lastPayment=date;
  D.finance.dues[memberId].status=D.finance.dues[memberId].paid>=D.finance.dues[memberId].semesterDues?'Paid':'Partial';
  try{
    await saveD();
    closeM(null,document.getElementById('m-fin-payment'));
    toast('Payment of $'+amount+' recorded for '+mB(memberId).name.split(' ')[0],'success');
    if(FIN_ACTIVE_TAB==='fin-dues')finRenderDues();
    else if(FIN_ACTIVE_TAB==='fin-overview')finRenderOverview();
  }catch(e){
    D.finance.payments=D.finance.payments.filter(p=>p.id!==payment.id);
    D.finance.dues[memberId].paid=prevPaid;
    D.finance.dues[memberId].lastPayment=prevLastPayment;
    D.finance.dues[memberId].status=prevStatus;
    toast('Failed to record payment. Please try again.','error');
  }
}

// ── ADD FINE ──
function finOpenAddFine(){
  const sel=document.getElementById('ffine-member');
  sel.innerHTML=D.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  document.getElementById('ffine-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('ffine-amount').value='';
  document.getElementById('ffine-reason').value='';
  document.getElementById('m-fin-fine').classList.add('open');
}
function finOpenFineFor(memberId){
  finOpenAddFine();
  const sel=document.getElementById('ffine-member');if(sel)sel.value=memberId;
}

async function finAddFine(){
  if(!canWrite()||!finCheckPerms()){toast('Only Treasurer, President, or VP can issue fines.','error');return;}
  const memberId=document.getElementById('ffine-member').value;
  const amount=parseFloat(document.getElementById('ffine-amount').value);
  if(!memberId||isNaN(amount)||amount<=0){toast('Member and amount are required','error');return;}
  const fine={id:'fn'+uid(),memberId,type:document.getElementById('ffine-type').value,amount,reason:document.getElementById('ffine-reason').value.trim()||'Fine issued',date:document.getElementById('ffine-date').value||new Date().toISOString().split('T')[0],status:'Unpaid',paidDate:''};
  D.finance.fines.unshift(fine);
  if(!D.finance.dues[memberId])D.finance.dues[memberId]={semesterDues:getSemDues(memberId),paid:0,status:'Partial',lastPayment:'',fineCount:0,notes:'',restriction:'None'};
  const prevCount=D.finance.dues[memberId].fineCount||0;
  D.finance.dues[memberId].fineCount=prevCount+1;
  try{
    await saveD();
    closeM(null,document.getElementById('m-fin-fine'));
    toast('Fine of $'+amount+' issued to '+mB(memberId).name.split(' ')[0],'success');
    if(FIN_ACTIVE_TAB==='fin-fines')finRenderFines();
    else if(FIN_ACTIVE_TAB==='fin-overview')finRenderOverview();
  }catch(e){
    D.finance.fines=D.finance.fines.filter(f=>f.id!==fine.id);
    D.finance.dues[memberId].fineCount=prevCount;
    toast('Failed to issue fine. Please try again.','error');
  }
}

async function finMarkFinePaid(fineId){
  if(!canWrite()||!finCheckPerms()){toast('Only Treasurer, President, or VP can mark fines paid.','error');return;}
  const f=D.finance.fines.find(x=>x.id===fineId);
  if(!f)return;
  const prevStatus=f.status;const prevDate=f.paidDate;
  f.status='Paid';f.paidDate=new Date().toISOString().split('T')[0];
  try{await saveD();finRenderFines();toast('Fine marked as paid','success');}
  catch(e){f.status=prevStatus;f.paidDate=prevDate;toast('Failed to update fine. Please try again.','error');}
}

// ── LOG EXPENSE ──
function finOpenAddExpense(){
  document.getElementById('fexp-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('fexp-amount').value='';
  document.getElementById('fexp-desc').value='';
  const sel=document.getElementById('fexp-officer');
  sel.innerHTML=D.members.filter(m=>m.role!=='Member').map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  if(CURRENT_USER)sel.value=CURRENT_USER.mid;
  document.getElementById('m-fin-expense').classList.add('open');
}

async function finLogExpense(){
  if(!canWrite()||!finCheckPerms()){toast('Only Treasurer, President, or VP can log expenses.','error');return;}
  const cat=document.getElementById('fexp-cat').value;
  const amount=parseFloat(document.getElementById('fexp-amount').value);
  const desc=document.getElementById('fexp-desc').value.trim();
  if(!cat||isNaN(amount)||amount<=0||!desc){toast('Category, amount, and description are required','error');return;}
  const expense={id:'ex'+uid(),category:cat,desc,amount,officer:document.getElementById('fexp-officer').value,date:document.getElementById('fexp-date').value||new Date().toISOString().split('T')[0]};
  D.finance.expenses.unshift(expense);
  try{
    await saveD();
    closeM(null,document.getElementById('m-fin-expense'));
    toast('Expense of $'+amount+' logged under '+cat,'success');
    if(FIN_ACTIVE_TAB==='fin-budget')finRenderBudget();
    else if(FIN_ACTIVE_TAB==='fin-overview')finRenderOverview();
  }catch(e){
    D.finance.expenses=D.finance.expenses.filter(x=>x.id!==expense.id);
    toast('Failed to log expense. Please try again.','error');
  }
}

// ── PAYMENT PLAN ──
function finOpenAddPlan(){
  const sel=document.getElementById('fplan-member');
  sel.innerHTML=D.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  document.getElementById('fplan-start').value=new Date().toISOString().split('T')[0];
  document.getElementById('fplan-total').value='';
  document.getElementById('fplan-notes').value='';
  document.getElementById('m-fin-plan').classList.add('open');
}

async function finCreatePlan(){
  if(!canWrite()||!finCheckPerms()){toast('Only Treasurer, President, or VP can create payment plans.','error');return;}
  const memberId=document.getElementById('fplan-member').value;
  const total=parseFloat(document.getElementById('fplan-total').value);
  if(!memberId||isNaN(total)||total<=0){toast('Member and total are required','error');return;}
  const inst=parseInt(document.getElementById('fplan-inst').value);
  const startDate=new Date(document.getElementById('fplan-start').value+'T12:00:00');
  const nextDue=startDate.toISOString().split('T')[0];
  const plan={id:'pl'+uid(),memberId,total,paid:0,installments:inst,installmentAmt:Math.round(total/inst*100)/100,nextDue,notes:document.getElementById('fplan-notes').value.trim(),status:'Active',createdDate:new Date().toISOString().split('T')[0]};
  D.finance.plans.push(plan);
  const prevDuesStatus=D.finance.dues[memberId]?.status;
  if(D.finance.dues[memberId])D.finance.dues[memberId].status='Payment Plan';
  try{
    await saveD();
    closeM(null,document.getElementById('m-fin-plan'));
    toast('Payment plan created for '+mB(memberId).name.split(' ')[0],'success');
    if(FIN_ACTIVE_TAB==='fin-plans')finRenderPlans();
  }catch(e){
    D.finance.plans=D.finance.plans.filter(p=>p.id!==plan.id);
    if(D.finance.dues[memberId]&&prevDuesStatus!==undefined)D.finance.dues[memberId].status=prevDuesStatus;
    toast('Failed to create payment plan. Please try again.','error');
  }
}

// ── EXPORT ──
function finExport(){
  const dues=D.finance.dues||{};
  let csv='Name,Class Year,Semester Dues,Paid,Balance,Status,Last Payment,Fine Count\n';
  D.members.forEach(m=>{
    const d=dues[m.id]||{semesterDues:getSemDues(m.id),paid:0,status:'Partial',lastPayment:'',fineCount:0};
    csv+=`${m.name},${m.classYear},$${d.semesterDues},$${d.paid},$${d.semesterDues-d.paid},${d.status||'Partial'},${d.lastPayment||''},${d.fineCount||0}\n`;
  });
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dues_report.csv';a.click();
}


// ── EXECUTIVE WEEKLY SNAPSHOT ──
function renderSnapshot(){
  const el=document.getElementById('d-snapshot-grid');
  const dateEl=document.getElementById('d-snapshot-date');
  if(!el)return;
  if(dateEl)dateEl.textContent='Week of '+new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

  const now=new Date();
  const weekEnd=new Date(now);weekEnd.setDate(weekEnd.getDate()+7);

  // ── Mandatory events this week ──
  const thisWeekEvs=D.events.filter(e=>{
    if(!e.mandatory)return false;
    const d=new Date(e.date+'T12:00:00');
    return d>=now&&d<=weekEnd;
  }).sort((a,b)=>a.date.localeCompare(b.date));

  // ── Overdue tasks ──
  const overdue=D.tasks.filter(t=>t.status!=='done'&&isOv(t.dueDate))
    .sort((a,b)=>({urgent:0,high:1,medium:2,low:3}[a.priority]||2)-({urgent:0,high:1,medium:2,low:3}[b.priority]||2))
    .slice(0,5);

  // ── Attendance concerns (below 75%) ──
  const attRisk=D.members.filter(m=>aR(m.id)<75)
    .sort((a,b)=>aR(a.id)-aR(b.id)).slice(0,5);

  // ── Dues concerns ──
  const dues=D.finance?.dues||{};
  const unpaid=D.members.filter(m=>{const d=dues[m.id];return !d||d.status==='Partial'||d.status==='Unpaid';})
    .slice(0,5);

  // ── Recruitment follow-ups (not contacted in 5+ days) ──
  const rushees=D.recruitment?.rushees||[];
  const stale=rushees.filter(r=>{
    if(['Accepted','Bid Extended'].includes(r.stage))return false;
    if(!r.lastContact)return r.stage!=='New Lead';
    return Math.round((now-new Date(r.lastContact+'T12:00:00'))/86400000)>5;
  }).slice(0,5);

  // ── Upcoming task deadlines (next 7 days) ──
  const deadlines=D.tasks.filter(t=>{
    if(t.status==='done'||!t.dueDate)return false;
    const d=new Date(t.dueDate+'T12:00:00');
    return d>=now&&d<=weekEnd;
  }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5);

  function snapCard(icon,color,title,count,countLabel,items,emptyMsg,pageLink){
    const statusColor=count===0?'var(--gn)':color;
    return`<div class="card" style="border:1px solid var(--bdr);padding:12px 13px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
        <div style="display:flex;align-items:center;gap:7px">
          <div style="width:28px;height:28px;border-radius:8px;background:${statusColor}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ${icon}" style="font-size:13px;color:${statusColor}"></i>
          </div>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--mt)">${title}</span>
        </div>
        <span style="font-size:18px;font-weight:700;color:${statusColor};line-height:1">${count}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${items.length?items.map(row=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:7px;padding:4px 0;border-bottom:1px solid var(--bdr)">
          <span style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">${row.label}</span>
          ${row.badge?`<span style="font-size:9.5px;font-weight:600;padding:1px 6px;border-radius:99px;flex-shrink:0;${row.badgeStyle}">${row.badge}</span>`:''}
        </div>`).join(''):`<div style="padding:6px 0;font-size:11px;color:var(--ht);display:flex;align-items:center;gap:5px"><i class="ti ti-circle-check" style="color:var(--gn);font-size:13px"></i>${emptyMsg}</div>`}
      </div>
      ${pageLink?`<div style="margin-top:8px"><button class="card-a" onclick="rbacNav('${pageLink}',null)" style="font-size:10.5px">${count>0?'View all →':'Open →'}</button></div>`:''}
    </div>`;
  }

  const cards=[
    snapCard(
      'ti-calendar-event','var(--navy)','This Week\u2019s Events',thisWeekEvs.length,'mandatory events',
      thisWeekEvs.map(e=>{const days=Math.max(0,Math.round((new Date(e.date+'T12:00:00')-now)/86400000));return{label:e.title,badge:days===0?'Today':days===1?'Tomorrow':fds(e.date),badgeStyle:'background:var(--bl-bg);color:var(--bl-tx)'};}),'No mandatory events this week','calendar'
    ),
    snapCard(
      'ti-clock','var(--rd)','Overdue Tasks',overdue.length,'tasks',
      overdue.map(t=>{const m=mB(t.assignedTo);return{label:t.title,badge:m.name.split(' ')[0],badgeStyle:'background:#f0f0ee;color:var(--mt)'};}),'All tasks on track','tasks'
    ),
    snapCard(
      'ti-user-exclamation','var(--am)','Attendance Concerns',attRisk.length,'members',
      attRisk.map(m=>({label:m.name,badge:aR(m.id)+'%',badgeStyle:`background:var(--rd-bg);color:var(--rd-tx)`})),'All members above 75%','attendance'
    ),
    snapCard(
      'ti-cash','var(--am)','Dues Outstanding',unpaid.length,'members',
      unpaid.map(m=>{const d=dues[m.id];const bal=d?(d.semesterDues||0)-(d.paid||0):null;return{label:m.name,badge:bal?'$'+bal:'Unpaid',badgeStyle:'background:var(--am-bg);color:var(--am-tx)'};}),'All dues collected','finance'
    ),
    snapCard(
      'ti-user-plus','var(--bl)','Recruitment Follow-Ups',stale.length,'rushees',
      stale.map(r=>{const days=r.lastContact?Math.round((now-new Date(r.lastContact+'T12:00:00'))/86400000):null;return{label:r.name,badge:days?days+'d ago':'No contact',badgeStyle:'background:var(--rd-bg);color:var(--rd-tx)'};}),'All rushees recently contacted','recruitment'
    ),
    snapCard(
      'ti-hourglass','var(--navy)','Upcoming Deadlines',deadlines.length,'tasks due this week',
      deadlines.map(t=>{const d=new Date(t.dueDate+'T12:00:00');const days=Math.max(0,Math.round((d-now)/86400000));return{label:t.title,badge:days===0?'Today':days===1?'Tomorrow':fds(t.dueDate),badgeStyle:'background:var(--bl-bg);color:var(--bl-tx)'};}),'No deadlines this week','tasks'
    ),
  ];

  el.innerHTML=cards.join('');
}


function renderSettings(){
  // Ensure all settings fields exist
  if(!D.settings.chapterName)D.settings.chapterName='Nexus Chapter';
  if(!D.settings.university)D.settings.university='State University University';

  document.getElementById('se-name').value=D.settings.name||'';
  document.getElementById('se-year').value=D.settings.year||'';
  document.getElementById('se-class').value=D.settings.classYear||'Senior';

  // Chapter info editable fields
  const chInfEl=document.getElementById('se-chapter-info');
  if(chInfEl){
    chInfEl.innerHTML=`
      <div class="fr c2">
        <div class="fld"><label>Chapter Name</label><input id="se-ch-name" value="${D.settings.chapterName||''}" placeholder="e.g. Nexus Chapter"></div>
        <div class="fld"><label>University</label><input id="se-ch-uni" value="${D.settings.university||''}" placeholder="e.g. State University University"></div>
      </div>
      <div class="fr c2">
        <div class="fld"><label>Founded Year</label><input id="se-ch-founded" value="${D.settings.chapterFounded||''}" placeholder="e.g. 1948" type="number"></div>
        <div class="fld"><label>IFC Chapter Email</label><input id="se-ch-email" value="${D.settings.chapterEmail||''}" placeholder="ato@iastate.edu"></div>
      </div>
      <button class="btn btn-p" onclick="saveChapterInfo()"><i class="ti ti-device-floppy"></i>Save Chapter Info</button>
    `;
  }

  // System info (read-only)
  const lastLoginDisplay=CURRENT_USER&&CURRENT_USER.lastLogin?CURRENT_USER.lastLogin:'First session';
  document.getElementById('se-info').innerHTML=[
    ['Organization',D.settings.chapterName||'Nexus Chapter'],
    ['University',D.settings.university||'State University University'],
    ['Semester',getSemester()],
    ['Active members',D.members.length],
    ['Your role',CURRENT_USER?CURRENT_USER.title:'—'],
    ['Last login',lastLoginDisplay]
  ].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bdr);font-size:12.5px"><span style="color:var(--mt)">${l}</span><span style="font-weight:500">${v}</span></div>`).join('');

  // User management table
  seRenderUsers();
}

function saveChapterInfo(){
  D.settings.chapterName=document.getElementById('se-ch-name')?.value.trim()||D.settings.chapterName;
  D.settings.university=document.getElementById('se-ch-uni')?.value.trim()||D.settings.university;
  D.settings.chapterFounded=document.getElementById('se-ch-founded')?.value||D.settings.chapterFounded;
  D.settings.chapterEmail=document.getElementById('se-ch-email')?.value.trim()||D.settings.chapterEmail;
  saveD();renderSettings();toast('Chapter info saved','success');
}

// seRenderUsers is defined below near the Firebase auth section


// ══════════════════════════════════════════════════
// PHILANTHROPY & SERVICE (SPLIT SCREEN)
// ══════════════════════════════════════════════════
function renderPhilanthropy(){
  if(!D.philanthropy.funds)D.philanthropy.funds=[];
  const ph=D.philanthropy;
  const serviceHrs=ph.hours.filter(h=>!h.kind||h.kind==='service').reduce((s,h)=>s+parseFloat(h.hours||0),0);
  const philoHrs=ph.hours.filter(h=>h.kind==='philanthropy').reduce((s,h)=>s+parseFloat(h.hours||0),0);
  const totalHrs=serviceHrs+philoHrs;
  const svcEvs=ph.events.filter(e=>!e.kind||e.kind==='service').length;
  const phEvs=ph.events.filter(e=>e.kind==='philanthropy'||e.kind==='fundraiser').length;
  const totalFunds=ph.funds.reduce((s,f)=>s+parseFloat(f.amount||0),0);
  const mbrCount=new Set(ph.hours.map(h=>h.memberId)).size;

  document.getElementById('ph-kpi').innerHTML=
    kpi('Total Service Hours',serviceHrs.toFixed(1),'Community service',serviceHrs>0?'up':'neutral')+
    kpi('Service Events',svcEvs,'This semester','neutral')+
    kpi('Members Participated',mbrCount,'Logged at least one hour','neutral')+
    kpi('Funds Raised','$'+totalFunds.toLocaleString(),'Philanthropy fundraising',totalFunds>0?'up':'neutral');

  // Community Service side
  phRenderServiceGoals();
  phRenderServiceLeaderboard();
  phRenderServiceEvents();
  csFilterHours();

  // Philanthropy side
  phRenderPhiloGoals();
  phRenderPhiloLeaderboard();
  phRenderPhiloEvents();
  phRenderFundsLog();
}

function phRenderServiceGoals(){
  const ph=D.philanthropy;
  const totalHrs=ph.hours.filter(h=>!h.kind||h.kind==='service').reduce((s,h)=>s+parseFloat(h.hours||0),0);
  const evCount=ph.events.filter(e=>!e.kind||e.kind==='service').length;
  const mbrCount=D.members.length||1;
  // Load stored targets or use defaults
  if(!ph.serviceTargets)ph.serviceTargets={totalHrs:500,events:6,avgHrs:4};
  const t=ph.serviceTargets;
  const goals=[
    {id:'phg1',label:'Total Service Hours',target:t.totalHrs||500,unit:'hrs',val:totalHrs,key:'totalHrs'},
    {id:'phg2',label:'Service Events',target:t.events||6,unit:'events',val:evCount,key:'events'},
    {id:'phg3',label:'Avg Hours / Member',target:t.avgHrs||4,unit:'hrs',val:Math.round(totalHrs/mbrCount*10)/10,key:'avgHrs'},
  ];
  const el=document.getElementById('cs-goal-bars');if(!el)return;
  el.innerHTML=goals.map(g=>{const p=Math.min(Math.round(g.val/g.target*100),100);
    return`<div class="pr"><span class="pl">${g.label}</span><div class="pb"><div class="pf" style="width:${p}%;background:${pgc(p)}"></div></div><span class="pv">${p}%</span></div>
    <div style="display:flex;align-items:center;gap:6px;margin:-6px 0 8px 148px">
      <span style="font-size:10px;color:var(--mt)">${g.val} / </span>
      <input type="number" value="${g.target}" min="1" style="width:52px;height:18px;padding:0 4px;border:1px solid var(--bdr);border-radius:4px;font-size:10px;font-family:inherit;color:var(--tx);outline:none" onchange="phUpdateServiceTarget('${g.key}',+this.value)">
      <span style="font-size:10px;color:var(--ht)">${g.unit}</span>
    </div>`;
  }).join('');
}
function phUpdateServiceTarget(key,val){
  if(!D.philanthropy.serviceTargets)D.philanthropy.serviceTargets={totalHrs:500,events:6,avgHrs:4};
  D.philanthropy.serviceTargets[key]=val;
  saveD();phRenderServiceGoals();
}

function phRenderPhiloGoals(){
  const ph=D.philanthropy;
  const phEvs=ph.events.filter(e=>e.kind==='philanthropy'||e.kind==='fundraiser').length;
  const totalFunds=ph.funds.reduce((s,f)=>s+parseFloat(f.amount||0),0);
  if(!ph.philoTargets)ph.philoTargets={events:4,funds:2000};
  const t=ph.philoTargets;
  const goals=[
    {label:'Philanthropy Events',target:t.events||4,unit:'events',val:phEvs,key:'events'},
    {label:'Funds Raised',target:t.funds||2000,unit:'$',val:totalFunds,key:'funds'},
  ];
  const el=document.getElementById('ph-goal-bars2');if(!el)return;
  el.innerHTML=goals.map(g=>{const p=Math.min(Math.round(g.val/g.target*100),100);
    return`<div class="pr"><span class="pl">${g.label}</span><div class="pb"><div class="pf" style="width:${p}%;background:${pgc(p)}"></div></div><span class="pv">${p}%</span></div>
    <div style="display:flex;align-items:center;gap:6px;margin:-6px 0 8px 148px">
      <span style="font-size:10px;color:var(--mt)">${g.unit==='$'?'$'+Math.round(g.val):g.val} / </span>
      <input type="number" value="${g.target}" min="1" style="width:52px;height:18px;padding:0 4px;border:1px solid var(--bdr);border-radius:4px;font-size:10px;font-family:inherit;color:var(--tx);outline:none" onchange="phUpdatePhiloTarget('${g.key}',+this.value)">
      <span style="font-size:10px;color:var(--ht)">${g.unit}</span>
    </div>`;
  }).join('');
}
function phUpdatePhiloTarget(key,val){
  if(!D.philanthropy.philoTargets)D.philanthropy.philoTargets={events:4,funds:2000};
  D.philanthropy.philoTargets[key]=val;
  saveD();phRenderPhiloGoals();
}

function phRenderServiceLeaderboard(){
  const hoursMap={};D.philanthropy.hours.filter(h=>!h.kind||h.kind==='service').forEach(h=>{hoursMap[h.memberId]=(hoursMap[h.memberId]||0)+parseFloat(h.hours||0);});
  const sorted=Object.entries(hoursMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const total=Object.values(hoursMap).reduce((a,b)=>a+b,0);
  const el=document.getElementById('cs-leaderboard');if(!el)return;
  const tot=document.getElementById('cs-total-hrs');if(tot)tot.textContent=total.toFixed(1)+' hrs total';
  el.innerHTML=sorted.length?sorted.map(([mid,hrs],i)=>{const m=mB(mid);
    return`<div class="sh-row"><div class="sh-av" style="background:${i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#cd7f32':'var(--gn-bg)'};color:${i<3?'#555':'var(--gn-tx)'};font-size:10px;font-weight:700">${i+1}</div><div style="flex:1"><div style="font-size:12px;font-weight:500">${m.name}</div></div><span style="font-size:13px;font-weight:600;color:var(--gn)">${hrs.toFixed(1)}<span style="font-size:9.5px;font-weight:400;color:var(--ht)"> hrs</span></span></div>`;
  }).join(''):es('ti-trophy','green','No service hours logged','Log hours to see the leaderboard.','');
}

function phRenderPhiloLeaderboard(){
  const hoursMap={};D.philanthropy.hours.filter(h=>h.kind==='philanthropy').forEach(h=>{hoursMap[h.memberId]=(hoursMap[h.memberId]||0)+parseFloat(h.hours||0);});
  const sorted=Object.entries(hoursMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const total=Object.values(hoursMap).reduce((a,b)=>a+b,0);
  const el=document.getElementById('ph-leaderboard2');if(!el)return;
  const tot=document.getElementById('ph-total-hrs');if(tot)tot.textContent=total.toFixed(1)+' hrs total';
  el.innerHTML=sorted.length?sorted.map(([mid,hrs],i)=>{const m=mB(mid);
    return`<div class="sh-row"><div class="sh-av" style="background:${i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#cd7f32':'#fbeaf0'};color:${i<3?'#555':'#c0345a'};font-size:10px;font-weight:700">${i+1}</div><div style="flex:1"><div style="font-size:12px;font-weight:500">${m.name}</div></div><span style="font-size:13px;font-weight:600;color:#c0345a">${hrs.toFixed(1)}<span style="font-size:9.5px;font-weight:400;color:var(--ht)"> hrs</span></span></div>`;
  }).join(''):es('ti-heart','red','No philanthropy hours logged','Log hours to see the leaderboard.','');
}

function phRenderServiceEvents(){
  const ev=D.philanthropy.events.filter(e=>!e.kind||e.kind==='service').sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  const el=document.getElementById('cs-events-table');if(!el)return;
  el.innerHTML=`<thead><tr><th>Event</th><th>Date</th><th>Org</th><th>Goal</th><th></th></tr></thead><tbody>${ev.length?ev.map(e=>`<tr><td style="font-weight:500">${e.title}</td><td>${fds(e.date)}</td><td style="color:var(--mt)">${e.org||'—'}</td><td>${e.hourGoal?e.hourGoal+' hrs':'—'}</td><td><button class="btn btn-d" style="height:22px;font-size:10px;padding:0 7px" onclick="deletePhEvent('${e.id}')"><i class="ti ti-trash"></i></button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--ht);padding:20px">No service events yet.</td></tr>'}</tbody>`;
}

function phRenderPhiloEvents(){
  const ev=D.philanthropy.events.filter(e=>e.kind==='philanthropy'||e.kind==='fundraiser').sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  const el=document.getElementById('ph-events-table2');if(!el)return;
  el.innerHTML=`<thead><tr><th>Event</th><th>Date</th><th>Type</th><th>Org</th><th></th></tr></thead><tbody>${ev.length?ev.map(e=>`<tr><td style="font-weight:500">${e.title}</td><td>${fds(e.date)}</td><td><span class="badge bb2">${e.kind||'philanthropy'}</span></td><td style="color:var(--mt)">${e.org||'—'}</td><td><button class="btn btn-d" style="height:22px;font-size:10px;padding:0 7px" onclick="deletePhEvent('${e.id}')"><i class="ti ti-trash"></i></button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--ht);padding:20px">No philanthropy events yet.</td></tr>'}</tbody>`;
}

function phRenderFundsLog(){
  const el=document.getElementById('ph-funds-log');if(!el)return;
  const funds=[...(D.philanthropy.funds||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!funds.length){el.innerHTML=`<div style="padding:12px;text-align:center;font-size:11.5px;color:var(--ht)">No fundraising logged yet. Click "+ Log" to add.</div>`;return;}
  const total=funds.reduce((s,f)=>s+parseFloat(f.amount||0),0);

  // Per-member donor map
  const donorMap={};
  funds.forEach(f=>{
    if(f.memberId){donorMap[f.memberId]=(donorMap[f.memberId]||0)+parseFloat(f.amount||0);}
  });
  const topDonors=Object.entries(donorMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  let html=`<div style="font-size:11px;font-weight:600;color:var(--gn-tx);margin-bottom:8px">Total Raised: $${total.toLocaleString()}</div>`;

  // Member donor leaderboard
  if(topDonors.length){
    html+=`<div style="font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--mt);margin-bottom:5px">Top Member Donors</div>`;
    html+=topDonors.map(([mid,amt],i)=>{const m=mB(mid);return`<div class="sh-row"><div class="sh-av" style="background:${i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#cd7f32':'#fbeaf0'};color:${i<3?'#555':'#c0345a'};font-size:9px;font-weight:700">${i+1}</div><div style="flex:1"><div style="font-size:12px;font-weight:500">${m.name}</div></div><span style="font-size:13px;font-weight:600;color:#c0345a">$${amt.toLocaleString()}</span></div>`;}).join('');
    html+=`<div style="font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--mt);margin-top:11px;margin-bottom:5px">All Donations</div>`;
  }

  html+=funds.slice(0,30).map(f=>{
    const donor=f.memberId?mB(f.memberId).name:'Chapter / External';
    return`<div class="fin-pay-row"><div class="fin-pay-icon" style="background:#fbeaf0"><i class="ti ti-coin" style="color:#c0345a"></i></div><div style="flex:1"><div style="font-size:12px;font-weight:500">$${parseFloat(f.amount).toLocaleString()} <span style="font-size:10px;font-weight:400;color:var(--mt)">— ${donor}</span></div><div style="font-size:10.5px;color:var(--mt)">${fds(f.date)}${f.notes?' · '+f.notes:''}</div></div><button class="btn btn-d" style="height:22px;font-size:10px;padding:0 7px" onclick="deletePhFunds('${f.id}')"><i class="ti ti-trash"></i></button></div>`;
  }).join('');
  el.innerHTML=html;
}

function csFilterHours(){
  const q=(document.getElementById('cs-search')||{value:''}).value.toLowerCase();
  const hoursMap={};D.philanthropy.hours.filter(h=>!h.kind||h.kind==='service').forEach(h=>{hoursMap[h.memberId]=(hoursMap[h.memberId]||0)+parseFloat(h.hours||0);});
  let rows=D.members.map(m=>({m,hrs:hoursMap[m.id]||0}));
  if(q)rows=rows.filter(r=>r.m.name.toLowerCase().includes(q));
  rows.sort((a,b)=>b.hrs-a.hrs);
  const el=document.getElementById('cs-hours-table');if(!el)return;
  el.innerHTML=`<thead><tr><th>Member</th><th>Class</th><th>Hours</th><th>vs Goal (4h)</th></tr></thead><tbody>${rows.map(({m,hrs})=>{const p=Math.min(Math.round(hrs/4*100),100);return`<tr><td style="font-weight:500">${m.name}</td><td style="color:var(--mt)">${m.classYear}</td><td style="font-weight:600;color:${hrs>=4?'var(--gn)':hrs>0?'var(--navy)':'var(--ht)'}">${hrs.toFixed(1)} hrs</td><td><div style="display:flex;align-items:center;gap:7px"><div style="width:60px;height:5px;background:#f0f0ee;border-radius:99px;overflow:hidden"><div style="height:100%;border-radius:99px;background:${pgc(p)};width:${p}%"></div></div><span style="font-size:10.5px;color:var(--mt)">${p}%</span></div></td></tr>`;}).join('')}</tbody>`;
}

function phOpenAddEvent(kind='service'){
  document.getElementById('ph-ev-kind').value=kind;
  document.getElementById('ph-addevent-title').childNodes[0].textContent=kind==='service'?'Add Service Event':'Add Philanthropy Event';
  document.getElementById('ph-ev-type').value=kind==='service'?'service':'philanthropy';
  document.getElementById('ph-ev-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('ph-ev-title').value='';
  document.getElementById('ph-ev-goal').value='';
  document.getElementById('ph-ev-org').value='';
  document.getElementById('ph-ev-notes').value='';
  document.getElementById('m-ph-addevent').classList.add('open');
}
function phAddEvent(){
  const title=document.getElementById('ph-ev-title').value.trim();
  if(!title){toast('Event name is required','error');return;}
  const kind=document.getElementById('ph-ev-kind').value;
  D.philanthropy.events.push({id:uid(),title,date:document.getElementById('ph-ev-date').value||new Date().toISOString().split('T')[0],kind,type:document.getElementById('ph-ev-type').value,hourGoal:parseFloat(document.getElementById('ph-ev-goal').value)||0,org:document.getElementById('ph-ev-org').value.trim(),notes:document.getElementById('ph-ev-notes').value.trim()});
  saveD();closeM(null,document.getElementById('m-ph-addevent'));renderPhilanthropy();toast('Event created','success');
}
function phOpenLogHours(kind='service'){
  document.getElementById('ph-log-kind').value=kind;
  document.getElementById('ph-loghours-title').childNodes[0].textContent=kind==='service'?'Log Service Hours':'Log Philanthropy Hours';
  const sel=document.getElementById('ph-log-member');sel.innerHTML=mOpts();
  const esel=document.getElementById('ph-log-event');
  const evs=D.philanthropy.events.filter(e=>kind==='service'?(!e.kind||e.kind==='service'):e.kind==='philanthropy'||e.kind==='fundraiser');
  esel.innerHTML='<option value="">-- General / Other --</option>'+evs.map(e=>`<option value="${e.id}">${e.title} (${fds(e.date)})</option>`).join('');
  document.getElementById('ph-log-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('ph-log-hours').value='';
  document.getElementById('ph-log-notes').value='';
  document.getElementById('m-ph-loghours').classList.add('open');
}
function phLogHours(){
  const mid=document.getElementById('ph-log-member').value;
  const hrs=parseFloat(document.getElementById('ph-log-hours').value);
  const kind=document.getElementById('ph-log-kind').value;
  if(!mid||isNaN(hrs)||hrs<=0){toast('Member and valid hours are required','error');return;}
  D.philanthropy.hours.push({id:uid(),memberId:mid,hours:hrs,kind,eventId:document.getElementById('ph-log-event').value||null,date:document.getElementById('ph-log-date').value,notes:document.getElementById('ph-log-notes').value.trim()});
  saveD();closeM(null,document.getElementById('m-ph-loghours'));renderPhilanthropy();toast(hrs+' hrs logged for '+mB(mid).name.split(' ')[0],'success');
}
function phOpenLogFunds(){
  document.getElementById('pf-amount').value='';
  document.getElementById('pf-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('pf-notes').value='';
  const msel=document.getElementById('pf-member');
  if(msel)msel.innerHTML='<option value="">— Chapter / External —</option>'+D.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  const esel=document.getElementById('pf-event');
  const phEvs=D.philanthropy.events.filter(e=>e.kind==='philanthropy'||e.kind==='fundraiser');
  esel.innerHTML='<option value="">-- General --</option>'+phEvs.map(e=>`<option value="${e.id}">${e.title}</option>`).join('');
  document.getElementById('m-ph-logfunds').classList.add('open');
}
function phLogFunds(){
  const amt=parseFloat(document.getElementById('pf-amount').value);
  if(isNaN(amt)||amt<=0){toast('Enter a valid amount','error');return;}
  if(!D.philanthropy.funds)D.philanthropy.funds=[];
  const memberId=document.getElementById('pf-member')?.value||null;
  D.philanthropy.funds.push({id:uid(),amount:amt,memberId:memberId||null,date:document.getElementById('pf-date').value,eventId:document.getElementById('pf-event').value||null,notes:document.getElementById('pf-notes').value.trim()});
  saveD();closeM(null,document.getElementById('m-ph-logfunds'));renderPhilanthropy();toast('$'+amt.toLocaleString()+' logged','success');
}
// Legacy stubs for old code references
function phTab(){}
function renderPhOverview(){}
function renderPhEvents(){}
function renderPhHours(){}
function phFilterHours(){}
function phOpenAdd(){phOpenAddEvent('service');}


// ══════════════════════════════════════════════════
// ALUMNI RELATIONS
// ══════════════════════════════════════════════════
function renderAlumni(){
  const al=D.alumni;
  const active=al.contacts.filter(a=>a.engagement==='Active').length;
  const recent=al.outreach.filter(o=>{if(!o.date)return false;return(new Date()-new Date(o.date+'T12:00:00'))<30*86400000;}).length;
  document.getElementById('al-kpi').innerHTML=
    kpi('Total Alumni',al.contacts.length,'In directory','neutral')+
    kpi('Active',active,'Engaged alumni','neutral')+
    kpi('Recent Contacts',recent,'Last 30 days','neutral')+
    kpi('Alumni Events',al.events.length,'On record','neutral');
  alRenderDirectory();
}
function alTab(el,tab){
  document.querySelectorAll('[data-tab^="al-"]').forEach(b=>b.className='btn');
  el.className='btn btn-p';
  ['al-directory','al-events','al-outreach'].forEach(t=>{const e=document.getElementById(t);if(e)e.style.display=t===tab?'':'none';});
  const addBtn=document.getElementById('al-add-btn');
  if(addBtn){if(tab==='al-directory'){addBtn.textContent=''; addBtn.innerHTML='<i class="ti ti-plus"></i> Add Alumni';addBtn.onclick=alOpenAdd;}
  else if(tab==='al-events'){addBtn.innerHTML='<i class="ti ti-plus"></i> Add Event';addBtn.onclick=alOpenAddEvent;}
  else{addBtn.innerHTML='<i class="ti ti-plus"></i> Log Contact';addBtn.onclick=alOpenLogContact;}}
  if(tab==='al-directory')alRenderDirectory();
  else if(tab==='al-events')alRenderEvents();
  else alRenderOutreach();
}
function alFilter(){alRenderDirectory();}
function alRenderDirectory(){
  const q=document.getElementById('al-search')?.value?.toLowerCase()||'';
  let rows=D.alumni.contacts;
  if(q)rows=rows.filter(a=>a.name.toLowerCase().includes(q)||(a.employer||'').toLowerCase().includes(q)||(a.location||'').toLowerCase().includes(q));
  const engColor={Active:'bg2',Occasional:'ba2',Inactive:'bm2'};
  document.getElementById('al-table').innerHTML=`<thead><tr><th>Name</th><th>Class</th><th>Employer</th><th>Industry</th><th>Location</th><th>Engagement</th><th></th></tr></thead><tbody>${rows.length?rows.map(a=>`<tr><td style="font-weight:500">${a.name}</td><td>${a.gradYear||'—'}</td><td>${a.employer||'—'}</td><td style="color:var(--mt)">${a.industry||'—'}</td><td style="color:var(--mt)">${a.location||'—'}</td><td><span class="badge ${engColor[a.engagement]||'bm2'}">${a.engagement||'Unknown'}</span></td><td><button class="btn btn-d" style="height:23px;font-size:10px;padding:0 7px" onclick="deleteAlumni('${a.id}')"><i class="ti ti-trash"></i></button></td></tr>`).join(''):'<tr><td colspan="7" style="text-align:center;color:var(--ht);padding:24px">No alumni in directory yet. Add the first one!</td></tr>'}</tbody>`;
}
function alRenderEvents(){
  const ev=D.alumni.events;
  document.getElementById('al-events-table').innerHTML=`<thead><tr><th>Event</th><th>Date</th><th>Type</th><th>Location</th><th>Notes</th></tr></thead><tbody>${ev.length?ev.sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<tr><td style="font-weight:500">${e.title}</td><td>${fds(e.date)}</td><td><span class="badge bb2">${e.type}</span></td><td style="color:var(--mt)">${e.location||'—'}</td><td style="color:var(--mt);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.notes||'—'}</td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--ht);padding:24px">No alumni events yet.</td></tr>'}</tbody>`;
}
function alRenderOutreach(){
  const log=[...D.alumni.outreach].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const methIcon={Email:'ti-mail',Phone:'ti-phone',Text:'ti-message','In Person':'ti-user-check',LinkedIn:'ti-brand-linkedin'};
  document.getElementById('al-outreach-list').innerHTML=log.length?log.map(o=>{
    const al=D.alumni.contacts.find(a=>a.id===o.alumniId)||{name:'Unknown'};
    const by=mB(o.byId)||{name:'Unknown'};
    return`<div class="al-row"><div class="al-ic" style="background:var(--bl-bg);color:var(--bl-tx)"><i class="ti ${methIcon[o.method]||'ti-mail'}"></i></div><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:500">${al.name}</div><div style="font-size:10.5px;color:var(--mt);margin-top:1px">${o.method} · ${fds(o.date)} · by ${by.name.split(' ')[0]}</div>${o.notes?`<div style="font-size:11px;color:var(--tx);margin-top:4px;line-height:1.5">${o.notes}</div>`:''}</div></div>`;
  }).join(''):es('ti-phone-off','blue','No outreach logged','Log alumni contacts to track your outreach.','');
}
function alOpenAdd(){
  ['al-name','al-email','al-phone','al-employer','al-location','al-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('al-gradyear').value='';
  document.getElementById('m-al-add').classList.add('open');
}
function alAddAlumni(){
  const name=document.getElementById('al-name').value.trim();
  if(!name){toast('Name is required','error');return;}
  D.alumni.contacts.push({id:uid(),name,gradYear:document.getElementById('al-gradyear').value||'',email:document.getElementById('al-email').value.trim(),phone:document.getElementById('al-phone').value.trim(),employer:document.getElementById('al-employer').value.trim(),industry:document.getElementById('al-industry').value,location:document.getElementById('al-location').value.trim(),engagement:document.getElementById('al-engage').value,notes:document.getElementById('al-notes').value.trim()});
  saveD();closeM(null,document.getElementById('m-al-add'));renderAlumni();toast('Alumni added','success');
}
function alOpenAddEvent(){
  document.getElementById('ale-date').value=new Date().toISOString().split('T')[0];
  ['ale-title','ale-location','ale-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('m-al-addevent').classList.add('open');
}
function alAddEvent(){
  const title=document.getElementById('ale-title').value.trim();
  if(!title){toast('Event name is required','error');return;}
  D.alumni.events.push({id:uid(),title,date:document.getElementById('ale-date').value,type:document.getElementById('ale-type').value,location:document.getElementById('ale-location').value.trim(),notes:document.getElementById('ale-notes').value.trim()});
  saveD();closeM(null,document.getElementById('m-al-addevent'));alRenderEvents();toast('Event added','success');
}
function alOpenLogContact(){
  const asel=document.getElementById('alc-alumni');asel.innerHTML=D.alumni.contacts.map(a=>`<option value="${a.id}">${a.name} ('${(a.gradYear||'??').toString().slice(-2)})</option>`).join('');
  if(!D.alumni.contacts.length){toast('Add alumni to the directory first','info');return;}
  const bsel=document.getElementById('alc-by');bsel.innerHTML=mOpts();if(CURRENT_USER)bsel.value=CURRENT_USER.mid;
  document.getElementById('alc-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('alc-notes').value='';
  document.getElementById('m-al-contact').classList.add('open');
}
function alLogContact(){
  const alumniId=document.getElementById('alc-alumni').value;
  if(!alumniId){toast('Select an alumni','error');return;}
  D.alumni.outreach.push({id:uid(),alumniId,date:document.getElementById('alc-date').value,method:document.getElementById('alc-method').value,byId:document.getElementById('alc-by').value,notes:document.getElementById('alc-notes').value.trim()});
  // Update last contact on alumni record
  const al=D.alumni.contacts.find(a=>a.id===alumniId);if(al)al.lastContact=document.getElementById('alc-date').value;
  saveD();closeM(null,document.getElementById('m-al-contact'));alRenderOutreach();toast('Contact logged','success');
}

// ══════════════════════════════════════════════════
// RITUAL & EDUCATION
// ══════════════════════════════════════════════════
function renderRitual(){
  const ri=D.ritual;
  const total=ri.items.length;const done=ri.items.filter(i=>i.done).length;
  const required=ri.items.filter(i=>i.required);const reqDone=required.filter(i=>i.done).length;
  const sessions=ri.sessions.length;
  document.getElementById('ri-kpi').innerHTML=
    kpi('Leadership Dev Items',total,done+' completed','neutral')+
    kpi('Required',required.length,reqDone+' / '+required.length+' done',reqDone===required.length&&required.length>0?'up':'neutral')+
    kpi('Sessions',sessions,'Scheduled','neutral')+
    kpi('New Members',D.members.filter(m=>m.classYear==='Freshman'||m.classYear==='New Member').length,'In program','neutral');
  riRenderProgram();
  riRenderMembers();
  riRenderSchedule();
}
function riRenderProgram(){
  const items=D.ritual.items;const done=items.filter(i=>i.done).length;
  const pct=items.length?Math.round(done/items.length*100):0;
  const pctEl=document.getElementById('ri-prog-pct');if(pctEl)pctEl.textContent=pct+'% complete';
  const catColors={ritual:'background:#fbeaf0;color:#993556',education:'background:var(--bl-bg);color:var(--bl-tx)','team-building':'background:var(--am-bg);color:var(--am-tx)',service:'background:var(--gn-bg);color:var(--gn-tx)',administrative:'background:#f0f0ee;color:var(--mt)'};
  const grouped={};items.forEach(item=>{const c=item.category||'education';if(!grouped[c])grouped[c]=[];grouped[c].push(item);});
  const listEl=document.getElementById('ri-program-list');
  if(!listEl)return;
  if(!items.length){listEl.innerHTML=`<div class="es"><div class="es-icon blue"><i class="ti ti-list-check"></i></div><div class="es-title">No program items yet</div><div class="es-sub">Add milestones and requirements to the new member education program.</div></div>`;const statsEl=document.getElementById('ri-class-stats');if(statsEl)statsEl.innerHTML='';return;}
  listEl.innerHTML=Object.entries(grouped).map(([cat,its])=>`
    <div style="margin-bottom:11px">
      <div style="font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--mt);margin-bottom:6px">${cat.charAt(0).toUpperCase()+cat.slice(1)}</div>
      ${its.map(item=>`<div class="tk-row" style="align-items:flex-start">
        <div class="tc ${item.done?'done':''}" style="cursor:pointer;margin-top:2px" onclick="riToggle('${item.id}')">${item.done?'<i class="ti ti-check" style="font-size:9px"></i>':''}</div>
        <div style="flex:1;min-width:0;cursor:pointer" onclick="riToggle('${item.id}')">
          <div style="font-size:11.5px;color:${item.done?'var(--ht)':'var(--tx)'};${item.done?'text-decoration:line-through':''}">${item.title}${item.required?'<span style="font-size:8.5px;font-weight:600;color:var(--rd-tx);margin-left:5px">REQ</span>':''}</div>
          ${item.desc?`<div style="font-size:10px;color:var(--ht)">${item.desc.slice(0,80)}${item.desc.length>80?'…':''}</div>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-top:1px">
          <span style="font-size:10px;color:var(--ht)">Wk ${item.week||'?'}</span>
          <button class="ib" style="width:22px;height:22px;font-size:12px" onclick="riOpenEditItem('${item.id}')" title="Edit"><i class="ti ti-pencil"></i></button>
          <button class="ib" style="width:22px;height:22px;font-size:12px;color:var(--rd)" onclick="riDeleteItem('${item.id}')" title="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>`).join('')}
    </div>`).join('');
  const statsEl=document.getElementById('ri-class-stats');if(statsEl){
    const cats=Object.keys(grouped);
    statsEl.innerHTML=cats.map(cat=>{const its=grouped[cat];const d=its.filter(i=>i.done).length;const p=its.length?Math.round(d/its.length*100):0;return`<div class="pr"><span class="pl" style="text-transform:capitalize">${cat}</span><div class="pb"><div class="pf" style="width:${p}%;background:${pgc(p)}"></div></div><span class="pv">${p}%</span></div>`;}).join('');
  }
}
function riToggle(id){const item=D.ritual.items.find(i=>i.id===id);if(item){item.done=!item.done;saveD();riRenderProgram();}}
function riOpenEditItem(id){
  const item=D.ritual.items.find(i=>i.id===id);if(!item)return;
  document.getElementById('ri-item-title').value=item.title;
  document.getElementById('ri-item-cat').value=item.category||'education';
  document.getElementById('ri-item-week').value=item.week||'';
  document.getElementById('ri-item-req').value=item.required?'1':'0';
  document.getElementById('ri-item-desc').value=item.desc||'';
  document.getElementById('ri-item-id').value=id;
  document.getElementById('m-ri-additem').querySelector('.md-t').childNodes[0].textContent='Edit Program Item';
  document.getElementById('m-ri-additem').classList.add('open');
}
async function riDeleteItem(id){
  const ok=await confirmDialog('Delete Program Item','Remove this item from the program? This cannot be undone.');
  if(!ok)return;
  D.ritual.items=D.ritual.items.filter(i=>i.id!==id);
  saveD();riRenderProgram();renderRitual();toast('Item removed','info');
}
function riRenderMembers(){
  const nms=D.members.filter(m=>m.classYear==='Sophomore'||m.classYear==='Freshman');
  const req=D.ritual.items.filter(i=>i.required);
  const el=document.getElementById('ri-members-table');if(!el)return;
  el.innerHTML=`<thead><tr><th>Member</th><th>Class</th><th>Required Items</th><th>Status</th></tr></thead><tbody>${nms.length?nms.map(m=>{const prog=D.ritual.nmProgress[m.id]||{};const done=req.filter(i=>prog[i.id]).length;const pct=req.length?Math.round(done/req.length*100):0;return`<tr><td style="font-weight:500">${m.name}</td><td>${m.classYear}</td><td><div style="display:flex;align-items:center;gap:7px"><div style="width:80px;height:5px;background:#f0f0ee;border-radius:99px;overflow:hidden"><div style="height:100%;background:${pgc(pct)};border-radius:99px;width:${pct}%"></div></div><span style="font-size:10.5px">${done}/${req.length}</span></div></td><td><span class="badge ${pct===100?'bg2':pct>=50?'ba2':'bm2'}">${pct===100?'Complete':pct>=50?'In Progress':'Not Started'}</span></td></tr>`;}).join(''):'<tr><td colspan="4" style="text-align:center;color:var(--ht);padding:24px">No new members found. Members with class year Sophomore or Freshman appear here.</td></tr>'}</tbody>`;
}
function riRenderSchedule(){
  const sess=D.ritual.sessions;
  const el=document.getElementById('ri-schedule-table');if(!el)return;
  if(!sess.length){el.innerHTML=`<thead><tr><th>Session</th><th>Date</th><th>Type</th><th>Facilitator</th><th>Notes</th><th></th></tr></thead><tbody><tr><td colspan="6" style="text-align:center;color:var(--ht);padding:24px">No sessions scheduled. Add one to get started.</td></tr></tbody>`;return;}
  el.innerHTML=`<thead><tr><th>Session</th><th>Date</th><th>Type</th><th>Facilitator</th><th>Notes</th><th></th></tr></thead><tbody>${sess.sort((a,b)=>b.date.localeCompare(a.date)).map(s=>{const fac=mB(s.facilitatorId);return`<tr><td style="font-weight:500">${s.title}</td><td>${fds(s.date)}</td><td><span class="badge ${s.type==='ritual'?'br2':s.type==='test'?'ba2':'bb2'}">${s.type}</span></td><td>${fac.name}</td><td style="color:var(--mt);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.notes||'—'}</td><td style="white-space:nowrap"><button class="btn" style="height:24px;font-size:11px;padding:0 7px;margin-right:4px" onclick="riOpenEditSession('${s.id}')"><i class="ti ti-pencil"></i></button><button class="btn btn-d" style="height:24px;font-size:11px;padding:0 7px" onclick="riDeleteSession('${s.id}')"><i class="ti ti-trash"></i></button></td></tr>`;}).join('')}</tbody>`;
}
function riOpenEditSession(id){
  const s=D.ritual.sessions.find(x=>x.id===id);if(!s)return;
  const fsel=document.getElementById('ris-facilitator');fsel.innerHTML=D.members.map(m=>`<option value="${m.id}">${m.name}${m.role!=='Member'?' — '+m.role:''}</option>`).join('');
  document.getElementById('ris-title').value=s.title;
  document.getElementById('ris-date').value=s.date;
  document.getElementById('ris-type').value=s.type;
  fsel.value=s.facilitatorId;
  document.getElementById('ris-notes').value=s.notes||'';
  document.getElementById('ris-id').value=id;
  document.getElementById('m-ri-addsession').querySelector('.md-t').childNodes[0].textContent='Edit Session';
  document.getElementById('m-ri-addsession').classList.add('open');
}
async function riDeleteSession(id){
  const ok=await confirmDialog('Delete Session','Remove this session from the schedule?');
  if(!ok)return;
  D.ritual.sessions=D.ritual.sessions.filter(s=>s.id!==id);
  saveD();riRenderSchedule();renderRitual();toast('Session removed','info');
}
function riOpenAddItem(){
  ['ri-item-title','ri-item-desc'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('ri-item-week').value='';
  document.getElementById('ri-item-id').value='';
  document.getElementById('m-ri-additem').querySelector('.md-t').childNodes[0].textContent='Add Program Item';
  document.getElementById('m-ri-additem').classList.add('open');
}
function riAddItem(){
  const title=document.getElementById('ri-item-title').value.trim();
  if(!title){toast('Title is required','error');return;}
  const editId=document.getElementById('ri-item-id').value;
  const data={title,category:document.getElementById('ri-item-cat').value,week:parseInt(document.getElementById('ri-item-week').value)||null,required:document.getElementById('ri-item-req').value==='1',desc:document.getElementById('ri-item-desc').value.trim()};
  if(editId){const item=D.ritual.items.find(i=>i.id===editId);if(item)Object.assign(item,data);}
  else D.ritual.items.push({id:uid(),...data,done:false});
  saveD();closeM(null,document.getElementById('m-ri-additem'));renderRitual();toast(editId?'Item updated':'Item added','success');
}
function riOpenAddSession(){
  const fsel=document.getElementById('ris-facilitator');fsel.innerHTML=D.members.filter(m=>m.role!=='Member').map(m=>`<option value="${m.id}">${m.name} — ${m.role}</option>`).join('');
  document.getElementById('ris-date').value=new Date().toISOString().split('T')[0];
  ['ris-title','ris-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('ris-id').value='';
  document.getElementById('m-ri-addsession').querySelector('.md-t').childNodes[0].textContent='Add Education Session';
  document.getElementById('m-ri-addsession').classList.add('open');
}
function riAddSession(){
  const title=document.getElementById('ris-title').value.trim();
  if(!title){toast('Title is required','error');return;}
  const editId=document.getElementById('ris-id').value;
  const data={title,date:document.getElementById('ris-date').value,type:document.getElementById('ris-type').value,facilitatorId:document.getElementById('ris-facilitator').value,notes:document.getElementById('ris-notes').value.trim()};
  if(editId){const s=D.ritual.sessions.find(x=>x.id===editId);if(s)Object.assign(s,data);}
  else D.ritual.sessions.push({id:uid(),...data});
  saveD();closeM(null,document.getElementById('m-ri-addsession'));riRenderSchedule();renderRitual();toast(editId?'Session updated':'Session added','success');
}

// ══════════════════════════════════════════════════
// VENDORS / CONTACTS
// ══════════════════════════════════════════════════
function renderVendors(){
  const vn=D.vendors;
  const cats=new Set(vn.map(v=>v.category)).size;
  const topRated=vn.filter(v=>v.rating>=4).length;
  document.getElementById('vn-kpi').innerHTML=
    kpi('Total Vendors',vn.length,'In directory','neutral')+
    kpi('Categories',cats,'Covered','neutral')+
    kpi('Top Rated',topRated,'4+ stars','neutral')+
    kpi('Recently Used',vn.filter(v=>v.lastUsed).length,'Have usage history','neutral');
  vnRenderGrid();
}
function vnFilter(){vnRenderGrid();}
function vnRenderGrid(){
  const q=document.getElementById('vn-search')?.value?.toLowerCase()||'';
  const cat=document.getElementById('vn-cat-filter')?.value||'';
  let vns=D.vendors;
  if(q)vns=vns.filter(v=>v.name.toLowerCase().includes(q)||(v.contact||'').toLowerCase().includes(q)||(v.notes||'').toLowerCase().includes(q));
  if(cat)vns=vns.filter(v=>v.category===cat);
  const catIcon={'Catering / Food':'ti-tools-kitchen-2','Photography / Video':'ti-camera','Venue':'ti-building','Printing / Apparel':'ti-shirt','Entertainment / DJ':'ti-music','Transportation':'ti-car','Alcohol / Beverages':'ti-glass','Flowers / Decor':'ti-leaf','Other':'ti-package'};
  const catColors={'Catering / Food':'background:#fbeaf0;color:#993556','Photography / Video':'background:var(--bl-bg);color:var(--bl-tx)','Venue':'background:var(--am-bg);color:var(--am-tx)','Printing / Apparel':'background:var(--gn-bg);color:var(--gn-tx)','Entertainment / DJ':'background:#f0f0ee;color:var(--mt)','Transportation':'background:#e8eef7;color:#1a3a6b','Other':'background:#f0f0ee;color:var(--mt)'};
  const grid=document.getElementById('vn-grid');const empty=document.getElementById('vn-empty');
  if(!vns.length){grid.style.display='none';empty.style.display='';empty.innerHTML=es('ti-building-store','slate','No vendors found','Add your first vendor or clear filters.','');return;}
  grid.style.display='grid';empty.style.display='none';
  grid.innerHTML=vns.map(v=>{
    const stars='★'.repeat(v.rating||3)+'☆'.repeat(5-(v.rating||3));
    return`<div class="folder-card" style="position:relative">
      <div onclick="vnOpenEdit('${v.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:7px">
        <div style="display:flex;align-items:center;gap:9px">
          <div style="width:36px;height:36px;border-radius:9px;background:#e8eef7;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ${catIcon[v.category]||'ti-package'}" style="font-size:17px;color:var(--navy)"></i></div>
          <div><div class="folder-name">${v.name}</div><span class="badge" style="${catColors[v.category]||'background:#f0f0ee;color:var(--mt)'};font-size:9px">${v.category||'Other'}</span></div>
        </div>
        <div style="font-size:12px;color:#f5a623;white-space:nowrap;flex-shrink:0">${stars}</div>
      </div>
      ${v.contact?`<div style="font-size:11px;color:var(--mt)"><i class="ti ti-user" style="font-size:10px;margin-right:3px"></i>${v.contact}</div>`:''}
      ${v.phone?`<div style="font-size:11px;color:var(--mt)"><i class="ti ti-phone" style="font-size:10px;margin-right:3px"></i>${v.phone}</div>`:''}
      ${v.cost?`<div style="font-size:11px;font-weight:500;color:var(--navy)">${v.cost}</div>`:''}
      ${v.notes?`<div style="font-size:10.5px;color:var(--ht);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${v.notes}</div>`:''}
      ${v.lastUsed?`<div style="font-size:9.5px;color:var(--ht)">Last used: ${v.lastUsed}</div>`:''}
      </div>
      <button class="ib" style="position:absolute;top:6px;right:6px;width:20px;height:20px;font-size:11px;color:var(--ht)" onclick="event.stopPropagation();vnDelete('${v.id}')" title="Delete vendor"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join('');
}
function vnOpenAdd(){
  document.getElementById('vn-edit-id').value='';
  document.getElementById('vn-modal-title').textContent='Add Vendor';
  ['vn-name','vn-contact','vn-phone','vn-email','vn-website','vn-cost','vn-notes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('vn-cat').value='';
  document.getElementById('vn-rating').value='3';
  document.getElementById('m-vn-add').classList.add('open');
}
function vnOpenEdit(id){
  const v=D.vendors.find(v=>v.id===id);if(!v)return;
  document.getElementById('vn-edit-id').value=id;
  document.getElementById('vn-modal-title').textContent='Edit Vendor';
  document.getElementById('vn-name').value=v.name;
  document.getElementById('vn-cat').value=v.category||'';
  document.getElementById('vn-contact').value=v.contact||'';
  document.getElementById('vn-phone').value=v.phone||'';
  document.getElementById('vn-email').value=v.email||'';
  document.getElementById('vn-website').value=v.website||'';
  document.getElementById('vn-rating').value=v.rating||3;
  document.getElementById('vn-cost').value=v.cost||'';
  document.getElementById('vn-notes').value=v.notes||'';
  document.getElementById('m-vn-add').classList.add('open');
}
function vnSave(){
  const name=document.getElementById('vn-name').value.trim();
  if(!name){toast('Vendor name is required','error');return;}
  const id=document.getElementById('vn-edit-id').value;
  const data={name,category:document.getElementById('vn-cat').value,contact:document.getElementById('vn-contact').value.trim(),phone:document.getElementById('vn-phone').value.trim(),email:document.getElementById('vn-email').value.trim(),website:document.getElementById('vn-website').value.trim(),rating:parseInt(document.getElementById('vn-rating').value)||3,cost:document.getElementById('vn-cost').value.trim(),notes:document.getElementById('vn-notes').value.trim()};
  if(id){const v=D.vendors.find(v=>v.id===id);if(v)Object.assign(v,data);}
  else D.vendors.push({id:uid(),...data});
  saveD();closeM(null,document.getElementById('m-vn-add'));renderVendors();toast(id?'Vendor updated':'Vendor added','success');
}
async function vnDelete(id){
  const ok=await confirmDialog('Delete Vendor','Remove this vendor from the directory?');
  if(!ok)return;
  D.vendors=D.vendors.filter(v=>v.id!==id);
  saveD();renderVendors();toast('Vendor deleted','info');
}

// ══════════════════════════════════════════════════
// CHAPTER HEALTH SCORECARD
// ══════════════════════════════════════════════════
function renderHealthScore(){
  const tot=D.members.length||1;
  const avg=Math.round(D.members.reduce((s,m)=>s+aR(m.id),0)/tot);
  const openT=D.tasks.filter(t=>t.status!=='done').length;
  const doneT=D.tasks.filter(t=>t.status==='done').length;
  const taskPct=D.tasks.length?Math.round(doneT/D.tasks.length*100):50;
  const openCases=D.cases.filter(c=>!['resolved','dismissed'].includes(c.status)).length;
  const caseScore=Math.max(0,100-openCases*18);
  const gpas=D.members.map(m=>{const rec=D.academics?.gpas?.[m.id]||{};const v=rec.cumulativeGpa||rec.priorGpa||'';return v?parseFloat(v):null;}).filter(g=>g!==null&&!isNaN(g));
  const avgGpa=gpas.length?(gpas.reduce((a,b)=>a+b,0)/gpas.length):0;
  const gpaScore=avgGpa?Math.round((avgGpa/4)*100):50;
  const finDues=D.finance?.dues||{};
  const paidCount=D.members.filter(m=>(finDues[m.id]?.status||'Partial')==='Paid').length;
  const finScore=D.members.length?Math.round(paidCount/D.members.length*100):50;
  const rushees=D.recruitment?.rushees||[];
  const recruitScore=Math.min(100,Math.round((rushees.length/30)*100));
  const phHrs=D.philanthropy?.hours?.reduce((s,h)=>s+parseFloat(h.hours||0),0)||0;
  const phScore=Math.min(100,Math.round((phHrs/500)*100));
  const alumCount=D.alumni?.contacts?.length||0;
  const alumScore=Math.min(100,Math.round((alumCount/20)*100));

  const dims=[
    {k:'Attendance',icon:'ti-users',v:avg,w:.22,desc:'Average member attendance rate',target:85,color:'var(--navy)'},
    {k:'Task Completion',icon:'ti-checkbox',v:taskPct,w:.18,desc:doneT+' of '+D.tasks.length+' tasks done',target:80,color:'var(--gn)'},
    {k:'Academics',icon:'ti-school',v:gpaScore,w:.15,desc:avgGpa?('Avg GPA '+avgGpa.toFixed(2)):'No GPA data yet',target:90,color:'var(--bl)'},
    {k:'Accountability',icon:'ti-scale',v:caseScore,w:.13,desc:openCases+' open Compliance Board case'+(openCases!==1?'s':''),target:90,color:caseScore>=80?'var(--gn)':'var(--rd)'},
    {k:'Finances',icon:'ti-cash',v:finScore,w:.12,desc:paidCount+' / '+D.members.length+' members paid',target:85,color:'var(--am)'},
    {k:'Recruitment',icon:'ti-user-plus',v:recruitScore,w:.08,desc:rushees.length+' rushees tracked',target:80,color:'#7c5cfc'},
    {k:'Philanthropy',icon:'ti-heart',v:phScore,w:.07,desc:phHrs.toFixed(0)+' service hours logged',target:75,color:'#e05fa0'},
    {k:'Alumni',icon:'ti-users-group',v:alumScore,w:.05,desc:alumCount+' alumni in directory',target:70,color:'#0ea5a0'},
  ];

  const score=Math.round(dims.reduce((s,d)=>s+d.v*d.w,0));
  const scoreColor=score>=80?'var(--gn)':score>=65?'var(--navy)':score>=50?'var(--am)':'var(--rd)';
  const grade=score>=90?'A':score>=80?'B':score>=70?'C':score>=60?'D':'F';
  const gradeStyle=score>=80?'background:var(--gn-bg);color:var(--gn-tx)':score>=65?'background:var(--bl-bg);color:var(--bl-tx)':score>=50?'background:var(--am-bg);color:var(--am-tx)':'background:var(--rd-bg);color:var(--rd-tx)';

  document.getElementById('hs-kpi').innerHTML=
    kpi('Health Score',score+' / 100',grade+' Grade',score>=80?'up':score>=65?'neutral':'down')+
    kpi('Attendance',avg+'%',avg>=85?'On target':'Below 85% goal',avg>=85?'up':'down')+
    kpi('Open Cases',openCases,openCases?'Needs attention':'All clear',openCases?'down':'up')+
    kpi('Tasks Done',taskPct+'%',doneT+' of '+D.tasks.length+' complete',taskPct>=75?'up':'neutral');

  // Ring — new SVG uses r=33, C=2π×33=207.3, stroke is always white (on navy bg)
  const ring=document.getElementById('hs-ring');
  const C=207.3;
  if(ring){setTimeout(()=>{ring.style.strokeDashoffset=C*(1-score/100);},100);}
  const sv=document.getElementById('hs-score-val');if(sv)sv.textContent=score;
  const gd=document.getElementById('hs-grade');
  if(gd){const gradeLabel={A:'A — Excellent',B:'B — Good',C:'C — Developing',D:'D — At Risk',F:'F — Critical'}[grade]||grade;gd.textContent=gradeLabel;}
  const sm=document.getElementById('hs-summary');if(sm)sm.textContent=score>=80?'Chapter is in strong health across all dimensions.':score>=65?'Good standing — a few areas need attention.':score>=50?'Several dimensions below target. Exec focus needed.':'Chapter is at risk. Immediate action required.';
  document.getElementById('hs-updated').textContent='Updated '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});

  // Dimension bars
  document.getElementById('hs-dims').innerHTML=dims.map(d=>{
    const p=d.v;const hit=p>=d.target;
    return`<div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="display:flex;align-items:center;gap:6px"><i class="ti ${d.icon}" style="font-size:12px;color:${d.color}"></i><span style="font-size:12px;font-weight:500">${d.k}</span><span style="font-size:9.5px;color:var(--ht)">${d.desc}</span></div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0"><span style="font-size:11.5px;font-weight:700;color:${hit?'var(--gn)':'var(--rd)'}">${p}%</span><span style="font-size:9px;color:var(--ht)">/ ${d.target}%</span></div>
      </div>
      <div style="height:6px;background:#f0f0ee;border-radius:99px;overflow:hidden;position:relative">
        <div style="height:100%;border-radius:99px;background:${d.color};width:${p}%;transition:width .7s ease"></div>
        <div style="position:absolute;top:0;bottom:0;left:${d.target}%;width:2px;background:#d0d0ce;border-radius:1px"></div>
      </div>
    </div>`;
  }).join('');

  // Strengths / improvements / actions
  const strong=dims.filter(d=>d.v>=d.target).sort((a,b)=>b.v-a.v);
  const weak=dims.filter(d=>d.v<d.target).sort((a,b)=>a.v-b.v);
  document.getElementById('hs-strengths').innerHTML=strong.length?strong.map(d=>`<div class="al-row"><div class="al-ic" style="background:var(--gn-bg);color:var(--gn-tx)"><i class="ti ${d.icon}"></i></div><div><div style="font-size:12px;font-weight:500">${d.k}</div><div style="font-size:10.5px;color:var(--mt)">${d.v}% — ${d.v-d.target}pts above target</div></div></div>`).join(''):es('ti-mood-happy','green','All areas at target!','Keep it up.','');
  document.getElementById('hs-improvements').innerHTML=weak.length?weak.map(d=>`<div class="al-row"><div class="al-ic" style="background:var(--rd-bg);color:var(--rd-tx)"><i class="ti ${d.icon}"></i></div><div><div style="font-size:12px;font-weight:500">${d.k}</div><div style="font-size:10.5px;color:var(--mt)">${d.v}% — needs ${d.target-d.v}pts to hit target</div></div></div>`).join(''):es('ti-circle-check','green','All dimensions on target!','','');
  const actions=[];
  if(avg<85)actions.push({icon:'ti-users',txt:'Mark attendance for recent mandatory events to improve tracking accuracy.'});
  if(taskPct<75)actions.push({icon:'ti-checkbox',txt:'Review overdue tasks with officers. Consider reassigning stalled items.'});
  if(openCases>2)actions.push({icon:'ti-scale',txt:'Schedule Compliance Board hearings for the '+openCases+' open cases.'});
  if(finScore<70)actions.push({icon:'ti-cash',txt:'Send dues reminder to '+((D.members.length)-paidCount)+' members with outstanding balances.'});
  if(phHrs<200)actions.push({icon:'ti-heart',txt:'Schedule a service event — chapter is behind on service hour goals.'});
  if(alumCount<10)actions.push({icon:'ti-users-group',txt:'Reach out to known alumni and add them to the directory.'});
  if(!actions.length)actions.push({icon:'ti-sparkles',txt:'Chapter is in strong shape! Focus on maintaining momentum into finals.'});
  document.getElementById('hs-actions').innerHTML=actions.map(a=>`<div class="al-row"><div class="al-ic" style="background:var(--bl-bg);color:var(--bl-tx)"><i class="ti ${a.icon}"></i></div><div style="font-size:11.5px;line-height:1.5">${a.txt}</div></div>`).join('');

  // History chart (generate plausible weekly data)
  hsRenderHistory(score);
}
function hsRenderHistory(currentScore){
  // Use real mandatory past events for history — compute score at each point
  const mandPast=D.events.filter(e=>e.mandatory&&!isUp(e.date)).sort((a,b)=>a.date.localeCompare(b.date)).slice(-8);
  const tot=D.members.length||1;
  let data=[],labels=[];
  if(mandPast.length>=2){
    data=mandPast.map(ev=>{
      const att=D.attendance[ev.id]||{};
      const pres=Object.values(att).filter(v=>v==='present'||v==='excused').length;
      return Math.round(pres/tot*100);
    });
    labels=mandPast.map(ev=>mos(ev.date)+' '+dom(ev.date));
  } else {
    // Not enough data
    document.getElementById('hs-history-chart').innerHTML=`<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:rgba(255,255,255,.5)">No historical data yet — mark attendance to build history.</div>`;
    document.getElementById('hs-history-labels').innerHTML='';
    return;
  }
  const mx=Math.max(...data,1);
  document.getElementById('hs-history-chart').innerHTML=data.map((v,i)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="font-size:9px;color:rgba(255,255,255,.6)">${v}%</div><div style="flex:1;width:100%;background:${i===data.length-1?'rgba(255,255,255,.9)':v>=85?'rgba(29,158,117,.7)':v>=70?'rgba(255,255,255,.4)':'rgba(226,75,74,.6)'};border-radius:3px 3px 0 0;min-height:4px;height:${Math.round(v/mx*100)}%" title="${labels[i]}: ${v}%"></div></div>`).join('');
  document.getElementById('hs-history-labels').innerHTML=labels.map(l=>`<span style="color:rgba(255,255,255,.5)">${l}</span>`).join('');
}


function rcOpenGoalEdit(){
  const g=D.recruitment.goal||{target:20,label:'New Members This Semester'};
  document.getElementById('rcg-label').value=g.label||'New Members This Semester';
  document.getElementById('rcg-target').value=g.target||20;
  document.getElementById('m-rc-goal').classList.add('open');
}
function rcSaveGoal(){
  const target=parseInt(document.getElementById('rcg-target').value);
  const label=document.getElementById('rcg-label').value.trim()||'New Members This Semester';
  if(!target||target<1){toast('Enter a valid target','error');return;}
  if(!D.recruitment.goal)D.recruitment.goal={};
  D.recruitment.goal.target=target;
  D.recruitment.goal.label=label;
  saveD();
  closeM(null,document.getElementById('m-rc-goal'));
  renderRecruitment();
  toast('Recruitment goal updated','success');
}
// ══════════════════════════════════════════════════
// PLAYBOOKS / SOPs
// ══════════════════════════════════════════════════

let PB_OPEN_ID = null;

function dPlaybooks(){return[
  {
    id:'pb1', title:'Weekly VP Checklist', category:'weekly',
    owner:'Vice President', when:'Every Monday morning',
    updated:'2026-08-01',
    purpose:'Ensure the Vice President keeps chapter operations running smoothly week-to-week. Catches issues before they become problems.',
    steps:[
      'Review last week\'s attendance — flag anyone below 75% for follow-up',
      'Check all open tasks and confirm assignees are on track',
      'Send agenda draft to President for review by Monday noon',
      'Confirm safety officerther assignments are filled for any weekend events',
      'Review any open Compliance Board cases for status updates',
      'Check dues status — follow up with Treasurer on unpaid members',
      'Message each officer asking for a one-line status update by Tuesday',
      'Review upcoming calendar events for the next 14 days',
      'Confirm team meeting room is booked and AV is available',
      'Send weekly chapter digest email by Tuesday evening',
    ]
  },
  {
    id:'pb2', title:'Chapter Meeting SOP', category:'meetings',
    owner:'Vice President', when:'Before every team meeting',
    updated:'2026-08-01',
    purpose:'Standardize team meetings so they run on time, stay productive, and result in clear action items every week.',
    steps:[
      'Send meeting reminder to all members 48 hours in advance',
      'Lock the agenda 24 hours before — no last-minute adds without VP approval',
      'Set up the room: seats, projector/TV, whiteboard, sign-in sheet',
      'Open roll call at start time — mark attendance in the platform',
      'President calls meeting to order; review last week\'s minutes',
      'Pledge of Loyalty',
      'Officer reports in order: President, VP, Treasurer, Secretary, then chairs',
      'Old business — follow up on items from last meeting',
      'New business — motions, discussions, announcements',
      'Open floor — 5 minutes max',
      'Brother of the Week / Buffon of the Week',
      'President adjourns; VP locks final attendance within 30 minutes',
      'Secretary posts minutes in Files within 24 hours',
    ]
  },
  {
    id:'pb3', title:'Executive Board Meeting SOP', category:'meetings',
    owner:'President', when:'Before every exec meeting (weekly or bi-weekly)',
    updated:'2026-08-01',
    purpose:'Keep exec meetings focused, accountable, and action-oriented. Every meeting should end with clear owners and due dates.',
    steps:[
      'President sends agenda at least 24 hours in advance',
      'Each officer prepares a 2-minute status update before the meeting',
      'Review action items from the previous exec meeting',
      'Financial update from Treasurer — budget vs. actuals',
      'Recruitment update — pipeline health, upcoming events',
      'Academics update — GPA concerns, scholarship chair report',
      'Risk and safety officer update from Risk Manager',
      'Each committee chair provides a 60-second update',
      'Identify top 3 chapter priorities for the coming week',
      'Assign action items with clear owners and due dates',
      'President closes meeting; VP logs all action items as tasks in the platform',
    ]
  },
  {
    id:'pb4', title:'Compliance Review Process', category:'governance',
    owner:'President', when:'When a standards violation is reported',
    updated:'2026-08-01',
    purpose:'Ensure fair, consistent, and confidential handling of standards violations. Protect both the chapter and the individual member.',
    steps:[
      'Incident reported to President or VP — document in Compliance Board section immediately',
      'President assigns case number and notifies Compliance Board chair within 24 hours',
      'Compliance Board chair reaches out to the accused member privately within 48 hours',
      'Gather statements from all relevant parties (written preferred)',
      'Schedule hearing within 7 days — notify all parties of time and location',
      'Hearing held: accused presents their side, board asks questions',
      'Board deliberates in private — majority vote required for any sanction',
      'Decision communicated to accused within 24 hours of hearing',
      'Document outcome, sanction (if any), and completion timeline in platform',
      'Follow up on any assigned sanctions — mark complete when fulfilled',
      'Case closed and archived; remain confidential to board members only',
    ]
  },
  {
    id:'pb5', title:'Recruitment Event Checklist', category:'events',
    owner:'Recruitment Chair', when:'5 days before every rush event',
    updated:'2026-08-01',
    purpose:'Make every recruitment event run flawlessly. First impressions define whether a rushee bids — logistics cannot fail.',
    steps:[
      'Confirm venue booking and headcount capacity 5 days out',
      'Finalize food/catering order — confirm dietary restrictions if asked',
      'Brief all brothers on dress code, talking points, and no-pressure etiquette',
      'Assign each brother 1-2 rushees to personally engage throughout the event',
      'Set up the space 1 hour before — clean, organized, welcoming',
      'Designate a greeter at the door with the rushee list',
      'Track attendance in the Recruitment CRM as rushees arrive',
      'Mid-event check-in: Recruitment Chair circulates to ensure all rushees are engaged',
      'Collect contact info for any new leads before they leave',
      'Post-event debrief within 24 hours — update stages and scores in CRM',
      'Follow up with top prospects within 48 hours of the event',
    ]
  },
  {
    id:'pb6', title:'Social Event Setup Checklist', category:'events',
    owner:'Social Chair', when:'One week before any social event',
    updated:'2026-08-01',
    purpose:'Ensure every social event is safe, organized, and compliant with Risk Management policies and national standards.',
    steps:[
      'Submit event details to Risk Manager for approval at least 7 days out',
      'Confirm venue contract and deposit payment with Treasurer',
      'Book safety officerthers — minimum 2 required, confirm in Sober Bro schedule',
      'Coordinate guest list with co-hosting organization (if applicable)',
      'Arrange transportation if off-campus — confirm driver count',
      'Communicate dress code and event details to all members 72 hours out',
      'Verify first aid kit and emergency contact list is on-site',
      'Set up entrance check-in — ID check if required by venue',
      'Risk Manager performs a pre-event safety walk-through',
      'During event: Safety officers monitor entry/exit, no outside alcohol policy enforced',
      'Post-event: venue left clean, incidents (if any) documented within 12 hours',
    ]
  },
  {
    id:'pb7', title:'Philanthropy Event Checklist', category:'events',
    owner:'Philanthropy Chair', when:'Two weeks before any service/philanthropy event',
    updated:'2026-08-01',
    purpose:'Maximize chapter participation and community impact while tracking service hours accurately for IFC and national reporting.',
    steps:[
      'Confirm organization partnership and event logistics 2 weeks out',
      'Create event in Philanthropy section of platform — set hour goal',
      'Send sign-up to all members with clear call-to-action',
      'Brief members on dress code, tools needed, and organization mission',
      'Arrange transportation if off-site',
      'Day-of: take attendance at start and end of event',
      'Log individual service hours in platform within 24 hours',
      'Take photos for PR/social media (with organization permission)',
      'Send thank-you note to partnering organization within 48 hours',
      'Report total hours to IFC or national if required',
      'Recognize top contributors at next team meeting',
    ]
  },
  {
    id:'pb8', title:'Crisis / Incident Protocol', category:'crisis',
    owner:'President', when:'Immediately when a serious incident occurs',
    updated:'2026-08-01',
    purpose:'Protect member safety, manage liability, and maintain chapter integrity during any crisis. Speed and accuracy of response matters.',
    steps:[
      'STEP 1 — SAFETY FIRST: Ensure all members and guests are physically safe. Call 911 if there is any immediate risk to life.',
      'STEP 2 — CONTAIN: Stop the event or activity immediately. Clear the space if necessary.',
      'STEP 3 — NOTIFY: President calls VP and Risk Manager within 15 minutes.',
      'STEP 4 — DO NOT POST: Issue a no-social-media directive to all members immediately.',
      'STEP 5 — DOCUMENT: Write down a factual timeline while events are fresh — who, what, when, where.',
      'STEP 6 — CALL NATIONALS: Contact legal counsel and national leadership within 2 hours of any serious incident.',
      'STEP 7 — COOPERATE: Cooperate fully with university and law enforcement. Do not obstruct.',
      'STEP 8 — MEMBER SUPPORT: Check in on member wellbeing. Connect anyone in distress with ISU Student Wellness.',
      'STEP 9 — LEGAL: Do not make any public statements until consulting with legal counsel.',
      'STEP 10 — DEBRIEF: Hold a closed exec debrief within 24 hours. Identify what failed and update SOPs.',
      'STEP 11 — FOLLOW-UP: File all required university and national incident reports within the required window.',
    ]
  },
  {
    id:'pb9', title:'Officer Transition Checklist', category:'semester',
    owner:'President', when:'Final 3 weeks of each semester',
    updated:'2026-08-01',
    purpose:'Ensure institutional knowledge transfers completely between officers. No chapter should lose momentum because one person left.',
    steps:[
      'Outgoing officers complete transition documents in the Transition Hub (platform)',
      'Each outgoing officer schedules a 1-hour handoff meeting with their successor',
      'Transfer all login credentials, passwords, and account access securely',
      'Hand over all physical items: keys, storage units, binders, equipment',
      'Outgoing Treasurer reconciles all accounts and hands off to new Treasurer with Advisor present',
      'New officers shadow outgoing at one team meeting before full handoff',
      'New VP reviews and updates all SOPs — flag anything outdated',
      'New President sets exec priorities for the incoming semester at retreat',
      'Advisor confirms all national reporting is current before changeover',
      'Hold a joint exec dinner — outgoing and incoming officers together',
      'Mark all transition docs as complete in the Transition Hub',
    ]
  },
  {
    id:'pb10', title:'Semester Startup Checklist', category:'semester',
    owner:'President', when:'First 2 weeks of each semester',
    updated:'2026-08-01',
    purpose:'Get the chapter fully operational from day one. A strong start sets the tone for the entire semester.',
    steps:[
      'Hold exec retreat before classes start — set semester goals and priorities',
      'Confirm all officer rosters are updated in the platform',
      'Update member roster — remove graduated members, add new initiates',
      'Set semester dues amount and payment deadline in Finance section',
      'Build the semester calendar in platform — all mandatory events blocked',
      'Assign committee members and confirm committee chairs are briefed',
      'Set up semester attendance tracking — create first mandatory event',
      'Send semester-opening email to all members: expectations, dates, exec contacts',
      'Schedule recruitment planning meeting with Recruitment Chair',
      'Confirm risk management plan with Risk Manager for the semester',
      'Set semester GPA targets with Scholarship Chair',
      'Book recurring meeting rooms for chapter and exec meetings',
      'Submit updated member roster to national leadership',
    ]
  },
  {
    id:'pb11', title:'Semester Closing Checklist', category:'semester',
    owner:'President', when:'Final 2 weeks of each semester',
    updated:'2026-08-01',
    purpose:'Close out the semester cleanly so nothing falls through the cracks and the incoming exec inherits a well-documented chapter.',
    steps:[
      'Collect all outstanding dues — final reminder issued 2 weeks before closing',
      'Finalize semester attendance records and run end-of-semester report',
      'Submit final GPA report to Scholarship Chair; flag academic probation cases',
      'Close out semester budget — all expenses reconciled and filed',
      'Compile philanthropy hours — submit IFC service report if required',
      'Archive meeting notes, files, and reports for the semester',
      'Run end-of-semester Compliance Board review — resolve or carry forward open cases',
      'Recognition night: Team Building awards, attendance awards, GPA awards',
      'Collect exec feedback — anonymous survey on chapter operations',
      'Update all SOPs based on lessons learned this semester',
      'Begin officer transition process (see Officer Transition Checklist)',
      'Send end-of-semester message from President to full chapter',
    ]
  },
]}

function pbCatLabel(cat){
  return{weekly:'Weekly / Recurring',meetings:'Meetings',events:'Events',governance:'Governance',semester:'Semester',crisis:'Crisis'}[cat]||cat;
}
function pbCatStyle(cat){
  return{
    weekly:'background:var(--bl-bg);color:var(--bl-tx)',
    meetings:'background:var(--gn-bg);color:var(--gn-tx)',
    events:'background:var(--am-bg);color:var(--am-tx)',
    governance:'background:#e8eef7;color:#1a3a6b',
    semester:'background:#f0f0ee;color:var(--mt)',
    crisis:'background:var(--rd-bg);color:var(--rd-tx)',
  }[cat]||'background:#f0f0ee;color:var(--mt)';
}
function pbCatIcon(cat){
  return{weekly:'ti-refresh',meetings:'ti-users',events:'ti-calendar-event',governance:'ti-scale',semester:'ti-calendar',crisis:'ti-alert-triangle'}[cat]||'ti-checklist';
}

function renderPlaybooks(){
  if(!D.playbooks||D.playbooks.length===0)D.playbooks=dPlaybooks();
  PB_OPEN_ID=null;
  document.getElementById('pb-grid').style.display='';
  document.getElementById('pb-detail').style.display='none';
  pbRenderGrid();
}

function pbFilter(){pbRenderGrid();}

function pbRenderGrid(){
  const q=(document.getElementById('pb-search')?.value||'').toLowerCase();
  const cat=document.getElementById('pb-cat-filter')?.value||'';
  let pbs=D.playbooks||[];
  if(q)pbs=pbs.filter(p=>p.title.toLowerCase().includes(q)||p.owner.toLowerCase().includes(q)||(p.purpose||'').toLowerCase().includes(q));
  if(cat)pbs=pbs.filter(p=>p.category===cat);

  // Group by category
  const cats=['weekly','meetings','events','governance','semester','crisis'];
  const grouped={};
  pbs.forEach(p=>{if(!grouped[p.category])grouped[p.category]=[];grouped[p.category].push(p);});

  // If filtering, flatten into a simple grid
  let html='';
  if(q||cat){
    if(!pbs.length){
      html=es('ti-checklist','blue','No playbooks found','Try a different search or category filter.','');
    } else {
      html=`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${pbs.map(p=>pbCard(p)).join('')}</div>`;
    }
  } else {
    // Grouped view
    cats.forEach(c=>{
      const items=grouped[c];
      if(!items||!items.length)return;
      html+=`<div style="margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px">
          <div style="width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;${pbCatStyle(c)}"><i class="ti ${pbCatIcon(c)}" style="font-size:13px"></i></div>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--mt)">${pbCatLabel(c)}</span>
          <span style="font-size:10px;color:var(--ht)">${items.length} SOP${items.length>1?'s':''}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${items.map(p=>pbCard(p)).join('')}</div>
      </div>`;
    });
    if(!html)html=es('ti-checklist','blue','No playbooks yet','Click "+ New SOP" to create your first playbook.',`<button class="btn btn-p" onclick="pbOpenAdd()"><i class="ti ti-plus"></i>New SOP</button>`);
  }
  document.getElementById('pb-grid').innerHTML=html;
}

function pbCard(p){
  const stepCount=p.steps?.length||0;
  return`<div class="folder-card" onclick="pbOpenDetail('${p.id}')">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
      <div style="display:flex;align-items:center;gap:9px;min-width:0">
        <div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;${pbCatStyle(p.category)}">
          <i class="ti ${pbCatIcon(p.category)}" style="font-size:16px"></i>
        </div>
        <div style="min-width:0">
          <div class="folder-name" style="white-space:normal;line-height:1.3">${p.title}</div>
          <span class="badge" style="${pbCatStyle(p.category)};margin-top:3px;font-size:9px">${pbCatLabel(p.category)}</span>
        </div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--mt);line-height:1.5;margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${p.purpose||''}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
      <div style="display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--mt)">
        <i class="ti ti-user" style="font-size:10px"></i>${p.owner||'—'}
      </div>
      <span style="font-size:10px;color:var(--ht);display:flex;align-items:center;gap:3px"><i class="ti ti-list-check" style="font-size:10px"></i>${stepCount} steps</span>
    </div>
  </div>`;
}

function pbOpenDetail(id){
  const p=(D.playbooks||[]).find(x=>x.id===id);
  if(!p)return;
  PB_OPEN_ID=id;
  document.getElementById('pb-grid').style.display='none';
  document.getElementById('pb-detail').style.display='';
  document.getElementById('pb-detail-breadcrumb').textContent='SOPs & Playbooks / '+pbCatLabel(p.category);

  const stepsDone=p.stepsDone||{};
  const totalSteps=p.steps?.length||0;
  const doneCount=Object.values(stepsDone).filter(Boolean).length;
  const pct=totalSteps?Math.round(doneCount/totalSteps*100):0;

  document.getElementById('pb-detail-body').innerHTML=`
    <div class="nd-header" style="margin-bottom:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:13px;flex-wrap:wrap">
        <div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.09em;opacity:.7;margin-bottom:5px;display:flex;align-items:center;gap:6px">
            <span class="badge" style="${pbCatStyle(p.category)};opacity:.9">${pbCatLabel(p.category)}</span>
          </div>
          <div style="font-size:20px;font-weight:700;line-height:1.2;margin-bottom:6px">${p.title}</div>
          <div style="display:flex;align-items:center;gap:13px;font-size:11px;opacity:.8;flex-wrap:wrap">
            <span><i class="ti ti-user" style="font-size:11px;margin-right:4px"></i>${p.owner||'—'}</span>
            <span><i class="ti ti-clock" style="font-size:11px;margin-right:4px"></i>${p.when||'—'}</span>
            <span><i class="ti ti-calendar" style="font-size:11px;margin-right:4px"></i>Updated ${p.updated||'—'}</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:26px;font-weight:700;line-height:1">${pct}%</div>
          <div style="font-size:10px;opacity:.7">complete</div>
          ${doneCount>0?`<button onclick="pbResetProgress('${id}')" style="margin-top:6px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:5px;color:#fff;font-size:10px;padding:2px 8px;cursor:pointer;font-family:inherit">Reset</button>`:''}
        </div>
      </div>
      <div style="height:4px;background:rgba(255,255,255,.2);border-radius:99px;overflow:hidden;margin-top:10px">
        <div style="height:100%;background:#fff;border-radius:99px;width:${pct}%;transition:width .5s ease"></div>
      </div>
    </div>

    <div class="g2" style="margin-bottom:13px">
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-target" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Purpose</span></div>
        <p style="font-size:12.5px;line-height:1.7;color:var(--tx)">${p.purpose||'No purpose defined.'}</p>
      </div>
      <div class="card">
        <div class="card-hd"><span class="card-t"><i class="ti ti-clock" style="font-size:12px;color:var(--navy);margin-right:4px"></i>When to Use</span></div>
        <p style="font-size:12.5px;line-height:1.7;color:var(--tx)">${p.when||'—'}</p>
        <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--bdr)">
          <div class="card-t" style="margin-bottom:5px"><i class="ti ti-user" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Owner</div>
          <div style="font-size:13px;font-weight:600;color:var(--navy)">${p.owner||'—'}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <span class="card-t"><i class="ti ti-list-check" style="font-size:12px;color:var(--navy);margin-right:4px"></i>Step-by-Step Checklist</span>
        <span style="font-size:11px;color:var(--mt)">${doneCount} / ${totalSteps} complete</span>
      </div>
      <div id="pb-steps-list">
        ${(p.steps||[]).map((step,i)=>{
          const done=stepsDone[i]||false;
          const isCrisis=step.startsWith('STEP');
          return`<div class="tk-row" style="cursor:pointer;padding:8px 0" onclick="pbToggleStep('${id}',${i})">
            <div class="tc ${done?'done':''}" style="width:18px;height:18px;flex-shrink:0;margin-top:1px">${done?'<i class="ti ti-check" style="font-size:10px"></i>':''}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:${isCrisis?'12.5px':'12px'};font-weight:${isCrisis?'600':'400'};color:${done?'var(--ht)':'var(--tx)'};${done?'text-decoration:line-through':''}; line-height:1.5">${step}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function pbToggleStep(id,idx){
  const p=(D.playbooks||[]).find(x=>x.id===id);if(!p)return;
  if(!p.stepsDone)p.stepsDone={};
  p.stepsDone[idx]=!p.stepsDone[idx];
  saveD();
  pbOpenDetail(id);
}

function pbResetProgress(id){
  const p=(D.playbooks||[]).find(x=>x.id===id);if(!p)return;
  p.stepsDone={};
  saveD();
  pbOpenDetail(id);
  toast('Progress reset','info');
}

function pbCloseDetail(){
  PB_OPEN_ID=null;
  document.getElementById('pb-grid').style.display='';
  document.getElementById('pb-detail').style.display='none';
}

function pbOpenAdd(){
  document.getElementById('pb-edit-id').value='';
  document.getElementById('pb-modal-title').textContent='New SOP / Playbook';
  ['pb-title','pb-owner','pb-when','pb-purpose','pb-steps'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('pb-cat').value='meetings';
  document.getElementById('m-pb-add').classList.add('open');
}

function pbOpenEdit(id){
  const p=(D.playbooks||[]).find(x=>x.id===id);if(!p)return;
  document.getElementById('pb-edit-id').value=id;
  document.getElementById('pb-modal-title').textContent='Edit SOP';
  document.getElementById('pb-title').value=p.title||'';
  document.getElementById('pb-cat').value=p.category||'meetings';
  document.getElementById('pb-owner').value=p.owner||'';
  document.getElementById('pb-when').value=p.when||'';
  document.getElementById('pb-purpose').value=p.purpose||'';
  document.getElementById('pb-steps').value=(p.steps||[]).join('\n');
  document.getElementById('m-pb-add').classList.add('open');
}

function pbSave(){
  const title=document.getElementById('pb-title').value.trim();
  if(!title){toast('Title is required','error');return;}
  const stepsRaw=document.getElementById('pb-steps').value;
  const steps=stepsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
  const id=document.getElementById('pb-edit-id').value;
  const today=new Date().toISOString().split('T')[0];
  const data={
    title,
    category:document.getElementById('pb-cat').value,
    owner:document.getElementById('pb-owner').value.trim(),
    when:document.getElementById('pb-when').value.trim(),
    purpose:document.getElementById('pb-purpose').value.trim(),
    steps,
    updated:today,
  };
  if(!D.playbooks)D.playbooks=dPlaybooks();
  if(!D.transitionHub)D.transitionHub={deadlines:[],issues:[],archive:[]};
  if(id){
    const p=D.playbooks.find(x=>x.id===id);
    if(p)Object.assign(p,data);
  } else {
    D.playbooks.push({id:uid(),stepsDone:{},...data});
  }
  saveD();
  closeM(null,document.getElementById('m-pb-add'));
  if(PB_OPEN_ID===id&&id){pbOpenDetail(id);}
  else{pbCloseDetail();pbRenderGrid();}
  toast(id?'SOP updated':'SOP created','success');
}

function pbPrint(){
  const p=(D.playbooks||[]).find(x=>x.id===PB_OPEN_ID);if(!p)return;
  const w=window.open('','_blank','width=800,height=700');
  const stepsDone=p.stepsDone||{};
  w.document.write(`<!DOCTYPE html><html><head><title>${p.title}</title><style>
    body{'font-family':'Segoe UI',system-ui,sans-serif;margin:0;padding:32px;font-size:13px;color:#1a1a18;line-height:1.6;max-width:720px}
    .header{background:#0c1d56;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px}
    .header h1{'font-size':20px;font-weight:700;margin:0 0 6px}
    .header .meta{'font-size':11px;opacity:.75;display:flex;gap:16px;flex-wrap:wrap}
    .section{'margin-bottom':18px}
    .section h3{'font-size':10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b6b68;margin:0 0 8px;border-top:1px solid #e5e5e3;padding-top:12px}
    .step{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f0f0ee}
    .step:last-child{'border-bottom':none}
    .num{width:22px;height:22px;border-radius:50%;background:#0c1d56;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
    .num.done{background:#1d9e75}
    .step-text{flex:1;line-height:1.5}
    .step-text.done{'text-decoration':line-through;color:#aaa}
    @media print{body{padding:16px}}
  </style></head><body>
  <div class="header">
    <h1>${p.title}</h1>
    <div class="meta">
      <span>Owner: ${p.owner||'—'}</span>
      <span>When: ${p.when||'—'}</span>
      <span>Updated: ${p.updated||'—'}</span>
      <span>Category: ${pbCatLabel(p.category)}</span>
    </div>
  </div>
  <div class="section"><h3>Purpose</h3><p>${p.purpose||'—'}</p></div>
  <div class="section"><h3>Step-by-Step Checklist (${p.steps?.length||0} steps)</h3>
    ${(p.steps||[]).map((step,i)=>{const done=stepsDone[i]||false;return`<div class="step"><div class="num ${done?'done':''}">${done?'&#10003;':i+1}</div><div class="step-text ${done?'done':''}">${step}</div></div>`;}).join('')}
  </div>
  </body>
  </html>`);
}


// ══════════════════════════════════════════════════
// GLOBAL SEARCH
// ══════════════════════════════════════════════════
let _gsTimer = null;
let _gsFocusIdx = -1;
let _gsResults = [];

// Category config: icon bg, icon color, icon, badge style, badge label
const GS_CATS = {
  members:     {icon:'ti-user-circle',   bg:'#e8eef7',       ic:'#1a3a6b',  bs:'background:#e8eef7;color:#1a3a6b',          bl:'Member'},
  tasks:       {icon:'ti-checkbox',      bg:'var(--gn-bg)',  ic:'var(--gn-tx)', bs:'background:var(--gn-bg);color:var(--gn-tx)', bl:'Task'},
  notes:       {icon:'ti-notes',         bg:'var(--am-bg)',  ic:'var(--am-tx)', bs:'background:var(--am-bg);color:var(--am-tx)', bl:'Meeting Note'},
  events:      {icon:'ti-calendar-event',bg:'var(--bl-bg)',  ic:'var(--bl-tx)', bs:'background:var(--bl-bg);color:var(--bl-tx)', bl:'Event'},
  files:       {icon:'ti-file',          bg:'#f0f0ee',       ic:'var(--mt)', bs:'background:#f0f0ee;color:var(--mt)',          bl:'File'},
  recruitment: {icon:'ti-user-plus',     bg:'var(--gn-bg)',  ic:'var(--gn-tx)', bs:'background:var(--gn-bg);color:var(--gn-tx)', bl:'Rushee'},
  cases:       {icon:'ti-scale',         bg:'var(--rd-bg)',  ic:'var(--rd-tx)', bs:'background:var(--rd-bg);color:var(--rd-tx)', bl:'Compliance Board Case'},
  playbooks:   {icon:'ti-checklist',     bg:'var(--bl-bg)',  ic:'var(--bl-tx)', bs:'background:var(--bl-bg);color:var(--bl-tx)', bl:'Playbook'},
  finance:     {icon:'ti-cash',          bg:'var(--gn-bg)',  ic:'var(--gn-tx)', bs:'background:var(--gn-bg);color:var(--gn-tx)', bl:'Finance'},
  alumni:      {icon:'ti-users-group',   bg:'var(--am-bg)',  ic:'var(--am-tx)', bs:'background:var(--am-bg);color:var(--am-tx)', bl:'Alumni'},
};

const GS_CAT_LABELS = {
  members:'Members', tasks:'Tasks', notes:'Meeting Notes', events:'Calendar Events',
  files:'Files', recruitment:'Recruitment', cases:'Compliance Review', playbooks:'SOPs & Playbooks',
  finance:'Finance', alumni:'Alumni',
};

function gsHighlight(text, q) {
  if (!q || !text) return text || '';
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp('(' + escaped + ')', 'gi'), '<mark>$1</mark>');
}

function gsSearch(q) {
  if (!q || q.length < 2) return [];
  const lq = q.toLowerCase();
  const results = [];

  // ── Members ──
  (D.members || []).forEach(m => {
    if (m.name.toLowerCase().includes(lq) || (m.role||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'members', id: m.id,
        title: m.name,
        sub: m.role + ' · ' + m.classYear + ' · ' + (m.liveIn ? 'Live-in' : 'Live-out'),
        action: () => { rbacNav('members', null); setTimeout(() => { const s = document.getElementById('m-search'); if(s){s.value=m.name;filterM();} }, 100); }
      });
    }
  });

  // ── Tasks ──
  (D.tasks || []).forEach(t => {
    if (t.title.toLowerCase().includes(lq) || (t.desc||'').toLowerCase().includes(lq)) {
      const assignee = mB(t.assignedTo);
      results.push({
        cat: 'tasks', id: t.id,
        title: t.title,
        sub: (t.priority||'').charAt(0).toUpperCase()+(t.priority||'').slice(1)+' priority · '+assignee.name+(t.dueDate?' · Due '+fds(t.dueDate):''),
        status: t.status,
        action: () => { rbacNav('tasks', null); setTimeout(() => openEditTask(t.id), 150); }
      });
    }
  });

  // ── Meeting Notes ──
  (D.notes || []).forEach(n => {
    const bodyText = (n.body||'') + (n.announcements||'') + (n.oldBusiness||'') + (n.newBusiness||'');
    if (n.title.toLowerCase().includes(lq) || bodyText.toLowerCase().includes(lq)) {
      results.push({
        cat: 'notes', id: n.id,
        title: n.title,
        sub: fds(n.date) + ' · ' + (n.type||'Organization') + ' meeting',
        action: () => { rbacNav('notes', null); setTimeout(() => openNoteDetail(n.id), 150); }
      });
    }
  });

  // ── Calendar Events ──
  (D.events || []).forEach(e => {
    if (e.title.toLowerCase().includes(lq) || (e.location||'').toLowerCase().includes(lq) || (e.type||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'events', id: e.id,
        title: e.title,
        sub: fds(e.date) + (e.start?' · '+e.start:'') + (e.location?' · '+e.location:'') + (e.mandatory?' · Required':''),
        action: () => {
          const d = new Date(e.date + 'T12:00:00');
          CAL_YEAR = d.getFullYear(); CAL_MONTH = d.getMonth();
          rbacNav('calendar', null);
        }
      });
    }
  });

  // ── Files ──
  (D.files || []).forEach(f => {
    if (f.name.toLowerCase().includes(lq) || (f.folder||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'files', id: f.id,
        title: f.name,
        sub: (f.folder||'General') + ' · ' + f.size + ' · ' + fds(f.date),
        action: () => { rbacNav('files', null); }
      });
    }
  });

  // ── Recruitment Rushees ──
  ((D.recruitment||{}).rushees || []).forEach(r => {
    if (r.name.toLowerCase().includes(lq) || (r.major||'').toLowerCase().includes(lq) || (r.stage||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'recruitment', id: r.id,
        title: r.name,
        sub: r.stage + ' · ' + (r.major||'Unknown major') + ' · Score: ' + (r.bidScore||0),
        action: () => { rbacNav('recruitment', null); setTimeout(() => rcOpenProfile(r.id), 200); }
      });
    }
  });

  // ── Judicial Cases ──
  (D.cases || []).forEach(c => {
    const memberName = mB(c.member).name;
    if (c.caseNum.toLowerCase().includes(lq) || memberName.toLowerCase().includes(lq) || (c.desc||'').toLowerCase().includes(lq) || (c.type||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'cases', id: c.id,
        title: c.caseNum + ' — ' + memberName,
        sub: c.type + ' · ' + c.status + (c.hearingDate?' · '+fds(c.hearingDate):''),
        action: () => { rbacNav('judicial', null); }
      });
    }
  });

  // ── Playbooks / SOPs ──
  (D.playbooks || []).forEach(p => {
    const searchText = p.title + ' ' + (p.purpose||'') + ' ' + (p.owner||'') + ' ' + (p.steps||[]).join(' ');
    if (searchText.toLowerCase().includes(lq)) {
      results.push({
        cat: 'playbooks', id: p.id,
        title: p.title,
        sub: GS_CATS.playbooks.bl + ' · ' + p.owner + ' · ' + (p.steps||[]).length + ' steps',
        action: () => { rbacNav('files', null); }
      });
    }
  });

  // ── Finance: Fines ──
  ((D.finance||{}).fines || []).forEach(f => {
    const m = mB(f.memberId);
    if ((m.name||'').toLowerCase().includes(lq) || (f.reason||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'finance', id: f.id,
        title: '$' + f.amount + ' fine — ' + m.name,
        sub: f.reason + ' · ' + f.status + (f.date ? ' · ' + fds(f.date) : ''),
        action: () => { rbacNav('finance', null); setTimeout(() => finTab(document.querySelector('[data-tab=fin-fines]'), 'fin-fines'), 150); }
      });
    }
  });

  // ── Finance: Expenses ──
  ((D.finance||{}).expenses || []).forEach(e => {
    if ((e.description||'').toLowerCase().includes(lq) || (e.category||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'finance', id: e.id,
        title: '$' + e.amount + ' — ' + (e.description||'Expense'),
        sub: (e.category||'') + (e.date ? ' · ' + fds(e.date) : ''),
        action: () => { rbacNav('finance', null); setTimeout(() => finTab(document.querySelector('[data-tab=fin-budget]'), 'fin-budget'), 150); }
      });
    }
  });

  // ── Alumni ──
  ((D.alumni||{}).contacts || []).forEach(a => {
    if ((a.name||'').toLowerCase().includes(lq) || (a.employer||'').toLowerCase().includes(lq) || (a.location||'').toLowerCase().includes(lq)) {
      results.push({
        cat: 'alumni', id: a.id,
        title: a.name,
        sub: (a.employer||'—') + ' · ' + (a.location||'—') + ' · ' + (a.engagement||'Unknown'),
        action: () => { rbacNav('alumni', null); }
      });
    }
  });

  return results;
}

function gsRender(q, results) {
  const dd = document.getElementById('gs-dropdown');
  if (!results.length) {
    dd.innerHTML = `<div class="gs-empty"><i class="ti ti-search-off"></i>No results for "<strong>${q}</strong>"</div>`;
    dd.classList.add('open');
    return;
  }

  // Group by category, maintain order defined in GS_CATS
  const catOrder = Object.keys(GS_CATS);
  const grouped = {};
  results.forEach(r => {
    if (!grouped[r.cat]) grouped[r.cat] = [];
    if (grouped[r.cat].length < 4) grouped[r.cat].push(r); // cap 4 per category
  });

  let html = '';
  let globalIdx = 0;
  _gsResults = [];

  catOrder.forEach(cat => {
    const items = grouped[cat];
    if (!items || !items.length) return;
    const cfg = GS_CATS[cat];
    html += `<div class="gs-group-hd">${GS_CAT_LABELS[cat]} <span style="font-weight:400;font-size:9px">(${items.length})</span></div>`;
    items.forEach(item => {
      const idx = globalIdx++;
      _gsResults.push(item);
      html += `<div class="gs-item" data-idx="${idx}" onmousedown="gsPickIdx(${idx})">
        <div class="gs-item-ic" style="background:${cfg.bg};color:${cfg.ic}"><i class="ti ${cfg.icon}"></i></div>
        <div class="gs-item-body">
          <div class="gs-item-title">${gsHighlight(item.title, q)}</div>
          <div class="gs-item-sub">${item.sub}</div>
        </div>
        <span class="gs-item-badge" style="${cfg.bs}">${cfg.bl}</span>
      </div>`;
    });
  });

  const total = results.length;
  if (total > _gsResults.length) {
    html += `<div class="gs-footer">Showing top results · ${total} total matches</div>`;
  } else {
    html += `<div class="gs-footer">${total} result${total !== 1 ? 's' : ''}</div>`;
  }

  dd.innerHTML = html;
  dd.classList.add('open');
  _gsFocusIdx = -1;
}

function gsOnInput() {
  const q = document.getElementById('gs-input').value.trim();
  const clearBtn = document.getElementById('gs-clear');
  clearBtn.classList.toggle('vis', q.length > 0);

  clearTimeout(_gsTimer);
  if (q.length < 2) { gsClose(); return; }
  _gsTimer = setTimeout(() => {
    const results = gsSearch(q);
    gsRender(q, results);
  }, 120);
}

function gsOnFocus() {
  const q = document.getElementById('gs-input').value.trim();
  if (q.length >= 2) {
    const results = gsSearch(q);
    gsRender(q, results);
  }
}

function gsOnKey(e) {
  const dd = document.getElementById('gs-dropdown');
  const items = dd.querySelectorAll('.gs-item');
  if (!items.length) {
    if (e.key === 'Escape') gsClear();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _gsFocusIdx = Math.min(_gsFocusIdx + 1, items.length - 1);
    gsFocusItem(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _gsFocusIdx = Math.max(_gsFocusIdx - 1, 0);
    gsFocusItem(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_gsFocusIdx >= 0 && _gsResults[_gsFocusIdx]) {
      gsPickIdx(_gsFocusIdx);
    }
  } else if (e.key === 'Escape') {
    gsClear();
  }
}

function gsFocusItem(items) {
  items.forEach((el, i) => el.classList.toggle('focused', i === _gsFocusIdx));
  if (items[_gsFocusIdx]) items[_gsFocusIdx].scrollIntoView({ block: 'nearest' });
}

function gsPickIdx(idx) {
  const item = _gsResults[idx];
  if (!item) return;
  gsClear();
  if (item.action) item.action();
}

function gsClose() {
  document.getElementById('gs-dropdown').classList.remove('open');
  _gsFocusIdx = -1;
}

function gsClear() {
  const inp = document.getElementById('gs-input');
  inp.value = '';
  document.getElementById('gs-clear').classList.remove('vis');
  gsClose();
  inp.blur();
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!document.getElementById('gs-wrap')?.contains(e.target)) gsClose();
});

// Keyboard shortcut: / or Cmd+K to focus search
document.addEventListener('keydown', e => {
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const inp = document.getElementById('gs-input');
    if (inp) { inp.focus(); inp.select(); }
  }
});


