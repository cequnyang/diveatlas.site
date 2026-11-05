/* Local guide translations preserve original text nodes and source link targets. */
(() => {
  'use strict';
  const originals=new WeakMap(),cache=new Map(),pending=new Map();
  const supported=new Set(['zh','zh-TW','ja','fr','de','nl','it','ru','pt','sv','no','es','ko','id']);
  let scheduled=false;
  function language(){const value=document.documentElement.lang||'en';return supported.has(value)?value:supported.has(value.split('-')[0])?value.split('-')[0]:'en';}
  function schedule(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;update();},40);}
  async function ensure(lang,texts){
    const key=lang+'\0'+JSON.stringify(texts);
    if(pending.has(key))return pending.get(key);
    const task=(async()=>{try{const r=await fetch('/__local/guide-translation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language:lang,texts})});if(!r.ok)throw Error('Translation unavailable');const data=await r.json();if(data.language!==lang||data.translations.length!==texts.length)throw Error('Translation mismatch');texts.forEach((text,i)=>cache.set(lang+'\0'+text,data.translations[i]));}catch(error){console.warn('Local guide translation unavailable; original retained.',error);texts.forEach(text=>cache.set(lang+'\0'+text,text));}finally{pending.delete(key);schedule();}})();
    pending.set(key,task);return task;
  }
  function update(){
    const lang=language();const roots=[...document.querySelectorAll('.enrichment-guide,[data-guide-overview],.record-evidence > details[open] .enrichment-evidence,.record-evidence > details[open] .enrichment-planning-notes')];
    const missing=new Set();
    for(const root of roots){
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode;
        // Publisher names, URLs and licenses remain verbatim; translate narrative text.
        if(node.parentElement.closest('script,style')||(node.parentElement.closest('a')&&!node.parentElement.closest('[data-guide-overview]')))continue;
        if(!originals.has(node))originals.set(node,node.data);
        const source=originals.get(node);if(!source.trim()||!/[a-zA-Z]{2}/.test(source))continue;
        const translated=lang==='en'?source:cache.get(lang+'\0'+source);
        if(translated!==undefined){if(node.data!==translated)node.data=translated;}
        else {if(node.data!==source)node.data=source;missing.add(source);}
      }
    }
    // Only visible guide prose is translated initially; evidence waits until opened.
    const texts=[...missing];for(let i=0;i<texts.length;i+=20){const batch=texts.slice(i,i+20);const inflight=[...pending.keys()].some(k=>k.startsWith(lang+'\0')&&batch.every(t=>JSON.parse(k.slice(lang.length+1)).includes(t)));if(!inflight)ensure(lang,batch);}
  }
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  document.addEventListener('toggle',schedule,true);
  window.addEventListener('diveatlas:language-change',schedule);
  schedule();
})();
