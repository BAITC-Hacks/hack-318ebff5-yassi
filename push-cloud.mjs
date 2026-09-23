// Short-lived repository credential is read from stdin; never stored on disk.
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=createInterface({input:process.stdin,terminal:false});
const line=await new Promise(resolve=>input.once('line',resolve));input.close();
if(process.stdin.isTTY)process.stdin.setRawMode(false);
process.stdin.pause();
const credential=JSON.parse(line);
if(!/^https:\/\/git\.chatgpt-team\.site\//.test(credential.remote_url))throw new Error('Unexpected source host');
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Bearer '+credential.token};
const child=spawn('git',['push',credential.remote_url,'HEAD:refs/heads/'+credential.branch],{env,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>process.stdout.write(data.toString().replaceAll(credential.token,'[REDACTED]')));
child.on('exit',code=>process.exit(code??1));
