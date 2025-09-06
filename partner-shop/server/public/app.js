const state = {
  profile: null,
  rules: null,
  groups: [],
  pages: {}, // groupId -> page idx (0-based)
  cart: [],   // {id,name,price,qty,currency}
  viewed: []
};

// --- utils ---
const qs = new URLSearchParams(location.search);
if (qs.get('p')) {
  fetch('/api/login?p=' + encodeURIComponent(qs.get('p'))).then(()=>location.replace('/'));
}
if (qs.get('logout')) {
  fetch('/api/logout').then(()=>location.replace('/'));
}

function money(v){ return (Math.round(v*100)/100).toFixed(2); }
function el(q){ return document.querySelector(q); }
function cel(tag, cls){ const n=document.createElement(tag); if(cls) n.className=cls; return n; }

// --- computePrice: тепер приймає vendorCode (артикул) ---
function computePrice(base, vendorCode) {
  let v = Number(base||0);
  // Якщо статус не active — ціна як для user
  if (state.profileStatus && state.profileStatus !== 'active') {
    return { price: v, old: null };
  }
  if (state.profile === 'partner_A' || state.profile === 'admin_A') {
    return { price: Math.round(v*0.85*100)/100, old: v };
  }
  if (state.profile === 'partner_B' || state.profile === 'admin_B') {
    if (!window.partnerBPricesCache) {
      fetch('/data/partner-b-prices.json').then(r=>r.json()).then(arr=>{
        window.partnerBPricesCache = {};
        for (const it of arr) window.partnerBPricesCache[String(it.article)] = it.price;
        render();
      });
    }
    let price = null;
    if (window.partnerBPricesCache && vendorCode) {
      if (window.partnerBPricesCache[String(vendorCode)]) {
        price = window.partnerBPricesCache[String(vendorCode)];
      }
    }
    if (price != null) return { price, old: v };
    return { price: v, old: null };
  }
  // user, admin, guest — стандартна логіка
  const r = state.rules;
  if (!state.profile || !r) return { price: v, old: null };
  const gmap = r.group_discounts || {};
  const dGlobal = Number(r.discount_percent||0);
  const dGroup = vendorCode && gmap[vendorCode] ? Number(gmap[vendorCode]) : 0;
  let d = dGlobal + dGroup;
  let outOld = null;
  if (d>0){ outOld = v; v = v*(1-d/100); }
  if (r.rounding) v = Math.round(v / r.rounding) * r.rounding;
  if (r.min_percent_of_base) v = Math.max(v, (r.min_percent_of_base/100)*base);
  return { price: v, old: outOld };
}

async function loadMe(){
  const res = await fetch('/api/me');
  const j = await res.json();
  state.profile = j.profile;
  state.rules = j.rules || null;
  el('#btn-login').textContent = state.profile ? `Профіль: ${state.profile}` : 'Увійти';
  window.mePhone = j.phone || '';
  // Додаємо значок адміна, якщо профіль адмінський
  const btn = el('#btn-login');
  const icon = btn.querySelector('.btn-icon');
  if (icon) {
    icon.innerHTML = (state.profile === 'admin' || state.profile === 'admin_A' || state.profile === 'admin_B')
      ? '<svg width="20" height="20" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="4"/><path d="M2 18c0-3.3 3.6-6 8-6s8 2.7 8 6"/><path d="M10 2l2 4h-4l2-4z"/></svg>'
      : '<svg width="20" height="20" fill="none" stroke="#a5afc1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="4"/><path d="M2 18c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg>';
  }
}

async function loadFeed(){
  const res = await fetch('/api/feed');
  const j = await res.json();
  state.groups = j.groups || [];
}

// --- Fuzzy search (Levenshtein) ---
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i < v0.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j < v0.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

