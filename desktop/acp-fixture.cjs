const fs=require('fs'),readline=require('readline');
if(process.argv.includes('status')){console.log('Login successful (test fixture)');process.exit(0);}
const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));let promptId;
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});
 else if(m.method==='session/new')send({id:m.id,result:{sessionId:'fixture',modes:{availableModes:[{id:'plan',name:'Plan'}]}}});
 else if(m.method==='session/set_mode'||m.method==='session/set_model')send({id:m.id,result:{}});
 else if(m.method==='session/prompt'){
  const text=m.params.prompt[0].text;promptId=m.id;
  if(text.includes('Concurrent worker'))setTimeout(()=>send({id:m.id,result:{stopReason:'end_turn'}}),120000);
  else send({id:900,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{title:'Create native-result.txt',kind:'edit',rawInput:{path:process.cwd()+'/native-result.txt',text:'Native approval passed'}},options:[{optionId:'allow',kind:'allow_once',name:'Allow'},{optionId:'deny',kind:'reject_once',name:'Deny'}]}});
 }else if(m.id===900){if(m.result.outcome.outcome==='selected')fs.writeFileSync('native-result.txt','Native approval passed');send({id:promptId,result:{stopReason:'end_turn'}});}
});
