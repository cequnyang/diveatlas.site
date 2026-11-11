(() => {
  'use strict';
  const select = document.getElementById('destination-month');
  if (!select) return;
  // Keep the server-rendered English experience usable if the optional locale
  // catalog cannot load. Locale errors must not replace data with lookup keys.
  const fallback = {
    range:'15–20 m reported', clearer:'Often clearer locally', noRange:'No monthly range',
    novRange:'Nov–Apr operator range', mayRange:'May–Aug; no numeric range',
    noNumeric:'No numeric range in source', wind:'Wind can affect access', check:'Check locally',
    augWind:'August winds may disrupt access', varies:'Varies by site and tide',
  };
  function update() {
    const month = Number(select.value);
    const t = key => window.DiveAtlasDestinationI18n?.t(key) || fallback[key];
    const visibilityRange = month <= 3 || month >= 10;
    const clearer = month >= 4 && month <= 7;
    document.getElementById('destination-clarity').textContent = visibilityRange ? t('range') : clearer ? t('clearer') : t('noRange');
    document.getElementById('destination-clarity-note').textContent = visibilityRange
      ? t('novRange')
      : clearer ? t('mayRange')
        : t('noNumeric');
    document.getElementById('destination-current').textContent = month === 7 ? t('wind') : t('check');
    document.getElementById('destination-current-note').textContent = month === 7
      ? t('augWind')
      : t('varies');
  }
  select.addEventListener('change', update);
  window.addEventListener('diveatlas:destination-language-ready', update);
  update();
})();
