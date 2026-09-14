'use strict';

/* ═══ STATE ═══ */
let _subTab = 'text', _allComs = [];
let _chatWith = null, _rendered = new Set(), _replyTo = null;
let _nUnread = 0;
let _pendingBanId = null;

/* ═══ COMMUNITIES ═══ */
async function openCommunity(slug) {
  window._curCom = slug; _curCom = slug;
  goSec('community');
  const hd = document.getElementById('com-hd-area');
  const fd = document.getElementById('com-feed-cnt');
  if (hd) hd.innerHTML = spinner();
  if (fd) fd.innerHTML = spinner();
  try {
    const [com, posts] = await Promise.all([API.getCom(slug), API.comPosts(slug,'hot',0)]);
    const letter = (com.name||com.slug||'?')[0].toUpperCase();
    const color  = com.color || '#C8922A';
    const bannerStyle = com.banner ? `url(${esc(com.banner)}) center/cover` : `linear-gradient(135deg,${color}44,${color}22)`;
    if (hd) hd.innerHTML = `
      <div class="com-page-hd">
        <div class="com-banner" style="background:${bannerStyle}"></div>
        <div class="com-hd-row">
          ${com.avatar
            ? `<img src="${esc(com.avatar)}" style="width:50px;height:50px;border-radius:50%;border:3px solid var(--surface);margin-top:-25px;object-fit:cover;flex-shrink:0" alt="">`
            : `<div class="com-hd-icon" style="background:${color}22;border:2px solid ${color}44;color:${color}">${letter}</div>`}
          <div style="flex:1">
            <div class="com-hd-name">${esc(com.name)} ${com.is_private?'<span style="font-size:11px;background:rgba(232,112,58,.12);color:#E8703A;padding:2px 8px;border-radius:10px;margin-left:6px;font-weight:600">🔒 Maxfiy</span>':''}</div>
            <div class="com-hd-sub">${esc(com.slug)} &middot; ${fmtNum(com.members)} a'zo &middot; 👁 ${fmtNum(com.views||0)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-left:auto">
            ${com.is_owner ? `<button class="btn btn-ghost" style="padding:7px 13px;font-size:12px" onclick="editCom('${esc(com.slug)}')">⚙ Sozlash</button>
              <button class="btn btn-danger" style="padding:7px 13px;font-size:12px" onclick="openDeleteCom('${esc(com.slug)}','${esc(com.name)}')">🗑️ O'chirish</button>` : ''}
            ${com.is_owner ? `<button class="btn btn-ghost" style="padding:7px 13px;font-size:12px" onclick="openComAdmins('${esc(com.slug)}')">👥 Boshqarish</button>` : ''}
            ${com.is_member ? `<button class="btn btn-outline" id="jb-${esc(com.id)}" onclick="toggleJoin('${esc(com.slug)}','${esc(com.id)}',this)">${IC.check} A'zo</button>`
              : com.pending_request ? `<button class="btn btn-ghost" disabled style="padding:7px 13px;font-size:12px">⏳ Kutilmoqda</button>`
              : com.is_private ? `<button class="btn btn-gold" onclick="toggleJoin('${esc(com.slug)}','${esc(com.id)}',this)">📩 So'rov yuborish</button>`
              : `<button class="btn btn-gold" id="jb-${esc(com.id)}" onclick="toggleJoin('${esc(com.slug)}','${esc(com.id)}',this)">${IC.plus} Qo'shilish</button>`}
          </div>
        </div>
        ${com.description ? `<div style="padding:0 18px 14px;font-size:13px;color:var(--tx3)">${esc(com.description)}</div>` : ''}
        ${com.admins?.length ? `<div style="padding:0 18px 10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--tx4)">
          <span>👑 Adminlar:</span>
          ${com.admins.map(a=>`<span style="color:var(--gold);cursor:pointer" onclick="openUser('${esc(a.username)}')">@${esc(a.username)}</span>`).join(', ')}
        </div>` : ''}
      </div>`;
    if (fd) {
      fd.innerHTML = '';
      _comOff = 0;
      document.querySelectorAll('#com-sort-bar .sort-btn').forEach(b=>b.classList.toggle('active',b.dataset.sort==='hot'));
      posts.forEach((p,i) => {
        const d=document.createElement('div'); d.innerHTML=buildPost(p);
        const c=d.firstElementChild; c.style.animationDelay=(i*.04)+'s'; fd.appendChild(c);
      });
      if (!posts.length) fd.innerHTML = emptyEl('save',"Hali postlar yo'q","Bu jamoada birinchi post siz bo'ling!");
    }
    buildComRsb(com);
  } catch(e) { if(hd) hd.innerHTML = emptyEl('close','Topilmadi',e.message); }
}

async function toggleJoin(slug, comId, btn) {
  if (!requireAuth()) return;
  try {
    const d = await API.joinCom(slug);
    if (btn) { btn.className=`btn ${d.joined?'btn-outline':'btn-gold'}`; btn.innerHTML=d.joined?`${IC.check} A'zo`:`${IC.plus} Qo'shilish`; }
    toast(d.joined?"Jamoaga qo'shildingiz":'Jamoadan chiqdingiz');
    loadMyComs();
  } catch(e) { toast(e.message); }
}

async function loadMyComs() {
  if (!window._me) return;
  try {
    const coms = await API.communities();
    const el = document.getElementById('my-coms'); if(!el) return;
    el.innerHTML = '';
    const myComs = coms.filter(c=>c.is_member).slice(0,10);
    myComs.forEach(c => {
      const b = document.createElement('button');
      b.className='com-lsb'; b.onclick=()=>openCommunity(c.slug);
      b.innerHTML = c.avatar
        ? `<img src="${esc(c.avatar)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0" alt="">${esc(c.name||c.slug)}`
        : `<span class="com-lsb-dot" style="background:${esc(c.color||'#C8922A')}"></span>${esc(c.name||c.slug)}`;
      el.appendChild(b);
    });
  } catch {}
}

async function loadTopComs() {
  try {
    const coms = await API.popularComs();
    const el = document.getElementById('popular-cnt'); if(!el) return;
    el.innerHTML = '';
    if (!coms.length) { el.innerHTML = emptyEl('people',"Hali jamoalar yo'q"); return; }
    coms.slice(0,20).forEach((c,i) => {
      const color = c.color||'#C8922A';
      const letter = (c.name||c.slug||'?')[0].toUpperCase();
      const d = document.createElement('div');
      d.className='com-pop-card'; d.style.animationDelay=(i*.04)+'s';
      d.innerHTML = `
        <div class="com-pop-inner" onclick="openCommunity('${esc(c.slug)}')">
          <div class="com-pop-rank">${i+1}</div>
          ${c.avatar
            ? `<img src="${esc(c.avatar)}" style="width:42px;height:42px;border-radius:12px;object-fit:cover;border:2px solid ${color}40;flex-shrink:0" alt="">`
            : `<div class="com-pop-icon" style="background:${color}18;border:2px solid ${color}40;color:${color}">${letter}</div>`}
          <div class="com-pop-info">
            <div class="com-pop-name">${esc(c.name||c.slug)} ${c.is_private?'🔒':''}</div>
            <div class="com-pop-sub">${esc(c.slug)} &middot; ${fmtNum(c.members)} a'zo &middot; 👁 ${fmtNum(c.views||0)}</div>
            ${c.description?`<div class="com-pop-desc">${esc(c.description)}</div>`:''}
          </div>
          <button class="com-pop-join${c.is_member?' joined':''}"
            onclick="event.stopPropagation();toggleJoin('${esc(c.slug)}','${esc(c.id)}',this)">
            ${c.is_member?"A'zo":"Qo'shilish"}
          </button>
        </div>`;
      el.appendChild(d);
    });
  } catch(e) { console.error(e); }
}

function buildComRsb(com) {
  const el = document.getElementById('rsb-inner'); if(!el) return;
  el.querySelector('.rsb-com-card')?.remove();
  const div = document.createElement('div');
  div.className='rsb-card rsb-com-card';
  const color = com.color||'#C8922A';
  const bannerStyle = com.banner ? `url(${esc(com.banner)}) center/cover` : `linear-gradient(135deg,${color}44,${color}11)`;
  div.innerHTML = `
    <div class="rsb-banner" style="background:${bannerStyle}"></div>
    <div class="rsb-body">
      <div class="rsb-title">${esc(com.name)} ${com.is_private?'🔒':''}</div>
      <div class="rsb-desc">${esc(com.description||'')}</div>
      <div class="rsb-stat"><span>A'zolar</span><strong>${fmtNum(com.members)}</strong></div>
      <div class="rsb-stat"><span>Ko'rishlar</span><strong>${fmtNum(com.views||0)}</strong></div>
      <button class="btn btn-gold" style="width:100%;margin-top:10px" onclick="requireAuth(()=>openSubmit('${esc(com.slug)}'))">Post qo'shish</button>
    </div>`;
  el.prepend(div);
}

/* Community admin management */
async function openComAdmins(slug) {
  if (!requireAuth()) return;
  try {
    const com = await API.getCom(slug);
    if (!com) return;
    const ov = document.getElementById('com-admin-overlay');
    if (!ov) return;
    const adminsEl = document.getElementById('com-admins-list');
    const reqsEl = document.getElementById('com-requests-list');
    const privateBtn = document.getElementById('com-private-toggle');
    const adminInput = document.getElementById('com-admin-username')?.parentElement;
    
    if (privateBtn) {
      privateBtn.innerHTML = com.is_private ? "Ommaviyga o'zgartirish" : "Maxfiyga o'zgartirish";
      privateBtn.onclick = () => toggleComPrivate(slug, !com.is_private);
      privateBtn.style.display = com.is_owner ? '' : 'none';
    }

    if (adminInput) {
      adminInput.style.display = com.is_owner ? '' : 'none';
    }
    if (privateBtn) {
      privateBtn.style.display = com.is_owner ? '' : 'none';
    }
    
    if (adminsEl) {
      adminsEl.innerHTML = '';
      if (com.admins?.length) {
        com.admins.forEach(a => {
          adminsEl.innerHTML += `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              <div class="av" style="${avStyle(a,32)};border-radius:50%;flex-shrink:0">${avHtml(a,32,11)}</div>
              <div style="flex:1"><div style="font-size:13px;font-weight:600">${esc(a.name||a.username)}</div><div style="font-size:11px;color:var(--tx4)">u/${esc(a.username)}</div></div>
              ${com.is_owner ? `<button class="btn btn-danger" style="font-size:11px;padding:4px 10px" onclick="removeComAdmin('${slug}','${a.user_id}')">Olib tashlash</button>` : ''}
            </div>`;
        });
      } else {
        adminsEl.innerHTML = '<div style="color:var(--tx4);font-size:13px;padding:8px 0">Adminlar yo\'q</div>';
      }
    }
    
    if (reqsEl) {
      reqsEl.innerHTML = '';
      if (com.pending_requests?.length) {
        com.pending_requests.forEach(r => {
          reqsEl.innerHTML += `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              <div class="av" style="${avStyle(r,32)};border-radius:50%;flex-shrink:0">${avHtml(r,32,11)}</div>
              <div style="flex:1"><div style="font-size:13px;font-weight:600">${esc(r.name||r.username)}</div><div style="font-size:11px;color:var(--tx4)">u/${esc(r.username)} · ${r.ago || ''}</div></div>
              <button class="btn btn-gold" style="font-size:11px;padding:4px 10px" onclick="handleComRequest('${slug}','${r.id}','approve')">✅</button>
              <button class="btn btn-danger" style="font-size:11px;padding:4px 10px" onclick="handleComRequest('${slug}','${r.id}','reject')">❌</button>
            </div>`;
        });
      } else {
        reqsEl.innerHTML = '<div style="color:var(--tx4);font-size:13px;padding:8px 0">Kutilgan so\'rovlar yo\'q</div>';
      }
    }
    
    ov.classList.add('open');
  } catch(e) { toast(e.message); }
}

async function addComAdmin(slug) {
  const inp = document.getElementById('com-admin-username');
  const username = (inp?.value || '').trim();
  if (!username) { toast('Username kiriting'); return; }
  try {
    const user = await API.getUser(username);
    if (!user) { toast('Foydalanuvchi topilmadi'); return; }
    await fetch(`/api/communities/${slug}/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Tok.get() },
      body: JSON.stringify({ user_id: user.id })
    });
    inp.value = '';
    toast("Admin qo'shildi!");
    openComAdmins(slug);
  } catch(e) { toast(e.message || 'Xatolik'); }
}

async function removeComAdmin(slug, userId) {
  if (!confirm('Adminni olib tashlamoqchimisiz?')) return;
  try {
    await fetch(`/api/communities/${slug}/admin`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Tok.get() },
      body: JSON.stringify({ user_id: userId })
    });
    toast('Admin olib tashlandi');
    openComAdmins(slug);
  } catch(e) { toast(e.message); }
}

