(function (root) {
  'use strict';
  // The real map owns destination exploration. This guide delegates to its
  // existing search and applies the month through the real outlook layer.
  const copy = {
    en: ['Pick a starting point.', 'Explore a place, plan around a month, or follow your curiosity on the map.', 'Explore a destination', 'Find a place, then discover its dive sites', 'Choose a travel month', 'Explore historical monthly conditions', 'Browse the map', 'Go straight to the map, no setup needed', 'Layer guide', 'Close welcome', "Don’t show this again", 'Back', 'Show this month on the map', 'Historical monthly estimates, not live conditions or a dive-safety rating.'],
    zh: ['选择一个起点', '从目的地或出行月份开始，也可以直接在地图上探索。', '探索目的地', '先找一个地方，再发现附近的潜点', '选择出行月份', '探索历史月度环境状况', '直接浏览地图', '无需设置，立即开始探索', '图层指南', '关闭欢迎面板', '不再显示', '返回', '在地图上查看此月份', '基于历史月度估计，并非实时状况或潜水安全评级。'],
    ja: ['探索を始めましょう', '目的地や旅行月から、または地図で自由に探索できます。', '目的地を探す', '場所を選び、ダイビングスポットを探す', '旅行月を選ぶ', '過去の月別環境を確認', '地図を見る', '設定なしですぐに探索', 'レイヤーガイド', '閉じる', '今後表示しない', '戻る', 'この月を地図で表示', '過去の月別推定値です。リアルタイム情報や安全評価ではありません。'],
    fr: ['Choisissez un point de départ.', 'Explorez un lieu, un mois de voyage ou directement la carte.', 'Explorer une destination', 'Trouvez un lieu et ses sites de plongée', 'Choisir un mois', 'Explorer les conditions mensuelles historiques', 'Parcourir la carte', 'Explorer directement, sans configuration', 'Guide des couches', 'Fermer', 'Ne plus afficher', 'Retour', 'Afficher ce mois sur la carte', 'Estimations historiques, ni conditions en direct ni évaluation de sécurité.'],
    de: ['Wählen Sie einen Einstieg.', 'Entdecken Sie ein Ziel, einen Reisemonat oder direkt die Karte.', 'Reiseziel erkunden', 'Einen Ort und seine Tauchplätze finden', 'Reisemonat wählen', 'Historische Monatsbedingungen erkunden', 'Karte erkunden', 'Direkt loslegen, ohne Einrichtung', 'Ebenenhilfe', 'Schließen', 'Nicht mehr anzeigen', 'Zurück', 'Diesen Monat auf der Karte zeigen', 'Historische Monatsschätzungen, keine Echtzeitdaten oder Sicherheitsbewertung.'],
    es: ['Elige dónde empezar.', 'Explora un destino, un mes de viaje o directamente el mapa.', 'Explorar un destino', 'Encuentra un lugar y sus puntos de buceo', 'Elegir mes de viaje', 'Explora condiciones mensuales históricas', 'Explorar el mapa', 'Empieza directamente, sin configuración', 'Guía de capas', 'Cerrar', 'No volver a mostrar', 'Volver', 'Ver este mes en el mapa', 'Estimaciones históricas, no condiciones en directo ni evaluación de seguridad.'],
    it: ['Scegli da dove iniziare.', 'Esplora una destinazione, un mese di viaggio o direttamente la mappa.', 'Esplora una destinazione', 'Trova un luogo e i suoi siti di immersione', 'Scegli il mese', 'Esplora le condizioni mensili storiche', 'Esplora la mappa', 'Inizia subito, senza configurazione', 'Guida ai livelli', 'Chiudi', 'Non mostrare più', 'Indietro', 'Mostra questo mese sulla mappa', 'Stime storiche mensili, non condizioni in tempo reale né valutazioni di sicurezza.'],
    pt: ['Escolha por onde começar.', 'Explore um destino, um mês de viagem ou diretamente o mapa.', 'Explorar um destino', 'Encontre um lugar e seus pontos de mergulho', 'Escolher mês de viagem', 'Explore condições mensais históricas', 'Explorar o mapa', 'Comece diretamente, sem configuração', 'Guia de camadas', 'Fechar', 'Não mostrar novamente', 'Voltar', 'Mostrar este mês no mapa', 'Estimativas históricas, não condições em tempo real nem avaliação de segurança.'],
    ru: ['Выберите, с чего начать.', 'Выберите место, месяц поездки или исследуйте карту.', 'Выбрать направление', 'Найдите место и его дайв-сайты', 'Выбрать месяц поездки', 'Посмотреть исторические условия по месяцам', 'Открыть карту', 'Начните сразу, без настройки', 'Справка по слоям', 'Закрыть', 'Больше не показывать', 'Назад', 'Показать этот месяц на карте', 'Исторические оценки, не текущие условия и не оценка безопасности.'],
    ko: ['어디서 시작할까요?', '목적지나 여행 월을 선택하거나 지도를 바로 탐색하세요.', '목적지 탐색', '장소와 다이빙 포인트 찾기', '여행 월 선택', '과거 월별 환경 살펴보기', '지도 탐색', '설정 없이 바로 시작', '레이어 가이드', '닫기', '다시 표시하지 않기', '뒤로', '이 달을 지도에서 보기', '과거 월별 추정치이며 실시간 정보나 안전 등급이 아닙니다.'],
    nl: ['Kies een startpunt.', 'Verken een bestemming, een reismaand of direct de kaart.', 'Bestemming verkennen', 'Vind een plek en de duiklocaties', 'Reismaand kiezen', 'Historische maandcondities bekijken', 'Kaart verkennen', 'Direct beginnen, zonder instellingen', 'Lagenhandleiding', 'Sluiten', 'Niet meer tonen', 'Terug', 'Deze maand op de kaart tonen', 'Historische schattingen, geen actuele omstandigheden of veiligheidsbeoordeling.'],
    sv: ['Välj en startpunkt.', 'Utforska en plats, en resemånad eller kartan direkt.', 'Utforska en destination', 'Hitta en plats och dess dykplatser', 'Välj resemånad', 'Utforska historiska månadsförhållanden', 'Utforska kartan', 'Börja direkt utan inställningar', 'Lagerguide', 'Stäng', 'Visa inte igen', 'Tillbaka', 'Visa månaden på kartan', 'Historiska uppskattningar, inte aktuella förhållanden eller säkerhetsbedömning.'],
    no: ['Velg et utgangspunkt.', 'Utforsk et sted, en reisemåned eller kartet direkte.', 'Utforsk en destinasjon', 'Finn et sted og dykkestedene der', 'Velg reisemåned', 'Utforsk historiske månedsforhold', 'Utforsk kartet', 'Start direkte uten oppsett', 'Lagveiledning', 'Lukk', 'Ikke vis igjen', 'Tilbake', 'Vis måneden på kartet', 'Historiske estimater, ikke sanntidsforhold eller sikkerhetsvurdering.'],
    id: ['Pilih titik awal.', 'Jelajahi destinasi, bulan perjalanan, atau langsung petanya.', 'Jelajahi destinasi', 'Temukan tempat dan lokasi selamnya', 'Pilih bulan perjalanan', 'Jelajahi kondisi bulanan historis', 'Jelajahi peta', 'Langsung mulai tanpa pengaturan', 'Panduan lapisan', 'Tutup', 'Jangan tampilkan lagi', 'Kembali', 'Tampilkan bulan ini di peta', 'Estimasi bulanan historis, bukan kondisi langsung atau penilaian keselamatan.']
  };
  // Step copy stays separate from the existing layer descriptions so the
  // detailed guide and the planning flow can evolve independently.
  const flowCopy = {
    en: ["Next","Current map area","Your plan","Start exploring","Choose a destination, choose a month, then explore the map.","Skip to map"],
    zh: ["下一步","当前地图区域","你的探索计划","开始探索","选择目的地，再选出行月份，最后进入地图探索。","直接浏览地图"],
    ja: ["次へ","現在の地図エリア","探索プラン","探索を始める","目的地と旅行月を選んでから、地図を探索しましょう。","地図へ進む"],
    fr: ["Suivant","Zone actuelle de la carte","Votre projet","Commencer à explorer","Choisissez une destination, puis un mois, et explorez la carte.","Passer à la carte"],
    de: ["Weiter","Aktueller Kartenausschnitt","Ihr Plan","Erkundung starten","Wählen Sie ein Ziel, dann einen Monat und erkunden Sie die Karte.","Direkt zur Karte"],
    es: ["Siguiente","Área actual del mapa","Tu plan","Empezar a explorar","Elige un destino, después un mes y explora el mapa.","Ir al mapa"],
    it: ["Avanti","Area attuale della mappa","Il tuo piano","Inizia a esplorare","Scegli una destinazione, poi un mese ed esplora la mappa.","Vai alla mappa"],
    pt: ["Próximo","Área atual do mapa","Seu plano","Começar a explorar","Escolha um destino, depois um mês e explore o mapa.","Ir para o mapa"],
    ru: ["Далее","Текущая область карты","Ваш план","Начать исследование","Выберите место, затем месяц и исследуйте карту.","Перейти к карте"],
    ko: ["다음","현재 지도 영역","탐색 계획","탐색 시작","목적지와 여행 월을 선택한 다음 지도를 탐색하세요.","지도로 이동"],
    nl: ["Volgende","Huidig kaartgebied","Uw plan","Begin met verkennen","Kies een bestemming, daarna een maand en verken de kaart.","Direct naar de kaart"],
    sv: ["Nästa","Aktuellt kartområde","Din plan","Börja utforska","Välj en destination, sedan en månad och utforska kartan.","Gå till kartan"],
    no: ["Neste","Gjeldende kartområde","Din plan","Begynn å utforske","Velg en destinasjon, deretter en måned og utforsk kartet.","Gå til kartet"],
    id: ["Berikutnya","Area peta saat ini","Rencana Anda","Mulai menjelajah","Pilih destinasi, lalu bulan perjalanan, dan jelajahi peta.","Langsung ke peta"]
  };
  const mapCopy = {
    en: ['Search for a place, or pan and zoom the map. Continue with the area you want to explore.', 'Use this map area'],
    zh: ['搜索目的地，或拖动、缩放地图。找到想探索的区域后继续。', '使用当前地图区域'],
    ja: ['場所を検索するか、地図を移動・拡大して探索するエリアを選んでください。', 'この地図エリアを使う'],
    fr: ['Recherchez un lieu ou déplacez et zoomez la carte, puis continuez avec la zone choisie.', 'Utiliser cette zone'],
    de: ['Suchen Sie einen Ort oder verschieben und zoomen Sie die Karte. Wählen Sie so Ihr Gebiet.', 'Diesen Kartenausschnitt verwenden'],
    es: ['Busca un lugar o desplaza y amplía el mapa. Continúa con el área que quieras explorar.', 'Usar esta área del mapa'],
    it: ['Cerca un luogo oppure sposta e ingrandisci la mappa. Continua con l’area scelta.', 'Usa questa area della mappa'],
    pt: ['Busque um lugar ou mova e amplie o mapa. Continue com a área que deseja explorar.', 'Usar esta área do mapa'],
    ru: ['Найдите место или перемещайте и масштабируйте карту. Продолжите с выбранной областью.', 'Использовать эту область'],
    ko: ['장소를 검색하거나 지도를 이동하고 확대하세요. 탐색할 영역을 정한 후 계속하세요.', '현재 지도 영역 사용'],
    nl: ['Zoek een plek of verschuif en zoom de kaart. Ga verder met het gewenste gebied.', 'Dit kaartgebied gebruiken'],
    sv: ['Sök efter en plats eller flytta och zooma kartan. Fortsätt med området du vill utforska.', 'Använd detta kartområde'],
    no: ['Søk etter et sted eller flytt og zoom kartet. Fortsett med området du vil utforske.', 'Bruk dette kartområdet'],
    id: ['Cari tempat atau geser dan perbesar peta. Lanjutkan dengan area yang ingin dijelajahi.', 'Gunakan area peta ini']
  };
  // Navigation uses compact labels; headings and field labels keep their
  // descriptive copy so shortening the tabs does not remove context.
  const stepLabels = {
    en: ['Destination', 'Month', 'Explore'],
    zh: ['目的地', '月份', '探索'],
    ja: ['目的地', '旅行月', '探索'],
    fr: ['Destination', 'Mois', 'Explorer'],
    de: ['Reiseziel', 'Monat', 'Erkunden'],
    es: ['Destino', 'Mes', 'Explorar'],
    it: ['Destinazione', 'Mese', 'Esplora'],
    pt: ['Destino', 'Mês', 'Explorar'],
    ru: ['Место', 'Месяц', 'Обзор'],
    ko: ['목적지', '여행 월', '탐색'],
    nl: ['Bestemming', 'Maand', 'Verkennen'],
    sv: ['Resmål', 'Månad', 'Utforska'],
    no: ['Reisemål', 'Måned', 'Utforsk'],
    id: ['Destinasi', 'Bulan', 'Jelajahi']
  };
  root.createDiveAtlasWelcome = function ({ getLanguage, getTitle, getSearchLabel, getMapArea, getMapAreaName, getMonth, getWelcomeControls, onWelcomeView, onWelcomeOverlay, monthEnabled = true, onOpen = () => {}, onDismiss, onGuide, onMonth, onMonthChange, onSearchInput, onSearchKey, onSearchClose, onCloseMonth, onLanguage, onAnimateClose, onFocusMap, suppressedKey }) {
    const section = document.createElement('section');
    section.id = 'mapWelcome';
    section.className = 'map-welcome tutorial-dialog glass-surface';
    section.hidden = true;
    section.setAttribute('aria-labelledby', 'mapWelcomeTitle');
    section.innerHTML = `<div class="tutorial-topbar"><div class="tutorial-header"><h2 class="tutorial-title" id="mapWelcomeTitle"></h2><button type="button" class="top-menu-menu-button map-welcome-language" data-action="language" aria-label="Language" aria-haspopup="menu" aria-controls="languageDropdown" aria-expanded="false"></button></div><button type="button" class="tutorial-close" data-action="close"></button></div>
      <p class="tutorial-intro" id="mapWelcomeIntro"></p>
      <nav class="map-welcome-steps" aria-label="Guide"><button type="button" data-action="destination"><span class="map-welcome-number">1</span><span data-copy="2"></span></button><button type="button" data-action="month"><span class="map-welcome-number">2</span><span data-copy="4"></span></button><button type="button" data-action="review"><span class="map-welcome-number">3</span><span data-copy="6"></span></button></nav>
      <div class="map-welcome-content">
        <section id="mapWelcomeDestinationPanel" class="map-welcome-step" aria-labelledby="mapWelcomeDestinationTitle"><div><h3 id="mapWelcomeDestinationTitle" data-copy="2" tabindex="-1"></h3><p id="mapWelcomeMapHint"></p><div class="map-welcome-search-area"><div class="map-welcome-search"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input id="mapWelcomeSearch" type="search" role="combobox" autocomplete="off" aria-autocomplete="list" aria-controls="diveSearchResultsScroll" aria-expanded="false"></div></div><p class="map-welcome-area map-welcome-destination-value"></p></div></section>
        <section id="mapWelcomeMonthPanel" class="map-welcome-step" hidden aria-labelledby="mapWelcomeMonthTitle"><div><h3 id="mapWelcomeMonthTitle" data-copy="4" tabindex="-1"></h3><p data-copy="5"></p><label class="map-welcome-field" for="mapWelcomeMonth" data-copy="4"></label><div class="temperature-select-hit-area"><select id="mapWelcomeMonth"></select></div><p class="map-welcome-note" data-copy="13"></p></div><div class="map-welcome-context"><span class="map-welcome-context-label" data-copy="2"></span><strong class="map-welcome-destination-value"></strong></div></section>
        <section id="mapWelcomeReviewPanel" class="map-welcome-step" hidden aria-labelledby="mapWelcomeReviewTitle"><div><h3 id="mapWelcomeReviewTitle" tabindex="-1"></h3><dl class="map-welcome-summary"><div><dt data-copy="2"></dt><dd class="map-welcome-destination-value"></dd></div><div id="mapWelcomeMonthSummary"><dt data-copy="4"></dt><dd id="mapWelcomeMonthValue"></dd></div></dl><p data-copy="7"></p></div></section>
      </div>
      <footer class="tutorial-footer map-welcome-footer"><div class="map-welcome-navigation"><button type="button" class="tutorial-button" data-action="back" data-copy="11"></button><button type="button" class="tutorial-button primary tutorial-cta" data-action="next"></button><button type="button" class="tutorial-button primary tutorial-cta" data-action="apply" hidden></button></div><div class="map-welcome-utilities"><button type="button" class="map-welcome-link" data-action="guide" data-copy="8"></button></div><label class="tutorial-suppress-label"><input type="checkbox" id="mapWelcomeSuppress"><span data-copy="10"></span></label></footer>`;
    const steps = monthEnabled ? ['destination', 'month', 'review'] : ['destination', 'review'];
    let step = 0;
    const action = name => section.querySelector(`[data-action="${name}"]`);
    function setActionLabel(name, text) {
      const label = document.createElement('span');
      label.className = 'tutorial-cta__label';
      label.textContent = text;
      // Reuse the tutorial's SVG and hover/focus animation rather than a
      // font-dependent arrow glyph that varies across operating systems.
      const icon = document.querySelector('#tutorialStart .tutorial-cta__icon').cloneNode(true);
      action(name).replaceChildren(label, icon);
    }
    const picker = section.querySelector('#mapWelcomeMonth');
    const suppress = section.querySelector('#mapWelcomeSuppress');
    suppress.checked = true;
    const searchInput = section.querySelector('#mapWelcomeSearch');
    const panels = { destination:section.querySelector('#mapWelcomeDestinationPanel'), month:section.querySelector('#mapWelcomeMonthPanel'), review:section.querySelector('#mapWelcomeReviewPanel') };
    const previews = {};
    for (const [kind, panel] of [['views', panels.month], ['overlays', panels.review]]) {
      const group = document.createElement('fieldset');
      group.className = 'map-welcome-preview';
      group.dataset.kind = kind;
      const legend = document.createElement('legend');
      const choices = document.createElement('div');
      choices.className = 'map-welcome-preview-choices';
      group.append(legend, choices);
      panel.append(group);
      previews[kind] = {group, legend, choices};
    }
    function syncControls() {
      const state = getWelcomeControls();
      const titles = ({
        en:['Try a map view','Add map detail'], zh:['试试地图视图','添加地图细节'],
        ja:['地図表示を試す','地図に詳細を追加'], fr:['Essayer une vue','Ajouter des détails'],
        de:['Kartenansicht testen','Kartendetails ergänzen'], es:['Prueba una vista','Añade detalles'],
        it:['Prova una vista','Aggiungi dettagli'], pt:['Experimente uma vista','Adicione detalhes'],
        ru:['Попробуйте вид карты','Добавьте детали'], ko:['지도 보기 선택','지도 상세 추가'],
        nl:['Probeer een kaartweergave','Voeg details toe'], sv:['Prova en kartvy','Lägg till detaljer'],
        no:['Prøv en kartvisning','Legg til detaljer'], id:['Coba tampilan peta','Tambahkan detail']
      })[getLanguage()] || ['Try a map view','Add map detail'];
      previews.views.legend.textContent = titles[0];
      previews.overlays.legend.textContent = titles[1];
      Object.entries(previews).forEach(([kind, {group, choices}]) => {
        // Map controls own state and persistence. Retain shortcut elements so
        // map updates do not discard keyboard focus.
        for (const item of state[kind]) {
          let button = [...choices.children].find(el => el.dataset.key === item.key);
          if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.dataset.key = item.key;
            button.addEventListener('click', () => {
              group.classList.add('is-used');
              if (kind === 'views') onWelcomeView(item.key);
              else onWelcomeOverlay(item.key, button.getAttribute('aria-pressed') !== 'true');
              syncControls();
            });
            choices.append(button);
          }
          button.textContent = item.label;
          if (kind === 'overlays' && item.symbol) {
            const symbol = item.symbol.cloneNode(true);
            // Share live legend geometry (including zoom-dependent symbols)
            // without duplicating the legend's document IDs.
            symbol.removeAttribute('id');
            symbol.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
            symbol.setAttribute('aria-hidden', 'true');
            button.prepend(symbol);
          }
          if (kind === 'views' && item.key === 'dive-experience-outlook') {
            const logo = document.querySelector('#environmentDiveExperienceLabel .dive-brand-rating-logo');
            if (logo) button.replaceChildren(logo.cloneNode(true));
          }
          button.setAttribute('aria-label', item.label);
          button.setAttribute('aria-pressed', String(item.active));
          button.disabled = item.disabled;
        }
        [...choices.children].filter(button => !state[kind].some(item => item.key === button.dataset.key)).forEach(button => button.remove());
      });
    }
    document.addEventListener('diveatlas-controls-sync', () => {
      if (!section.hidden) syncControls();
    });
    const strings = () => copy[getLanguage()] || copy.en;
    const flow = () => flowCopy[getLanguage()] || flowCopy.en;
    const mapText = () => mapCopy[getLanguage()] || mapCopy.en;
    action('month').hidden = !monthEnabled;
    section.querySelector('#mapWelcomeMonthSummary').hidden = !monthEnabled;
    document.getElementById('app').append(section);

    function closeSearch() { onSearchClose(searchInput); }
    searchInput.addEventListener('input',() => onSearchInput(searchInput));
    searchInput.addEventListener('focus',() => {
      if (searchInput.value.trim()) onSearchInput(searchInput);
    });
    searchInput.addEventListener('click',() => {
      if (searchInput.value.trim() && searchInput.getAttribute('aria-expanded') !== 'true') onSearchInput(searchInput);
    });
    searchInput.addEventListener('keydown',event => onSearchKey(event,searchInput));

    let areaNameRequest = 0;
    let selectedDestination = null;
    async function syncMapArea() {
      // The live viewport is the only source of geographic state. Search,
      // dragging and zooming all update this same area; no second picker/index.
      const {lat,lng} = getMapArea();
      const request = ++areaNameRequest;
      const values = section.querySelectorAll('.map-welcome-destination-value');
      // Preserve the actual search choice across steps, but do not label a
      // different map center with the previous destination after panning.
      const destination = selectedDestination && selectedDestination.lat === lat && selectedDestination.lng === lng
        ? selectedDestination.name : '';
      if (!destination) selectedDestination = null;
      values.forEach(el => { el.textContent = destination || flow()[1]; });
      // Use the same geographic labels as the conditions popup. A newer
      // viewport or language wins if the local lookup completes out of order.
      const name = await getMapAreaName({lat, lng}).catch(() => '');
      if (request !== areaNameRequest) return;
      // Country searches already contain their own name; avoid repeating it
      // when adding the broader geographic context to a selected area.
      const parts = [destination, ...(name || '').split(' · ')]
        .map(part => part.trim()).filter(Boolean);
      const label = [...new Set(parts)].join(' · ') || flow()[1];
      values.forEach(el => { el.textContent = label; });
    }
    function syncStep({ focus = false } = {}) {
      syncControls();
      const current = steps[step];
      section.classList.toggle('is-map-step', current === 'destination');
      section.classList.toggle('is-review-step', current === 'review');
      Object.entries(panels).forEach(([name,panel]) => { panel.hidden = name !== current; });
      steps.forEach((name,index) => {
        action(name).setAttribute('aria-current', index === step ? 'step' : 'false');
        action(name).dataset.complete = String(index < step);
        action(name).querySelector('.map-welcome-number').textContent = String(index + 1);
        action(name).querySelector('[data-copy]').textContent = (stepLabels[getLanguage()] || stepLabels.en)[['destination', 'month', 'review'].indexOf(name)];
      });
      action('back').hidden = step === 0;
      action('next').hidden = step === steps.length - 1;
      setActionLabel('next', step === 0 ? mapText()[1] : flow()[0]);
      action('apply').hidden = step !== steps.length - 1;
      syncMapArea();
      section.querySelector('#mapWelcomeMonthValue').textContent = picker.selectedOptions[0]?.textContent || '';
      if (focus) panels[current].querySelector('h3').focus();
    }
    function render() {
      const text = strings(),labels = flow();
      section.querySelectorAll('[data-copy]').forEach(el => { el.textContent = text[Number(el.dataset.copy)]; });
      const title = section.querySelector('#mapWelcomeTitle'),titleText = getTitle(),brandIndex = titleText.indexOf('DiveAtlas');
      if (brandIndex >= 0) {
        const logo = document.createElement('img');logo.className = 'tutorial-title-logo';logo.src = 'assets/diveatlas-logo.svg?v=3';logo.alt = 'DiveAtlas';
        title.replaceChildren(document.createTextNode(titleText.slice(0,brandIndex)),logo,document.createTextNode(titleText.slice(brandIndex + 9)));
      } else title.textContent = titleText;
      action('close').setAttribute('aria-label',text[9]);
      const languageButton = action('language');
      languageButton.className = 'top-menu-menu-button top-menu-lang-trigger';
      languageButton.setAttribute('aria-controls', 'tutorialLanguageDropdown');
      const languageLabel = document.querySelector('#langSelect option:checked');
      languageButton.replaceChildren();
      const label = document.createElement('span');
      label.textContent = languageLabel?.textContent || getLanguage().toUpperCase();
      languageButton.append(label, document.querySelector('#tutorialLanguageMenuButton svg').cloneNode(true));
      if (!languageButton.parentElement.classList.contains('tutorial-language-menu')) {
        const menu = document.createElement('div');
        menu.className = 'top-menu-lang tutorial-language-menu';
        languageButton.before(menu);
        menu.append(languageButton);
      }
      searchInput.placeholder = getSearchLabel();searchInput.setAttribute('aria-label',getSearchLabel());
      section.querySelector('#mapWelcomeMapHint').textContent = mapText()[0];
      section.querySelector('#mapWelcomeIntro').textContent = monthEnabled ? labels[4] : text[3];
      section.querySelector('#mapWelcomeReviewTitle').textContent = labels[2];
      setActionLabel('apply', labels[3]);
      // Layers owns the saved month. Rebuilding localized options must not
      // revive a stale guide-only selection after settings changed elsewhere.
      const selected = String(getMonth());
      const locale = getLanguage() === 'zh' ? 'zh-CN' : getLanguage();
      const formatter = new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'});
      picker.replaceChildren(...Array.from({length:12},(_,i) => new Option(formatter.format(new Date(Date.UTC(2024,i,1))),String(i + 1))));
      picker.value = selected;syncStep();
    }
    function syncSuppression() {
      try { suppress.checked = localStorage.getItem(suppressedKey) !== '0'; } catch (_) {}
    }
    function persistSuppression() {
      try {
        // Missing means the default; persist an explicit opt-out separately.
        localStorage.setItem(suppressedKey,suppress.checked ? '1' : '0');
      } catch (_) {}
    }
    function hide() { onCloseMonth();closeSearch();section.hidden = true; }
    let closing = false;
    let closeGeneration = 0;
    async function dismiss({focus = true} = {}) {
      if (section.hidden) return;
      if (closing && focus) return;
      const generation = ++closeGeneration;
      closing = true;
      persistSuppression();
      if (focus) await onAnimateClose(section);
      if (generation !== closeGeneration) return;
      hide();
      closing = false;
      onDismiss();if (focus) onFocusMap();
    }
    picker.addEventListener('change',() => {
      onMonthChange(Number(picker.value));syncStep();
    });
    suppress.addEventListener('change',persistSuppression);
    window.addEventListener('storage',event => {
      if (event.key === suppressedKey || event.key === null) syncSuppression();
    });
    section.addEventListener('click',event => {
      const name = event.target.closest('[data-action]')?.dataset.action;
      if (!name) return;
      onCloseMonth();closeSearch();
      if (name === 'next' || name === 'back') { step += name === 'next' ? 1 : -1;step = Math.max(0,Math.min(steps.length - 1,step));syncStep({focus:true}); }
      else if (steps.includes(name)) { step = steps.indexOf(name);syncStep({focus:true}); }
      else if (name === 'guide') {
        // Help on the final step completes onboarding; earlier steps remain
        // resumable so a guide visit does not discard an unfinished plan.
        const afterWelcome = steps[step] === 'review';
        if (afterWelcome) dismiss({focus: false});
        else { persistSuppression(); }
        onGuide({ afterWelcome });
      }
      else if (name === 'language') {
        event.stopPropagation();onLanguage();
      } else if (name === 'apply') {
        if (monthEnabled && onMonth(Number(picker.value)) === false) return;
        dismiss();
      } else if (name === 'close') dismiss();
    });
    section.addEventListener('keydown',event => { if (event.key === 'Escape') { event.stopPropagation();dismiss(); } });
    return {render,dismiss,syncMapArea,
      syncMonth(month) { picker.value = String(month);syncStep(); },
      // Switching to another map task should not change the welcome preference.
      suspend() { ++closeGeneration; closing = false; section.getAnimations().forEach(animation => animation.cancel()); hide(); },
      syncDestination(name) {
        searchInput.value = name;
        selectedDestination = { name, ...getMapArea() };
        syncMapArea();
      },
      open({restore = false} = {}) {
      onOpen();
      ++closeGeneration;
      closing = false;
      section.getAnimations().forEach(animation => animation.cancel());
      // A manual reopening begins a new flow; a guide detour resumes it.
      // Suppression remains saved; month changes use the map's shared state.
      if (!restore) {
        step = 0;
        searchInput.value = '';
        selectedDestination = null;
        onMonthChange(new Date().getMonth() + 1);
        closeSearch();
        onCloseMonth();
        section.scrollTop = 0;
        section.querySelector('.map-welcome-content').scrollTop = 0;
      }
      syncSuppression();render();section.hidden = false;if (restore) action('guide').focus();
    }};
  };
})(window);