// --- Видалено setupGlobalSearch ---
// --- Оновлений setupSimpleSearch ---
function setupSimpleSearch() {
  const search = el('#search');
  if (!search) return;
  search.autocomplete = 'off';
  // Очищаємо старі обробники, якщо були
  search.oninput = null;
  search.onkeydown = null;
  let searchGroup = null;
  let dropdown = null;
  let dropdownItems = [];
  let activeIdx = -1;
  function showDropdown(items) {
    if (dropdown) dropdown.remove();
    dropdown = document.createElement('div');
    dropdown.className = 'group-autocomplete';
    dropdown.style.position = 'absolute';
    const rect = search.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + window.scrollY) + 'px';
    dropdown.style.width = rect.width + 'px';
    dropdown.style.zIndex = '1000';
    dropdownItems = items;
    activeIdx = -1;
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'group-autocomplete-item';
      // Назва + артикул
      const label = document.createElement('span');
      label.textContent = it.name + (it.vendorCode ? ' ('+it.vendorCode+')' : '');
      label.style.cursor = 'pointer';
      label.onclick = (e) => { e.stopPropagation(); selectItem(idx); };
      row.append(label);
      // Посилання "Детальніше"
      const link = document.createElement('a');
      link.textContent = 'Детальніше';
      link.href = '#';
      link.className = 'autocomplete-link';
      link.style.marginLeft = '12px';
      link.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectItem(idx); };
      row.append(link);
      // --- Клік по всьому рядку ---
      row.onclick = (e) => { selectItem(idx); };
      // --- Наведення миші оновлює activeIdx ---
      row.onmouseenter = () => {
        activeIdx = idx;
        const opts = dropdown.querySelectorAll('.group-autocomplete-item');
        opts.forEach((el,i)=>el.classList.toggle('active',i===activeIdx));
      };
      dropdown.append(row);
    });
    document.body.appendChild(dropdown);
  }
  function selectItem(idx) {
    const it = dropdownItems[idx];
    if (!it) return;
    if (dropdown) dropdown.remove();
    search.value = '';
    state.globalQuery = '';
    openModal(it);
  }
  search.oninput = (e)=>{
    state.globalQuery = search.value;
    const q = search.value.trim().toLowerCase();
    if (!q) { if (dropdown) dropdown.remove(); if (searchGroup) searchGroup.remove(); return; }
    let allItems = [];
    const seen = new Set();
    for (const g of state.groups) {
      for (const it of g.items) {
        if (!seen.has(it.id)) {
          allItems.push({ ...it, groupId: g.id, groupName: g.name });
          seen.add(it.id);
        }
      }
    }
    // --- Додаємо пошук по частині артикула ---
    let vendorPartMatches = [];
    if (q && q.length >= 2 && /\d/.test(q)) {
      vendorPartMatches = allItems.filter(it =>
        it.vendorCode && it.vendorCode.toLowerCase().includes(q) &&
        ((it.name||'').toLowerCase().includes(q) || it.vendorCode.toLowerCase().includes(q))
      ).map(it => ({...it, _vendorPartMatch: true}));
    }
    // ---
    // Точний збіг по артикулу
    let exactVendorMatches = allItems.filter(it => (it.vendorCode||'').toLowerCase() === q).map(it => ({...it, _exactVendorMatch: true}));
    // Пошук по назві (autocomplete)
    const words = q.split(/\s+/).filter(Boolean);
    let nameMatches = allItems.map(it => {
      const name = (it.name||'').toLowerCase();
      let matchCount = 0;
      let startCount = 0;
      let autocomplete = '';
      words.forEach(w => {
        if (name.startsWith(w)) startCount++;
        else if (name.includes(w)) matchCount++;
      });
      if (words.length === 1 && name.startsWith(words[0]) && name.length > words[0].length) {
        autocomplete = name.slice(words[0].length);
      }
      return { ...it, startCount, matchCount, autocomplete };
    })
    .filter(x => x.startCount > 0 || x.matchCount > 0)
    .sort((a,b)=>{
      if (b.startCount !== a.startCount) return b.startCount - a.startCount;
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return 0;
    })
    .slice(0, 8);
    let autocompleteSuggestions = nameMatches
      .filter(x => x.autocomplete)
      .map(x => ({...x, name: search.value + x.autocomplete, _autocomplete: true}));
    let items = [
      ...exactVendorMatches,
      ...vendorPartMatches.filter(x => !x._exactVendorMatch),
      ...nameMatches.filter(x => !x._exactVendorMatch && !x._vendorPartMatch),
      ...autocompleteSuggestions
    ].slice(0, 10);
    showDropdown(items);
    // --- (опціонально) showSearchGroup ---
  };
  search.onkeydown = (e) => {
    if (!dropdown) return;
    const opts = dropdown.querySelectorAll('.group-autocomplete-item');
    if (e.key === 'ArrowDown') {
      activeIdx = Math.min(opts.length-1, activeIdx+1);
      opts.forEach((el,i)=>el.classList.toggle('active',i===activeIdx));
      if (opts[activeIdx]) opts[activeIdx].scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIdx = Math.max(0, activeIdx-1);
      opts.forEach((el,i)=>el.classList.toggle('active',i===activeIdx));
      if (opts[activeIdx]) opts[activeIdx].scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (activeIdx>=0) {
        selectItem(activeIdx);
        e.preventDefault();
      } else if (dropdownItems.length) {
        selectItem(0);
        e.preventDefault();
      }
    }
  };
  search.onblur = ()=>{ setTimeout(()=>{ if (dropdown) dropdown.remove(); }, 200); };
}
window.addEventListener('DOMContentLoaded', setupSimpleSearch);

// --- Функція для отримання ціни для ролі ---
function getPriceForRole(base, vendorCode, role) {
  let v = Number(base||0);
  if (role === 'partner_A' || role === 'admin_A') return { price: Math.round(v*0.85*100)/100, old: v };
  if (role === 'partner_B' || role === 'admin_B') {
    if (!window.partnerBPricesCache) {
      fetch('/data/partner-b-prices.json').then(r=>r.json()).then(arr=>{
        window.partnerBPricesCache = {};
        for (const it of arr) window.partnerBPricesCache[String(it.article)] = it.price;
        render();
      });
    }
    let price = null;
    if (window.partnerBPricesCache && vendorCode) {
      if (window.partnerBPricesCache[String(vendorCode)]) {
        price = window.partnerBPricesCache[String(vendorCode)];
      }
    }
    if (price != null) return { price, old: v };
    return { price: v, old: null };
  }
  // user, admin, guest — стандартна логіка
  return { price: v, old: null };
}

function filterOutCovers(items) {
  return items.filter(it => {
    const name = (it.name || '').toLowerCase();
    const group = (it.groupName || '').toLowerCase();
    return !(
      name.includes('чохол') || name.includes('чохли') ||
      name.includes('чехол') || name.includes('чехлы') ||
      group.includes('чохол') || group.includes('чохли') ||
      group.includes('чехол') || group.includes('чехлы')
    );
  });
}

