// Serverless API. The build injects the shared functions, seed data and assets.
const schema = [
 `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,profile TEXT NOT NULL DEFAULT '{}')`,
 `CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER)`,
 `CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,owner INTEGER REFERENCES users(id),status TEXT NOT NULL DEFAULT 'draft',body TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP)`,
 `CREATE TABLE IF NOT EXISTS proposals(id INTEGER PRIMARY KEY,task_id INTEGER REFERENCES tasks(id),user_id INTEGER REFERENCES users(id),body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created TEXT DEFAULT CURRENT_TIMESTAMP)`,
 `CREATE TABLE IF NOT EXISTS progress(user_id INTEGER REFERENCES users(id),lesson TEXT,PRIMARY KEY(user_id,lesson))`,
 `CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,started INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner)`,
 `CREATE INDEX IF NOT EXISTS idx_proposals_task ON proposals(task_id)`,
 `CREATE INDEX IF NOT EXISTS idx_proposals_user ON proposals(user_id)`
];
const hex = b => [...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
const bytes = h => Uint8Array.from(h.match(/../g),n=>parseInt(n,16));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
async function passwordHash(password, salt=hex(crypto.getRandomValues(new Uint8Array(16)))) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const result=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:100000},key,256);
 return salt+':'+hex(result);
}
async function passwordMatches(password,stored){
 const derived=await passwordHash(password,stored.split(':')[0]);
 if(derived.length!==stored.length)return false;
 let diff=0;for(let i=0;i<derived.length;i++)diff|=derived.charCodeAt(i)^stored.charCodeAt(i);
 return diff===0;
}
const clean = (s,max=6000) => String(s??'').trim().slice(0,max);
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
const one = (db,sql,...args) => db.prepare(sql).bind(...args).first();
const all = async (db,sql,...args) => (await db.prepare(sql).bind(...args).all()).results;
const run = (db,sql,...args) => db.prepare(sql).bind(...args).run();
function userView(row){if(!row)return null;const {password,...u}=row;return {...u,profile:JSON.parse(u.profile)};}
function taskBody(b){const out={};for(const [k]of fields)out[k]=clean(b[k]);for(const k of ['topic','type','company','deadline'])out[k]=clean(b[k],120);if(!['standard','expert','project'].includes(out.type))out.type='standard';return out;}
async function taskView(db,row){const body=JSON.parse(row.body);return {...body,id:row.id,owner:row.owner,status:row.status,created:row.created,rating:rating(body),proposalCount:(await one(db,'SELECT COUNT(*) n FROM proposals WHERE task_id=?',row.id)).n};}
let ready;
async function init(db){
 if(!db)fail(503,'Онлайн база дайындалып жатыр. Сәл кейін қайталаңыз.');
 if(!ready)ready=(async()=>{
  await db.batch(schema.map(sql=>db.prepare(sql)));
  if(await one(db,'SELECT id FROM users LIMIT 1'))return;
  const records=[['Айдана','business@naqty.demo','business',{age:24,level:'intermediate',started:'yes',onboarded:true,company:'Aru Store'}],...[
   ['Qadam Team','team@naqty.demo','JavaScript, Python, Figma','Сауда, Білім'],
   ['Nomad Lab','nomad@naqty.demo','React, SQL, UX','Логистика'],
   ['Jas Digital','jas@naqty.demo','Figma, Marketing','Маркетинг'],
   ['Bolashaq','bolashaq@naqty.demo','Node.js, Python','Білім']
  ].map(([name,email,skills,interests])=>[name,email,'team',{age:20,level:'beginner',started:'no',onboarded:true,team:name,skills,interests}])];
  const statements=records.map(([name,email,role,profile],i)=>db.prepare('INSERT OR IGNORE INTO users(id,name,email,password,role,profile) VALUES(?,?,?,?,?,?)').bind(i+1,name,email,DEMO_HASH,role,JSON.stringify(profile)));
  seedTasks.forEach(([title,topic,type,company,context,need],i)=>{
   const body={title,topic,type,company,context,need,users:'Күн сайын қызмет көрсететін 5 менеджер және 100 тұрақты клиент.',data:i===7?'':'Анонимденген 300 тапсырыс бар CSV файлы және қазіргі жұмыс процесінің 5 мысалы.',constraints:'4 апта ішінде; жеке деректерді қолданбау; браузерде жұмыс істеуі керек.',result:'Тест деректерімен жұмыс істейтін интерактивті прототип және іске қосу нұсқаулығы.',success:i===6?'Жұмыс ыңғайлы болуы керек':'Есеп дайындау уақытын 60 минуттан 10 минутқа дейін қысқарту; 5 пайдаланушы тесті.',contact:'business@naqty.demo',interaction:i===4?'':'Аптасына бір рет 30 минут онлайн кездесу, сұрақтарға 2 жұмыс күнінде жауап.',deadline:'4 апта'};
   statements.push(db.prepare('INSERT OR IGNORE INTO tasks(id,owner,status,body) VALUES(?,?,?,?)').bind(i+1,1,'published',JSON.stringify(body)));
  });
  for(let i=0;i<6;i++)statements.push(db.prepare('INSERT OR IGNORE INTO proposals(id,task_id,user_id,body) VALUES(?,?,?,?)').bind(i+1,i<3?1:i+1,2+i%4,JSON.stringify({idea:'Сатылым деректерін бір панельге біріктіріп, негізгі көрсеткіштерді автоматты есептейтін прототип ұсынамыз.',plan:'1-апта: сұхбат және талаптар. 2-апта: дизайн. 3-апта: әзірлеу. 4-апта: тест және таныстыру.',duration:'4 апта',link:'https://example.com',demo:true})));
  await db.batch(statements);
 })().catch(e=>{ready=undefined;throw e;});
 return ready;
}
function assistantAnswer(q){
 if(/салық|налог|кіріс|шығын|ақша|қаржы/.test(q))return 'Қаржыны есептеу үшін айлық кіріс, операциялық шығын, комиссия және өзіңізге қолданылатын салық мөлшерлемесін енгізіңіз. «Қаржы калькуляторы» таза пайда мен маржаны есептейді. Бұл сіз енгізетін сценарий, заңдық салық кеңесі емес.';
 if(/рейтинг|тапсырма|задач|карточ/.test(q))return 'Карточка 10 өріс бойынша бағаланады: контекст пен қажеттілікке 15 балдан, деректерге 15, аудиторияға 10, шектеулерге 10, нәтижеге 10, өлшемдерге 10, атауға 5, контактқа 5 және кері байланысқа 5. Нақты санмен өлшенетін критерий қосыңыз: мысалы, өңдеу уақытын 30%-ға қысқарту. Рейтинг мәтіннің толықтығын бағалайды, бизнес табысын болжамайды.';
 if(/команда|ұсыныс|отклик/.test(q))return 'Барлық жарияланған тапсырмалар барлық командаға ашық. Ұсыныста шешім идеясы, кезеңдік жоспар, мерзім және прототип сілтемесі болуы керек. Бизнес бір немесе бірнеше команданы таңдай алады, не ешқайсысын таңдамауы мүмкін. Автоматты тағайындау жоқ.';
 return 'Идеяңызды нақтылау үшін:\n1. Шешкіңіз келетін бір мәселені атаңыз.\n2. Осы мәселесі бар 5 адаммен сұхбат өткізіңіз.\n3. Бір аптада тексерілетін прототип және өлшенетін нәтиже таңдаңыз.\n\nҚай бизнес немесе аудитория туралы айтып отырсыз?';
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN'};
  const json=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
  try{
   if(!path.startsWith('/api/')){
    const asset=ASSETS[path==='/'?'/index.html':path];
    if(!asset)return new Response('Not found',{status:404,headers});
    return new Response(method==='HEAD'?null:asset.body,{headers:{...headers,'Content-Type':asset.type,'Cache-Control':'no-cache'}});
   }
   if(path==='/api/config'&&method==='GET')return json(200,{assistantMode:env.GEMINI_API_KEY?'gemini':'local-rules'});
   const db=env.DB;await init(db);let b={};
   if(['POST','PATCH','DELETE'].includes(method)){
    const origin=request.headers.get('Origin');if(origin&&new URL(origin).host!==url.host)fail(403,'Қолжетімділік жоқ');
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'JSON қажет');
    if(Number(request.headers.get('Content-Length'))>100000)fail(413,'Мәтін тым үлкен');
    const raw=await request.text();if(raw.length>100000)fail(413,'Мәтін тым үлкен');
    try{b=raw?JSON.parse(raw):{};if(!b||Array.isArray(b)||typeof b!=='object')throw 0;}catch{fail(400,'Қате JSON');}
   }
   const token=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('naqty_session='))?.split('=')[1];
   const session=token?await one(db,'SELECT user_id FROM sessions WHERE token=? AND expires>?',token,Date.now()):null;
   const user=session?userView(await one(db,'SELECT * FROM users WHERE id=?',session.user_id)):null;
   const needUser=()=>{if(!user)fail(401,'Алдымен жүйеге кіріңіз');};
   const role=r=>{needUser();if(user.role!==r)fail(403,'Бұл әрекетке рұқсат жоқ');};
   if(path==='/api/me'&&method==='GET')return json(200,{user});
   if(['/api/register','/api/login'].includes(path)&&method==='POST'){
    const email=clean(b.email,254).toLowerCase(),password=String(b.password||'');
    if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||password.length>200)fail(400,'Email және кемінде 8 таңбалы құпиясөз қажет');
    const key='auth:'+email;const attempt=await one(db,'SELECT * FROM login_attempts WHERE key=?',key);
    if(attempt&&attempt.count>=30&&Date.now()-attempt.started<900000)fail(429,'Сәл кейін қайталап көріңіз');
    await run(db,`INSERT INTO login_attempts(key,count,started) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN started<? THEN 1 ELSE count+1 END,started=CASE WHEN started<? THEN excluded.started ELSE started END`,key,Date.now(),Date.now()-900000,Date.now()-900000);
    let row;
    if(path==='/api/register'){
     if(!clean(b.name,80))fail(400,'Атыңызды жазыңыз');if(!['business','team'].includes(b.role))fail(400,'Рөлді таңдаңыз');
     if(await one(db,'SELECT id FROM users WHERE email=?',email))fail(409,'Бұл email тіркелген');
     const hash=await passwordHash(password);
     try{await run(db,'INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',clean(b.name,80),email,hash,b.role);}catch(e){if(String(e).includes('UNIQUE'))fail(409,'Бұл email тіркелген');throw e;}
     row=await one(db,'SELECT * FROM users WHERE email=?',email);
    }else{row=await one(db,'SELECT * FROM users WHERE email=?',email);if(!row||!await passwordMatches(password,row.password))fail(401,'Email немесе құпиясөз қате');}
    await run(db,'DELETE FROM login_attempts WHERE key=?',key);
    const tok=random();await run(db,'INSERT INTO sessions VALUES(?,?,?)',tok,row.id,Date.now()+7*86400000);
    return json(200,{user:userView(row)},{'Set-Cookie':`naqty_session=${tok}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`});
   }
   if(path==='/api/logout'&&method==='POST'){
    if(token)await run(db,'DELETE FROM sessions WHERE token=?',token);
    return json(200,{ok:true},{'Set-Cookie':'naqty_session=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
   }
   if(path==='/api/profile'&&method==='PATCH'){
    needUser();const age=Number(b.age);if(!Number.isInteger(age)||age<13||age>100)fail(400,'Жас 13 пен 100 аралығында болуы керек');
    if(!['beginner','intermediate','expert'].includes(b.level)||!['yes','no'].includes(b.started))fail(400,'Деңгей мен тәжірибені таңдаңыз');
    const profile={age,level:b.level,started:b.started,onboarded:true};for(const k of ['team','company','skills','interests'])profile[k]=clean(b[k],500);
    await run(db,'UPDATE users SET name=?,profile=? WHERE id=?',clean(b.name,80)||user.name,JSON.stringify(profile),user.id);
    return json(200,{user:userView(await one(db,'SELECT * FROM users WHERE id=?',user.id))});
   }
   if(path==='/api/tasks'&&method==='GET'){
    let rows;if(url.searchParams.get('mine')==='1'){needUser();rows=await all(db,'SELECT * FROM tasks WHERE owner=?',user.id);}else rows=await all(db,"SELECT * FROM tasks WHERE status='published'");
    const counts=await all(db,'SELECT task_id,COUNT(*) n FROM proposals GROUP BY task_id');const countMap=new Map(counts.map(x=>[x.task_id,x.n]));
    const tasks=rows.map(row=>{const body=JSON.parse(row.body);return {...body,id:row.id,owner:row.owner,status:row.status,created:row.created,rating:rating(body),proposalCount:countMap.get(row.id)||0};}).sort((a,b)=>b.rating.score-a.rating.score||b.id-a.id);
    return json(200,{tasks});
   }
   if(path==='/api/questions'&&method==='POST'){role('business');if(clean(b.text).length<15)fail(400,'Қажеттілікті кемінде 15 таңбамен сипаттаңыз');return json(200,{questions:questions(b.text)});}
   if(path==='/api/tasks'&&method==='POST'){
    role('business');const body=taskBody(b);if(!body.title)fail(400,'Тапсырма атауы қажет');
    const result=await run(db,'INSERT INTO tasks(owner,body) VALUES(?,?)',user.id,JSON.stringify(body));
    return json(201,{task:await taskView(db,await one(db,'SELECT * FROM tasks WHERE id=?',result.meta.last_row_id))});
   }
   const tm=path.match(/^\/api\/tasks\/(\d+)$/);
   if(tm){
    const row=await one(db,'SELECT * FROM tasks WHERE id=?',Number(tm[1]));if(!row)fail(404,'Тапсырма табылмады');
    if(method==='GET'){if(row.status!=='published'&&row.owner!==user?.id)fail(403,'Жоба жеке');return json(200,{task:await taskView(db,row)});}
    if(method==='PATCH'){
     role('business');if(row.owner!==user.id)fail(403,'Тек автор өзгерте алады');
     if(row.status==='published'&&(!b.publish||b.confirmed!==true))fail(400,'Жарияланған карточка өзгерістерін қолмен растаңыз');
     const body=taskBody(b);if(!body.title)fail(400,'Атауы қажет');let status=row.status;
     if(b.publish){if(b.confirmed!==true)fail(400,'Карточканы қолмен растаңыз');if(!body.context||!body.need||!body.users||rating(body).breakdown.find(x=>x.key==='contact').points<5)fail(400,'Контекст, қажеттілік, пайдаланушылар және дұрыс контакт қажет');status='published';}
     await run(db,'UPDATE tasks SET body=?,status=? WHERE id=?',JSON.stringify(body),status,row.id);
     return json(200,{task:await taskView(db,await one(db,'SELECT * FROM tasks WHERE id=?',row.id))});
    }
   }
   if(path==='/api/proposals'&&method==='GET'){
    needUser();const where=user.role==='business'?'t.owner=?':'p.user_id=?';
    const rows=await all(db,`SELECT p.*,u.name team_name,u.email team_email,u.profile team_profile,t.body task_body,t.owner task_owner,t.status task_status,t.created task_created FROM proposals p JOIN users u ON u.id=p.user_id JOIN tasks t ON t.id=p.task_id WHERE ${where}`,user.id);
    const counts=new Map((await all(db,'SELECT task_id,COUNT(*) n FROM proposals GROUP BY task_id')).map(r=>[r.task_id,r.n]));
    const proposals=rows.map(row=>{const {team_name,team_email,team_profile,task_body,task_owner,task_status,task_created,...p}=row;const profile=JSON.parse(team_profile);delete profile.age;const body=JSON.parse(task_body);return {...p,body:JSON.parse(p.body),team:{id:p.user_id,name:team_name,email:team_email,profile},task:{...body,id:p.task_id,owner:task_owner,status:task_status,created:task_created,rating:rating(body),proposalCount:counts.get(p.task_id)||0}};});
    return json(200,{proposals});
   }
   if(path==='/api/proposals'&&method==='POST'){
    role('team');const task=await one(db,"SELECT * FROM tasks WHERE id=? AND status='published'",Number(b.taskId));if(!task)fail(404,'Жарияланған тапсырма табылмады');
    if(!user.profile.team||!user.profile.skills||!user.profile.interests)fail(400,'Профильде команда атауын, дағдыларды және қызығушылықтарды толтырыңыз');
    const body={};for(const k of ['idea','plan','duration','link'])body[k]=clean(b[k]);
    if(body.idea.length<20||body.plan.length<20||!body.duration)fail(400,'Идея мен жоспар кемінде 20 таңба және мерзім қажет');
    try{if(!['http:','https:'].includes(new URL(body.link).protocol))throw 0;}catch{fail(400,'Прототиптің http немесе https сілтемесін енгізіңіз');}
    const result=await run(db,'INSERT INTO proposals(task_id,user_id,body) VALUES(?,?,?)',task.id,user.id,JSON.stringify(body));return json(201,{id:result.meta.last_row_id});
   }
   const pm=path.match(/^\/api\/proposals\/(\d+)$/);
   if(pm&&method==='PATCH'){
    role('business');const p=await one(db,'SELECT p.id,t.owner FROM proposals p JOIN tasks t ON t.id=p.task_id WHERE p.id=?',Number(pm[1]));if(!p||p.owner!==user.id)fail(403,'Тек тапсырма авторы таңдай алады');
    if(!['selected','rejected','pending'].includes(b.status))fail(400,'Қате мәртебе');await run(db,'UPDATE proposals SET status=? WHERE id=?',b.status,p.id);return json(200,{ok:true});
   }
   if(path==='/api/courses'&&method==='GET'){needUser();return json(200,{courses,progress:(await all(db,'SELECT lesson FROM progress WHERE user_id=?',user.id)).map(x=>x.lesson)});}
   if(path==='/api/progress'&&method==='POST'){
    needUser();if(!courses.some(c=>c.lessons.some((l,i)=>`${c.id}-${i}`===b.lesson)))fail(400,'Сабақ табылмады');await run(db,'INSERT OR IGNORE INTO progress VALUES(?,?)',user.id,b.lesson);return json(200,{ok:true});
   }
   if(path==='/api/assistant'&&method==='POST'){
    needUser();const message=clean(b.message,2000);if(!message)fail(400,'Сұрақ жазыңыз');
    if(env.GEMINI_API_KEY){
     const now=new Date();const limits=[[`ai-user:${user.id}:${now.toISOString().slice(0,13)}`,20],[`ai-day:${now.toISOString().slice(0,10)}`,100]];
     for(const [key,max]of limits){await run(db,'INSERT OR IGNORE INTO login_attempts(key,count,started) VALUES(?,0,?)',key,Date.now());const result=await run(db,'UPDATE login_attempts SET count=count+1 WHERE key=? AND count<?',key,max);if(!result.meta.changes)fail(429,'ИИ сұрауларының уақытша лимиті бітті. Кейін қайталап көріңіз.');}
     return json(200,await askGemini({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_MODEL||'gemini-3.8-flash',message,history:b.history,level:user.profile.level}));
    }
    return json(200,{answer:assistantAnswer(message.toLowerCase()),mode:'local-rules'});
   }
   fail(404,'Табылмады');
  }catch(e){if(!e.status)console.error('NAQTY API error',String(e));return json(e.status||500,{error:e.status?e.message:'Сервер қатесі. Қайталап көріңіз.'});}
 }
};
