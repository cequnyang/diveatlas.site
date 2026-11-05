/* Private loopback overlay. One exact-ID record request, never a catalogue download. */
(() => {
  'use strict';
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url=s=>{try{const u=new URL(s);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
  const requests=new Map();
  function approvedGalleryMedia(record) {
    return (Array.isArray(record.media)?record.media:[]).filter(m=>
      m.display_status==='approved-local-preview'&&
      (m.local_preview_approved_by_user===true||(m.license_verified===true&&m.subject_review_status==='matched'))&&
      ((m.kind==='photograph'&&m.format==='jpg')||(['site-map','seabed-diagram'].includes(m.kind)&&m.format==='png'))&&
      /^[a-z0-9][a-z0-9-]{0,79}$/.test(m.media_id||'')&&url(m.source_page_url)&&url(m.license_url)
    ).sort((a,b)=>Number(a.kind==='photograph')-Number(b.kind==='photograph'));
  }
  function mediaMarkup(record) {
    const references=(Array.isArray(record.media)?record.media:[]).filter(m=>m.display_status==='reference-only'&&url(m.source_page_url));
    return references.length?`<details class="enrichment-media-references"><summary>Source maps awaiting review</summary><ul>${references.map(m=>`<li><a href="${escape(url(m.source_page_url))}" target="_blank" rel="noopener noreferrer">${escape(m.title)}</a><p>${escape(m.pending_reason)}</p></li>`).join('')}</ul></details>`:'';
  }
  const style=document.createElement('style');
  style.textContent='.enrichment-guide p,.enrichment-guide li{line-height:1.65}.enrichment-guide details,.enrichment-queued{border:1px solid var(--line);border-radius:10px;padding:14px;margin:18px 0}.enrichment-guide summary,.enrichment-queued summary{cursor:pointer;min-height:32px;font-weight:600}.enrichment-guide summary:focus-visible,.enrichment-queued summary:focus-visible{outline:2px solid var(--primary);outline-offset:4px}.enrichment-guide a{overflow-wrap:anywhere}.enrichment-marker{font-size:13px;color:var(--muted)}';
  style.textContent+='.enrichment-maps figure{margin:16px 0;padding:12px;border:1px solid var(--line);border-radius:10px}.enrichment-maps img{display:block;width:100%;height:auto;max-height:360px;object-fit:contain;background:#fff}.enrichment-maps figcaption{font-size:13px;line-height:1.5;margin-top:10px}.enrichment-maps figcaption p{margin:6px 0}.enrichment-maps a{overflow-wrap:anywhere}.enrichment-maps>details{padding:12px;border:1px solid var(--line);border-radius:10px}';
  // Keep the established hero dimensions; crop only its image, never the full-size preview.
  style.textContent+='.enrichment-cropped-media .site-photo-preview-trigger img{object-fit:cover!important;object-position:center!important;animation:none!important;offset-path:none!important;transform:none!important}';
  style.textContent+='.enrichment-credit-content{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.4}.enrichment-credit-expanded .enrichment-credit-content{display:block;-webkit-line-clamp:unset;overflow:visible}.enrichment-credit{display:flex;align-items:flex-start;gap:4px}.enrichment-credit-content{flex:1;min-width:0}.enrichment-credit-toggle{display:flex;flex:0 0 24px;align-items:center;justify-content:center;width:24px;height:1.4em;margin:0;padding:0;border:0;border-radius:4px;color:inherit;background:transparent;cursor:pointer}.enrichment-credit-toggle:hover{background:rgba(255,255,255,.15)}.enrichment-credit-toggle svg{transform:rotate(180deg)}.enrichment-credit-expanded .enrichment-credit-toggle svg{transform:rotate(0deg)}.enrichment-credit-toggle[hidden]{display:none}.enrichment-credit-toggle:focus-visible{outline:2px solid white;outline-offset:2px}';

  style.textContent+='.enrichment-guide > p{max-width:none;width:100%}';
  style.textContent+='.dive-popup-summary [data-guide-overview]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}';
  document.head.append(style);
  const off=()=>{const q=new URLSearchParams(location.search);q.set('enrichment','off');q.set('pilot','off');return '?'+q;};
  function collapsibleCredit(caption) {
    const content=document.createElement('span');content.className='enrichment-credit-content';
    content.append(...caption.childNodes);caption.append(content);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='enrichment-credit-toggle';
    toggle.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';toggle.setAttribute('aria-label','Show full credit');toggle.title='Show full credit';toggle.setAttribute('aria-expanded','false');toggle.hidden=true;caption.prepend(toggle);caption.classList.add('enrichment-credit');
    let timer;
    const collapse=()=>{clearTimeout(timer);caption.classList.remove('enrichment-credit-expanded');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Show full credit');toggle.title='Show full credit';};
    toggle.addEventListener('click',event=>{
      event.stopPropagation();
      if(caption.classList.contains('enrichment-credit-expanded')){collapse();return;}
      caption.classList.add('enrichment-credit-expanded');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Collapse credit');toggle.title='Collapse credit';
      timer=setTimeout(collapse,15000);
    });
    const resize=new ResizeObserver(()=>{
      if(!caption.isConnected){clearTimeout(timer);resize.disconnect();return;}
      if(!caption.classList.contains('enrichment-credit-expanded'))toggle.hidden=content.scrollHeight<=content.clientHeight+1;
    });resize.observe(content);
  }
  function leadWithApprovedPhoto(page, record) {
    const photos=approvedGalleryMedia(record);
    const container=page.querySelector('.site-photo-gallery-main');
    const trigger=container?.querySelector('.site-photo-preview-trigger');
    const image=trigger?.querySelector('img');
    if(!photos.length||!image)return;
    // This promotion is confined to the private overlay and grants no publication rights.
    const gallery=photos.map(m=>({src:`/__local/enrichment-media/v1/${record.site_id}/${m.media_id}.${m.format}`,alt:m.alt||m.title,credit:`${m.title} · ${m.creator} · ${m.license_label} · ${m.content_date||'Date unknown'}. ${m.scope_notice||''} ${m.changes||''} ${m.use_notice||''}`}));
    container.closest('.site-photo-feature')?.classList.add('enrichment-cropped-media');
    image.src=gallery[0].src;image.alt=gallery[0].alt;
    container.querySelectorAll('.site-photo-upload-label,.site-photo-upload-label-mobile,.site-photo-upload-button').forEach(node=>node.remove());
    container.classList.remove('site-photo-gallery-main--photo-upload');
    let caption=container.querySelector('figcaption');
    if(!caption){caption=document.createElement('figcaption');container.append(caption);}
    caption.textContent=gallery[0].credit;
    for(const [label,href] of [['Source',photos[0].source_page_url],[photos[0].license_label,photos[0].license_url]]){
      const link=document.createElement('a');link.href=url(href);link.textContent=label;link.target='_blank';link.rel='noopener noreferrer';caption.append(' · ',link);
    }
    collapsibleCredit(caption);
    trigger.addEventListener('click',event=>{
      if(!window.DiveAtlasPhotoPreview)return;
      event.preventDefault();event.stopImmediatePropagation();
      window.DiveAtlasPhotoPreview.open({photos:gallery,selectedPhotoIndex:0});
    },true);
  }
  function mount(page,record) {
    if(page.querySelector('[data-enrichment]'))return;
    if(record.site_id!==page.dataset.siteId)return;
    leadWithApprovedPhoto(page,record);
    if(!['authored-draft','named-site-background'].includes(record.status)){
      page.dataset.enrichmentAbsent='true';return;
    }
    const section=document.createElement('section');section.className='detail-section';section.dataset.enrichment=record.status;section.setAttribute('data-i18n-ignore','');
    if(record.site_id!==page.dataset.siteId || !Array.isArray(record.claims) || !Array.isArray(record.sources))return;
    const sourceMap=new Map(record.sources.map(s=>[s.source_id,s]));
    const background=record.coverage_classification==='named-site-background';
    function citation(id){const s=sourceMap.get(id);if(!s)return 'Source unavailable';const href=url(s.url);return href?`<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(s.label)}</a>`:escape(s.label)+' (URL unavailable)';}
    section.classList.add('enrichment-guide');
    section.setAttribute('aria-label','Site guide local draft');
    section.innerHTML=`
      <p>${escape(record.overview)}</p>
      ${mediaMarkup(record)}
      <h3>Access &amp; planning context</h3><p>${escape(record.access_notes)}</p>
      ${record.park_context?`<p>${escape(record.park_context)}</p>`:''}
      <details class="enrichment-evidence"><summary>Sources, unknowns &amp; draft review</summary>
      <p>Local evidence/editorial review: ${escape(record.local_reviewed_at)}. This is not a new web check. Source checks and recorded retrieval dates are listed separately below.</p>
      <h3>Claim evidence and confidence</h3><ul>${record.claims.map(c=>`<li><strong>${escape(c.value)}</strong><p>${c.source_ids.length?c.source_ids.map(citation).join(' · '):'Editorial suggestion; no external factual source.'}</p>${c.evidence_reference||c.evidence_references?`<p>Evidence location: ${escape(c.evidence_reference||(Array.isArray(c.evidence_references)?c.evidence_references.join(' · '):c.evidence_references))}</p>`:''}<p>${escape(c.confidence)} ${escape(c.limitations)}</p><p>Review: ${escape(c.review_status)}. Reuse: ${escape(c.reuse_status)}.</p></li>`).join('')}</ul>
      <h3>Unknown / unset in this guide</h3><ul>${record.unknowns.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>
      <p>Existing recorded facts elsewhere on this page are separate source reports. This draft does not verify, replace or resolve them.</p>
      <h3>Conflicts and review limits</h3><ul>${record.conflicts.length?record.conflicts.map(s=>`<li>${escape(s)}</li>`).join(''):'<li>No new conflict resolution performed; absence of a flag is not agreement.</li>'}</ul>
      <h3>Identity</h3>${background?`<p>${escape(record.visitor_scope_notice)}</p>`:''}<p>${escape(record.identity_basis)}</p><p>Exact record UUID: ${escape(record.site_id)}.</p>
      <h3>Reuse clearance — ${escape(record.reuse_clearance)}</h3><ul>${record.reuse_notes.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>
      <h3>Source records &amp; dates</h3><ul>${record.sources.map(s=>`<li>${citation(s.source_id)}<p>Publisher/domain: ${escape(s.publisher)}. Web checked: ${escape(s.checked_at||'unknown / not performed')}${s.checked_by?` (${escape(s.checked_by)})`:''}. Recorded retrieval: ${escape(s.retrieved_at||'unknown')}. Snapshot: ${escape(s.snapshot_at||'unknown')}. Publication: ${escape(s.publication_date||'unknown')}. Source update: ${escape(s.updated_at||'unknown')}.</p>${s.evidence_reference?`<p>Evidence location: ${escape(s.evidence_reference)}</p>`:''}${s.retained_snapshot_reference?`<p>Retained snapshot reference (not a new check): ${escape(s.retained_snapshot_reference)}</p>`:''}<p>${escape(s.reuse_basis)} ${escape(s.limitations||'')}</p></li>`).join('')}</ul>
      <p>Guide evidence, reuse and human release gates remain on hold. Media attribution and reuse terms are stated separately where shown. No publication authorization.</p></details>`;
    const intro=page.querySelector('.intro-details,.site-intro-detail');
    if(intro){intro.hidden=true;intro.after(section);}else page.querySelector('.site-hero').after(section);
  }
  function relocateDraftEvidence(page) {
    const evidence=page?.querySelector('.enrichment-guide > .enrichment-evidence');
    const sources=page?.querySelector('.record-evidence > details');
    if(!evidence||!sources)return;
    // The source disclosure mounts asynchronously; move the original nodes so
    // provenance stays intact without creating another competing disclosure.
    const group=document.createElement('div');group.className='enrichment-evidence';
    group.setAttribute('data-i18n-ignore','');
    const heading=document.createElement('h3');heading.textContent=evidence.querySelector('summary').textContent;
    evidence.querySelector('summary').remove();
    group.append(heading,...evidence.childNodes);sources.append(group);evidence.remove();
  }
  function relocatePlanningNotes(page) {
    const guide=page?.querySelector('.enrichment-guide');
    const sources=page?.querySelector('.record-evidence > details');
    if(!guide||!sources)return;
    const heading=[...guide.querySelectorAll(':scope > h3')].find(h=>h.textContent==='Access & planning context');
    if(!heading)return;
    const group=document.createElement('div');group.className='enrichment-planning-notes';group.setAttribute('data-i18n-ignore','');
    let next=heading.nextElementSibling;group.append(heading);
    while(next&&next.tagName==='P'){const following=next.nextElementSibling;group.append(next);next=following;}
    sources.append(group);
  }
  const mapRequests=new Map();
  function inspectMapPopups() {
    for(const popup of document.querySelectorAll('.dive-site-popup')){
      const link=popup.querySelector('.bio-popup-title a[href*="dive-site"],.dive-popup-summary a[href*="dive-site"]');
      if(!link)continue;
      const href=new URL(link.href,location.href);
      const id=href.searchParams.get('id')?.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)?.[0]?.toLowerCase();
      if(!id)continue;
      if(!mapRequests.has(id))mapRequests.set(id,fetch(`/__local/enrichment/v1/${id}.json`,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Guide unavailable');return r.json();}).catch(()=>null));
      mapRequests.get(id).then(record=>{
        if(!record||!popup.isConnected||link.href!==href.href)return;
        const authored=['authored-draft','named-site-background'].includes(record.status);
        const slot=popup.querySelector('.dive-popup-summary-slot');
        if(authored&&slot&&slot.querySelector('[data-guide-overview]')?.dataset.guideOverview!==id){
          const summaryLink=document.createElement('a');summaryLink.className='dive-popup-detail-link';summaryLink.href=href.href;summaryLink.target='_blank';summaryLink.rel='noopener noreferrer';
          const content=document.createElement('div');content.className='dive-popup-summary__content';
          const heading=document.createElement('div');heading.className='dive-popup-summary__heading';heading.textContent=slot.querySelector('.dive-popup-summary__heading')?.textContent||'Summary';
          const text=document.createElement('p');text.dataset.guideOverview=id;text.setAttribute('data-i18n-ignore','');text.textContent=record.overview;
          content.append(heading,text);summaryLink.append(content);slot.replaceChildren(summaryLink);slot.classList.add('dive-popup-summary');slot.hidden=false;slot.dataset.loaded='true';slot.dataset.guideSite=id;
          window.dispatchEvent(new CustomEvent('diveatlas:guide-popup-updated',{detail:{element:popup}}));
        }
        let sourceArea=popup.querySelector('.dive-popup-sources__tooltip');
        if(!sourceArea&&(authored||approvedGalleryMedia(record).length)){
          const details=document.createElement('details');details.className='bio-popup-source dive-popup-source--compact dive-popup-sources';
          const summary=document.createElement('summary');summary.textContent='Sources';
          sourceArea=document.createElement('div');sourceArea.className='dive-popup-sources__tooltip';details.append(summary,sourceArea);
          (popup.querySelector('.dive-popup-body,.bio-popup')||popup).append(details);
        }
        if(authored&&sourceArea&&!sourceArea.querySelector('[data-guide-sources]')){
          const group=document.createElement('div');group.dataset.guideSources=id;
          for(const source of record.sources||[]){if(!url(source.url))continue;const a=document.createElement('a');a.href=url(source.url);a.textContent=source.label;a.target='_blank';a.rel='noopener noreferrer';if(group.childNodes.length)group.append(' · ');group.append(a);}
          sourceArea.append(group);
        }
        const photos=approvedGalleryMedia(record);
        if(!photos.length||popup.dataset.guidePhoto===id)return;
        const frame=popup.querySelector('.dive-popup-photo-frame'),trigger=frame?.querySelector('.dive-popup-photo-trigger');
        if(!trigger)return;
        const gallery=photos.map(m=>({src:`/__local/enrichment-media/v1/${id}/${m.media_id}.${m.format}`,alt:m.alt||m.title,credit:`${m.title} · ${m.creator} · ${m.license_label} · ${m.content_date||'Date unknown'}. ${m.scope_notice||''} ${m.changes||''} ${m.use_notice||''}`}));
        for(const image of frame.querySelectorAll('img')){image.src=gallery[0].src;if(!image.classList.contains('dive-popup-photo-backdrop'))image.alt=gallery[0].alt;}
        frame.querySelectorAll('.dive-popup-photo-label').forEach(node=>node.remove());
        let credit=popup.querySelector('.dive-popup-photo-credit');
        if(!credit){credit=document.createElement('div');credit.className='dive-popup-photo-credit';popup.querySelector('.dive-popup-body')?.append(credit);}
        credit.textContent=`${photos[0].creator} · ${photos[0].license_label}`;
        if(sourceArea&&!sourceArea.querySelector('[data-guide-media-notes]')){const notes=document.createElement('p');notes.dataset.guideMediaNotes=id;notes.textContent=gallery[0].credit;sourceArea.append(notes);}
        for(const [label,source] of [['Source',photos[0].source_page_url],[photos[0].license_label,photos[0].license_url]]){const a=document.createElement('a');a.textContent=label;a.href=url(source);a.target='_blank';a.rel='noopener noreferrer';credit.append(' · ',a);}
        trigger.addEventListener('click',event=>{if(!window.DiveAtlasPhotoPreview)return;event.preventDefault();event.stopImmediatePropagation();window.DiveAtlasPhotoPreview.open({photos:gallery,selectedPhotoIndex:0});},true);
        popup.dataset.guidePhoto=id;
        window.dispatchEvent(new CustomEvent('diveatlas:guide-popup-updated',{detail:{element:popup}}));
      });
    }
  }
  const recommendationIds=new WeakMap();
  function inspectRecommendations() {
    for(const card of document.querySelectorAll('.site-recommendations__card')){
      const href=new URL(card.href,location.href);
      if(href.origin!==location.origin)continue;
      let identity=recommendationIds.get(card);
      if(!identity||identity.href!==href.href){
        const direct=href.searchParams.get('id')?.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)?.[0];
        // Legacy static cards carry a slug URL rather than a UUID. Resolve the
        // destination's own exact ID instead of guessing from names or location.
        const promise=direct?Promise.resolve(direct.toLowerCase()):fetch(href.href).then(r=>r.ok?r.text():'').then(html=>html.match(/<main[^>]+data-site-id="([a-f0-9-]{36})"/i)?.[1]||null).catch(()=>null);
        identity={href:href.href,promise};recommendationIds.set(card,identity);
      }
      identity.promise.then(id=>{
        if(!id||!uuid.test(id)||!card.isConnected||card.href!==href.href)return;
        if(!mapRequests.has(id))mapRequests.set(id,fetch(`/__local/enrichment/v1/${id}.json`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null));
        return mapRequests.get(id).then(record=>{
          if(!record||!card.isConnected||card.href!==href.href)return;
          const media=approvedGalleryMedia(record)[0];if(!media)return;
          const src=`/__local/enrichment-media/v1/${id}/${media.media_id}.${media.format}`;
          let image=card.querySelector('.site-recommendations__image');
          if(!image)return;
          if(image.tagName!=='IMG'){const replacement=document.createElement('img');replacement.className='site-recommendations__image';replacement.alt='';replacement.loading='lazy';image.replaceWith(replacement);image=replacement;}
          if(image.getAttribute('src')!==src)image.src=src;
          image.classList.remove('site-recommendations__image--placeholder');
          image.title=`${media.title} · ${media.creator} · ${media.license_label}`;
        });
      });
    }
  }
  function inspect(){
    inspectMapPopups();
    inspectRecommendations();
    const page=document.querySelector('main[data-site-id]');const id=page?.dataset.siteId;
    relocateDraftEvidence(page);
    relocatePlanningNotes(page);
    if(page?.dataset.enrichmentAbsent==='true'||!uuid.test(id||'')||!page.querySelector('.site-hero')||page.querySelector('[data-enrichment]'))return;
    if(!requests.has(id))requests.set(id,fetch(`/__local/enrichment/v1/${id}.json`,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`Local enrichment ${r.status}`);return r.json();}));
    requests.get(id).then(record=>{if(page.isConnected&&page.dataset.siteId===id)mount(page,record);}).catch(()=>{
      // A failed request is not converted into an empty or complete guide.
      if(!page.querySelector('[data-enrichment]')){const note=document.createElement('p');note.dataset.enrichment='unavailable';note.className='enrichment-marker';note.textContent='Local guide research could not load; existing record unchanged.';page.append(note);}
    });
  }
  new MutationObserver(inspect).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});inspect();
})();