function renderGroup(g) {
  const wrap = cel('section','group');
  const head = cel('div','group-head');
  const name = cel('div','group-name'); name.textContent = g.name || 'Без групи';
  head.append(name);
  wrap.append(head);
  // --- Основний grid ---
  const grid = cel('div','grid');
  let order = localStorage.getItem('order_'+g.id);
  let items = g.items.slice();
  if (order) {
    try {
      const arr = JSON.parse(order);
      if (Array.isArray(arr) && arr.length) {
        items = arr.map(id => items.find(it=>it.id===id)).filter(Boolean).concat(items.filter(it=>!arr.includes(it.id)));
      }
    } catch {}
  }
  const sorted = items.sort((a, b) => {
    const aIn = (typeof a.quantityInStock === 'number' && a.quantityInStock > 0);
    const bIn = (typeof b.quantityInStock === 'number' && b.quantityInStock > 0);
    return (bIn - aIn);
  });
  sorted.forEach((it, i) => {
    const card = cel('div', 'card');
    card.setAttribute('data-id', it.id);
    card.setAttribute('draggable', 'true');
    card.style.cursor = 'grab';
    card.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', it.id);
      card.classList.add('dragging');
    };
    card.ondragend = (e) => {
      card.classList.remove('dragging');
    };
    card.ondragover = (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    };
    card.ondragleave = (e) => {
      card.classList.remove('drag-over');
    };
    card.ondrop = (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== it.id) {
        const idxFrom = sorted.findIndex(x=>x.id===draggedId);
        const idxTo = i;
        if (idxFrom>=0 && idxTo>=0) {
          const arr = sorted.slice();
          const [moved] = arr.splice(idxFrom,1);
          arr.splice(idxTo,0,moved);
          localStorage.setItem('order_'+g.id, JSON.stringify(arr.map(x=>x.id)));
          renderGroup(g);
        }
      }
    };
    const th = cel('div', 'thumb');
    const img = cel('img');
    img.loading = 'lazy';
    img.alt = it.name;
    img.src = it.picture || (it.pictures && it.pictures[0]) || '';
    th.append(img);
    const body = cel('div', 'body');
    const nm = cel('div', 'name');
    nm.textContent = it.name;
    // Артикул
    const art = cel('div', 'vendorcode');
    if (it.vendorCode) {
      art.textContent = 'Артикул: ' + it.vendorCode;
      art.style.fontSize = '0.95em';
      art.style.color = '#aaa';
      art.style.marginBottom = '2px';
    }
    // Короткий опис
    const desc = cel('div', 'desc');
    desc.textContent = (it.description||'').replace(/<[^>]+>/g,'').slice(0,80);
    // Стан наявності
    const st = cel('div', 'stock');
    if (typeof it.quantityInStock === 'number' && it.quantityInStock > 0) {
      st.textContent = 'В наявності';
      st.className = 'stock in';
    } else {
      st.textContent = 'Немає в наявності';
      st.className = 'stock out';
    }
    // Ціна
    const { price, old } = computePrice(it.price, it.vendorCode);
    const pr = cel('div', 'price');
    if (old) {
      const o = cel('span', 'old');
      o.textContent = money(old) + ' ' + (it.currency || 'UAH');
      pr.append(o);
    }
    const n = cel('span', 'new');
    n.textContent = money(price) + ' ' + (it.currency || 'UAH');
    pr.append(n);
    // Кнопка Детальніше
    const btn = cel('button', 'primary');
    btn.innerHTML = '<span class="btn-icon"><svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5-5 5 5"/></svg></span> Детальніше';
    btn.onclick = (e) => { e.stopPropagation(); openModal(it); };
    body.append(nm, art, desc, st, pr, btn);
    card.append(th, body);
    grid.append(card);
  });
  wrap.append(grid);
  const old = document.querySelector('.group[data-id="'+g.id+'"]');
  if (old && old.parentNode) old.parentNode.replaceChild(wrap, old);
  else el('#app').append(wrap);
  wrap.setAttribute('data-id', g.id);
}

function render() {
  // --- Додаємо групу "Всі товари" (дублі) з пошуком ---
  const app = el('#app');
  app.innerHTML = '';
  let allItems = [];
  for (const g of state.groups) for (const it of g.items) allItems.push({ ...it, groupId: g.id, groupName: g.name });
  // Фільтруємо чохли
  allItems = filterOutCovers(allItems);
  // Група "Всі товари"
  let filtered = allItems;
  const search = el('#search');
  if (search) {
    const q = search.value.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      filtered = allItems.filter(it => {
        const name = (it.name||'').toLowerCase();
        const vendor = (it.vendorCode||'').toLowerCase();
        return words.every(w => name.includes(w) || vendor.includes(w));
      });
    }
  }
  // --- Сортування по vendorCode від найбільшого до найменшого ---
  filtered = filtered
    .slice()
    .sort((a, b) => {
      const av = Number(a.vendorCode) || 0;
      const bv = Number(b.vendorCode) || 0;
      return bv - av;
    });
  function renderAllGroup(items) {
    // Видалити попередню групу якщо є
    const prev = document.querySelector('.group.all-group');
    if (prev) prev.remove();
    const allGroup = {
      id: 'all',
      name: 'Всі товари',
      items: items
    };
    renderGroup(allGroup, true);
  }
  renderAllGroup(filtered);
  // Далі стандартний рендер груп
  const groups = state.groups.slice();
  const noGroupArr = groups.filter(g => g.name === 'Без групи' || !g.id || g.id === '');
  const otherGroups = groups.filter(g => !(g.name === 'Без групи' || !g.id || g.id === ''));
  const orderedGroups = [...otherGroups, ...noGroupArr];
  for (const g of orderedGroups){
    // Фільтруємо чохли у групах
    const groupItems = filterOutCovers(g.items.map(it => ({...it, groupName: g.name})));
    renderGroup({ ...g, items: groupItems });
  }
}
// Додати клас .all-group для групи "Всі товари"
function renderGroup(g, isAllGroup) {
  const wrap = cel('section','group');
  if (isAllGroup) wrap.classList.add('all-group');
  const head = cel('div','group-head');
  const name = cel('div','group-name'); name.textContent = g.name || 'Без групи';
  head.append(name);
  wrap.append(head);
  // --- Основний grid ---
  const grid = cel('div','grid');
  // drag&drop порядок
  let order = localStorage.getItem('order_'+g.id);
  let items = g.items.slice();
  if (order) {
    try {
      const arr = JSON.parse(order);
      if (Array.isArray(arr) && arr.length) {
        items = arr.map(id => items.find(it=>it.id===id)).filter(Boolean).concat(items.filter(it=>!arr.includes(it.id)));
      }
    } catch {}
  }
  const sorted = items.sort((a, b) => {
    const aIn = (typeof a.quantityInStock === 'number' && a.quantityInStock > 0);
    const bIn = (typeof b.quantityInStock === 'number' && b.quantityInStock > 0);
    return (bIn - aIn);
  });
  sorted.forEach((it, i) => {
    const card = cel('div', 'card');
    card.setAttribute('data-id', it.id);
    card.setAttribute('draggable', 'true');
    card.style.cursor = 'grab';
    card.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', it.id);
      card.classList.add('dragging');
    };
    card.ondragend = (e) => {
      card.classList.remove('dragging');
    };
    card.ondragover = (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    };
    card.ondragleave = (e) => {
      card.classList.remove('drag-over');
    };
    card.ondrop = (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== it.id) {
        const idxFrom = sorted.findIndex(x=>x.id===draggedId);
        const idxTo = i;
        if (idxFrom>=0 && idxTo>=0) {
          const arr = sorted.slice();
          const [moved] = arr.splice(idxFrom,1);
          arr.splice(idxTo,0,moved);
          localStorage.setItem('order_'+g.id, JSON.stringify(arr.map(x=>x.id)));
          renderGroup(g, isAllGroup);
        }
      }
    };
    const th = cel('div', 'thumb');
    const img = cel('img');
    img.loading = 'lazy';
    img.alt = it.name;
    img.src = it.picture || (it.pictures && it.pictures[0]) || '';
    th.append(img);
    const body = cel('div', 'body');
    const nm = cel('div', 'name');
    nm.textContent = it.name;
    // Артикул
    const art = cel('div', 'vendorcode');
    if (it.vendorCode) {
      art.textContent = 'Артикул: ' + it.vendorCode;
      art.style.fontSize = '0.95em';
      art.style.color = '#aaa';
      art.style.marginBottom = '2px';
    }
    // Короткий опис
    const desc = cel('div', 'desc');
    desc.textContent = (it.description||'').replace(/<[^>]+>/g,'').slice(0,80);
    // Стан наявності
    const st = cel('div', 'stock');
    if (typeof it.quantityInStock === 'number' && it.quantityInStock > 0) {
      st.textContent = 'В наявності';
      st.className = 'stock in';
    } else {
      st.textContent = 'Немає в наявності';
      st.className = 'stock out';
    }
    // Ціна
    let price = it.price, old = null;
    if (it.priceObj && typeof it.priceObj === 'object') {
      price = it.priceObj.price;
      old = it.priceObj.old;
    } else if (typeof it.price === 'object' && it.price !== null) {
      price = it.price.price;
      old = it.price.old;
    }
    const pr = cel('div', 'price');
    if (old) {
      const o = cel('span', 'old');
      o.textContent = money(old) + ' ' + (it.currency || 'UAH');
      pr.append(o);
    }
    const n = cel('span', 'new');
    n.textContent = money(price) + ' ' + (it.currency || 'UAH');
    pr.append(n);
    // Кнопка Детальніше
    const btn = cel('button', 'primary');
    btn.innerHTML = '<span class="btn-icon"><svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5-5 5 5"/></svg></span> Детальніше';
    btn.onclick = (e) => { e.stopPropagation(); openModal(it); };
    body.append(nm, art, desc, st, pr, btn);
    card.append(th, body);
    grid.append(card);
  });
  wrap.append(grid);
  const old = document.querySelector('.group[data-id="'+g.id+'"]');
  if (old && old.parentNode) old.parentNode.replaceChild(wrap, old);
  else el('#app').append(wrap);
  wrap.setAttribute('data-id', g.id);
}

