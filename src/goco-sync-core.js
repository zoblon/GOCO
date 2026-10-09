'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.GOCO_SYNC_CORE=api;})(globalThis,function(){
  const norm=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
  const id=v=>String(v??'');
  const pair=v=>id(v.projectId??v.project?.id)+'|'+id(v.taskId??v.task?.id);
  const secondsOf=v=>{const n=v?.worked_seconds??v?.seconds??(v?.hours!==undefined?Number(v.hours)*3600:NaN);return Number.isFinite(Number(n))&&Number(n)>=0?Math.round(Number(n)):0;};
  const ctxKey=c=>[c.account,c.userId,c.date].join('|');
  const inContext=(a,c)=>a.date===c.date&&id(a.user?.id??a.userId)===id(c.userId);
  const recordContext=(r,c)=>r.account===c.account&&id(r.userId)===id(c.userId)&&r.date===c.date;
  const timer=a=>!!(a.timer_started_at||a.running);
  const signature=a=>JSON.stringify([a.date,id(a.projectId??a.project?.id),id(a.taskId??a.task?.id),secondsOf(a),String(a.description??'')]);
  const sourceSignature=e=>JSON.stringify([e.totalSeconds??e.remainingSeconds,pair(e),String(e.description??e.summary??'')]);
  function stableSourceKey(e){return [e.calendarId||'default',e.uid||norm(e.summary),e.occurrence||e.start||'',e.uid?'':e.end||''].filter((x,i)=>i<3||x).join('|');}
  function reconcileDay({ctx,calendarEntries=[],activities=[],ledger={},drafts={}}){
    const actual=activities.filter(a=>inContext(a,ctx)), records=(ledger.entries||[]).filter(r=>recordContext(r,ctx));
    const byId=new Map(actual.map(a=>[id(a.id),a])), used=new Map(), allocations=[], conflicts=[];
    const valid=r=>{const a=byId.get(id(r.activityId));return a&&!timer(a)&&pair(a)===pair(r)&&secondsOf(a)===r.seconds&&String(a.description??'')===String(r.description??'');};
    const spend=(aid,n)=>used.set(id(aid),(used.get(id(aid))||0)+n);
    const entries=calendarEntries.map(raw=>{const sourceKey=raw.sourceKey||stableSourceKey(raw);const e={...raw,...drafts[sourceKey],sourceKey};e.totalSeconds=Math.max(0,Math.round(e.totalSeconds??e.remainingSeconds??0));e.remainingSeconds=e.totalSeconds;e.coveredSeconds=0;e.isSynced=false;e.conflict=null;e.allocations=[];return e;}).sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))||a.sourceKey.localeCompare(b.sourceKey));
    // Every persisted allocation consumes its remote seconds, including when its
    // original calendar source is no longer visible. Otherwise one MOCO
    // activity could silently be credited to a different event after refresh.
    const persistedAllocations=(ledger.allocations||[]).filter(a=>recordContext(a,ctx));
    const validPersisted=new Set();
    for(const a of persistedAllocations){const remote=byId.get(id(a.activityId));if(remote&&!timer(remote)&&signature(remote)===a.activityFingerprint&&secondsOf(remote)-(used.get(id(a.activityId))||0)>=a.seconds){spend(a.activityId,a.seconds);validPersisted.add(a);}}
    // Preserve confirmed allocations before distributing any unassigned seconds.
    for(const e of entries){const own=records.filter(r=>r.kind==='calendar'&&r.sourceKey===e.sourceKey);for(const r of own){if(!valid(r)||r.sourceFingerprint!==sourceSignature(e)){e.conflict='GOCO-Buchung oder Kalenderquelle wurde geändert/gelöscht. Bitte prüfen.';continue;}spend(r.activityId,r.seconds);e.coveredSeconds+=r.seconds;}
      for(const a of persistedAllocations.filter(a=>a.sourceKey===e.sourceKey)){if(!validPersisted.has(a)||a.sourceFingerprint!==sourceSignature(e)){e.conflict='Angerechnete MOCO-Zeit wurde geändert/gelöscht. Bitte prüfen.';continue;}e.coveredSeconds+=a.seconds;e.allocations.push(a);}
      if(e.coveredSeconds>e.totalSeconds)e.conflict='Kalenderdauer ist kleiner als bereits gebuchte Zeit.';
    }
    for(const e of entries){if(e.conflict)continue;let remaining=Math.max(0,e.totalSeconds-e.coveredSeconds);const candidates=actual.filter(a=>pair(a)===pair(e));if(candidates.some(timer)&&e.isSelected&&!e.isHidden){e.conflict='Laufender Timer: zuerst in MOCO beenden und aktualisieren.';continue;}
      const allocate=(a,n)=>{if(n<=0)return;spend(a.id,n);remaining-=n;e.coveredSeconds+=n;const allocation={account:ctx.account,userId:ctx.userId,date:ctx.date,sourceKey:e.sourceKey,sourceFingerprint:sourceSignature(e),activityId:a.id,activityFingerprint:signature(a),seconds:n};e.allocations.push(allocation);allocations.push(allocation);};
      if(remaining>0){const exact=candidates.filter(a=>!timer(a)&&norm(a.description)===norm(e.description)&&secondsOf(a)===remaining&&!used.has(id(a.id)));if(exact.length===1){allocate(exact[0],remaining);}else if(exact.length>1){e.conflict='Mehrere passende MOCO-Buchungen. Bitte prüfen.';}else if(e.isSelected&&!e.isHidden){const possible=candidates.filter(a=>!timer(a)&&secondsOf(a)>(used.get(id(a.id))||0));if(possible.length&&e.decision!=='additional'){if(e.decision==='credit'){for(const a of possible)allocate(a,Math.min(remaining,secondsOf(a)-(used.get(id(a.id))||0)));}else e.conflict='Möglicherweise bereits enthalten';}}}
      e.remainingSeconds=remaining;e.isSynced=remaining===0&&!e.conflict;
    }
    for(const e of entries){e.remainingSeconds=Math.max(0,e.totalSeconds-e.coveredSeconds);if(e.conflict)conflicts.push({sourceKey:e.sourceKey,reason:e.conflict});}
    return {entries,conflicts,allocations};
  }
  function buildBookingPlan({ctx,entries=[],activities=[],projects}){
    const items=[],conflicts=[],blocked=new Map(),actual=activities.filter(a=>inContext(a,ctx));
    const validTarget=e=>!projects||projects.some(p=>id(p.id)===id(e.projectId)&&p.active!==false&&(p.tasks||[]).some(t=>id(t.id)===id(e.taskId)&&t.active!==false));
    for(const e of entries){if(!e.isSelected||e.isHidden)continue;const reason=e.conflict||(!validTarget(e)?'Projekt oder Teilschritt ist nicht mehr aktiv.':'')||(actual.some(a=>pair(a)===pair(e)&&timer(a))?'Laufender Timer muss zuerst in MOCO geklärt werden.':'');if(reason){blocked.set(pair(e),reason);conflicts.push({sourceKey:e.sourceKey,reason});}}
    for(const e of entries){if(!e.isSelected||e.isSynced||e.isHidden)continue;const reason=blocked.get(pair(e))||(!e.projectId||!e.taskId?'Projekt zuordnen.':!String(e.description||'').trim()?'Kalenderbeschreibung fehlt.':'');if(reason){if(!conflicts.some(c=>c.sourceKey===e.sourceKey))conflicts.push({sourceKey:e.sourceKey,reason});continue;}const seconds=Math.max(0,Math.round(e.remainingSeconds??e.totalSeconds??0));if(seconds)items.push({sourceKey:e.sourceKey,kind:'calendar',date:ctx.date,projectId:e.projectId,taskId:e.taskId,seconds,description:e.description});}
    return {items,conflicts,totalSeconds:items.reduce((s,i)=>s+i.seconds,0),fingerprint:JSON.stringify(items)};
  }
  return {norm,pair,ctxKey,inContext,recordContext,signature,sourceSignature,secondsOf,stableSourceKey,reconcileDay,buildBookingPlan};
});
