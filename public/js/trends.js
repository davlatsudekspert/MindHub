'use strict';

/* ═══ FAZA 5: "Muammolar" (/trends) va klaster sahifasi ═══ */
let _trendsSort = 'hot';
let _trendsCursor = 0;
let _trendsLoading = false;
let _trendsDone = false;

function setTrendsSort(s) {
  _trendsSort = s;
  document.querySelectorAll('#sec-trends .sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
  loadClusters(true);
}

function clusterStatusBadge(status) {
  return status === 'solved'
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--grn);background:rgba(70,201,122,.12);padding:3px 8px;border-radius:20px">🟢 Yechim topilgan</span>`
    : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--gold);background:rgba(200,146,42,.12);padding:3px 8px;border-radius:20px">🟡 Ochiq</span>`;
}

function clusterCardHtml(c) {
  const growth = c.growth_7d > 0 ? `<span style="color:var(--grn);font-weight:700;font-size:12px">▲ +${c.growth_7d} bu hafta</span>` : '';
  const samples = (c.sample_posts || []).slice(0, 2)
    .map(s => `<div style="font-size:12px;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">— ${esc(s.title)}</div>`).join('');
  return `
    <div class="post-card" style="cursor:pointer" onclick="openCluster('${c.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px">
        <div style="font-size:15px;font-weight:800;font-family:'Syne',sans-serif;line-height:1.3">${esc(c.title)}</div>
        ${clusterStatusBadge(c.status)}
      </div>
      ${c.summary ? `<div style="font-size:13px;color:var(--tx3);margin-bottom:10px">${esc(c.summary)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
        <div style="font-size:22px;font-weight:800;color:var(--gold);font-family:'Syne',sans-serif">${fmtNum(c.unique_users)}</div>
        <div style="font-size:12px;color:var(--tx3);line-height:1.3">kishi<br>shu muammoni<br>ko'targan</div>
        ${growth}
      </div>
      ${samples}
    </div>`;
}

async function loadClusters(reset) {
  if (reset) { _trendsCursor = 0; _trendsDone = false; document.getElementById('trends-cnt').innerHTML = spinner(); }
  if (_trendsLoading || _trendsDone) return;
  _trendsLoading = true;
  try {
    const d = await API.clusters(_trendsSort, _trendsCursor);
    const cnt = document.getElementById('trends-cnt');
    if (reset) cnt.innerHTML = '';
    if (!d.clusters.length && reset) {
      cnt.innerHTML = emptyEl('🔥', 'Hozircha muammolar yo\'q', "Odamlar 'Muammo' yoki 'G'oya' turida post qo'yganda, shu yerda avtomatik guruhlanadi");
    } else {
      cnt.insertAdjacentHTML('beforeend', d.clusters.map(clusterCardHtml).join(''));
    }
    _trendsCursor = d.next_cursor;
    if (!d.clusters.length) _trendsDone = true;
  } catch (e) {
    document.getElementById('trends-cnt').innerHTML = emptyEl('🔥', 'Yuklashda xatolik', e.message);
  } finally {
    _trendsLoading = false;
  }
}

// Infinite scroll uchun IntersectionObserver (mavjud posts.js uslubiga mos)
document.addEventListener('DOMContentLoaded', () => {
  const trigger = document.getElementById('trends-scroll-trigger');
  if (!trigger || typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && curSec() === 'trends') loadClusters(false);
  }).observe(trigger);
});

function svgGrowthChart(daily) {
  if (!daily || !daily.length) return '<div style="font-size:12px;color:var(--tx4);padding:20px 0;text-align:center">Hali yetarli ma\'lumot yo\'q</div>';
  const w = 560, h = 120, pad = 10;
  const max = Math.max(1, ...daily.map(d => d.new_posts));
  const stepX = (w - pad*2) / Math.max(1, daily.length - 1);
  const points = daily.map((d, i) => {
    const x = pad + i*stepX;
    const y = h - pad - (d.new_posts / max) * (h - pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastX = pad + (daily.length-1)*stepX;
  const lastY = h - pad - (daily[daily.length-1].new_posts / max) * (h - pad*2);
  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:120px" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="var(--gold, #C8922A)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="var(--gold, #C8922A)"/>
    </svg>`;
}

async function openCluster(id) {
  goSec('cluster');
  const cnt = document.getElementById('cluster-detail');
  cnt.innerHTML = spinner();
  try {
    const c = await API.cluster(id);
    const postsHtml = (c.posts || []).map(p => `
      <div class="post-card" style="cursor:pointer;margin-bottom:8px" onclick="goSec('post');openPost('${p.post_id}')">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div class="av" style="${avStyle({color:p.color},22)};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">${avHtml({avatar:p.avatar,name:p.username},22,9)}</div>
          <div style="font-size:12px;color:var(--tx3)">${esc(p.username)}</div>
        </div>
        <div style="font-size:14px;font-weight:600">${esc(p.title)}</div>
      </div>`).join('');
    cnt.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px">
        <div style="font-size:22px;font-weight:800;font-family:'Syne',sans-serif">${esc(c.title)}</div>
        ${clusterStatusBadge(c.status)}
      </div>
      ${c.summary ? `<div style="font-size:14px;color:var(--tx3);margin-bottom:16px">${esc(c.summary)}</div>` : ''}
      <div style="display:flex;gap:24px;margin-bottom:18px">
        <div><div style="font-size:24px;font-weight:800;color:var(--gold);font-family:'Syne',sans-serif">${fmtNum(c.unique_users)}</div><div style="font-size:11px;color:var(--tx3)">kishi ko'targan</div></div>
        <div><div style="font-size:24px;font-weight:800;font-family:'Syne',sans-serif">${fmtNum(c.member_count)}</div><div style="font-size:11px;color:var(--tx3)">post</div></div>
      </div>
      <div class="post-card" style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--tx3);margin-bottom:8px">Kunlik o'sish</div>
        ${svgGrowthChart(c.daily_growth)}
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px">Postlar</div>
      ${postsHtml || emptyEl('🔥','Postlar topilmadi')}
    `;
  } catch (e) {
    cnt.innerHTML = emptyEl('⚠️', 'Yuklab bo\'lmadi', e.message);
  }
}

window.setTrendsSort = setTrendsSort;
window.loadClusters = loadClusters;
window.openCluster = openCluster;