// --- Modal product ---
function openModal(it, onClose) {
  const m = el('#modal');
  const b = el('#modal-body');
  b.innerHTML = '';

  const box = cel('div','modal-box');
  box.classList.add('modal-box');

  // Фото-карусель ліворуч
  let photoIdx = 0;
  const photos = Array.isArray(it.pictures) && it.pictures.length ? it.pictures : [it.picture].filter(Boolean);
  const photoCol = cel('div','modal-photo-col');
  const img = cel('img');
  img.src = photos[photoIdx] || '';
  img.alt = it.name;
  img.style.cursor = 'pointer';
  img.onclick = (e) => {
    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width/2) {
      photoIdx = (photoIdx+1)%photos.length;
    } else {
      photoIdx = (photoIdx-1+photos.length)%photos.length;
    }
    img.src = photos[photoIdx];
  };
  photoCol.append(img);

  // Характеристики під фото
  let charlist = cel('ul','charlist');
  if (Array.isArray(it.params) && it.params.length) {
    for (const p of it.params) {
      const li = document.createElement('li');
      li.textContent = `${p.name}: ${p.value}`;
      charlist.append(li);
    }
  }
  if (it.raw) {
    const skip = new Set(['picture','pictures','description','name','name_ua','description_ua','keywords_ua','keywords','id','currency','categoryId','vendorCode','available','param','price','quantity_in_stock','quantityInStock','maxQty']);
    for (const k of Object.keys(it.raw)) {
      if (!skip.has(k)) {
        const val = Array.isArray(it.raw[k]) ? it.raw[k][0] : it.raw[k];
        if (typeof val === 'string' && val.length > 0) {
          const li = document.createElement('li');
          li.textContent = `${k}: ${val}`;
          charlist.append(li);
        }
      }
    }
  }
  if (!charlist.children.length) charlist = null;
  if (charlist) photoCol.append(charlist);

  // Правий блок: назва, опис, qty, кнопка
  const right = cel('div','modal-content');
  const title = cel('h2'); title.textContent = it.name;
  // Артикул
  const art = cel('div', 'vendorcode');
  if (it.vendorCode) {
    art.textContent = 'Артикул: ' + it.vendorCode;
    art.style.fontSize = '1em';
    art.style.color = '#aaa';
    art.style.margin = '0 0 8px 0';
  }
  right.append(title, art);
  // Опис
  const desc = cel('div','modal-desc'); desc.innerHTML = it.description || '';
  // --- Ціни ---
  let priceObj;
  if (state.profile === 'admin' && window.adminRoleSelect && window.adminStatusSelect) {
    const prevProfile = state.profile;
    const prevStatus = state.profileStatus;
    state.profile = adminRoleSelect.value;
    state.profileStatus = adminStatusSelect.value;
    priceObj = computePrice(it.price, it.vendorCode);
    state.profile = prevProfile;
    state.profileStatus = prevStatus;
  } else {
    priceObj = computePrice(it.price, it.vendorCode);
  }
  const { price, old } = priceObj;
  const priceRow = cel('div', 'modal-price-row');
  if (old) {
    const o = cel('span', 'old');
    o.textContent = money(old) + ' ' + (it.currency || 'UAH');
    o.style.textDecoration = 'line-through';
    o.style.marginRight = '8px';
    priceRow.append(o);
  }
  const n = cel('span', 'new');
  n.textContent = money(price) + ' ' + (it.currency || 'UAH');
  n.style.fontWeight = 'bold';
  priceRow.append(n);
  right.append(priceRow);
  // --- Кількість ---
  const maxQty = (typeof it.maxQty === 'number' && it.maxQty > 0) ? it.maxQty : null;
  if (maxQty === null) {
    right.append(title);
    right.append(desc);
    const out = cel('div'); out.style.color = 'var(--red)'; out.style.fontWeight = 'bold'; out.textContent = 'Немає в наявності';
    right.append(out);
  } else {
    // Кількість
    const qtyRow = cel('div','qty-row');
    const minus = cel('button','qty-btn'); minus.textContent = '−';
    const plus = cel('button','qty-btn'); plus.textContent = '+';
    const qty = cel('input','qty-input'); qty.type='number'; qty.min='1';
    qty.value='1';
    qty.max = maxQty;
    minus.onclick = ()=>{ qty.value = Math.max(1, Number(qty.value)-1); };
    plus.onclick = ()=>{ qty.value = Math.min(maxQty, Number(qty.value)+1); };
    qty.oninput = ()=>{ qty.value = Math.max(1, Math.min(maxQty, Number(qty.value)||1)); };
    const qtyInfo = cel('span'); qtyInfo.textContent = `В наявності: ${maxQty}`;
    qtyRow.append(minus, qty, plus, qtyInfo);
    const add = cel('button','add-to-cart-btn');
    add.innerHTML = '<svg width="20" height="20" fill="none" stroke="#181c24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="17" r="1.5"/><circle cx="15.5" cy="17" r="1.5"/><path d="M2 2h2l2.6 13.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20 6H6"/></svg> Додати в кошик ('+money(price)+' '+(it.currency||'UAH')+')';
    add.onclick = ()=>{ addToCart(it, Number(qty.value||1), price); closeModal(); };
    right.append(desc, qtyRow, add);
  }

  box.append(photoCol, right);
  b.append(box);
  m.classList.remove('hidden');
  m.setAttribute('aria-hidden','false');
  // Кнопка закриття
  const closeBtn = el('#modal-close');
  closeBtn.className = 'close';
  closeBtn.onclick = () => {
    closeBtn.blur();
    m.classList.add('hidden');
    m.setAttribute('aria-hidden','true');
    if (typeof onClose === 'function') onClose();
  };
}
function closeModal(){
  const m = el('#modal');
  const closeBtn = el('#modal-close');
  if (closeBtn) closeBtn.blur();
  m.classList.add('hidden');
  m.setAttribute('aria-hidden','true');
}
el('#modal-close').onclick = closeModal;
el('#modal').addEventListener('click', (e)=>{ if (e.target.id==='modal') closeModal(); });