async function toggleComPrivate(slug, isPrivate) {
  try {
    await API.updateCom(slug, { is_private: isPrivate });
    toast(isPrivate ? 'Jamoa maxfiy qilindi' : 'Jamoa ommaviy qilindi');
    openComAdmins(slug);
    openCommunity(slug);
  } catch(e) { toast(e.message); }
}

async function handleComRequest(slug, reqId, action) {
  try {
    await fetch(`/api/communities/${slug}/request/${reqId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Tok.get() },
      body: JSON.stringify({ action })
    });
    toast(action === 'approve' ? 'So\'rov qabul qilindi' : 'So\'rov rad etildi');
    openComAdmins(slug);
  } catch(e) { toast(e.message); }
}

async function editCom(slug) {
  try {
    const com = await API.getCom(slug);
    const ov = document.getElementById('ec-overlay'); if(!ov) return;
    document.getElementById('ec-slug').value = com.slug;
    document.getElementById('ec-name').value = com.name||'';
    document.getElementById('ec-desc').value = com.description||'';
    document.getElementById('ec-rules').value = com.rules||'';
    // Set color
    document.querySelectorAll('#ec-overlay .color-opt').forEach(b=>b.classList.toggle('active',b.dataset.color===com.color));
    document.getElementById('ec-color').value = com.color||'#C8922A';
    // Preview banner/avatar
    if (com.banner) { const img=document.getElementById('ec-banner-preview'); if(img){img.src=com.banner;img.style.display='block';} }
    if (com.avatar) { const img=document.getElementById('ec-avatar-preview'); if(img){img.src=com.avatar;img.style.display='block';} }
    ov.classList.add('open');
  } catch(e) { toast(e.message); }
}

async function doEditCom() {
  const slug  = document.getElementById('ec-slug')?.value;
  const name  = (document.getElementById('ec-name')?.value||'').trim();
  const desc  = (document.getElementById('ec-desc')?.value||'').trim();
  const rules = (document.getElementById('ec-rules')?.value||'').trim();
  const color = document.getElementById('ec-color')?.value||'#C8922A';
  const bannerFile = document.getElementById('ec-banner-file')?.files?.[0];
  const avatarFile = document.getElementById('ec-avatar-file')?.files?.[0];
  const btn = document.getElementById('ec-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saqlanmoqda...'; }
  try {
    const fd = new FormData();
    fd.append('name',name); fd.append('description',desc);
    fd.append('rules',rules); fd.append('color',color);
    if (bannerFile) fd.append('banner',bannerFile);
    if (avatarFile) fd.append('avatar',avatarFile);
    await API.updateCom(slug,fd,true);
    document.getElementById('ec-overlay')?.classList.remove('open');
    toast('Jamoa yangilandi!');
    openCommunity(slug);
  } catch(e) { toast(e.message); }
  finally { if(btn){btn.disabled=false;btn.textContent='Saqlash';} }
}

/* ═══ SUBMIT POST ═══ */
function openSubmit(comSlug) {
  _subTab = 'text';
  pauseAllVideos();
  document.querySelectorAll('.sub-tab').forEach(b=>b.classList.toggle('active',b.dataset.t==='text'));
  document.querySelectorAll('.sub-form').forEach(f=>f.classList.toggle('active',f.dataset.t==='text'));
  const inp = document.getElementById('sub-com-inp');
  if (inp && comSlug) inp.value = comSlug;
  document.getElementById('sub-title').value='';
  document.getElementById('sub-body').value='';
  // Reset polls
  resetPollForm();
  resetVidPollForm();
  const vf = document.getElementById('sub-vid-file');
  if (vf) vf.value = '';
  const vp = document.getElementById('sub-vid-preview');
  if (vp) vp.innerHTML = '';
  const vs = document.getElementById('vid-poll-section');
  if (vs) vs.style.display = 'none';
  document.getElementById('sub-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('sub-title')?.focus(),150);
}

function closeSubmit() { document.getElementById('sub-overlay').classList.remove('open'); }

function switchSubTab(t) {
  _subTab = t;
  document.querySelectorAll('.sub-tab').forEach(b=>b.classList.toggle('active',b.dataset.t===t));
  document.querySelectorAll('.sub-form').forEach(f=>f.classList.toggle('active',f.dataset.t===t));
  // Video tab: show duration warning
  if (t === 'video') {
    const warn = document.getElementById('vid-warn');
    if (warn) warn.style.display = 'flex';
  }
}

function resetPollForm() {
  const pollOpts = document.getElementById('poll-options');
  if (pollOpts) {
    pollOpts.innerHTML = `
      <input class="inp poll-opt-inp" placeholder="Variant 1" style="margin-bottom:6px">
      <input class="inp poll-opt-inp" placeholder="Variant 2" style="margin-bottom:6px">
      <input class="inp poll-opt-inp" placeholder="Variant 3 (ixtiyoriy)" style="margin-bottom:6px">
      <input class="inp poll-opt-inp" placeholder="Variant 4 (ixtiyoriy)" style="margin-bottom:6px">
      <input class="inp poll-opt-inp" placeholder="Variant 5 (ixtiyoriy)" style="margin-bottom:6px">`;
  }
  const pollQ = document.getElementById('poll-question');
  if (pollQ) pollQ.value = '';
  const pollDays = document.getElementById('poll-days');
  if (pollDays) pollDays.value = '3';
}

function resetVidPollForm() {
  const en = document.getElementById('vid-poll-enable');
  if (en) en.checked = false;
  const fields = document.getElementById('vid-poll-fields');
  if (fields) fields.style.display = 'none';
  const q = document.getElementById('vid-poll-question');
  if (q) q.value = '';
  document.querySelectorAll('#vid-poll-options .poll-opt-inp').forEach(i=>i.value='');
  const d = document.getElementById('vid-poll-days');
  if (d) d.value = '3';
}

async function doSubmitPost() {
  const title   = (document.getElementById('sub-title')?.value||'').trim();
  const community = (document.getElementById('sub-com-inp')?.value||'').trim();
  if (!title)     { toast('Sarlavha kerak'); return; }
  if (!community) { toast('Jamoa tanlang'); return; }
  const btn = document.getElementById('sub-btn');
  if (btn) { btn.disabled=true; btn.innerHTML='<div class="spin" style="width:14px;height:14px;margin:0;border-width:2px"></div>'; }
  try {
    let post;
    if (_subTab === 'image') {
      const fi = document.getElementById('sub-img-file');
      const fd = new FormData();
      fd.append('title',title); fd.append('community',community); fd.append('type','image');
      fd.append('body',document.getElementById('sub-body')?.value||'');
      if (fi?.files?.[0]) fd.append('image',fi.files[0]);
      post = await API.createPost(fd,true);
    } else if (_subTab === 'video') {
      const fv = document.getElementById('sub-vid-file');
      if (!fv?.files?.[0]) { toast("Video fayl tanlang"); return; }
      if (fv.files[0].size > 500*1024*1024) { toast("Video 500MB dan oshmasin"); return; }
      const vidFile = fv.files[0];
      const vidUrl = URL.createObjectURL(vidFile);
      const dur = await new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => { URL.revokeObjectURL(vidUrl); resolve(v.duration); };
        v.onerror = () => { URL.revokeObjectURL(vidUrl); resolve(0); };
        v.src = vidUrl;
      });
      if (dur && dur > 10*60) {
        toast("Video ko'pi bilan 10 daqiqa bo'lishi kerak!");
        return;
      }
      const fd = new FormData();
      fd.append('title',title); fd.append('community',community); fd.append('type','video');
      fd.append('body',document.getElementById('sub-body')?.value||'');
      fd.append('video',fv.files[0]);
      // Append poll from vid-poll section if enabled
      const vidPollEnabled = document.getElementById('vid-poll-enable')?.checked;
      if (vidPollEnabled) {
        const question = (document.getElementById('vid-poll-question')?.value||'').trim();
        const days = parseInt(document.getElementById('vid-poll-days')?.value)||3;
        const optEls = document.querySelectorAll('#vid-poll-options .poll-opt-inp');
        const opts = Array.from(optEls).map(i=>i.value.trim()).filter(Boolean);
        if (!question) { toast("So'rovnoma savolini yozing"); return; }
        if (opts.length < 2) { toast("So'rovnoma uchun kamida 2 ta variant kerak"); return; }
        fd.append('poll_question', question);
        fd.append('poll_options', JSON.stringify(opts.slice(0,5)));
        fd.append('poll_days', days);
      }
      post = await API.createPost(fd,true);
    } else if (_subTab === 'audio') {
      const fa = document.getElementById('sub-aud-file');
      const fd = new FormData();
      fd.append('title',title); fd.append('community',community); fd.append('type','audio');
      if (fa?.files?.[0]) fd.append('audio',fa.files[0]);
      post = await API.createPost(fd,true);
    } else if (_subTab === 'link') {
      post = await API.createPost({title,community,type:'link',link:(document.getElementById('sub-link')?.value||'').trim()});
    } else if (_subTab === 'poll') {
      // Standalone poll
      const fd = new FormData();
      fd.append('title',title); fd.append('community',community); fd.append('type','text');
      fd.append('body',document.getElementById('sub-body')?.value||'');
      appendPollToForm(fd);
      post = await API.createPost(fd,true);
    } else {
      post = await API.createPost({title,community,type:'text',body:(document.getElementById('sub-body')?.value||'').trim()});
    }
    closeSubmit();
    toast('Post nashr qilindi! 🎉');
    openPost(post.id);
  } catch(e) { toast(e.message||'Xatolik yuz berdi'); }
  finally { if(btn){btn.disabled=false;btn.innerHTML=`${IC.send} Nashr qilish`;} }
}

function appendPollToForm(fd) {
  const question = (document.getElementById('poll-question')?.value||'').trim();
  const days     = parseInt(document.getElementById('poll-days')?.value)||3;
  const optInputs = document.querySelectorAll('.poll-opt-inp');
  const options   = Array.from(optInputs).map(i=>i.value.trim()).filter(Boolean);
  if (question && options.length >= 2) {
    fd.append('poll_question', question);
    fd.append('poll_options',  JSON.stringify(options.slice(0,5)));
    fd.append('poll_days',     days);
  }
}

async function initComPicker() {
  if (!_allComs.length) { try { _allComs = await API.communities(); } catch {} }
  const inp = document.getElementById('sub-com-inp');
  const dd  = document.getElementById('sub-com-dd');
  if (!inp||!dd) return;
  inp.oninput = () => {
    const q = inp.value.toLowerCase();
    const mine = _allComs.filter(c=>c.is_member);
    const matches = (q ? mine.filter(c=>c.slug.includes(q)||c.name.toLowerCase().includes(q)) : mine).slice(0,8);
    dd.innerHTML = '';
    if (!matches.length) { dd.classList.remove('open'); return; }
    if (q && matches.length < 8) {
      const d = document.createElement('div'); d.className='com-dd-item com-dd-hint';
      d.innerHTML = '<span style="opacity:.5;font-size:11px;color:var(--tx3)">Jamoani qidiring yoki quyidagi tanlang</span>';
      dd.appendChild(d);
    }
    matches.forEach(c => {
      const d = document.createElement('div'); d.className='com-dd-item';
      d.innerHTML = c.avatar
        ? `<img src="${esc(c.avatar)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover" alt=""><strong>${esc(c.name||c.slug)}</strong>`
        : `<span class="com-dd-dot" style="background:${esc(c.color||'#C8922A')}"></span><strong>${esc(c.name||c.slug)}</strong>`;
      d.onclick=()=>{ inp.value=c.slug; dd.classList.remove('open'); };
      dd.appendChild(d);
    });
    dd.classList.add('open');
  };
  inp.onfocus = inp.oninput;
  inp.oninput();
  document.addEventListener('click', e=>{ if(!inp.contains(e.target)&&!dd.contains(e.target)) dd.classList.remove('open'); });
}

/* ═══ SEARCH ═══ */
let _searchType = 'all';

function onTopSearch(e) {
  const q = (e.target.value||'').trim();
  if (q.length > 1) { doSearch(q); if (curSec()!=='search') goSec('search'); }
}

function setSearchType(type) {
  _searchType = type;
  document.querySelectorAll('.search-filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.type===type));
  const inp = document.getElementById('search-inp')||document.getElementById('mobile-search-inp');
  if (inp?.value?.trim().length > 1) doSearch(inp.value.trim());
}

async function doSearch(q) {
  const el = document.getElementById('search-res'); if(!el) return;
  el.innerHTML = spinner();
  try {
    const d = await API.search(q, _searchType);
    el.innerHTML = '';

    // Filter bar
    el.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
        <button class="search-filter-btn sort-btn${_searchType==='all'?' active':''}" data-type="all" onclick="setSearchType('all')">Barchasi</button>
        <button class="search-filter-btn sort-btn${_searchType==='posts'?' active':''}" data-type="posts" onclick="setSearchType('posts')">Postlar</button>
        <button class="search-filter-btn sort-btn${_searchType==='users'?' active':''}" data-type="users" onclick="setSearchType('users')">Foydalanuvchilar</button>
        <button class="search-filter-btn sort-btn${_searchType==='communities'?' active':''}" data-type="communities" onclick="setSearchType('communities')">Jamoalar</button>
      </div>`;

    let hasResults = false;
    if (d.communities?.length) {
      hasResults=true;
      const hd=document.createElement('div'); hd.className='sr-hd'; hd.textContent='Jamoalar';
      el.appendChild(hd);
      d.communities.forEach(c=>{
        const color=c.color||'#C8922A';
        const dv=document.createElement('div'); dv.className='sr-com';
        dv.onclick=()=>openCommunity(c.slug);
        dv.innerHTML = c.avatar
          ? `<img src="${esc(c.avatar)}" style="width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0" alt="">
             <div><div class="sr-com-name">${esc(c.name||c.slug)}</div><div class="sr-com-sub">${esc(c.slug)} &middot; ${fmtNum(c.members)} a'zo</div></div>`
          : `<div class="sr-com-icon" style="background:${color}18;color:${color}">${(c.name||c.slug||'?')[0].toUpperCase()}</div>
             <div><div class="sr-com-name">${esc(c.name||c.slug)}</div><div class="sr-com-sub">${esc(c.slug)} &middot; ${fmtNum(c.members)} a'zo</div></div>`;
        el.appendChild(dv);
      });
    }
    if (d.users?.length) {
      hasResults=true;
      const hd=document.createElement('div'); hd.className='sr-hd'; hd.textContent='Foydalanuvchilar';
      el.appendChild(hd);
      d.users.forEach(u=>{
        const dv=document.createElement('div'); dv.className='sr-user'; dv.onclick=()=>openUser(u.username);
        dv.innerHTML = `
          <div class="av" style="${avStyle(u,40)};border-radius:50%">${avHtml(u,40,15)}</div>
          <div style="flex:1"><div class="sr-user-name">${esc(u.name||u.username)}</div><div class="sr-user-sub">u/${esc(u.username)} &middot; <span style="color:var(--gold)">${fmtNum(u.followers||0)} obunachi</span></div></div>`;
        el.appendChild(dv);
      });
    }
    if (d.posts?.length) {
      hasResults=true;
      const hd=document.createElement('div'); hd.className='sr-hd'; hd.textContent='Postlar';
      el.appendChild(hd);
      d.posts.forEach((p,i)=>{
        const dv=document.createElement('div'); dv.innerHTML=buildPost(p);
        const c=dv.firstElementChild; c.style.animationDelay=(i*.04)+'s'; el.appendChild(c);
      });
    }
    if (!hasResults) el.innerHTML += emptyEl('save',`"${q}" bo'yicha hech narsa topilmadi`,'Boshqa so\'z bilan qidiring');
  } catch(e) { el.innerHTML=emptyEl('close','Xatolik',e.message); }
}

/* ═══ NOTIFICATIONS ═══ */
function updNotifDot() {
  const dot = document.getElementById('notif-dot');
  const badge = document.getElementById('notif-badge');
  const bnBadge = document.getElementById('bn-notif-badge');
  [dot].forEach(d=>d?.classList.toggle('on',_nUnread>0));
  [badge, bnBadge].forEach(b=>{ if(b){ b.textContent=_nUnread>0?_nUnread:''; b.classList.toggle('on',_nUnread>0); } });
}

async function loadNotifCount() {
  try { const d=await API.notifCount(); _nUnread=d.count; updNotifDot(); } catch {}
}

async function loadNotifs() {
  const el = document.getElementById('notifs-list'); if(!el) return;
  el.innerHTML = spinner();
  try {
    const notifs = await API.notifications();
    el.innerHTML = '';
      if (!notifs.length) { el.innerHTML=emptyEl('bell',"Hozircha bildirishnomalar yo'q"); return; }
    notifs.forEach(n => {
      const dv=document.createElement('div');
      dv.className='notif'+(n.is_read?'':' unread');
      dv.style.cursor='pointer';
      // Clicking notification navigates to relevant content
      dv.onclick = () => {
        markNotifs();
        if (n.type==='follow' && n.from_id) openUser(n.fn || n.from_id);
        else if (n.post_id) openPost(n.post_id);
      };
      const iconMap = { follow:'👤', comment:'💬', reply:'↩️', new_post:'📝', vote:'⬆️' };
      dv.innerHTML = `
        <div class="notif-ico" style="background:${esc(n.fc||'#C8922A')}22">
          ${n.fa ? `<img src="${esc(n.fa)}" style="width:34px;height:34px;border-radius:9px;object-fit:cover" alt="">` : `<span style="font-size:16px">${iconMap[n.type]||'🔔'}</span>`}
        </div>
        <div style="flex:1">
          <div class="notif-txt">${esc(n.msg)}</div>
          <div class="notif-ago">${n.ago||''}</div>
        </div>
        ${!n.is_read?'<div class="notif-udot"></div>':''}`;
      el.appendChild(dv);
    });
  } catch(e) { el.innerHTML=emptyEl('close','Xatolik',e.message); }
}

async function markNotifs() {
  try {
    await API.markNotifs();
    _nUnread=0; updNotifDot();
    document.querySelectorAll('.notif.unread').forEach(n=>{n.classList.remove('unread');n.querySelector('.notif-udot')?.remove();});
  } catch {}
}

function initNotifWS() {
  WS.on('notif', d => {
    _nUnread++; updNotifDot();
    const nd = d.data || d;
    toast('🔔 ' + (nd.msg||'Yangi bildirishnoma'));
    // Browser push notification
    showBrowserNotif('MindHub', nd.msg||'', nd.fa);
    if (curSec()==='notifs') loadNotifs();
  });
}

/* ═══ MESSAGES ═══ */

function convLastText(last) {
  if (!last) return '';
  if (last.type === 'image') return '📷 Rasm';
  if (last.type === 'voice') return '🎙️ Ovozli xabar';
  const body = typeof last.body === 'string' ? last.body : (last.body?.toString?.() || '');
  return body.slice(0, 42);
}
async function loadConvos() {
  document.querySelector('.msg-wrap')?.classList.remove('chat-open');
  try {
    const convos = await API.messages();
    loadContactsScroll(convos); // horizontal scroll
    const el = document.getElementById('conv-list'); if(!el) return;
    el.innerHTML = '';
    if (!convos.length) {
      el.innerHTML=`<div style="padding:24px 16px;text-align:center;color:var(--tx4)">
        <div style="font-size:32px;margin-bottom:8px;opacity:.5">💬</div>
        <div style="font-size:13px">Hozircha xabarlar yo'q. Yangi suhbatni foydalanuvchi profilidan boshlang.</div>
      </div>`; return;
    }
    convos.forEach((cv,i) => {
      const o = cv.other;
      const d = document.createElement('div');
      d.className='conv'+(_chatWith?.id===o.id?' active':'');
      d.dataset.uid=o.id; d.style.animationDelay=(i*.05)+'s';
      d.onclick=()=>openChat(o);
      d.innerHTML = `
        <div class="av" style="${avStyle(o,40)};border-radius:50%;flex-shrink:0">${avHtml(o,40,15)}</div>
        <div class="conv-info">
          <div class="conv-name">${esc(o.name||o.username)}</div>
          <div class="conv-prev">${cv.last ? esc(convLastText(cv.last)) : "Suhbatni boshlang..."}</div>
        </div>
        ${cv.unread>0?'<div class="conv-dot"></div>':''}`;
      el.appendChild(d);
    });
  } catch(e) { console.error('loadConvos:',e); }
}

async function openChat(user) {
  _chatWith=user; _rendered.clear();
  document.querySelector('.msg-wrap')?.classList.add('chat-open');
  const emptyPanel=document.getElementById('chat-empty');
  const panel=document.getElementById('chat-panel');
  if(emptyPanel) emptyPanel.style.display='none';
  if(panel) { panel.style.opacity='0'; panel.classList.add('vis'); requestAnimationFrame(()=>{panel.style.transition='opacity .22s';panel.style.opacity='1';}); }
  const hd=document.getElementById('chat-hd-inner');
  if(hd) hd.innerHTML=`
    <button class="msg-back-btn" onclick="closeChatMobile()" title="Orqaga">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="av" style="${avStyle(user,40)};border-radius:50%;flex-shrink:0;cursor:pointer" onclick="openUser('${esc(user.username)}')">${avHtml(user,40,15)}</div>
    <div style="flex:1;min-width:0;cursor:pointer" onclick="openUser('${esc(user.username)}')">
      <div style="font-size:14px;font-weight:700;font-family:'Syne',sans-serif;color:var(--tx1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(user.name||user.username)}</div>
      <div style="font-size:11px;color:var(--tx4);margin-top:2px;display:flex;align-items:center;gap:4px">
        <span style="width:6px;height:6px;border-radius:50%;background:${user.online?'var(--grn)':'var(--tx4)'}"></span>
        ${user.online?'Onlayn':'Oflayn'} &middot; u/${esc(user.username)}
      </div>
    </div>
    <div class="chat-hd-call-btns">
      <div class="chat-hd-btn" onclick="startVoiceCall()" title="Ovozli qo'ng'iroq">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
      </div>
      <div class="chat-hd-btn" onclick="startVideoCall()" title="Video qo'ng'iroq">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      </div>
    </div>`;
  document.querySelectorAll('.conv').forEach(r=>r.classList.toggle('active',r.dataset.uid===user.id));
  try {
    const msgs=await API.thread(user.id);
    const b=document.getElementById('chat-msgs'); b.innerHTML=''; _rendered.clear();
    if(!msgs.length) { b.innerHTML=`<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--tx4);font-size:13px;text-align:center"><div>Suhbatni boshlang! 👋</div></div>`; }
    else { msgs.forEach(m=>addBubble(m, m.from_id===window._me?.id)); }
    b.scrollTop=b.scrollHeight;
  } catch(e) { console.error('openChat:',e); }
  setTimeout(()=>{ document.getElementById('chat-inp')?.focus(); initSwipeToReply(); }, 200);
}

function closeChatMobile() {
  document.querySelector('.msg-wrap')?.classList.remove('chat-open');
  document.querySelectorAll('.conv').forEach(r=>r.classList.remove('active'));
}

function addBubble(msg, isMe) {
  if(_rendered.has(msg.id)) return;
  _rendered.add(msg.id);
  const b=document.getElementById('chat-msgs'); if(!b) return;
  b.querySelector('[style*="flex:1"]')?.remove();
  const d=document.createElement('div');
  d.className='bubble '+(isMe?'me':'them');
  d.id='bbl-'+msg.id; d.dataset.msgId=msg.id; d.dataset.body=msg.body||'';

  const fwd = msg.forwarded_from?`<div class="forward-badge">↗ ${esc(msg.forwarded_from)} dan yo'naltirildi</div>`:'';
  let replyHtml='';
  if(msg.reply_to_body) {
    replyHtml=`<div class="bubble-reply-preview"><div class="bubble-reply-name">${esc(msg.reply_to_name||'Javob')}</div><div class="bubble-reply-text">${esc(msg.reply_to_body)}</div></div>`;
  }
  const pinned=msg.pinned?`<div class="bubble-pin-icon">📌 Mahkamlangan</div>`:'';
  let bodyHtml;
  if(msg.type==='voice') {
    const bars=Array.from({length:20},(_,i)=>`<span style="height:${4+Math.round(Math.abs(Math.sin(i*.8))*14)}px;animation-delay:${(i*.06).toFixed(2)}s"></span>`).join('');
    bodyHtml=`<div class="voice-msg-bubble"><div class="voice-play-btn" onclick="playVoiceMsg(this,'${esc(msg.audio_url||'')}')">▶</div><div class="voice-bars">${bars}</div><span class="player-time">${msg.duration||'0:00'}</span></div>`;
  } else if(msg.type==='image') {
    bodyHtml=`<div class="chat-img-bubble"><img src="${esc(msg.image_url||'')}" alt="Rasm" onclick="window.open('${esc(msg.image_url||'')}','_blank')" style="max-width:220px;max-height:220px;border-radius:10px;cursor:zoom-in;display:block;object-fit:cover"></div>`;
  } else { bodyHtml=esc(msg.body); }
  const seenTick=isMe?(msg.seen?'<span class="b-status seen" title="Ko\'rildi">✓✓</span>':'<span class="b-status">✓</span>'):'';
  d.innerHTML=`${pinned}${fwd}${replyHtml}${bodyHtml}<div class="b-time">${msg.ago||'Hozir'}${seenTick}</div>`;

  d.addEventListener('contextmenu',e=>{e.preventDefault();showMsgCtxMenu(e,msg,isMe,d);});
  let _pt;
  d.addEventListener('touchstart',()=>{_pt=setTimeout(()=>{const r=d.getBoundingClientRect();showMsgCtxMenu({clientX:r.left+40,clientY:r.top},msg,isMe,d);},500);},{passive:true});
  d.addEventListener('touchend',()=>clearTimeout(_pt),{passive:true});
  d.addEventListener('touchmove',()=>clearTimeout(_pt),{passive:true});

  b.appendChild(d);
  b.scrollTo({top:b.scrollHeight,behavior:'smooth'});
}

function showMsgCtxMenu(e,msg,isMe,bubbleEl) {
  document.getElementById('msg-ctx-menu')?.remove();
  const menu=document.createElement('div'); menu.id='msg-ctx-menu'; menu.className='msg-ctx-menu';
  const items=[
    {icon:'↩️',label:'Javob berish',action:()=>setReplyTo(msg,isMe)},
    {icon:'📋',label:'Nusxa olish',action:()=>{navigator.clipboard?.writeText(msg.body||'');toast('Nusxa olindi');}},
    {icon:'↗',label:"Yo'naltirish",action:()=>forwardMsg(msg)},
    {icon:'📌',label:msg.pinned?'Mahkamdan chiqarish':'Mahkamlash',action:()=>togglePinMsg(msg,bubbleEl)},
  ];
  if(isMe){items.push({sep:true});items.push({icon:'🗑️',label:"O'chirish",action:()=>deleteMsg(msg.id,bubbleEl),danger:true});}
  items.forEach(item=>{
    if(item.sep){const sep=document.createElement('div');sep.className='msg-ctx-sep';menu.appendChild(sep);return;}
    const el=document.createElement('div'); el.className='msg-ctx-item'+(item.danger?' danger':'');
    el.innerHTML=`<span style="font-size:14px;width:18px;text-align:center">${item.icon}</span> ${item.label}`;
    el.onclick=()=>{menu.remove();item.action();};
    menu.appendChild(el);
  });
  const x=Math.min(e.clientX,window.innerWidth-200);
  const y=Math.min(e.clientY,window.innerHeight-items.length*40-16);
  menu.style.left=x+'px'; menu.style.top=y+'px';
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),50);
}

