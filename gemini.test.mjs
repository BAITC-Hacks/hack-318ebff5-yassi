import {test} from 'node:test';
import assert from 'node:assert/strict';
import {askGemini} from '../gemini.mjs';
test('Gemini sends secret only in header, limits history, parses final text',async()=>{
 const r=await askGemini({apiKey:'test-secret',message:'Кофехана қалай ашамын?',history:Array.from({length:10},()=>({role:'user',text:'Алдыңғы сұрақ'}))},async(url,options)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(options.headers['x-goog-api-key'],'test-secret');assert.ok(!options.body.includes('test-secret'));
  const b=JSON.parse(options.body);assert.equal(b.store,false);assert.equal(b.generation_config.max_output_tokens,900);
  return Response.json({steps:[{type:'thought',content:[{type:'text',text:'hidden'}]},{type:'model_output',content:[{type:'text',text:'Алдымен аудиторияны зерттеңіз.'}]}]});
 });assert.equal(r.answer,'Алдымен аудиторияны зерттеңіз.');assert.equal(r.mode,'gemini');
});
test('Invalid key and quota errors are clear without leaking provider response',async()=>{
 await assert.rejects(askGemini({apiKey:'test-secret',message:'Сәлем'},async()=>Response.json({error:{message:'API key not valid. test-secret'}},{status:400})),e=>e.status===502&&e.message.includes('кілтін қабылдамады')&&!e.message.includes('test-secret'));
 await assert.rejects(askGemini({apiKey:'test-secret',message:'Сәлем'},async()=>Response.json({error:{}},{status:429})),e=>e.status===429);
});
