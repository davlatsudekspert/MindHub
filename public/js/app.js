'use strict';

/* ═══ TELEGRAM LOGIN ═══ */
let _tgPendingUser = null;
function loadTgWidget(containerId) {
  const el = document.getElementById(containerId);
  if (!el || el.querySelector('script')) return;
  const s = document.createElement('script');
  s.src = 'https://telegram.org/js/telegram-widget.js?22';
  s.setAttribute('data-telegram-login', 'mind_hubbot');
  s.setAttribute('data-size', 'large');
  s.setAttribute('data-onauth', 'onTelegramAuth(user)');
  s.setAttribute('data-request-access', 'write');
  s.async = true;
  el.appendChild(s);
}
async function onTelegramAuth(user) {
  const err = document.getElementById('am-err');
  try {
    const d = await api('POST', '/auth/telegram-login', user);
    if (d.needProfile) {
      _tgPendingUser = d;
      document.getElementById('am-login-form').style.display = 'none';
      document.getElementById('am-reg-form').style.display = 'none';
      document.getElementById('am-forgot-form').style.display = 'none';
      document.getElementById('am-tg-profile-form').style.display = 'block';
      document.getElementById('am-tg-name').value = user.first_name + (user.last_name ? ' ' + user.last_name : '');
      document.getElementById('am-tg-user').value = user.username || '';
      document.getElementById('am-tg-name').focus();
      return;
    }
    tokSave(d.token); Tok.set(d.token); closeAuthModal(); await boot(d.user);
  } catch (e) {
    if (err) { err.textContent = e.message; err.classList.add('on'); }
  }
}
async function finishTgReg() {
  const name = (document.getElementById('am-tg-name').value || '').trim();
  const username = (document.getElementById('am-tg-user').value || '').trim();
  const err = document.getElementById('am-tg-err');
  err.classList.remove('on');
  if (!name || !username) { err.textContent = "Ism va username kerak"; err.classList.add('on'); return; }
  const btn = document.getElementById('am-tg-btn'); btn.disabled = true; btn.textContent = '...';
  try {
    const d = await api('POST', '/auth/telegram-finish', { token: _tgPendingUser.tempToken, name, username });
    tokSave(d.token); Tok.set(d.token); closeAuthModal(); await boot(d.user);
  } catch (e) { err.textContent = e.message; err.classList.add('on'); }
  finally { btn.disabled = false; btn.textContent = 'Davom etish'; }
}

/* ═══ AUTH MODAL ═══ */
let _authTab='login';
function showAuthModal(){ document.getElementById('auth-modal').classList.add('open'); }
function closeAuthModal(){ document.getElementById('auth-modal').classList.remove('open'); }
function switchAmTab(t){
  _authTab=t;
  document.querySelectorAll('#auth-modal .auth-tab').forEach(b=>b.classList.toggle('active',b.dataset.t===t));
  document.getElementById('am-login-form').style.display=t==='login'?'block':'none';
  document.getElementById('am-reg-form').style.display=t==='register'?'block':'none';
  document.getElementById('am-forgot-form').style.display=t==='forgot'?'block':'none';
  document.getElementById('am-tg-profile-form').style.display='none';
  document.getElementById('am-verify-form').style.display='none';
  stopVerifyTimer();
  document.getElementById('am-err').classList.remove('on');
  if(t==='login') loadTgWidget('tg-login-container');
  if(t==='forgot') loadTgWidget('tg-forgot-container');
}
function requireAuth(cb){ if(window._me){cb&&cb();return true;}showAuthModal();return false;}

async function doAmLogin(){
  const u=(document.getElementById('am-uname').value||'').trim();
  const p=(document.getElementById('am-pass').value||'').trim();
  const err=document.getElementById('am-err'); err.classList.remove('on');
  if(!u||!p){err.textContent='Login va parolni kiriting';err.classList.add('on');return;}
  const btn=document.getElementById('am-login-btn'); btn.disabled=true;btn.textContent='...';
  try{
    const d=await API.login(u,p);
    tokSave(d.token);Tok.set(d.token);closeAuthModal();await boot(d.user);
  }catch(e){
    if (e.data && e.data.need_verification) {
      showVerifyStep(e.data.user_id, '');
    } else {
      err.textContent=e.message;err.classList.add('on');
    }
  }
  finally{btn.disabled=false;btn.textContent='Kirish';}
}

