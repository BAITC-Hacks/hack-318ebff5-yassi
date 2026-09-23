export async function askGemini({apiKey,model='gemini-3.8-flash',message,history=[],level='beginner'},fetcher=fetch){
 if(!apiKey)throw Object.assign(new Error('Gemini кілті серверде бапталмаған.'),{status:503});
 const prior=(Array.isArray(history)?history:[]).slice(-8).filter(x=>['user','assistant'].includes(x?.role)).map(x=>({role:x.role,text:String(x.text||'').slice(0,1500)}));
 const input=prior.length?`Алдыңғы сөйлесу (контекст):\n${JSON.stringify(prior)}\n\nҚазіргі сұрақ: ${message}`:message;
 let response;
 try{response=await fetcher('https://generativelanguage.googleapis.com/v1beta/interactions',{
  method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},signal:AbortSignal.timeout(25000),
  body:JSON.stringify({model,store:false,input,system_instruction:`Сен NAQTY платформасының бизнес көмекшісісің. Әдепкіде қазақша, пайдаланушы орысша сұраса орысша жауап бер. Қысқа, нақты, іске жарайтын кеңес бер. Пайдаланушы деңгейі: ${['beginner','intermediate','expert'].includes(level)?level:'beginner'}. Бизнес идеяны тексеруге, карточканы толықтыруға, шығын мен табысты түсінуге көмектес. Команданы ешқашан автоматты тағайындама: оны бизнес өзі таңдайды. Құпия кілттерді сұрама. Салық мөлшерлемелерін нақты тексерілмесе ресми факт ретінде айтпа. Тек мәтінмен жауап бер. Сенде сайтты өзгерту немесе нақты деректерді іздеу құралдары жоқ.`,generation_config:{max_output_tokens:900,thinking_level:'low'}})
 });}catch{throw Object.assign(new Error('Gemini уақытында жауап бермеді. Қайталап көріңіз.'),{status:504});}
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  const providerText=JSON.stringify(data.error||{});
  const invalid=[401,403].includes(response.status)||/API_KEY_INVALID|API key not valid|UNAUTHENTICATED/i.test(providerText);
  const message=invalid?'Google Gemini берілген API кілтін қабылдамады. Сайт иесі сервердегі кілтті жаңартуы керек.':response.status===429?'Gemini сұрау лимиті таусылды. Біраз уақыттан кейін қайталаңыз.':response.status===404?'Таңдалған Gemini моделі қолжетімсіз. Сайт иесі модель баптауын тексеруі керек.':'Gemini сұрауды орындай алмады. Кейін қайталап көріңіз.';
  throw Object.assign(new Error(message),{status:response.status===429?429:502,providerStatus:response.status});
 }
 const answer=(data.steps||[]).filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).filter(c=>c.type==='text').map(c=>c.text||'').join('\n').trim();
 if(!answer)throw Object.assign(new Error('Gemini мәтіндік жауап қайтармады. Сұрақты басқаша жазыңыз.'),{status:502});
 return {answer,mode:'gemini',model};
}
