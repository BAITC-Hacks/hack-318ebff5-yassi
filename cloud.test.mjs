import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';

test('cloud Worker: persistent database, registration, publication and manual team selection',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const DB={prepare(sql){return {bind(...args){return {
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}};}
 };},async run(){sqlite.prepare(sql).run();return {success:true};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const request=async(path,method='GET',body,cookie)=>{
  const r=await worker.fetch(new Request('https://naqty.test'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('Set-Cookie')?.split(';')[0],setCookie:r.headers.get('Set-Cookie')};
 };
 assert.equal((await worker.fetch(new Request('https://naqty.test/'),{DB})).status,200);
 assert.equal((await request('/api/tasks')).body.tasks.length,9);
 const business=await request('/api/register','POST',{name:'Cloud Business',email:'owner@cloud.test',password:'CloudPass123!',role:'business'});assert.equal(business.status,200);assert.match(business.setCookie,/Secure; HttpOnly/);
 const biz=business.cookie;
 assert.equal((await request('/api/profile','PATCH',{age:24,level:'expert',started:'yes'},biz)).status,200);
 const task={title:'Cloud MVP сынақ тапсырмасы',context:'Клиенттер тапсырысты тек телефон арқылы береді, менеджерлер оны қолмен тіркейді.',need:'Барлық тапсырысты жинап, жұмыс уақытын қысқартатын веб-қосымша қажет.',users:'Күніне 100 клиент пен 5 менеджер пайдаланады.',data:'300 анонимді тапсырыс CSV форматында беріледі.',constraints:'4 апта, тест деректері, қазақ тілін қолдау қажет.',result:'Жұмыс істейтін веб-прототип және пайдаланушы нұсқаулығы.',success:'Тапсырысты өңдеу уақытын 30 пайызға қысқарту.',contact:'owner@cloud.test',interaction:'Аптасына бір онлайн кездесу, екі күнде кері байланыс.',type:'standard'};
 const draft=await request('/api/tasks','POST',task,biz);assert.equal(draft.status,201);const id=draft.body.task.id;
 assert.equal((await request('/api/tasks/'+id)).status,403);
 assert.equal((await request('/api/tasks/'+id,'PATCH',{...task,publish:true},biz)).status,400);
 assert.equal((await request('/api/tasks/'+id,'PATCH',{...task,publish:true,confirmed:true},biz)).status,200);
 assert.equal((await request('/api/tasks/'+id)).body.task.rating.score,100);
 const teamLogin=await request('/api/login','POST',{email:'team@naqty.demo',password:'Naqty2026!'});assert.equal(teamLogin.status,200);const team=teamLogin.cookie;
 assert.equal((await request('/api/tasks/'+id,'PATCH',task,team)).status,403);
 const proposal=await request('/api/proposals','POST',{taskId:id,idea:'Тапсырыстарды тіркеуге арналған веб-қосымша жасаймыз.',plan:'Бірінші аптада зерттеу, екінші аптада прототип, үшінші аптада тест.',duration:'3 апта',link:'https://example.com/demo'},team);assert.equal(proposal.status,201);
 assert.equal((await request('/api/proposals','GET',null,biz)).body.proposals[0].status,'pending');
 assert.equal((await request('/api/proposals/'+proposal.body.id,'PATCH',{status:'selected'},biz)).status,200);
 assert.equal((await request('/api/proposals','GET',null,biz)).body.proposals[0].status,'selected');
 assert.equal((await request('/api/progress','POST',{lesson:'idea-0'},team)).status,200);
 assert.ok((await request('/api/courses','GET',null,team)).body.progress.includes('idea-0'));
 await request('/api/logout','POST',{},biz);
 assert.equal((await request('/api/me','GET',null,biz)).body.user,null);
 const again=await request('/api/login','POST',{email:'owner@cloud.test',password:'CloudPass123!'});assert.equal(again.body.user.profile.level,'expert');
 const cross=await worker.fetch(new Request('https://naqty.test/api/login',{method:'POST',headers:{Origin:'https://different.test','Content-Type':'application/json'},body:'{}'}),{DB});assert.equal(cross.status,403);
 sqlite.close();
});