async function doAmReg(){
  const name=(document.getElementById('am-reg-name').value||'').trim();
  const user=(document.getElementById('am-reg-user').value||'').trim();
  const email=(document.getElementById('am-reg-email').value||'').trim();
  const pass=(document.getElementById('am-reg-pass').value||'').trim();
  const err=document.getElementById('am-err'); err.classList.remove('on');
  if(!name||!user||!email||!pass){err.textContent="Barcha maydonlarni to'ldiring";err.classList.add('on');return;}
  const btn=document.getElementById('am-reg-btn'); btn.disabled=true;btn.textContent='...';
  try{
    const d=await API.register(name,user,email,pass);
    if (d.pending) {
      showVerifyStep(d.user_id, d.email_masked);
    } else {
      // orqaga moslik (eski javob to'g'ridan-to'g'ri token qaytargan bo'lsa)
      tokSave(d.token);Tok.set(d.token);closeAuthModal();await boot(d.user);
    }
  }catch(e){err.textContent=e.message;err.classList.add('on');}
  finally{btn.disabled=false;btn.textContent="Ro'yxatdan o'tish";}
}

/* ═══ EMAIL TASDIQLASH ═══ */
let _verifyUserId = null;
let _verifyTimerInterval = null;

function showVerifyStep(userId, emailMasked){
  _verifyUserId = userId;
  document.getElementById('am-login-form').style.display='none';
  document.getElementById('am-reg-form').style.display='none';
  document.getElementById('am-forgot-form').style.display='none';
  document.getElementById('am-tg-profile-form').style.display='none';
  document.getElementById('am-verify-form').style.display='block';
  document.getElementById('am-verify-email-mask').textContent = emailMasked || '';
  document.getElementById('am-verify-err').classList.remove('on');
  const boxes = document.querySelectorAll('#am-verify-form .av-code-box');
  boxes.forEach(b => b.value='');
  if (boxes[0]) boxes[0].focus();
  startVerifyTimer(60);
  showAuthModal();
}

function startVerifyTimer(seconds){
  stopVerifyTimer();
  const link = document.getElementById('am-verify-resend-link');
  const timer = document.getElementById('am-verify-timer');
  let remaining = seconds;
  link.style.display = 'none';
  timer.style.display = 'inline';
  timer.textContent = `${remaining}s`;
  _verifyTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      stopVerifyTimer();
      link.style.display = 'inline';
      timer.style.display = 'none';
      return;
    }
    timer.textContent = `${remaining}s`;
  }, 1000);
}
function stopVerifyTimer(){
  if (_verifyTimerInterval) { clearInterval(_verifyTimerInterval); _verifyTimerInterval = null; }
}

function getVerifyCode(){
  return Array.from(document.querySelectorAll('#am-verify-form .av-code-box')).map(b => b.value).join('');
}

async function doVerifyEmail(){
  const code = getVerifyCode();
  const err = document.getElementById('am-verify-err'); err.classList.remove('on');
  if (!/^\d{6}$/.test(code)) { err.textContent='6 xonali kod kiriting'; err.classList.add('on'); return; }
  const btn = document.getElementById('am-verify-btn'); btn.disabled=true; btn.textContent='...';
  try{
    const d = await API.verifyEmail(_verifyUserId, code);
    tokSave(d.token); Tok.set(d.token); closeAuthModal(); stopVerifyTimer(); await boot(d.user);
  }catch(e){ err.textContent=e.message; err.classList.add('on'); }
  finally{ btn.disabled=false; btn.textContent='Tasdiqlash'; }
}

async function doResendVerifyCode(){
  const err = document.getElementById('am-verify-err'); err.classList.remove('on');
  try{
    await API.resendCode(_verifyUserId);
    startVerifyTimer(60);
  }catch(e){
    err.textContent = e.message; err.classList.add('on');
    if (e.data && e.data.retry_after) startVerifyTimer(e.data.retry_after);
  }
}

