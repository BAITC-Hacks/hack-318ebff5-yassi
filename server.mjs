import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {dirname,join,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fields,rating,questions} from './lib.mjs';
import {seedTasks,courses} from './seed.mjs';
import {askGemini} from './gemini.mjs';
const root=dirname(fileURLToPath(import.meta.url)),dir=process.env.NAQTY_DATA_DIR||join(root,'data');
mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(join(dir,'naqty.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,profile TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,owner INTEGER REFERENCES users(id),status TEXT NOT NULL DEFAULT 'draft',body TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS proposals(id INTEGER PRIMARY KEY,task_id INTEGER REFERENCES tasks(id),user_id INTEGER REFERENCES users(id),body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS progress(user_id INTEGER REFERENCES users(id),lesson TEXT,PRIMARY KEY(user_id,lesson));
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
CREATE INDEX IF NOT EXISTS idx_proposals_task ON proposals(task_id);
CREATE INDEX IF NOT EXISTS idx_proposals_user ON proposals(user_id);`);
function hash(p){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');}
function verify(p,h){const [salt,value]=h.split(':');return timingSafeEqual(scryptSync(p,salt,64),Buffer.from(value,'hex'));}
if(!db.prepare('SELECT id FROM users LIMIT 1').get()){
 const add=db.prepare('INSERT INTO users(name,email,password,role,profile) VALUES(?,?,?,?,?)');
 add.run('Айдана','business@naqty.demo',hash('Naqty2026!'),'business',JSON.stringify({age:24,level:'intermediate',started:'yes',onboarded:true,company:'Aru Store'}));
 for(const [name,email,skills,interests]of [['Qadam Team','team@naqty.demo','JavaScript, Python, Figma','Сауда, Білім'],['Nomad Lab','nomad@naqty.demo','React, SQL, UX','Логистика'],['Jas Digital','jas@naqty.demo','Figma, Marketing','Маркетинг'],['Bolashaq','bolashaq@naqty.demo','Node.js, Python','Білім']])add.run(name,email,hash('Naqty2026!'),'team',JSON.stringify({age:20,level:'beginner',started:'no',onboarded:true,team:name,skills,interests}));
 seedTasks.forEach(([title,topic,type,company,context,need],i)=>{
  const body={title,topic,type,company,context,need,users:'Күн сайын қызмет көрсететін 5 менеджер және 100 тұрақты клиент.',data:i===7?'':'Анонимденген 300 тапсырыс бар CSV файлы және қазіргі жұмыс процесінің 5 мысалы.',constraints:'4 апта ішінде; жеке деректерді қолданбау; браузерде жұмыс істеуі керек.',result:'Тест деректерімен жұмыс істейтін интерактивті прототип және іске қосу нұсқаулығы.',success:i===6?'Жұмыс ыңғайлы болуы керек':'Есеп дайындау уақытын 60 минуттан 10 минутқа дейін қысқарту; 5 пайдаланушы тесті.',contact:'business@naqty.demo',interaction:i===4?'':'Аптасына бір рет 30 минут онлайн кездесу, сұрақтарға 2 жұмыс күнінде жауап.',deadline:'4 апта'};
  db.prepare('INSERT INTO tasks(owner,status,body) VALUES(?,?,?)').run(1,'published',JSON.stringify(body));
 });
 for(let i=0;i<6;i++)db.prepare('INSERT INTO proposals(task_id,user_id,body) VALUES(?,?,?)').run(i<3?1:i+1,2+i%4,JSON.stringify({idea:'Сатылым деректерін бір панельге біріктіріп, негізгі көрсеткіштерді автоматты есептейтін прототип ұсынамыз.',plan:'1-апта: сұхбат және талаптар. 2-апта: дизайн. 3-апта: әзірлеу. 4-апта: тест және таныстыру.',duration:'4 апта',link:'https://example.com',demo:true}));
}
function userView(row){if(!row)return null;const {password,...u}=row;return {...u,profile:JSON.parse(u.profile)};}
function taskView(row){const b=JSON.parse(row.body);return {...b,id:row.id,owner:row.owner,status:row.status,created:row.created,rating:rating(b),proposalCount:db.prepare('SELECT COUNT(*) n FROM proposals WHERE task_id=?').get(row.id).n};}
function fail(status,message){throw Object.assign(new Error(message),{status});}
function clean(s,max=6000){return String(s??'').trim().slice(0,max);}
function taskBody(b){const out={};for(const [k]of fields)out[k]=clean(b[k]);for(const k of ['topic','type','company','deadline'])out[k]=clean(b[k],120);if(!['standard','expert','project'].includes(out.type))out.type='standard';return out;}
const attempts=new Map();
const aiHits=new Map();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 try{
  if(!url.pathname.startsWith('/api/')){
   const file=url.pathname==='/lib.mjs'?join(root,'lib.mjs'):join(root,'public',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));
   if(file!==join(root,'lib.mjs')&&!resolve(file).startsWith(resolve(root,'public')+'\\')&&!resolve(file).startsWith(resolve(root,'public')+'/'))fail(404,'Табылмады');
   if(!existsSync(file))fail(404,'Табылмады');
   res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'})[extname(file)]||'application/octet-stream'});res.end(readFileSync(file));return;
  }
  let b={};
  if(['POST','PATCH','DELETE'].includes(req.method)){
   if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)fail(403,'Қолжетімділік жоқ');
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)fail(413,'Мәтін тым үлкен');}
   try{b=raw?JSON.parse(raw):{};}catch{fail(400,'Қате JSON');}
  }
  const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('naqty_session='))?.split('=')[1];
  const session=token?db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(token,Date.now()):null;
  const u=session?userView(db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id)):null;
  const needUser=()=>{if(!u)fail(401,'Алдымен жүйеге кіріңіз');};
  const role=r=>{needUser();if(u.role!==r)fail(403,'Бұл әрекетке рұқсат жоқ');};
  if(url.pathname==='/api/config'&&req.method==='GET')return send(200,{assistantMode:process.env.GEMINI_API_KEY?'gemini':'local-rules'});
  if(url.pathname==='/api/me'&&req.method==='GET')return send(200,{user:u});
  if(['/api/login','/api/register'].includes(url.pathname)&&req.method==='POST'){
   const key=req.socket.remoteAddress, a=attempts.get(key)||{n:0,time:Date.now()};if(Date.now()-a.time>600000){a.n=0;a.time=Date.now();}if(++a.n>50)fail(429,'Сәл кейін қайталап көріңіз');attempts.set(key,a);
   const email=clean(b.email,254).toLowerCase(),password=String(b.password||'');
   if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||password.length>200)fail(400,'Email және кемінде 8 таңбалы құпиясөз қажет');
   let row;
   if(url.pathname==='/api/register'){
    if(!clean(b.name,80))fail(400,'Атыңызды жазыңыз');if(!['business','team'].includes(b.role))fail(400,'Рөлді таңдаңыз');
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail(409,'Бұл email тіркелген');
    const id=db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(clean(b.name,80),email,hash(password),b.role).lastInsertRowid;
    row=db.prepare('SELECT * FROM users WHERE id=?').get(id);
   }else{row=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!row||!verify(password,row.password))fail(401,'Email немесе құпиясөз қате');}
   const tok=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tok,row.id,Date.now()+7*86400000);
   res.setHeader('Set-Cookie',`naqty_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);return send(200,{user:userView(row)});
  }
  if(url.pathname==='/api/logout'&&req.method==='POST'){if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.setHeader('Set-Cookie','naqty_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send(200,{ok:true});}
  if(url.pathname==='/api/profile'&&req.method==='PATCH'){
   needUser();const age=Number(b.age);if(!Number.isInteger(age)||age<13||age>100)fail(400,'Жас 13 пен 100 аралығында болуы керек');
   if(!['beginner','intermediate','expert'].includes(b.level)||!['yes','no'].includes(b.started))fail(400,'Деңгей мен тәжірибені таңдаңыз');
   const profile={age,level:b.level,started:b.started,onboarded:true};for(const k of ['team','company','skills','interests'])profile[k]=clean(b[k],500);
   db.prepare('UPDATE users SET name=?,profile=? WHERE id=?').run(clean(b.name,80)||u.name,JSON.stringify(profile),u.id);return send(200,{user:userView(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});
  }
  if(url.pathname==='/api/tasks'&&req.method==='GET'){
   const rows=url.searchParams.get('mine')==='1'?(needUser(),db.prepare('SELECT * FROM tasks WHERE owner=?').all(u.id)):db.prepare("SELECT * FROM tasks WHERE status='published'").all();
   return send(200,{tasks:rows.map(taskView).sort((a,b)=>b.rating.score-a.rating.score||b.id-a.id)});
  }
  if(url.pathname==='/api/questions'&&req.method==='POST'){role('business');if(clean(b.text).length<15)fail(400,'Қажеттілікті кемінде 15 таңбамен сипаттаңыз');return send(200,{questions:questions(b.text)});}
  if(url.pathname==='/api/tasks'&&req.method==='POST'){
   role('business');const body=taskBody(b);if(!body.title)fail(400,'Тапсырма атауы қажет');
   const id=db.prepare('INSERT INTO tasks(owner,body) VALUES(?,?)').run(u.id,JSON.stringify(body)).lastInsertRowid;return send(201,{task:taskView(db.prepare('SELECT * FROM tasks WHERE id=?').get(id))});
  }
  const taskMatch=url.pathname.match(/^\/api\/tasks\/(\d+)$/);
  if(taskMatch){
   const row=db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(taskMatch[1]));if(!row)fail(404,'Тапсырма табылмады');
   if(req.method==='GET'){if(row.status!=='published'&&row.owner!==u?.id)fail(403,'Жоба жеке');return send(200,{task:taskView(row)});}
   if(req.method==='PATCH'){
    role('business');if(row.owner!==u.id)fail(403,'Тек автор өзгерте алады');const body=taskBody(b);
    if(row.status==='published' && (!b.publish||b.confirmed!==true))fail(400,'Жарияланған карточка өзгерістерін қолмен растаңыз');
    if(!body.title)fail(400,'Атауы қажет');let status=row.status;
    if(b.publish){if(b.confirmed!==true)fail(400,'Карточканы қолмен растаңыз');if(!body.context||!body.need||!body.users||rating(body).breakdown.find(x=>x.key==='contact').points<5)fail(400,'Контекст, қажеттілік, пайдаланушылар және дұрыс контакт қажет');status='published';}
    db.prepare('UPDATE tasks SET body=?,status=? WHERE id=?').run(JSON.stringify(body),status,row.id);return send(200,{task:taskView(db.prepare('SELECT * FROM tasks WHERE id=?').get(row.id))});
   }
  }
  if(url.pathname==='/api/proposals'&&req.method==='GET'){
   needUser();const rows=u.role==='business'?db.prepare('SELECT p.* FROM proposals p JOIN tasks t ON t.id=p.task_id WHERE t.owner=?').all(u.id):db.prepare('SELECT * FROM proposals WHERE user_id=?').all(u.id);
   return send(200,{proposals:rows.map(p=>({...p,body:JSON.parse(p.body),team:userView(db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id)),task:taskView(db.prepare('SELECT * FROM tasks WHERE id=?').get(p.task_id))}))});
  }
  if(url.pathname==='/api/proposals'&&req.method==='POST'){
   role('team');const task=db.prepare("SELECT * FROM tasks WHERE id=? AND status='published'").get(Number(b.taskId));if(!task)fail(404,'Жарияланған тапсырма табылмады');
   if(!u.profile.team||!u.profile.skills||!u.profile.interests)fail(400,'Профильде команда атауын, дағдыларды және қызығушылықтарды толтырыңыз');
   const body={};for(const k of ['idea','plan','duration','link'])body[k]=clean(b[k]);
   if(body.idea.length<20||body.plan.length<20||!body.duration)fail(400,'Идея мен жоспар кемінде 20 таңба және мерзім қажет');
   try{if(!['https:','http:'].includes(new URL(body.link).protocol))throw 0;}catch{fail(400,'Прототиптің http немесе https сілтемесін енгізіңіз');}
   const id=db.prepare('INSERT INTO proposals(task_id,user_id,body) VALUES(?,?,?)').run(task.id,u.id,JSON.stringify(body)).lastInsertRowid;return send(201,{id});
  }
  const pm=url.pathname.match(/^\/api\/proposals\/(\d+)$/);
  if(pm&&req.method==='PATCH'){
   role('business');const p=db.prepare('SELECT p.id,t.owner FROM proposals p JOIN tasks t ON t.id=p.task_id WHERE p.id=?').get(Number(pm[1]));if(!p||p.owner!==u.id)fail(403,'Тек тапсырма авторы таңдай алады');
   if(!['selected','rejected','pending'].includes(b.status))fail(400,'Қате мәртебе');db.prepare('UPDATE proposals SET status=? WHERE id=?').run(b.status,p.id);return send(200,{ok:true});
  }
  if(url.pathname==='/api/courses'&&req.method==='GET'){needUser();return send(200,{courses,progress:db.prepare('SELECT lesson FROM progress WHERE user_id=?').all(u.id).map(x=>x.lesson)});}
  if(url.pathname==='/api/progress'&&req.method==='POST'){
   needUser();if(!courses.some(c=>c.lessons.some((l,i)=>`${c.id}-${i}`===b.lesson)))fail(400,'Сабақ табылмады');db.prepare('INSERT OR IGNORE INTO progress VALUES(?,?)').run(u.id,b.lesson);return send(200,{ok:true});
  }
  if(url.pathname==='/api/assistant'&&req.method==='POST'){
   needUser();const q=clean(b.message).toLowerCase();if(!q)fail(400,'Сұрақ жазыңыз');
   if(process.env.GEMINI_API_KEY){
    for(const [key,max]of [[`user:${u.id}:${new Date().toISOString().slice(0,13)}`,20],[`day:${new Date().toISOString().slice(0,10)}`,100]]){const n=aiHits.get(key)||0;if(n>=max)fail(429,'ИИ сұрауларының уақытша лимиті бітті. Кейін қайталап көріңіз.');aiHits.set(key,n+1);}
    return send(200,await askGemini({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL||'gemini-3.8-flash',message:clean(b.message,2000),history:b.history,level:u.profile.level}));
   }
   let answer='Идеяңызды нақтылау үшін үш қадам ұсынамын:\n1. Шешкіңіз келетін бір мәселені атаңыз.\n2. Осы мәселе бар 5 адаммен сұхбат өткізіңіз.\n3. Бір аптада тексерілетін прототип және өлшенетін нәтиже таңдаңыз.\n\nҚай бизнес немесе аудитория туралы айтып отырсыз?';
   if(/салық|налог|кіріс|шығын|ақша|қаржы/.test(q))answer='Қаржыны есептеу үшін айлық кіріс, операциялық шығын, комиссия және өзіңізге қолданылатын салық мөлшерлемесін енгізіңіз. «Қаржы калькуляторы» бөлімі таза пайда мен маржаны есептейді. Мөлшерлемелер — сіз енгізетін сценарий; заңдық салық кеңесі берілмейді.';
   else if(/рейтинг|тапсырма|задач|карточ/.test(q))answer='Карточка 10 өріс бойынша бағаланады: контекст пен қажеттілікке 15 балдан, деректерге 15, аудиторияға 10, шектеулерге 10, нәтижеге 10, өлшемдерге 10, атауға 5, контактқа 5 және кері байланысқа 5. «Жаңа тапсырма» арқылы бастаңыз. Санмен өлшенетін критерий қосыңыз: мысалы, өңдеу уақытын 30%-ға қысқарту. Бұл мәтіннің толықтығын бағалайтын ереже, бизнес табысының болжамы емес.';
   else if(/команда|ұсыныс|отклик/.test(q))answer='Каталогтағы барлық жарияланған тапсырмалар барлық командаға ашық. Ұсыныста шешім идеясы, кезеңдік жоспар, мерзім және прототип сілтемесі болуы керек. Бизнес бірнеше команданы таңдай алады немесе ешқайсысын таңдамауы мүмкін. Автоматты тағайындау жоқ.';
   return send(200,{answer,mode:'local-rules'});
  }
  fail(404,'Табылмады');
 }catch(e){if(!e.status)console.error(e);send(e.status||500,{error:e.status?e.message:'Сервер қатесі. Қайталап көріңіз.'});}
});
const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>console.log(`NAQTY дайын: http://localhost:${port}`));
