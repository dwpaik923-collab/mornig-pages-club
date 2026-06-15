/* ================== SUPABASE 설정 ================== */
const SUPABASE_URL = 'https://lztzqqijllczwoojubsf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4LWywzGz5JnXFmoNG3N8tw_IZbow1SP';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ================== 상수 ================== */
const GOLDEN_SECONDS = 90 * 60; // 90분
const TOTAL_DAYS = 21;
const PLANT_STAGE_COUNT = 21; // 21단계 식물 성장

const MOOD_EMOJI = ['🌞','🙂','😐','😮‍💨','🌧️'];
const COLORS = ["#e98a7d","#f6b083","#8ba888","#5c7a5a","#3d3a6b","#c97b84","#7e9bb5","#d9a05b"];

/* ================== 전역 상태 ================== */
let currentUser = null;
let currentSession = null;
let myRecords = [];     // 내 daily_records (현재 회차)
let myPosts = [];       // 내 posts (현재 회차)
let allUsers = [];      // 관리자용
let allQuotes = [];     // 관리자용
let timerInterval = null;
let pendingImages = []; // base64 array (업로드 대기 이미지)
let isPrivatePost = false;
let selectedMood = null;
let selectedMoodScore = null;

/* ================== 유틸 ================== */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2400);
}

// 한국시간(KST, UTC+9) 기준 현재 시각
function nowKST(){
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  return new Date(utc + 9*60*60*1000);
}
// KST 기준 날짜 문자열 YYYY-MM-DD
function todayKST(){
  const d = nowKST();
  return d.toISOString().slice(0,10);
}
// 두 날짜(YYYY-MM-DD) 사이의 day 번호 계산 (시작일=1일차)
function dayNumber(startDate, dateStr){
  const start = new Date(startDate+'T00:00:00+09:00');
  const target = new Date(dateStr+'T00:00:00+09:00');
  const diff = Math.round((target-start)/(1000*60*60*24));
  return diff+1; // 시작일이 1일차
}

function localStore(){
  let mem={}, ok=false;
  try{localStorage.setItem('__t','1');localStorage.removeItem('__t');ok=true;}catch(e){}
  return {
    get:k=>{try{return ok?localStorage.getItem(k):mem[k]}catch(e){return mem[k]}},
    set:(k,v)=>{try{ok?localStorage.setItem(k,v):mem[k]=v}catch(e){mem[k]=v}},
    remove:k=>{try{ok?localStorage.removeItem(k):delete mem[k]}catch(e){delete mem[k]}}
  };
}
const store = localStore();

/* ================== 화면 전환 ================== */
function showScreen(id){
  $$('.screen').forEach(s=>s.classList.remove('active'));
  $('#'+id).classList.add('active');
}
function setActiveNav(screenId){
  $$('.nav button').forEach(b=>b.classList.toggle('active', b.dataset.screen===screenId));
}

$$('.nav button').forEach(b=>{
  b.onclick = async ()=>{
    setActiveNav(b.dataset.screen);
    showScreen(b.dataset.screen);
    if(b.dataset.screen==='feed') await renderFeed();
    if(b.dataset.screen==='garden') await renderGarden();
    if(b.dataset.screen==='dash') await renderDash();
    if(b.dataset.screen==='admin') await renderAdmin();
  };
});

/* ================== 인증 (로그인/회원가입) ================== */
$('#goSignup').onclick = ()=>{
  $('#loginCard').style.display='none';
  $('#signupCard').style.display='block';
  $('#loginError').classList.remove('show');
};
$('#goLogin').onclick = ()=>{
  $('#signupCard').style.display='none';
  $('#loginCard').style.display='block';
  $('#signupError').classList.remove('show');
};

function showAuthError(which, msg){
  const el = $(which==='login'?'#loginError':'#signupError');
  el.textContent = msg;
  el.classList.add('show');
}

