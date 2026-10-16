/*
 * Builds readable first-pass localized names from common dive-site descriptors.
 * Full site-specific translations take precedence through the stable-ID catalog.
 * Unknown words remain untouched so local names and proper nouns stay recognizable.
 */
(function installDiveSiteNameLocalization(global) {
  const WORDS = {
    zh: { wreck:'沉船', shipwreck:'沉船', reef:'礁', island:'岛', islands:'群岛', point:'角', bay:'湾', rock:'礁石', rocks:'礁石', cave:'洞穴', caves:'洞穴', wall:'峭壁', beach:'海滩', garden:'花园', coral:'珊瑚', lagoon:'泻湖', pinnacle:'海峰', channel:'水道', shoal:'浅滩', canyon:'海底峡谷', cove:'小海湾', corner:'角', ledge:'岩架', passage:'海峡', bridge:'桥', harbor:'港', harbour:'港', pier:'码头', lake:'湖', river:'河', spring:'泉', springs:'泉', quarry:'采石场', north:'北', south:'南', east:'东', west:'西', blue:'蓝', white:'白', black:'黑', red:'红', green:'绿', yellow:'黄', shark:'鲨鱼', turtle:'海龟', manta:'蝠鲼', deep:'深水', big:'大', little:'小', small:'小', great:'大' },
    ja: { wreck:'沈船', shipwreck:'沈船', reef:'リーフ', island:'島', islands:'諸島', point:'ポイント', bay:'湾', rock:'岩礁', rocks:'岩礁', cave:'洞窟', caves:'洞窟', wall:'ウォール', beach:'ビーチ', garden:'ガーデン', coral:'サンゴ', lagoon:'ラグーン', pinnacle:'ピナクル', channel:'水路', shoal:'浅瀬', canyon:'海底渓谷', cove:'入り江', corner:'コーナー', ledge:'岩棚', passage:'海峡', bridge:'橋', harbor:'港', harbour:'港', pier:'桟橋', lake:'湖', river:'川', spring:'泉', springs:'泉', quarry:'採石場', north:'北', south:'南', east:'東', west:'西', blue:'ブルー', white:'ホワイト', black:'ブラック', red:'レッド', green:'グリーン', yellow:'イエロー', shark:'シャーク', turtle:'タートル', manta:'マンタ', deep:'ディープ', big:'大', little:'小', small:'小', great:'グレート' },
    fr: { wreck:'épave', shipwreck:'épave', reef:'récif', island:'île', islands:'îles', point:'pointe', bay:'baie', rock:'rocher', rocks:'rochers', cave:'grotte', caves:'grottes', wall:'paroi', beach:'plage', garden:'jardin', coral:'corail', lagoon:'lagon', pinnacle:'pinnacle', channel:'chenal', shoal:'haut-fond', canyon:'canyon', cove:'crique', corner:'pointe', ledge:'corniche', passage:'passage', bridge:'pont', harbor:'port', harbour:'port', pier:'jetée', lake:'lac', river:'rivière', spring:'source', springs:'sources', quarry:'carrière', north:'nord', south:'sud', east:'est', west:'ouest', blue:'bleu', white:'blanc', black:'noir', red:'rouge', green:'vert', yellow:'jaune', shark:'requin', turtle:'tortue', manta:'raie manta', deep:'profond', big:'grand', little:'petit', small:'petit', great:'grand' },
    de: { wreck:'Wrack', shipwreck:'Wrack', reef:'Riff', island:'Insel', islands:'Inseln', point:'Spitze', bay:'Bucht', rock:'Felsen', rocks:'Felsen', cave:'Höhle', caves:'Höhlen', wall:'Wand', beach:'Strand', garden:'Garten', coral:'Koralle', lagoon:'Lagune', pinnacle:'Felsspitze', channel:'Kanal', shoal:'Untiefe', canyon:'Canyon', cove:'Bucht', corner:'Ecke', ledge:'Felsvorsprung', passage:'Passage', bridge:'Brücke', harbor:'Hafen', harbour:'Hafen', pier:'Pier', lake:'See', river:'Fluss', spring:'Quelle', springs:'Quellen', quarry:'Steinbruch', north:'Nord', south:'Süd', east:'Ost', west:'West', blue:'Blau', white:'Weiß', black:'Schwarz', red:'Rot', green:'Grün', yellow:'Gelb', shark:'Hai', turtle:'Schildkröte', manta:'Mantarochen', deep:'Tief', big:'Groß', little:'Klein', small:'Klein', great:'Groß' },
    nl: { wreck:'wrak', shipwreck:'wrak', reef:'rif', island:'eiland', islands:'eilanden', point:'punt', bay:'baai', rock:'rots', rocks:'rotsen', cave:'grot', caves:'grotten', wall:'wand', beach:'strand', garden:'tuin', coral:'koraal', lagoon:'lagune', pinnacle:'rotsnaald', channel:'kanaal', shoal:'ondiepte', canyon:'canyon', cove:'inham', corner:'hoek', ledge:'richel', passage:'doorgang', bridge:'brug', harbor:'haven', harbour:'haven', pier:'steiger', lake:'meer', river:'rivier', spring:'bron', springs:'bronnen', quarry:'steengroeve', north:'noord', south:'zuid', east:'oost', west:'west', blue:'blauw', white:'wit', black:'zwart', red:'rood', green:'groen', yellow:'geel', shark:'haai', turtle:'schildpad', manta:'mantarog', deep:'diep', big:'groot', little:'klein', small:'klein', great:'groot' },
    it: { wreck:'relitto', shipwreck:'relitto', reef:'barriera corallina', island:'isola', islands:'isole', point:'punta', bay:'baia', rock:'roccia', rocks:'rocce', cave:'grotta', caves:'grotte', wall:'parete', beach:'spiaggia', garden:'giardino', coral:'corallo', lagoon:'laguna', pinnacle:'pinnacolo', channel:'canale', shoal:'secca', canyon:'canyon', cove:'insenatura', corner:'angolo', ledge:'cengia', passage:'passaggio', bridge:'ponte', harbor:'porto', harbour:'porto', pier:'molo', lake:'lago', river:'fiume', spring:'sorgente', springs:'sorgenti', quarry:'cava', north:'nord', south:'sud', east:'est', west:'ovest', blue:'blu', white:'bianco', black:'nero', red:'rosso', green:'verde', yellow:'giallo', shark:'squalo', turtle:'tartaruga', manta:'manta', deep:'profondo', big:'grande', little:'piccolo', small:'piccolo', great:'grande' },
    ru: { wreck:'затонувший корабль', shipwreck:'затонувший корабль', reef:'риф', island:'остров', islands:'острова', point:'мыс', bay:'бухта', rock:'скала', rocks:'скалы', cave:'пещера', caves:'пещеры', wall:'стена', beach:'пляж', garden:'сад', coral:'коралл', lagoon:'лагуна', pinnacle:'скала', channel:'пролив', shoal:'мель', canyon:'каньон', cove:'бухта', corner:'угол', ledge:'уступ', passage:'проход', bridge:'мост', harbor:'порт', harbour:'порт', pier:'пирс', lake:'озеро', river:'река', spring:'источник', springs:'источники', quarry:'карьер', north:'северный', south:'южный', east:'восточный', west:'западный', blue:'синий', white:'белый', black:'чёрный', red:'красный', green:'зелёный', yellow:'жёлтый', shark:'акула', turtle:'черепаха', manta:'манта', deep:'глубокий', big:'большой', little:'маленький', small:'маленький', great:'большой' },
    pt: { wreck:'naufrágio', shipwreck:'naufrágio', reef:'recife', island:'ilha', islands:'ilhas', point:'ponta', bay:'baía', rock:'rocha', rocks:'rochas', cave:'gruta', caves:'grutas', wall:'parede', beach:'praia', garden:'jardim', coral:'coral', lagoon:'lagoa', pinnacle:'pináculo', channel:'canal', shoal:'baixio', canyon:'cânion', cove:'enseada', corner:'canto', ledge:'patamar', passage:'passagem', bridge:'ponte', harbor:'porto', harbour:'porto', pier:'píer', lake:'lago', river:'rio', spring:'nascente', springs:'nascentes', quarry:'pedreira', north:'norte', south:'sul', east:'leste', west:'oeste', blue:'azul', white:'branco', black:'preto', red:'vermelho', green:'verde', yellow:'amarelo', shark:'tubarão', turtle:'tartaruga', manta:'manta', deep:'profundo', big:'grande', little:'pequeno', small:'pequeno', great:'grande' },
    sv: { wreck:'vrak', shipwreck:'vrak', reef:'rev', island:'ö', islands:'öar', point:'udde', bay:'vik', rock:'klippa', rocks:'klippor', cave:'grotta', caves:'grottor', wall:'vägg', beach:'strand', garden:'trädgård', coral:'korall', lagoon:'lagun', pinnacle:'klipptopp', channel:'kanal', shoal:'grund', canyon:'kanjon', cove:'vik', corner:'hörn', ledge:'avsats', passage:'passage', bridge:'bro', harbor:'hamn', harbour:'hamn', pier:'brygga', lake:'sjö', river:'flod', spring:'källa', springs:'källor', quarry:'stenbrott', north:'norra', south:'södra', east:'östra', west:'västra', blue:'blå', white:'vit', black:'svart', red:'röd', green:'grön', yellow:'gul', shark:'haj', turtle:'sköldpadda', manta:'mantorocka', deep:'djup', big:'stor', little:'liten', small:'liten', great:'stor' },
    no: { wreck:'vrak', shipwreck:'vrak', reef:'rev', island:'øy', islands:'øyer', point:'odde', bay:'bukt', rock:'klippe', rocks:'klipper', cave:'grotte', caves:'grotter', wall:'vegg', beach:'strand', garden:'hage', coral:'korall', lagoon:'lagune', pinnacle:'topp', channel:'kanal', shoal:'grunne', canyon:'canyon', cove:'vik', corner:'hjørne', ledge:'hylle', passage:'passasje', bridge:'bro', harbor:'havn', harbour:'havn', pier:'brygge', lake:'innsjø', river:'elv', spring:'kilde', springs:'kilder', quarry:'steinbrudd', north:'nord', south:'sør', east:'øst', west:'vest', blue:'blå', white:'hvit', black:'svart', red:'rød', green:'grønn', yellow:'gul', shark:'hai', turtle:'skilpadde', manta:'mantarokke', deep:'dyp', big:'stor', little:'liten', small:'liten', great:'stor' },
    es: { wreck:'pecio', shipwreck:'naufragio', reef:'arrecife', island:'isla', islands:'islas', point:'punta', bay:'bahía', rock:'roca', rocks:'rocas', cave:'cueva', caves:'cuevas', wall:'pared', beach:'playa', garden:'jardín', coral:'coral', lagoon:'laguna', pinnacle:'pináculo', channel:'canal', shoal:'bajo', canyon:'cañón', cove:'cala', corner:'esquina', ledge:'repisa', passage:'paso', bridge:'puente', harbor:'puerto', harbour:'puerto', pier:'muelle', lake:'lago', river:'río', spring:'manantial', springs:'manantiales', quarry:'cantera', north:'norte', south:'sur', east:'este', west:'oeste', blue:'azul', white:'blanco', black:'negro', red:'rojo', green:'verde', yellow:'amarillo', shark:'tiburón', turtle:'tortuga', manta:'manta', deep:'profundo', big:'grande', little:'pequeño', small:'pequeño', great:'gran' },
    ko: { wreck:'난파선', shipwreck:'난파선', reef:'산호초', island:'섬', islands:'제도', point:'포인트', bay:'만', rock:'바위', rocks:'바위', cave:'동굴', caves:'동굴', wall:'월', beach:'해변', garden:'정원', coral:'산호', lagoon:'라군', pinnacle:'수중 봉우리', channel:'수로', shoal:'여울', canyon:'해저 협곡', cove:'작은 만', corner:'코너', ledge:'암붕', passage:'해협', bridge:'다리', harbor:'항구', harbour:'항구', pier:'부두', lake:'호수', river:'강', spring:'샘', springs:'샘', quarry:'채석장', north:'북쪽', south:'남쪽', east:'동쪽', west:'서쪽', blue:'블루', white:'화이트', black:'블랙', red:'레드', green:'그린', yellow:'옐로', shark:'상어', turtle:'거북이', manta:'쥐가오리', deep:'딥', big:'큰', little:'작은', small:'작은', great:'그레이트' },
    id: { wreck:'bangkai kapal', shipwreck:'bangkai kapal', reef:'terumbu', island:'pulau', islands:'kepulauan', point:'tanjung', bay:'teluk', rock:'karang', rocks:'karang', cave:'gua', caves:'gua', wall:'dinding', beach:'pantai', garden:'taman', coral:'karang', lagoon:'laguna', pinnacle:'puncak', channel:'selat', shoal:'gosong', canyon:'ngarai', cove:'teluk kecil', corner:'sudut', ledge:'tebing', passage:'jalur', bridge:'jembatan', harbor:'pelabuhan', harbour:'pelabuhan', pier:'dermaga', lake:'danau', river:'sungai', spring:'mata air', springs:'mata air', quarry:'kuari', north:'utara', south:'selatan', east:'timur', west:'barat', blue:'biru', white:'putih', black:'hitam', red:'merah', green:'hijau', yellow:'kuning', shark:'hiu', turtle:'penyu', manta:'pari manta', deep:'dalam', big:'besar', little:'kecil', small:'kecil', great:'besar' }
  };

  const PULAU_NAMES = {
    zh: suffix => `${suffix}岛`, en: suffix => `${suffix} Island`, ja: suffix => `${suffix}島`,
    fr: suffix => `Île de ${suffix}`, de: suffix => `Insel ${suffix}`, nl: suffix => `Eiland ${suffix}`,
    it: suffix => `Isola di ${suffix}`, ru: suffix => `Остров ${suffix}`, pt: suffix => `Ilha de ${suffix}`,
    sv: suffix => `${suffix}ön`, no: suffix => `${suffix}øya`, es: suffix => `Isla de ${suffix}`,
    ko: suffix => `${suffix}섬`
  };

  const PHRASES = {
    zh: { 'blue hole':'蓝洞', 'shark point':'鲨鱼角', 'manta point':'蝠鲼点', 'coral garden':'珊瑚花园' },
    ja: { 'blue hole':'ブルーホール', 'shark point':'シャークポイント', 'manta point':'マンタポイント', 'coral garden':'コーラルガーデン' },
    fr: { 'blue hole':'Trou Bleu', 'shark point':'Pointe aux requins', 'manta point':'Pointe aux raies manta', 'coral garden':'Jardin de corail' },
    de: { 'blue hole':'Blaues Loch', 'shark point':'Hai-Spitze', 'manta point':'Manta-Spitze', 'coral garden':'Korallengarten' },
    nl: { 'blue hole':'Blauwe Gat', 'shark point':'Haaienpunt', 'manta point':'Mantapunt', 'coral garden':'Koraaltuin' },
    it: { 'blue hole':'Buco Blu', 'shark point':'Punta degli squali', 'manta point':'Punta Manta', 'coral garden':'Giardino di corallo' },
    ru: { 'blue hole':'Голубая дыра', 'shark point':'Акулий мыс', 'manta point':'Мыс мант', 'coral garden':'Коралловый сад' },
    pt: { 'blue hole':'Buraco Azul', 'shark point':'Ponta dos Tubarões', 'manta point':'Ponta das Mantas', 'coral garden':'Jardim de Corais' },
    sv: { 'blue hole':'Blå hålet', 'shark point':'Hajudden', 'manta point':'Mantaudden', 'coral garden':'Korallträdgården' },
    no: { 'blue hole':'Blått hull', 'shark point':'Haiodden', 'manta point':'Mantaodden', 'coral garden':'Korallhagen' },
    es: { 'blue hole':'Agujero Azul', 'shark point':'Punta Tiburón', 'manta point':'Punta Manta', 'coral garden':'Jardín de Coral' },
    ko: { 'blue hole':'블루홀', 'shark point':'상어 포인트', 'manta point':'만타 포인트', 'coral garden':'코랄 가든' },
    id: { 'blue hole':'Lubang Biru', 'shark point':'Tanjung Hiu', 'manta point':'Tanjung Pari Manta', 'coral garden':'Taman Karang' }
  };

  const ADDITIONAL_WORDS = {
    zh: { hole:'洞', paradise:'天堂', city:'城', temple:'寺', statue:'雕像', lighthouse:'灯塔', dropoff:'断崖' },
    ja: { hole:'ホール', paradise:'パラダイス', city:'シティ', temple:'寺院', statue:'像', lighthouse:'灯台', dropoff:'ドロップオフ' },
    fr: { hole:'trou', paradise:'paradis', city:'ville', temple:'temple', statue:'statue', lighthouse:'phare', dropoff:'tombant' },
    de: { hole:'Loch', paradise:'Paradies', city:'Stadt', temple:'Tempel', statue:'Statue', lighthouse:'Leuchtturm', dropoff:'Abhang' },
    nl: { hole:'gat', paradise:'paradijs', city:'stad', temple:'tempel', statue:'beeld', lighthouse:'vuurtoren', dropoff:'steilwand' },
    it: { hole:'buco', paradise:'paradiso', city:'città', temple:'tempio', statue:'statua', lighthouse:'faro', dropoff:'parete' },
    ru: { hole:'дыра', paradise:'рай', city:'город', temple:'храм', statue:'статуя', lighthouse:'маяк', dropoff:'обрыв' },
    pt: { hole:'buraco', paradise:'paraíso', city:'cidade', temple:'templo', statue:'estátua', lighthouse:'farol', dropoff:'paredão' },
    sv: { hole:'hål', paradise:'paradis', city:'stad', temple:'tempel', statue:'staty', lighthouse:'fyr', dropoff:'brantvägg' },
    no: { hole:'hull', paradise:'paradis', city:'by', temple:'tempel', statue:'statue', lighthouse:'fyr', dropoff:'brattvegg' },
    es: { hole:'agujero', paradise:'paraíso', city:'ciudad', temple:'templo', statue:'estatua', lighthouse:'faro', dropoff:'pared' },
    ko: { hole:'홀', paradise:'파라다이스', city:'시티', temple:'사원', statue:'동상', lighthouse:'등대', dropoff:'드롭오프' },
    id: { hole:'lubang', paradise:'surga', city:'kota', temple:'kuil', statue:'patung', lighthouse:'mercusuar', dropoff:'tebing curam' }
  };

  const SOURCE_ALIASES = [
    ['terumbu karang', 'reef'], ['barriera corallina', 'reef'], ['затонувший корабль', 'shipwreck'],
    ['épaves', 'wreck'], ['épave', 'wreck'], ['récifs', 'reef'], ['récif', 'reef'],
    ['îles', 'island'], ['île', 'island'], ['pointes', 'point'], ['pointe', 'point'],
    ['baies', 'bay'], ['baie', 'bay'], ['rochers', 'rock'], ['rocher', 'rock'],
    ['grottes', 'cave'], ['grotte', 'cave'], ['plages', 'beach'], ['plage', 'beach'],
    ['jardins', 'garden'], ['jardin', 'garden'], ['coraux', 'coral'], ['corail', 'coral'],
    ['lagons', 'lagoon'], ['lagon', 'lagoon'], ['chenal', 'channel'],
    ['wracks', 'wreck'], ['wrack', 'wreck'], ['riffe', 'reef'], ['riff', 'reef'],
    ['inseln', 'island'], ['insel', 'island'], ['spitzen', 'point'], ['spitze', 'point'],
    ['buchten', 'bay'], ['bucht', 'bay'], ['felsen', 'rock'], ['fels', 'rock'],
    ['höhlen', 'cave'], ['höhle', 'cave'], ['strände', 'beach'], ['strand', 'beach'],
    ['gärten', 'garden'], ['garten', 'garden'], ['korallen', 'coral'], ['koralle', 'coral'],
    ['lagunen', 'lagoon'], ['lagune', 'lagoon'],
    ['bangkai kapal', 'shipwreck'], ['kepulauan', 'island'], ['pulau-pulau', 'island'],
    ['pulau', 'island'], ['tanjung', 'point'], ['teluk', 'bay'], ['karang', 'reef'],
    ['pantai', 'beach'], ['gua', 'cave'], ['dinding', 'wall'], ['taman', 'garden'],
    ['selat', 'channel'], ['batu', 'rock'], ['kepala', 'head'],
    ['pecios', 'wreck'], ['pecio', 'wreck'], ['naufragio', 'shipwreck'],
    ['arrecifes', 'reef'], ['arrecife', 'reef'], ['islas', 'island'], ['isla', 'island'],
    ['puntas', 'point'], ['punta', 'point'], ['bahías', 'bay'], ['bahía', 'bay'],
    ['rocas', 'rock'], ['roca', 'rock'], ['cuevas', 'cave'], ['cueva', 'cave'],
    ['playas', 'beach'], ['playa', 'beach'], ['jardines', 'garden'], ['jardín', 'garden'],
    ['lagunas', 'lagoon'], ['laguna', 'lagoon'], ['ilhas', 'island'], ['ilha', 'island'],
    ['isole', 'island'], ['isola', 'island']
  ].sort(([left], [right]) => right.length - left.length);

  const CJK_SOURCE_ALIASES = [
    ['沉船', 'shipwreck'], ['珊瑚礁', 'reef'], ['岛礁', 'island reef'], ['海岛', 'island'],
    ['岛', 'island'], ['島', 'island'], ['灣', 'bay'], ['湾', 'bay'], ['岩礁', 'rock'], ['礁', 'reef'],
    ['洞穴', 'cave'], ['海滩', 'beach'], ['花园', 'garden'], ['珊瑚', 'coral'],
    ['泻湖', 'lagoon'], ['潟湖', 'lagoon']
  ].sort(([left], [right]) => right.length - left.length);

  const REPLACEMENTS = {};
  for (const [lang, words] of Object.entries(WORDS)) {
    REPLACEMENTS[lang] = Object.entries({ ...words, ...ADDITIONAL_WORDS[lang] })
      .sort(([left], [right]) => right.length - left.length);
  }

  function translateWords(name, lang) {
    let result = name;
    for (const [source, canonical] of SOURCE_ALIASES) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      result = result.replace(expression, (match, leading) => `${leading}${canonical}`);
    }
    for (const [source, canonical] of CJK_SOURCE_ALIASES) {
      result = result.split(source).join(canonical);
    }
    const phrases = Object.entries(PHRASES[lang] || {}).sort(([left], [right]) => right.length - left.length);
    for (const [source, translated] of phrases) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      result = result.replace(expression, (match, leading, phrase) => {
        const replacement = phrase[0] === phrase[0].toLocaleUpperCase()
          ? translated[0].toLocaleUpperCase() + translated.slice(1)
          : translated;
        return `${leading}${replacement}`;
      });
    }
    for (const [source, translated] of REPLACEMENTS[lang] || []) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      result = result.replace(expression, (match, leading, word) => {
        const replacement = word[0] === word[0].toLocaleUpperCase()
          ? translated[0].toLocaleUpperCase() + translated.slice(1)
          : translated;
        return `${leading}${replacement}`;
      });
    }
    return result;
  }

  function localize(name, lang, siteId) {
    const original = String(name || '').trim();
    const language = String(lang || 'en').split(/[-_]/)[0].toLowerCase();
    if (!original) return original;

    const translationCatalog = global.DIVE_SITE_NAME_TRANSLATIONS;
    const verifiedEntry = translationCatalog?.verifiedBySiteId?.[String(siteId || '')]?.[language];
    const verifiedName = typeof verifiedEntry === 'string' ? verifiedEntry : verifiedEntry?.name;
    if (typeof verifiedName === 'string' && verifiedName.trim()) return verifiedName.trim();

    const siteTranslation = translationCatalog?.bySiteId?.[String(siteId || '')]?.[language];
    if (typeof siteTranslation === 'string' && siteTranslation.trim()) return siteTranslation.trim();

    const pulauTemplate = PULAU_NAMES[language];
    const pulauMatch = pulauTemplate && original.match(/^Pulau\s+(.+)$/i);
    if (pulauMatch) return pulauTemplate(pulauMatch[1].trim());

    return translateWords(original, language);
  }

  global.DIVE_SITE_NAME_LOCALIZATION = Object.freeze({ localize });
})(window);