function setReplyTo(msg, isMe) {
  _replyTo=msg;
  const bar=document.getElementById('reply-preview-bar');
  if(bar){
    bar.style.display='flex';
    const nameEl=document.getElementById('reply-preview-name');
    const textEl=document.getElementById('reply-preview-text');
    if(nameEl) nameEl.textContent=isMe?'Siz':(_chatWith?.name||_chatWith?.username||'Foydalanuvchi');
    if(textEl) textEl.textContent=(msg.body||'').slice(0,60);
  }
  document.getElementById('chat-inp')?.focus();
}
function cancelReply() {
  _replyTo=null;
  const bar=document.getElementById('reply-preview-bar');
  if(bar) bar.style.display='none';
}
function forwardMsg(msg) { toast("Yo'naltirish: "+(msg.body||'').slice(0,30)+'...'); }
function togglePinMsg(msg,bubbleEl) {
  const pinBar=document.getElementById('msg-pinned-bar');
  const existingPin=bubbleEl.querySelector('.bubble-pin-icon');
  if(existingPin){existingPin.remove();msg.pinned=false;if(pinBar)pinBar.style.display='none';toast('Mahkamdan chiqarildi');}
  else{const pin=document.createElement('div');pin.className='bubble-pin-icon';pin.innerHTML='📌 Mahkamlangan';bubbleEl.prepend(pin);msg.pinned=true;if(pinBar){pinBar.style.display='flex';const txt=pinBar.querySelector('.msg-pinned-text');if(txt)txt.textContent=(bubbleEl.dataset.body||'').slice(0,50);pinBar.onclick=()=>bubbleEl.scrollIntoView({behavior:'smooth',block:'center'});}toast('Xabar mahkamlandi');}
}
function deleteMsg(msgId,bubbleEl){bubbleEl.style.transition='all .25s ease';bubbleEl.style.opacity='0';bubbleEl.style.transform='scale(.85)';setTimeout(()=>bubbleEl.remove(),250);toast("Xabar o'chirildi");}
function playVoiceMsg(btn, url) {
  if (!url) { toast('Audio fayl mavjud emas'); return; }
  // Reuse existing audio object
  if (btn._audio) {
    if (btn._audio.paused) {
      btn._audio.play().catch(()=>toast('Ijro etilmadi'));
      btn.innerHTML = '⏸';
    } else {
      btn._audio.pause();
      btn.innerHTML = '▶';
    }
    return;
  }
  // Stop any other playing voice
  document.querySelectorAll('.voice-play-btn[data-playing]').forEach(b=>{
    if(b._audio){b._audio.pause();b.innerHTML='▶';b.removeAttribute('data-playing');}
  });
  const audio = new Audio(url);
  btn._audio = audio;
  btn.setAttribute('data-playing','1');
  const bars = btn.closest('.voice-msg-bubble')?.querySelector('.voice-bars');
  const timeEl = btn.closest('.voice-msg-bubble')?.querySelector('.player-time');
  audio.addEventListener('timeupdate', ()=>{
    if (!audio.duration) return;
    const pct = audio.currentTime / audio.duration;
    if (timeEl) timeEl.textContent = fmtTime(audio.currentTime);
    if (bars) {
      const n = bars.children.length;
      Array.from(bars.children).forEach((s,i)=>{
        s.style.height = (i < Math.round(pct*n)) ? '14px' : (4+Math.round(Math.abs(Math.sin(i*.8))*14))+'px';
        s.style.opacity = (i < Math.round(pct*n)) ? '1' : '.4';
      });
    }
  });
  audio.onended = () => {
    btn.innerHTML = '▶';
    btn.removeAttribute('data-playing');
    if (timeEl && audio.duration) timeEl.textContent = fmtTime(audio.duration);
    if (bars) Array.from(bars.children).forEach((s,i)=>{
      s.style.height = (4+Math.round(Math.abs(Math.sin(i*.8))*14))+'px';
      s.style.opacity = '.4';
    });
  };
  audio.play().then(()=>{ btn.innerHTML='⏸'; }).catch(()=>toast('Audio ijro etilmadi'));
}