// --- Cart ---
function addToCart(it, qty, price){
  const exist = state.cart.find(x=>x.id===it.id && money(x.price)===money(price));
  if (exist) exist.qty += qty; else state.cart.push({ id: it.id, name: it.name, price, qty, currency: it.currency||'UAH' });
  updateCartBadge();
}
function updateCartBadge(){ el('#cart-count').textContent = state.cart.reduce((s,x)=>s+x.qty,0); }
function openDrawer(){ renderCart(); const d=el('#drawer'); d.classList.remove('hidden'); d.setAttribute('aria-hidden','false'); }
function closeDrawer(){ const d=el('#drawer'); d.classList.add('hidden'); d.setAttribute('aria-hidden','true'); }

function renderCart(){
  const box = el('#cart-items'); box.innerHTML = '';
  let total = 0;
  for (const it of state.cart){
    total += it.price * it.qty;
    const row = cel('div','cart-row');
    const left = cel('div'); left.textContent = `${it.name} x${it.qty}`;
    const right = cel('div'); right.innerHTML = `<strong>${money(it.price)}</strong> ${it.currency}`;
    row.append(left,right); box.append(row);
  }
  el('#cart-total').textContent = money(total);
}

el('#btn-cart').onclick = openDrawer;
el('#drawer-close').onclick = closeDrawer;

el('#checkout-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!state.cart.length) return alert('Кошик порожній');
  const fd = new FormData(e.target);
  const contact = Object.fromEntries(fd.entries());
  const payload = { items: state.cart, contact };
  const res = await fetch('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const j = await res.json();
  if (j.ok){
    alert('Замовлення надіслано! Ми скоро зв’яжемось.');
    state.cart = []; updateCartBadge(); closeDrawer();
  } else {
    alert('Помилка: ' + (j.error||'невідома'));
  }
});

// --- Search ---
// --- Видалено старий обробник пошуку з рендером секції "Результати пошуку" ---

// --- Login button (hint) ---
el('#btn-login').onclick = async () => {
  if (state.profile) {
    if (confirm('Вийти у гостьовий режим?')) {
      await fetch('/api/logout-phone', { method: 'POST' });
      location.reload();
    }
  } else {
    const phone = prompt('Введіть номер телефону у форматі +380XXXXXXXXX');
    if (phone) {
      const password = prompt('Введіть пароль');
      if (!password) return;
      const res = await fetch('/api/login-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), password: password })
      });
      const j = await res.json();
      if (j.ok) {
        alert('Вхід успішний!');
        location.reload();
      } else {
        alert('Помилка: ' + (j.error || 'невірний телефон або пароль'));
      }
    }
  }
};

el('#btn-update-feed').onclick = async () => {
  if (!confirm('Оновити наявність товарів з Prom?')) return;
  el('#btn-update-feed').disabled = true;
  el('#btn-update-feed').textContent = 'Оновлення...';
  try {
    const res = await fetch('/api/feed/update', { method: 'POST' });
    const text = await res.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      alert('Сервер повернув не JSON. Можливо, сталася помилка на сервері:\n' + text);
      return;
    }
    if (j.ok) {
      alert('Фід оновлено!');
      location.reload();
    } else {
      alert('Помилка: ' + (j.error || 'невідома'));
    }
  } catch (e) {
    alert('Помилка: ' + e.message);
  } finally {
    el('#btn-update-feed').disabled = false;
    el('#btn-update-feed').textContent = 'Оновити наявність';
  }
};

// --- Init ---
(async function init(){
  await loadMe();
  await loadFeed();
  render();
})();

state.viewed = [];

function addViewed(item) {
  const idx = state.viewed.findIndex(x => x.id === item.id);
  if (idx !== -1) state.viewed.splice(idx, 1);
  state.viewed.unshift({ id: item.id, name: item.name, picture: item.picture || (item.pictures && item.pictures[0]) || '', vendorCode: item.vendorCode });
  if (state.viewed.length > 10) state.viewed.length = 10;
  renderViewed();
}

function renderViewed() {
  const list = el('#viewed-list');
  if (!list) return;
  list.innerHTML = '';
  for (const it of state.viewed) {
    const wrap = cel('div', 'viewed-item');
    const thumb = cel('div', 'viewed-thumb');
    const img = cel('img');
    img.src = it.picture;
    img.alt = it.name;
    thumb.append(img);
    wrap.append(thumb);
    const name = cel('div', 'viewed-name');
    name.textContent = it.name.length > 18 ? it.name.slice(0, 16) + '…' : it.name;
    wrap.title = it.name;
    wrap.onclick = () => {
      const group = state.groups.find(g => g.items.some(x => x.id === it.id));
      const item = group ? group.items.find(x => x.id === it.id) : null;
      if (item) openModal(item);
    };
    list.append(wrap);
  }
}

