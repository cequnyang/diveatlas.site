import {reviewedPhotos} from './dive-site-reviewed-photo-catalog.js';

const byId = new Map(reviewedPhotos.map(photo => [photo.siteId, photo]));
const bySlug = new Map(reviewedPhotos.map(photo => [photo.slug, photo]));
const uuid = /(?:^|-)([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
export function photoForLink(href) {
  try {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return null;
    if (url.pathname === '/dive-site.html') return byId.get(url.searchParams.get('id')?.match(uuid)?.[1]) || null;
    const slug = url.pathname.match(/^\/dive-sites\/([^/]+)\/?$/)?.[1];
    return slug ? bySlug.get(decodeURIComponent(slug)) || null : null;
  } catch { return null; }
}

// Keep context imagery separate from the personal/owned exact-site registry.
// A stable UUID or the existing published permalink is required; names and
// proximity must never propagate an assignment to a different site.
window.DiveAtlasReviewedPhotos = {
  get: id => byId.get(id) || null,
  photoForLink,
  appendCredit(node, photo) {
    node.replaceChildren(document.createTextNode(photo.label + ' · ' + photo.creator + ' · '));
    for (const [index, item] of photo.links.entries()) {
      if (index) node.append(' · ');
      const a = document.createElement('a');
      a.href = item.url; a.textContent = item.label; a.rel = 'noreferrer';
      node.append(a);
    }
    node.append(' · Cropped/resized');
  }
};

const selector = 'a[href*="/dive-sites/"], a[href*="/dive-site.html"]';
const pending = new WeakMap();
const decorated = new WeakSet();
const style = document.createElement('style');
style.textContent = `.reviewed-thumbnail-card{position:relative}.reviewed-thumbnail-tag{position:absolute;z-index:2;pointer-events:none;box-sizing:border-box;padding:2px 4px;border-radius:3px;color:white;background:#102b40c9;font:10px/1.2 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.reviewed-thumbnail-tag--credit{font-size:8px}`;
document.head.append(style);
function labelThumbnail(card, image, photo) {
  card.querySelectorAll('[data-reviewed-thumbnail-tag]').forEach(node => node.remove());
  card.classList.add('reviewed-thumbnail-card');
  const label = document.createElement('span');
  const credit = document.createElement('span');
  for (const node of [label, credit]) {
    node.dataset.reviewedThumbnailTag = '';
    node.className = 'reviewed-thumbnail-tag';
    node.setAttribute('aria-hidden', 'true');
  }
  credit.classList.add('reviewed-thumbnail-tag--credit');
  credit.textContent = `${photo.creator} · ${photo.license}`;
  card.append(label, credit);
  const position = () => {
    const frame = card.getBoundingClientRect();
    const box = image.getBoundingClientRect();
    label.textContent = box.width < 120
      ? (photo.label.includes('Above/below') ? 'Above/below' : photo.label.includes('Underwater') ? 'Underwater' : photo.label.includes('context') || photo.label.includes('Nearby') ? 'Context' : 'Surface')
      : photo.label;
    for (const node of [label, credit]) {
      node.style.left = `${box.left - frame.left + 2}px`;
      node.style.width = `${Math.max(0, box.width - 4)}px`;
    }
    label.style.top = `${box.top - frame.top + 2}px`;
    credit.style.top = `${box.bottom - frame.top - 14}px`;
  };
  position();
  // Filters can reveal initially hidden cards; recalculate without changing
  // their image sizing or the existing card grid.
  const resize = new ResizeObserver(() => {
    if (!image.isConnected) resize.disconnect();
    else position();
  });
  resize.observe(image);
}
async function updateCard(card) {
  const photo = photoForLink(card.href);
  if (!photo) return;
  const old = card.querySelector('img, .site-recommendations__image--placeholder');
  if (!old || old.classList.contains('reviewed-photo')) return;
  if (old.dataset.reviewedThumbnail === photo.siteId && old.getAttribute('src') === photo.src) {
    if (!decorated.has(old)) {
      decorated.add(old);
      labelThumbnail(card, old, photo);
    }
    return;
  }
  if (pending.get(card) === photo.siteId) return;
  pending.set(card, photo.siteId);
  const image = document.createElement('img');
  image.className = old.className;
  image.classList.remove('site-recommendations__image--placeholder');
  image.src = photo.src; image.alt = photo.alt; image.decoding = 'async';
  image.title = `${photo.label} · ${photo.credit}\n${photo.sourcePage}\n${photo.licenceUrl}`;
  image.dataset.reviewedThumbnail = photo.siteId;
  try {
    // An unavailable derivative leaves the previous working preview intact.
    await image.decode();
    if (!card.isConnected || photoForLink(card.href)?.siteId !== photo.siteId) return;
    // An old CDN image can fail while this local derivative is decoding and
    // be replaced by the existing renderer's placeholder. Replace that current
    // node rather than losing the update because the original was detached.
    const current = card.querySelector('img, .site-recommendations__image--placeholder');
    if (!current) return;
    current.replaceWith(image);
    card.dataset.reviewedThumbnail = photo.siteId;
    decorated.add(image);
    labelThumbnail(card, image, photo);
    // Existing preview cards already link to the site page containing the full
    // source/licence credit. Preserve that link instead of nesting anchors.
    card.title = image.title;
    card.dispatchEvent(new CustomEvent('diveatlas:reviewed-thumbnail-updated', {bubbles:true}));
  } catch (error) {
    console.warn('Reviewed thumbnail unavailable; existing preview retained:', photo.siteId, error);
  } finally { pending.delete(card); }
}
function scan(root) {
  if (!(root instanceof Element || root instanceof Document)) return;
  if (root.matches?.(selector)) updateCard(root);
  root.querySelectorAll(selector).forEach(updateCard);
  const parent = root.closest?.(selector);
  if (parent) updateCard(parent);
}
const dirty = new Set();
let scheduled = false;
new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes') dirty.add(record.target);
    else for (const node of record.addedNodes) if (node instanceof Element) dirty.add(node);
  }
  if (!scheduled && dirty.size) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const root of dirty) scan(root);
      dirty.clear();
    });
  }
}).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['href', 'src']});
scan(document);