async function sendMsg() {
  if(!_chatWith){toast("Avval suhbatdosh tanlang");return;}
  const inp=document.getElementById('chat-inp'); if(!inp) return;
  const body=(inp.value||'').trim(); if(!body) return;
  inp.value='';
  const replyId=_replyTo?.id||null;
  cancelReply();
  const btn=document.querySelector('.chat-send');
  if(btn){btn.style.transform='scale(.88)';setTimeout(()=>btn.style.transform='',150);}
  try { await API.sendMsg(_chatWith.id, body); }
  catch(e){inp.value=body;toast(e.message||'Xabar yuborilmadi');}
}

function filterConvos(q) {
  document.querySelectorAll('#conv-list .conv').forEach(el=>{
    const name=(el.querySelector('.conv-name')?.textContent||'').toLowerCase();
    el.style.display=(!q||name.includes(q.toLowerCase()))?'':'none';
  });
}

function initMsgWS() {
  WS.on('new_msg',d=>{
    const inThisChat=curSec()==='msgs'&&_chatWith?.id===d.data.msg.from_id;
    if(!inThisChat){
      toast('💬 '+(d.data.from.name||d.data.from.username)+': '+d.data.msg.body.slice(0,36));
      showBrowserNotif('MindHub — Yangi xabar', d.data.from.name+': '+d.data.msg.body.slice(0,60), d.data.from.avatar);
    }
    if(inThisChat) addBubble({...d.data.msg,ago:'Hozir'},false);
    loadConvos();
  });
  WS.on('msg_sent',d=>{
    if(_chatWith?.id===d.data.msg.to_id) addBubble({...d.data.msg,ago:'Hozir'},true);
    loadConvos();
  });
}

/* ═══ SWIPE TO REPLY ═══ */
function initSwipeToReply() {
  const chatMsgs=document.getElementById('chat-msgs'); if(!chatMsgs||chatMsgs._swipeInit) return;
  chatMsgs._swipeInit=true;
  let touchStartX=0, touchEl=null, swiped=false;
  chatMsgs.addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX;touchEl=e.target.closest('.bubble');swiped=false;},{passive:true});
  chatMsgs.addEventListener('touchmove',e=>{
    if(!touchEl) return;
    const dx=e.touches[0].clientX-touchStartX;
    if(Math.abs(dx)>8&&!swiped){
      const isMe=touchEl.classList.contains('me');
      const validSwipe=(!isMe&&dx>20)||(isMe&&dx<-20);
      if(validSwipe){
        const amount=Math.min(Math.abs(dx)-8,52)*(isMe?-1:1);
        touchEl.style.transform=`translateX(${amount}px)`;touchEl.style.transition='none';
        if(Math.abs(dx)>52&&!swiped){swiped=true;navigator.vibrate?.(30);}
      }
    }
  },{passive:true});
  chatMsgs.addEventListener('touchend',e=>{
    if(!touchEl) return;
    touchEl.style.transition='transform .25s cubic-bezier(.34,1.56,.64,1)';touchEl.style.transform='';
    if(swiped){const isMe=touchEl.classList.contains('me');setReplyTo({id:touchEl.dataset.msgId,body:touchEl.dataset.body},isMe);}
    touchEl=null;swiped=false;
  },{passive:true});
}

/* ═══ VOICE RECORDING ═══ */
let _mediaRecorder=null, _audioChunks=[], _voiceTimer=null, _voiceSeconds=0;

function startVoiceRec() {
  if(!navigator.mediaDevices?.getUserMedia){toast('Mikrofon mavjud emas');return;}
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    _audioChunks=[];
    _mediaRecorder=new MediaRecorder(stream);
    _mediaRecorder.ondataavailable=e=>{if(e.data.size>0)_audioChunks.push(e.data);};
    _mediaRecorder.start(100);
    document.getElementById('chat-inp-row').style.display='none';
    document.getElementById('voice-rec-bar').style.display='flex';
    _voiceSeconds=0;
    _voiceTimer=setInterval(()=>{
      _voiceSeconds++;
      const m=Math.floor(_voiceSeconds/60),s=_voiceSeconds%60;
      const el=document.getElementById('voice-rec-timer');
      if(el) el.textContent=m+':'+(s<10?'0':'')+s;
      if(_voiceSeconds>=120) sendVoiceMsg();
    },1000);
  }).catch(()=>toast("Mikrofonga ruxsat berilmadi"));
}

function cancelVoice(){
  if(_mediaRecorder&&_mediaRecorder.state!=='inactive'){_mediaRecorder.stream?.getTracks().forEach(t=>t.stop());_mediaRecorder.stop();}
  clearInterval(_voiceTimer);_audioChunks=[];_voiceSeconds=0;
  document.getElementById('voice-rec-bar').style.display='none';
  document.getElementById('chat-inp-row').style.display='flex';
}

function sendVoiceMsg(){
  if(!_mediaRecorder) return;
  clearInterval(_voiceTimer);
  const dur = _voiceSeconds;
  _mediaRecorder.onstop = async () => {
    const blob = new Blob(_audioChunks, {type:'audio/webm'});
    _audioChunks = [];
    const localUrl = URL.createObjectURL(blob);
    const durStr = Math.floor(dur/60)+':'+(dur%60<10?'0':'')+dur%60;
    // Show immediately in own chat
    addBubble({id:'vm-'+Date.now(),type:'voice',audio_url:localUrl,duration:durStr,body:'[Ovozli xabar]',ago:'Hozir',seen:false}, true);
    // Upload so recipient can play
    if (_chatWith) {
      try {
        const fd = new FormData();
        fd.append('voice', blob, 'voice.webm');
        fd.append('to_id', _chatWith.id);
        fd.append('duration', durStr);
        await fetch('/api/messages/voice', {
          method:'POST',
          headers:{ Authorization:'Bearer '+Tok.get() },
          body: fd
        });
      } catch(e){ console.error('voice upload:',e); }
    }
  };
  if(_mediaRecorder.state!=='inactive'){_mediaRecorder.stream?.getTracks().forEach(t=>t.stop());_mediaRecorder.stop();}
  document.getElementById('voice-rec-bar').style.display='none';
  document.getElementById('chat-inp-row').style.display='flex';
  _voiceSeconds = 0;
}