function renderSidebarCart() {
  const list = el('#sidebar-cart-list');
  const totalEl = el('#sidebar-cart-total');
  if (!list || !totalEl) return;
  list.innerHTML = '';
  let total = 0;
  for (const it of state.cart) {
    total += it.price * it.qty;
    const row = cel('div', 'sidebar-cart-row');
    row.textContent = `${it.name} x${it.qty}`;
    const price = cel('span');
    price.textContent = money(it.price) + ' ' + (it.currency || 'UAH');
    row.append(price);
    list.append(row);
  }
  totalEl.textContent = money(total);
}

el('#sidebar-telegram-btn') && (el('#sidebar-telegram-btn').onclick = async () => {
  if (!state.cart.length) return alert('Кошик порожній');
  // Тут можна додати інтеграцію з Telegram-ботом або виклик drawer/модалки для підтвердження
  el('#drawer') && openDrawer();
});

// --- Cart & Viewed: збереження у localStorage ---
function saveCart() {
  try { localStorage.setItem('cart', JSON.stringify(state.cart)); } catch {}
}
function loadCart() {
  try {
    const c = JSON.parse(localStorage.getItem('cart')||'[]');
    if (Array.isArray(c)) state.cart = c;
  } catch {}
}
function saveViewed() {
  try { localStorage.setItem('viewed', JSON.stringify(state.viewed)); } catch {}
}
function loadViewed() {
  try {
    const v = JSON.parse(localStorage.getItem('viewed')||'[]');
    if (Array.isArray(v)) state.viewed = v;
  } catch {}
}
// --- Підміняємо addToCart та addViewed ---
const origAddToCartPersist = addToCart;
addToCart = function(it, qty, price) {
  origAddToCartPersist(it, qty, price);
  saveCart();
};
const origAddViewedPersist = addViewed;
addViewed = function(item) {
  origAddViewedPersist(item);
  saveViewed();
};
// --- Відновлення при старті ---
window.addEventListener('DOMContentLoaded', () => {
  loadCart();
  loadViewed();
  renderSidebarCart();
  renderViewed();
});

// Додаємо додавання у viewed при відкритті модалки
const origOpenModal = openModal;
openModal = function(it, onClose) {
  addViewed(it);
  origOpenModal(it, onClose);
};

// --- Sidebar collapsible logic ---
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarCompactContent = document.querySelector('.sidebar-compact-content');
const sidebarExpandedContent = document.querySelector('.sidebar-expanded-content');

function setSidebarState(expanded) {
  if (!sidebar) return;
  if (expanded) {
    sidebar.classList.remove('sidebar-compact');
    sidebar.classList.add('sidebar-expanded');
    sidebarToggle.setAttribute('aria-label', 'Згорнути панель');
    sidebarToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" stroke="#a5afc1" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (sidebarExpandedContent) sidebarExpandedContent.style.display = 'block';
    if (sidebarCompactContent) sidebarCompactContent.style.display = 'none';
  } else {
    sidebar.classList.remove('sidebar-expanded');
    sidebar.classList.add('sidebar-compact');
    sidebarToggle.setAttribute('aria-label', 'Розгорнути панель');
    sidebarToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke="#a5afc1" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (sidebarExpandedContent) sidebarExpandedContent.style.display = 'none';
    if (sidebarCompactContent) sidebarCompactContent.style.display = 'block';
  }
}
if (sidebarToggle) {
  sidebarToggle.onclick = () => {
    setSidebarState(!sidebar.classList.contains('sidebar-expanded'));
  };
}
setSidebarState(false);

function renderSidebarCompactViewed() {
  const wrap = document.querySelector('.sidebar-compact-viewed');
  if (!wrap) return;
  wrap.innerHTML = '';
  const maxIcons = 5;
  for (let i = 0; i < maxIcons; ++i) {
    const it = state.viewed[i];
    if (it) {
      const thumb = document.createElement('div');
      thumb.className = 'viewed-thumb';
      thumb.style.width = '40px';
      thumb.style.height = '40px';
      thumb.style.borderRadius = '50%';
      thumb.style.overflow = 'hidden';
      thumb.style.background = '#222';
      thumb.style.cursor = 'pointer';
      thumb.style.display = 'flex';
      thumb.style.alignItems = 'center';
      thumb.style.justifyContent = 'center';
      thumb.style.boxShadow = '0 2px 8px #2c6dff33';
      const img = document.createElement('img');
      img.src = it.picture;
      img.alt = it.name;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      thumb.append(img);
      thumb.title = it.name;
      thumb.onclick = () => {
        const group = state.groups.find(g => g.items.some(x => x.id === it.id));
        const item = group ? group.items.find(x => x.id === it.id) : null;
        if (item) openModal(item);
      };
      wrap.append(thumb);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'viewed-thumb placeholder';
      wrap.append(placeholder);
    }
  }
}