$('#loginBtn').onclick = async ()=>{
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  if(!username || !password){ showAuthError('login','아이디와 비밀번호를 입력해주세요.'); return; }

  $('#loginBtn').disabled = true;
  try{
    const { data, error } = await sb.from('users').select('*').eq('username', username).eq('password', password).maybeSingle();
    if(error) throw error;
    if(!data){ showAuthError('login','아이디 또는 비밀번호가 올바르지 않아요.'); return; }

    // 관리자가 아닐 경우 현재 활성 회차에 속해있는지 + 기간 체크
    if(!data.is_admin){
      const session = await getActiveSession();
      if(!session){ showAuthError('login','현재 진행 중인 회차가 없어요. 운영자에게 문의해주세요.'); return; }
      if(!data.current_session_id || data.current_session_id !== session.id){
        showAuthError('login','이번 회차에 등록되지 않은 계정이에요. 새 인증코드로 다시 참여해주세요.');
        return;
      }
      const today = todayKST();
      if(today > session.end_date){
        showAuthError('login','이번 회차는 종료되었어요. 다음 회차 모집을 기다려주세요!');
        return;
      }
    }

    currentUser = data;
    store.set('mpc_user_id', data.id);
    await afterLogin();
  }catch(e){
    console.error(e);
    showAuthError('login','로그인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
  }finally{
    $('#loginBtn').disabled = false;
  }
};

$('#signupBtn').onclick = async ()=>{
  const username = $('#suUsername').value.trim();
  const password = $('#suPassword').value;
  const nickname = $('#suNickname').value.trim();
  const email = $('#suEmail').value.trim();
  const code = $('#suCode').value.trim();

  if(!username || !password || !nickname || !email || !code){
    showAuthError('signup','모든 항목을 입력해주세요.'); return;
  }

  $('#signupBtn').disabled = true;
  try{
    // 현재 활성 회차 + 인증코드 확인
    const session = await getActiveSession();
    if(!session){ showAuthError('signup','현재 모집 중인 회차가 없어요.'); return; }
    if(session.auth_code !== code){ showAuthError('signup','인증코드가 올바르지 않아요.'); return; }

    const today = todayKST();
    if(today > session.end_date){ showAuthError('signup','이번 회차는 이미 종료되었어요.'); return; }

    // 기존 유저 확인 (재참여자)
    const { data: existing } = await sb.from('users').select('*').eq('username', username).maybeSingle();

    if(existing){
      // 재참여: 비번/닉네임/이메일 갱신 + 회차/일수/연속 초기화
      const { error } = await sb.from('users').update({
        password, nickname, email,
        current_session_id: session.id,
        current_day: 0,
        streak: 0,
        status: 'active',
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
      if(error) throw error;
      const { data: refreshed } = await sb.from('users').select('*').eq('id', existing.id).single();
      currentUser = refreshed;
    }else{
      const { data: created, error } = await sb.from('users').insert({
        username, password, nickname, email,
        current_session_id: session.id,
        current_day: 0, streak: 0, status:'active', is_admin:false
      }).select().single();
      if(error) throw error;
      currentUser = created;
    }

    store.set('mpc_user_id', currentUser.id);
    toast('회원가입 완료! 환영해요 🌱');
    await afterLogin();
  }catch(e){
    console.error(e);
    if(e.code === '23505'){
      showAuthError('signup','이미 사용 중인 아이디예요.');
    }else{
      showAuthError('signup','가입 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    }
  }finally{
    $('#signupBtn').disabled = false;
  }
};

$('#logoutBtn').onclick = ()=>{
  store.remove('mpc_user_id');
  currentUser = null;
  if(timerInterval) clearInterval(timerInterval);
  $('#app').style.display='none';
  showScreen('authScreen');
  $('#loginCard').style.display='block';
  $('#signupCard').style.display='none';
  $('#loginUsername').value=''; $('#loginPassword').value='';
  $('#app').style.display='block';
};

async function getActiveSession(){
  const { data } = await sb.from('sessions').select('*').eq('is_active', true).order('created_at',{ascending:false}).limit(1).maybeSingle();
  return data || null;
}

/* ================== 로그인 후 초기화 ================== */
async function afterLogin(){
  showScreen('home');
  setActiveNav('home');

  if(currentUser.is_admin){
    $('#adminNavBtn').style.display='flex';
    $('#wakeCard').style.display='none';
    $('#timerWrap').classList.remove('show');
  }else{
    $('#adminNavBtn').style.display='none';
  }

  currentSession = await getActiveSession();

  await loadMyData();
  setQuote();
  makeStars();
  updateDayChip();
  setupWakeUI();
}

async function loadMyData(){
  if(!currentSession || currentUser.is_admin) { myRecords=[]; myPosts=[]; return; }
  const { data: records } = await sb.from('daily_records').select('*').eq('user_id', currentUser.id).eq('session_id', currentSession.id).order('day');
  myRecords = records || [];
  const { data: posts } = await sb.from('posts').select('*').eq('user_id', currentUser.id).eq('session_id', currentSession.id).order('day',{ascending:false});
  myPosts = posts || [];
}

/* ================== 명언 ================== */
async function setQuote(){
  try{
    const day = getCurrentDay();
    const { data } = await sb.from('quotes').select('*').eq('is_active', true).order('order_num', {ascending:true, nullsFirst:false});
    if(data && data.length){
      // day번째(1-indexed) 명언을 우선 사용, 부족하면 순환
      const idx = (day-1) % data.length;
      const q = data[idx];
      $('#quote').innerHTML = `"${escapeHtml(q.quote_text)}"${q.author?`<span class="by">— ${escapeHtml(q.author)}</span>`:''}`;
    }else{
      $('#quote').innerHTML = `"오늘도 세 장, 나에게 건네는 인사."`;
    }
  }catch(e){
    $('#quote').innerHTML = `"오늘도 세 장, 나에게 건네는 인사."`;
  }
}
function escapeHtml(str){
  if(!str) return '';
  return str.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function makeStars(){
  let h='';
  for(let i=0;i<26;i++){
    h+=`<div class="star" style="left:${Math.random()*100}%;top:${Math.random()*55}%;animation-delay:${Math.random()*3}s"></div>`;
  }
  $('#stars').innerHTML = h;
}

/* ================== 일차 / 기상 / 타이머 ================== */
function getCurrentDay(){
  if(!currentSession) return 1;
  const today = todayKST();
  let day = dayNumber(currentSession.start_date, today);
  if(day < 1) day = 1;
  if(day > TOTAL_DAYS) day = TOTAL_DAYS;
  return day;
}

function updateDayChip(){
  const day = getCurrentDay();
  $('#dayChip').innerHTML = `🌱 ${day}일차 · 오늘도 시작해요`;
}

async function getTodayRecord(){
  const day = getCurrentDay();
  return myRecords.find(r=>r.day===day) || null;
}

async function setupWakeUI(){
  if(currentUser.is_admin) return;
  if(timerInterval) clearInterval(timerInterval);

  const record = await getTodayRecord();

  if(!record){
    // 아직 기상 안 함
    $('#wakeCard').style.display='block';
    $('#timerWrap').classList.remove('show');
    $('#wakeBtn').disabled = false;
    $('#wakeBtn').textContent = '☀️ 방금 일어났어요';
    return;
  }

  if(record.status === 'success'){
    $('#wakeCard').style.display='block';
    $('#wakeBtn').disabled = true;
    $('#wakeBtn').textContent = '오늘 인증 완료 🌟';
    $('#timerWrap').classList.remove('show');
    return;
  }

  if(record.status === 'failed'){
    $('#wakeCard').style.display='block';
    $('#wakeBtn').disabled = true;
    $('#wakeBtn').textContent = '오늘은 인증 실패예요 🌧️';
    $('#timerWrap').classList.remove('show');
    return;
  }

  // pending - 골든타임 진행 중 or 만료
  $('#wakeCard').style.display='none';
  $('#timerWrap').classList.add('show');
  startGoldenTimer(record);
}

$('#wakeBtn').onclick = async ()=>{
  if(currentUser.is_admin) return;
  const existing = await getTodayRecord();
  if(existing) return;

  $('#wakeBtn').disabled = true;
  try{
    const day = getCurrentDay();
    const wokeAt = new Date().toISOString();
    const { data, error } = await sb.from('daily_records').insert({
      user_id: currentUser.id, session_id: currentSession.id, day, woke_at: wokeAt, status:'pending', wilting_level:0
    }).select().single();
    if(error) throw error;
    myRecords.push(data);
    toast('기상 시간이 기록됐어요! 골든타임 시작 ☀️');
    await setupWakeUI();
  }catch(e){
    console.error(e);
    toast('오류가 발생했어요. 다시 시도해주세요.');
    $('#wakeBtn').disabled = false;
  }
};

function startGoldenTimer(record){
  const wokeAt = new Date(record.woke_at).getTime();

  function tick(){
    const now = Date.now();
    const elapsed = Math.floor((now - wokeAt)/1000);
    const remaining = GOLDEN_SECONDS - elapsed;

    const pct = Math.min(1, Math.max(0, elapsed/GOLDEN_SECONDS));
    const circumference = 540; // 2*pi*86
    const offset = circumference * pct;
    $('#ringProg').style.strokeDashoffset = offset;

    let color, msg, msgClass;
    if(remaining > GOLDEN_SECONDS*0.5){
      color='var(--green)'; msgClass='green';
      msg='여유로워요! 천천히 세 장을 채워보세요 🌿';
    }else if(remaining > GOLDEN_SECONDS*0.15){
      color='var(--yellow)'; msgClass='yellow';
      msg='시간이 조금씩 줄고 있어요. 마무리를 준비해볼까요? ⏳';
    }else if(remaining > 0){
      color='var(--red)'; msgClass='red';
      msg='골든타임이 곧 끝나요! 지금 인증해주세요 🔥';
    }else{
      color='var(--red)'; msgClass='red';
      msg='골든타임이 지났어요. 자정 전까지는 기록을 남겨보세요.';
    }
    $('#ringProg').style.stroke = color;
    $('#timerMsg').className = 'timer-msg '+msgClass;
    $('#timerMsg').textContent = msg;

    const absRem = Math.abs(remaining);
    const m = String(Math.floor(absRem/60)).padStart(2,'0');
    const s = String(absRem%60).padStart(2,'0');
    if(remaining >= 0){
      $('#ringTime').textContent = `${m}:${s}`;
      $('#ringTime').classList.remove('late');
      $('#ringSub').textContent = '골든타임 남음';
      $('#verifyBtn').disabled = false;
      $('#verifyBtn').textContent = '📷 모닝페이지 인증하기';
    }else{
      $('#ringTime').textContent = `+${m}:${s}`;
      $('#ringTime').classList.add('late');
      $('#ringSub').textContent = '골든타임 종료';
      $('#verifyBtn').disabled = true;
      $('#verifyBtn').textContent = '⏰ 골든타임이 지나 인증할 수 없어요';
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

/* ================== 인증(verify) 시트 ================== */
$('#verifyBtn').onclick = ()=>{
  if($('#verifyBtn').disabled) return;
  resetVerifySheet();
  $('#overlay').classList.add('show');
};
$('#cancelBtn').onclick = ()=>$('#overlay').classList.remove('show');
$('#overlay').addEventListener('click', e=>{ if(e.target.id==='overlay') $('#overlay').classList.remove('show'); });

function resetVerifySheet(){
  pendingImages = [];
  selectedMood = null; selectedMoodScore = null;
  isPrivatePost = false;
  $('#imgPreview').innerHTML='';
  $('#noteInput').value='';
  $$('#moods button').forEach(b=>b.classList.remove('sel'));
  $('#privateSwitch').classList.remove('on');
}

$('#uploader').onclick = ()=>$('#fileInput').click();
$('#fileInput').onchange = (e)=>{
  const files = Array.from(e.target.files);
  for(const f of files){
    if(pendingImages.length >= 5){ toast('사진은 최대 5장까지 올릴 수 있어요.'); break; }
    const reader = new FileReader();
    reader.onload = ev=>{
      pendingImages.push(ev.target.result);
      renderImgPreview();
    };
    reader.readAsDataURL(f);
  }
  e.target.value='';
};
function renderImgPreview(){
  $('#imgPreview').innerHTML = pendingImages.map((src,i)=>`
    <div class="pv"><img src="${src}"><button class="rm" data-i="${i}">✕</button></div>
  `).join('');
  $$('#imgPreview .rm').forEach(b=>b.onclick=()=>{
    pendingImages.splice(+b.dataset.i,1);
    renderImgPreview();
  });
}

$$('#moods button').forEach(b=>b.onclick=()=>{
  $$('#moods button').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  selectedMood = b.dataset.mood;
  selectedMoodScore = +b.dataset.score;
});

$('#privateSwitch').onclick = ()=>{
  isPrivatePost = !isPrivatePost;
  $('#privateSwitch').classList.toggle('on', isPrivatePost);
};

$('#submitBtn').onclick = async ()=>{
  if(!selectedMood){ toast('오늘의 컨디션을 선택해주세요.'); return; }

  $('#submitBtn').disabled = true;
  $('#submitBtn').textContent = '업로드 중...';
  try{
    const day = getCurrentDay();
    const record = await getTodayRecord();
    if(!record){ toast('먼저 기상 버튼을 눌러주세요.'); return; }

    // 이미지 업로드
    const imageUrls = [];
    for(let i=0;i<pendingImages.length;i++){
      const url = await uploadImage(pendingImages[i], `${currentUser.id}_${currentSession.id}_${day}_${i}_${Date.now()}.jpg`);
      if(url) imageUrls.push(url);
    }

    const note = $('#noteInput').value.trim();

    // post 생성
    const { error: postErr } = await sb.from('posts').insert({
      user_id: currentUser.id, session_id: currentSession.id, day,
      woke_at: record.woke_at, mood: selectedMood, note: note || '오늘도 세 장, 완료!',
      images: imageUrls, is_private: isPrivatePost, likes_count:0
    });
    if(postErr) throw postErr;

    // record 업데이트
    const newStreak = (currentUser.streak||0) + 1;
    const newDay = Math.max(currentUser.current_day||0, day);
    const wilting = 0; // 인증 성공시 시들기 초기화(복구)

    const { error: recErr } = await sb.from('daily_records').update({
      verified_at: new Date().toISOString(), status:'success', mood: selectedMood, wilting_level: wilting
    }).eq('id', record.id);
    if(recErr) throw recErr;

    const { data: updatedUser, error: userErr } = await sb.from('users').update({
      current_day: newDay, streak: newStreak, updated_at: new Date().toISOString()
    }).eq('id', currentUser.id).select().single();
    if(userErr) throw userErr;
    currentUser = updatedUser;

    await loadMyData();

    $('#overlay').classList.remove('show');
    if(timerInterval) clearInterval(timerInterval);
    await setupWakeUI();

    showCelebration(newStreak);
  }catch(e){
    console.error(e);
    toast('인증 중 오류가 발생했어요. 다시 시도해주세요.');
  }finally{
    $('#submitBtn').disabled = false;
    $('#submitBtn').textContent = '인증 완료하기';
  }
};

async function uploadImage(base64, filename){
  try{
    const res = await fetch(base64);
    const blob = await res.blob();
    const { data, error } = await sb.storage.from('post-images').upload(filename, blob, { contentType: blob.type || 'image/jpeg' });
    if(error) throw error;
    const { data: pub } = sb.storage.from('post-images').getPublicUrl(filename);
    return pub.publicUrl;
  }catch(e){
    console.error('image upload failed', e);
    return null;
  }
}

/* ================== 축하 팝업 ================== */
function showCelebration(streak){
  $('#streakBadge').textContent = `${streak}일 연속! 🔥`;
  const messages = [
    '오늘도 스스로와의 약속을 지켰어요. 작은 한 걸음이 모여 큰 나무가 됩니다.',
    '잘했어요! 무의식이 조금씩 정리되고 있을 거예요.',
    '꾸준함이 가장 큰 재능이에요. 내일도 함께해요.',
    '오늘의 세 장이 미래의 나에게 보내는 선물이에요.',
    '정원이 한 뼘 더 자랐어요. 천천히, 그러나 분명하게.'
  ];
  $('#celebrateMsg').textContent = messages[Math.floor(Math.random()*messages.length)];
  $('#celebrateOverlay').classList.add('show');
  launchConfetti();
}
$('#celebrateCloseBtn').onclick = async ()=>{
  $('#celebrateOverlay').classList.remove('show');
  setActiveNav('garden');
  showScreen('garden');
  await renderGarden();
};
function launchConfetti(){
  const cols=['#e98a7d','#f6b083','#ffce7a','#8ba888','#3d3a6b'];
  for(let i=0;i<70;i++){
    const c=document.createElement('div');
    c.className='confetti';
    c.style.left=Math.random()*100+'vw';
    c.style.background=cols[i%cols.length];
    const dur=1.6+Math.random()*1.2;
    c.style.transition=`transform ${dur}s ease-in, opacity ${dur}s`;
    document.body.appendChild(c);
    requestAnimationFrame(()=>{
      c.style.transform=`translateY(105vh) rotate(${Math.random()*720}deg)`;
      c.style.opacity=0;
    });
    setTimeout(()=>c.remove(), dur*1000+100);
  }
}

/* ================== 피드 ================== */
async function renderFeed(){
  if(!currentSession){ $('#postList').innerHTML = `<div class="empty">진행 중인 회차가 없어요.</div>`; return; }

  const { data: posts, error } = await sb.from('posts')
    .select('*, users!posts_user_id_fkey(nickname)')
    .eq('session_id', currentSession.id)
    .order('created_at',{ascending:false})
    .limit(100);

  if(error){ console.error(error); $('#postList').innerHTML = `<div class="empty">피드를 불러오지 못했어요.</div>`; return; }

  const visible = (posts||[]).filter(p=> !p.is_private || p.user_id===currentUser.id || currentUser.is_admin);

  if(!visible.length){
    $('#postList').innerHTML = `<div class="empty">아직 올라온 페이지가 없어요.<br>가장 먼저 오늘의 페이지를 공유해보세요 ✍️</div>`;
    return;
  }

  // likes 가져오기
  const postIds = visible.map(p=>p.id);
  let myLikes = new Set();
  if(postIds.length){
    const { data: likes } = await sb.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
    (likes||[]).forEach(l=>myLikes.add(l.post_id));
  }

  $('#postList').innerHTML = visible.map(p=>{
    const name = p.users?.nickname || '익명';
    const color = COLORS[hashCode(name)%COLORS.length];
    const wokeTime = p.woke_at ? new Date(p.woke_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}) : '-';
    const timeAgo = timeAgoStr(p.created_at);
    const liked = myLikes.has(p.id);

    let imgsHtml;
    if(p.images && p.images.length){
      imgsHtml = `<div class="post-imgs">${p.images.map(src=>`<img src="${src}" loading="lazy">`).join('')}</div>`;
    }else{
      imgsHtml = `<div class="post-img placeholder">오늘의 세 페이지 ✍️</div>`;
    }

    return `
    <div class="post">
      <div class="post-top">
        <div class="avatar" style="background:${color}">${name[0]}</div>
        <div>
          <div class="name">${escapeHtml(name)} ${p.is_private?'<span class="badge-private">🔒 비공개</span>':''}</div>
          <div class="meta">${p.day}일차 · 기상 ${wokeTime} · ${timeAgo}</div>
        </div>
        <div class="mood">${p.mood||''}</div>
      </div>
      ${imgsHtml}
      <div class="post-body">
        <div class="post-note">${escapeHtml(p.note||'')}</div>
        <div class="post-actions">
          <button class="act ${liked?'on':''}" data-like="${p.id}"><span class="ic">${liked?'❤️':'🤍'}</span> <span class="lc">${p.likes_count||0}</span></button>
          <button class="act" data-cheer="${escapeHtml(name)}"><span class="ic">🔥</span> 응원</button>
        </div>
      </div>
    </div>`;
  }).join('');

  $$('#postList [data-like]').forEach(b=>b.onclick=()=>toggleLike(b));
  $$('#postList [data-cheer]').forEach(b=>b.onclick=()=>toast(`${b.dataset.cheer}님에게 응원을 보냈어요 🔥`));
}

function hashCode(str){
  let hash=0;
  for(let i=0;i<str.length;i++){ hash = (hash<<5)-hash+str.charCodeAt(i); hash|=0; }
  return Math.abs(hash);
}
function timeAgoStr(iso){
  const diff = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(diff<60) return '방금 전';
  if(diff<3600) return Math.floor(diff/60)+'분 전';
  if(diff<86400) return Math.floor(diff/3600)+'시간 전';
  return Math.floor(diff/86400)+'일 전';
}

async function toggleLike(btn){
  const postId = btn.dataset.like;
  const isOn = btn.classList.contains('on');
  try{
    if(isOn){
      await sb.from('likes').delete().eq('user_id', currentUser.id).eq('post_id', postId);
      const { data: post } = await sb.from('posts').select('likes_count').eq('id', postId).single();
      const newCount = Math.max(0,(post.likes_count||0)-1);
      await sb.from('posts').update({likes_count:newCount}).eq('id', postId);
      btn.classList.remove('on');
      btn.querySelector('.ic').textContent='🤍';
      btn.querySelector('.lc').textContent=newCount;
    }else{
      await sb.from('likes').insert({user_id:currentUser.id, post_id:postId});
      const { data: post } = await sb.from('posts').select('likes_count').eq('id', postId).single();
      const newCount = (post.likes_count||0)+1;
      await sb.from('posts').update({likes_count:newCount}).eq('id', postId);
      btn.classList.add('on');
      btn.querySelector('.ic').textContent='❤️';
      btn.querySelector('.lc').textContent=newCount;
    }
  }catch(e){ console.error(e); }
}

/* ================== 정원 ================== */
// 식물 SVG: 0(씨앗)~20(꽃) 21단계, wilting(0~3)에 따라 색이 칙칙해짐
function plantSVG(stage, wilting){
  stage = Math.max(0, Math.min(PLANT_STAGE_COUNT-1, stage));
  // 시들기 정도에 따라 색 보정
  const wiltColors = [
    {leaf:'#8ba888', leaf2:'#9bb896', trunk:'#6d5235'},
    {leaf:'#a3ab8a', leaf2:'#b0b394', trunk:'#7a6347'},
    {leaf:'#bdb088', leaf2:'#c4ba98', trunk:'#8a7252'},
    {leaf:'#cdb98a', leaf2:'#d4c79e', trunk:'#9a805c'}
  ];
  const c = wiltColors[Math.min(3, wilting||0)];

  const pot=`<rect x="62" y="170" width="76" height="42" rx="6" fill="#c98a63"/><rect x="58" y="164" width="84" height="14" rx="5" fill="#d99a73"/>`;
  const soil=`<ellipse cx="100" cy="205" rx="74" ry="14" fill="#9a7b5a"/><ellipse cx="100" cy="201" rx="74" ry="12" fill="#b08e68"/>`;

  // map 21 stages to visual groups
  let plant='';
  if(stage===0){
    plant=`<circle cx="100" cy="196" r="6" fill="#7a5a3a"/>`;
  }else if(stage<=2){
    const h = 176 + (2-stage)*4;
    plant=`<path d="M100 198 V${h}" stroke="${c.trunk}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M100 ${h+8} q-14 -6 -18 -18 q14 2 18 16" fill="${c.leaf}"/>`;
  }else if(stage<=5){
    const h = 168 - (stage-3)*6;
    plant=`<path d="M100 198 V${h}" stroke="${c.trunk}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M100 ${h+10} q-18 -6 -24 -22 q18 2 24 20z" fill="${c.leaf}"/>
      <path d="M100 ${h} q18 -6 24 -22 q-18 2 -24 20z" fill="${c.leaf2}"/>`;
  }else if(stage<=9){
    const h = 150 - (stage-6)*8;
    plant=`<path d="M100 200 V${h}" stroke="${c.trunk}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M100 ${h+18} q-26 -8 -34 -30 q26 4 34 28z" fill="${c.leaf}"/>
      <path d="M100 ${h+6} q26 -8 34 -30 q-26 4 -34 28z" fill="${c.leaf2}"/>
      <circle cx="100" cy="${h-4}" r="${18+(stage-6)}" fill="${c.leaf2}"/>`;
  }else if(stage<=14){
    const r = 38 + (stage-10)*2;
    plant=`<path d="M100 202 V120" stroke="${c.trunk}" stroke-width="9" fill="none" stroke-linecap="round"/>
      <circle cx="100" cy="100" r="${r}" fill="${c.leaf}"/>
      <circle cx="${100-r*0.7}" cy="120" r="${r*0.65}" fill="${c.leaf2}"/>
      <circle cx="${100+r*0.7}" cy="120" r="${r*0.65}" fill="${c.leaf2}"/>`;
  }else if(stage<=19){
    const r = 44 + (stage-15);
    plant=`<path d="M100 204 V116" stroke="${c.trunk}" stroke-width="11" fill="none" stroke-linecap="round"/>
      <circle cx="100" cy="92" r="${r}" fill="${c.leaf}"/>
      <circle cx="${100-r*0.75}" cy="116" r="${r*0.65}" fill="${c.leaf}"/>
      <circle cx="${100+r*0.75}" cy="116" r="${r*0.65}" fill="${c.leaf2}"/>
      <circle cx="100" cy="118" r="${r*0.74}" fill="${c.leaf2}"/>`;
  }else{
    // stage 20: full bloom
    plant=`<path d="M100 206 V112" stroke="${c.trunk}" stroke-width="12" fill="none" stroke-linecap="round"/>
      <circle cx="100" cy="86" r="50" fill="${c.leaf}"/>
      <circle cx="60" cy="114" r="32" fill="${c.leaf}"/>
      <circle cx="140" cy="114" r="32" fill="${c.leaf2}"/>
      <circle cx="100" cy="116" r="38" fill="${c.leaf2}"/>
      ${[...Array(7)].map((_,k)=>{const a=k/7*6.28;return `<circle cx="${100+Math.cos(a)*42}" cy="${100+Math.sin(a)*36}" r="6" fill="${wilting>0?'#d9b98c':'#f6b083'}"/>`}).join('')}
      <circle cx="100" cy="100" r="9" fill="${wilting>0?'#e8d4a8':'#ffce7a'}"/>`;
  }
  return `<svg width="200" height="220" viewBox="0 0 200 220">${pot}${soil}${plant}</svg>`;
}

const STAGE_INFO = [
  ["씨앗","첫 페이지를 기다리는 중"],
  ["씨앗","흙 속에서 준비하는 중"],
  ["발아","조심스럽게 고개를 내밀었어요"],
  ["새싹","여린 잎이 돋았어요"],
  ["새싹","조금 더 단단해졌어요"],
  ["떡잎","뿌리가 자리를 잡아가요"],
  ["어린 줄기","줄기가 길어지고 있어요"],
  ["어린 줄기","잎이 늘어났어요"],
  ["어린 나무","제법 나무 모양이 보여요"],
  ["어린 나무","가지가 뻗어가요"],
  ["나무","바람에도 끄떡없어요"],
  ["나무","그늘이 조금 생겼어요"],
  ["나무","점점 풍성해져요"],
  ["큰 나무","넓은 그늘을 드리워요"],
  ["큰 나무","든든하게 자랐어요"],
  ["큰 나무","곧 꽃이 필 것 같아요"],
  ["꽃봉오리","봉오리가 맺혔어요"],
  ["꽃봉오리","봉오리가 부풀었어요"],
  ["개화 준비","곧 꽃이 펴요"],
  ["개화","꽃이 하나둘 피어나요"],
  ["만개","21일, 드디어 꽃이 활짝 피었어요 🌸"]
];

async function renderGarden(){
  // 가장 최근 record 기준으로 stage/시들기 계산
  const day = getCurrentDay();
  const completedCount = myRecords.filter(r=>r.status==='success').length;
  const failedToday = myRecords.find(r=>r.day===day && r.status==='failed');

  // stage: 진행한 일수를 기준 (0~20)
  let stage = Math.min(PLANT_STAGE_COUNT-1, completedCount);

  // wilting: 최근 record의 wilting_level 중 최대값(오늘 기준)
  let wilting = 0;
  const lastRecord = myRecords[myRecords.length-1];
  if(lastRecord) wilting = lastRecord.wilting_level || 0;

  $('#plantStage').innerHTML = plantSVG(stage, wilting);

  const info = STAGE_INFO[stage];
  $('#stageName').textContent = wilting>0 ? `${info[0]} (조금 시들었어요)` : info[0];
  $('#stageSub').textContent = wilting>0 ? '오늘 다시 인증하면 다시 생기를 찾아요 🌱' : info[1];
  $('#gardenBar').style.width = Math.min(100, completedCount/TOTAL_DAYS*100)+'%';
  $('#gardenCount').textContent = `${completedCount} / ${TOTAL_DAYS}일 완료`;

  // streak
  $('#stStreak').textContent = (currentUser.streak||0)+'일';
  $('#stTotal').textContent = completedCount+'회';

  // 내 피드 3x3
  if(!myPosts.length){
    $('#myGrid').innerHTML = `<div class="empty" style="grid-column:1/-1;padding:30px 10px">아직 인증한 페이지가 없어요.</div>`;
  }else{
    $('#myGrid').innerHTML = myPosts.map(p=>{
      const thumb = (p.images&&p.images[0]) ? `<img src="${p.images[0]}" loading="lazy">` : `<div class="ph">✍️</div>`;
      return `<div class="cell" data-postid="${p.id}">${thumb}
        ${p.is_private?'<div class="lockbadge">🔒</div>':''}
        <div class="daynum">${p.day}일차</div>
      </div>`;
    }).join('');
    $$('#myGrid .cell').forEach(c=>c.onclick=()=>showPostDetail(c.dataset.postid));
  }
}

function showPostDetail(postId){
  const p = myPosts.find(x=>x.id===postId);
  if(!p) return;
  const wokeTime = p.woke_at ? new Date(p.woke_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}) : '-';
  let imgsHtml = (p.images&&p.images.length) ? `<div class="post-imgs">${p.images.map(src=>`<img src="${src}">`).join('')}</div>` : `<div class="post-img placeholder">오늘의 세 페이지 ✍️</div>`;
  $('#detailSheet').innerHTML = `
    <h2>${p.day}일차 ${p.mood||''} ${p.is_private?'<span class="badge-private" style="margin-left:6px">🔒 비공개</span>':''}</h2>
    <p class="sub" style="margin-bottom:12px">기상 ${wokeTime} · ${new Date(p.created_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</p>
    ${imgsHtml}
    <div class="post-body" style="padding:14px 0 0"><div class="post-note">${escapeHtml(p.note||'')}</div></div>
    <button class="ghost" id="closeDetailBtn">닫기</button>
  `;
  $('#detailOverlay').classList.add('show');
  $('#closeDetailBtn').onclick = ()=>$('#detailOverlay').classList.remove('show');
}
$('#detailOverlay').addEventListener('click', e=>{ if(e.target.id==='detailOverlay') $('#detailOverlay').classList.remove('show'); });

/* ================== 현황(대시보드) ================== */
async function renderDash(){
  if(!currentSession){ $('#gardenGrid').innerHTML=''; $('#dashFrac').textContent='0/0'; return; }

  const day = getCurrentDay();
  const { data: users } = await sb.from('users').select('*').eq('current_session_id', currentSession.id).eq('is_admin', false);
  const list = users || [];

  // 오늘 성공한 사람 수
  const { data: records } = await sb.from('daily_records').select('user_id,status').eq('session_id', currentSession.id).eq('day', day);
  const successIds = new Set((records||[]).filter(r=>r.status==='success').map(r=>r.user_id));

  const done = successIds.size;
  const total = list.length;
  $('#dashFrac').textContent = `${done}/${total}`;
  const off = total>0 ? 251-(done/total)*251 : 251;
  $('#ringProg2').style.strokeDashoffset = off;

  $('#gardenGrid').innerHTML = list.map(u=>{
    const isDone = successIds.has(u.id);
    return `<div class="mini ${isDone?'done':''}">
      <div style="font-size:30px;line-height:1">${isDone?'🌳':'🌱'}</div>
      <div class="mn">${escapeHtml(u.nickname)}</div>
      <div class="dot">${isDone?'✅':'⏳'}</div>
    </div>`;
  }).join('');
}

$('#shareBtn').onclick = ()=>{
  if(navigator.share){
    navigator.share({title:'Good Morning Page Club', text:'우리 모두의 정원을 함께 봐요 🌱', url: location.href}).catch(()=>{});
  }else{
    navigator.clipboard?.writeText(location.href);
    toast('링크가 복사됐어요!');
  }
};

/* ================== 관리자 ================== */
$$('.admin-tabs button').forEach(b=>{
  b.onclick = ()=>{
    $$('.admin-tabs button').forEach(x=>x.classList.remove('active'));
    $$('.admin-panel').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('#'+b.dataset.panel).classList.add('active');
  };
});

async function renderAdmin(){
  await renderAdminSession();
  await renderAdminUsers();
  await renderAdminQuotes();
  await renderAdminPosts();
}

async function renderAdminSession(){
  if(!currentSession){
    $('#sessionTitle').textContent = '진행 중인 회차 없음';
    $('#sessionDates').textContent = '새 회차를 시작해주세요.';
    return;
  }
  $('#sessionTitle').textContent = currentSession.name;
  $('#sessionDates').textContent = `${currentSession.start_date} ~ ${currentSession.end_date}`;
  $('#sName').value = currentSession.name;
  $('#sStart').value = currentSession.start_date;
  $('#sEnd').value = currentSession.end_date;
  $('#sCode').value = currentSession.auth_code;
}

$('#saveSessionBtn').onclick = async ()=>{
  if(!currentSession){ toast('새 회차를 먼저 만들어주세요.'); return; }
  const name = $('#sName').value.trim();
  const start = $('#sStart').value;
  const end = $('#sEnd').value;
  const code = $('#sCode').value.trim();
  if(!name||!start||!end||!code){ toast('모든 항목을 입력해주세요.'); return; }
  try{
    const { data, error } = await sb.from('sessions').update({
      name, start_date:start, end_date:end, auth_code:code, updated_at:new Date().toISOString()
    }).eq('id', currentSession.id).select().single();
    if(error) throw error;
    currentSession = data;
    toast('회차 정보가 저장됐어요.');
    await renderAdminSession();
  }catch(e){ console.error(e); toast('저장 중 오류가 발생했어요.'); }
};

$('#newSessionBtn').onclick = async ()=>{
  if(!confirm('새 회차를 시작하면 모든 회원의 정원/진행상황이 초기화되고, 공개 피드도 모두 삭제돼요. 계속할까요?')) return;
  const name = prompt('새 회차 이름 (예: 2차)', '2차');
  if(!name) return;
  const start = prompt('시작일 (YYYY-MM-DD)', todayKST());
  const end = prompt('종료일 (YYYY-MM-DD)');
  const code = prompt('새 참여 인증코드');
  if(!start||!end||!code) return;

  try{
    // 기존 회차 비활성화
    if(currentSession){
      await sb.from('sessions').update({is_active:false}).eq('id', currentSession.id);
    }
    // 새 회차 생성
    const { data: newSession, error } = await sb.from('sessions').insert({
      name, start_date:start, end_date:end, auth_code:code, is_active:true
    }).select().single();
    if(error) throw error;

    // 공개 피드 전체 삭제 (현재까지의 모든 posts 중 비공개가 아닌 것)
    await sb.from('posts').delete().eq('is_private', false);

    // 모든 일반 회원 초기화 (current_session_id를 새 회차로 옮기지 않음 -> 재참여 필요)
    await sb.from('users').update({
      current_day:0, streak:0, current_session_id:null, status:'inactive'
    }).eq('is_admin', false);

    currentSession = newSession;
    toast('새 회차가 시작됐어요! 회원들은 새 인증코드로 다시 참여해야 해요.');
    await renderAdmin();
  }catch(e){ console.error(e); toast('새 회차 생성 중 오류가 발생했어요.'); }
};

async function renderAdminUsers(){
  if(!currentSession){ $('#userList').innerHTML=`<div class="empty">진행 중인 회차가 없어요.</div>`; return; }
  const { data: users } = await sb.from('users').select('*').eq('is_admin', false).order('created_at',{ascending:false});
  const list = users || [];
  if(!list.length){ $('#userList').innerHTML=`<div class="empty">등록된 회원이 없어요.</div>`; return; }

  $('#userList').innerHTML = list.map(u=>{
    const inSession = u.current_session_id === currentSession.id;
    const pct = Math.min(100, (u.current_day||0)/TOTAL_DAYS*100);
    return `<div class="list-item">
      <div class="row1">
        <div>
          <div class="title">${escapeHtml(u.nickname)} <span style="color:var(--ink-soft);font-weight:400">(${escapeHtml(u.username)})</span></div>
          <div class="desc">${escapeHtml(u.email)} · ${inSession?'현재 회차 참여중':'미참여'} · 연속 ${u.streak||0}일</div>
        </div>
        <div class="li-actions">
          <button class="danger" data-del-user="${u.id}">삭제</button>
        </div>
      </div>
      <div class="progress-mini"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  $$('#userList [data-del-user]').forEach(b=>b.onclick=async()=>{
    if(!confirm('이 회원을 삭제할까요? 모든 기록이 함께 삭제돼요.')) return;
    try{
      await sb.from('users').delete().eq('id', b.dataset.delUser);
      toast('회원을 삭제했어요.');
      await renderAdminUsers();
    }catch(e){ console.error(e); toast('삭제 중 오류가 발생했어요.'); }
  });
}

async function renderAdminQuotes(){
  const { data } = await sb.from('quotes').select('*').order('order_num',{ascending:true, nullsFirst:false}).order('created_at',{ascending:true});
  allQuotes = data || [];

  // order_num이 없는 항목 보정 (기존 데이터 호환)
  let needsFix = false;
  allQuotes.forEach((q,i)=>{ if(q.order_num==null){ q.order_num = i+1; needsFix = true; } });
  if(needsFix){
    for(const q of allQuotes){
      await sb.from('quotes').update({order_num:q.order_num}).eq('id', q.id);
    }
  }

  $('#quoteList').innerHTML = allQuotes.map((q,i)=>`
    <div class="list-item">
      <div class="row1">
        <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
          <button data-up="${q.id}" ${i===0?'disabled':''} style="border:none;background:var(--paper-2);border-radius:8px;width:26px;height:22px;cursor:pointer;font-size:11px;${i===0?'opacity:.3':''}">▲</button>
          <button data-down="${q.id}" ${i===allQuotes.length-1?'disabled':''} style="border:none;background:var(--paper-2);border-radius:8px;width:26px;height:22px;cursor:pointer;font-size:11px;${i===allQuotes.length-1?'opacity:.3':''}">▼</button>
        </div>
        <div style="flex:1">
          <div class="title">${i+1<=21?`<span style="color:var(--sage-deep);font-weight:700">${i+1}일차 ·</span> `:'<span style="color:var(--ink-soft)">예비 ·</span> '}${escapeHtml(q.quote_text)}</div>
          <div class="desc">${q.author?escapeHtml(q.author):'작자 미상'}</div>
        </div>
        <div class="li-actions">
          <button data-toggle-q="${q.id}">${q.is_active?'사용중':'비활성'}</button>
          <button class="danger" data-del-q="${q.id}">삭제</button>
        </div>
      </div>
    </div>
  `).join('');

  $$('#quoteList [data-toggle-q]').forEach(b=>b.onclick=async()=>{
    const q = allQuotes.find(x=>x.id===b.dataset.toggleQ);
    await sb.from('quotes').update({is_active: !q.is_active}).eq('id', q.id);
    await renderAdminQuotes();
  });
  $$('#quoteList [data-del-q]').forEach(b=>b.onclick=async()=>{
    if(!confirm('이 명언을 삭제할까요?')) return;
    await sb.from('quotes').delete().eq('id', b.dataset.delQ);
    await renderAdminQuotes();
  });
  $$('#quoteList [data-up]').forEach(b=>b.onclick=()=>moveQuote(b.dataset.up, -1));
  $$('#quoteList [data-down]').forEach(b=>b.onclick=()=>moveQuote(b.dataset.down, 1));
}

async function moveQuote(id, dir){
  const idx = allQuotes.findIndex(q=>q.id===id);
  const swapIdx = idx+dir;
  if(swapIdx<0 || swapIdx>=allQuotes.length) return;

  const a = allQuotes[idx], b = allQuotes[swapIdx];
  const aOrder = a.order_num, bOrder = b.order_num;

  try{
    await sb.from('quotes').update({order_num:bOrder}).eq('id', a.id);
    await sb.from('quotes').update({order_num:aOrder}).eq('id', b.id);
    await renderAdminQuotes();
  }catch(e){ console.error(e); toast('순서 변경 중 오류가 발생했어요.'); }
}

$('#addQuoteBtn').onclick = async ()=>{
  const text = $('#newQuoteText').value.trim();
  const author = $('#newQuoteAuthor').value.trim();
  if(!text){ toast('명언 내용을 입력해주세요.'); return; }
  try{
    const maxOrder = allQuotes.reduce((m,q)=>Math.max(m, q.order_num||0), 0);
    await sb.from('quotes').insert({quote_text:text, author, is_active:true, order_num: maxOrder+1});
    $('#newQuoteText').value=''; $('#newQuoteAuthor').value='';
    toast('명언이 추가됐어요.');
    await renderAdminQuotes();
  }catch(e){ console.error(e); toast('추가 중 오류가 발생했어요.'); }
};

async function renderAdminPosts(){
  if(!currentSession){ $('#adminPostList').innerHTML=`<div class="empty">진행 중인 회차가 없어요.</div>`; return; }
  const { data: posts } = await sb.from('posts')
    .select('*, users!posts_user_id_fkey(nickname)')
    .eq('session_id', currentSession.id)
    .order('created_at',{ascending:false})
    .limit(100);

  const list = posts || [];
  if(!list.length){ $('#adminPostList').innerHTML=`<div class="empty">아직 게시물이 없어요.</div>`; return; }

  $('#adminPostList').innerHTML = list.map(p=>{
    const name = p.users?.nickname || '익명';
    return `<div class="list-item">
      <div class="row1">
        <div style="flex:1">
          <div class="title">${escapeHtml(name)} · ${p.day}일차 ${p.mood||''} ${p.is_private?'🔒':''}</div>
          <div class="desc">${escapeHtml((p.note||'').slice(0,40))}</div>
        </div>
        <div class="li-actions">
          <button class="danger" data-del-post="${p.id}">삭제</button>
        </div>
      </div>
    </div>`;
  }).join('');

  $$('#adminPostList [data-del-post]').forEach(b=>b.onclick=async()=>{
    if(!confirm('이 게시물을 삭제할까요?')) return;
    await sb.from('posts').delete().eq('id', b.dataset.delPost);
    await renderAdminPosts();
  });
}

/* ================== 인증 실패 처리 (자정 체크 / 골든타임 만료) ================== */
// 페이지 로드시 + 1분마다 체크: 자정 지났는데 기상 안 했으면 failed, 골든타임 지났는데 미인증이면 failed (시들기 증가)
async function checkFailures(){
  if(!currentUser || currentUser.is_admin || !currentSession) return;
  const day = getCurrentDay();
  const now = nowKST();

  // 오늘 record가 없고, 자정(00:00)을 지났다면 -> 어제자 기록을 failed 처리
  // 어제 day에 대한 record 확인
  const prevDay = day - 1;
  if(prevDay >= 1){
    const prevRecord = myRecords.find(r=>r.day===prevDay);
    if(!prevRecord){
      // 어제 기상 자체를 안 함 -> failed record 생성 (시들기 처리용)
      try{
        const { data, error } = await sb.from('daily_records').insert({
          user_id: currentUser.id, session_id: currentSession.id, day: prevDay,
          status:'failed', wilting_level: 1
        }).select().single();
        if(!error){ myRecords.push(data); }
      }catch(e){ /* unique violation 등 무시 */ }
    }else if(prevRecord.status==='pending'){
      // 기상은 했지만 인증 못함 -> failed, 시들기 증가
      try{
        const newWilt = Math.min(3,(prevRecord.wilting_level||0)+1);
        const { error } = await sb.from('daily_records').update({status:'failed', wilting_level:newWilt}).eq('id', prevRecord.id);
        if(!error){ prevRecord.status='failed'; prevRecord.wilting_level=newWilt; }
      }catch(e){ console.error(e); }
    }
  }

  // 오늘 record가 pending인데 골든타임이 지났다면 -> 시들기 표시 (status는 자정에 failed로 전환되므로 여기선 비주얼만)
}

/* ================== 앱 초기화 ================== */
async function init(){
  const savedId = store.get('mpc_user_id');
  if(savedId){
    try{
      const { data, error } = await sb.from('users').select('*').eq('id', savedId).maybeSingle();
      if(!error && data){
        if(!data.is_admin){
          const session = await getActiveSession();
          const today = todayKST();
          const validSession = session && data.current_session_id===session.id && today<=session.end_date;
          if(!validSession){
            store.remove('mpc_user_id');
            currentUser = null;
          }else{
            currentUser = data;
          }
        }else{
          currentUser = data;
        }
      }
    }catch(e){ console.error(e); }
  }

  $('#loadingOverlay').classList.add('hide');
  $('#app').style.display='block';

  if(currentUser){
    await afterLogin();
    await checkFailures();
    await loadMyData();
    await setupWakeUI();
    await renderGarden();
  }else{
    showScreen('authScreen');
  }
}

// PWA: service worker 등록
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}

init();