/* ═══ REAL WebRTC CALLS ═══ */
let _pc = null, _localStream = null, _callType = null, _callWith = null;
let _callTimerInterval = null, _callSecs = 0, _pendingOffer = null;

const STUN = { iceServers:[
  { urls:'stun:stun.l.google.com:19302' },
  { urls:'stun:stun1.l.google.com:19302' },
  { urls:'turn:openrelay.metered.ca:80', username:'openrelayproject', credential:'openrelayproject' },
  { urls:'turns:openrelay.metered.ca:443', username:'openrelayproject', credential:'openrelayproject' }
] };

function startVideoCall(){ if(!_chatWith){toast('Avval suhbatdosh tanlang');return;} initiateCall('video',_chatWith); }
function startVoiceCall(){ if(!_chatWith){toast('Avval suhbatdosh tanlang');return;} initiateCall('audio',_chatWith); }

async function initiateCall(type, user) {
  _callType = type; _callWith = user;
  try {
    _localStream = await navigator.mediaDevices.getUserMedia(type==='video'?{video:true,audio:true}:{audio:true});
  } catch(e) { toast('Mikrofon/kameraga ruxsat berilmadi'); return; }
  _pc = new RTCPeerConnection(STUN);
  _localStream.getTracks().forEach(t=>_pc.addTrack(t,_localStream));
  _pc.onicecandidate = e=>{ if(e.candidate) _sendCallSignal('ice',user.id,{candidate:e.candidate}); };
  _pc.ontrack = e=>{ _attachRemoteStream(e.streams[0]); };
  _pc.onconnectionstatechange = ()=>{ if(_pc?.connectionState==='connected') _startCallTimer(); };
  showCallUI(type, user, 'calling');
  if(type==='video'){ const lv=document.getElementById('call-local-vid'); if(lv) lv.srcObject=_localStream; }
  try {
    const offer = await _pc.createOffer();
    await _pc.setLocalDescription(offer);
    await _sendCallSignal('offer', user.id, { offer, call_type: type });
  } catch(e) { console.error('offer error:',e); endCall(); toast("Qo'ng'iroq boshlanmadi"); }
}

async function acceptCall() {
  const data = _pendingOffer; if(!data) return;
  _pendingOffer = null;
  _callType = data.call_type || 'audio';
  _callWith = { id:data.from_id, name:data.from_name, username:data.from_username, avatar:data.from_avatar, color:data.from_color };
  stopRingtone();
  try {
    _localStream = await navigator.mediaDevices.getUserMedia(_callType==='video'?{video:true,audio:true}:{audio:true});
  } catch(e) { toast('Mikrofon/kameraga ruxsat berilmadi'); _sendCallSignal('reject',data.from_id,{}); removeCallUI(); return; }
  _pc = new RTCPeerConnection(STUN);
  _localStream.getTracks().forEach(t=>_pc.addTrack(t,_localStream));
  _pc.onicecandidate = e=>{ if(e.candidate) _sendCallSignal('ice',data.from_id,{candidate:e.candidate}); };
  _pc.ontrack = e=>{ _attachRemoteStream(e.streams[0]); };
  _pc.onconnectionstatechange = ()=>{ if(_pc?.connectionState==='connected') _startCallTimer(); };
  showCallUI(_callType, _callWith, 'connected');
  if(_callType==='video'){ const lv=document.getElementById('call-local-vid'); if(lv) lv.srcObject=_localStream; }
  try {
    await _pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await _pc.createAnswer();
    await _pc.setLocalDescription(answer);
    await _sendCallSignal('answer', data.from_id, { answer });
  } catch(e) { console.error('answer error:',e); endCall(); }
}

async function rejectCall(fromId) {
  stopRingtone(); _pendingOffer = null; removeCallUI();
  if(fromId) await _sendCallSignal('reject', fromId, {}).catch(()=>{});
}

function endCall() {
  clearInterval(_callTimerInterval); _callTimerInterval = null; _callSecs = 0;
  if(_localStream){ _localStream.getTracks().forEach(t=>t.stop()); _localStream=null; }
  if(_pc){ try{_pc.close();}catch{} _pc=null; }
  stopRingtone();
  if(_callWith) _sendCallSignal('end', _callWith.id, {}).catch(()=>{});
  _callWith = null; _callType = null; _pendingOffer = null;
  removeCallUI();
}

async function _sendCallSignal(type, toId, data) {
  const endpointMap = { offer:'/api/call/offer', answer:'/api/call/answer', ice:'/api/call/ice', end:'/api/call/end', reject:'/api/call/reject' };
  const ep = endpointMap[type]; if(!ep) return;
  await fetch(ep, { method:'POST', headers:{ Authorization:'Bearer '+Tok.get(), 'Content-Type':'application/json' }, body:JSON.stringify({ to_id:toId, ...data }) });
}

function _attachRemoteStream(stream) {
  const rv = document.getElementById('call-remote-vid');
  const ra = document.getElementById('call-remote-aud');
  if(rv && stream){ rv.srcObject=stream; rv.style.display='block'; document.getElementById('call-no-cam')?.style.setProperty('display','none'); }
  if(ra && stream){ ra.srcObject=stream; ra.play().catch(()=>{}); }
  const wave = document.getElementById('call-wave');
  if(wave) wave.style.opacity='1';
}

function _startCallTimer() {
  _callSecs = 0;
  clearInterval(_callTimerInterval);
  _callTimerInterval = setInterval(()=>{
    _callSecs++;
    const m=Math.floor(_callSecs/60), s=_callSecs%60;
    const el=document.getElementById('call-timer');
    if(el) el.textContent=m+':'+(s<10?'0':'')+s;
    const st=document.getElementById('call-status');
    if(st) st.textContent='Ulandi ✓';
  }, 1000);
}

function toggleCallMic(){ if(!_localStream)return; const t=_localStream.getAudioTracks()[0]; if(!t)return; t.enabled=!t.enabled; const btn=document.getElementById('call-mic-btn'); if(btn) btn.classList.toggle('off',!t.enabled); toast(t.enabled?'🎤 Mikrofon yoqildi':'🔇 Mikrofon o\'chirildi'); }
function toggleCallCam(){ if(!_localStream)return; const t=_localStream.getVideoTracks()[0]; if(!t)return; t.enabled=!t.enabled; const btn=document.getElementById('call-cam-btn'); if(btn) btn.classList.toggle('off',!t.enabled); toast(t.enabled?'📹 Kamera yoqildi':'🎥 Kamera o\'chirildi'); }
function toggleSpeaker(){ const a=document.getElementById('call-remote-aud'); if(!a)return; a.muted=!a.muted; const btn=document.getElementById('call-spk-btn'); if(btn) btn.classList.toggle('off',a.muted); toast(a.muted?'🔇 Karnay o\'chirildi':'🔊 Karnay yoqildi'); }

let _ringtoneCtx = null;
function playRingtone() {
  stopRingtone();
  try {
    _ringtoneCtx = new AudioContext();
    const play = (freq, t) => {
      const o=_ringtoneCtx.createOscillator(), g=_ringtoneCtx.createGain();
      o.connect(g); g.connect(_ringtoneCtx.destination);
      o.frequency.value=freq; g.gain.value=0.08;
      o.start(_ringtoneCtx.currentTime+t); o.stop(_ringtoneCtx.currentTime+t+0.2);
    };
    const loop=()=>{ play(880,0); play(660,0.25); setTimeout(loop,2000); };
    loop();
  } catch(e){}
}
function stopRingtone(){ try{ _ringtoneCtx?.close(); _ringtoneCtx=null; }catch{} }

function removeCallUI(){ const ui=document.getElementById('call-ui'); if(ui){ui.style.opacity='0';ui.style.transition='opacity .2s';setTimeout(()=>ui.remove(),200);} }

function showCallUI(type, user, state) {
  removeCallUI();
  const color=user.color||'#C8922A', av=initials(user.name||user.username);
  const statusTxt = state==='calling' ? 'Chaqirilmoqda...' : 'Ulandi ✓';
  const avatarHtml = user.avatar
    ? '<img src="'+esc(user.avatar)+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">'
    : '<div style="width:100%;height:100%;border-radius:50%;background:'+color+';display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#fff;font-family:Syne,sans-serif">'+av+'</div>';
  const div=document.createElement('div'); div.id='call-ui';
  div.className='call-overlay';

  if(type==='video') {
    div.innerHTML='<div class="call-card" style="width:min(560px,96vw);border-radius:22px">'+
      '<div style="position:relative;aspect-ratio:16/10;background:#05060d">'+
        '<div id="call-no-cam" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0b0d16,#151a2c)">'+
          '<div style="width:88px;height:88px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.14);box-shadow:0 8px 30px rgba(0,0,0,.5)">'+avatarHtml+'</div>'+
        '</div>'+
        '<video id="call-remote-vid" autoplay playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none"></video>'+
        '<video id="call-local-vid" autoplay playsinline muted style="position:absolute;bottom:14px;right:14px;width:118px;height:88px;object-fit:cover;border-radius:14px;border:2px solid rgba(255,255,255,.22);background:#000;z-index:2;box-shadow:0 6px 24px rgba(0,0,0,.5)"></video>'+
        '<div style="position:absolute;top:0;left:0;right:0;padding:14px 18px;display:flex;align-items:center;gap:10px;background:linear-gradient(rgba(0,0,0,.62),transparent)">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:16px;font-weight:700;color:#fff;font-family:Syne,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(user.name||user.username)+'</div>'+
            '<div style="font-size:12px;color:rgba(255,255,255,.55);margin-top:2px"><span id="call-status">'+statusTxt+'</span></div>'+
          '</div>'+
          '<div id="call-timer" style="font-size:13px;font-weight:700;color:#fff;background:rgba(0,0,0,.4);padding:5px 12px;border-radius:99px;font-family:Syne,sans-serif"></div>'+
        '</div>'+
        '<div style="position:absolute;bottom:0;left:0;right:0;padding:20px 18px;display:flex;align-items:center;justify-content:center;gap:18px;background:linear-gradient(transparent,rgba(0,0,0,.62))">'+
          '<button id="call-mic-btn" class="call-ctl call-ctl-sm" onclick="toggleCallMic()" title="Mikrofon">'+
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>'+
          '</button>'+
          '<button id="call-cam-btn" class="call-ctl call-ctl-sm" onclick="toggleCallCam()" title="Kamera">'+
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'+
          '</button>'+
          '<button class="call-ctl call-ctl-end call-ctl-primary" onclick="endCall()" title="Tugatish">'+
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="26"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6z"/></svg>'+
          '</button>'+
          '<button onclick="toggleFullscreen()" class="call-ctl call-ctl-sm" title="To&#39;liq ekran">'+
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'+
          '</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  } else {
    div.innerHTML='<div class="call-card" style="width:min(340px,92vw);padding:46px 24px 34px;display:flex;flex-direction:column;align-items:center;gap:22px">'+
      '<div style="position:absolute;top:-70px;right:-70px;width:190px;height:190px;border-radius:50%;background:radial-gradient(circle,'+color+'33,transparent 70%);filter:blur(6px)"></div>'+
      '<div class="call-avatar-wrap">'+
        '<div class="call-ring" style="border-color:'+color+'"></div>'+
        '<div class="call-ring" style="border-color:'+color+'"></div>'+
        '<div style="width:96px;height:96px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.1);box-shadow:0 10px 34px rgba(0,0,0,.55)">'+avatarHtml+'</div>'+
      '</div>'+
      '<div style="text-align:center">'+
        '<div style="font-size:22px;font-weight:800;color:#fff;font-family:Syne,sans-serif">'+esc(user.name||user.username)+'</div>'+
        '<div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:6px"><span id="call-status">'+statusTxt+'</span></div>'+
        '<div style="font-size:14px;font-weight:700;color:'+color+';margin-top:5px;font-family:Syne,sans-serif" id="call-timer"></div>'+
      '</div>'+
      '<div id="call-wave" style="display:flex;align-items:center;gap:4px;height:26px;opacity:0;transition:opacity .35s">'+
        Array.from({length:7},(_,i)=>'<div style="width:4px;height:8px;border-radius:3px;background:'+color+';animation:voiceAnim 1.2s ease infinite;animation-delay:'+(i*.13).toFixed(2)+'s"></div>').join('')+
      '</div>'+
      '<audio id="call-remote-aud" autoplay style="display:none"></audio>'+
      '<div style="display:flex;align-items:center;gap:18px;margin-top:8px">'+
        '<button id="call-mic-btn" class="call-ctl call-ctl-sm" onclick="toggleCallMic()" title="Mikrofon">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>'+
        '</button>'+
        '<button class="call-ctl call-ctl-end call-ctl-primary" onclick="endCall()" title="Tugatish">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="26"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6z"/></svg>'+
        '</button>'+
        '<button id="call-spk-btn" class="call-ctl call-ctl-sm" onclick="toggleSpeaker()" title="Karnay">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>'+
        '</button>'+
      '</div>'+
    '</div>';
  }
  document.body.appendChild(div);
}

