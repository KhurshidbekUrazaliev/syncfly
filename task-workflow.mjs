export function migrateParallelPlans(state){
 // Previous AI plans turned every suggested ordering into a hard prerequisite.
 // Only migrate tasks identifiable in accepted AI plans; preserve manually set dependencies.
 for(const plan of state.tasks||[]){if(plan.kind!=='plan'||plan.status!=='done'||!plan.plan)continue;
  for(const item of plan.plan){for(const task of state.tasks.filter(t=>t.projectId===plan.projectId&&t.title===item.title&&!t.dependencyMode)){
   task.suggestedDependencies=task.dependencies||[];task.dependencies=[];task.dependencyMode='advisory';
  }}
 }
 for(const task of state.tasks||[])if(task.status==='failed'&&/^Agent exited|^Agent needs a permission/.test(task.error||''))task.error=taskFailure(task.logs,task.error);
 for(const task of state.tasks||[])if(task.provider==='codex'&&task.status==='failed'&&/^This provider reached its usage limit/.test(task.error||'')&&(task.logs||[]).at(-1)?.text==='[turn.completed]'&&!task.approvalDenied){task.status='review';task.error=null;}
 return state;
}
export function taskFailure(logs,fallback){
 const text=(logs||[]).map(l=>typeof l==='string'?l:l.text).join('\n');
 if(/add a payment method|billing.*required|payment.*required|upgrade.*(?:plan|subscription)/i.test(text))return 'This provider requires billing or an eligible subscription before it can run. Update the provider account, or choose another provider/account in Run settings. Other workers can continue.';
 if(/out of usage credits|credits_required|model_requires_usage_credits/i.test(text))return 'Claude has no usage credits for this model. Choose another model or account in Run settings, or restore credits. Other agents can keep working.';
 if(/you(?:'ve| have)? (?:hit|reached|exceeded) (?:your |the )?usage limit|usage limit (?:reached|exceeded)|rate.limit.exceeded|quota.exceeded|too many requests/i.test(text))return 'This provider reached its usage limit. Change account/model in Run settings or wait for its limit to reset. Other agents can keep working.';
 if(/registered Core launch requires an installed app/i.test(text))return 'The provider inherited a desktop-only command launcher. Restart using the updated Syncfly app.';
 if(/workspace trust required/i.test(text))return 'Cursor requires trust for this task checkout. Restart using the updated Syncfly app.';
 const errors=text.split('\n').filter(l=>/error|failed|denied|unable|not authenticated|sign.?in|permission/i.test(l)&&!/^\[/.test(l));
 return errors.at(-1)?.slice(0,1600)||fallback;
}
