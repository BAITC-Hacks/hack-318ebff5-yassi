let state = {tasks: [], teams: [], proposals: [], fields: []};
let role = 'guest';
let filters = {search: '', category: '', level: '', sort: 'rating', tab: 'all'};
const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories = ['Сауда', 'Білім', 'Экология', 'Қаржы', 'Денсаулық', 'Басқа'];
const statuses = {pending: 'Қаралуда', accepted: 'Таңдалды', rejected: 'Қабылданбады'};
let returnFocus;

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервер жауабы дұрыс емес. Қайта көріңіз.'); }
  if (!response.ok) throw new Error(data.error || 'Сервер қатесі.');
  return data;
}
async function refresh() { state = await api('state'); role = state.user?.role || 'guest'; render(); }
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500); }
function showModal(title, body) {
  if (modal.hidden) returnFocus = document.activeElement;
  modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${title}</h2><button class="close" aria-label="Жабу">×</button></div><div class="modal-body">${body}</div></section>`;
  modal.hidden = false; document.body.style.overflow = 'hidden';
  modal.querySelector('.close').onclick = closeModal;
  modal.querySelector('input,textarea,button,select')?.focus();
}
function closeModal() { modal.hidden = true; document.body.style.overflow = ''; returnFocus?.focus(); }
modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
document.addEventListener('keydown', e => {
  if(modal.hidden) return;
  if(e.key === 'Escape') closeModal();
  if(e.key === 'Tab') {
    const items = [...modal.querySelectorAll('button,input,textarea,select,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if(e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
function heading(title, subtitle, action = true) { return `<div class="heading-row"><div><div class="eyebrow">МҮМКІНДІКТЕР ОСЫ ЖЕРДЕН БАСТАЛАДЫ</div><h1>${title}</h1><p class="subheading">${subtitle}</p></div>${action && role === 'business' ? '<button class="btn btn-primary" data-create><span>＋</span> Тапсырма қосу</button>' : ''}</div>`; }
function bindCreate() { document.querySelectorAll('[data-create]').forEach(el => el.onclick = () => createTask()); }
function render() {
  const page = location.hash.slice(1) || 'catalog';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
  document.querySelector('#crumb').textContent = {catalog:'Каталог', mine:'Менің тапсырмаларым', proposals:'Ұсыныстар', teams:'Командалар', profile:'Менің профилім'}[page] || 'Каталог';
  document.querySelector('#proposal-count').textContent = state.proposals.filter(p => p.status === 'pending').length;
  renderAccountBar();
  document.querySelector('.sidebar-create').hidden = role !== 'business';
  if(page === 'profile') renderProfile(); else if(page === 'mine') renderMine(); else if(page === 'proposals') renderProposals(); else if(page === 'teams') renderTeams(); else renderCatalog();
  bindCreate();
}
function taskCard(t) {
  const count = state.proposals.filter(p => p.task_id === t.id).length;
  return `<article class="task-card">${taskImage(t)}<div class="card-top"><span class="category">${esc(t.category)}</span><span class="card-status ${t.score < 40 ? 'low' : ''}">${t.published ? esc(t.level) : 'Жарияланбаған'}</span></div><h3>${esc(t.title)}</h3><p class="card-desc">${esc(t.context)}</p><div class="company-row"><span class="company-icon">${esc(t.company.slice(0,1))}</span>${esc(t.company)}<span>·</span><span>Бизнес тапсырмасы</span></div><div class="rating-row"><div class="rating-info"><div class="rating-caption"><span>Тапсырманың дайындық деңгейі</span><b>${t.score}<span style="font-weight:400;color:#a4ac99"> / 100</span></b></div><div class="progress"><span style="width:${t.score}%"></span></div></div></div><div class="card-bottom"><span>♧ &nbsp; ${count} ұсыныс</span><button class="card-link" data-detail="${t.id}">Толығырақ <span>↗</span></button></div></article>`;
}
function bindDetails() { main.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => detail(Number(el.dataset.detail))); }
function renderCatalog() {
  const published = state.tasks.filter(t => t.published);
  main.innerHTML = heading('Тапсырмалар каталогы', 'Бизнеске шешім. Студентке тәжірибе. Ортақ мақсатқа алғашқы қадам.') +
  `<section class="hero"><div class="hero-text"><div class="hero-tag"><span></span> НАҒЫЗ МӘСЕЛЕЛЕР. НАҒЫЗ МҮМКІНДІКТЕР.</div><h2>Бүгінгі идея —<br>ертеңгі үлкен өзгеріс.</h2><p>Өзіңізге жақын тапсырманы табыңыз, командамен бірігіп,<br>бизнеске пайдалы шешім жасаңыз.</p></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="orbit three"></div><div class="art-star">✳</div><div class="float-label"><b>↗</b> Идеядан нәтижеге</div><div class="float-label bottom"><b>✦</b> Бірге мықтымыз</div></div></section>
  <section class="stats" aria-label="Платформа статистикасы"><div class="stat"><div class="stat-top">Ашық тапсырма <span>▦</span></div><div class="stat-value">${String(published.length).padStart(2,'0')} <small>жұмысқа шақырады</small></div></div><div class="stat"><div class="stat-top">Белсенді команда <span>♧</span></div><div class="stat-value">${String(state.teams.length).padStart(2,'0')} <small>жаңа көзқарас</small></div></div><div class="stat"><div class="stat-top">Жіберілген ұсыныс <span>↗</span></div><div class="stat-value">${String(state.proposals.length).padStart(2,'0')} <small>алғашқы қадам</small></div></div><div class="stat"><div class="stat-top">Жұмысқа дайын <span>✧</span></div><div class="stat-value">${String(published.filter(t=>t.score>=70).length).padStart(2,'0')} <small>70+ рейтинг</small></div></div></section>
  <div class="catalog-top"><div class="tabs"><button class="tab ${filters.tab==='all'?'active':''}" data-tab="all">Барлық тапсырма <span>${published.length}</span></button><button class="tab ${filters.tab==='recommended'?'active':''}" data-tab="recommended">Ұсынылған <span>${published.filter(t=>t.score>=40).length}</span></button></div><select class="sort" id="sort" aria-label="Сұрыптау"><option value="rating">↓ Рейтинг бойынша</option><option value="new">↓ Жаңалығы бойынша</option></select></div>
  <div class="filters"><label class="search"><span>⌕</span><input id="search" aria-label="Тапсырманы іздеу" placeholder="Тапсырма, ұйым немесе кілт сөз іздеу..." value="${esc(filters.search)}"></label><select id="category" aria-label="Тақырып"><option value="">Барлық бағыт</option>${categories.map(c=>`<option>${c}</option>`).join('')}</select><select id="level" aria-label="Дайындық деңгейі"><option value="">Дайындық деңгейі</option><option value="draft">Алғашқы нұсқа · 0–39</option><option value="working">Жұмысқа жарамды · 40–69</option><option value="ready">Дайын · 70–89</option><option value="priority">Басымдық · 90–100</option></select></div><div class="results-meta"><span id="result-count"></span><span>Әр тапсырма — жаңа тәжірибе</span></div><div class="cards" id="task-grid"></div><p class="catalog-note"><span>ⓘ</span> Рейтинг тапсырманың толықтығын көрсетеді. Таңдау әрқашан сіздің қолыңызда.</p>`;
  ['sort','category','level'].forEach(key => { document.getElementById(key).value = filters[key]; document.getElementById(key).onchange = e => {filters[key] = e.target.value; updateCards();}; });
  document.querySelector('#search').oninput = e => { filters.search=e.target.value; updateCards(); };
  main.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{filters.tab=el.dataset.tab;renderCatalog();bindCreate();});
  updateCards();
}
function updateCards() {
  let tasks = state.tasks.filter(t => t.published);
  if(filters.tab === 'recommended') tasks=tasks.filter(t=>t.score>=40);
  if(filters.search) tasks=tasks.filter(t=>(t.title+' '+t.context+' '+t.company).toLocaleLowerCase().includes(filters.search.toLocaleLowerCase()));
  if(filters.category) tasks=tasks.filter(t=>t.category===filters.category);
  if(filters.level) tasks=tasks.filter(t=>filters.level==='draft'?t.score<40:filters.level==='working'?t.score>=40&&t.score<70:filters.level==='ready'?t.score>=70&&t.score<90:t.score>=90);
  tasks.sort((a,b)=>filters.sort==='new'?b.id-a.id:b.score-a.score || b.id-a.id);
  document.querySelector('#result-count').innerHTML=`<strong>${tasks.length} тапсырма</strong> табылды${filters.tab==='recommended'?' · Дайындығы 40 ұпайдан жоғары':''}`;
  document.querySelector('#task-grid').innerHTML=tasks.map(taskCard).join('') || '<div class="empty">Тапсырма табылмады.<br>Іздеу сөзін немесе сүзгілерді өзгертіп көріңіз.</div>';
  bindDetails();
}
function renderMine() {
  if (!state.user) return renderGuestPage();
  main.innerHTML=heading('Менің тапсырмаларым','Идеяларыңыз бен жарияланымдарыңыз бір жерде.')+`<div class="cards section-spacing">${state.tasks.filter(t=>t.owner_id===state.user.id).map(taskCard).join('') || '<div class="empty">Әзірге тапсырма жоқ. Алғашқы идеяңызды бөлісіңіз.</div>'}</div>`;
  bindDetails();
}
function renderTeams() {
  main.innerHTML=heading('Жаңа буын. Жаңа шешімдер.','Қызығушылықтары ортақ командалармен танысыңыз.',false)+`<div class="cards section-spacing">${state.teams.map(t=>`<article class="team-card">${avatarMarkup(t, "team-avatar")}<h3>${esc(t.name)}</h3><span class="category">${esc(t.interests)}</span><p>${esc(t.skills)}</p><div class="points">✦ ${t.points || 0} ұпай <span style="color:#9ba58e">· расталған кезеңдер үшін</span></div></article>`).join('')}</div>`;
}
function proposalCard(p, includeTask=false) {
  const team=state.teams.find(t=>t.id===p.team_id), task=state.tasks.find(t=>t.id===p.task_id);
  return `<article class="proposal"><div class="card-top"><h3>${esc(team?.name)}</h3><span class="status-chip ${p.status}">${statuses[p.status]}</span></div>${includeTask?`<div class="category">${esc(task?.title)}</div>`:''}<p>${esc(p.idea)}</p><p>${esc(p.plan)}</p><div class="meta"><span>◷ ${esc(p.deadline)}</span><span>${esc(team?.skills)}</span>${/^https?:\/\//.test(p.link)?`<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">Прототип ↗</a>`:''}</div>${state.user && task?.owner_id===state.user.id?`<div class="actions">${p.status!=='accepted'?`<button class="btn btn-sm btn-dark" data-decision="accepted" data-id="${p.id}">Команданы таңдау</button>`:''}${p.status!=='rejected'?`<button class="btn btn-sm" data-decision="rejected" data-id="${p.id}">Қабылдамау</button>`:''}${p.status==='accepted'?`<button class="btn btn-sm" data-milestone="${p.id}" ${p.milestone?'disabled':''}>${p.milestone?'✓ Кезең расталды · +25 ұпай':'Кезеңді растау · +25 ұпай'}</button>`:''}</div>`:p.milestone?'<p>✓ Кезең расталды · +25 ұпай</p>':''}</article>`;
}
function bindProposals(root, taskId) {
  root.querySelectorAll('[data-decision]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try { await api('decision',{id:Number(button.dataset.id),status:button.dataset.decision}); await refresh(); if(taskId) detail(taskId); toast('Шешім сақталды.'); } catch(e) {toast(e.message);button.disabled=false;}
  });
  root.querySelectorAll('[data-milestone]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try {await api('milestone',{id:Number(button.dataset.milestone)});await refresh();if(taskId) detail(taskId);toast('Кезең расталды. Командаға 25 ұпай берілді.');}catch(e){toast(e.message);button.disabled=false;}
  });
}
function renderProposals() {
  if (!state.user) return renderGuestPage();
  main.innerHTML=heading('Ұсыныстан серіктестікке','Командалардың идеяларын салыстырып, бірге жұмыс істейтін серіктесіңізді таңдаңыз.',false)+`<div class="hint section-spacing">Бір немесе бірнеше команданы таңдауға болады. Жүйе орындаушыны автоматты түрде тағайындамайды.</div>${state.proposals.map(p=>proposalCard(p,true)).join('') || '<div class="empty">Әзірге ұсыныс жоқ.</div>'}`;
  bindProposals(main);
}
function scoreBox(t) {return `<aside class="score-box"><div class="eyebrow">ДАЙЫНДЫҚ РЕЙТИНГІ</div><div class="score-big">${t.score}<small> / 100</small></div><p class="card-status ${t.score<40?'low':''}">${esc(t.level)}</p>${t.breakdown.map(r=>`<div class="score-line ${r.points?'':'missing'}"><span>${esc(r.label)}</span><span>${r.points} / ${r.max}</span></div>`).join('')}<p style="font-size:10px;color:#939e83;line-height:1.8">${t.missing.length?'Ұпайды арттыру үшін жетіспейтін өрістерді толтырып, мәліметтерді растаңыз.':'Барлық бөлім толтырылып, расталған. Тапсырма жұмысқа дайын.'}</p></aside>`;}
function detail(id) {
  const t=state.tasks.find(t=>t.id===id); if(!t) return;
  const proposals=state.proposals.filter(p=>p.task_id===id);
  showModal('Тапсырма туралы',`${taskImage(t, true)}<span class="category">${esc(t.category)}</span><h3 class="detail-title">${esc(t.title)}</h3><div class="company-row">${esc(t.company)} · ${t.published?'Каталогта жарияланған':'Жарияланбаған'}</div><div class="detail-layout"><div>${state.fields.map(([key,label])=>`<div class="detail-field"><h4>${esc(label)}</h4><p>${esc(t[key]) || 'Әзірге көрсетілмеген'}</p></div>`).join('')}</div>${scoreBox(t)}</div><div class="actions">${state.user && t.owner_id===state.user.id?'<button class="btn btn-primary" id="edit-task">Карточканы толықтыру ↗</button>':t.published && role!=='business'?'<button class="btn btn-primary" id="send-proposal">Ұсыныс жіберу ↗</button>':''}</div><div class="section-spacing"><h3>Команда ұсыныстары <span class="category">${proposals.length}</span></h3>${proposals.map(p=>proposalCard(p)).join('') || '<p class="subheading">Алғашқы ұсынысты күтеміз.</p>'}</div>`);
  modal.querySelector('#edit-task')?.addEventListener('click',()=>editTask(t));
  modal.querySelector('#send-proposal')?.addEventListener('click',()=>proposalForm(t));
  bindProposals(modal,id);
}
function inputField(name,label,value='',placeholder='',type='text') {return `<label class="field">${label}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" type="${type}" required maxlength="1000"></label>`;}
function createTask() {
  if(!state.user) return authForm('register');
  if(role!=='business') {toast('Тапсырма қосу үшін «Бизнес өкілі» рөлін таңдаңыз.');return;}
  showModal('Идеяңыз неден басталады?',`<div class="steps"><strong>01 · Сипаттау</strong><span>02 · Нақтылау</span><span>03 · Жариялау</span></div><div class="hint">✧ Өз сөзіңізбен жазыңыз. Көмекші тапсырманы толықтыруға қажетті сұрақтарды ұсынады.</div><form id="draft-form"><div class="form-grid">${inputField('title','Тапсырма атауы','','Мысалы: Клиенттерге AI көмекші')}${inputField('company','Ұйым атауы','','Компанияңыздың атауы')}</div><label class="field">Бағыт<select name="category">${categories.map(c=>`<option>${c}</option>`).join('')}</select></label><label class="field">Қандай мәселені шешкіңіз келеді?<textarea name="description" required minlength="10" maxlength="10000" rows="5" placeholder="Қазір не болып жатыр? Нені жақсартқыңыз келеді?"></textarea></label><p class="error" id="form-error" role="alert"></p><div class="actions"><span style="font-size:10px;color:#89957a">Жергілікті демо көмекші</span><button class="btn btn-primary" type="submit">Нақтылаушы сұрақтар алу ✧</button></div></form>`);
  modal.querySelector('#draft-form').onsubmit=async e=>{
    e.preventDefault(); const form=e.target, data=Object.fromEntries(new FormData(form));const button=form.querySelector('button[type=submit]');button.disabled=true;
    try {
      const answer=await api('assist',{description:data.description});
      if(!Array.isArray(answer.questions)||answer.questions.length<3||typeof answer.context!=='string') throw new Error('Көмекші жауабы жарамсыз. Қайта көріңіз.');
      editTask({...data, context:answer.context,original:data.description},answer.questions);
    }catch(error){modal.querySelector('#form-error').textContent=error.message;button.disabled=false;}
  };
}
function editTask(t, questions) {
  const questionMap=Object.fromEntries((questions || []).map(q=>[q.field,q.question]));
  showModal(t.id?'Тапсырманы толықтыру':'Сипаттамадан толық карточкаға',`<div class="steps"><span>01 · Сипаттау</span><strong>02 · Нақтылау</strong><span>03 · Жариялау</span></div><div class="hint">${questions?'✧ Демо көмекші 6 нақтылаушы сұрақ дайындады. Білетін ақпаратыңызды енгізіңіз; қалғанын кейін толықтыра аласыз.':'Мәліметтерді толықтырған сайын рейтинг өседі. Өзгерістерді сақтар алдында қайта растаңыз.'}</div><form id="task-form">${imagePicker(t.image, 'Тапсырма суреті')}<div class="form-grid">${inputField('title','Тапсырма атауы',t.title)}${inputField('company','Ұйым атауы',t.company)}</div><label class="field">Бағыт<select name="category">${categories.map(c=>`<option ${c===t.category?'selected':''}>${c}</option>`).join('')}</select></label><div class="form-grid">${state.fields.map(([key,label,weight])=>`<label class="field ${key==='context'?'wide':''}">${esc(label)} · ${weight} ұпай${questionMap[key]?`<small>${esc(questionMap[key])}</small>`:''}<textarea name="${key}" maxlength="10000" ${key==='context'?'required minlength="10"':''} placeholder="${esc(questionMap[key]||label)}">${esc(t[key])}</textarea></label>`).join('')}</div><div class="hint" id="preview-score"></div><label class="confirm"><input type="checkbox" name="confirmed"> <span>Мәліметтерді тексердім және олардың дұрыстығын растаймын. Тек расталған өрістерге ұпай берілетінін түсінемін.</span></label><p class="error" id="form-error" role="alert"></p><div class="actions"><button class="btn" type="submit" value="draft">Жарияламай сақтау</button><button class="btn btn-primary" type="submit" value="publish">${t.published?'Өзгерістерді жариялау':'Каталогқа жариялау'} ↗</button></div></form>`);
  const form=modal.querySelector('#task-form');
  const imageState = bindImagePicker(form, t.image || '');
  const preview=()=>{const d=Object.fromEntries(new FormData(form));const score=state.fields.reduce((s,[key,,weight])=>s+(d[key]?.trim()?weight:0),0);modal.querySelector('#preview-score').textContent=`${d.confirmed?'Расталған рейтинг':'Растағаннан кейінгі рейтинг'}: ${score} / 100. ${score===100?'Карточка толық!':'Қосымша мәліметтер дайындық деңгейін арттырады.'}`;};
  form.oninput=preview;preview();
  form.onsubmit=async e=>{
    e.preventDefault(); if(imageState.loading) return; const data=Object.fromEntries(new FormData(form)); delete data.picture; const published=e.submitter?.value==='publish';
    if(published&&!data.confirmed){modal.querySelector('#form-error').textContent='Жариялау үшін мәліметтердің дұрыстығын растаңыз.';return;}
    const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{const saved=await api('tasks',{...data,id:t.id,image:imageState.value,original:t.original||t.context,confirmed:!!data.confirmed,published});await refresh();detail(saved.id);toast(published?'Тапсырма каталогта жарияланды!':'Алғашқы нұсқа сақталды.');}catch(error){modal.querySelector('#form-error').textContent=error.message;buttons.forEach(b=>b.disabled=false);}
  };
}
function proposalForm(t) {
  if (!state.user) return authForm('login');
  showModal('Ұсынысыңызды бөлісіңіз',`<div class="hint">${esc(t.title)}<br>Команданы бизнес өкілі өзі таңдайды. Ұсыныстар саны шектелмейді.</div><form id="proposal-form"><label class="field">Команда<select name="team_id">${state.teams.filter(team=>team.id===state.user.team_id).map(team=>`<option value="${team.id}">${esc(team.name)}</option>`).join('')}</select></label><label class="field">Шешім идеясы<textarea name="idea" required maxlength="10000" placeholder="Қандай шешім ұсынасыз?"></textarea></label><label class="field">Жұмыс жоспары<textarea name="plan" required maxlength="10000" placeholder="Негізгі кезеңдеріңізді сипаттаңыз"></textarea></label><div class="form-grid">${inputField('deadline','Орындау мерзімі','','Мысалы: 2 апта')}${inputField('link','Прототипке сілтеме','','https://…','url')}</div><p class="error" id="form-error" role="alert"></p><div class="actions"><button class="btn btn-primary" type="submit">Ұсыныс жіберу ↗</button></div></form>`);
  modal.querySelector('#proposal-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;const data=Object.fromEntries(new FormData(e.target));try{await api('proposals',{...data,team_id:Number(data.team_id),task_id:t.id});await refresh();detail(t.id);toast('Ұсынысыңыз жіберілді. Бизнес шешімін күтіңіз.');}catch(error){modal.querySelector('#form-error').textContent=error.message;button.disabled=false;}};
}
window.addEventListener('hashchange',render);
main.innerHTML='<div class="loading">Жұмыс кеңістігі жүктелуде…</div>';
refresh().catch(error=>{main.innerHTML=`<div class="empty">Деректерді жүктеу мүмкін болмады.<br>${esc(error.message)}<br><button class="btn section-spacing" onclick="location.reload()">Қайта жүктеу</button></div>`;});