function showIncomingCallUI(data) {
  removeCallUI();
  const color=data.from_color||'#C8922A', av=initials(data.from_name||data.from_username||'?');
  const label = data.call_type==='video' ? '📹 Video qo\'ng\'iroq' : '📞 Ovozli qo\'ng\'iroq';
  const avatarHtml = data.from_avatar
    ? '<img src="'+esc(data.from_avatar)+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">'
    : '<div style="width:100%;height:100%;border-radius:50%;background:'+color+';display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#fff;font-family:Syne,sans-serif">'+av+'</div>';
  const div=document.createElement('div'); div.id='call-ui';
  div.className='call-overlay';
  div.innerHTML='<div class="call-card" style="width:min(360px,92vw);padding:44px 26px 36px;display:flex;flex-direction:column;align-items:center;gap:22px">'+
    '<div style="position:absolute;top:-70px;right:-70px;width:190px;height:190px;border-radius:50%;background:radial-gradient(circle,'+color+'44,transparent 70%);filter:blur(6px)"></div>'+
    '<div style="position:absolute;bottom:-60px;left:-60px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(34,197,94,.18),transparent 70%);filter:blur(8px)"></div>'+
    '<div class="call-avatar-wrap">'+
      '<div class="call-ring" style="border-color:'+color+'"></div>'+
      '<div class="call-ring" style="border-color:'+color+'"></div>'+
      '<div style="width:100px;height:100px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.12);box-shadow:0 12px 40px rgba(0,0,0,.6)">'+avatarHtml+'</div>'+
    '</div>'+
    '<div style="text-align:center">'+
      '<div style="font-size:23px;font-weight:800;color:#fff;font-family:Syne,sans-serif">'+esc(data.from_name||data.from_username)+'</div>'+
      '<div style="font-size:14px;font-weight:600;color:'+color+';margin-top:7px">'+label+'</div>'+
      '<div style="font-size:12px;color:rgba(255,255,255,.4);margin-top:4px">Sizga qo\'ng\'iroq qilyapti...</div>'+
    '</div>'+
    '<div style="display:flex;align-items:flex-start;gap:34px;margin-top:14px">'+
      '<div style="display:flex;flex-direction:column;align-items:center;gap:9px">'+
        '<button class="call-ctl call-ctl-end call-ctl-primary" onclick="rejectCall(\''+esc(data.from_id)+'\')" title="Rad etish">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="26"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'+
        '</button>'+
        '<span style="font-size:12px;color:rgba(255,255,255,.45)">Rad etish</span>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;align-items:center;gap:9px">'+
        '<button class="call-ctl call-ctl-ok call-ctl-primary call-pulse" onclick="acceptCall()" title="Qabul qilish">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="26"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6z"/></svg>'+
        '</button>'+
        '<span style="font-size:12px;color:rgba(255,255,255,.45)">Qabul qilish</span>'+
      '</div>'+
    '</div>'+
  '</div>';
  document.body.appendChild(div);
  playRingtone();
  showBrowserNotif(label, (data.from_name||data.from_username)+' sizga qo\'ng\'iroq qilyapti', data.from_avatar);
}

function toggleFullscreen(){ const ui=document.getElementById('call-ui'); if(!ui)return; if(document.fullscreenElement) document.exitFullscreen(); else ui.requestFullscreen?.(); }

function initCallWS() {
  WS.on('call_offer', d=>{
    const data = d.data||d;
    _pendingOffer = data;
    showIncomingCallUI(data);
  });
  WS.on('call_answer', async d=>{
    const data=d.data||d; if(!_pc) return;
    try{ await _pc.setRemoteDescription(new RTCSessionDescription(data.answer)); } catch(e){ console.error('set answer:',e); }
  });
  WS.on('ice_candidate', async d=>{
    const data=d.data||d; if(!_pc||!data.candidate) return;
    try{ await _pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e){}
  });
  WS.on('call_ended',   ()=>{ toast('📞 Qo\'ng\'iroq tugadi'); endCall(); });
  WS.on('call_rejected',()=>{ toast('📞 Qo\'ng\'iroq rad etildi'); endCall(); });
}
/* ═══ PROFILE ═══ */
async function openUser(param) {
  goSec('user');
  const el=document.getElementById('user-cnt'); el.innerHTML=spinner();
  try {
    const u=await API.getUser(param);
    const isMe=u.is_me||u.id===window._me?.id;
    const bannerStyle=u.banner?`url(${esc(u.banner)}) center/cover`:`linear-gradient(135deg,${esc(u.color||'#C8922A')}55,${esc(u.color||'#C8922A')}22)`;
    el.innerHTML=`
      <div class="prof-card">
        <div class="prof-banner" style="background:${bannerStyle};position:relative">
          ${isMe?`<label style="position:absolute;bottom:10px;right:14px;background:rgba(0,0,0,.55);border-radius:var(--r);padding:6px 12px;cursor:pointer;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;backdrop-filter:blur(4px)">
            ${IC.cam} Banner<input type="file" accept="image/*" style="display:none" onchange="uploadBanner(this)">
          </label>`:''}
        </div>
        <div class="prof-hd">
          <div class="prof-av-wrap" style="background:${esc(u.color||'#C8922A')}" ${isMe?'onclick="document.getElementById(\'av-inp\').click()"':''}>
            ${u.avatar?`<img src="${esc(u.avatar)}" alt="">`:`<span style="color:#fff">${initials(u.name||u.username)}</span>`}
          </div>
          <div class="prof-info">
            <div class="prof-name">${esc(u.name)}</div>
            <div class="prof-uname">u/${esc(u.username)} ${u.online?'<span style="color:var(--grn);font-size:11px">● Onlayn</span>':''}</div>
            <div class="prof-bio">${esc(u.bio||"Bio yo'q...")}</div>
            <div class="prof-stats">
              <div><div class="ps-n">${fmtNum(u.followers||0)}</div><div class="ps-l">Obunachilar</div></div>
              <div><div class="ps-n">${fmtNum(u.following||0)}</div><div class="ps-l">Kuzatilayotganlar</div></div>
              <div><div class="ps-n">${u.posts?.length||0}</div><div class="ps-l">Post</div></div>
            </div>
            <div class="prof-acts">
              ${isMe
                ?`<button class="btn btn-gold" onclick="goSec('settings');loadSettings()">${IC.settings} Sozlamalar</button>
                  <input type="file" accept="image/*" id="av-inp" style="display:none" onchange="uploadAvatar(this)">`
                :`<button class="btn ${u.is_following?'btn-outline':'btn-gold'}" id="flw-btn-${u.id}" onclick="followUser('${u.id}',this)">
                    ${u.is_following?`${IC.check} Kuzatilmoqda`:`${IC.follow} Kuzatish`}
                  </button>
                  <button class="btn btn-ghost" onclick="startChat('${esc(u.username)}')">${IC.msg} Xabar</button>`
              }
              ${window._me?.is_admin&&!isMe?`<button class="btn btn-danger" onclick="adminBanUser('${u.id}',${u.is_banned})">${u.is_banned?'Blokdan chiqarish':'Bloklash'}</button>`:''}
            </div>
          </div>
        </div>
      </div>
      <div class="sr-hd">Postlari</div>
      <div id="user-posts-cnt"></div>`;
    const pc=document.getElementById('user-posts-cnt');
    if(!u.posts?.length) pc.innerHTML=emptyEl('save',"Hali post yo'q");
    else u.posts.forEach((p,i)=>{const d=document.createElement('div');d.innerHTML=buildPost(p);const c=d.firstElementChild;c.style.animationDelay=(i*.04)+'s';pc.appendChild(c);});
  } catch(e){el.innerHTML=emptyEl('close','Topilmadi',e.message);}
}

async function followUser(id,btn) {
  try {
    const d=await API.followUser(id);
    if(btn){btn.className=`btn ${d.following?'btn-outline':'btn-gold'}`;btn.innerHTML=d.following?`${IC.check} Kuzatilmoqda`:`${IC.follow} Kuzatish`;}
    toast(d.following?'Kuzatilmoqda':'Kuzatishdan to\'xtatildi');
  } catch(e){toast(e.message);}
}

async function uploadAvatar(inp){
  if(!inp.files[0]){return;}
  try{
    const fd=new FormData();
    fd.append('image',inp.files[0]);
    const d=await API.uploadAv(fd);
    if(d.avatar){window._me.avatar=d.avatar; syncTopbar(window._me);}
    toast('Rasm yangilandi');
    openUser(window._me.id);
  }catch(e){toast(e.message);}
}
async function uploadBanner(inp){
  if(!inp.files[0]){return;}
  try{
    const fd=new FormData();
    fd.append('image',inp.files[0]);
    const d=await API.uploadBanner(fd);
    if(d.banner) window._me.banner=d.banner;
    toast('Banner yangilandi');
    openUser(window._me.id);
  }catch(e){toast(e.message);}
}

async function startChat(username){
  if(!window._me){showAuthModal();return;}
  goSec('msgs');
  try{const u=await API.getUser(username);await loadConvos();await new Promise(r=>setTimeout(r,80));openChat(u);}
  catch(e){toast(e.message||'Xabar ochishda xatolik');}
}

/* ═══ SETTINGS ═══ */
async function loadSettings() {
  const el=document.getElementById('settings-cnt'); if(!el) return;
  el.innerHTML=spinner();
  try {
    const u=await API.me();
    const pushEnabled=localStorage.getItem('push_enabled')==='1';
    const permGranted=Notification.permission==='granted';
    el.innerHTML=`
      <div class="set-card">
        <div class="set-title"><span class="set-title-ico">👤</span> Profil</div>
        <div class="av-upload">
          <div class="av-big" id="av-inp2" onclick="document.getElementById('av-file2').click()">
            ${u.avatar?`<img src="${esc(u.avatar)}" alt="">`:`<span>${initials(u.name||u.username)}</span>`}
          </div>
          <div class="av-upload-info">
            <p>Profil rasmi</p>
            <small>JPG, PNG (max 5MB)</small>
            <label class="av-file-btn">${IC.cam} Rasm o'zgartirish<input type="file" accept="image/*" id="av-file2" style="display:none" onchange="uploadAvatar(this)"></label>
          </div>
        </div>
        <div class="form-row"><label class="form-lbl">Ism</label><input class="inp" id="st-name" value="${esc(u.name||'')}"></div>
        <div class="form-row"><label class="form-lbl">Bio</label><textarea class="inp" id="st-bio" rows="3">${esc(u.bio||'')}</textarea></div>
        <div class="form-row"><label class="form-lbl">Email</label><input class="inp" id="st-email" type="email" placeholder="email@example.com" value="${esc(u.email||'')}"></div>
        <button class="btn btn-gold" onclick="saveProfile()">Saqlash</button>
      </div>
      <div class="set-card">
        <div class="set-title"><span class="set-title-ico">🔒</span> Parol (Oddiy)</div>
        <div class="form-row"><label class="form-lbl">Eski parol</label><input class="inp" id="cp-old" type="password" placeholder="••••••"></div>
        <div class="form-row"><label class="form-lbl">Yangi parol</label><input class="inp" id="cp-new" type="password" placeholder="••••••"></div>
        <div class="form-row"><label class="form-lbl">Tasdiqlash</label><input class="inp" id="cp-conf" type="password" placeholder="••••••"></div>
        <button class="btn btn-gold" onclick="doChpass()">O'zgartirish</button>
      </div>
      <div class="set-card">
        <div class="set-title"><span class="set-title-ico">🔔</span> Bildirishnomalar</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:14px;font-weight:600">Push bildirishnomalar</div>
            <div style="font-size:12px;color:var(--tx4);margin-top:2px">Real vaqtda brauzer bildirishnomalari</div>
          </div>
          <button onclick="requestPushPermission()" class="btn ${permGranted?'btn-outline':'btn-gold'}" style="padding:6px 14px;font-size:12px">
            ${permGranted?'✅ Yoqilgan':'Yoqish'}
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0">
          <div>
            <div style="font-size:14px;font-weight:600">Tungi rejim</div>
            <div style="font-size:12px;color:var(--tx4);margin-top:2px">Qoramtir mavzu</div>
          </div>
          <button onclick="toggleTheme()" class="btn btn-ghost" style="padding:6px 14px;font-size:12px">Almashtirish</button>
        </div>
      </div>
      <div class="set-card">
        <div class="set-title"><span class="set-title-ico">🚪</span> Chiqish</div>
        ${window._me?.is_admin ? `<button class="btn btn-gold" style="margin-bottom:10px;width:100%" onclick="goSec('admin');loadAdmin()">🛡️ Admin Panelni ochish</button>` : ''}
        <button class="btn btn-danger" onclick="doLogout()">Hisobdan chiqish</button>
      </div>`;
  } catch(e){el.innerHTML=emptyEl('close','Xatolik',e.message);}
}