function renderSidebarExpandedViewed() {
  const wrap = document.querySelector('.expanded-viewed-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const maxIcons = 10;
  for (let i = 0; i < maxIcons; ++i) {
    const it = state.viewed[i];
    const itemWrap = document.createElement('div');
    itemWrap.className = 'expanded-viewed-item';
    if (it) {
      const thumb = document.createElement('div');
      thumb.className = 'expanded-viewed-thumb';
      thumb.style.width = '60px';
      thumb.style.height = '60px';
      thumb.style.borderRadius = '12px';
      thumb.style.overflow = 'hidden';
      thumb.style.background = '#222';
      thumb.style.cursor = 'pointer';
      thumb.style.display = 'flex';
      thumb.style.alignItems = 'center';
      thumb.style.justifyContent = 'center';
      thumb.style.boxShadow = '0 2px 8px #2c6dff33';
      const img = document.createElement('img');
      img.src = it.picture;
      img.alt = it.name;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      thumb.append(img);
      thumb.title = it.name;
      thumb.onclick = () => {
        const group = state.groups.find(g => g.items.some(x => x.id === it.id));
        const item = group ? group.items.find(x => x.id === it.id) : null;
        if (item) openModal(item);
      };
      itemWrap.append(thumb);
      const name = document.createElement('div');
      name.className = 'expanded-viewed-name';
      name.textContent = it.name.length > 14 ? it.name.slice(0, 12) + '…' : it.name;
      itemWrap.append(name);
    } else {
      const thumb = document.createElement('div');
      thumb.className = 'expanded-viewed-thumb';
      itemWrap.append(thumb);
      const name = document.createElement('div');
      name.className = 'expanded-viewed-name';
      name.textContent = '';
      itemWrap.append(name);
    }
    wrap.append(itemWrap);
  }
}

window.addEventListener('DOMContentLoaded', renderSidebarExpandedViewed);
addViewed = (function(origAddViewed){
  return function(item) {
    origAddViewed(item);
    renderSidebarCompactViewed();
    renderSidebarExpandedViewed();
  };
})(addViewed);

function showConfirmModal(message, onOk, onCancel) {
  const modal = document.getElementById('confirm-modal');
  const msg = modal && modal.querySelector('.confirm-message');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  if (!modal || !msg || !okBtn || !cancelBtn) {
    alert('Помилка: confirm-modal не знайдено у DOM!');
    if (typeof onCancel === 'function') onCancel();
    return;
  }
  console.log('[DEBUG] showConfirmModal викликано:', message);
  msg.textContent = message;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    if (result && typeof onOk === 'function') onOk();
    if (!result && typeof onCancel === 'function') onCancel();
  }
  okBtn.onclick = () => close(true);
  cancelBtn.onclick = () => close(false);
}

