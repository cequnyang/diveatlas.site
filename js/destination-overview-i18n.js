(() => {
  'use strict';
  const keys = ['summary','water','clarity','currents','temp','annual','range','novRange','clearer','noRange','noNumeric','mayRange','check','varies','wind','augWind','sources','selected','selection','planning','seasonal','mapLabel','mapAlt','sourceIntro','sourceNotes','regions'];
  // Destination copy is separate from recorded names, photo credits and map
  // labels. Those source values must not be rewritten as translated facts.
  const rows = {
    en: [
      'Reef gardens, ocean pinnacles and island passages in Indonesia. Compare seasonal conditions and explore the dive sites.',
      'Water temperature','Underwater clarity','Currents & access','~29°C surface','Annual surface average','15–20 m reported','Nov–Apr operator range','Often clearer locally','No monthly range','No numeric range in source','May–Aug; no numeric range','Check locally','Varies by site and tide','Wind can affect access','August winds may disrupt access','Sources and notes','Selected dive sites','Selected for contrasting recorded features. Confirm suitability with a local guide.','Planning month','Seasonal conditions','Explore Raja Ampat on the main map','Raja Ampat coastline and nearby places. Marker shows the mean of recorded site coordinates, not an individual dive site.','Local guidance from',', consulted 11 Nov 2026. Temperature is an annual surface average; visibility is a seasonal operator range. These are not measured monthly climatology, dive-depth readings or live conditions. Confirm conditions with a local guide.','Regions'
    ],
    zh: [
      '探索印度尼西亚的珊瑚花园、海中礁峰与岛间水道，比较季节性海况，发现适合行程的潜点。',
      '水温','水下能见度','海流与通行','表层约29°C','全年表层平均值','运营方报告15–20米','运营方11月至4月参考范围','当地通常更清澈','暂无月度范围','来源未提供数值范围','5月至8月；无数值范围','请向当地确认','随潜点和潮汐变化','风可能影响通行','8月的风可能影响通行','来源与说明','精选潜点','按已记录的不同地形特征选择。请向当地潜导确认是否适合。','行程月份','季节性海况','在主地图上探索四王群岛','四王群岛海岸线及周边地名。标记为已记录潜点坐标的平均位置，不代表单个潜点。','当地指导来自','，查阅于2026年11月11日。水温为全年表层平均值，能见度为运营方提供的季节参考范围，并非实测月度气候统计、潜水深度水温或实时海况。请向当地潜导确认。','地区'
    ],
    'zh-TW': [
      '探索印度尼西亞的珊瑚花園、海中礁峰與島間水道，比較季節性海況，發現適合行程的潛點。',
      '水溫','水下能見度','海流與通行','表層約29°C','全年表層平均值','業者報告15–20公尺','業者11月至4月參考範圍','當地通常更清澈','暫無月度範圍','來源未提供數值範圍','5月至8月；無數值範圍','請向當地確認','隨潛點和潮汐變化','風可能影響通行','8月的風可能影響通行','來源與說明','精選潛點','按已記錄的不同地形特徵選擇。請向當地潛導確認是否適合。','行程月份','季節性海況','在主地圖上探索四王群島','四王群島海岸線及周邊地名。標記為已記錄潛點座標的平均位置，不代表單一潛點。','當地指引來自','，查閱於2026年11月11日。水溫為全年表層平均值，能見度為業者提供的季節參考範圍，並非實測月度氣候統計、潛水深度水溫或即時海況。請向當地潛導確認。','地區'
    ],
    es: [
      'Jardines de coral, pináculos marinos y pasos entre islas de Indonesia. Compara las condiciones estacionales y explora los sitios de buceo.',
      'Temperatura del agua','Visibilidad submarina','Corrientes y acceso','~29°C en superficie','Media anual en superficie','15–20 m según operador','Rango del operador: nov–abr','Suele estar más clara localmente','Sin rango mensual','La fuente no da un rango numérico','May–ago; sin rango numérico','Consulta localmente','Varía según el sitio y la marea','El viento puede afectar al acceso','El viento de agosto puede dificultar el acceso','Fuentes y notas','Sitios de buceo seleccionados','Selección por sus distintas características registradas. Confirma la idoneidad con un guía local.','Mes del viaje','Condiciones estacionales','Explora Raja Ampat en el mapa principal','Costa de Raja Ampat y lugares cercanos. El marcador indica la media de las coordenadas registradas, no un sitio individual.','Información local de',', consultada el 11 nov 2026. La temperatura es una media anual de superficie; la visibilidad es un rango estacional del operador. No son datos climatológicos mensuales medidos, lecturas a profundidad ni condiciones en directo. Confirma las condiciones con un guía local.','Regiones'
    ],
    de: [
      'Korallengärten, Unterwasserpinnacles und Inselpassagen in Indonesien. Vergleiche saisonale Bedingungen und erkunde die Tauchplätze.',
      'Wassertemperatur','Sicht unter Wasser','Strömung und Zugang','~29°C an der Oberfläche','Jahresmittel an der Oberfläche','15–20 m laut Anbieter','Anbieterangabe: Nov–Apr','Vor Ort häufig klarer','Keine Monatsspanne','Quelle ohne Zahlenbereich','Mai–Aug; ohne Zahlenbereich','Vor Ort nachfragen','Je nach Tauchplatz und Gezeiten','Wind kann den Zugang beeinflussen','Augustwinde können den Zugang erschweren','Quellen und Hinweise','Ausgewählte Tauchplätze','Nach unterschiedlichen erfassten Merkmalen ausgewählt. Eignung mit einem örtlichen Guide klären.','Reisemonat','Saisonale Bedingungen','Raja Ampat auf der Hauptkarte erkunden','Küste von Raja Ampat und nahe Orte. Der Marker zeigt den Mittelwert erfasster Koordinaten, keinen einzelnen Tauchplatz.','Örtliche Hinweise von',', abgerufen am 11. Nov. 2026. Die Temperatur ist ein Jahresmittel an der Oberfläche; die Sichtweite eine saisonale Anbieterangabe. Dies sind keine gemessenen monatlichen Klimadaten, Tiefenmessungen oder Live-Bedingungen. Bedingungen mit einem örtlichen Guide klären.','Regionen'
    ],
    fr: [
      'Jardins de coraux, pinacles sous-marins et passages entre les îles d’Indonésie. Comparez les conditions saisonnières et explorez les sites de plongée.',
      'Température de l’eau','Visibilité sous-marine','Courants et accès','~29°C en surface','Moyenne annuelle de surface','15–20 m selon l’opérateur','Fourchette opérateur : nov–avr','Souvent plus claire localement','Pas de fourchette mensuelle','Aucune plage chiffrée dans la source','Mai–août ; sans plage chiffrée','Se renseigner sur place','Varie selon le site et la marée','Le vent peut affecter l’accès','Les vents d’août peuvent gêner l’accès','Sources et notes','Sites de plongée sélectionnés','Sélection selon des caractéristiques recensées différentes. Confirmez votre aptitude avec un guide local.','Mois du voyage','Conditions saisonnières','Explorer Raja Ampat sur la carte principale','Côtes de Raja Ampat et lieux proches. Le repère indique la moyenne des coordonnées recensées, pas un site individuel.','Conseils locaux de',', consultés le 11 nov. 2026. La température est une moyenne annuelle de surface ; la visibilité est une fourchette saisonnière fournie par l’opérateur. Il ne s’agit pas de mesures climatologiques mensuelles, de relevés en profondeur ni de conditions en direct. Vérifiez avec un guide local.','Régions'
    ],
    ja: [
      'インドネシアのサンゴの庭、水中の尖礁、島々の水道。季節ごとの状況を比較し、ダイビングスポットを探しましょう。',
      '水温','水中の透明度','潮流とアクセス','表層 約29°C','表層の年間平均','事業者報告 15〜20m','事業者の11〜4月の目安','現地では透明度が高い傾向','月別の範囲なし','出典に数値範囲なし','5〜8月・数値範囲なし','現地で確認','スポットと潮汐により変動','風がアクセスに影響する場合あり','8月の風でアクセスが制限される場合あり','出典と注記','厳選ダイビングスポット','記録された地形の違いを基に選定。適性は現地ガイドに確認してください。','旅行の月','季節ごとの状況','メインマップでラジャ・アンパットを見る','ラジャ・アンパットの海岸線と周辺地名。マーカーは記録された座標の平均位置で、個別のスポットではありません。','現地情報の提供元：','。2026年11月11日閲覧。水温は表層の年間平均、透明度は事業者が示す季節的な範囲です。実測の月別気候統計、潜水深度での測定値、リアルタイムの状況ではありません。現地ガイドに確認してください。','地域'
    ],
    pt: [
      'Jardins de coral, pináculos submarinos e passagens entre ilhas da Indonésia. Compare as condições sazonais e explore os locais de mergulho.',
      'Temperatura da água','Visibilidade subaquática','Correntes e acesso','~29°C à superfície','Média anual à superfície','15–20 m segundo o operador','Intervalo do operador: nov–abr','Geralmente mais clara localmente','Sem intervalo mensal','A fonte não indica intervalo numérico','Mai–ago; sem intervalo numérico','Confirme localmente','Varia com o local e a maré','O vento pode afetar o acesso','Os ventos de agosto podem dificultar o acesso','Fontes e notas','Locais de mergulho selecionados','Seleção por características registadas distintas. Confirme a adequação com um guia local.','Mês da viagem','Condições sazonais','Explorar Raja Ampat no mapa principal','Costa de Raja Ampat e locais próximos. O marcador indica a média das coordenadas registadas, não um local individual.','Orientações locais de',', consultadas em 11 nov. 2026. A temperatura é uma média anual à superfície; a visibilidade é um intervalo sazonal do operador. Não são dados climatológicos mensais medidos, leituras à profundidade de mergulho nem condições em direto. Confirme com um guia local.','Regiões'
    ],
    it: [
      'Giardini di corallo, pinnacoli sommersi e passaggi tra le isole dell’Indonesia. Confronta le condizioni stagionali ed esplora i siti di immersione.',
      'Temperatura dell’acqua','Visibilità subacquea','Correnti e accesso','~29°C in superficie','Media annuale in superficie','15–20 m secondo l’operatore','Intervallo operatore: nov–apr','Spesso più limpida localmente','Nessun intervallo mensile','La fonte non dà un intervallo numerico','Mag–ago; nessun intervallo numerico','Verifica sul posto','Varia secondo sito e marea','Il vento può influire sull’accesso','I venti di agosto possono ostacolare l’accesso','Fonti e note','Siti di immersione selezionati','Scelti per le diverse caratteristiche registrate. Verifica l’idoneità con una guida locale.','Mese del viaggio','Condizioni stagionali','Esplora Raja Ampat sulla mappa principale','Costa di Raja Ampat e località vicine. Il marcatore indica la media delle coordinate registrate, non un singolo sito.','Indicazioni locali di',', consultate l’11 nov 2026. La temperatura è una media annuale di superficie; la visibilità è un intervallo stagionale dell’operatore. Non sono misure climatologiche mensili, rilevazioni in profondità o condizioni in tempo reale. Verifica con una guida locale.','Regioni'
    ],
    ru: [
      'Коралловые сады, подводные вершины и проливы между островами Индонезии. Сравните сезонные условия и изучите места для дайвинга.',
      'Температура воды','Подводная видимость','Течения и доступ','~29°C у поверхности','Среднегодовая у поверхности','15–20 м по данным оператора','Диапазон оператора: нояб.–апр.','На месте часто прозрачнее','Нет месячного диапазона','В источнике нет числового диапазона','Май–авг.; без числового диапазона','Уточняйте на месте','Зависит от места и прилива','Ветер может затруднить доступ','Августовские ветры могут затруднить доступ','Источники и примечания','Избранные места для дайвинга','Выбраны по различающимся зарегистрированным особенностям. Уточните пригодность у местного гида.','Месяц поездки','Сезонные условия','Открыть Раджа-Ампат на основной карте','Побережье Раджа-Ампат и окрестности. Маркер показывает среднее зарегистрированных координат, а не отдельное место погружения.','Местные рекомендации от',', просмотрено 11 ноября 2026 г. Температура — среднегодовая у поверхности, видимость — сезонный диапазон оператора. Это не измеренная месячная климатология, не показания на глубине и не текущие условия. Уточняйте у местного гида.','Регионы'
    ],
    ko: [
      '인도네시아의 산호 정원, 수중 봉우리와 섬 사이 수로. 계절별 환경을 비교하고 다이빙 포인트를 살펴보세요.',
      '수온','수중 시야','조류와 접근','표층 약29°C','연간 표층 평균','운영자 보고 15–20m','운영자 기준 11–4월 범위','현지에서 더 맑은 경향','월별 범위 없음','출처에 수치 범위 없음','5–8월; 수치 범위 없음','현지에 확인','포인트와 조석에 따라 변동','바람이 접근에 영향을 줄 수 있음','8월 바람으로 접근이 어려울 수 있음','출처 및 참고','선별한 다이빙 포인트','기록된 지형 특성의 차이를 기준으로 선정했습니다. 적합성은 현지 가이드에게 확인하세요.','여행 월','계절별 환경','기본 지도에서 라자암팟 보기','라자암팟 해안선과 주변 지명. 표시는 기록된 좌표의 평균 위치이며 개별 다이빙 포인트가 아닙니다.','현지 정보 제공:',' · 2026년 11월 11일 확인. 수온은 연간 표층 평균이며 시야는 운영자가 제시한 계절 범위입니다. 실측 월별 기후 통계, 잠수 수심의 측정값 또는 실시간 환경이 아닙니다. 현지 가이드에게 확인하세요.','지역'
    ],
    nl: [
      'Koraaltuinen, onderwaterpieken en doorgangen tussen Indonesische eilanden. Vergelijk seizoensomstandigheden en ontdek de duiklocaties.',
      'Watertemperatuur','Zicht onder water','Stroming en toegang','~29°C aan het oppervlak','Jaargemiddelde aan het oppervlak','15–20 m volgens aanbieder','Bereik aanbieder: nov–apr','Plaatselijk vaak helderder','Geen maandbereik','Geen cijferbereik in de bron','Mei–aug; geen cijferbereik','Vraag ter plaatse na','Verschilt per locatie en getij','Wind kan toegang beïnvloeden','Augustuswinden kunnen toegang hinderen','Bronnen en opmerkingen','Geselecteerde duiklocaties','Gekozen om verschillende vastgelegde kenmerken. Bespreek geschiktheid met een lokale gids.','Reismaand','Seizoensomstandigheden','Raja Ampat op de hoofdkaart verkennen','Kust van Raja Ampat en nabijgelegen plaatsen. De markering toont het gemiddelde van vastgelegde coördinaten, geen afzonderlijke duiklocatie.','Lokale informatie van',', geraadpleegd op 11 nov 2026. De temperatuur is een jaarlijks oppervlaktegemiddelde; het zicht is een seizoensbereik van de aanbieder. Dit zijn geen gemeten maandelijkse klimaatgegevens, dieptemetingen of actuele omstandigheden. Vraag een lokale gids.','Regio’s'
    ],
    id: [
      'Taman karang, puncak bawah laut, dan selat antarpulau di Indonesia. Bandingkan kondisi musiman dan jelajahi lokasi selam.',
      'Suhu air','Jarak pandang bawah air','Arus dan akses','~29°C di permukaan','Rata-rata tahunan permukaan','15–20 m menurut operator','Rentang operator: Nov–Apr','Sering lebih jernih setempat','Tidak ada rentang bulanan','Sumber tanpa rentang angka','Mei–Agu; tanpa rentang angka','Konfirmasi setempat','Berubah menurut lokasi dan pasang surut','Angin dapat memengaruhi akses','Angin Agustus dapat menghambat akses','Sumber dan catatan','Lokasi selam pilihan','Dipilih berdasarkan perbedaan fitur yang tercatat. Konfirmasikan kesesuaian dengan pemandu setempat.','Bulan perjalanan','Kondisi musiman','Jelajahi Raja Ampat di peta utama','Garis pantai Raja Ampat dan tempat di sekitarnya. Penanda menunjukkan rata-rata koordinat yang tercatat, bukan satu lokasi selam.','Panduan lokal dari',', diakses 11 Nov 2026. Suhu adalah rata-rata tahunan permukaan; jarak pandang adalah rentang musiman dari operator. Ini bukan klimatologi bulanan terukur, pembacaan pada kedalaman selam, atau kondisi langsung. Konfirmasikan dengan pemandu setempat.','Wilayah'
    ],
    sv: [
      'Korallträdgårdar, undervattenstoppar och passager mellan Indonesiens öar. Jämför säsongsförhållanden och utforska dykplatserna.',
      'Vattentemperatur','Sikt under vatten','Strömmar och tillträde','~29°C vid ytan','Årsmedel vid ytan','15–20 m enligt operatören','Operatörens intervall: nov–apr','Ofta klarare lokalt','Inget månadsintervall','Källan saknar numeriskt intervall','Maj–aug; inget numeriskt intervall','Kontrollera lokalt','Varierar med plats och tidvatten','Vind kan påverka tillträdet','Augustivindar kan försvåra tillträdet','Källor och noter','Utvalda dykplatser','Valda för olika registrerade egenskaper. Kontrollera lämpligheten med en lokal guide.','Resemånad','Säsongsförhållanden','Utforska Raja Ampat på huvudkartan','Raja Ampats kust och närliggande platser. Markören visar medelvärdet av registrerade koordinater, inte en enskild dykplats.','Lokal vägledning från',', läst 11 nov 2026. Temperaturen är ett årsmedel vid ytan; sikten är operatörens säsongsintervall. Detta är inte uppmätt månadsklimatologi, mätningar på dykdjup eller aktuella förhållanden. Kontrollera med en lokal guide.','Regioner'
    ],
    no: [
      'Korallhager, undervannstopper og passasjer mellom Indonesias øyer. Sammenlign sesongforhold og utforsk dykkestedene.',
      'Vanntemperatur','Sikt under vann','Strøm og tilgang','~29°C ved overflaten','Årsgjennomsnitt ved overflaten','15–20 m ifølge operatøren','Operatørens intervall: nov–apr','Ofte klarere lokalt','Intet månedsintervall','Kilden mangler tallintervall','Mai–aug; uten tallintervall','Sjekk lokalt','Varierer med sted og tidevann','Vind kan påvirke tilgangen','Augustvind kan hindre tilgang','Kilder og merknader','Utvalgte dykkesteder','Valgt for ulike registrerte egenskaper. Avklar egnethet med en lokal guide.','Reisemåned','Sesongforhold','Utforsk Raja Ampat på hovedkartet','Kysten av Raja Ampat og nærliggende steder. Markøren viser gjennomsnittet av registrerte koordinater, ikke ett dykkested.','Lokal veiledning fra',', lest 11. nov. 2026. Temperaturen er et årsgjennomsnitt ved overflaten; sikten er operatørens sesongintervall. Dette er ikke målt månedsklimatologi, målinger på dykkedybde eller sanntidsforhold. Sjekk med en lokal guide.','Regioner'
    ]
  };
  keys.push('waves','waveValue','waveNote');
  const waveRows = {
    en:['Waves','Not available','No wave data in source'],
    zh:['海浪','暂无数据','来源未提供海浪数据'],
    'zh-TW':['海浪','暫無資料','來源未提供海浪資料'],
    es:['Oleaje','No disponible','La fuente no aporta datos de oleaje'],
    de:['Wellen','Nicht verfügbar','Quelle ohne Wellendaten'],
    fr:['Vagues','Non disponible','Aucune donnée sur les vagues dans la source'],
    ja:['波','データなし','出典に波のデータなし'],
    pt:['Ondas','Indisponível','A fonte não fornece dados de ondas'],
    it:['Onde','Non disponibile','La fonte non riporta dati sulle onde'],
    ru:['Волны','Нет данных','В источнике нет данных о волнах'],
    ko:['파도','데이터 없음','출처에 파도 데이터 없음'],
    nl:['Golven','Niet beschikbaar','Geen golfgegevens in de bron'],
    id:['Gelombang','Tidak tersedia','Sumber tidak menyediakan data gelombang'],
    sv:['Vågor','Uppgift saknas','Källan saknar vågdata'],
    no:['Bølger','Ikke tilgjengelig','Kilden mangler bølgedata'],
  };
  for (const [language, values] of Object.entries(rows)) values.push(...waveRows[language]);
  for (const [language, values] of Object.entries(rows)) {
    if (values.length !== keys.length) throw new Error(`Incomplete destination translations: ${language}`);
  }
  // Generic destinations deliberately have no inferred seasonal profile.
  const genericKeys = ['genericSummary','genericConditionNote','genericSources','starting','genericSelection','genericMapLabel','genericMapAlt'];
  const genericRows = {
    en:['Explore recorded dive sites in {destination}.','No sourced destination-level data','Site profiles come from existing DiveAtlas records. No sourced destination-level seasonal data is available. Confirm conditions with a local guide.','A starting selection','Automatically selected for recorded feature variety. Confirm suitability with a local guide.','Explore {destination} on the main map','{destination} and nearby places. Marker shows the mean of recorded site coordinates, not an individual dive site.'],
    zh:['探索{destination}已记录的潜点。','暂无有来源的目的地海况数据','潜点资料来自现有DiveAtlas记录。暂无有来源的目的地季节性海况数据，请向当地潜导确认。','潜点初选','根据已记录的不同特点自动选择，请向当地潜导确认是否适合。','在主地图上探索{destination}','{destination}及周边地点。标记为已记录潜点坐标的平均位置，不代表单个潜点。'],
    'zh-TW':['探索{destination}已記錄的潛點。','暫無有來源的目的地海況資料','潛點資料來自現有DiveAtlas記錄。暫無有來源的目的地季節性海況資料，請向當地潛導確認。','潛點初選','根據已記錄的不同特點自動選擇，請向當地潛導確認是否適合。','在主地圖上探索{destination}','{destination}及周邊地點。標記為已記錄潛點座標的平均位置，不代表單一潛點。'],
    es:['Explora los sitios registrados en {destination}.','Sin datos de destino con fuente','Los perfiles proceden de los registros de DiveAtlas. No hay datos estacionales del destino con fuente. Consulta a un guía local.','Una selección inicial','Selección automática por variedad de características registradas. Confirma la idoneidad con un guía local.','Explora {destination} en el mapa principal','{destination} y alrededores. El marcador indica la media de las coordenadas registradas, no un sitio individual.'],
    de:['Erkunde erfasste Tauchplätze in {destination}.','Keine belegten Daten zum Reiseziel','Die Profile stammen aus DiveAtlas-Datensätzen. Es liegen keine belegten saisonalen Daten zum Reiseziel vor. Bedingungen vor Ort klären.','Eine erste Auswahl','Automatisch nach unterschiedlichen erfassten Merkmalen ausgewählt. Eignung mit einem örtlichen Guide klären.','{destination} auf der Hauptkarte erkunden','{destination} und Umgebung. Der Marker zeigt den Mittelwert erfasster Koordinaten, keinen einzelnen Tauchplatz.'],
    fr:['Explorez les sites recensés à {destination}.','Aucune donnée sourcée pour la destination','Les profils proviennent des données DiveAtlas. Aucune donnée saisonnière sourcée pour la destination n’est disponible. Consultez un guide local.','Une première sélection','Sélection automatique selon la variété des caractéristiques recensées. Vérifiez votre aptitude avec un guide local.','Explorer {destination} sur la carte principale','{destination} et ses environs. Le repère indique la moyenne des coordonnées recensées, pas un site individuel.'],
    ja:['{destination}に記録されたダイビングスポットを探しましょう。','出典のある地域データなし','既存のDiveAtlas記録に基づくスポット情報です。地域の季節別データはありません。現地ガイドに確認してください。','最初の候補','記録された特徴の違いに基づく自動選定です。適性は現地ガイドに確認してください。','メインマップで{destination}を見る','{destination}と周辺の地点。マーカーは記録された座標の平均位置で、個別のスポットではありません。'],
    pt:['Explore locais registados em {destination}.','Sem dados do destino com fonte','Os perfis provêm dos registos DiveAtlas. Não há dados sazonais do destino com fonte. Confirme com um guia local.','Uma seleção inicial','Seleção automática pela variedade de características registadas. Confirme a adequação com um guia local.','Explorar {destination} no mapa principal','{destination} e arredores. O marcador indica a média das coordenadas registadas, não um local individual.'],
    it:['Esplora i siti registrati a {destination}.','Dati della destinazione non disponibili','I profili provengono dai dati DiveAtlas. Non sono disponibili dati stagionali della destinazione con fonte. Verifica con una guida locale.','Una selezione iniziale','Selezione automatica per varietà di caratteristiche registrate. Verifica l’idoneità con una guida locale.','Esplora {destination} sulla mappa principale','{destination} e dintorni. Il marcatore indica la media delle coordinate registrate, non un singolo sito.'],
    ru:['Изучите зарегистрированные места в {destination}.','Нет данных о регионе с источником','Профили основаны на записях DiveAtlas. Сезонных данных о регионе с источником нет. Уточните условия у местного гида.','Начальная подборка','Автоматическая подборка по разнообразию зарегистрированных особенностей. Уточните пригодность у местного гида.','Открыть {destination} на основной карте','{destination} и окрестности. Маркер показывает среднее зарегистрированных координат, а не отдельное место погружения.'],
    ko:['{destination}에 기록된 다이빙 포인트를 살펴보세요.','출처가 있는 지역 데이터 없음','포인트 정보는 기존 DiveAtlas 기록에서 가져옵니다. 출처가 있는 지역별 계절 데이터가 없습니다. 현지 가이드에게 확인하세요.','첫 추천 목록','기록된 특징의 다양성에 따른 자동 선택입니다. 적합성은 현지 가이드에게 확인하세요.','메인 지도에서 {destination} 보기','{destination} 및 주변 장소. 마커는 기록된 좌표의 평균이며 개별 포인트가 아닙니다.'],
    nl:['Ontdek geregistreerde duikplekken in {destination}.','Geen onderbouwde bestemmingsgegevens','Profielen komen uit bestaande DiveAtlas-gegevens. Er zijn geen onderbouwde seizoensgegevens voor de bestemming. Vraag een lokale gids.','Een eerste selectie','Automatisch geselecteerd op verschillende geregistreerde kenmerken. Bespreek geschiktheid met een lokale gids.','Verken {destination} op de hoofdkaart','{destination} en omgeving. De marker toont het gemiddelde van geregistreerde coördinaten, geen individuele duikplek.'],
    id:['Jelajahi lokasi selam tercatat di {destination}.','Tidak ada data destinasi bersumber','Profil berasal dari catatan DiveAtlas. Data musiman destinasi bersumber belum tersedia. Konfirmasikan kondisi dengan pemandu setempat.','Pilihan awal','Dipilih otomatis berdasarkan keragaman fitur tercatat. Konfirmasikan kesesuaian dengan pemandu setempat.','Jelajahi {destination} di peta utama','{destination} dan sekitarnya. Penanda menunjukkan rata-rata koordinat tercatat, bukan satu lokasi selam.'],
    sv:['Utforska registrerade dykplatser i {destination}.','Inga källbelagda destinationsdata','Profilerna kommer från DiveAtlas register. Källbelagda säsongsdata för destinationen saknas. Kontrollera med en lokal guide.','Ett första urval','Automatiskt urval efter olika registrerade egenskaper. Kontrollera lämpligheten med en lokal guide.','Utforska {destination} på huvudkartan','{destination} och omgivningar. Markören visar medelvärdet av registrerade koordinater, inte en enskild dykplats.'],
    no:['Utforsk registrerte dykkesteder i {destination}.','Ingen kildebelagte destinasjonsdata','Profilene kommer fra DiveAtlas-registeret. Kildebelagte sesongdata for destinasjonen mangler. Sjekk med en lokal guide.','Et første utvalg','Automatisk utvalg etter ulike registrerte egenskaper. Avklar egnethet med en lokal guide.','Utforsk {destination} på hovedkartet','{destination} og omgivelsene. Markøren viser gjennomsnittet av registrerte koordinater, ikke ett dykkested.']
  };
  for (const language of Object.keys(rows)) {
    if (genericRows[language]?.length !== genericKeys.length) throw new Error(`Incomplete generic destination translations: ${language}`);
  }
  genericKeys.push('exploreMore');
  const exploreMore = {en:'Explore more', zh:'探索更多', 'zh-TW':'探索更多', es:'Explorar más', de:'Mehr entdecken', fr:'Explorer davantage', ja:'もっと見る', pt:'Explorar mais', it:'Esplora di più', ru:'Узнать больше', ko:'더 둘러보기', nl:'Meer ontdekken', id:'Jelajahi lainnya', sv:'Utforska mer', no:'Utforsk mer'};
  for (const language of Object.keys(rows)) genericRows[language].push(exploreMore[language]);
  function language() { return rows[document.documentElement.lang] ? document.documentElement.lang : 'en'; }
  function t(key) {
    const value = genericRows[language()][genericKeys.indexOf(key)] || rows[language()][keys.indexOf(key)] || rows.en[keys.indexOf(key)] || key;
    return value.replaceAll('{destination}', document.querySelector('.destination-overview')?.dataset.destinationName || '');
  }
  window.DiveAtlasDestinationI18n = {t, languages:Object.keys(rows)};

  const select = document.getElementById('destination-month');
  const main = document.querySelector('.destination-overview');
  if (!main) return;
  const generic = main.dataset.conditionProfile === 'unavailable';
  const crumbs = [...main.querySelectorAll('.breadcrumbs a')].map(node => [node,node.textContent]);
  const features = [...main.querySelectorAll('.site-recommendations__feature')].map(node => [node,node.textContent]);
  const cardLabels = [...main.querySelectorAll('.site-recommendations__features[aria-label], .site-recommendations__rating[aria-label]')].map(node => [node,node.getAttribute('aria-label')]);
  function apply() {
    const locale = language();
    main.querySelectorAll('[data-destination-text]').forEach(node => { node.textContent = t(node.dataset.destinationText); });
    if(select) {
    const label = main.querySelector('label[for="destination-month"]');
    label.textContent = t('planning');
    select.setAttribute('aria-label',t('planning'));
    const formatter = new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'});
    [...select.options].forEach((option,index) => { option.textContent = formatter.format(new Date(Date.UTC(2020,index,1))); });
    select.dispatchEvent(new Event('diveatlas:wheel-labels-change'));
    }
    document.getElementById('destination-seasons').setAttribute('aria-label',t('seasonal'));
    const inset = main.querySelector('.destination-map-inset');
    if(inset) {
      inset.setAttribute('aria-label',t(generic ? 'genericMapLabel' : 'mapLabel'));
      inset.querySelector('.destination-map-inset__link').setAttribute('aria-label',t(generic ? 'genericMapLabel' : 'mapLabel'));
      inset.querySelector('img').alt=t(generic ? 'genericMapAlt' : 'mapAlt');
    }
    const regions = main.querySelector('.breadcrumbs a');
    if(regions) regions.textContent=t('regions');
    for(const [index,[node,source]] of crumbs.entries()) {
      if(index) node.textContent=window.DiveAtlasSiteDetailI18n?.translate(source,locale) || source;
    }
    for(const [node,source] of features) node.textContent=window.DiveAtlasSiteDetailI18n?.translate(source,locale) || source;
    for(const [node,source] of cardLabels) node.setAttribute('aria-label',window.DiveAtlasSiteDetailI18n?.translate(source,locale) || source);
    localizeRatings();
    window.dispatchEvent(new Event('diveatlas:destination-language-ready'));
  }
  function localizeRatings() {
    for(const node of main.querySelectorAll('.site-recommendations__rating')) {
      for(const source of ['Rating loading','Rating unavailable']) {
        // Recognize the previous language too when toggling back to English.
        const known = Object.keys(rows).map(locale=>window.DiveAtlasSiteDetailI18n?.translate(source,locale) || source);
        if(known.includes(node.textContent)) {
          const next=window.DiveAtlasSiteDetailI18n?.translate(source,language()) || source;
          if(node.textContent!==next) node.textContent=next;
        }
      }
    }
  }
  const observer = new MutationObserver(localizeRatings);
  main.querySelectorAll('.site-recommendations__rating').forEach(node=>observer.observe(node,{childList:true,subtree:true,characterData:true}));
  window.addEventListener('diveatlas:language-change',apply);
  apply();
})();