// Kod kataklari: avtomatik keyingisiga o'tish, backspace bilan orqaga, paste qo'llab-quvvatlash
document.addEventListener('input', (ev) => {
  if (!ev.target.classList || !ev.target.classList.contains('av-code-box')) return;
  ev.target.value = ev.target.value.replace(/\D/g,'').slice(0,1);
  if (ev.target.value && ev.target.nextElementSibling && ev.target.nextElementSibling.classList.contains('av-code-box')) {
    ev.target.nextElementSibling.focus();
  }
});
document.addEventListener('keydown', (ev) => {
  if (!ev.target.classList || !ev.target.classList.contains('av-code-box')) return;
  if (ev.key === 'Backspace' && !ev.target.value && ev.target.previousElementSibling && ev.target.previousElementSibling.classList.contains('av-code-box')) {
    ev.target.previousElementSibling.focus();
  }
  if (ev.key === 'Enter') doVerifyEmail();
});
document.addEventListener('paste', (ev) => {
  if (!ev.target.classList || !ev.target.classList.contains('av-code-box')) return;
  const text = (ev.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
  if (!text) return;
  ev.preventDefault();
  const boxes = Array.from(document.querySelectorAll('#am-verify-form .av-code-box'));
  text.split('').forEach((ch,i) => { if (boxes[i]) boxes[i].value = ch; });
  const last = boxes[Math.min(text.length,6)-1];
  if (last) last.focus();
});

async function doAmForgot(){
  const uname=(document.getElementById('am-forgot-uname').value||'').trim();
  const err=document.getElementById('am-err'); err.classList.remove('on');
  if(!uname){err.textContent="Username kiriting";err.classList.add('on');return;}
  const btn=document.getElementById('am-forgot-btn'); btn.disabled=true;btn.textContent='...';
  try{
    window._fgUsername=uname;
    const d=await API.sendCode(uname);
    document.getElementById('fg-step1').style.display='none';
    document.getElementById('fg-email-mask').textContent=d.email||'';
    document.getElementById('fg-step2').style.display='block';
    document.getElementById('fg-code').focus();
  }catch(e){err.textContent=e.message;err.classList.add('on');}
  finally{btn.disabled=false;btn.textContent='Kod yuborish';}
}
async function doVerifyCode(){
  const code=(document.getElementById('fg-code').value||'').trim();
  const err=document.getElementById('fg-code-err'); err.classList.remove('on');
  if(!code||code.length!==6){err.textContent='6 xonali kod kiriting';err.classList.add('on');return;}
  const btn=document.getElementById('fg-code-btn'); btn.disabled=true;btn.textContent='...';
  try{
    const d=await API.verifyCode(window._fgUsername,code);
    window._resetToken=d.reset_token;
    document.getElementById('fg-step2').style.display='none';
    document.getElementById('fg-step3').style.display='block';
    document.getElementById('fg-new-pass').focus();
  }catch(e){err.textContent=e.message;err.classList.add('on');}
  finally{btn.disabled=false;btn.textContent='Tekshirish';}
}
function fgResendCode(){
  document.getElementById('fg-step2').style.display='none';
  document.getElementById('fg-step1').style.display='block';
  document.getElementById('fg-code').value='';
  document.getElementById('fg-code-err').classList.remove('on');
}
async function doResetByEmail(){
  const p=document.getElementById('fg-new-pass').value;
  const c=document.getElementById('fg-confirm-pass').value;
  const err=document.getElementById('fg-pass-err'); err.classList.remove('on');
  if(p!==c){err.textContent='Parollar mos emas';err.classList.add('on');return;}
  if(p.length<6){err.textContent='Parol kamida 6 belgi';err.classList.add('on');return;}
  const btn=document.getElementById('fg-reset-btn'); btn.disabled=true;btn.textContent='...';
  try{
    await API.resetPass(window._resetToken,p);
    switchAmTab('login');
    document.getElementById('am-err').style.cssText='background:rgba(46,158,91,.08);border-color:rgba(46,158,91,.2);color:var(--grn);margin-bottom:12px;display:block;padding:9px 13px;font-size:13px;border-radius:var(--r)';
    document.getElementById('am-err').textContent='✅ Parol o\'zgartirildi! Yangi parol bilan kiring.';
    document.getElementById('am-err').classList.add('on');
    resetForgotForm();
  }catch(e){err.textContent=e.message;err.classList.add('on');}
  finally{btn.disabled=false;btn.textContent='Saqlash';}
}
function resetForgotForm(){
  document.getElementById('fg-step1').style.display='block';
  document.getElementById('fg-step2').style.display='none';
  document.getElementById('fg-step3').style.display='none';
  document.getElementById('am-forgot-uname').value='';
  document.getElementById('fg-code').value='';
  document.getElementById('fg-new-pass').value='';
  document.getElementById('fg-confirm-pass').value='';
  document.getElementById('fg-code-err').classList.remove('on');
  document.getElementById('fg-pass-err').classList.remove('on');
}

/* ═══ RESET PASSWORD (old flow - keep for backwards compat) ═══ */
async function checkResetToken(){
  const params=new URLSearchParams(location.search);
  const token=params.get('reset_token'); if(!token) return;
  history.replaceState({},'',(location.pathname));
  const modal=document.getElementById('reset-modal'); if(!modal) return;
  modal.classList.add('open');
  ['reset-checking','reset-form','reset-invalid','reset-done'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  document.getElementById('reset-checking').style.display='block';
  try{
    const d=await API.verifyReset(token);
    document.getElementById('reset-checking').style.display='none';
    if(d.valid){
      document.getElementById('reset-uname-label').textContent=d.username||'';
      document.getElementById('reset-form').style.display='block';
      document.getElementById('reset-new').focus();
      window._resetToken=token;
    }else{document.getElementById('reset-invalid').style.display='block';}
  }catch{document.getElementById('reset-invalid').style.display='block';}
}

async function doReset(){
  const p=document.getElementById('reset-new').value;
  const c=document.getElementById('reset-confirm').value;
  const err=document.getElementById('reset-err'); err.classList.remove('on');
  if(p!==c){err.textContent='Parollar mos emas';err.classList.add('on');return;}
  if(p.length<6){err.textContent='Parol kamida 6 belgi';err.classList.add('on');return;}
  const btn=document.getElementById('reset-btn'); btn.disabled=true;btn.textContent='...';
  try{
    await API.resetPass(window._resetToken,p);
    document.getElementById('reset-form').style.display='none';
    document.getElementById('reset-done').style.display='block';
  }catch(e){err.textContent=e.message;err.classList.add('on');}
  finally{btn.disabled=false;btn.textContent='Saqlash';}
}
function closeReset(){document.getElementById('reset-modal').classList.remove('open');}
function openForgotFromReset(){closeReset();showAuthModal();switchAmTab('forgot');}

/* ═══ SYNC TOPBAR ═══ */
function syncTopbar(u){
  const av=document.getElementById('tb-av');
  if(av){av.style.cssText=avStyle(u,28)+'border-radius:50%;';av.innerHTML=u.avatar?`<img src="${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover" alt="">`: `<span style="font-size:10px;font-weight:800;color:#fff">${initials(u.name||u.username)}</span>`;}
  const nm=document.getElementById('tb-av-name'); if(nm) nm.textContent=u.name||u.username;
  const kr=document.getElementById('tb-av-karma'); if(kr) kr.textContent=fmtNum(u.followers||0)+' obunachi';
  const sb=document.getElementById('sb-av');
  if(sb){sb.style.cssText=avStyle(u,30)+'border-radius:50%;';sb.innerHTML=u.avatar?`<img src="${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover" alt="">`: `<span style="font-size:10px;font-weight:800;color:#fff">${initials(u.name||u.username)}</span>`;}
  const sn=document.getElementById('sb-uname'); if(sn) sn.textContent='u/'+(u.username||'');
  const sk=document.getElementById('sb-karma'); if(sk) sk.textContent=fmtNum(u.followers||0)+' obunachi';
  // Create box avatar
  const cb=document.getElementById('cb-av');
  if(cb){cb.style.cssText=avStyle(u,36)+'border-radius:50%;';cb.innerHTML=u.avatar?`<img src="${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover" alt="">`: `<span style="font-size:13px;font-weight:800;color:#fff">${initials(u.name||u.username)}</span>`;}
  document.getElementById('admin-lsb')?.style.setProperty('display',u.is_admin?'flex':'none');
}

/* ═══ BOOT ═══ */
async function boot(initialUser){
  document.getElementById('auth')?.remove();
  const app=document.getElementById('app'); app.classList.add('vis');
  window._me=initialUser||await API.me();
  syncTopbar(window._me);
  // Ban banner
  if (window._me?.is_banned) showBanBanner(window._me.ban_reason);
  WS.connect(Tok.get());
  initFeedWS();initMsgWS();initNotifWS();if(typeof initCallWS==='function')initCallWS();
  await Promise.all([loadFeed(true),loadNotifCount(),loadConvos(),loadMyComs(),loadTopComs(),initComPicker()]);
  initScrollFeed();
  buildRsb();
  // Push notifications
  await initPushNotifications();
  // Check URL for post
  const urlParams=new URLSearchParams(location.search);
  const postId=urlParams.get('post');
  if(postId){ history.replaceState({},'',(location.pathname)); openPost(postId); }
  // Nav buttons
  document.querySelectorAll('.lsb-btn[data-sec]').forEach(btn=>{
    const clone=btn.cloneNode(true); btn.parentNode.replaceChild(clone,btn);
    clone.addEventListener('click',()=>{
      const s=clone.dataset.sec;
      goSec(s);
      if(s==='notifs'){loadNotifs();markNotifs();}
      if(s==='msgs') loadConvos();
      if(s==='user') openUser(window._me.id);
      if(s==='settings') loadSettings();
      if(s==='saved') loadSavedPosts();
      if(s==='admin') loadAdmin();
      if(s==='popular') loadTopComs();
    });
  });
}

function buildRsb(){
  const el=document.getElementById('rsb-inner'); if(!el) return;
  el.innerHTML=`
    <div class="rsb-card">
      <div class="rsb-body">
        <div class="rsb-title">🔥 MindHub</div>
        <div class="rsb-desc">O'zbekistonning eng zamonaviy Reddit-uslubdagi platformasi</div>
        <button class="btn btn-gold" style="width:100%" onclick="requireAuth(()=>openSubmit())">✍️ Post yozish</button>
      </div>
    </div>`;
}

/* ═══ THEME ═══ */
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme');
  const next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem('ih_theme',next);
  updateThemeBtn();
}
function updateThemeBtn(){
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const btn=document.getElementById('theme-btn');
  if(btn) btn.innerHTML=isDark?IC.sun:IC.moon;
}

/* ═══ SEARCH ═══ */
function onTopSearch(e){
  const q=(e.target.value||'').trim();
  if(q.length>1){doSearch(q);if(curSec()!=='search')goSec('search');}
}

/* ═══ LOGOUT ═══ */
function doLogout(){tokClear();Tok.clr();WS.disconnect();window._me=null;location.reload();}

/* ═══ MOBILE NAV ═══ */
function setBnActive(id){
  document.querySelectorAll('.bn-item[id]').forEach(b=>b.classList.toggle('active',b.id===id));
}
function toggleMobileSearch(){
  const bar=document.getElementById('mobile-search-bar');
  const inp=document.getElementById('mobile-search-inp');
  if(!bar) return;
  const open=bar.classList.toggle('open');
  if(open) setTimeout(()=>inp?.focus(),100);
  else if(inp) inp.value='';
}
function openMobileSearch(){
  const bar=document.getElementById('mobile-search-bar');
  const inp=document.getElementById('mobile-search-inp');
  if(!bar) return;
  bar.classList.add('open');
  setTimeout(()=>inp?.focus(),100);
}

/* ═══ CREATE COMMUNITY API PATCH ═══ */
API.createCom = (slug,name,desc,color,is_private) => api('POST','/communities',{slug,name,description:desc,color,is_private});

/* ═══ INIT ═══ */
document.addEventListener('DOMContentLoaded',async()=>{
  // Theme
  const savedTheme=localStorage.getItem('ih_theme')||'light';
  document.documentElement.setAttribute('data-theme',savedTheme);
  updateThemeBtn();
  // Reset token
  await checkResetToken();
  // Auto-login
  const tok=tokLoad();
  if(tok){
    Tok.set(tok);
    try{const user=await API.me();await boot(user);}
    catch{tokClear();const authEl=document.getElementById('auth');if(authEl)authEl.style.display='flex';}
  }else{
    const authEl=document.getElementById('auth');if(authEl)authEl.style.display='flex';
  }
});

window.showAuthModal=showAuthModal;window.closeAuthModal=closeAuthModal;window.switchAmTab=switchAmTab;
window.requireAuth=requireAuth;window.doAmLogin=doAmLogin;window.doAmReg=doAmReg;window.doAmForgot=doAmForgot;
window.doReset=doReset;window.closeReset=closeReset;window.openForgotFromReset=openForgotFromReset;
window.showVerifyStep=showVerifyStep;window.doVerifyEmail=doVerifyEmail;window.doResendVerifyCode=doResendVerifyCode;
window.syncTopbar=syncTopbar;window.boot=boot;window.toggleTheme=toggleTheme;window.doLogout=doLogout;
window.onTopSearch=onTopSearch;window.setBnActive=setBnActive;window.toggleMobileSearch=toggleMobileSearch;window.openMobileSearch=openMobileSearch;
