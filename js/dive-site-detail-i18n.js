(() => {
  'use strict';

  const languages = ['zh', 'es', 'de', 'fr', 'ja', 'pt', 'it', 'ru', 'ko', 'nl', 'id', 'sv', 'no'];
  // Each row follows the language order above so the shared detail page can
  // localize its fixed UI without duplicating its rendering templates.
  const rows = [
    ['Dive Site', [
      '潜水点', 'Sitio de buceo',
      'Tauchplatz', 'Site de plongée',
      'ダイビングスポット', 'Local de mergulho',
      'Sito d’immersione', 'Место для дайвинга',
      '다이빙 포인트', 'Duiklocatie',
      'Situs selam', 'Dykplats',
      'Dykkested'
    ]],
    ['Loading dive site…', [
      '正在加载潜水点…', 'Cargando sitio de buceo…',
      'Tauchplatz wird geladen…', 'Chargement du site de plongée…',
      'ダイビングスポットを読み込み中…', 'Carregando local de mergulho…',
      'Caricamento del sito d’immersione…', 'Загрузка места для дайвинга…',
      '다이빙 포인트를 불러오는 중…', 'Duiklocatie laden…',
      'Memuat situs selam…', 'Läser in dykplats…',
      'Laster inn dykkested…'
    ]],
    ['Please wait while the site details load.', [
      '请稍候，正在加载潜水点详情。', 'Espera mientras se cargan los detalles.',
      'Bitte warten Sie, während die Tauchplatzdetails geladen werden.', 'Veuillez patienter pendant le chargement des détails.',
      '詳細を読み込んでいます。しばらくお待ちください。', 'Aguarde enquanto os detalhes são carregados.',
      'Attendi mentre vengono caricati i dettagli.', 'Подождите, пока загрузятся сведения о месте.',
      '장소 정보를 불러오는 동안 잠시 기다려 주세요.', 'Even wachten terwijl de gegevens worden geladen.',
      'Tunggu hingga detail situs dimuat.', 'Vänta medan platsinformationen läses in.',
      'Vent mens stedsdetaljene lastes inn.'
    ]],
    ['Choose a dive site', [
      '选择一个潜水点', 'Elige un sitio de buceo',
      'Wählen Sie einen Tauchplatz', 'Choisissez un site de plongée',
      'ダイビングスポットを選択', 'Escolha um local de mergulho',
      'Scegli un sito d’immersione', 'Выберите место для дайвинга',
      '다이빙 포인트를 선택하세요', 'Kies een duiklocatie',
      'Pilih situs selam', 'Välj en dykplats',
      'Velg et dykkested'
    ]],
    ['This link needs a valid dive-site ID. Open a dive site from the map.', [
      '此链接需要有效的潜水点 ID。请从地图打开一个潜水点。', 'Este enlace necesita un ID válido. Abre un sitio desde el mapa.',
      'Dieser Link benötigt eine gültige Tauchplatz-ID. Öffnen Sie einen Platz über die Karte.', 'Ce lien nécessite un identifiant valide. Ouvrez un site depuis la carte.',
      '有効なスポット ID が必要です。地図からスポットを開いてください。', 'Este link precisa de um ID válido. Abra um local pelo mapa.',
      'Questo link richiede un ID valido. Apri un sito dalla mappa.', 'Для ссылки нужен действительный ID. Откройте место на карте.',
      '유효한 포인트 ID가 필요합니다. 지도에서 포인트를 여세요.', 'Deze link vereist een geldig ID. Open een locatie vanaf de kaart.',
      'Tautan ini memerlukan ID yang valid. Buka situs dari peta.', 'Länken behöver ett giltigt ID. Öppna en plats från kartan.',
      'Lenken trenger en gyldig ID. Åpne et sted fra kartet.'
    ]],
    ['Dive site unavailable', [
      '无法查看潜水点', 'Sitio de buceo no disponible',
      'Tauchplatz nicht verfügbar', 'Site de plongée indisponible',
      'スポットを利用できません', 'Local de mergulho indisponível',
      'Sito d’immersione non disponibile', 'Место для дайвинга недоступно',
      '다이빙 포인트를 사용할 수 없습니다', 'Duiklocatie niet beschikbaar',
      'Situs selam tidak tersedia', 'Dykplatsen är inte tillgänglig',
      'Dykkestedet er ikke tilgjengelig'
    ]],
    ['This dive site is not available in the published data. You can still explore the map.', [
      '此潜水点不在已发布的数据中。你仍可以浏览地图。', 'Este sitio no está en los datos publicados. Aún puedes explorar el mapa.',
      'Dieser Tauchplatz ist in den veröffentlichten Daten nicht verfügbar. Sie können weiterhin die Karte erkunden.', 'Ce site ne figure pas dans les données publiées. Vous pouvez tout de même explorer la carte.',
      'このスポットは公開データにありません。地図は引き続きご覧いただけます。', 'Este local não está nos dados publicados. Você ainda pode explorar o mapa.',
      'Questo sito non è presente nei dati pubblicati. Puoi comunque esplorare la mappa.', 'Этого места нет в опубликованных данных. Вы всё ещё можете изучать карту.',
      '이 다이빙 포인트는 공개 데이터에 없습니다. 지도는 계속 둘러볼 수 있습니다.', 'Deze duiklocatie staat niet in de gepubliceerde gegevens. U kunt de kaart wel verkennen.',
      'Situs ini tidak tersedia dalam data yang dipublikasikan. Anda tetap dapat menjelajahi peta.', 'Dykplatsen finns inte i de publicerade uppgifterna. Du kan fortfarande utforska kartan.',
      'Dykkestedet finnes ikke i de publiserte dataene. Du kan fortsatt utforske kartet.'
    ]],
    ['Unable to load this dive site', [
      '无法加载此潜水点', 'No se pudo cargar este sitio de buceo',
      'Dieser Tauchplatz konnte nicht geladen werden', 'Impossible de charger ce site de plongée',
      'このスポットを読み込めません', 'Não foi possível carregar este local',
      'Impossibile caricare questo sito', 'Не удалось загрузить это место для дайвинга',
      '이 다이빙 포인트를 불러올 수 없습니다', 'Deze duiklocatie kan niet worden geladen',
      'Situs selam ini tidak dapat dimuat', 'Det gick inte att läsa in dykplatsen',
      'Kunne ikke laste inn dykkestedet'
    ]],
    ['Please check your connection and try again.', [
      '请检查网络连接后重试。', 'Comprueba tu conexión e inténtalo de nuevo.',
      'Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.', 'Vérifiez votre connexion et réessayez.',
      '接続を確認して、もう一度お試しください。', 'Verifique sua conexão e tente novamente.',
      'Controlla la connessione e riprova.', 'Проверьте подключение и попробуйте ещё раз.',
      '연결을 확인한 후 다시 시도하세요.', 'Controleer uw verbinding en probeer het opnieuw.',
      'Periksa koneksi Anda lalu coba lagi.', 'Kontrollera anslutningen och försök igen.',
      'Sjekk tilkoblingen og prøv igjen.'
    ]],
    ['Try again', [
      '重试', 'Reintentar',
      'Erneut versuchen', 'Réessayer',
      '再試行', 'Tentar novamente',
      'Riprova', 'Повторить попытку',
      '다시 시도', 'Opnieuw proberen',
      'Coba lagi', 'Försök igen',
      'Prøv igjen'
    ]],
    ['Return to the DiveAtlas map', [
      '返回 DiveAtlas 地图', 'Volver al mapa de DiveAtlas',
      'Zurück zur DiveAtlas-Karte', 'Retourner à la carte DiveAtlas',
      'DiveAtlas の地図に戻る', 'Voltar ao mapa do DiveAtlas',
      'Torna alla mappa DiveAtlas', 'Вернуться к карте DiveAtlas',
      'DiveAtlas 지도로 돌아가기', 'Terug naar de DiveAtlas-kaart',
      'Kembali ke peta DiveAtlas', 'Tillbaka till DiveAtlas-kartan',
      'Tilbake til DiveAtlas-kartet'
    ]],
    ['Open full-size photo preview', [
      '打开大图预览', 'Abrir vista previa de la foto completa',
      'Foto in voller Größe anzeigen', 'Ouvrir l’aperçu de la photo en taille réelle',
      '写真を原寸大で表示', 'Abrir prévia da foto em tamanho real',
      'Apri l’anteprima della foto a grandezza naturale', 'Открыть полноразмерное фото',
      '전체 크기 사진 미리보기 열기', 'Voorbeeld op ware grootte openen',
      'Buka pratinjau foto ukuran penuh', 'Öppna förhandsvisning i full storlek',
      'Åpne forhåndsvisning i full størrelse'
    ]],
    ['No site photo is available.', [
      '暂无该潜水点的照片。', 'No hay fotos disponibles de este sitio.',
      'Für diesen Tauchplatz ist kein Foto verfügbar.', 'Aucune photo n’est disponible pour ce site.',
      'このスポットの写真はありません。', 'Não há foto disponível para este local.',
      'Non è disponibile una foto del sito.', 'Для этого места нет фотографий.',
      '이 포인트의 사진이 없습니다.', 'Er is geen foto van deze locatie beschikbaar.',
      'Foto situs ini tidak tersedia.', 'Det finns inget foto av platsen.',
      'Det finnes ikke noe bilde av stedet.'
    ]],
    ['Dive site actions', [
      '潜水点操作', 'Acciones del sitio',
      'Aktionen zum Tauchplatz', 'Actions du site de plongée',
      'スポットの操作', 'Ações do local',
      'Azioni del sito', 'Действия с местом',
      '다이빙 포인트 작업', 'Acties voor duiklocatie',
      'Tindakan situs selam', 'Åtgärder för dykplatsen',
      'Handlinger for dykkestedet'
    ]],
    // Keep the brand lockup unchanged in every locale; only nearby UI copy is translated.
    ['DiveAtlas Rating', [
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating'
    ]],
    ['DiveAtlas rating', [
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating', 'diveAtlas Rating',
      'diveAtlas Rating'
    ]],
    ['Rating', [
      '评分', 'Valoración',
      'Bewertung', 'Note',
      '評価', 'Avaliação',
      'Valutazione', 'Оценка',
      '평점', 'Beoordeling',
      'Penilaian', 'Betyg',
      'Vurdering'
    ]],
    ['Loading rating…', [
      '正在加载评分…', 'Cargando valoración…',
      'Bewertung wird geladen…', 'Chargement de la note…',
      '評価を読み込み中…', 'Carregando avaliação…',
      'Caricamento della valutazione…', 'Загрузка оценки…',
      '평점을 불러오는 중…', 'Beoordeling laden…',
      'Memuat penilaian…', 'Läser in betyg…',
      'Laster inn vurdering…'
    ]],
    ['Monthly Rating', [
      '月度评分', 'Valoración mensual',
      'Monatliche Bewertung', 'Note mensuelle',
      '月別評価', 'Avaliação mensal',
      'Valutazione mensile', 'Оценка по месяцам',
      '월간 평점', 'Maandelijkse beoordeling',
      'Penilaian bulanan', 'Månadsbetyg',
      'Månedlig vurdering'
    ]],
    ['Monthly dive-site rating scores', [
      '潜水点月度评分', 'Puntuaciones mensuales del sitio',
      'Monatliche Bewertungen des Tauchplatzes', 'Notes mensuelles du site de plongée',
      '月ごとのスポット評価', 'Pontuações mensais do local de mergulho',
      'Punteggi mensili del sito d’immersione', 'Ежемесячные оценки места для дайвинга',
      '월별 다이빙 포인트 평점', 'Maandelijkse beoordelingen van de duiklocatie',
      'Skor penilaian situs per bulan', 'Månatliga betyg för dykplatsen',
      'Månedlige vurderinger av dykkestedet'
    ]],
    ['Collapse monthly rating chart', [
      '收起月度评分图表', 'Contraer el gráfico de valoración mensual',
      'Monatliches Bewertungsdiagramm einklappen', 'Réduire le graphique des notes mensuelles',
      '月別評価チャートを折りたたむ', 'Recolher o gráfico de avaliações mensais',
      'Riduci il grafico delle valutazioni mensili', 'Свернуть график оценок по месяцам',
      '월간 평점 차트 접기', 'Maandelijkse beoordelingsgrafiek inklappen',
      'Ciutkan grafik penilaian bulanan', 'Fäll ihop diagrammet med månadsbetyg',
      'Skjul diagrammet for månedlige vurderinger'
    ]],
    ['Map preview', [
      '地图预览', 'Vista previa del mapa',
      'Kartenvorschau', 'Aperçu de la carte',
      '地図プレビュー', 'Prévia do mapa',
      'Anteprima della mappa', 'Предварительный просмотр карты',
      '지도 미리보기', 'Kaartvoorbeeld',
      'Pratinjau peta', 'Kartförhandsvisning',
      'Kartforhåndsvisning'
    ]],
    ['View on the DiveAtlas map', [
      '在 DiveAtlas 地图中查看', 'Ver en el mapa de DiveAtlas',
      'Auf der DiveAtlas-Karte ansehen', 'Voir sur la carte DiveAtlas',
      'DiveAtlas の地図で見る', 'Ver no mapa do DiveAtlas',
      'Visualizza sulla mappa DiveAtlas', 'Посмотреть на карте DiveAtlas',
      'DiveAtlas 지도에서 보기', 'Bekijken op de DiveAtlas-kaart',
      'Lihat di peta DiveAtlas', 'Visa på DiveAtlas-kartan',
      'Vis på DiveAtlas-kartet'
    ]],
    ['View on map', [
      '在地图上查看', 'Ver en el mapa',
      'Auf der Karte ansehen', 'Voir sur la carte',
      '地図で見る', 'Ver no mapa',
      'Visualizza sulla mappa', 'Посмотреть на карте',
      '지도에서 보기', 'Bekijken op kaart',
      'Lihat di peta', 'Visa på kartan',
      'Vis på kartet'
    ]],
    ['Share this dive site', [
      '分享此潜水点', 'Compartir este sitio de buceo',
      'Diesen Tauchplatz teilen', 'Partager ce site de plongée',
      'このスポットを共有', 'Compartilhar este local',
      'Condividi questo sito d’immersione', 'Поделиться местом для дайвинга',
      '이 다이빙 포인트 공유', 'Deze duiklocatie delen',
      'Bagikan situs selam ini', 'Dela den här dykplatsen',
      'Del dette dykkestedet'
    ]],
    ['Location hierarchy', [
      '位置层级', 'Jerarquía de ubicación',
      'Standorthierarchie', 'Hiérarchie des lieux',
      '場所の階層', 'Hierarquia de localização',
      'Gerarchia della località', 'Иерархия местоположения',
      '위치 계층', 'Locatiehiërarchie',
      'Hierarki lokasi', 'Platsens hierarki',
      'Stedshierarki'
    ]],
    ['Also recorded as:', [
      '另有记录名称：', 'También registrado como:',
      'Auch bekannt als:', 'Également répertorié sous :',
      '別名：', 'Também registrado como:',
      'Registrato anche come:', 'Также известен как:',
      '다음 이름으로도 기록됨:', 'Ook geregistreerd als:',
      'Juga tercatat sebagai:', 'Även registrerad som:',
      'Også registrert som:'
    ]],
    ['Dive details', [
      '潜水详情', 'Detalles de buceo',
      'Tauchdetails', 'Détails de plongée',
      'ダイビング情報', 'Detalhes do mergulho',
      'Dettagli dell’immersione', 'Сведения о погружении',
      '다이빙 상세 정보', 'Duikgegevens',
      'Detail penyelaman', 'Dykdetaljer',
      'Dykkeinformasjon'
    ]],
    ['Coordinates', [
      '坐标', 'Coordenadas',
      'Koordinaten', 'Coordonnées',
      '座標', 'Coordenadas',
      'Coordinate', 'Координаты',
      '좌표', 'Coördinaten',
      'Koordinat', 'Koordinater',
      'Koordinater'
    ]],
    ['Open in Maps', [
      '在地图中打开', 'Abrir en Maps',
      'In Maps öffnen', 'Ouvrir dans Maps',
      'マップで開く', 'Abrir no Maps',
      'Apri in Maps', 'Открыть в Картах',
      '지도 앱에서 열기', 'Openen in Maps',
      'Buka di Maps', 'Öppna i Maps',
      'Åpne i Maps'
    ]],
    ['Recorded depth', [
      '记录深度', 'Profundidad registrada',
      'Erfasste Tiefe', 'Profondeur enregistrée',
      '記録された水深', 'Profundidade registrada',
      'Profondità registrata', 'Зафиксированная глубина',
      '기록된 수심', 'Geregistreerde diepte',
      'Kedalaman tercatat', 'Registrerat djup',
      'Registrert dybde'
    ]],
    ['Recorded depth range', [
      '记录深度范围', 'Rango de profundidad registrado',
      'Erfasster Tiefenbereich', 'Plage de profondeur enregistrée',
      '記録された水深範囲', 'Faixa de profundidade registrada',
      'Intervallo di profondità registrato', 'Зафиксированный диапазон глубин',
      '기록된 수심 범위', 'Geregistreerd dieptebereik',
      'Rentang kedalaman tercatat', 'Registrerat djupintervall',
      'Registrert dybdeområde'
    ]],
    ['Difficulty', [
      '难度', 'Dificultad',
      'Schwierigkeit', 'Difficulté',
      '難易度', 'Dificuldade',
      'Difficoltà', 'Сложность',
      '난이도', 'Moeilijkheid',
      'Kesulitan', 'Svårighetsgrad',
      'Vanskelighetsgrad'
    ]],
    ['Beginner', [
      '初级', 'Principiante',
      'Anfänger', 'Débutant',
      '初級', 'Iniciante',
      'Principiante', 'Начальный',
      '초급', 'Beginner',
      'Pemula', 'Nybörjare',
      'Nybegynner'
    ]],
    ['Intermediate', [
      '中级', 'Intermedio',
      'Fortgeschritten', 'Intermédiaire',
      '中級', 'Intermediário',
      'Intermedio', 'Средний',
      '중급', 'Gemiddeld',
      'Menengah', 'Medel',
      'Middels'
    ]],
    ['Advanced', [
      '高级', 'Avanzado',
      'Fortgeschritten', 'Avancé',
      '上級', 'Avançado',
      'Avanzato', 'Продвинутый',
      '고급', 'Gevorderd',
      'Lanjutan', 'Avancerad',
      'Avansert'
    ]],
    ['Expert', [
      '专家', 'Experto',
      'Experte', 'Expert',
      'エキスパート', 'Especialista',
      'Esperto', 'Эксперт',
      '전문가', 'Expert',
      'Ahli', 'Expert',
      'Ekspert'
    ]],
    // Canonical category words are translated individually; unknown source terms remain intact.
    ['marine', [
      '海洋', 'marino',
      'Meer', 'marin',
      '海洋', 'marinho',
      'marino', 'морская среда',
      '해양', 'marien',
      'laut', 'marin',
      'marin'
    ]],
    ['lake', [
      '湖泊', 'lago',
      'See', 'lac',
      '湖', 'lago',
      'lago', 'озеро',
      '호수', 'meer',
      'danau', 'sjö',
      'innsjø'
    ]],
    ['river', [
      '河流', 'río',
      'Fluss', 'rivière',
      '川', 'rio',
      'fiume', 'река',
      '강', 'rivier',
      'sungai', 'flod',
      'elv'
    ]],
    ['spring', [
      '泉', 'manantial',
      'Quelle', 'source',
      '泉', 'nascente',
      'sorgente', 'родник',
      '샘', 'bron',
      'mata air', 'källa',
      'kilde'
    ]],
    ['pool', [
      '泳池', 'piscina',
      'Pool', 'piscine',
      'プール', 'piscina',
      'piscina', 'бассейн',
      '수영장', 'zwembad',
      'kolam', 'pool',
      'basseng'
    ]],
    ['quarry', [
      '采石场', 'cantera',
      'Steinbruch', 'carrière',
      '採石場', 'pedreira',
      'cava', 'карьер',
      '채석장', 'groeve',
      'kuari', 'stenbrott',
      'steinbrudd'
    ]],
    ['shore', [
      '岸边', 'orilla',
      'Ufer', 'rivage',
      '岸', 'margem',
      'riva', 'берег',
      '해안', 'oever',
      'pantai', 'strand',
      'land'
    ]],
    ['boat', [
      '船', 'barco',
      'Boot', 'bateau',
      'ボート', 'barco',
      'barca', 'лодка',
      '보트', 'boot',
      'perahu', 'båt',
      'båt'
    ]],
    ['both', [
      '两者皆可', 'ambos',
      'beides', 'les deux',
      '両方', 'ambos',
      'entrambi', 'оба варианта',
      '모두', 'beide',
      'keduanya', 'båda',
      'begge'
    ]],
    ['reef', [
      '礁', 'arrecife',
      'Riff', 'récif',
      'リーフ', 'recife',
      'barriera corallina', 'риф',
      '산호초', 'rif',
      'terumbu', 'rev',
      'rev'
    ]],
    ['artificial reef', [
      '人工礁', 'arrecife artificial',
      'künstliches Riff', 'récif artificiel',
      '人工礁', 'recife artificial',
      'barriera artificiale', 'искусственный риф',
      '인공 암초', 'kunstmatig rif',
      'terumbu buatan', 'konstgjort rev',
      'kunstig rev'
    ]],
    ['wall', [
      '峭壁', 'pared',
      'Steilwand', 'tombant',
      '壁', 'parede',
      'parete', 'стена',
      '월', 'wand',
      'dinding', 'vägg',
      'vegg'
    ]],
    ['wreck', [
      '沉船', 'naufragio',
      'Wrack', 'épave',
      '沈船', 'naufrágio',
      'relitto', 'затонувший корабль',
      '난파선', 'wrak',
      'bangkai kapal', 'vrak',
      'vrak'
    ]],
    ['cave', [
      '洞穴', 'cueva',
      'Höhle', 'grotte',
      '洞窟', 'caverna',
      'grotta', 'пещера',
      '동굴', 'grot',
      'gua', 'grotta',
      'grotte'
    ]],
    ['cavern', [
      '洞窟', 'caverna',
      'Höhlensystem', 'caverne',
      '洞穴', 'caverna',
      'caverna', 'грот',
      '수중 동굴', 'caverne',
      'gua bawah air', 'grotta',
      'undervannsgrotte'
    ]],
    ['pinnacle', [
      '海峰', 'pináculo',
      'Felsnadel', 'pinnacle',
      'ピナクル', 'pínaculo',
      'pinnacolo', 'подводная вершина',
      '수중 봉우리', 'piek',
      'puncak bawah laut', 'undervattenstopp',
      'undervannstopp'
    ]],
    ['seamount', [
      '海山', 'monte submarino',
      'Seamount', 'mont sous-marin',
      '海山', 'monte submarino',
      'montagna sottomarina', 'подводная гора',
      '해산', 'onderzeese berg',
      'gunung bawah laut', 'undervattensberg',
      'undersjøisk fjell'
    ]],
    ['boulder', [
      '巨石', 'bloque rocoso',
      'Felsblock', 'bloc rocheux',
      '大きな岩', 'bloco rochoso',
      'masso', 'валун',
      '바위', 'rotsblok',
      'batu besar', 'klippblock',
      'steinblokk'
    ]],
    ['channel', [
      '水道', 'canal',
      'Kanal', 'chenal',
      '水路', 'canal',
      'canale', 'пролив',
      '수로', 'kanaal',
      'selat', 'kanal',
      'kanal'
    ]],
    ['sandy bottom', [
      '沙底', 'fondo arenoso',
      'Sandgrund', 'fond sableux',
      '砂地', 'fundo arenoso',
      'fondale sabbioso', 'песчаное дно',
      '모래 바닥', 'zandbodem',
      'dasar berpasir', 'sandbotten',
      'sandbunn'
    ]],
    ['kelp', [
      '海带', 'kelp',
      'Kelp', 'kelp',
      'ケルプ', 'kelp',
      'kelp', 'ламинария',
      '켈프', 'kelp',
      'kelp', 'kelp',
      'tare'
    ]],
    ['muck', [
      '淤泥', 'fondo fangoso',
      'Schlammboden', 'fond vaseux',
      '泥地', 'fundo lodoso',
      'fondale fangoso', 'илистое дно',
      '진흙 바닥', 'modderbodem',
      'dasar berlumpur', 'dybotten',
      'mudderbunn'
    ]],
    ['drift', [
      '漂流潜水', 'buceo a la deriva',
      'Strömungstauchen', 'plongée dérivante',
      'ドリフトダイビング', 'mergulho à deriva',
      'immersione in corrente', 'дрифт-дайвинг',
      '드리프트 다이빙', 'driftduik',
      'selam arus', 'strömdykning',
      'strømdykk'
    ]],
    ['archaeological', [
      '考古遗址', 'arqueológico',
      'archäologisch', 'archéologique',
      '考古学的', 'arqueológico',
      'archeologico', 'археологический',
      '고고학 유적', 'archeologisch',
      'arkeologis', 'arkeologisk',
      'arkeologisk'
    ]],
    ['manta', [
      '蝠鲼', 'manta',
      'Manta', 'raie manta',
      'マンタ', 'manta',
      'manta', 'манта',
      '쥐가오리', 'manta',
      'pari manta', 'mantorocka',
      'mantarokke'
    ]],
    ['Setting', [
      '环境类型', 'Entorno',
      'Umgebung', 'Environnement',
      '環境', 'Ambiente',
      'Ambiente', 'Тип места',
      '환경', 'Omgeving',
      'Kondisi lokasi', 'Miljö',
      'Miljø'
    ]],
    ['Access', [
      '到达方式', 'Acceso',
      'Zugang', 'Accès',
      'アクセス', 'Acesso',
      'Accesso', 'Доступ',
      '접근', 'Toegang',
      'Akses', 'Tillgänglighet',
      'Tilgang'
    ]],
    ['Features', [
      '特点', 'Características',
      'Merkmale', 'Caractéristiques',
      '特徴', 'Características',
      'Caratteristiche', 'Особенности',
      '특징', 'Kenmerken',
      'Fitur', 'Egenskaper',
      'Funksjoner'
    ]],
    ['Sources', [
      '来源', 'Fuentes',
      'Quellen', 'Sources',
      '情報源', 'Fontes',
      'Fonti', 'Источники',
      '출처', 'Bronnen',
      'Sumber', 'Källor',
      'Kilder'
    ]],
    ['Reference', [
      '参考资料', 'Referencia',
      'Referenz', 'Référence',
      '参考情報', 'Referência',
      'Riferimento', 'Ссылка',
      '참고 자료', 'Referentie',
      'Referensi', 'Referens',
      'Referanse'
    ]],
    ['Illustrative image', [
      '示意图片', 'Imagen ilustrativa',
      'Symbolbild', 'Image illustrative',
      'イメージ画像', 'Imagem ilustrativa',
      'Immagine illustrativa', 'Иллюстративное изображение',
      '예시 이미지', 'Illustratieve afbeelding',
      'Gambar ilustrasi', 'Illustrationsbild',
      'Illustrasjonsbilde'
    ]],
    ['Recorded details may not reflect current conditions. Check local guidance before diving.', [
      '记录的信息可能不代表当前状况。潜水前请查看当地指引。', 'Los datos registrados pueden no reflejar las condiciones actuales. Consulta las recomendaciones locales antes de bucear.',
      'Die erfassten Angaben spiegeln möglicherweise nicht die aktuellen Bedingungen wider. Beachten Sie vor dem Tauchen die örtlichen Hinweise.', 'Les informations enregistrées peuvent ne pas refléter les conditions actuelles. Consultez les recommandations locales avant de plonger.',
      '記録情報は現在の状況と異なる場合があります。潜水前に現地の案内を確認してください。', 'Os dados registrados podem não refletir as condições atuais. Consulte as orientações locais antes de mergulhar.',
      'I dati registrati potrebbero non riflettere le condizioni attuali. Verifica le indicazioni locali prima di immergerti.', 'Записанные сведения могут не отражать текущие условия. Перед погружением ознакомьтесь с местными рекомендациями.',
      '기록된 정보는 현재 상황과 다를 수 있습니다. 다이빙 전에 현지 안내를 확인하세요.', 'Geregistreerde gegevens geven mogelijk niet de actuele omstandigheden weer. Raadpleeg de lokale richtlijnen voordat u gaat duiken.',
      'Detail yang tercatat mungkin tidak mencerminkan kondisi saat ini. Periksa panduan setempat sebelum menyelam.', 'Registrerade uppgifter kanske inte speglar de aktuella förhållandena. Kontrollera lokala råd före dykning.',
      'Registrerte opplysninger gjenspeiler kanskje ikke dagens forhold. Sjekk lokale råd før du dykker.'
    ]],
    ['More in this region', [
      '此区域的更多潜水点', 'Más sitios en esta región',
      'Weitere Tauchplätze in dieser Region', 'Autres sites de cette région',
      'この地域の他のスポット', 'Mais locais nesta região',
      'Altri siti in questa regione', 'Другие места в этом регионе',
      '이 지역의 다른 포인트', 'Meer locaties in deze regio',
      'Situs lain di wilayah ini', 'Fler dykplatser i regionen',
      'Flere dykkesteder i regionen'
    ]],
    ['All', [
      '全部', 'Todos',
      'Alle', 'Tout',
      'すべて', 'Todos',
      'Tutti', 'Все',
      '전체', 'Alles',
      'Semua', 'Alla',
      'Alle'
    ]],
    ['Nearby', [
      '附近', 'Cercanos',
      'In der Nähe', 'À proximité',
      '近く', 'Próximos',
      'Vicini', 'Рядом',
      '근처', 'Dichtbij',
      'Terdekat', 'I närheten',
      'I nærheten'
    ]],
    ['Recorded features', [
      '记录的特点', 'Características registradas',
      'Erfasste Merkmale', 'Caractéristiques enregistrées',
      '記録された特徴', 'Características registradas',
      'Caratteristiche registrate', 'Зафиксированные особенности',
      '기록된 특징', 'Geregistreerde kenmerken',
      'Fitur tercatat', 'Registrerade egenskaper',
      'Registrerte funksjoner'
    ]],
    ['Features unavailable', [
      '暂无特点信息', 'Características no disponibles',
      'Merkmale nicht verfügbar', 'Caractéristiques indisponibles',
      '特徴情報なし', 'Características indisponíveis',
      'Caratteristiche non disponibili', 'Сведения об особенностях отсутствуют',
      '특징 정보 없음', 'Kenmerken niet beschikbaar',
      'Fitur tidak tersedia', 'Egenskaper saknas',
      'Funksjoner er ikke tilgjengelige'
    ]],
    ['Rating loading', [
      '正在加载评分', 'Cargando valoración',
      'Bewertung wird geladen', 'Chargement de la note',
      '評価を読み込み中', 'Carregando avaliação',
      'Caricamento della valutazione', 'Загрузка оценки',
      '평점 불러오는 중', 'Beoordeling laden',
      'Memuat penilaian', 'Läser in betyg',
      'Laster inn vurdering'
    ]],
    ['Select Rating to compare this site with the full catalog.', [
      '选择“评分”以将此潜水点与完整目录进行比较。', 'Selecciona «Valoración» para comparar este sitio con todo el catálogo.',
      'Wählen Sie „Bewertung“, um diesen Tauchplatz mit dem gesamten Katalog zu vergleichen.', 'Sélectionnez « Note » pour comparer ce site à l’ensemble du catalogue.',
      '「評価」を選択すると、全カタログと比較できます。', 'Selecione “Avaliação” para comparar este local com todo o catálogo.',
      'Seleziona «Valutazione» per confrontare questo sito con l’intero catalogo.', 'Выберите «Оценка», чтобы сравнить место со всем каталогом.',
      '전체 카탈로그와 비교하려면 ‘평점’을 선택하세요.', 'Selecteer ‘Beoordeling’ om deze locatie met de volledige catalogus te vergelijken.',
      'Pilih “Penilaian” untuk membandingkan situs ini dengan seluruh katalog.', 'Välj ”Betyg” för att jämföra platsen med hela katalogen.',
      'Velg «Vurdering» for å sammenligne stedet med hele katalogen.'
    ]],
    ['No nearby sites are available in the full catalog.', [
      '完整目录中没有附近的潜水点。', 'No hay sitios cercanos en el catálogo completo.',
      'Im vollständigen Katalog sind keine Tauchplätze in der Nähe verfügbar.', 'Aucun site à proximité n’est disponible dans le catalogue complet.',
      '全カタログに近くのスポットはありません。', 'Não há locais próximos no catálogo completo.',
      'Non ci sono siti vicini nel catalogo completo.', 'В полном каталоге нет мест поблизости.',
      '전체 카탈로그에 주변 포인트가 없습니다.', 'Er zijn geen locaties in de buurt in de volledige catalogus.',
      'Tidak ada situs terdekat dalam katalog lengkap.', 'Inga närliggande platser finns i hela katalogen.',
      'Ingen nærliggende dykkesteder finnes i hele katalogen.'
    ]],
    ['No sites match the recorded features.', [
      '没有潜水点符合记录的特点。', 'Ningún sitio coincide con las características registradas.',
      'Keine Tauchplätze entsprechen den erfassten Merkmalen.', 'Aucun site ne correspond aux caractéristiques enregistrées.',
      '記録された特徴に一致するスポットはありません。', 'Nenhum local corresponde às características registradas.',
      'Nessun sito corrisponde alle caratteristiche registrate.', 'Нет мест, соответствующих указанным особенностям.',
      '기록된 특징과 일치하는 포인트가 없습니다.', 'Geen locaties komen overeen met de geregistreerde kenmerken.',
      'Tidak ada situs yang cocok dengan fitur tercatat.', 'Inga platser matchar de registrerade egenskaperna.',
      'Ingen steder samsvarer med de registrerte funksjonene.'
    ]],
    ['No primary features are recorded for this site.', [
      '此潜水点没有记录主要特点。', 'No hay características principales registradas para este sitio.',
      'Für diesen Tauchplatz sind keine Hauptmerkmale erfasst.', 'Aucune caractéristique principale n’est enregistrée pour ce site.',
      'このスポットには主な特徴が記録されていません。', 'Nenhuma característica principal foi registrada para este local.',
      'Non sono registrate caratteristiche principali per questo sito.', 'Для этого места не указаны основные особенности.',
      '이 포인트에는 주요 특징이 기록되어 있지 않습니다.', 'Voor deze locatie zijn geen hoofdkenmerken geregistreerd.',
      'Tidak ada fitur utama yang tercatat untuk situs ini.', 'Inga huvudsakliga egenskaper har registrerats för platsen.',
      'Ingen hovedfunksjoner er registrert for dette stedet.'
    ]],
    ['No sites with the same recorded difficulty are available.', [
      '没有可用的同难度潜水点。', 'No hay sitios disponibles con la misma dificultad registrada.',
      'Es sind keine Tauchplätze mit derselben erfassten Schwierigkeit verfügbar.', 'Aucun site avec le même niveau de difficulté enregistré n’est disponible.',
      '同じ難易度として記録されたスポットはありません。', 'Não há locais disponíveis com o mesmo nível de dificuldade registrado.',
      'Non sono disponibili siti con la stessa difficoltà registrata.', 'Нет мест с таким же указанным уровнем сложности.',
      '같은 난이도로 기록된 포인트가 없습니다.', 'Er zijn geen locaties met dezelfde geregistreerde moeilijkheid beschikbaar.',
      'Tidak ada situs dengan tingkat kesulitan tercatat yang sama.', 'Inga platser med samma registrerade svårighetsgrad finns.',
      'Ingen steder med samme registrerte vanskelighetsgrad er tilgjengelige.'
    ]],
    ['Difficulty is not recorded for this site.', [
      '此潜水点未记录难度。', 'No se ha registrado la dificultad de este sitio.',
      'Für diesen Tauchplatz ist keine Schwierigkeit erfasst.', 'La difficulté de ce site n’est pas renseignée.',
      'このスポットの難易度は記録されていません。', 'A dificuldade deste local não foi registrada.',
      'La difficoltà di questo sito non è registrata.', 'Для этого места не указан уровень сложности.',
      '이 포인트의 난이도는 기록되어 있지 않습니다.', 'De moeilijkheid van deze locatie is niet geregistreerd.',
      'Tingkat kesulitan situs ini tidak tercatat.', 'Svårighetsgraden har inte registrerats för platsen.',
      'Vanskelighetsgraden for stedet er ikke registrert.'
    ]],
    ['No recommended dive sites are available.', [
      '暂无推荐潜水点。', 'No hay sitios de buceo recomendados.',
      'Es sind keine empfohlenen Tauchplätze verfügbar.', 'Aucun site de plongée recommandé n’est disponible.',
      'おすすめのスポットはありません。', 'Não há locais de mergulho recomendados.',
      'Non sono disponibili siti d’immersione consigliati.', 'Рекомендуемые места для дайвинга отсутствуют.',
      '추천 다이빙 포인트가 없습니다.', 'Er zijn geen aanbevolen duiklocaties beschikbaar.',
      'Tidak ada situs selam yang direkomendasikan.', 'Inga rekommenderade dykplatser finns.',
      'Ingen anbefalte dykkesteder er tilgjengelige.'
    ]],
    ['All recommended dive sites', [
      '所有推荐潜水点', 'Todos los sitios recomendados',
      'Alle empfohlenen Tauchplätze', 'Tous les sites recommandés',
      'おすすめのダイビングスポット一覧', 'Todos os locais recomendados',
      'Tutti i siti consigliati', 'Все рекомендованные места для дайвинга',
      '모든 추천 다이빙 포인트', 'Alle aanbevolen duiklocaties',
      'Semua situs selam yang direkomendasikan', 'Alla rekommenderade dykplatser',
      'Alle anbefalte dykkesteder'
    ]],
    ['Show More', [
      '显示更多', 'Mostrar más',
      'Mehr anzeigen', 'Afficher plus',
      'さらに表示', 'Mostrar mais',
      'Mostra altro', 'Показать ещё',
      '더 보기', 'Meer tonen',
      'Tampilkan lebih banyak', 'Visa fler',
      'Vis flere'
    ]],
    ['Search dive sites', [
      '搜索潜水点', 'Buscar sitios de buceo',
      'Tauchplätze suchen', 'Rechercher des sites de plongée',
      'ダイビングスポットを検索', 'Buscar locais de mergulho',
      'Cerca siti d’immersione', 'Поиск мест для дайвинга',
      '다이빙 포인트 검색', 'Duiklocaties zoeken',
      'Cari situs selam', 'Sök dykplatser',
      'Søk etter dykkesteder'
    ]],
    ['Where Will You Dive Next?', [
      '下一次你想去哪里潜水？', '¿Dónde bucearás después?',
      'Wo tauchen Sie als Nächstes?', 'Où plongerez-vous ensuite ?',
      '次はどこで潜りますか？', 'Onde você vai mergulhar agora?',
      'Dove ti immergerai la prossima volta?', 'Где вы будете нырять в следующий раз?',
      '다음에는 어디에서 다이빙할까요?', 'Waar duikt u hierna?',
      'Di mana Anda akan menyelam berikutnya?', 'Var dyker du nästa gång?',
      'Hvor skal du dykke neste gang?'
    ]],
    ['Clear search', [
      '清除搜索', 'Borrar búsqueda',
      'Suche löschen', 'Effacer la recherche',
      '検索をクリア', 'Limpar pesquisa',
      'Cancella ricerca', 'Очистить поиск',
      '검색 지우기', 'Zoekopdracht wissen',
      'Hapus pencarian', 'Rensa sökning',
      'Tøm søket'
    ]],
    ['Search filters', [
      '搜索筛选', 'Filtros de búsqueda',
      'Suchfilter', 'Filtres de recherche',
      '検索フィルター', 'Filtros de pesquisa',
      'Filtri di ricerca', 'Фильтры поиска',
      '검색 필터', 'Zoekfilters',
      'Filter pencarian', 'Sökfilter',
      'Søkefiltre'
    ]],
    ['Dive-site search results', [
      '潜水点搜索结果', 'Resultados de búsqueda de sitios',
      'Suchergebnisse für Tauchplätze', 'Résultats de recherche de sites',
      'スポットの検索結果', 'Resultados da busca por locais',
      'Risultati di ricerca dei siti', 'Результаты поиска мест',
      '다이빙 포인트 검색 결과', 'Zoekresultaten voor duiklocaties',
      'Hasil pencarian situs selam', 'Sökresultat för dykplatser',
      'Søkeresultater for dykkesteder'
    ]],
    ['Dive-site filters', [
      '潜水点筛选条件', 'Filtros de sitios de buceo',
      'Tauchplatzfilter', 'Filtres des sites de plongée',
      'スポットの絞り込み', 'Filtros de locais de mergulho',
      'Filtri dei siti d’immersione', 'Фильтры мест для дайвинга',
      '다이빙 포인트 필터', 'Filters voor duiklocaties',
      'Filter situs selam', 'Filter för dykplatser',
      'Filtre for dykkesteder'
    ]],
    ['Country', [
      '国家/地区', 'País',
      'Land', 'Pays',
      '国・地域', 'País',
      'Paese', 'Страна',
      '국가', 'Land',
      'Negara', 'Land',
      'Land'
    ]],
    ['Any country', [
      '任何国家/地区', 'Cualquier país',
      'Jedes Land', 'Tous les pays',
      'すべての国・地域', 'Qualquer país',
      'Qualsiasi paese', 'Любая страна',
      '모든 국가', 'Elk land',
      'Negara apa pun', 'Alla länder',
      'Alle land'
    ]],
    ['Any difficulty', [
      '任何难度', 'Cualquier dificultad',
      'Jede Schwierigkeit', 'Toute difficulté',
      'すべての難易度', 'Qualquer dificuldade',
      'Qualsiasi difficoltà', 'Любая сложность',
      '모든 난이도', 'Elke moeilijkheid',
      'Kesulitan apa pun', 'Alla svårighetsgrader',
      'Alle vanskelighetsgrader'
    ]],
    ['Any feature', [
      '任何特点', 'Cualquier característica',
      'Alle Merkmale', 'Toutes les caractéristiques',
      'すべての特徴', 'Qualquer característica',
      'Qualsiasi caratteristica', 'Любые особенности',
      '모든 특징', 'Alle kenmerken',
      'Fitur apa pun', 'Alla egenskaper',
      'Alle funksjoner'
    ]],
    ['Clear All', [
      '清除全部', 'Borrar todo',
      'Alles löschen', 'Tout effacer',
      'すべてクリア', 'Limpar tudo',
      'Cancella tutto', 'Очистить всё',
      '모두 지우기', 'Alles wissen',
      'Hapus semua', 'Rensa allt',
      'Tøm alt'
    ]],
    ['Page settings', [
      '页面设置', 'Configuración de página',
      'Seiteneinstellungen', 'Paramètres de la page',
      'ページ設定', 'Configurações da página',
      'Impostazioni pagina', 'Настройки страницы',
      '페이지 설정', 'Pagina-instellingen',
      'Pengaturan halaman', 'Sidinställningar',
      'Sideinnstillinger'
    ]],
    ['Language', [
      '语言', 'Idioma',
      'Sprache', 'Langue',
      '言語', 'Idioma',
      'Lingua', 'Язык',
      '언어', 'Taal',
      'Bahasa', 'Språk',
      'Språk'
    ]],
    ['Menu', [
      '菜单', 'Menú',
      'Menü', 'Menu',
      'メニュー', 'Menu',
      'Menu', 'Меню',
      '메뉴', 'Menu',
      'Menu', 'Meny',
      'Meny'
    ]],
    ['Account sign-in is unavailable', [
      '账户登录暂不可用', 'El inicio de sesión no está disponible',
      'Die Kontoanmeldung ist nicht verfügbar', 'La connexion au compte est indisponible',
      'アカウントにログインできません', 'O acesso à conta não está disponível',
      'L’accesso all’account non è disponibile', 'Вход в аккаунт недоступен',
      '계정 로그인을 사용할 수 없습니다', 'Inloggen op uw account is niet beschikbaar',
      'Login akun tidak tersedia', 'Kontoinloggning är inte tillgänglig',
      'Kontopålogging er ikke tilgjengelig'
    ]],
    ['Browse dive sites', [
      '浏览潜水点', 'Explorar sitios de buceo',
      'Tauchplätze entdecken', 'Parcourir les sites de plongée',
      'スポットを探す', 'Explorar locais de mergulho',
      'Esplora i siti d’immersione', 'Обзор мест для дайвинга',
      '다이빙 포인트 둘러보기', 'Duiklocaties bekijken',
      'Jelajahi situs selam', 'Utforska dykplatser',
      'Utforsk dykkesteder'
    ]],
    ['Browse regions', [
      '浏览区域', 'Explorar regiones',
      'Regionen entdecken', 'Parcourir les régions',
      '地域を探す', 'Explorar regiões',
      'Esplora le regioni', 'Обзор регионов',
      '지역 둘러보기', 'Regio’s bekijken',
      'Jelajahi wilayah', 'Utforska regioner',
      'Utforsk regioner'
    ]],
    ['Explore DiveAtlas', [
      '探索 DiveAtlas', 'Explorar DiveAtlas',
      'DiveAtlas entdecken', 'Explorer DiveAtlas',
      'DiveAtlas を探索', 'Explore o DiveAtlas',
      'Esplora DiveAtlas', 'Исследуйте DiveAtlas',
      'DiveAtlas 둘러보기', 'DiveAtlas verkennen',
      'Jelajahi DiveAtlas', 'Utforska DiveAtlas',
      'Utforsk DiveAtlas'
    ]],
    ['DiveAtlas home', [
      'DiveAtlas 首页', 'Inicio de DiveAtlas',
      'DiveAtlas-Startseite', 'Accueil DiveAtlas',
      'DiveAtlas ホーム', 'Início do DiveAtlas',
      'Home di DiveAtlas', 'Главная DiveAtlas',
      'DiveAtlas 홈', 'Startpagina van DiveAtlas',
      'Beranda DiveAtlas', 'DiveAtlas startsida',
      'DiveAtlas-hjem'
    ]],
    ['Copy link for Instagram', [
      '复制链接以分享到 Instagram', 'Copiar enlace para Instagram',
      'Link für Instagram kopieren', 'Copier le lien pour Instagram',
      'Instagram 用にリンクをコピー', 'Copiar link para o Instagram',
      'Copia il link per Instagram', 'Скопировать ссылку для Instagram',
      'Instagram용 링크 복사', 'Link kopiëren voor Instagram',
      'Salin tautan untuk Instagram', 'Kopiera länk för Instagram',
      'Kopier lenke for Instagram'
    ]],
    ['Share on Facebook', [
      '分享到 Facebook', 'Compartir en Facebook',
      'Auf Facebook teilen', 'Partager sur Facebook',
      'Facebook で共有', 'Compartilhar no Facebook',
      'Condividi su Facebook', 'Поделиться в Facebook',
      'Facebook에서 공유', 'Delen op Facebook',
      'Bagikan di Facebook', 'Dela på Facebook',
      'Del på Facebook'
    ]],
    ['Share on WhatsApp', [
      '分享到 WhatsApp', 'Compartir en WhatsApp',
      'Auf WhatsApp teilen', 'Partager sur WhatsApp',
      'WhatsApp で共有', 'Compartilhar no WhatsApp',
      'Condividi su WhatsApp', 'Поделиться в WhatsApp',
      'WhatsApp에서 공유', 'Delen op WhatsApp',
      'Bagikan di WhatsApp', 'Dela på WhatsApp',
      'Del på WhatsApp'
    ]],
    ['Share on X', [
      '分享到 X', 'Compartir en X',
      'Auf X teilen', 'Partager sur X',
      'X で共有', 'Compartilhar no X',
      'Condividi su X', 'Поделиться в X',
      'X에서 공유', 'Delen op X',
      'Bagikan di X', 'Dela på X',
      'Del på X'
    ]],
    ['Share on Reddit', [
      '分享到 Reddit', 'Compartir en Reddit',
      'Auf Reddit teilen', 'Partager sur Reddit',
      'Reddit で共有', 'Compartilhar no Reddit',
      'Condividi su Reddit', 'Поделиться в Reddit',
      'Reddit에서 공유', 'Delen op Reddit',
      'Bagikan di Reddit', 'Dela på Reddit',
      'Del på Reddit'
    ]],
    ['About', [
      '关于', 'Acerca de',
      'Über', 'À propos',
      '概要', 'Sobre',
      'Informazioni', 'О проекте',
      '소개', 'Over',
      'Tentang', 'Om',
      'Om'
    ]],
    ['Contact', [
      '联系', 'Contacto',
      'Kontakt', 'Contact',
      'お問い合わせ', 'Contato',
      'Contatti', 'Контакты',
      '문의', 'Contact',
      'Kontak', 'Kontakt',
      'Kontakt'
    ]],
    ['Toggle page theme', [
      '切换页面主题', 'Cambiar tema de página',
      'Seitendesign wechseln', 'Changer le thème de la page',
      'ページテーマを切り替え', 'Alternar tema da página',
      'Cambia tema della pagina', 'Переключить тему страницы',
      '페이지 테마 전환', 'Paginathema wijzigen',
      'Ubah tema halaman', 'Byt sidtema',
      'Bytt sidetema'
    ]],
    ['Copy link', [
      '复制链接', 'Copiar enlace',
      'Link kopieren', 'Copier le lien',
      'リンクをコピー', 'Copiar link',
      'Copia link', 'Скопировать ссылку',
      '링크 복사', 'Link kopiëren',
      'Salin tautan', 'Kopiera länk',
      'Kopier lenke'
    ]],
    ['More options', [
      '更多选项', 'Más opciones',
      'Weitere Optionen', 'Plus d’options',
      'その他のオプション', 'Mais opções',
      'Altre opzioni', 'Другие варианты',
      '더 많은 옵션', 'Meer opties',
      'Opsi lainnya', 'Fler alternativ',
      'Flere alternativer'
    ]],
    ['Close', [
      '关闭', 'Cerrar',
      'Schließen', 'Fermer',
      '閉じる', 'Fechar',
      'Chiudi', 'Закрыть',
      '닫기', 'Sluiten',
      'Tutup', 'Stäng',
      'Lukk'
    ]],
    ['Contact DiveAtlas', [
      '联系 DiveAtlas', 'Contactar con DiveAtlas',
      'DiveAtlas kontaktieren', 'Contacter DiveAtlas',
      'DiveAtlas に問い合わせる', 'Fale com o DiveAtlas',
      'Contatta DiveAtlas', 'Связаться с DiveAtlas',
      'DiveAtlas에 문의', 'Contact opnemen met DiveAtlas',
      'Hubungi DiveAtlas', 'Kontakta DiveAtlas',
      'Kontakt DiveAtlas'
    ]],
    ['Send a message to the DiveAtlas maintainer.', [
      '给 DiveAtlas 维护者发送消息。', 'Envía un mensaje al equipo de DiveAtlas.',
      'Senden Sie eine Nachricht an das DiveAtlas-Team.', 'Envoyez un message à l’équipe DiveAtlas.',
      'DiveAtlas の管理者にメッセージを送信します。', 'Envie uma mensagem à equipe do DiveAtlas.',
      'Invia un messaggio al team di DiveAtlas.', 'Отправьте сообщение команде DiveAtlas.',
      'DiveAtlas 관리자에게 메시지를 보냅니다.', 'Stuur een bericht naar de beheerder van DiveAtlas.',
      'Kirim pesan kepada pengelola DiveAtlas.', 'Skicka ett meddelande till DiveAtlas ansvariga.',
      'Send en melding til den som vedlikeholder DiveAtlas.'
    ]],
    ['Name', [
      '姓名', 'Nombre',
      'Name', 'Nom',
      '名前', 'Nome',
      'Nome', 'Имя',
      '이름', 'Naam',
      'Nama', 'Namn',
      'Navn'
    ]],
    ['(optional)', [
      '（选填）', '(opcional)',
      '(optional)', '(facultatif)',
      '（任意）', '(opcional)',
      '(facoltativo)', '(необязательно)',
      '(선택 사항)', '(optioneel)',
      '(opsional)', '(valfritt)',
      '(valgfritt)'
    ]],
    ['Email', [
      '电子邮箱', 'Correo electrónico',
      'E-Mail', 'E-mail',
      'メールアドレス', 'E-mail',
      'Email', 'Электронная почта',
      '이메일', 'E-mail',
      'Email', 'E-post',
      'E-post'
    ]],
    ['Subject', [
      '主题', 'Asunto',
      'Betreff', 'Objet',
      '件名', 'Assunto',
      'Oggetto', 'Тема',
      '제목', 'Onderwerp',
      'Subjek', 'Ämne',
      'Emne'
    ]],
    ['Message', [
      '消息', 'Mensaje',
      'Nachricht', 'Message',
      'メッセージ', 'Mensagem',
      'Messaggio', 'Сообщение',
      '메시지', 'Bericht',
      'Pesan', 'Meddelande',
      'Melding'
    ]],
    ['Website', [
      '网站', 'Sitio web',
      'Website', 'Site web',
      'ウェブサイト', 'Site',
      'Sito web', 'Сайт',
      '웹사이트', 'Website',
      'Situs web', 'Webbplats',
      'Nettsted'
    ]],
    ['Cancel', [
      '取消', 'Cancelar',
      'Abbrechen', 'Annuler',
      'キャンセル', 'Cancelar',
      'Annulla', 'Отмена',
      '취소', 'Annuleren',
      'Batal', 'Avbryt',
      'Avbryt'
    ]],
    ['Send message', [
      '发送消息', 'Enviar mensaje',
      'Nachricht senden', 'Envoyer le message',
      'メッセージを送信', 'Enviar mensagem',
      'Invia messaggio', 'Отправить сообщение',
      '메시지 보내기', 'Bericht verzenden',
      'Kirim pesan', 'Skicka meddelande',
      'Send melding'
    ]],
    ['Enter a valid email address.', [
      '请输入有效的电子邮箱地址。', 'Introduce una dirección de correo válida.',
      'Geben Sie eine gültige E-Mail-Adresse ein.', 'Saisissez une adresse e-mail valide.',
      '有効なメールアドレスを入力してください。', 'Insira um endereço de e-mail válido.',
      'Inserisci un indirizzo email valido.', 'Введите действительный адрес электронной почты.',
      '올바른 이메일 주소를 입력하세요.', 'Voer een geldig e-mailadres in.',
      'Masukkan alamat email yang valid.', 'Ange en giltig e-postadress.',
      'Skriv inn en gyldig e-postadresse.'
    ]],
    ['Enter a message.', [
      '请输入消息。', 'Escribe un mensaje.',
      'Geben Sie eine Nachricht ein.', 'Saisissez un message.',
      'メッセージを入力してください。', 'Digite uma mensagem.',
      'Inserisci un messaggio.', 'Введите сообщение.',
      '메시지를 입력하세요.', 'Voer een bericht in.',
      'Masukkan pesan.', 'Skriv ett meddelande.',
      'Skriv inn en melding.'
    ]],
    ['Complete the verification challenge before sending.', [
      '发送前请完成验证。', 'Completa la verificación antes de enviar.',
      'Schließen Sie vor dem Senden die Bestätigung ab.', 'Terminez la vérification avant l’envoi.',
      '送信する前に認証を完了してください。', 'Conclua a verificação antes de enviar.',
      'Completa la verifica prima di inviare.', 'Пройдите проверку перед отправкой.',
      '보내기 전에 인증을 완료하세요.', 'Voltooi de verificatie voordat u verzendt.',
      'Selesaikan verifikasi sebelum mengirim.', 'Slutför verifieringen innan du skickar.',
      'Fullfør bekreftelsen før du sender.'
    ]],
    ['Sending…', [
      '正在发送…', 'Enviando…',
      'Wird gesendet…', 'Envoi…',
      '送信中…', 'Enviando…',
      'Invio…', 'Отправка…',
      '전송 중…', 'Verzenden…',
      'Mengirim…', 'Skickar…',
      'Sender…'
    ]],
    ['Message sent. Thank you.', [
      '消息已发送。谢谢。', 'Mensaje enviado. Gracias.',
      'Nachricht gesendet. Vielen Dank.', 'Message envoyé. Merci.',
      'メッセージを送信しました。ありがとうございます。', 'Mensagem enviada. Obrigado.',
      'Messaggio inviato. Grazie.', 'Сообщение отправлено. Спасибо.',
      '메시지를 보냈습니다. 감사합니다.', 'Bericht verzonden. Bedankt.',
      'Pesan terkirim. Terima kasih.', 'Meddelandet har skickats. Tack.',
      'Meldingen er sendt. Takk.'
    ]],
    ['Message could not be sent. Please try again.', [
      '无法发送消息，请重试。', 'No se pudo enviar el mensaje. Inténtalo de nuevo.',
      'Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es erneut.', 'Le message n’a pas pu être envoyé. Veuillez réessayer.',
      'メッセージを送信できませんでした。もう一度お試しください。', 'Não foi possível enviar a mensagem. Tente novamente.',
      'Impossibile inviare il messaggio. Riprova.', 'Не удалось отправить сообщение. Попробуйте ещё раз.',
      '메시지를 보내지 못했습니다. 다시 시도하세요.', 'Bericht kon niet worden verzonden. Probeer het opnieuw.',
      'Pesan tidak dapat dikirim. Silakan coba lagi.', 'Det gick inte att skicka meddelandet. Försök igen.',
      'Meldingen kunne ikke sendes. Prøv igjen.'
    ]],
    ['Verification could not be loaded. Please try again later.', [
      '无法加载验证，请稍后重试。', 'No se pudo cargar la verificación. Inténtalo más tarde.',
      'Bestätigung konnte nicht geladen werden. Bitte versuchen Sie es später erneut.', 'La vérification n’a pas pu être chargée. Veuillez réessayer plus tard.',
      '認証を読み込めませんでした。後でもう一度お試しください。', 'Não foi possível carregar a verificação. Tente novamente mais tarde.',
      'Impossibile caricare la verifica. Riprova più tardi.', 'Не удалось загрузить проверку. Повторите попытку позже.',
      '인증을 불러오지 못했습니다. 나중에 다시 시도하세요.', 'Verificatie kon niet worden geladen. Probeer het later opnieuw.',
      'Verifikasi tidak dapat dimuat. Coba lagi nanti.', 'Verifieringen kunde inte läsas in. Försök igen senare.',
      'Bekreftelsen kunne ikke lastes inn. Prøv igjen senere.'
    ]],
    ['DiveAtlas is an interactive map for exploring dive sites and regions alongside reef extent, coral and fish records, bathymetry, and ocean conditions.', [
      'DiveAtlas 是一张交互式地图，可探索潜水点和区域，并查看珊瑚礁范围、珊瑚与鱼类记录、海底地形和海洋状况。', 'DiveAtlas es un mapa interactivo para explorar sitios y regiones de buceo junto con arrecifes, registros de corales y peces, batimetría y condiciones oceánicas.',
      'DiveAtlas ist eine interaktive Karte zum Erkunden von Tauchplätzen und Regionen sowie Riffgebieten, Korallen- und Fischdaten, Bathymetrie und Meeresbedingungen.', 'DiveAtlas est une carte interactive pour explorer les sites et régions de plongée, les récifs, les données sur les coraux et les poissons, la bathymétrie et les conditions océaniques.',
      'DiveAtlas は、ダイビングスポットや地域に加えて、サンゴ礁の範囲、サンゴ・魚類の記録、水深地形、海洋状況を探索できるインタラクティブマップです。', 'DiveAtlas é um mapa interativo para explorar locais e regiões de mergulho, recifes, registros de corais e peixes, batimetria e condições oceânicas.',
      'DiveAtlas è una mappa interattiva per esplorare siti e regioni d’immersione, barriere coralline, dati su coralli e pesci, batimetria e condizioni oceaniche.', 'DiveAtlas — интерактивная карта для изучения мест и регионов для дайвинга, рифов, данных о кораллах и рыбах, батиметрии и состояния океана.',
      'DiveAtlas는 다이빙 포인트와 지역을 탐색하고 산호초 범위, 산호와 어류 기록, 해저 지형, 해양 상태를 확인할 수 있는 대화형 지도입니다.', 'DiveAtlas is een interactieve kaart om duiklocaties en regio’s te verkennen, naast riffen, koraal- en visgegevens, bathymetrie en oceaanomstandigheden.',
      'DiveAtlas adalah peta interaktif untuk menjelajahi situs dan wilayah selam, terumbu karang, catatan karang dan ikan, batimetri, serta kondisi laut.', 'DiveAtlas är en interaktiv karta för att utforska dykplatser och regioner samt rev, korall- och fiskobservationer, batymetri och havsförhållanden.',
      'DiveAtlas er et interaktivt kart for å utforske dykkesteder og regioner, rev, korall- og fiskeregistreringer, batymetri og havsforhold.'
    ]],
    ['Suggest a missing Dive site', [
      '建议添加缺失的潜水点', 'Sugerir un sitio de buceo',
      'Fehlenden Tauchplatz vorschlagen', 'Suggérer un site de plongée manquant',
      '潜水スポットの追加を提案', 'Sugerir um local de mergulho',
      'Suggerisci un sito d’immersione mancante', 'Предложить добавить место для дайвинга',
      '누락된 다이빙 포인트 제안', 'Een ontbrekende duiklocatie voorstellen',
      'Sarankan situs selam yang belum ada', 'Föreslå en saknad dykplats',
      'Foreslå et manglende dykkested'
    ]],
    ['Clear selection', [
      '清除所选项', 'Borrar selección',
      'Auswahl löschen', 'Effacer la sélection',
      '選択をクリア', 'Limpar seleção',
      'Cancella selezione', 'Сбросить выбор',
      '선택 지우기', 'Selectie wissen',
      'Hapus pilihan', 'Rensa val',
      'Tøm valget'
    ]],
    ['No matching options', [
      '没有匹配项', 'No hay opciones coincidentes',
      'Keine passenden Optionen', 'Aucune option correspondante',
      '一致する項目はありません', 'Nenhuma opção correspondente',
      'Nessuna opzione corrispondente', 'Подходящих вариантов нет',
      '일치하는 옵션이 없습니다', 'Geen overeenkomende opties',
      'Tidak ada opsi yang cocok', 'Inga matchande alternativ',
      'Ingen treffende alternativer'
    ]],
    ["Clarity", ["能见度", "Visibilidad", "Sichtweite", "Visibilité", "透明度", "Visibilidade", "Visibilità", "Видимость", "시야", "Zicht", "Jarak pandang", "Sikt", "Sikt"]],
    ["Temp", ["水温", "Temp", "Temp", "Temp", "水温", "Temp", "Temp", "Темп.", "수온", "Temp", "Suhu", "Temp", "Temp"]],
    ["Current", ["流速", "Corriente", "Strömung", "Courant", "流速", "Corrente", "Corrente", "Течение", "조류", "Stroming", "Arus", "Ström", "Strøm"]],
    ["Waves", ["浪高", "Olas", "Wellen", "Vagues", "波高", "Ondas", "Onde", "Волны", "파도", "Golven", "Gelombang", "Vågor", "Bølger"]],
    ["Score", ["评分", "Puntuación", "Bewertung", "Score", "スコア", "Pontuação", "Punteggio", "Оценка", "점수", "Score", "Skor", "Poäng", "Poeng"]],
    ["Best overall window", ["最佳综合时段", "Mejor periodo general", "Bester Gesamtzeitraum", "Meilleure période globale", "総合的に最適な時期", "Melhor período geral", "Periodo migliore in generale", "Лучший общий период", "종합 최적 시기", "Beste algemene periode", "Periode terbaik keseluruhan", "Bästa perioden totalt", "Beste periode samlet"]],
    ["All year", ["全年", "Todo el año", "Ganzjährig", "Toute l’année", "通年", "O ano todo", "Tutto l’anno", "Круглый год", "연중", "Het hele jaar", "Sepanjang tahun", "Hela året", "Hele året"]],
    ["Historical estimates", ["历史估算", "Estimaciones históricas", "Historische Schätzungen", "Estimations historiques", "過去の推定値", "Estimativas históricas", "Stime storiche", "Исторические оценки", "과거 추정치", "Historische schattingen", "Estimasi historis", "Historiska uppskattningar", "Historiske estimater"]],
    ["Highest monthly score", ["最高月度评分", "Puntuación mensual más alta", "Höchste Monatsbewertung", "Meilleur score mensuel", "月別最高スコア", "Maior pontuação mensal", "Punteggio mensile più alto", "Наивысшая месячная оценка", "월간 최고 점수", "Hoogste maandscore", "Skor bulanan tertinggi", "Högsta månadspoäng", "Høyeste månedspoeng"]],
    ['When to dive', [
      '何时潜水', 'Cuándo bucear',
      'Wann tauchen', 'Quand plonger',
      'ダイビングに適した時期', 'Quando mergulhar',
      'Quando immergersi', 'Когда нырять',
      '다이빙 시기', 'Wanneer duiken',
      'Kapan menyelam', 'När ska man dyka',
      'Når bør man dykke'
    ]],
    ['Loading monthly estimates…', [
      '正在加载月度估算…', 'Cargando estimaciones mensuales…',
      'Monatliche Schätzungen werden geladen…', 'Chargement des estimations mensuelles…',
      '月別推定値を読み込み中…', 'Carregando estimativas mensais…',
      'Caricamento delle stime mensili…', 'Загрузка оценок по месяцам…',
      '월별 추정치를 불러오는 중…', 'Maandelijkse schattingen laden…',
      'Memuat perkiraan bulanan…', 'Läser in månadsuppskattningar…',
      'Laster inn månedlige estimater…'
    ]],
    ['Chart legend', [
      '图表图例', 'Leyenda del gráfico',
      'Diagrammlegende', 'Légende du graphique',
      'グラフの凡例', 'Legenda do gráfico',
      'Legenda del grafico', 'Легенда диаграммы',
      '차트 범례', 'Grafieklegenda',
      'Legenda grafik', 'Diagramförklaring',
      'Diagramforklaring'
    ]],
    ['Monthly estimates are not available for this location.', [
      '此位置暂无月度估算数据。', 'No hay estimaciones mensuales disponibles para este lugar.',
      'Für diesen Ort sind keine monatlichen Schätzungen verfügbar.', 'Aucune estimation mensuelle n’est disponible pour cet endroit.',
      'この場所の月別推定データはありません。', 'Não há estimativas mensais disponíveis para este local.',
      'Le stime mensili non sono disponibili per questa località.', 'Для этого места нет ежемесячных оценок.',
      '이 위치의 월별 추정치를 사용할 수 없습니다.', 'Er zijn geen maandelijkse schattingen voor deze locatie.',
      'Perkiraan bulanan tidak tersedia untuk lokasi ini.', 'Månadsuppskattningar saknas för platsen.',
      'Månedlige estimater er ikke tilgjengelige for dette stedet.'
    ]],
    ['Monthly estimates could not be loaded. Please try again later.', [
      '无法加载月度估算，请稍后重试。', 'No se pudieron cargar las estimaciones mensuales. Inténtalo más tarde.',
      'Monatliche Schätzungen konnten nicht geladen werden. Bitte versuchen Sie es später erneut.', 'Impossible de charger les estimations mensuelles. Veuillez réessayer plus tard.',
      '月別推定値を読み込めませんでした。後でもう一度お試しください。', 'Não foi possível carregar as estimativas mensais. Tente novamente mais tarde.',
      'Impossibile caricare le stime mensili. Riprova più tardi.', 'Не удалось загрузить ежемесячные оценки. Повторите попытку позже.',
      '월별 추정치를 불러오지 못했습니다. 나중에 다시 시도하세요.', 'Maandelijkse schattingen konden niet worden geladen. Probeer het later opnieuw.',
      'Perkiraan bulanan tidak dapat dimuat. Coba lagi nanti.', 'Det gick inte att läsa in månadsuppskattningar. Försök igen senare.',
      'Kunne ikke laste inn månedlige estimater. Prøv igjen senere.'
    ]],
    ['Water clarity', [
      '水体能见度', 'Visibilidad del agua',
      'Wassersicht', 'Visibilité de l’eau',
      '水の透明度', 'Visibilidade da água',
      'Visibilità dell’acqua', 'Прозрачность воды',
      '수중 시야', 'Waterzicht',
      'Kejernihan air', 'Siktdjup',
      'Sikt i vannet'
    ]],
    ['Water temperature · 5 m', [
      '水温 · 5 米', 'Temperatura del agua · 5 m',
      'Wassertemperatur · 5 m', 'Température de l’eau · 5 m',
      '水温 · 5 m', 'Temperatura da água · 5 m',
      'Temperatura dell’acqua · 5 m', 'Температура воды · 5 м',
      '수온 · 5 m', 'Watertemperatuur · 5 m',
      'Suhu air · 5 m', 'Vattentemperatur · 5 m',
      'Vanntemperatur · 5 m'
    ]],
    ['Current speed · 10 m', [
      '流速 · 10 米', 'Velocidad de la corriente · 10 m',
      'Strömungsgeschwindigkeit · 10 m', 'Vitesse du courant · 10 m',
      '流速 · 10 m', 'Velocidade da corrente · 10 m',
      'Velocità della corrente · 10 m', 'Скорость течения · 10 м',
      '유속 · 10 m', 'Stroomsnelheid · 10 m',
      'Kecepatan arus · 10 m', 'Strömhastighet · 10 m',
      'Strømhastighet · 10 m'
    ]],
    ['Wave height', [
      '浪高', 'Altura de las olas',
      'Wellenhöhe', 'Hauteur des vagues',
      '波高', 'Altura das ondas',
      'Altezza delle onde', 'Высота волн',
      '파고', 'Golfhoogte',
      'Tinggi gelombang', 'Våghöjd',
      'Bølgehøyde'
    ]],
    ['Overall condition score', [
      '综合条件评分', 'Puntuación general de condiciones',
      'Gesamtbewertung der Bedingungen', 'Score global des conditions',
      '総合コンディションスコア', 'Pontuação geral das condições',
      'Punteggio complessivo delle condizioni', 'Общая оценка условий',
      '종합 상태 점수', 'Totale conditiescore',
      'Skor kondisi keseluruhan', 'Övergripande förhållandepoäng',
      'Samlet forholdsscore'
    ]],
    ['No data', [
      '无数据', 'Sin datos',
      'Keine Daten', 'Aucune donnée',
      'データなし', 'Sem dados',
      'Nessun dato', 'Нет данных',
      '데이터 없음', 'Geen gegevens',
      'Tidak ada data', 'Inga data',
      'Ingen data'
    ]],
    ['Monthly water clarity and water temperature share a vertical scale; current speed and wave height share another. Overall dive-condition score is shown as bars on its own scale. Hover or focus a mark for all values in that month.', [
      '月度水体能见度和水温共用一个纵轴；流速和浪高共用另一个纵轴。综合潜水条件评分以独立刻度的柱形显示。悬停或聚焦图表标记可查看该月的所有数值。', 'La visibilidad y la temperatura comparten una escala; la corriente y el oleaje comparten otra. La puntuación general se muestra en barras con su propia escala. Coloca el cursor o enfoca una marca para ver los valores del mes.',
      'Wassersicht und Wassertemperatur teilen sich eine Achse; Strömung und Wellenhöhe eine weitere. Die Gesamtbewertung wird mit einer eigenen Skala dargestellt. Bewegen Sie den Mauszeiger auf einen Punkt oder fokussieren Sie ihn, um alle Monatswerte zu sehen.', 'La visibilité et la température partagent une échelle ; le courant et la hauteur des vagues en partagent une autre. Le score global utilise sa propre échelle. Survolez ou sélectionnez un point pour afficher toutes les valeurs du mois.',
      '水の透明度と水温は同じ縦軸を、流速と波高は別の縦軸を共有します。総合コンディションスコアは独立した目盛りの棒で表示します。マークにカーソルを合わせるかフォーカスすると、その月の値を確認できます。', 'A visibilidade e a temperatura compartilham uma escala; corrente e ondas compartilham outra. A pontuação geral é exibida em barras com escala própria. Passe o cursor ou foque um marcador para ver todos os valores do mês.',
      'Visibilità e temperatura condividono una scala; corrente e altezza delle onde ne condividono un’altra. Il punteggio complessivo usa una scala propria. Passa il cursore o seleziona un punto per vedere tutti i valori del mese.', 'Прозрачность и температура воды используют одну шкалу; скорость течения и высота волн — другую. Общая оценка показана столбцами со своей шкалой. Наведите курсор или выберите точку, чтобы увидеть значения за месяц.',
      '수중 시야와 수온은 하나의 세로축을 공유하고, 유속과 파고는 다른 축을 공유합니다. 종합 다이빙 상태 점수는 별도 축의 막대로 표시됩니다. 마크에 마우스를 올리거나 포커스를 맞추면 해당 월의 모든 값을 볼 수 있습니다.', 'Waterzicht en watertemperatuur delen één schaal; stroomsnelheid en golfhoogte delen een andere. De totale conditiescore heeft een eigen schaal. Beweeg de muis over een markering of focus erop voor alle maandwaarden.',
      'Kejernihan dan suhu air berbagi satu skala vertikal; kecepatan arus dan tinggi gelombang berbagi skala lain. Skor kondisi keseluruhan ditampilkan dengan batang pada skalanya sendiri. Arahkan atau fokuskan penanda untuk melihat semua nilai bulan tersebut.', 'Siktdjup och vattentemperatur delar en vertikal skala; strömhastighet och våghöjd delar en annan. Den övergripande poängen visas som staplar med egen skala. Håll pekaren över eller fokusera en markering för att se månadens värden.',
      'Sikt og vanntemperatur deler en vertikal skala; strømhastighet og bølgehøyde deler en annen. Samlet dykkeforhold vises som stolper på egen skala. Hold pekeren over eller fokuser på et punkt for å se alle verdiene for måneden.'
    ]],
    ['Rating unavailable', [
      '评分暂不可用', 'Valoración no disponible',
      'Bewertung nicht verfügbar', 'Note indisponible',
      '評価を利用できません', 'Avaliação indisponível',
      'Valutazione non disponibile', 'Оценка недоступна',
      '평점을 사용할 수 없습니다', 'Beoordeling niet beschikbaar',
      'Penilaian tidak tersedia', 'Betyg saknas',
      'Vurdering utilgjengelig'
    ]],
    ['Current month rating is unavailable.', [
      '本月评分暂不可用。', 'La valoración de este mes no está disponible.',
      'Die Bewertung für diesen Monat ist nicht verfügbar.', 'La note de ce mois n’est pas disponible.',
      '今月の評価は利用できません。', 'A avaliação deste mês está indisponível.',
      'La valutazione del mese corrente non è disponibile.', 'Оценка за текущий месяц недоступна.',
      '이번 달 평점을 사용할 수 없습니다.', 'De beoordeling van deze maand is niet beschikbaar.',
      'Penilaian bulan ini tidak tersedia.', 'Månadens betyg saknas.',
      'Vurderingen for denne måneden er utilgjengelig.'
    ]],
    ['Comparing current ratings across all dive sites…', [
      '正在比较所有潜水点的当前评分…', 'Comparando las valoraciones actuales de todos los sitios…',
      'Aktuelle Bewertungen aller Tauchplätze werden verglichen…', 'Comparaison des notes actuelles de tous les sites…',
      'すべてのスポットの現在の評価を比較中…', 'Comparando as avaliações atuais de todos os locais…',
      'Confronto delle valutazioni attuali di tutti i siti…', 'Сравнение текущих оценок всех мест для дайвинга…',
      '모든 다이빙 포인트의 현재 평점을 비교하는 중…', 'Huidige beoordelingen van alle duiklocaties vergelijken…',
      'Membandingkan penilaian saat ini di semua situs selam…', 'Jämför aktuella betyg för alla dykplatser…',
      'Sammenligner gjeldende vurderinger for alle dykkesteder…'
    ]],
    ['No sites within 5 points in the full dive-site catalog.', [
      '完整目录中没有评分相差 5 分以内的潜水点。', 'No hay sitios a menos de 5 puntos en el catálogo completo.',
      'Im vollständigen Katalog gibt es keine Tauchplätze innerhalb von 5 Punkten.', 'Aucun site à moins de 5 points dans le catalogue complet.',
      '全カタログに評価差が 5 点以内のスポットはありません。', 'Não há locais com diferença de até 5 pontos no catálogo completo.',
      'Nessun sito entro 5 punti nel catalogo completo.', 'В полном каталоге нет мест с разницей в оценке до 5 баллов.',
      '전체 카탈로그에 점수 차이가 5점 이내인 포인트가 없습니다.', 'Geen locaties binnen 5 punten in de volledige catalogus.',
      'Tidak ada situs dengan selisih 5 poin dalam katalog lengkap.', 'Inga platser inom 5 poäng i hela katalogen.',
      'Ingen steder innenfor 5 poeng i hele katalogen.'
    ]],
    ['Similar ratings are unavailable right now.', [
      '暂时无法比较相似评分。', 'Las valoraciones similares no están disponibles ahora.',
      'Ähnliche Bewertungen sind derzeit nicht verfügbar.', 'Les notes similaires sont actuellement indisponibles.',
      '現在、類似する評価を利用できません。', 'Avaliações semelhantes estão indisponíveis no momento.',
      'Le valutazioni simili non sono disponibili al momento.', 'Похожие оценки сейчас недоступны.',
      '현재 비슷한 평점을 사용할 수 없습니다.', 'Vergelijkbare beoordelingen zijn momenteel niet beschikbaar.',
      'Penilaian serupa saat ini tidak tersedia.', 'Liknande betyg är inte tillgängliga just nu.',
      'Lignende vurderinger er ikke tilgjengelige akkurat nå.'
    ]],
    ['No score available', [
      '暂无评分', 'Sin puntuación',
      'Keine Bewertung verfügbar', 'Aucun score disponible',
      'スコアなし', 'Sem pontuação',
      'Nessun punteggio disponibile', 'Нет оценки',
      '점수 없음', 'Geen score beschikbaar',
      'Skor tidak tersedia', 'Poäng saknas',
      'Ingen poengsum tilgjengelig'
    ]],
    ['Not ideal', [
      '不太理想', 'Poco recomendable',
      'Nicht ideal', 'Peu favorable',
      'あまり良くない', 'Pouco ideal',
      'Non ideale', 'Неидеально',
      '좋지 않음', 'Niet ideaal',
      'Kurang ideal', 'Inte optimalt',
      'Ikke ideelt'
    ]],
    ['Okay', [
      '尚可', 'Aceptable',
      'In Ordnung', 'Correct',
      'まずまず', 'Razoável',
      'Discreto', 'Нормально',
      '보통', 'Redelijk',
      'Cukup', 'Okej',
      'Greit'
    ]],
    ['Great', [
      '很好', 'Excelente',
      'Sehr gut', 'Excellent',
      'とても良い', 'Ótimo',
      'Ottimo', 'Отлично',
      '매우 좋음', 'Uitstekend',
      'Sangat baik', 'Utmärkt',
      'Flott'
    ]],
    ['Good', [
      '良好', 'Bueno',
      'Gut', 'Bien',
      '良い', 'Bom',
      'Buono', 'Хорошо',
      '좋음', 'Goed',
      'Baik', 'Bra',
      'Bra'
    ]],
    ['Rated', [
      '已评分', 'Calificado',
      'Bewertet', 'Noté',
      '評価済み', 'Avaliado',
      'Valutato', 'Оценено',
      '평가됨', 'Beoordeeld',
      'Dinilai', 'Betygsatt',
      'Vurdert'
    ]],
    ['Monthly DiveAtlas rating scores from January to December', [
      'DiveAtlas 一月至十二月的月度评分', 'Puntuaciones mensuales de DiveAtlas de enero a diciembre',
      'Monatliche DiveAtlas-Bewertungen von Januar bis Dezember', 'Notes mensuelles DiveAtlas de janvier à décembre',
      '1 月から 12 月までの DiveAtlas 月別評価', 'Pontuações mensais do DiveAtlas de janeiro a dezembro',
      'Valutazioni mensili DiveAtlas da gennaio a dicembre', 'Ежемесячные оценки DiveAtlas с января по декабрь',
      '1월부터 12월까지의 DiveAtlas 월별 평점', 'Maandelijkse DiveAtlas-scores van januari tot december',
      'Skor bulanan DiveAtlas dari Januari hingga Desember', 'Månadsbetyg från DiveAtlas från januari till december',
      'Månedlige DiveAtlas-vurderinger fra januar til desember'
    ]],
    ['Monthly DiveAtlas rating scores. Focus a point to read its month and score.', [
      'DiveAtlas 月度评分。聚焦数据点可查看月份和评分。', 'Puntuaciones mensuales de DiveAtlas. Enfoca un punto para consultar el mes y la puntuación.',
      'Monatliche DiveAtlas-Bewertungen. Fokussieren Sie einen Punkt, um Monat und Bewertung anzuzeigen.', 'Notes mensuelles DiveAtlas. Placez le focus sur un point pour lire le mois et la note.',
      'DiveAtlas の月別評価です。点にフォーカスすると月とスコアを確認できます。', 'Pontuações mensais do DiveAtlas. Foque um ponto para ver o mês e a pontuação.',
      'Valutazioni mensili DiveAtlas. Metti a fuoco un punto per leggere mese e punteggio.', 'Ежемесячные оценки DiveAtlas. Выберите точку, чтобы увидеть месяц и балл.',
      'DiveAtlas 월별 평점입니다. 점에 포커스를 맞추면 월과 점수를 확인할 수 있습니다.', 'Maandelijkse DiveAtlas-scores. Focus op een punt om maand en score te lezen.',
      'Skor bulanan DiveAtlas. Fokuskan titik untuk melihat bulan dan skor.', 'Månatliga DiveAtlas-betyg. Fokusera på en punkt för att läsa månad och poäng.',
      'Månedlige DiveAtlas-vurderinger. Fokuser på et punkt for å lese måned og poengsum.'
    ]],
    ['Monthly DiveAtlas rating scores are unavailable.', [
      'DiveAtlas 月度评分暂不可用。', 'Las puntuaciones mensuales de DiveAtlas no están disponibles.',
      'Monatliche DiveAtlas-Bewertungen sind nicht verfügbar.', 'Les notes mensuelles DiveAtlas sont indisponibles.',
      'DiveAtlas の月別評価は利用できません。', 'As pontuações mensais do DiveAtlas estão indisponíveis.',
      'Le valutazioni mensili DiveAtlas non sono disponibili.', 'Ежемесячные оценки DiveAtlas недоступны.',
      'DiveAtlas 월별 평점을 사용할 수 없습니다.', 'Maandelijkse DiveAtlas-scores zijn niet beschikbaar.',
      'Skor bulanan DiveAtlas tidak tersedia.', 'Månatliga DiveAtlas-betyg saknas.',
      'Månedlige DiveAtlas-vurderinger er utilgjengelige.'
    ]],
    ['Monthly scores are unavailable.', [
      '月度评分暂不可用。', 'Las puntuaciones mensuales no están disponibles.',
      'Monatliche Bewertungen sind nicht verfügbar.', 'Les scores mensuels sont indisponibles.',
      '月別スコアを利用できません。', 'As pontuações mensais estão indisponíveis.',
      'I punteggi mensili non sono disponibili.', 'Ежемесячные оценки недоступны.',
      '월별 점수를 사용할 수 없습니다.', 'Maandelijkse scores zijn niet beschikbaar.',
      'Skor bulanan tidak tersedia.', 'Månadsbetyg saknas.',
      'Månedlige vurderinger er utilgjengelige.'
    ]],
    ['Link copied.', [
      '链接已复制。', 'Enlace copiado.',
      'Link kopiert.', 'Lien copié.',
      'リンクをコピーしました。', 'Link copiado.',
      'Link copiato.', 'Ссылка скопирована.',
      '링크를 복사했습니다.', 'Link gekopieerd.',
      'Tautan disalin.', 'Länken har kopierats.',
      'Lenken er kopiert.'
    ]],
    ['Could not copy link.', [
      '无法复制链接。', 'No se pudo copiar el enlace.',
      'Link konnte nicht kopiert werden.', 'Impossible de copier le lien.',
      'リンクをコピーできませんでした。', 'Não foi possível copiar o link.',
      'Impossibile copiare il link.', 'Не удалось скопировать ссылку.',
      '링크를 복사하지 못했습니다.', 'Link kon niet worden gekopieerd.',
      'Tautan tidak dapat disalin.', 'Det gick inte att kopiera länken.',
      'Kunne ikke kopiere lenken.'
    ]],
  ];

  const translations = new Map(rows.map(([source, values]) => [source,
    Object.fromEntries(languages.map((language, index) => [language, values[index]]))]));
  const reverseTranslations = new Map(languages.map(language => [language, new Map()]));
  for (const [source, values] of translations) {
    for (const [language, translated] of Object.entries(values)) {
      if (!reverseTranslations.get(language).has(translated)) reverseTranslations.get(language).set(translated, source);
    }
  }

  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const translatedAttributes = ['aria-label', 'title', 'placeholder'];
  const textIgnoreSelector = '[data-i18n-ignore], [data-seo-site-name], [data-seo-summary], .location-hierarchy, .site-recommendations__name, .site-recommendations__location, .source-list a, .site-photo figcaption';
  let currentLanguage = 'en';

  try {
    const saved = localStorage.getItem('global-coral-map-lang');
    if (saved === 'zh-TW' || languages.includes(saved)) currentLanguage = saved;
  } catch (_) {}
  document.documentElement.lang = currentLanguage;

  function languageKey(language) {
    return language === 'zh-TW' ? 'zh' : languages.includes(language) ? language : 'en';
  }

  function sourceText(value, language = currentLanguage) {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const source = reverseTranslations.get(languageKey(language))?.get(trimmed);
    if (!source) return value;
    const start = value.indexOf(trimmed);
    return `${value.slice(0, start)}${source}${value.slice(start + trimmed.length)}`;
  }

  function translate(value, language = currentLanguage) {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const key = languageKey(language);
    const direct = translations.get(trimmed)?.[key];
    const translated = direct || translations.get(trimmed.toLocaleLowerCase())?.[key];
    if (!translated) {
      if (!trimmed.includes(' · ')) return value;
      const parts = trimmed.split(' · ');
      const localizedParts = parts.map(part => translate(part, language));
      if (localizedParts.every((part, index) => part === parts[index])) return value;
      const start = value.indexOf(trimmed);
      return `${value.slice(0, start)}${localizedParts.join(' · ')}${value.slice(start + trimmed.length)}`;
    }
    const startsUppercase = trimmed[0] !== trimmed[0].toLocaleLowerCase();
    const finalText = !direct && startsUppercase
      ? `${translated[0].toLocaleUpperCase()}${translated.slice(1)}`
      : translated;
    const start = value.indexOf(trimmed);
    return `${value.slice(0, start)}${finalText}${value.slice(start + trimmed.length)}`;
  }

  function visitText(node) {
    if (node.parentElement?.closest(textIgnoreSelector)) return;
    if (!textSources.has(node)) textSources.set(node, sourceText(node.data));
    const next = translate(textSources.get(node));
    if (node.data !== next) node.data = next;
  }

  function visitAttributes(element) {
    if (element.closest?.('[data-i18n-ignore]')) return;
    for (const name of translatedAttributes) {
      if (!element.hasAttribute(name)) continue;
      let sources = attributeSources.get(element);
      if (!sources) {
        sources = new Map();
        attributeSources.set(element, sources);
      }
      if (!sources.has(name)) sources.set(name, sourceText(element.getAttribute(name)));
      const next = translate(sources.get(name));
      if (element.getAttribute(name) !== next) element.setAttribute(name, next);
    }
  }

  function visit(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      visitText(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) visitAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) visitText(walker.currentNode);
    root.querySelectorAll?.('*').forEach(visitAttributes);
  }

  function updatePageTitle() {
    if (!document.body.classList.contains('shared-site-detail-layout')) return;
    const siteName = document.querySelector('[data-seo-site-name]');
    if (siteName) {
      document.title = `${siteName.textContent.trim()} ${translate('Dive Site')} | DiveAtlas`;
      return;
    }
    const heading = document.querySelector('#detailStatus h1');
    if (heading) document.title = `${heading.textContent.trim()} | DiveAtlas`;
  }

  function setLanguage(language) {
    currentLanguage = language || document.documentElement.lang || 'en';
    visit(document);
    updatePageTitle();
  }

  visit(document);
  const observer = new MutationObserver(records => {
    const added = [];
    const changedAttributes = new Set();
    for (const record of records) {
      if (record.type === 'childList') added.push(...record.addedNodes);
      else if (record.type === 'attributes') changedAttributes.add(record.target);
    }
    added.forEach(visit);
    changedAttributes.forEach(element => {
      const sources = attributeSources.get(element);
      if (sources) {
        for (const name of translatedAttributes) {
          if (!element.hasAttribute(name)) { sources.delete(name); continue; }
          const current = element.getAttribute(name);
          if (sources.has(name) && current !== translate(sources.get(name))) {
            sources.set(name, sourceText(current));
          }
        }
      }
      visitAttributes(element);
    });
  });
  observer.observe(document.documentElement, {
    childList:true, subtree:true, attributes:true, attributeFilter:translatedAttributes
  });
  window.addEventListener('diveatlas:language-change', event => setLanguage(event.detail?.language));

  window.DiveAtlasSiteDetailI18n = Object.freeze({ translate, setLanguage });
})();
