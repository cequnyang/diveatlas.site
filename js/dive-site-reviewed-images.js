// Context photos deliberately bypass the exact-site photo registry: their
// source captions support a surface/context label, not underwater verification.
const page = document.querySelector('main.detail-page');
const supported = new Set([
  '24578a6d-215e-4d04-8c74-334bddbc60d7',
  '5e646533-e7d6-4205-9a94-fa82a4c78204',
  'f24f8645-7d94-4878-a0c5-270b45d51d60'
]);

async function apply() {
  if (!page || !supported.has(page.dataset.siteId) || page.dataset.reviewedImages) return;
  // Preserve the historical opt-in preview's own composition and review panel.
  if (new URL(location.href).searchParams.get('imageReview') === 'three') return;
  const response = await fetch('/assets/dive-sites/reviewed/assignments.json?v=3');
  if (!response.ok) throw new Error(`Reviewed image assignments: HTTP ${response.status}`);
  const assignments = await response.json();
  const entry = assignments.find(item => item.site_id === page.dataset.siteId);
  if (!entry || page.dataset.siteId !== entry.site_id) return;
  const hero = page.querySelector('.site-hero');
  const main = hero?.querySelector('.site-photo-gallery-main');
  if (!hero || !main) return;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const link = (url, text) => {
    const node = element('a', '', text);
    node.href = url;
    node.rel = 'noreferrer';
    return node;
  };
  const mobile = matchMedia('(max-width:720px)');
  function credit(full = false) {
    const node = element(full ? 'p' : 'span', 'reviewed-credit');
    if (entry.creator.includes('Woodym555')) {
      node.append(link('https://commons.wikimedia.org/wiki/User:Woodym555', 'Woodym555'),
        ', edited by ', link('https://commons.wikimedia.org/wiki/User:Fir0002', 'Fir0002'));
    } else {
      node.append('Diego Delso, ', link('http://delso.photo', 'delso.photo'));
    }
    node.append(' · ', link(entry.source_page, 'Source'), ' · ',
      link(entry.licence_url, entry.licence), ' · Cropped/resized');
    return node;
  }

  const styles = element('link');
  styles.rel = 'stylesheet';
  styles.href = '/assets/dive-sites/reviewed/images.css?v=2';
  const stylesReady = new Promise((resolve, reject) => {
    styles.addEventListener('load', resolve, {once: true});
    styles.addEventListener('error', () => reject(new Error('Reviewed image styles unavailable')), {once: true});
  });
  document.head.append(styles);
  const image = element('img', 'reviewed-photo');
  image.src = entry.desktop;
  image.alt = entry.label === 'Surface view'
    ? `${entry.name} — surface view, as described by the source; not an underwater view.`
    : 'Winch and associated parts on the deck of SS Thistlegorm, as described by the source.';
  const picture = element('picture');
  const source = element('source');
  source.media = '(max-width:720px)';
  source.srcset = entry.mobile;
  picture.append(source, image);
  const button = element('button', `reviewed-image-trigger${entry.role === 'main' ? ' site-photo-preview-trigger' : ''}`);
  button.type = 'button';
  button.setAttribute('aria-label', `Enlarge ${entry.label.toLowerCase()}`);
  button.append(picture);

  // Decode before replacing the existing image, so a missing asset preserves
  // the previous working page rather than leaving an empty hero.
  await Promise.all([image.decode(), stylesReady]);
  if (!page.isConnected || page.dataset.siteId !== entry.site_id) return;
  if (entry.role === 'main') {
    // Replace only the photo content. The ordinary hero owns frame height,
    // title placement, gradients, action rail and responsive cover behaviour.
    const caption = element('figcaption');
    caption.append(credit());
    const contribution = main.querySelector('.site-photo-upload-button');
    const surfaceLabel = element('span', 'site-photo-upload-label reviewed-surface-label');
    surfaceLabel.append(element('span', 'site-photo-upload-label__rest', entry.label));
    main.replaceChildren(button,
      surfaceLabel,
      element('span', 'site-photo-upload-label-mobile reviewed-surface-label', entry.label),
      caption);
    if (contribution) main.append(contribution);
  } else {
    const section = element('section', 'site-intro-detail reviewed-support detail-section');
    const figure = element('figure', 'reviewed-figure');
    const caption = element('figcaption');
    caption.append(credit());
    figure.append(button, caption);
    section.append(element('h2', '', 'Supporting photo · Thistlegorm winch'), figure);
    (page.querySelector('.site-intro-detail') || hero).after(section);
  }
  page.dataset.reviewedImages = entry.role;
  page.dataset.imagePublicationStatus = 'not-authorized';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const content = credit(true);
    // This enlarges the authored derivative; originals remain in the review
    // archive and are reachable through the exact Commons source link.
    window.DiveAtlasPhotoPreview?.open({src: image.currentSrc, alt: image.alt, credit: content.textContent});
    document.querySelector('.dive-photo-preview__credit')?.replaceChildren(content);
  }, true);

}

apply().catch(error => console.error('Reviewed site image was not applied:', error));
