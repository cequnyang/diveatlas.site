// Refresh old indexed pages from additive evidence, retaining SSR evidence when
// a release is unavailable. Identity changes must also update old page links.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeUrl = value => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return '';
  try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};

// The missing information is the depth definition, not the numeric value.
function presentDepthNotes(page) {
  page.querySelectorAll('.fact dd').forEach(value => {
    for (const node of [...value.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.includes('(unknown)')) continue;
      const parts = node.textContent.split('(unknown)');
      const fragment = document.createDocumentFragment();
      parts.forEach((part, index) => {
        if (index) {
          const note = document.createElement('small'); note.className = 'depth-meaning-unknown';
          fragment.append(note);
        }
        fragment.append(part);
      });
      node.replaceWith(fragment);
    }
  });
  const zh = document.documentElement.lang.startsWith('zh');
  page.querySelectorAll('.depth-meaning-unknown').forEach(note => {

    let button = note.previousElementSibling;
    if (!button?.classList.contains('depth-info-button')) {
      button = document.createElement('button');
      button.type = 'button'; button.className = 'depth-info-button';
      const icon = document.createElement('span'); icon.className = 'note-icon';
      icon.setAttribute('aria-hidden', 'true'); button.append(icon);
      note.id = `depth-explanation-${page.querySelectorAll('.depth-info-button').length + 1}`;
      note.hidden = true;
      button.setAttribute('aria-controls', note.id);
      button.setAttribute('aria-expanded', 'false');
      note.setAttribute('role', 'tooltip');
      button.setAttribute('aria-describedby', note.id);
      const show = visible => {
        note.hidden = !visible;
        button.setAttribute('aria-expanded', String(visible));
        if (!visible) return;
        // Fixed positioning keeps the fact grid unchanged and fits narrow screens.
        const anchor = button.getBoundingClientRect();
        const box = note.getBoundingClientRect();
        note.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8))}px`;
        note.style.top = `${anchor.bottom + box.height + 8 <= innerHeight ? anchor.bottom + 8 : Math.max(8, anchor.top - box.height - 8)}px`;
      };
      button.addEventListener('click', event => show(event.detail > 0 && matchMedia('(hover: hover)').matches ? true : note.hidden));
      button.addEventListener('mouseenter', () => { if (matchMedia('(hover: hover)').matches) show(true); });
      button.addEventListener('mouseleave', () => show(false));
      button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(true); });
      button.addEventListener('blur', () => show(false));
      button.addEventListener('keydown', event => { if (event.key === 'Escape') { show(false); event.preventDefault(); } });
      document.addEventListener('click', event => { if (!button.contains(event.target) && !note.contains(event.target)) show(false); });
      window.addEventListener('scroll', () => show(false), { passive:true });
      window.addEventListener('resize', () => show(false));
      note.before(button);
    }
    button.setAttribute('aria-label', zh ? '深度说明' : 'About this depth');
    note.textContent = zh
      ? '来源未说明这是最大深度，还是通常的潜水深度。'
      : 'The source does not say whether this is the maximum depth or the usual dive depth.';
  });
}

// Translate generated explanatory copy, never names, URLs, IDs or raw labels.
const evidenceOriginals = new WeakMap();
function localizedEvidence(text, zh) {
  if (!zh) return text;
  const phrases = [
    ['Recorded experience labels are source reports, not verified suitability. Depth alone does not establish difficulty.', '经验等级来自来源记录，并不代表已核实适合该等级的潜水员。不能仅凭深度判断难度。'],
    ['Recorded experience labels are source reports, not verified suitability.', '经验等级来自来源记录，并不代表已核实适合该等级的潜水员。'],
    ['Some depth meanings are unknown; these values cannot establish a same-depth disagreement or a typical dive depth.', '部分深度记录未说明是最大深度还是通常的潜水深度，因此不能据此认定来源存在深度分歧，也不能将其视为通常的潜水深度。'],
    ['Source observations disagree in comparable depths or experience labels. The reports above remain unresolved; route, depth meaning and suitability have not been verified. Values are not averaged.', '来源对可比较的深度或经验等级记录存在分歧，尚未解决。路线、深度含义及适用性尚未核实，数值未取平均。'],
    ['These records remain separate; differences are not an established same-site conflict.', '这些记录仍分别保留；尚不能认定这些差异属于同一潜点的资料冲突。'],
    ['The reviewed category record retains this source name without a direct site URL; it is provenance, not an independently inspectable citation.', '已审阅的分类记录仅保留来源名称，没有该潜点的直接链接；这是来源线索，无法作为可独立核查的引用。'],
    ['OpenStreetMap (listed source; direct record URL not retained)', 'OpenStreetMap（列出的来源；未保留原始记录链接）'],
    ['existing reviewed legacy type field', '已审阅的旧版类型字段'],
    ['Separate candidate observation — ', '候选记录的独立来源资料 — '],
    ['Imported record (listed providers: ', '导入记录（列出的提供方：'],
    ['Reference (summary-reference): ', '简介参考来源：'],
    ['Reference (category-reference): ', '分类参考来源：'],
    ['Nearby records with potentially related English and Japanese names. Shared site or route identity has not been established.', '附近记录的英文与日文名称可能相关，但尚未确认是否为同一潜点或路线。'],
    ['Third-party snapshot of the public SSI locator. Values are profile-reported; depth definitions can vary. Verify on the linked SSI page and with local operators.', '公开 SSI 潜点目录的第三方快照。数值来自该资料页面，深度定义可能不同。请通过所附 SSI 链接及当地运营方核实。'],
    ['Source summary note: ', '来源简介说明：'],
    ['Possible related record: ', '可能相关的记录：'],
    ['; coordinates ', '；坐标 '], ['; recorded labels: ', '；来源记录的等级：'],
    ['; depth: ', '；深度：'], ['Source URL: ', '来源链接：'],
    ['Source record ID: ', '来源记录编号：'], ['Retrieval date: ', '获取日期：'],
    ['Snapshot date: ', '快照日期：'], ['; reference ID: ', '；参考编号：'],
    ['; recorded retrieval date: ', '；记录的获取日期：'], ['; URL: ', '；链接：'],
    ['(unknown)', '（未说明深度含义）'], ['(maximum)', '（最大深度）'], ['(typical)', '（通常的潜水深度）']
  ];
  let result = text;
  for (const [from, to] of phrases) result = result.split(from).join(to);
  // Missingness markers are generated field values, not inferred provenance.
  return result.replace(/导入记录（列出的提供方：([^)]*)\)/g, '导入记录（列出的提供方：$1）').replace(/：not retained/g, '：未保留').replace(/：unknown/g, '：未知')
    .replace(/：not recorded/g, '：未记录');
}

// Keep the full explanation and verbatim audit trail in one optional reading layer.
function presentEvidence(section) {
  const list = section.querySelector('.record-evidence-notes') || section.querySelector(':scope > ul');
  if (!list) return;
  list.classList.add('record-evidence-notes');
  let details = section.querySelector('details');
  if (!details) {
    section.querySelector('h2')?.remove();
    const warning = document.createElement('p');
    warning.className = 'record-evidence-summary';
    details = document.createElement('details');
    const summary = document.createElement('summary');
    const icon = document.createElement('span'); icon.className = 'note-icon';
    icon.setAttribute('aria-hidden', 'true');
    const action = document.createElement('span'); action.className = 'record-evidence-action';
    summary.append(icon, action);
    const metadata = document.createElement('details');
    metadata.className = 'record-evidence-metadata';
    const metadataLabel = document.createElement('summary');
    metadata.append(metadataLabel, list);
    details.append(summary, warning, metadata);
    section.append(details);
    // The shared notice is now part of this disclosure, rather than a second footer.
    section.closest('main')?.querySelector('.data-note')?.remove();
    const update = () => {
      const zh = document.documentElement.lang.startsWith('zh');
      metadataLabel.textContent = zh ? '原始记录与未核实信息' : 'Original records and uncertainties';
      const originals = [...list.children].map(item => {
        if (!evidenceOriginals.has(item)) evidenceOriginals.set(item, item.textContent);
        const original = evidenceOriginals.get(item);
        const localized = localizedEvidence(original, zh);
        if (item.textContent !== localized) item.textContent = localized;
        return original;
      }).join(' ');
      const unresolved = /remain separate|identity.*unresolved|identity has not been established/i.test(originals);
      const conflict = originals.includes('Source observations disagree');
      action.textContent = zh
        ? '查看来源与说明' + (conflict || unresolved ? ' · 有待核实' : '')
        : 'Sources and notes' + (conflict || unresolved ? ' · unresolved records' : '');
      warning.textContent = zh
        ? '资料来自外部记录，可能与当前状况不同，也未核实是否适合你的经验水平。潜水前请查看当地指引。' + (conflict ? '来源对深度或经验等级的记录存在分歧，尚待核实。' : '') + (unresolved ? '发现可能相关的潜点，但尚未确认是否为同一地点；目前仍分别展示。' : '')
        : 'Source records may not reflect current conditions or verify suitability for your experience level. Check local guidance before diving.' + (conflict ? ' Sources disagree on recorded depths or experience labels; this remains unresolved.' : '') + (unresolved ? ' A possibly related site remains unconfirmed; the records are kept separate.' : '');
    };
    section._updateEvidenceSummary = update;
    new MutationObserver(update).observe(document.documentElement, { attributes:true, attributeFilter:['lang'] });
  }
  section._updateEvidenceSummary?.();
  // Keep publisher links in the same disclosure as their provenance notes,
  // including SSR links when the optional evidence request is unavailable.
  const sources = section.closest('main')?.querySelector('.source-section');
  if (sources && sources.parentElement !== details) details.insertBefore(sources, details.querySelector('.record-evidence-metadata'));
}

export async function enhanceRecordedEvidence() {
  const page = document.querySelector('main[data-site-id]');
  const facts = page?.querySelector('.fact-grid');
  if (!page || !facts) return;
  const id = page.dataset.siteId;
  if (!uuid.test(id)) return;
  const existing = page.querySelector('.record-evidence');
  const section = existing || document.createElement('section');
  section.className = 'detail-section record-evidence';
  section.setAttribute('data-i18n-ignore', '');
  if (!existing) {
    const heading = document.createElement('h2');
    heading.textContent = 'Source evidence and uncertainty';
    const list = document.createElement('ul');
    const note = document.createElement('li');
    note.textContent = 'Source definitions and identity have not been verified. Recorded labels do not establish suitability.';
    list.append(note); section.append(heading, list);
    page.querySelector('.facts-section')?.after(section);
  }
  presentEvidence(section);
  presentDepthNotes(page);
  new MutationObserver(() => presentDepthNotes(page)).observe(document.documentElement, { attributes:true, attributeFilter:['lang'] });
  const translated = label => window.DiveAtlasSiteDetailI18n?.translate(label) || label;
  const factFor = (field, labels) => facts.querySelector(`[data-record-field="${field}"]`)
    || [...facts.querySelectorAll('.fact')].find(fact => labels.some(label =>
      [label, translated(label)].includes(fact.querySelector('dt')?.textContent)));
  let difficulty = factFor('difficulty', ['Difficulty', 'Recorded experience levels']);
  let depth = factFor('depth', ['Recorded depth', 'Recorded depth range', 'Source-reported depths', 'Depth (meaning unverified)'])
    || facts.querySelector('[data-depth-min]')?.closest('.fact');
  if (!existing) {
    if (difficulty) {
      difficulty.dataset.recordField = 'difficulty';
      difficulty.querySelector('dt').textContent = 'Recorded experience levels';
      difficulty.querySelector('dd').textContent = 'Unverified — source evidence unavailable';
    }
    if (depth) depth.querySelector('dt').textContent = 'Depth (meaning unverified)';
    const directories = new Set(['https://www.openstreetmap.org/', 'https://www.padi.com/dive-sites/all/',
      'https://www.divessi.com/en/locator/divesites']);
    page.querySelectorAll('.source-section a[href]').forEach(link => {
      if (directories.has(link.href)) link.textContent += ' (provider directory; record URL not retained)';
    });
  }
  try {
    const path = `data/dive-site-details/v1/${id}.json`;
    const assets = window.DiveAtlasDataAssets;
    const response = await fetch(assets?.external ? assets.url(path) : `/${path}`, { signal:AbortSignal.timeout(15000) });
    if (!response.ok) return;
    const record = await response.json();
    if (record.site_id !== id || !Array.isArray(record.evidence_notes)) return;
    const canonical = record.canonical_id || id;
    const members = record.identity_members || [id];
    if (!uuid.test(canonical) || !Array.isArray(members) || !members.every(value => uuid.test(value))
      || !members.includes(id) || !members.includes(canonical)
      || (canonical !== id || members.length > 1) && record.identity_status !== 'confirmed') return;
    page.dataset.canonicalId = canonical;
    page.dataset.identityMembers = members.join(',');
    if (canonical !== id) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.append(link); }
      link.href = `${location.origin}/dive-site.html?id=${encodeURIComponent(canonical)}`;
    }
    if (!difficulty && record.difficulty) {
      difficulty = document.createElement('div'); difficulty.className = 'fact';
      difficulty.append(document.createElement('dt'), document.createElement('dd')); facts.append(difficulty);
    }
    if (difficulty) {
      difficulty.dataset.recordField = 'difficulty';
      difficulty.querySelector('dt').textContent = 'Recorded experience levels';
      difficulty.querySelector('dd').textContent = record.difficulty || 'Not recorded';
    }
    section.querySelector('.record-evidence-notes').replaceChildren(...record.evidence_notes.map(text => {
      const item = document.createElement('li'); item.textContent = text; return item;
    }));
    presentEvidence(section);
    const recordedDepths = (record.observations || []).flatMap(observation => observation.depths || []);
    // Deduplicate identical value/meaning pairs, but keep different source meanings visible.
    const depths = [...new Map(recordedDepths.map(item => [`${item.value}:${item.meaning}`, item])).values()];
    if (!depth && depths.length) {
      depth = document.createElement('div'); depth.className = 'fact';
      depth.append(document.createElement('dt'), document.createElement('dd')); facts.append(depth);
    }
    if (depth) {
      depth.dataset.recordField = 'depth';
      depth.querySelector('dt').textContent = 'Source-reported depths';
      const value = depth.querySelector('dd');
      value.removeAttribute('data-depth-min'); value.removeAttribute('data-depth-max'); value.replaceChildren();
      for (const [index, item] of depths.entries()) {
        if (index) value.append('; ');
        const measurement = document.createElement('span');
        measurement.dataset.depthMin = measurement.dataset.depthMax = String(item.value);
        measurement.textContent = `${item.value} m`; value.append(measurement, ` (${item.meaning})`);
      }
      if (!depths.length) value.textContent = 'Not recorded';
    }
    presentDepthNotes(page);
    const sources = (record.sources || []).filter(source => Array.isArray(source) && safeUrl(source[1]));
    let sourceSection = page.querySelector('.source-section');
    if (!sources.length) sourceSection?.remove();
    else {
      if (!sourceSection) {
        sourceSection = document.createElement('section'); sourceSection.className = 'detail-section source-section';
        const heading = document.createElement('h2'); heading.textContent = 'Sources';
        const list = document.createElement('ul'); list.className = 'source-list';
        sourceSection.append(heading, list); section.after(sourceSection);
      }
      sourceSection.querySelector('ul').replaceChildren(...sources.map(source => {
        const item = document.createElement('li'); const link = document.createElement('a');
        link.href = safeUrl(source[1]); link.textContent = source[0] || 'Reference';
        link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link); return item;
      }));
    }
    presentEvidence(section);
    // Older cards may have only a URL, so use explicit identity URL membership;
    // never coordinates, distance or name similarity to remove a recommendation.
    const identityPaths = new Set((record.identity_urls || []).map(value => new URL(value, location.origin).pathname));
    const removeSelfRecommendations = () => {
      document.querySelectorAll('.site-recommendations a[href]').forEach(link => {
        const url = new URL(link.href, location.origin);
        const queryId = url.searchParams.get('id')?.match(/[0-9a-f-]{36}$/i)?.[0];
        if (members.includes(link.dataset.siteId) || members.includes(queryId)
          || url.pathname.startsWith('/dive-sites/') && identityPaths.has(url.pathname)) link.closest('li')?.remove();
      });
    };
    removeSelfRecommendations();
    if (members.length > 1) {
      const observer = new MutationObserver(removeSelfRecommendations);
      document.querySelectorAll('.site-recommendations').forEach(area => observer.observe(area, { childList:true, subtree:true }));
    }
    window.dispatchEvent(new Event('diveatlas:record-evidence-ready'));
  } catch {
    // Existing SSR evidence remains intact; older pages keep their unknown state.
  }
}
