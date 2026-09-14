'use strict';
let _feedSort = 'hot', _feedOff = 0, _feedBusy = false;
let _comSort  = 'hot', _comOff  = 0;
let _curCom   = null;

/* ═══ BUILD POST ═══ */
function buildPost(p, isDetail = false) {
  const sc   = p.score || 0;
  const uV   = p.my_vote === 1, dV = p.my_vote === -1;
  const scCls = uV ? ' up' : dV ? ' dn' : '';
  const isMine = p.user_id === window._me?.id || window._me?.is_admin;

  /* media */
  let mediaHtml = '';
  if (p.image) {
    mediaHtml = `<div class="post-img" onclick="event.stopPropagation()"><img src="${esc(p.image)}" alt="" loading="lazy"></div>`;
  } else if (p.video) {
    mediaHtml = buildVideoPlayerInline(p.video);
  } else if (p.audio) {
    mediaHtml = buildAudioPlayerInline(p.audio, p.title);
  }

  /* poll */
  let pollHtml = '';
  if (p.poll) {
    pollHtml = buildPollHtml(p.poll, p.id, isMine);
  }

  return `
<div class="post-card${isDetail ? ' detail' : ''}" id="pc-${p.id}" ${!isDetail ? `onclick="openPost('${p.id}')"` : ''}>
  <div class="vote-col">
    <button class="v-btn up${uV?' voted':''}" onclick="event.stopPropagation();votePost('${p.id}',1)">${IC.up}</button>
    <span class="v-score${scCls}">${fmtNum(sc)}</span>
    <button class="v-btn dn${dV?' voted':''}" onclick="event.stopPropagation();votePost('${p.id}',-1)">${IC.dn}</button>
  </div>
  <div class="post-body">
    <div class="post-meta">
      <span class="post-com-link" onclick="event.stopPropagation();openCommunity('${esc(p.cslug)}')">
        <span class="com-circle" style="background:${esc(p.ccolor||'#C8922A')}"></span>
        <strong>${esc(p.cslug)}</strong>
      </span>
      <span class="post-by">
        u/<a onclick="event.stopPropagation();event.preventDefault();openUser('${esc(p.username)}')">${esc(p.username)}</a>
        &middot; ${p.ago || ''}
      </span>
      ${p.flair ? `<span class="post-flair" style="color:${esc(p.ccolor||'#C8922A')};border-color:${esc(p.ccolor||'#C8922A')}44">${esc(p.flair)}</span>` : ''}
    </div>
    <div class="post-title">${esc(p.title)}</div>
    ${p.link ? `<div class="post-link-tag">${IC.link} <a href="${esc(p.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(p.link.length>60?p.link.slice(0,60)+'...':p.link)}</a></div>` : ''}
    ${mediaHtml}
    ${p.body && !isDetail ? `<div class="post-preview">${esc(p.body)}</div>` : ''}
    ${p.body && isDetail ? `<div style="font-size:14.5px;color:var(--tx2);line-height:1.75;margin-bottom:12px;white-space:pre-wrap;word-break:break-word">${esc(p.body)}</div>` : ''}
    ${pollHtml}
    <div class="post-acts" onclick="event.stopPropagation()">
      <button class="pa" onclick="openPost('${p.id}')">${IC.cmt} ${fmtNum(p.comment_count||0)} Izoh</button>
      <button class="pa${p.saved?' saved':''}" id="sv-${p.id}" onclick="savePost('${p.id}',this)">${IC.save} ${p.saved?'Saqlangan':'Saqlash'}</button>
      <button class="pa" onclick="copyLink('${p.id}')">${IC.share} Ulashish</button>
      ${isMine ? `<button class="pa pa-del" onclick="confirmDelPost('${p.id}')">${IC.trash}</button>` : ''}
      <button class="pa pa-report" onclick="openReport('${p.id}','post')">🚩 Shikoyat</button>
    </div>
  </div>
</div>`;
}

function buildVideoPlayerInline(src) {
  const id = 'vp-' + Math.random().toString(36).slice(2,8);
  return `<div class="custom-video-player" id="${id}" onclick="event.stopPropagation()" style="border-radius:var(--r-lg);overflow:hidden;background:#000;margin-bottom:8px;position:relative;aspect-ratio:16/9;max-height:340px">
    <video src="${esc(src)}" preload="metadata" playsinline style="width:100%;height:100%;object-fit:contain;display:block"></video>
    <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.7));padding:8px 10px;display:flex;align-items:center;gap:8px">
      <button class="player-btn play-btn" onclick="cvpToggle(this)" style="width:34px;height:34px;border-radius:50%;background:var(--gold);color:#fff;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <div class="player-progress" style="flex:1;height:3px;background:rgba(255,255,255,.3);border-radius:2px;cursor:pointer" onclick="cvpSeek(this,event)">
        <div class="player-progress-fill" style="width:0%;height:100%;background:var(--gold);border-radius:2px;pointer-events:none"></div>
      </div>
      <span class="player-time" style="font-size:11px;color:rgba(255,255,255,.8);white-space:nowrap">0:00</span>
      <button class="player-btn" onclick="cvpMute(this)" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.15);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
      </button>
      <button class="player-btn" onclick="cvpFullscreen(this)" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.15);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
    </div>
  </div>`;
}

function buildAudioPlayerInline(src, title) {
  const id = 'ap-' + Math.random().toString(36).slice(2,8);
  const bars = Array.from({length:40},(_,i)=>`<div class="bar" style="flex:1;background:var(--border2);border-radius:2px;height:${4+Math.round(Math.abs(Math.sin(i*.5))*22)}px;transition:background .12s;min-height:3px"></div>`).join('');
  setTimeout(() => {
    const audio = document.getElementById(id+'-audio');
    if (audio) setupAudioPlayer(id);
  }, 100);
  return `<div class="custom-audio-player" id="${id}" onclick="event.stopPropagation()" style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r-lg);padding:12px 14px;display:flex;align-items:center;gap:12px;margin-bottom:8px">
    <button class="player-btn play-btn" onclick="capToggle('${id}')" style="width:40px;height:40px;border-radius:50%;background:var(--gold);color:#fff;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;flex-shrink:0;transition:all .15s">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </button>
    <div style="flex:1;min-width:0">
      ${title ? `<div style="font-size:12px;font-weight:600;color:var(--tx2);margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎵 ${esc(title)}</div>` : ''}
      <div class="audio-waveform" id="${id}-bars" style="display:flex;align-items:center;gap:2px;height:30px;overflow:hidden">${bars}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <div class="player-progress" style="flex:1;height:3px;background:var(--bg3);border-radius:2px;cursor:pointer;overflow:hidden" onclick="capSeek('${id}',this,event)">
          <div class="player-progress-fill" id="${id}-prog" style="width:0%;height:100%;background:var(--gold);border-radius:2px;pointer-events:none"></div>
        </div>
        <span class="player-time" id="${id}-time" style="font-size:11px;color:var(--tx4);white-space:nowrap">0:00</span>
      </div>
    </div>
    <audio id="${id}-audio" src="${esc(src)}" preload="metadata" style="display:none"></audio>
  </div>`;
}

function buildPollHtml(poll, postId, showResults) {
  const ended = poll.ended;
  const hasVoted = poll.my_vote >= 0;
  const showBars = hasVoted || showResults || ended;

  return `<div class="poll-card" onclick="event.stopPropagation()" style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r-lg);padding:14px;margin-bottom:8px">
    <div style="font-size:13px;font-weight:700;color:var(--tx1);margin-bottom:10px;font-family:'Syne',sans-serif">📊 ${esc(poll.question)}</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${poll.options.map((opt, i) => {
        const isMyVote = poll.my_vote === i;
        if (showBars) {
          return `<div style="position:relative;border-radius:var(--r);overflow:hidden;cursor:default">
            <div style="position:absolute;inset:0;background:${isMyVote?'var(--gold-soft)':'var(--bg3)'};border-radius:var(--r);width:${opt.pct}%;transition:width .4s ease"></div>
            <div style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;font-size:13px">
              <span style="color:${isMyVote?'var(--gold)':'var(--tx1)'};font-weight:${isMyVote?'700':'500'}">${isMyVote?'✓ ':''} ${esc(opt.text)}</span>
              <span style="color:var(--tx4);font-size:12px;font-weight:600">${opt.pct}%</span>
            </div>
          </div>`;
        }
        return `<button onclick="votePoll('${poll.id}',${i},this)" style="width:100%;text-align:left;padding:9px 13px;border:1.5px solid var(--border2);border-radius:var(--r);font-size:13px;color:var(--tx1);background:var(--surface);cursor:pointer;transition:all .15s;font-weight:500" onmouseover="this.style.borderColor='var(--gold)';this.style.background='var(--gold-soft)'" onmouseout="this.style.borderColor='var(--border2)';this.style.background='var(--surface)'">${esc(opt.text)}</button>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--tx4);margin-top:8px;display:flex;align-items:center;gap:8px">
      <span>${poll.total} ta ovoz</span>
      ${ended ? '<span style="color:var(--red)">• Tugagan</span>' : `<span>• ${new Date(poll.ends_at*1000).toLocaleDateString('uz-UZ')}</span>`}
    </div>
  </div>`;
}

async function votePoll(pollId, optIdx, btn) {
  if (!window._me) { showAuthModal(); return; }
  try {
    const d = await API.votePoll(pollId, optIdx);
    // Re-render poll
    const card = btn.closest('.poll-card');
    if (!card) return;
    const options = d.options;
    const myVote  = d.my_vote;
    card.querySelectorAll('button').forEach((b, i) => {
      b.style.pointerEvents = 'none';
    });
    // Replace with bars
    const optContainer = card.querySelector('div[style*="flex-direction:column"]');
    if (optContainer) {
      optContainer.innerHTML = options.map((opt, i) => {
        const isMyVote = myVote === i;
        return `<div style="position:relative;border-radius:var(--r);overflow:hidden">
          <div style="position:absolute;inset:0;background:${isMyVote?'var(--gold-soft)':'var(--bg3)'};border-radius:var(--r);width:${opt.pct}%;transition:width .4s ease"></div>
          <div style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;font-size:13px">
            <span style="color:${isMyVote?'var(--gold)':'var(--tx1)'};font-weight:${isMyVote?'700':'500'}">${isMyVote?'✓ ':''} ${esc(opt.text)}</span>
            <span style="color:var(--tx4);font-size:12px;font-weight:600">${opt.pct}%</span>
          </div>
        </div>`;
      }).join('');
    }
    // Update total
    const totalEl = card.querySelector('[style*="margin-top:8px"] span');
    if (totalEl) totalEl.textContent = d.total + ' ta ovoz';
    toast("Ovoz berildi!");
  } catch(e) { toast(e.message || 'Xatolik'); }
}

/* ═══ FEED ═══ */
async function loadFeed(reset = true) {
  if (_feedBusy && !reset) return;
  _feedBusy = true;
  const cnt = document.getElementById('feed-cnt'); if (!cnt) { _feedBusy = false; return; }
  if (reset) { _feedOff = 0; cnt.innerHTML = spinner(); }
  try {
    const posts = await API.posts(_feedSort, _feedOff);
    if (reset) cnt.innerHTML = '';
    if (!posts.length && reset) { cnt.innerHTML = emptyEl('save', "Hali postlar yo'q", "Birinchi post siz bo'ling!"); _feedBusy = false; return; }
    posts.forEach((p,i) => {
      const d = document.createElement('div'); d.innerHTML = buildPost(p);
      const c = d.firstElementChild; c.style.animationDelay = (i*.04)+'s'; cnt.appendChild(c);
    });
    _feedOff += posts.length;
  } catch(e) { if(reset) cnt.innerHTML = emptyEl('close','Xatolik',e.message); }
  _feedBusy = false;
}

function setFeedSort(sort) {
  _feedSort = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  loadFeed(true);
}

async function openPost(id) {
  goSec('post');
  // Scroll to top when opening post
  document.querySelector('.main-content')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
  const pd = document.getElementById('post-detail');
  const cc = document.getElementById('cmts-cnt');
  if (pd) pd.innerHTML = spinner();
  if (cc) cc.innerHTML = '';
  try {
    const post = await API.post(id);
    if (!post) { if(pd) pd.innerHTML = emptyEl('close','Topilmadi',''); return; }
    if (pd) { pd.innerHTML = buildPost(post, true); setupMediaInDetail(pd); }
    if (cc) {
      cc.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px;margin-bottom:10px;box-shadow:var(--shadow)">
          <textarea class="inp" id="root-ta" placeholder="Izoh yozing..." rows="3" style="margin-bottom:8px;resize:vertical"></textarea>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn-gold" onclick="submitRootCmt('${id}')">Yuborish</button></div>
        </div>`;
      renderComments(post.comments || [], cc, id);
    }
  } catch(e) { if(pd) pd.innerHTML = emptyEl('close','Topilmadi',e.message); }
}

function setupMediaInDetail(container) {
  // Audio players in detail view need setup after DOM insert
  container.querySelectorAll('[id$="-audio"]').forEach(audio => {
    const id = audio.id.replace('-audio','');
    setupAudioPlayer(id);
  });
  // Video time updates
  container.querySelectorAll('video').forEach(video => {
    video.addEventListener('timeupdate', () => {
      const ctrl = video.closest('.custom-video-player')?.querySelector('.player-progress-fill');
      const timeEl = video.closest('.custom-video-player')?.querySelector('.player-time');
      if (ctrl && video.duration) ctrl.style.width = (video.currentTime/video.duration*100)+'%';
      if (timeEl) timeEl.textContent = fmtTime(video.currentTime);
    });
  });
}

async function loadComFeed(slug, sort = 'hot', reset = true) {
  const cnt = document.getElementById('com-feed-cnt'); if (!cnt) return;
  if (reset) { _comOff = 0; cnt.innerHTML = spinner(); }
  try {
    const posts = await API.comPosts(slug, sort, _comOff);
    if (reset) cnt.innerHTML = '';
    if (!posts.length && reset) { cnt.innerHTML = emptyEl('save',"Hali postlar yo'q","Bu jamoada birinchi post siz bo'ling!"); return; }
    posts.forEach((p,i) => {
      const d = document.createElement('div'); d.innerHTML = buildPost(p);
      const c = d.firstElementChild; c.style.animationDelay = (i*.04)+'s'; cnt.appendChild(c);
    });
    _comOff += posts.length;
  } catch(e) { if(reset) cnt.innerHTML = emptyEl('close','Xatolik',e.message); }
}

async function votePost(id, vote) {
  if (!requireAuth()) return;
  try {
    const d = await API.vote(id, vote);
    const card = document.getElementById('pc-'+id);
    if (!card) return;
    const score = card.querySelector('.v-score');
    const upBtn = card.querySelector('.v-btn.up');
    const dnBtn = card.querySelector('.v-btn.dn');
    if (score) { score.textContent = fmtNum(d.score); score.className = 'v-score' + (d.my_vote===1?' up':d.my_vote===-1?' dn':''); }
    if (upBtn) upBtn.classList.toggle('voted', d.my_vote===1);
    if (dnBtn) dnBtn.classList.toggle('voted', d.my_vote===-1);
  } catch(e) { toast(e.message); }
}

async function savePost(id, btn) {
  if (!requireAuth()) return;
  try {
    const d = await API.save(id);
    if (btn) { btn.classList.toggle('saved', d.saved); btn.innerHTML = (IC.save) + ' ' + (d.saved?'Saqlangan':'Saqlash'); }
  } catch(e) { toast(e.message); }
}

async function submitRootCmt(postId) {
  if (!requireAuth()) return;
  const ta = document.getElementById('root-ta');
  const body = (ta?.value || '').trim();
  if (!body) return;
  ta.disabled = true;
  try {
    const cmt = await API.comment(postId, body);
    ta.value = '';
    const cc  = document.getElementById('cmts-cnt');
    if (cc) {
      const d = document.createElement('div');
      d.innerHTML = buildCmtNode(cmt, postId, 0);
      cc.appendChild(d.firstElementChild);
    }
    toast('Izoh qo\'shildi');
  } catch(e) { toast(e.message); }
  finally { ta.disabled = false; }
}

async function submitReply(postId, parentId) {
  if (!requireAuth()) return;
  const ta = document.getElementById('ri-'+parentId);
  const body = (ta?.value || '').trim();
  if (!body) return;
  ta.disabled = true;
  try {
    const cmt = await API.comment(postId, body, parentId);
    ta.value = '';
    document.getElementById('rf-'+parentId)?.classList.remove('open');
    const children = document.getElementById('rc-'+parentId);
    if (children) {
      const d = document.createElement('div');
      d.innerHTML = buildCmtNode(cmt, postId, cmt.depth);
      children.appendChild(d.firstElementChild);
    }
  } catch(e) { toast(e.message); }
  finally { ta.disabled = false; }
}

function renderComments(comments, container, postId, depth = 0) {
  const roots = comments.filter(c => (!c.parent_id || c.parent_id === null) && c.depth === 0);
  roots.forEach(c => {
    const d = document.createElement('div');
    d.innerHTML = buildCmtNode(c, postId, 0);
    container.appendChild(d.firstElementChild);
    const children = comments.filter(x => x.parent_id === c.id);
    if (children.length) {
      const childEl = document.getElementById('rc-'+c.id);
      if (childEl) renderChildComments(children, comments, childEl, postId);
    }
  });
}

function renderChildComments(children, allComments, container, postId) {
  children.forEach(c => {
    const d = document.createElement('div');
    d.innerHTML = buildCmtNode(c, postId, c.depth);
    container.appendChild(d.firstElementChild);
    const grandchildren = allComments.filter(x => x.parent_id === c.id);
    if (grandchildren.length) {
      const childEl = document.getElementById('rc-'+c.id);
      if (childEl) renderChildComments(grandchildren, allComments, childEl, postId);
    }
  });
}

function buildCmtNode(c, postId, depth = 0) {
  const isMine = c.user_id === window._me?.id;
  const uV = c.my_vote === 1, dV = c.my_vote === -1;
  return `
<div class="cmt d${Math.min(depth,4)}" id="cmt-${c.id}">
  <div class="cmt-hd">
    <div class="av" style="width:24px;height:24px;font-size:9px;border-radius:50%;background:${esc(c.color||'#C8922A')};flex-shrink:0">
      ${c.avatar?`<img src="${esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover" alt="">`:`<span style="color:#fff">${initials(c.username)}</span>`}
    </div>
    <span class="cmt-author" onclick="openUser('${esc(c.username)}')">${esc(c.username)}</span>
    <span class="cmt-score">${fmtNum(c.score||0)}</span>
    <span class="cmt-ago">${c.ago||''}</span>
  </div>
  <div class="cmt-body${c.is_deleted?' deleted':''}">${esc(c.body)}</div>
  <div class="cmt-acts">
    <button class="ca up${uV?' voted':''}" onclick="voteCmt('${c.id}',1,this)">
      ${IC.up} ${fmtNum(c.score||0)}
    </button>
    <button class="ca dn${dV?' voted':''}" onclick="voteCmt('${c.id}',-1,this)">${IC.dn}</button>
    <button class="ca" onclick="toggleReplyForm('${c.id}')">↩ Javob</button>
    ${isMine&&!c.is_deleted?`<button class="ca ca-del" onclick="delCmt('${c.id}')">🗑</button>`:''}
  </div>
  <div class="reply-form" id="rf-${c.id}">
    <textarea class="reply-ta" id="ri-${c.id}" placeholder="Javob yozing..." rows="2"></textarea>
    <div class="reply-acts">
      <button class="btn btn-ghost" style="font-size:12px;padding:5px 10px" onclick="toggleReplyForm('${c.id}')">Bekor</button>
      <button class="btn btn-gold" style="font-size:12px;padding:5px 10px" onclick="submitReply('${postId}','${c.id}')">Yuborish</button>
    </div>
  </div>
  <div class="cmt-children" id="rc-${c.id}"></div>
</div>`;
}

async function voteCmt(id, vote, btn) {
  if (!requireAuth()) return;
  try {
    const d = await API.voteCmt(id, vote);
    const cmt = btn.closest('.cmt');
    cmt.querySelector('.ca.up')?.classList.toggle('voted', d.my_vote===1);
    cmt.querySelector('.ca.dn')?.classList.toggle('voted', d.my_vote===-1);
    cmt.querySelector('.ca.up').innerHTML = IC.up + ' ' + fmtNum(d.score);
  } catch(e) { toast(e.message); }
}

async function delCmt(id) {
  if (!confirm('Izohni o\'chirasizmi?')) return;
  try {
    await API.delCmt(id);
    const el = document.getElementById('cmt-'+id);
    if (el) {
      el.style.transition = 'all .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-20px)';
      setTimeout(() => el.remove(), 250);
    }
  } catch(e) { toast(e.message); }
}

function copyLink(id) {
  navigator.clipboard?.writeText(`${location.origin}/?post=${id}`).then(() => toast('Havola nusxalandi'));
}

function initScrollFeed() {
  const area = document.getElementById('feed-area') || window;
  const trigger = document.getElementById('scroll-trigger');
  if (!trigger) return;
  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !_feedBusy) {
      const sec = document.querySelector('.section.active')?.id;
      if (sec === 'sec-home') loadFeed(false);
      else if (sec === 'sec-community' && _curCom) loadComFeed(_curCom, _comSort, false);
    }
  });
  obs.observe(trigger);
}

function initFeedWS() {
  WS.on('new_post', d => {
    if (document.querySelector('#sec-home.active')) {
      const cnt = document.getElementById('feed-cnt');
      if (cnt && _feedOff === 0) {
        const el = document.createElement('div');
        el.innerHTML = buildPost(d.data);
        const c = el.firstElementChild;
        c.style.animationDelay = '0s';
        cnt.prepend(c);
        _feedOff++;
      }
    }
  });
  WS.on('del_post', d => { document.getElementById('pc-'+d.data?.id)?.remove(); });
  WS.on('del_comment', d => {
    const el = document.getElementById('cmt-'+d.data?.commentId);
    if (el) {
      el.style.transition = 'all .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-20px)';
      setTimeout(() => el.remove(), 250);
    }
  });
  WS.on('new_comment', d => {
    if (!d.data) return;
    const cc = document.getElementById('cmts-cnt');
    if (!cc) return;
    const existing = document.getElementById('cmt-'+d.data.comment?.id);
    if (!existing && d.data.comment) {
      // Skip if this comment was just submitted by the current user
      if (d.data.comment.user_id === window._me?.id) return;
      const el = document.createElement('div');
      el.innerHTML = buildCmtNode(d.data.comment, d.data.postId, d.data.comment.depth||0);
      const c = el.firstElementChild;
      if (d.data.comment.parent_id) {
        const rc = document.getElementById('rc-'+d.data.comment.parent_id);
        if (rc) rc.appendChild(c);
      } else {
        cc.appendChild(c);
      }
    }
  });
}

window.buildPost=buildPost; window.loadFeed=loadFeed; window.setFeedSort=setFeedSort;
window.openPost=openPost; window.loadComFeed=loadComFeed;
window.votePost=votePost; window.savePost=savePost;
window.submitRootCmt=submitRootCmt; window.submitReply=submitReply;
window.renderComments=renderComments; window.buildCmtNode=buildCmtNode;
window.voteCmt=voteCmt; window.delCmt=delCmt; window.copyLink=copyLink;
window.toggleReplyForm=toggleReplyForm; window.initScrollFeed=initScrollFeed; window.initFeedWS=initFeedWS;
window.votePoll=votePoll; window.buildPollHtml=buildPollHtml;

/* ═══ POST DELETE ═══ */
let _delPostId = null;

function confirmDelPost(id) {
  _delPostId = id;
  document.getElementById('del-overlay')?.classList.add('open');
}

function closeDelPost() {
  _delPostId = null;
  document.getElementById('del-overlay')?.classList.remove('open');
}

async function doDelPost() {
  if (!_delPostId) return;
  const pid = _delPostId;
  closeDelPost();
  try {
    await API.delPost(pid);
    // Remove card from feed/detail
    document.getElementById('pc-' + pid)?.remove();
    // If we're in post detail, go back to home
    if (document.getElementById('sec-post')?.classList.contains('active')) {
      goSec('home');
    }
    toast("Post o'chirildi");
  } catch(e) {
    toast(e.message || "O'chirishda xatolik");
  }
}

window.confirmDelPost = confirmDelPost;
window.closeDelPost   = closeDelPost;
window.doDelPost      = doDelPost;