function renderSidebarExpandedCart() {
  const list = document.querySelector('.expanded-cart-list');
  const totalEl = document.querySelector('.expanded-cart-total span');
  const tgBtn = document.querySelector('.expanded-cart-telegram-btn');
  if (!list || !totalEl || !tgBtn) return;
  list.innerHTML = '';
  let total = 0;
  state.cart.forEach((it, idx) => {
    total += it.price * it.qty;
    const row = document.createElement('div');
    row.className = 'expanded-cart-row';
    // №
    const num = document.createElement('span');
    num.className = 'cart-num';
    num.textContent = String(idx+1);
    row.append(num);
    // Фото
    const thumb = document.createElement('span');
    thumb.className = 'cart-thumb';
    if (it.picture) {
      const img = document.createElement('img');
      img.src = it.picture;
      img.alt = it.name;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      thumb.append(img);
    }
    row.append(thumb);
    // Назва
    const name = document.createElement('span');
    name.className = 'cart-name';
    name.textContent = it.name.length > 18 ? it.name.slice(0,16)+'…' : it.name;
    row.append(name);
    // Кількість (input/stepper)
    const qtyWrap = document.createElement('span');
    qtyWrap.className = 'cart-qty';
    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.className = 'qty-btn';
    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.className = 'qty-btn';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = it.qty;
    input.min = 0;
    let maxQty = 99;
    const group = state.groups.find(g => g.items.some(x => x.id === it.id));
    const item = group ? group.items.find(x => x.id === it.id) : null;
    if (item && typeof item.maxQty === 'number') maxQty = item.maxQty;
    input.max = maxQty;
    input.className = 'qty-input';
    let prevQty = it.qty;
    minus.onclick = () => {
      let v = Math.max(0, Number(input.value)-1);
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    plus.onclick = () => {
      let v = Math.min(maxQty, Number(input.value)+1);
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    input.onfocus = () => { prevQty = it.qty; };
    input.oninput = () => {
      let v = Math.max(0, Math.min(maxQty, Number(input.value)||0));
      input.value = v;
      if (v === 0) {
        if (confirm('Видалити товар з кошика?')) {
          state.cart.splice(idx, 1);
        } else {
          input.value = prevQty;
          it.qty = prevQty;
        }
      } else {
        it.qty = v;
      }
      renderSidebarExpandedCart();
      renderSidebarCart();
      updateCartBadge();
    };
    qtyWrap.append(minus, input, plus);
    row.append(qtyWrap);
    // Ціна
    const price = document.createElement('span');
    price.className = 'cart-price';
    price.textContent = money(it.price) + ' ' + (it.currency || 'UAH');
    row.append(price);
    list.append(row);
  });
  totalEl.textContent = money(total);
  tgBtn.disabled = !state.cart.length;
  tgBtn.style.cursor = state.cart.length ? 'pointer' : 'not-allowed';
  tgBtn.onclick = state.cart.length ? () => { alert('Передача замовлення в чат-бот (заглушка)'); } : null;
}

window.addEventListener('DOMContentLoaded', renderSidebarExpandedCart);
const origAddToCartSidebar = addToCart;
addToCart = function(it, qty, price) {
  origAddToCartSidebar(it, qty, price);
  renderSidebarExpandedCart();
  renderSidebarCart();
};
const origUpdateCartBadgeSidebar = updateCartBadge;
updateCartBadge = function() {
  origUpdateCartBadgeSidebar();
  renderSidebarExpandedCart();
  renderSidebarCart();
};

// --- Admin sidebar ---
async function showAdminSidebarIfAdmin() {
  const res = await fetch('/api/me');
  const j = await res.json();
  const btn = el('#sidebar-admin-toggle');
  if (j.profile === 'admin' || j.profile === 'admin_A' || j.profile === 'admin_B') {
    btn.classList.remove('hidden');
    btn.innerHTML = '<img src="/assets/Logo.png" alt="Logo" style="height:80px;max-width:220px;vertical-align:middle;border-radius:16px;box-shadow:0 2px 8px #0003;background:#fff;border:2px solid #eab308;padding:8px 24px;"> <span style="font-size:2rem;font-weight:700;color:#eab308;vertical-align:middle;margin-left:18px;">Адмін</span>';
    btn.style.background = '#fff';
    btn.style.border = '2px solid #eab308';
    btn.style.borderRadius = '16px';
    btn.style.boxShadow = '0 2px 8px #0003';
    btn.style.padding = '8px 24px';
    btn.style.cursor = 'pointer';
    btn.onclick = () => {
      el('#sidebar-admin').classList.toggle('expanded');
      el('#sidebar-admin').classList.toggle('hidden');
    };
    el('#sidebar-admin-close').onclick = () => {
      el('#sidebar-admin').classList.remove('expanded');
      el('#sidebar-admin').classList.add('hidden');
    };
    loadAdminUsers();
  } else {
    btn.classList.remove('hidden');
    btn.innerHTML = '<img src="/assets/Logo.png" alt="Logo" style="height:80px;max-width:220px;vertical-align:middle;border-radius:16px;box-shadow:0 2px 8px #0003;background:#fff;border:2px solid #eab308;padding:8px 24px;">';
    btn.style.background = '#fff';
    btn.style.border = '2px solid #eab308';
    btn.style.borderRadius = '16px';
    btn.style.boxShadow = '0 2px 8px #0003';
    btn.style.padding = '8px 24px';
    btn.style.cursor = 'pointer';
    btn.onclick = null;
  }
}
// --- Admin sidebar: ціни для користувачів за артикулом ---
let adminFeedPrices = null;
let adminPartnerBPrices = null;
async function loadAdminFeedPrices() {
  if (adminFeedPrices && adminPartnerBPrices) return;
  // Парсимо feed.xml (тільки vendorCode + price)
  const res = await fetch('/data/feed.xml');
  const text = await res.text();
  const vendorPrice = {};
  const vendorRe = /<vendorCode>(\d+)<\/vendorCode>[\s\S]*?<price>([\d\.]+)<\/price>/g;
  let m;
  while ((m = vendorRe.exec(text))) {
    vendorPrice[m[1]] = parseFloat(m[2]);
  }
  adminFeedPrices = vendorPrice;
  // partner-b-prices.json
  const resB = await fetch('/data/partner-b-prices.json');
  adminPartnerBPrices = {};
  try {
    const arr = await resB.json();
    for (const it of arr) adminPartnerBPrices[String(it.article)] = it.price;
  } catch {}
}
function getUserPriceByArticle(role, article) {
  if (!adminFeedPrices) return '';
  const art = String(article).trim();
  if (!art) return '';
  if (role === 'partner_B') {
    if (adminPartnerBPrices && adminPartnerBPrices[art] != null) return adminPartnerBPrices[art];
    if (adminFeedPrices[art] != null) return adminFeedPrices[art];
    return '';
  }
  if (role === 'partner_A') {
    if (adminFeedPrices[art] != null) return Math.round(adminFeedPrices[art]*0.85*100)/100;
    return '';
  }
  // user, admin, guest
  if (adminFeedPrices[art] != null) return adminFeedPrices[art];
  return '';
}
// ---
const adminArticleInput = document.getElementById('admin-article-search');
if (adminArticleInput) {
  adminArticleInput.addEventListener('input', async function() {
    await loadAdminFeedPrices();
    loadAdminUsers();
  });
}
async function loadAdminUsers() {
  const res = await fetch('/api/admin/users');
  const users = await res.json();
  const tbody = el('#admin-users-table tbody');
  tbody.innerHTML = '';
  const art = (el('#admin-article-search') && el('#admin-article-search').value.trim()) || '';
  for (const u of users) {
    const tr = document.createElement('tr');
    // Name
    const tdName = document.createElement('td');
    const inpName = document.createElement('input');
    inpName.value = u.name || '';
    tdName.append(inpName);
    tr.append(tdName);
    // Role
    const tdRole = document.createElement('td');
    const selRole = document.createElement('select');
    // Додаємо всі ролі
    ['admin','admin_A','admin_B','partner_A','partner_B','user'].forEach(r => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      if (u.role === r) opt.selected = true;
      selRole.append(opt);
    });
    // Якщо це поточний користувач — блокуємо селектор ролі
    if (state.profile && u.role === state.profile && u.phone === (window.mePhone||'') ) {
      selRole.disabled = true;
    }
    tdRole.append(selRole);
    tr.append(tdRole);
    // Status
    const tdStatus = document.createElement('td');
    const selStatus = document.createElement('select');
    ['active','inactive'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (u.status === s) opt.selected = true;
      selStatus.append(opt);
    });
    tdStatus.append(selStatus);
    tr.append(tdStatus);
    // --- Ціна ---
    const tdPrice = document.createElement('td');
    let price = '';
    if (art) price = getUserPriceByArticle(selRole.value, art);
    tdPrice.textContent = price ? price + ' грн' : '—';
    tr.append(tdPrice);
    // Save btn
    const tdSave = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = 'Зберегти';
    btn.onclick = async () => {
      btn.disabled = true;
      await fetch('/api/admin/users/' + u.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inpName.value, role: selRole.value, status: selStatus.value })
      });
      btn.disabled = false;
      loadAdminUsers();
    };
    tdSave.append(btn);
    tr.append(tdSave);
    tbody.append(tr);
  }
}
window.addEventListener('DOMContentLoaded', showAdminSidebarIfAdmin);

// --- Admin: перемикач ролі та статусу для перегляду цін + збереження у localStorage ---
const adminRoleSelect = document.getElementById('admin-role-select');
const adminStatusSelect = document.getElementById('admin-status-select');
if (adminRoleSelect) {
  // Якщо роль admin, admin_A або admin_B — приховати селектор ролі
  const meRole = state.profile;
  if (meRole === 'admin' || meRole === 'admin_A' || meRole === 'admin_B') {
    adminRoleSelect.style.display = 'none';
  } else {
    // Відновити вибір з localStorage
    const savedRole = localStorage.getItem('adminRoleSelect');
    if (savedRole) {
      adminRoleSelect.value = savedRole;
      state.profile = savedRole;
    }
    adminRoleSelect.addEventListener('change', function() {
      state.profile = this.value;
      localStorage.setItem('adminRoleSelect', this.value);
      render();
    });
  }
}
if (adminStatusSelect) {
  // Відновити вибір з localStorage
  const savedStatus = localStorage.getItem('adminStatusSelect');
  if (savedStatus) {
    adminStatusSelect.value = savedStatus;
    state.profileStatus = savedStatus;
  } else {
    state.profileStatus = adminStatusSelect.value;
  }
  adminStatusSelect.addEventListener('change', function() {
    state.profileStatus = this.value;
    localStorage.setItem('adminStatusSelect', this.value);
    render();
  });
}

// --- Заглушка для showSearchGroup, щоб уникнути помилки ---
function showSearchGroup() {}
