(() => {
  'use strict';

  if (!document.body.classList.contains('seo-browse-layout')) return;
  const fallback = document.querySelector('body > .site-header');
  if (!fallback || fallback.dataset.browseHeaderReady === 'true') return;

  // Keep a logo-only server-rendered header for no-JavaScript users, then replace it
  // with the shared detail-page controls once their dependencies can run.
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a>
    <div class="top-menu-search-slot seo-site-search-slot" id="seoSiteSearchSlot">
      <div class="search-float" id="seoSiteSearchSection">
        <div class="dive-search">
          <div class="dive-search-box">
            <button class="dive-search-icon" id="seoSiteSearchToggle" type="button" aria-label="Search dive sites" title="Search dive sites" aria-controls="seoSiteSearchInput" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="6.75" cy="6.75" r="4.25"></circle><path d="M10.4 10.4 14 14"></path></svg></button>
            <input class="dive-search-input" id="seoSiteSearchInput" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="seoSiteSearchResultsScroll" placeholder="Where Will You Dive Next?" aria-label="Where Will You Dive Next?">
            <button class="dive-search-clear" id="seoSiteSearchClear" type="button" title="Clear search" aria-label="Clear search"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg></button>
            <button class="dive-search-filter-toggle" id="seoSiteSearchFilterToggle" type="button" aria-label="Search filters" title="Search filters" aria-controls="seoSiteSearchFilterControls" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 7h10.1M18.9 7H21M3 17h2.1M10.9 17H21"></path><circle cx="16" cy="7" r="2.9"></circle><circle cx="8" cy="17" r="2.9"></circle></svg></button>
          </div>
          <div class="dive-search-results" id="seoSiteSearchResults" aria-busy="false">
            <div class="dive-search-results-scroll" id="seoSiteSearchResultsScroll" role="listbox" aria-label="Dive-site search results"></div>
            <div class="dive-search-filter-controls" id="seoSiteSearchFilterControls" role="group" aria-label="Dive-site filters" hidden>
              <label class="dive-search-filter-field"><span id="seoSiteSearchCountryLabel">Country</span><select id="seoSiteSearchCountry" aria-labelledby="seoSiteSearchCountryLabel"><option value="">Any country</option></select></label>
              <label class="dive-search-filter-field"><span id="seoSiteSearchDifficultyLabel">Difficulty</span><select id="seoSiteSearchDifficulty" aria-labelledby="seoSiteSearchDifficultyLabel"><option value="">Any difficulty</option></select></label>
              <label class="dive-search-filter-field"><span id="seoSiteSearchFeatureLabel">Feature</span><select id="seoSiteSearchFeature" aria-labelledby="seoSiteSearchFeatureLabel"><option value="">Any feature</option></select></label>
              <button class="dive-search-filter-clear" id="seoSiteSearchFilterClear" type="button" hidden>Clear All</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="top-menu-controls seo-top-menu-controls" aria-label="Page settings">
      <button class="top-menu-share" id="seoShareButton" type="button" aria-label="Share this page" title="Share this page"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button>
      <button class="top-menu-theme" id="seoThemeButton" type="button" title="Toggle page theme" aria-label="Toggle page theme" aria-pressed="false"><span class="theme-mode-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.7"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9"/></svg></span><span class="theme-mode-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.8 10.2A5.8 5.8 0 0 1 5.8 3.1a5.8 5.8 0 1 0 7 7.1Z"/></svg></span></button>
      <div class="seo-language-menu"><button class="top-menu-menu-button top-menu-lang-trigger" id="seoLanguageButton" type="button" aria-label="Language" aria-haspopup="menu" aria-expanded="false" aria-controls="seoLanguageDropdown"><span id="seoLanguageLabel">EN</span><svg class="language-chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="language-globe-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.8 10h14.4M10 2.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5c-2-2-3-4.5-3-7.5s1-5.5 3-7.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="top-menu-dropdown seo-language-dropdown" id="seoLanguageDropdown" role="menu" aria-label="Language" hidden></div>
        <label class="sr-only" for="seoLanguageSelect">Language</label><select class="sr-only-select" id="seoLanguageSelect" aria-label="Language" tabindex="-1" aria-hidden="true"><option value="en">EN</option><option value="zh">简体中文</option><option value="zh-TW">繁體中文</option><option value="es">ES</option><option value="de">DE</option><option value="fr">FR</option><option value="ja">日本語</option><option value="pt">PT</option><option value="it">IT</option><option value="ru">RU</option><option value="ko">한국어</option><option value="nl">NL</option><option value="id">ID</option><option value="sv">SV</option><option value="no">NO</option></select>
      </div>
      <div class="top-menu-menu seo-menu-wrap"><button class="top-menu-menu-button" id="seoMenuButton" type="button" title="Menu" aria-label="Menu" aria-expanded="false" aria-controls="seoMenuDropdown"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button><div class="top-menu-dropdown seo-menu-dropdown" id="seoMenuDropdown" hidden><div class="top-menu-page-header">Menu</div><button class="top-menu-dropdown-item seo-menu-share" id="seoMenuShareButton" type="button" aria-label="Share this page" title="Share this page"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg><span>Share this page</span></button><div class="seo-menu-account" role="status">Account sign-in is unavailable</div><div class="top-menu-about-wrap seo-menu-about-wrap"><button class="top-menu-dropdown-item" id="seoAboutButton" type="button" aria-expanded="false" aria-controls="seoAboutDetails">About</button><div class="top-menu-about-tooltip" id="seoAboutDetails" hidden><p>DiveAtlas is an interactive map for exploring dive sites and regions alongside reef extent, coral and fish records, bathymetry, and ocean conditions.</p><p class="top-menu-about-copyright">© 2026 DiveAtlas. Original DiveAtlas code, text, and design; third-party materials remain under their own terms.</p></div></div><button class="top-menu-dropdown-item" id="seoContactButton" type="button">Contact</button><div class="top-menu-version" data-version="0.0.1" aria-label="DiveAtlas version 0.0.1">v0.0.1</div></div></div>
    </div>`;
  fallback.replaceWith(header);

  const backdrop = document.createElement('div');
  backdrop.className = 'seo-menu-backdrop';
  backdrop.id = 'seoMenuBackdrop';
  backdrop.hidden = true;
  header.insertAdjacentElement('afterend', backdrop);

  document.body.insertAdjacentHTML('beforeend', `
    <div class="seo-share-modal" id="seoShareModal" hidden></div>
    <div class="seo-contact-modal" id="seoContactModal" hidden>
      <div class="seo-modal-backdrop" data-seo-contact-close></div>
      <section class="seo-dialog" role="dialog" aria-modal="true" aria-labelledby="seoContactTitle">
        <div class="seo-dialog-header"><div><h2 id="seoContactTitle">Contact DiveAtlas</h2><p>Send a message to the DiveAtlas maintainer.</p></div><button class="seo-dialog-close" type="button" aria-label="Close" data-seo-contact-close>×</button></div>
        <form id="seoContactForm" class="seo-contact-form" novalidate>
          <label>Name <small>(optional)</small><input name="name" id="seoContactName" maxlength="100" autocomplete="name"></label>
          <label>Email<input name="email" id="seoContactEmail" type="email" maxlength="254" autocomplete="email" required></label>
          <label>Subject <small>(optional)</small><input name="subject" id="seoContactSubject" maxlength="150"></label>
          <label>Message<textarea name="message" id="seoContactMessage" maxlength="5000" required></textarea></label>
          <label class="seo-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
          <div id="seoContactTurnstile"></div><p class="seo-dialog-status" id="seoContactStatus" role="status" aria-live="polite"></p>
          <div class="seo-dialog-actions"><button class="seo-secondary-button" type="button" data-seo-contact-close>Cancel</button><button class="seo-primary-button" type="submit">Send message</button></div>
        </form>
      </section>
    </div>`);
})();