async function settingsSendCode(){
  const btn=document.getElementById('set-reset-send-btn');
  const err=document.getElementById('set-reset-err1');
  if(err)err.textContent='';
  btn.disabled=true;btn.textContent='...';
  try{
    const d=await API.sendCode(window._me.username);
    document.getElementById('set-reset-step1').style.display='none';
    document.getElementById('set-reset-step2').style.display='block';
    document.getElementById('set-reset-code').focus();
  }catch(e){if(err){err.textContent=e.message;err.classList.add('on');}}
  finally{btn.disabled=false;btn.textContent='📧 Kod yuborish';}
}
async function settingsResetByCode(){
  const code=(document.getElementById('set-reset-code')?.value||'').trim();
  const np=document.getElementById('set-reset-new')?.value;
  const cp=document.getElementById('set-reset-conf')?.value;
  const err=document.getElementById('set-reset-err2');
  if(err)err.textContent='';
  if(!code||code.length!==6){if(err){err.textContent='6 xonali kod kiriting';err.classList.add('on');}return;}
  if(!np||np.length<6){if(err){err.textContent='Parol kamida 6 belgi';err.classList.add('on');}return;}
  if(np!==cp){if(err){err.textContent='Parollar mos emas';err.classList.add('on');}return;}
  try{
    const vr=await API.verifyCode(window._me.username,code);
    await API.resetPass(vr.reset_token,np);
    document.getElementById('set-reset-step2').style.display='none';
    document.getElementById('set-reset-done').style.display='block';
    toast('Parol yangilandi!');
  }catch(e){if(err){err.textContent=e.message;err.classList.add('on');}}
}

async function saveProfile(){
  try{
    const name=document.getElementById('st-name').value;
    const bio=document.getElementById('st-bio').value;
    const email=document.getElementById('st-email')?.value?.trim()||'';
    const u=await API.updMe(name,bio);
    if(email && email!==window._me?.email){
      try{await api('PUT','/me',{name,bio,email});}catch(e){console.error('Email save:',e);}
    }
    window._me={...window._me,...u,email};syncTopbar(window._me);toast('Profil saqlandi');
  }catch(e){toast(e.message);}
}
async function doChpass(){
  const o=document.getElementById('cp-old').value,n=document.getElementById('cp-new').value,c=document.getElementById('cp-conf').value;
  if(n!==c){toast('Parollar mos emas');return;}
  try{await API.chpass(o,n);toast('Parol o\'zgartirildi');['cp-old','cp-new','cp-conf'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});}catch(e){toast(e.message);}
}

/* ═══ ADMIN ═══ */
let _adminTab = 'users', _adminSearch = '';

async function loadAdmin(){
  const el=document.getElementById('admin-cnt'); if(!el) return;
  el.innerHTML=spinner();
  try {
    const d=await API.adminStats();
    el.innerHTML=`
      <div class="admin-stats">
          ${[['👥','Foydalanuvchilar',d.user_count ?? d.users?.length ?? 0,'#4D8FFF'],['📝','Postlar',d.posts,'#46C97A'],['💬','Izohlar',d.comments,'#9B6FD4'],['🚩','Shikoyatlar',d.reports,'#E8703A']].map(([ico,l,v,c])=>`
          <div style="padding:16px 12px;text-align:center;border-right:1px solid var(--border)">
            <div style="font-size:20px;margin-bottom:4px">${ico}</div>
            <div style="font-size:22px;font-weight:800;font-family:'Syne',sans-serif;color:${c}">${fmtNum(v)}</div>
            <div style="font-size:11px;color:var(--tx4);margin-top:2px">${l}</div>
          </div>`).join('')}
        </div>
      <div style="display:flex;gap:4px;margin-bottom:12px">
        <button class="sort-btn${_adminTab==='users'?' active':''}" onclick="switchAdminTab('users')" style="flex:1">👥 Foydalanuvchilar</button>
        <button class="sort-btn${_adminTab==='reports'?' active':''}" onclick="switchAdminTab('reports')" style="flex:1">🚩 Shikoyatlar</button>
      </div>
      <div style="position:relative;margin-bottom:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--tx4);pointer-events:none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="inp" id="admin-search-inp" placeholder="Qidiruv..." value="${esc(_adminSearch)}" oninput="_adminSearch=this.value;renderAdminContent(window._adminLastData)" style="padding-left:34px">
      </div>
      <div id="admin-tab-content"></div>`;
    renderAdminContent(d);
  } catch(e){el.innerHTML=emptyEl('close','Xatolik',e.message);}
}

function switchAdminTab(tab) {
  _adminTab = tab;
  document.querySelectorAll('[onclick^="switchAdminTab"]').forEach(b=>{
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${tab}'`));
  });
  const lastData = window._adminLastData;
  if (lastData) renderAdminContent(lastData);
}

