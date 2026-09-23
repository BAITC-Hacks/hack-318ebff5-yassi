import {createInterface} from 'node:readline';
import {askGemini} from '../gemini.mjs';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=createInterface({input:process.stdin,terminal:false});
const apiKey=await new Promise(resolve=>input.once('line',resolve));input.close();
if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
try{const result=await askGemini({apiKey,message:'Қазақ тілінде тек «Байланыс жұмыс істейді» деп жауап бер.'});console.log(JSON.stringify({ok:true,mode:result.mode,answer:result.answer}));}
catch(e){console.log(JSON.stringify({ok:false,status:e.status,providerStatus:e.providerStatus,message:e.message}));process.exitCode=1;}