function renderAdminContent(d) {
  window._adminLastData = d;
  const el = document.getElementById('admin-tab-content'); if (!el) return;
  const q = (_adminSearch||'').toLowerCase();
  if (_adminTab === 'users') {
    const users = (d.users||[]).filter(u => !q || u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
    const shown = q ? users.slice(0,50) : users.slice(0,3);
    el.innerHTML = `<div class="set-card" style="padding:0">
      ${shown.map(u=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">
        <div class="av" style="${avStyle(u,38)};border-radius:50%;font-size:13px;flex-shrink:0">${avHtml(u,38,12)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;font-family:'Syne',sans-serif;display:flex;align-items:center;gap:5px">
            ${esc(u.name)}
            ${u.is_admin?'<span style="font-size:10px;background:rgba(200,146,42,.15);color:var(--gold);padding:1px 6px;border-radius:10px">👑 Admin</span>':''}
            ${u.is_banned?'<span style="font-size:10px;background:rgba(217,64,64,.12);color:var(--red);padding:1px 6px;border-radius:10px">🚫 Bloklangan</span>':''}
          </div>
          <div style="font-size:11px;color:var(--tx4)">u/${esc(u.username)} · ${fmtNum(u.karma||0)} karma</div>
          ${u.ban_reason?`<div style="font-size:11px;color:var(--red);margin-top:2px">Sabab: ${esc(u.ban_reason)}</div>`:''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${!u.is_admin?`<button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="adminAction('${u.id}','makeAdmin')">👑</button>`:`<button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="adminAction('${u.id}','remAdmin')">−👑</button>`}
          <button class="btn ${u.is_banned?'btn-outline':'btn-danger'}" style="font-size:11px;padding:4px 8px" onclick="adminBanUser('${u.id}',${u.is_banned})">${u.is_banned?'Ochish':'Blok'}</button>
        </div>
      </div>`).join('')}
      ${!users.length?`<div style="padding:20px;text-align:center;color:var(--tx4);font-size:13px">Hech narsa topilmadi</div>`:''}
      ${!q && users.length > 3?`<div style="padding:12px 14px;text-align:center;color:var(--tx4);font-size:12px">Yana ${users.length-3} foydalanuvchi bor — yuqoridagi qidiruvdan toping 🔍</div>`:''}
    </div>`;
  } else {
    const reports = (d.reports||[]).filter(r => !q || r.reason.toLowerCase().includes(q) || (r.rname||'').toLowerCase().includes(q));
    el.innerHTML = `<div class="set-card" style="padding:0">
      ${reports.length?reports.map(r=>`
      <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${esc(r.reason)}</div>
            <div style="font-size:11px;color:var(--tx4);margin-top:2px">
              ${esc(r.rname||'?')} tomonidan · ${r.ago}
              ${r.post_id?`· <span style="cursor:pointer;color:var(--blu)" onclick="openPost('${r.post_id}')">Postga o'tish</span>`:''}
            </div>
          </div>
          <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(232,112,58,.12);color:#E8703A;flex-shrink:0">Kutilmoqda</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost" style="padding:5px 12px;font-size:11px" onclick="adminResolve('${r.id}','resolved')">✅ Hal qilindi</button>
          <button class="btn btn-danger" style="padding:5px 12px;font-size:11px" onclick="adminResolve('${r.id}','dismissed')">❌ Rad etish</button>
        </div>
      </div>`).join(''):`<div style="padding:24px;text-align:center;color:var(--tx4);font-size:13px">Shikoyatlar yo'q 🎉</div>`}
    </div>`;
  }
}

async function adminBanUser(id,isBanned){
  if(isBanned){try{await API.adminAction({target_id:id,action:'unban'});toast('Bloklash olib tashlandi');loadAdmin();}catch(e){toast(e.message);}return;}
  _pendingBanId=id;document.getElementById('ban-reason-inp').value='';document.getElementById('ban-modal').classList.add('open');setTimeout(()=>document.getElementById('ban-reason-inp')?.focus(),100);
}
async function confirmBan(){
  const reason=(document.getElementById('ban-reason-inp').value||'').trim();
  const duration=parseInt(document.getElementById('ban-duration').value)||0;
  if(!reason){toast('Sabab kiriting');return;}
  document.getElementById('ban-modal').classList.remove('open');
  try{await API.adminAction({target_id:_pendingBanId,action:'ban',reason,duration});_pendingBanId=null;toast('Foydalanuvchi bloklandi');loadAdmin();}catch(e){toast(e.message);}
}
function closeBanModal(){document.getElementById('ban-modal').classList.remove('open');_pendingBanId=null;}
async function adminAction(id,action){try{await API.adminAction({target_id:id,action});toast('Yangilandi');loadAdmin();}catch(e){toast(e.message);}}
async function adminResolve(id,status){try{await API.adminResolve(id,status);toast('Hal qilindi');loadAdmin();}catch(e){toast(e.message);}}

/* ═══ COMMUNITY DELETE ═══ */
let _delComSlug = null;
function openDeleteCom(slug, name) {
  _delComSlug = slug;
  const modal = document.getElementById('com-delete-modal');
  const label = document.getElementById('com-del-slug-label');
  const inp   = document.getElementById('com-del-confirm-inp');
  if (!modal) return;
  if (label) label.textContent = name || slug;
  if (inp)   inp.value = '';
  modal.classList.add('open');
  setTimeout(()=>inp?.focus(), 150);
}
async function doDeleteCom() {
  const slug = _delComSlug; if (!slug) return;
  const inp  = document.getElementById('com-del-confirm-inp');
  const label = document.getElementById('com-del-slug-label')?.textContent || '';
  const val  = (inp?.value||'').trim();
  if (val !== label && val !== slug) { toast('Jamoa nomini to\'g\'ri kiriting'); return; }
  try {
    await fetch(`/api/communities/${slug}`, { method:'DELETE', headers:{ Authorization:'Bearer '+Tok.get() } });
    document.getElementById('com-delete-modal').classList.remove('open');
    toast('Jamoa o\'chirildi');
    goSec('home');
    loadFeed(true);
    loadMyComs();
  } catch(e) { toast('Xatolik yuz berdi'); }
}

/* ═══ EMOJI PICKER ═══ */
const EMOJIS = ['😀','😂','🥰','😍','🤩','😎','🥳','😊','😁','😆','😅','🤣','☺️','😇','🙂','🙃','😉','😌','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','🤤','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🤬','😤','😠','😡','🤡','👹','👺','💀','☠️','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊','👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🔥','💥','✨','⭐','🌟','🎉','🎊','🎈','🎁','🏆','🥇','🌈','☀️','🌙','⚡','❄️','🌊','🌸','🌺','🍕','🍔','🍟','🍜','🍱','🍣','🍦','🎂','🍰','☕','🧃','🥤','🍺','🚀','✈️','🚗','🎵','🎶','🎮','📱','💻','⌚','📷','🎬','📚','💰','💎'];

let _emojiPickerOpen = false;
function toggleEmojiPicker() {
  const panel = document.getElementById('emoji-picker-panel');
  if (!panel) return;
  _emojiPickerOpen = !_emojiPickerOpen;
  if (_emojiPickerOpen) {
    if (!panel.children.length) {
      EMOJIS.forEach(em => {
        const btn = document.createElement('button');
        btn.textContent = em;
        btn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;padding:3px;border-radius:6px;transition:transform .1s;line-height:1;font-family:"Apple Color Emoji","Noto Color Emoji",sans-serif';
        btn.onmouseenter = ()=>btn.style.transform='scale(1.3)';
        btn.onmouseleave = ()=>btn.style.transform='scale(1)';
        btn.onclick = () => {
          const inp = document.getElementById('chat-inp');
          if (inp) { inp.value += em; inp.focus(); }
        };
        panel.appendChild(btn);
      });
    }
    panel.style.display = 'flex';
    setTimeout(()=>{
      const close = (e)=>{ if(!panel.contains(e.target)&&!e.target.closest('[onclick="toggleEmojiPicker()"]')){panel.style.display='none';_emojiPickerOpen=false;document.removeEventListener('click',close);} };
      document.addEventListener('click', close);
    }, 50);
  } else {
    panel.style.display = 'none';
  }
}

/* ═══ CHAT IMAGE SEND ═══ */
async function sendChatImage(inp) {
  if (!inp.files?.[0]) return;
  if (!_chatWith) { toast('Avval suhbatdosh tanlang'); return; }
  const file = inp.files[0];
  inp.value = '';
  // Show preview locally
  const localUrl = URL.createObjectURL(file);
  addBubble({ id:'img-'+Date.now(), type:'image', image_url:localUrl, body:'[Rasm]', ago:'Hozir', seen:false }, true);
  // Upload to server
  try {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('to_id', _chatWith.id);
    const res = await fetch('/api/messages/image', {
      method:'POST',
      headers:{ Authorization:'Bearer '+Tok.get() },
      body: fd
    });
    if (!res.ok) { const d=await res.json(); toast(d.error||'Rasm yuborilmadi'); }
  } catch(e) { toast('Rasm yuborilmadi'); }
}

/* ═══ BAN BANNER ═══ */
function showBanBanner(reason) {
  const el = document.getElementById('ban-banner');
  const rt = document.getElementById('ban-reason-txt');
  if (!el) return;
  if (reason) { if(rt) rt.textContent = `Sabab: ${reason}`; }
  el.style.display = 'block';
  // Push content down
  const app = document.getElementById('app');
  if (app) app.style.paddingTop = '48px';
}

/* ═══ CONTACTS HORIZONTAL SCROLL ═══ */
function loadContactsScroll(convos) {
  const el = document.getElementById('contacts-scroll'); if (!el) return;
  try {
    if (!convos || !convos.length) { el.style.display='none'; return; }
    el.innerHTML = '';
    el.style.display = 'flex';
    convos.slice(0,20).forEach(cv => {
      const o = cv.other;
      const btn = document.createElement('div');
      btn.className = 'contact-bubble';
      btn.onclick = () => openChat(o);
      btn.innerHTML = `
        <div class="contact-av" style="${avStyle(o,46)};border-radius:50%;position:relative;flex-shrink:0">
          ${avHtml(o,46,14)}
          ${cv.unread>0?'<div style="position:absolute;top:-1px;right:-1px;width:12px;height:12px;border-radius:50%;background:var(--red);border:2px solid var(--surface)"></div>':''}
        </div>
        <div class="contact-name">${esc((o.name||o.username).split(' ')[0])}</div>`;
      el.appendChild(btn);
    });
  } catch {}
}

/* ═══ SAVED ═══ */
async function loadSavedPosts(){
  const el=document.getElementById('saved-cnt'); if(!el) return;
  el.innerHTML=spinner();
  try{const posts=await API.savedPosts();el.innerHTML='';if(!posts.length){      el.innerHTML=emptyEl('save',"Hozircha hech narsa saqlanmagan. Postdagi ⭐ tugmasini bosing.");return;}posts.forEach((p,i)=>{const d=document.createElement('div');d.innerHTML=buildPost(p);const c=d.firstElementChild;c.style.animationDelay=(i*.04)+'s';el.appendChild(c);});}catch(e){el.innerHTML=emptyEl('close','Xatolik',e.message);}
}

/* ═══ CREATE COMMUNITY ═══ */
let _ccColor='#C8922A';
function openCreateCom(){document.getElementById('cc-overlay').classList.add('open');_ccColor='#C8922A';}
function closeCreateCom(){document.getElementById('cc-overlay').classList.remove('open');}
function selectCCColor(color,el){_ccColor=color;document.querySelectorAll('#cc-overlay .color-opt').forEach(b=>b.classList.remove('active'));el.classList.add('active');document.getElementById('cc-color').value=color;}
function selectECColor(color,el){document.getElementById('ec-color').value=color;document.querySelectorAll('#ec-overlay .color-opt').forEach(b=>b.classList.toggle('active',b.dataset.color===color));}

async function doCreateCom(){
  const slug=(document.getElementById('nc-slug')?.value||'').trim().toLowerCase().replace(/\s+/g,'-');
  const name=(document.getElementById('nc-name')?.value||'').trim();
  const desc=(document.getElementById('nc-desc')?.value||'').trim();
  if(!slug){toast('Slug kerak');return;}
  if(!name){toast('Nom kerak');return;}
  const isPrivate=document.querySelector('input[name="cc-priv"]:checked')?.value==='1';
  const btn=document.getElementById('cc-create-btn');
  if(btn){btn.disabled=true;btn.textContent='Yaratilmoqda...';}
  try {
    const fd = new FormData();
    fd.append('slug',slug); fd.append('name',name); fd.append('description',desc); fd.append('color',_ccColor);
    if(isPrivate) fd.append('is_private','1');
    const bannerFile=document.getElementById('cc-banner-file')?.files?.[0];
    const avatarFile=document.getElementById('cc-avatar-file')?.files?.[0];
    if(bannerFile) fd.append('banner',bannerFile);
    if(avatarFile) fd.append('avatar',avatarFile);
    const com = await API.createCom(slug,name,desc,_ccColor,isPrivate?1:0);
    if (com && com.slug) {
      const bannerFile2=document.getElementById('cc-banner-file')?.files?.[0];
      const avatarFile2=document.getElementById('cc-avatar-file')?.files?.[0];
      if (bannerFile2 || avatarFile2) {
        try {
          const fd2 = new FormData();
          fd2.append('name', name); fd2.append('description', desc);
          fd2.append('color', _ccColor);
          if (bannerFile2) fd2.append('banner', bannerFile2);
          if (avatarFile2) fd2.append('avatar', avatarFile2);
          await API.updateCom(com.slug, fd2, true);
        } catch(e) { console.error('Image upload:', e); }
      }
    }
    closeCreateCom();toast('Jamoa yaratildi!');openCommunity(com.slug||slug);loadMyComs();
  } catch(e){toast(e.message);}
  finally{if(btn){btn.disabled=false;btn.textContent='Yaratish';}}
}

/* ═══ FILE PREVIEWS ═══ */
function previewSubImg(inp){
  const f=inp.files?.[0];if(!f)return;
  const el=document.getElementById('sub-img-preview');if(!el)return;
  const url=URL.createObjectURL(f);
  el.innerHTML=`<div style="max-height:200px;overflow:hidden;border-radius:var(--r);margin-top:8px"><img src="${url}" style="width:100%;object-fit:cover;max-height:200px"></div>`;
  document.getElementById('sub-img-drop').style.display='none';
}
function previewSubVid(inp){
  const f=inp.files?.[0];if(!f)return;
  const url=URL.createObjectURL(f);
  const vid=document.createElement('video');
  vid.preload='metadata';
  vid.onloadedmetadata=()=>{
    const dur=vid.duration;
    const warnEl=document.getElementById('vid-warn');
    const warnTxt=document.getElementById('vid-warn-text');
    if(dur>10*60){
      if(warnEl){warnEl.style.background='rgba(217,64,64,.08)';warnEl.style.borderColor='rgba(217,64,64,.2)';warnEl.style.color='var(--red)';}
      if(warnTxt) warnTxt.textContent='❌ Video '+(Math.floor(dur/60))+':'+(String(Math.floor(dur%60)).padStart(2,'0'))+' — Ko\'pi bilan 10 daqiqa!';
    } else {
      if(warnEl){warnEl.style.background='rgba(46,158,91,.08)';warnEl.style.borderColor='rgba(46,158,91,.2)';warnEl.style.color='var(--grn)';}
      if(warnTxt) warnTxt.textContent='✅ Video '+(Math.floor(dur/60))+':'+(String(Math.floor(dur%60)).padStart(2,'0'))+' — Yaroqli';
    }
    // Show poll section
    const pollSec=document.getElementById('vid-poll-section');
    if(pollSec) pollSec.style.display='block';
  };
  vid.src=url;
  const el=document.getElementById('sub-vid-preview');if(!el)return;
  el.innerHTML=`<video controls style="width:100%;border-radius:var(--r-lg);max-height:240px;margin-top:8px;background:#000;display:block"></video>`;
  el.querySelector('video').src=url;
}
function previewSubAud(inp){
  const f=inp.files?.[0];if(!f)return;
  const el=document.getElementById('sub-aud-preview');if(!el)return;
  const url=URL.createObjectURL(f);
  el.innerHTML=`<div style="padding:10px;background:var(--bg2);border-radius:var(--r);margin-top:8px;display:flex;align-items:center;gap:10px"><span style="font-size:20px">🎵</span><span style="font-size:13px;color:var(--tx2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><audio src="${url}" controls style="height:30px"></audio></div>`;
}

function setComSort(sort){
  const slug=window._curCom;if(!slug)return;
  _comSort=sort;
  document.querySelectorAll('#com-sort-bar .sort-btn').forEach(b=>b.classList.toggle('active',b.dataset.sort===sort));
  loadComFeed(slug,sort,true);
}

/* ═══ EXPORTS ═══ */
window.openCommunity=openCommunity; window.toggleJoin=toggleJoin; window.loadMyComs=loadMyComs; window.loadTopComs=loadTopComs;
window.buildComRsb=buildComRsb; window.editCom=editCom; window.doEditCom=doEditCom; window.setComSort=setComSort;
window.openSubmit=openSubmit; window.closeSubmit=closeSubmit; window.switchSubTab=switchSubTab; window.doSubmitPost=doSubmitPost; window.initComPicker=initComPicker;
window.onTopSearch=onTopSearch; window.doSearch=doSearch; window.setSearchType=setSearchType;
window.loadNotifs=loadNotifs; window.loadNotifCount=loadNotifCount; window.markNotifs=markNotifs; window.updNotifDot=updNotifDot; window.initNotifWS=initNotifWS;
window.loadConvos=loadConvos; window.openChat=openChat; window.closeChatMobile=closeChatMobile; window.addBubble=addBubble; window.sendMsg=sendMsg; window.startChat=startChat; window.initMsgWS=initMsgWS;
window.filterConvos=filterConvos; window.cancelReply=cancelReply; window.setReplyTo=setReplyTo;
window.showMsgCtxMenu=showMsgCtxMenu; window.togglePinMsg=togglePinMsg; window.deleteMsg=deleteMsg; window.forwardMsg=forwardMsg; window.playVoiceMsg=playVoiceMsg;
window.initSwipeToReply=initSwipeToReply;
window.startVoiceRec=startVoiceRec; window.cancelVoice=cancelVoice; window.sendVoiceMsg=sendVoiceMsg;
window.startVideoCall=startVideoCall; window.startVoiceCall=startVoiceCall; window.endCall=endCall;
window.toggleCallMic=toggleCallMic; window.toggleCallCam=toggleCallCam; window.toggleSpeaker=toggleSpeaker;
window.acceptCall=acceptCall; window.rejectCall=rejectCall; window.initCallWS=initCallWS; window.toggleFullscreen=toggleFullscreen;
window.openUser=openUser; window.followUser=followUser; window.uploadAvatar=uploadAvatar; window.uploadBanner=uploadBanner;
window.loadSettings=loadSettings; window.saveProfile=saveProfile; window.doChpass=doChpass;
window.loadAdmin=loadAdmin; window.adminBanUser=adminBanUser; window.confirmBan=confirmBan; window.closeBanModal=closeBanModal; window.adminAction=adminAction; window.adminResolve=adminResolve;
window.switchAdminTab=switchAdminTab;
window.openDeleteCom=openDeleteCom;
window.doDeleteCom=doDeleteCom;
window.toggleEmojiPicker=toggleEmojiPicker;
window.sendChatImage=sendChatImage;
window.showBanBanner=showBanBanner;
window.loadContactsScroll=loadContactsScroll;
window.renderAdminContent=renderAdminContent;
window.loadSavedPosts=loadSavedPosts;

window.openCreateCom=openCreateCom; window.closeCreateCom=closeCreateCom; window.selectCCColor=selectCCColor; window.selectECColor=selectECColor; window.doCreateCom=doCreateCom;
window.previewSubImg=previewSubImg; window.previewSubVid=previewSubVid; window.previewSubAud=previewSubAud;
window.openComAdmins=openComAdmins; window.addComAdmin=addComAdmin; window.removeComAdmin=removeComAdmin;
window.toggleComPrivate=toggleComPrivate; window.handleComRequest=handleComRequest;
