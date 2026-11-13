(function (root) {
  'use strict';
  const copy = {
    en:['Areas','Dive sites','Country','Region','Ocean area','No matching areas','Search a country or region','Mapped dive sites'],
    zh:['区域','潜点','国家','地区','海域','没有匹配的区域','搜索国家或地区','已收录潜点'],
    ja:['エリア','ダイブサイト','国','地域','海域','一致するエリアがありません','国や地域を検索','登録ダイブサイト'],
    fr:['Zones','Sites de plongée','Pays','Région','Zone maritime','Aucune zone correspondante','Rechercher un pays ou une région','Sites répertoriés'],
    de:['Gebiete','Tauchplätze','Land','Region','Meeresgebiet','Keine passenden Gebiete','Land oder Region suchen','Erfasste Tauchplätze'],
    es:['Áreas','Puntos de buceo','País','Región','Área marina','No hay áreas coincidentes','Buscar país o región','Puntos registrados'],
    it:['Aree','Siti di immersione','Paese','Regione','Area marina','Nessuna area corrispondente','Cerca paese o regione','Siti registrati'],
    pt:['Áreas','Pontos de mergulho','País','Região','Área oceânica','Nenhuma área encontrada','Pesquisar país ou região','Pontos registrados'],
    ru:['Области','Дайв-сайты','Страна','Регион','Морская область','Области не найдены','Найти страну или регион','Учтённые дайв-сайты'],
    ko:['지역','다이빙 포인트','국가','지역','해역','일치하는 지역 없음','국가 또는 지역 검색','등록된 다이빙 포인트'],
    nl:['Gebieden','Duiklocaties','Land','Regio','Zeegebied','Geen overeenkomende gebieden','Zoek een land of regio','Geregistreerde duiklocaties'],
    sv:['Områden','Dykplatser','Land','Region','Havsområde','Inga matchande områden','Sök land eller region','Registrerade dykplatser'],
    no:['Områder','Dykkesteder','Land','Region','Havområde','Ingen samsvarende områder','Søk etter land eller region','Registrerte dykkesteder'],
    id:['Area','Lokasi selam','Negara','Wilayah','Area laut','Tidak ada area yang cocok','Cari negara atau wilayah','Lokasi selam terdaftar']
  };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  // Search aliases are exact geographic labels, not substring replacements: a
  // homonymous region in another country must not inherit a destination name.
  // https://www.padi.com/zh-hans/diving-in/yin-du-ni-xi-ya/lun-bei/
  // https://www.padi.com/zh-hant/diving-in/si-wang-qun-dao/
  const placeAliases = [
    {"names": ["Cornwall"], "country": "United Kingdom", "aliases": ["康沃尔", "康沃尔郡", "康沃爾", "康沃爾郡", "コーンウォール"]},
    {"names": ["Selangor"], "country": "Malaysia", "aliases": ["雪兰莪州", "雪兰莪", "雪蘭莪"]},
    {"names": ["Seychelles"], "country": "Seychelles", "aliases": ["塞舌尔", "塞席爾", "セーシェル", "セイシェル", "세이셸"]},
    {"names": ["Dominica"], "country": "Dominica", "aliases": ["多米尼克", "ドミニカ国"]},
    {"names": ["Grenada"], "country": "Grenada", "aliases": ["格林纳达", "格瑞那達", "格林納達", "グレナダ", "그레나다"]},
    {"names": ["California"], "country": "United States of America", "aliases": ["加州", "加利福尼亚", "加利福尼亞州", "カリフォルニア州"]},
    {"names": ["Micronesia Yap"], "country": "Federated States of Micronesia", "aliases": ["雅浦", "雅浦岛", "雅浦島", "ヤップ", "ヤップ島", "야프"]},
    {"names": ["Lapu-Lapu"], "country": "Philippines", "aliases": ["拉普拉普", "ラプラプ市", "라푸라푸"]},
    {"names": ["Mie Prefecture"], "country": "Japan", "aliases": ["三重県", "三重縣", "미에현"]},
    {"names": ["Banda Sea"], "country": "Indonesia", "aliases": ["班达海", "班達海", "バンダ海", "반다해"]},
    {"names": ["Aceh"], "country": "Indonesia", "aliases": ["亚齐", "亚齐省", "亞齊", "アチェ"]},
    {"names": ["St Kitts And Nevis"], "country": "Saint Kitts and Nevis", "aliases": ["聖克里斯多福及尼維斯", "세인트키츠 네비스"]},
    {"names": ["Gili Islands | Lombok"], "country": "Indonesia", "aliases": ["龙目岛", "吉利岛", "龍目島", "吉利群島", "ロンボク島", "ギリ諸島", "롬복", "길리 제도"]},
    {"names": ["North Carolina"], "country": "United States of America", "aliases": ["北卡罗来纳州", "ノースカロライナ州", "노스캐롤라이나"]},
    {"names": ["Arizona"], "country": "United States", "aliases": ["亞利桑那州", "アリゾナ州"]},
    {"names": ["Washington"], "country": "United States", "aliases": ["华盛顿州", "華盛頓州", "ワシントン州"]},
    {"names": ["Tonga"], "country": "Tonga", "aliases": ["汤加", "東加", "湯加", "トンガ", "통가"]},
    {"names": ["Central Bohemian"], "country": "Czechia", "aliases": ["Středočeský kraj"]},
    {"names": ["Hawaii Oahu"], "country": "United States", "aliases": ["欧胡岛", "歐胡島", "瓦胡島", "オアフ島", "오아후"]},
    {"names": ["Sumbawa"], "country": "Indonesia", "aliases": ["松巴哇", "松巴哇岛", "松巴哇島", "スンバワ島", "숨바와"]},
    {"names": ["Haute-Savoie"], "country": "France", "aliases": ["オート・サヴォワ県"]},
    {"names": ["Haute-Savoie"], "country": "France", "aliases": ["上薩瓦省"]},
    {"names": ["Haute-Savoie"], "country": "France", "aliases": ["上萨瓦省"]},
    {"names": ["Drenthe"], "country": "Netherlands", "aliases": ["Drente"]},
    {"names": ["Drenthe"], "country": "Netherlands", "aliases": ["ドレンテ州"]},
    {"names": ["Drenthe"], "country": "Netherlands", "aliases": ["德倫特"]},
    {"names": ["Drenthe"], "country": "Netherlands", "aliases": ["德伦特"]},
    {"names": ["Alaska"], "country": "United States of America", "aliases": ["알래스카"]},
    {"names": ["Alaska"], "country": "United States of America", "aliases": ["アラスカ"]},
    {"names": ["Alaska"], "country": "United States of America", "aliases": ["阿拉斯加"]},
    {"names": ["Attica"], "country": "Greece", "aliases": ["아티카"]},
    {"names": ["Attica"], "country": "Greece", "aliases": ["アッティカ"]},
    {"names": ["Attica"], "country": "Greece", "aliases": ["阿提卡"]},
    {"names": ["French Polynesia"], "country": "French Polynesia", "aliases": ["프랑스령 폴리네시아"]},
    {"names": ["French Polynesia"], "country": "French Polynesia", "aliases": ["フランス領ポリネシア"]},
    {"names": ["French Polynesia"], "country": "French Polynesia", "aliases": ["法屬玻里尼西亞"]},
    {"names": ["French Polynesia"], "country": "French Polynesia", "aliases": ["法属波利尼西亚"]},
    {"names": ["French Polynesia"], "country": "France", "aliases": ["프랑스령 폴리네시아"]},
    {"names": ["French Polynesia"], "country": "France", "aliases": ["フランス領ポリネシア"]},
    {"names": ["French Polynesia"], "country": "France", "aliases": ["法屬玻里尼西亞"]},
    {"names": ["French Polynesia"], "country": "France", "aliases": ["法属波利尼西亚"]},
    {"names": ["Fiji"], "country": "Fiji", "aliases": ["피지"]},
    {"names": ["Fiji"], "country": "Fiji", "aliases": ["フィジー"]},
    {"names": ["Fiji"], "country": "Fiji", "aliases": ["斐濟"]},
    {"names": ["Fiji"], "country": "Fiji", "aliases": ["斐济"]},
    {"names": ["Vanuatu"], "country": "Vanuatu", "aliases": ["바누아투"]},
    {"names": ["Vanuatu"], "country": "Vanuatu", "aliases": ["バヌアツ"]},
    {"names": ["Vanuatu"], "country": "Vanuatu", "aliases": ["萬那杜"]},
    {"names": ["Vanuatu"], "country": "Vanuatu", "aliases": ["瓦努阿图"]},
    {"names": ["Siquijor"], "country": "Philippines", "aliases": ["시키호르"]},
    {"names": ["Siquijor"], "country": "Philippines", "aliases": ["シキホール"]},
    {"names": ["Siquijor"], "country": "Philippines", "aliases": ["錫基霍爾"]},
    {"names": ["Siquijor"], "country": "Philippines", "aliases": ["锡基霍尔"]},
    {"names": ["Lima"], "country": "Peru", "aliases": ["リマ"]},
    {"names": ["Lima"], "country": "Peru", "aliases": ["利馬"]},
    {"names": ["Lima"], "country": "Peru", "aliases": ["利马"]},
    {"names": ["Murcia"], "country": "Spain", "aliases": ["무르시아"]},
    {"names": ["Murcia"], "country": "Spain", "aliases": ["ムルシア"]},
    {"names": ["Murcia"], "country": "Spain", "aliases": ["穆爾西亞"]},
    {"names": ["Murcia"], "country": "Spain", "aliases": ["穆尔西亚"]},
    {"names": ["Utah"], "country": "United States", "aliases": ["유타"]},
    {"names": ["Utah"], "country": "United States", "aliases": ["ユタ州"]},
    {"names": ["Utah"], "country": "United States", "aliases": ["猶他州"]},
    {"names": ["Utah"], "country": "United States", "aliases": ["犹他州"]},
    {"names": ["Czech Republic"], "country": "Czechia", "aliases": ["체코 공화국"]},
    {"names": ["Czech Republic"], "country": "Czechia", "aliases": ["チェコ共和国"]},
    {"names": ["Czech Republic"], "country": "Czechia", "aliases": ["捷克共和国"]},
    {"names": ["Czech Republic"], "country": "Czechia", "aliases": ["Česko"]},
    {"names": ["Dominican Republic"], "country": "Dominican Republic", "aliases": ["도미니카 공화국"]},
    {"names": ["Dominican Republic"], "country": "Dominican Republic", "aliases": ["ドミニカ共和国"]},
    {"names": ["Dominican Republic"], "country": "Dominican Republic", "aliases": ["多明尼加"]},
    {"names": ["Dominican Republic"], "country": "Dominican Republic", "aliases": ["多米尼加共和国"]},
    {"names": ["Phuket"], "country": "Thailand", "aliases": ["푸켓"]},
    {"names": ["Phuket"], "country": "Thailand", "aliases": ["プーケット"]},
    {"names": ["Phuket"], "country": "Thailand", "aliases": ["普吉島"]},
    {"names": ["Phuket"], "country": "Thailand", "aliases": ["普吉岛"]},
    {"names": ["Northland"], "country": "New Zealand", "aliases": ["노스랜드"]},
    {"names": ["Northland"], "country": "New Zealand", "aliases": ["ノースランド"]},
    {"names": ["Northland"], "country": "New Zealand", "aliases": ["北地"]},
    {"names": ["Galapagos Islands"], "country": "Ecuador", "aliases": ["갈라파고스"]},
    {"names": ["Galapagos Islands"], "country": "Ecuador", "aliases": ["ガラパゴス諸島"]},
    {"names": ["Galapagos Islands"], "country": "Ecuador", "aliases": ["加拉巴哥群島"]},
    {"names": ["Galapagos Islands"], "country": "Ecuador", "aliases": ["加拉帕戈斯"]},
    {"names": ["Halmahera"], "country": "Indonesia", "aliases": ["할마헤라"]},
    {"names": ["Halmahera"], "country": "Indonesia", "aliases": ["ハルマヘラ"]},
    {"names": ["Halmahera"], "country": "Indonesia", "aliases": ["哈馬黑拉"]},
    {"names": ["Halmahera"], "country": "Indonesia", "aliases": ["哈马黑拉"]},
    {"names": ["St Lucia"], "country": "Saint Lucia", "aliases": ["세인트 루시아"]},
    {"names": ["St Lucia"], "country": "Saint Lucia", "aliases": ["セントルシア"]},
    {"names": ["St Lucia"], "country": "Saint Lucia", "aliases": ["聖露西亞"]},
    {"names": ["St Lucia"], "country": "Saint Lucia", "aliases": ["圣卢西亚"]},
    {"names": ["Palau"], "country": "Palau", "aliases": ["팔라우"]},
    {"names": ["Palau"], "country": "Palau", "aliases": ["パラオ"]},
    {"names": ["Palau"], "country": "Palau", "aliases": ["帛琉"]},
    {"names": ["Palau"], "country": "Palau", "aliases": ["帕劳"]},
    {"names": ["Red Sea | Sudan Red Sea"], "country": "Sudan", "aliases": ["수단 홍해"]},
    {"names": ["Red Sea | Sudan Red Sea"], "country": "Sudan", "aliases": ["蘇丹紅海"]},
    {"names": ["Red Sea | Sudan Red Sea"], "country": "Sudan", "aliases": ["苏丹红海"]},
    {"names": ["Vitebsk"], "country": "Belarus", "aliases": ["Витебская область"]},
    {"names": ["Vitebsk"], "country": "Belarus", "aliases": ["Витебск"]},
    {"names": ["Saxony-Anhalt"], "country": "Germany", "aliases": ["ザクセン＝アンハルト"]},
    {"names": ["Saxony-Anhalt"], "country": "Germany", "aliases": ["Sachsen-Anhalt"]},
    {"names": ["Pyrénées-Orientales"], "country": "France", "aliases": ["东比利牛斯省"]},
    {"names": ["Pyrénées-Orientales"], "country": "France", "aliases": ["Eastern Pyrenees"]},
    {"names": ["Brandenburg"], "country": "Germany", "aliases": ["브란덴부르크"]},
    {"names": ["Brandenburg"], "country": "Germany", "aliases": ["ブランデンブルク"]},
    {"names": ["Brandenburg"], "country": "Germany", "aliases": ["布蘭登堡"]},
    {"names": ["Brandenburg"], "country": "Germany", "aliases": ["勃兰登堡"]},
    {"names": ["Hawaii Oahu"], "country": "United States of America", "aliases": ["오아후"]},
    {"names": ["Hawaii Oahu"], "country": "United States of America", "aliases": ["オアフ島"]},
    {"names": ["Hawaii Oahu"], "country": "United States of America", "aliases": ["歐胡島"]},
    {"names": ["Hawaii Oahu"], "country": "United States of America", "aliases": ["欧胡岛"]},
    {"names": ["Bern"], "country": "Switzerland", "aliases": ["ベルン州"]},
    {"names": ["Bern"], "country": "Switzerland", "aliases": ["伯恩州"]},
    {"names": ["Bern"], "country": "Switzerland", "aliases": ["伯尔尼"]},
    {"names": ["Bermuda"], "country": "United Kingdom", "aliases": ["버뮤다"]},
    {"names": ["Bermuda"], "country": "United Kingdom", "aliases": ["バミューダ"]},
    {"names": ["Bermuda"], "country": "United Kingdom", "aliases": ["百慕大"]},
    {"names": ["Sangalaki"], "country": "Indonesia", "aliases": ["サンガラキ島"]},
    {"names": ["Sangalaki"], "country": "Indonesia", "aliases": ["サンガラキ"]},
    {"names": ["Sangalaki"], "country": "Indonesia", "aliases": ["聖加拉奇"]},
    {"names": ["Sangalaki"], "country": "Indonesia", "aliases": ["圣加拉奇"]},
    {"names": ["Sangalaki"], "country": "Indonesia", "aliases": ["桑加拉基"]},
    {"names": ["Aruba"], "country": "Netherlands", "aliases": ["아루바"]},
    {"names": ["Aruba"], "country": "Netherlands", "aliases": ["アルバ"]},
    {"names": ["Aruba"], "country": "Netherlands", "aliases": ["阿魯巴"]},
    {"names": ["Aruba"], "country": "Netherlands", "aliases": ["阿鲁巴"]},
    {"names": ["New York"], "country": "United States", "aliases": ["뉴욕주"]},
    {"names": ["New York"], "country": "United States", "aliases": ["ニューヨーク州"]},
    {"names": ["New York"], "country": "United States", "aliases": ["紐約州"]},
    {"names": ["New York"], "country": "United States", "aliases": ["纽约州"]},
    {"names": ["Hawaii"], "country": "United States of America", "aliases": ["하와이"]},
    {"names": ["Hawaii"], "country": "United States of America", "aliases": ["ハワイ"]},
    {"names": ["Hawaii"], "country": "United States of America", "aliases": ["夏威夷"]},
    {"names": ["Gelderland"], "country": "Netherlands", "aliases": ["ヘルダーラント"]},
    {"names": ["Gelderland"], "country": "Netherlands", "aliases": ["格爾德蘭"]},
    {"names": ["Gelderland"], "country": "Netherlands", "aliases": ["海爾德蘭"]},
    {"names": ["Gelderland"], "country": "Netherlands", "aliases": ["格尔德兰省"]},
    {"names": ["Gelderland"], "country": "Netherlands", "aliases": ["海尔德兰"]},
    {"names": ["Bahamas"], "country": "The Bahamas", "aliases": ["바하마"]},
    {"names": ["Bahamas"], "country": "The Bahamas", "aliases": ["バハマ"]},
    {"names": ["Bahamas"], "country": "The Bahamas", "aliases": ["巴哈馬"]},
    {"names": ["Bahamas"], "country": "The Bahamas", "aliases": ["巴哈马"]},
    {"names": ["Maldives"], "country": "Maldives", "aliases": ["몰디브"]},
    {"names": ["Maldives"], "country": "Maldives", "aliases": ["モルディブ"]},
    {"names": ["Maldives"], "country": "Maldives", "aliases": ["馬爾代夫"]},
    {"names": ["Maldives"], "country": "Maldives", "aliases": ["馬爾地夫"]},
    {"names": ["Maldives"], "country": "Maldives", "aliases": ["马尔代夫"]},
    {"names": ["Croatia"], "country": "Croatia", "aliases": ["크로아티아"]},
    {"names": ["Croatia"], "country": "Croatia", "aliases": ["クロアチア"]},
    {"names": ["Croatia"], "country": "Croatia", "aliases": ["克羅埃西亞"]},
    {"names": ["Croatia"], "country": "Croatia", "aliases": ["克罗地亚"]},
    {"names": ["British Virgin Islands"], "country": "Virgin Islands, British", "aliases": ["영국령 버진아일랜드"]},
    {"names": ["British Virgin Islands"], "country": "Virgin Islands, British", "aliases": ["イギリス領ヴァージン諸島"]},
    {"names": ["British Virgin Islands"], "country": "Virgin Islands, British", "aliases": ["英屬維京群島"]},
    {"names": ["British Virgin Islands"], "country": "Virgin Islands, British", "aliases": ["英属维尔京群岛"]},
    {"names": ["Cyprus"], "country": "Cyprus", "aliases": ["키프로스"]},
    {"names": ["Cyprus"], "country": "Cyprus", "aliases": ["キプロス"]},
    {"names": ["Cyprus"], "country": "Cyprus", "aliases": ["賽普勒斯"]},
    {"names": ["Cyprus"], "country": "Cyprus", "aliases": ["塞浦路斯"]},
    {"names": ["Barbados"], "country": "Barbados", "aliases": ["바베이도스"]},
    {"names": ["Barbados"], "country": "Barbados", "aliases": ["バルバドス"]},
    {"names": ["Barbados"], "country": "Barbados", "aliases": ["巴貝多"]},
    {"names": ["Barbados"], "country": "Barbados", "aliases": ["巴巴多斯"]},
    {"names": ["Solomon Islands"], "country": "Solomon Islands", "aliases": ["솔로몬 제도"]},
    {"names": ["Solomon Islands"], "country": "Solomon Islands", "aliases": ["ソロモン諸島"]},
    {"names": ["Solomon Islands"], "country": "Solomon Islands", "aliases": ["所羅門群島"]},
    {"names": ["Solomon Islands"], "country": "Solomon Islands", "aliases": ["索羅門群島"]},
    {"names": ["Solomon Islands"], "country": "Solomon Islands", "aliases": ["所罗门群岛"]},
    {"names": ["Jamaica"], "country": "Jamaica", "aliases": ["자메이카"]},
    {"names": ["Jamaica"], "country": "Jamaica", "aliases": ["ジャマイカ"]},
    {"names": ["Jamaica"], "country": "Jamaica", "aliases": ["牙買加"]},
    {"names": ["Jamaica"], "country": "Jamaica", "aliases": ["牙买加"]},
    {"names": ["South Florida"], "country": "United States of America", "aliases": ["南フロリダ"]},
    {"names": ["South Florida"], "country": "United States of America", "aliases": ["南佛罗里达州"]},
    {"names": ["South Florida"], "country": "United States of America", "aliases": ["南佛罗里达"]},
    {"names": ["Marshall Islands"], "country": "Marshall Islands", "aliases": ["마셜 제도"]},
    {"names": ["Marshall Islands"], "country": "Marshall Islands", "aliases": ["マーシャル諸島"]},
    {"names": ["Marshall Islands"], "country": "Marshall Islands", "aliases": ["馬紹爾群島"]},
    {"names": ["Marshall Islands"], "country": "Marshall Islands", "aliases": ["马绍尔群岛"]},
    {"names": ["Florida"], "country": "United States", "aliases": ["佛羅裡達州"]},
    {"names": ["Florida"], "country": "United States", "aliases": ["佛羅里達州"]},
    {"names": ["Florida"], "country": "United States", "aliases": ["佛罗里达州"]},
    {"names": ["Santa Cruz de Tenerife"], "country": "Spain", "aliases": ["サンタクルス デ テネリフェ"]},
    {"names": ["Santa Cruz de Tenerife"], "country": "Spain", "aliases": ["サンタ・クルス・デ・テネリフェ"]},
    {"names": ["Santa Cruz de Tenerife"], "country": "Spain", "aliases": ["圣克鲁斯-德特内里费"]},
    {"names": ["Papua New Guinea"], "country": "Papua New Guinea", "aliases": ["파푸아뉴기니"]},
    {"names": ["Papua New Guinea"], "country": "Papua New Guinea", "aliases": ["パプアニューギニア"]},
    {"names": ["Papua New Guinea"], "country": "Papua New Guinea", "aliases": ["巴布亞新幾內亞"]},
    {"names": ["Papua New Guinea"], "country": "Papua New Guinea", "aliases": ["巴布亞紐幾內亞"]},
    {"names": ["Papua New Guinea"], "country": "Papua New Guinea", "aliases": ["巴布亚新几内亚"]},
    {"names": ["Las Palmas"], "country": "Spain", "aliases": ["라스팔마스"]},
    {"names": ["Las Palmas"], "country": "Spain", "aliases": ["拉斯帕爾馬斯"]},
    {"names": ["Las Palmas"], "country": "Spain", "aliases": ["拉斯帕尔马斯"]},
    {"names": ["South Aegean"], "country": "Greece", "aliases": ["南愛琴海"]},
    {"names": ["South Aegean"], "country": "Greece", "aliases": ["南爱琴海"]},
    {"names": ["Red Sea"], "country": "Saudi Arabia", "aliases": ["红海"]},
    {"names": ["Los Cabos"], "country": "Mexico", "aliases": ["ロスカボス"]},
    {"names": ["Aqaba"], "country": "Jordan", "aliases": ["아카바"]},
    {"names": ["Manabí"], "country": "Ecuador", "aliases": ["马纳比", "馬納比", "マナビ"]},
    {"names": ["North Holland"], "country": "Netherlands", "aliases": ["Noord-Holland"]},
    {"names": ["Tanzania | Zanzibar"], "country": "United Republic of Tanzania", "aliases": ["桑給巴爾"]},
    {"names": ["Zürich"], "country": "Switzerland", "aliases": ["蘇黎世"]},
    {"names": ["Tobago"], "country": "Trinidad and Tobago", "aliases": ["多巴哥", "多巴哥岛", "多巴哥島"]},
    {"names": ["Split-Dalmatia"], "country": "Croatia", "aliases": ["Splitsko-dalmatinska županija"]},
    {"names": ["Zürich"], "country": "Switzerland", "aliases": ["苏黎世"]},
    {"names": ["Tanzania | Zanzibar"], "country": "United Republic of Tanzania", "aliases": ["Zanzibar", "桑给巴尔", "ザンジバル"]},
    {"names": ["Apulia"], "country": "Italy", "aliases": ["Puglia", "普利亚", "プーリア"]},
    {"names": ["North Holland"], "country": "Netherlands", "aliases": ["北荷蘭", "北荷蘭省"]},
    {"names": ["Aqaba"], "country": "Jordan", "aliases": ["アカバ"]},
    {"names": ["North Holland"], "country": "Netherlands", "aliases": ["北荷兰"]},
    {"names": ["Aqaba"], "country": "Jordan", "aliases": ["亚喀巴", "阿卡巴", "亞喀巴"]},
    {"names": ["Tobago"], "country": "Trinidad and Tobago", "aliases": ["トバゴ", "トバゴ島"]},
    {"names": ["Los Cabos"], "country": "Mexico", "aliases": ["洛斯卡沃斯"]},
    {"names": ["Western Cape"], "country": "South Africa", "aliases": ["西開普省"]},
    {"names": ["South Holland"], "country": "Netherlands", "aliases": ["南荷蘭"]},
    {"names": ["Crete"], "country": "Greece", "aliases": ["크레타섬"]},
    {"names": ["South Holland"], "country": "Netherlands", "aliases": ["南荷兰"]},
    {"names": ["Crete"], "country": "Greece", "aliases": ["クレタ", "クレタ島", "크레타", "크레타 섬"]},
    {"names": ["Monterey Bay"], "country": "United States of America", "aliases": ["モントレー湾"]},
    {"names": ["Lower Saxony"], "country": "Germany", "aliases": ["下萨克森州"]},
    {"names": ["Saxony"], "country": "Germany", "aliases": ["Sachsen", "ザクセン"]},
    {"names": ["Lower Saxony"], "country": "Germany", "aliases": ["Niedersachsen", "下薩克森"]},
    {"names": ["Crete"], "country": "Greece", "aliases": ["克里特島"]},
    {"names": ["Monterey Bay"], "country": "United States of America", "aliases": ["蒙特雷湾"]},
    {"names": ["Bocas Del Toro"], "country": "Panama", "aliases": ["博卡斯德尔托罗", "博卡斯德爾托羅"]},
    {"names": ["Curacao"], "country": "Netherlands", "aliases": ["库拉索", "库拉索岛", "庫拉索"]},
    {"names": ["Curacao"], "country": "Curaçao", "aliases": ["库拉索", "库拉索岛", "庫拉索"]},
    {"names": ["Western Cape"], "country": "South Africa", "aliases": ["西开普省"]},
    {"names": ["Crete"], "country": "Greece", "aliases": ["克里特岛"]},
    {"names": ["Muscat"], "country": "Oman", "aliases": ["马斯喀特", "マスカット", "무스카트"]},
    {"names": ["Chuuk Lagoon"], "country": "Federated States of Micronesia", "aliases": ["Truk Lagoon", "楚克泻湖", "特鲁克泻湖", "チューク環礁", "トラック環礁", "트럭 라군"]},
    {"names": ["South Holland"], "country": "Netherlands", "aliases": ["Zuid-Holland", "Zuid Holland"]},
    {"names": ["Auckland"], "country": "New Zealand", "aliases": ["奥克兰", "奧克蘭", "オークランド", "오클랜드"]},
    {"names": ["Florida Keys"], "country": "United States", "aliases": ["佛罗里达群岛", "フロリダキーズ", "フロリダ・キーズ", "플로리다 키스"]},
    {"names": ["Florida Keys"], "country": "United States of America", "aliases": ["佛罗里达群岛", "フロリダキーズ", "フロリダ・キーズ", "플로리다 키스"]},
    {"names": ["Alicante"], "country": "Spain", "aliases": ["阿利坎特"]},
    { names: ["North Rhine-Westphalia"], country: "Germany", aliases: ["Nordrhein-Westfalen"] },
    { names: ["Baden-Württemberg"], country: "Germany", aliases: ["巴登-符腾堡州", "巴登符腾堡"] },
    { "names": ["Istria"], "country": "Croatia", "aliases": ["伊斯特拉", "伊斯特拉半岛", "伊斯特拉半島", "伊斯特里亚", "伊斯特里亚半岛", "イストリア", "イストリア半島", "이스트리아"] },
    { "names": ["São Vicente"], "country": "Cabo Verde", "aliases": ["圣维森特", "圣维森特岛", "サン・ヴィセンテ島", "サンビセンテ島"] },
    { "names": ["Providencia Island"], "country": "Colombia", "aliases": ["普罗维登西亚岛", "普罗维登西亚", "プロビデンシア", "Isla Providencia"] },
    {"names": ["New Providence"], "country": "Bahamas", "aliases": ["新普罗维登斯", "新普罗维登斯岛", "新普羅維登斯", "新普羅維登斯島"]},
    {"names": ["Lord Howe Island"], "country": "Australia", "aliases": ["豪勋爵岛", "豪勳爵島", "ロード・ハウ島", "로드하우섬"]},
    {"names": ["North Brabant"], "country": "Netherlands", "aliases": ["Noord-Brabant"]},
    {"names": ["Christmas Island"], "country": "Australia", "aliases": ["圣诞岛", "聖誕島", "クリスマス島"]},
    {"names": ["Coiba National Park"], "country": "Panama", "aliases": ["科伊瓦国家公园", "科伊瓦國家公園", "科伊巴国家公园"]},
    {"names": ["Philippines Tubbataha Reefs"], "country": "Philippines", "aliases": ["图巴塔哈", "圖巴塔哈", "トゥバタハ", "투바타하", "图巴塔哈群礁"]},
    {"names": ["North Sulawesi"], "country": "Indonesia", "aliases": ["北苏拉威西"]},
    {"names": ["Cabo Pulmo"], "country": "Mexico", "aliases": ["卡波普尔莫", "カボプルモ", "カボ・プルモ"]},
    {"names": ["Gipuzkoa"], "country": "Spain", "aliases": ["Guipúzcoa"]},
    {"names": ["Norway Lofoten Islands"], "country": "Norway", "aliases": ["ロフォーテン", "ロフォーテン諸島", "罗弗敦群岛", "罗弗敦岛"]},
    {"names": ["Waikato"], "country": "New Zealand", "aliases": ["ワイカト"]},
    {"names": ["Andaman Islands"], "country": "India", "aliases": ["安达曼群岛", "安達曼群島"]},
    {"names": ["Shizuoka Prefecture"], "country": "Japan", "aliases": ["静岡県", "静岡"]},
    {"names": ["Puerto Vallarta"], "country": "Mexico", "aliases": ["巴亚尔塔港", "瓦拉塔港", "巴亞爾塔港"]},
    {"names": ["Camiguin"], "country": "Philippines", "aliases": ["甘米银", "甘米銀", "卡米京", "卡米金", "カミギン", "カミギン島"]},
    {"names": ["Niigata Prefecture"], "country": "Japan", "aliases": ["新潟県", "新潟"]},
    {"names": ["Gjirokastër"], "country": "Albania", "aliases": ["吉诺卡斯特"]},
    {"names": ["Vlorë"], "country": "Albania", "aliases": ["发罗拉"]},
    {"names": ["Israel"], "country": "Israel", "aliases": ["ישראל"]},
    {"names": ["Ambon"], "country": "Indonesia", "aliases": ["安汶", "アンボン", "암본"]},
    {"names": ["Alor Archipelago"], "country": "Indonesia", "aliases": ["阿洛群岛", "阿洛群島", "阿洛尔", "アロール", "알로르"]},
    {"names": ["Western Australia"], "country": "Australia", "aliases": ["西澳", "西澳大利亚", "西澳大利亚州", "西澳大利亞", "西澳大利亞州", "澳大利亞西部", "西オーストラリア", "西オーストラリア州", "서호주", "웨스턴오스트레일리아"]},
    {"names": ["Victoria"], "country": "Australia", "aliases": ["维多利亚", "维多利亚州", "維多利亞", "維多利亞州", "ビクトリア", "ビクトリア州", "빅토리아"]},
    // Multilingual diving-destination names for the Australian state.
    {"names": ["Queensland"], "country": "Australia", "aliases": ["昆士兰", "昆士兰州", "昆士蘭", "昆士蘭州", "クイーンズランド", "クイーンズランド州", "퀸즐랜드"]},
    // https://www.padi.com/zh-hans/dive-site/ao-da-li-ya/neptune-islands/
    // https://www.liveaboard.com/ja/diving/australia/scuba
    { names: ["South Australia Neptune Islands"], country: "Australia", aliases: ["Neptune Islands", "海王星群岛", "海王星群島", "海神群島", "ネプチューン諸島"] },
    // https://www.padi.com/dive-center/austria/tauchen-in-tirol/
    // https://www.austria.info/ja/locations/lake-achensee/
    { names: ["Tyrol"], country: "Austria", aliases: ["Tirol", "チロル"] },
    // https://www.scubago.com/tw/explore/destination/upper-austria-9750768
    { names: ["Upper Austria"], country: "Austria", aliases: ["Oberösterreich", "上奥地利州", "上奧地利州"] },
    // https://blog.padi.com/tw/jacques-cousteaus-favorite-dive-destinations-around-the-world/
    // https://www.siamdive.com/cn/explore/dive-center/sundown-diving
    { names: ["Vancouver Island"], country: "Canada", aliases: ["温哥华岛", "溫哥華島"] },
    // https://www.padi.com.tw/zh-hant/diving-in/bo-li-zi-cheng/
    // https://www.liveaboard.com/kr/diving/belize
    { names: ["Belize Barrier Reef"], country: "Belize", aliases: ["伯利兹堡礁", "伯利茲堡礁", "벨리즈 배리어 리프"] },
    // https://www.padi.com/zh-hans/dive-center/ao-da-li-ya/ningaloo-reef-dive/
    // https://www.australia.com/ja-jp/places/perth-and-surrounds/guide-to-ningaloo-reef.html
    // https://www.australia.com/ko-kr/places/perth-and-surrounds/guide-to-ningaloo-reef.html
    { names: ["Ningaloo Reef"], country: "Australia", aliases: ["宁格鲁礁", "宁加洛珊瑚礁", "ニンガルーリーフ", "닝갈루 리프"] },
    // https://travel.padi.com/zh-hans/dive-course/south-of-france/discover-scuba-diving-in-the-port-cros-and-porquerolles-national-park-90582/
    {"names": ["Port Cros"], "country": "France", "aliases": ["克罗港"]},
    // https://travel.padi.com/zh-hans/dive-center/yi-da-li/evasioni-blu-diving-3/ and the sources in the review ledger.
    {"names": ["Ustica"], "country": "Italy", "aliases": ["乌斯蒂卡", "烏斯蒂卡", "烏斯蒂卡島", "ウスティカ島"]},
    // https://www.padi.com/zh-hans/dive-center/ku-ke-qun-dao/adventure-cook-islands/?from_lang=zh-hant and the sources in the review ledger.
    {"names": ["Cook Islands Rarotonga"], "country": "Cook Islands", "aliases": ["拉罗汤加", "拉罗汤加岛", "拉羅湯加", "拉羅湯加島", "ラロトンガ", "ラロトンガ島", "라로통가"]},
    // https://www.padi.com/ja/diving-in/sentoyu-sutateiusu/
    {names:['Sint Eustatius'], country:'Netherlands', aliases:['セントユースタティウス','セント・ユースタティウス島','シント・ユースタティウス島']},
    // https://www.padi.com/ja/diving-in/netherlands/
    {names:['Zeeland'], country:'Netherlands', aliases:['ゼーラント','ゼーラント州']},
    // https://www.padi.com/ja/diving-in/kataru-niya/
    {names:['Girona'], country:'Spain', aliases:['ジローナ']},
    // https://www.padi.com/zh-hans/dive-site/mei-li-jian-he-zhong-guo-usa/fort-stark/
    {names:['New England'], country:'United States of America', aliases:['新英格兰']},
    // https://www.padi.com/zh-hans/diving-in/jia-li-fu-ni-ya/
    // https://www.padi.com/ja/diving-in/karihuoruniazhou/
    {names:['California'], country:'United States', aliases:['加利福尼亚','加利福尼亚州','加州','カリフォルニア','カリフォルニア州']},
    // https://www.padi.com/zh-hans/diving-in/ma-sa-zhu-sai-zhou/
    // https://www.padi.com/ja/diving-in/united-states-of-america-usa/
    {names:['Massachusetts'], country:'United States', aliases:['马萨诸塞州','マサチューセッツ州']},
    // https://www.padi.com/zh-hans/dive-center/mei-li-jian-he-zhong-guo-usa/project-scuba/
    {names:['Texas'], country:'United States', aliases:['德克萨斯州','德克萨斯']},
    // https://www.padi.com/zh-hans/diving-in/liu-ni-wang/
    // https://www.padi.com/zh-hant/diving-in/liu-ni-wang/
    {names:['Reunion'], country:'France', aliases:['留尼汪','留尼汪岛','留尼汪島','留尼旺']},
    // https://www.padi.com/zh-hans/diving-in/ying-shu-wei-er-jing-qun-dao/
    {names:['British Virgin Islands'], country:'United Kingdom', aliases:['英属维尔京群岛']},
    // https://www.padi.com/zh-hans/dive-center/jia-na-da/dive-life-tobermory/
    {names:['Ontario'], country:'Canada', aliases:['安大略','安大略省']},
    // https://www.padi.com/zh-hans/diving-in/sa-ding-dao/
    // https://www.padi.com/ja/diving-in/itaria/harao-2/
    {names:['Sardinia'], country:'Italy', aliases:['撒丁岛','サルデーニャ','サルデーニャ島']},
    // https://www.padi.com/zh-hans/diving-in/xin-nan-wei-er-shi-zhou/
    {names:['New South Wales'], country:'Australia', aliases:['新南威尔士','新南威尔士州']},
    // https://www.padi.com/zh-hans/diving-in/gua-de-luo-pu-qun-dao/
    // https://www.padi.com/ja/diving-in/kuatoru-huzhu-dao/
    {names:['Guadeloupe'], country:'France', aliases:['瓜德罗普','瓜德罗普群岛','グアドループ','グアドループ諸島']},
    // https://www.padi.com/zh-hans/diving-in/ma-ti-ni-ke/
    // https://www.padi.com/ja/diving-in/maruteini-ku/
    {names:['Martinique'], country:'France', aliases:['马提尼克','马提尼克岛','マルティニーク','マルティニーク島']},
    // https://www.padi.com/zh-hans/diving-in/rou-fo-zhou/
    {names:['Johor'], country:'Malaysia', aliases:['柔佛','柔佛州']},
    // https://www.padi.com/zh-hans/dive-center/fei-lu-bin/easy-diving-dauin/
    {names:['Negros Oriental'], country:'Philippines', aliases:['东内格罗斯','东内格罗斯省','東內格羅斯','東內格羅斯省']},
    // https://www.padi.com/ja/diving-in/hone-rudao/
    {names:['Bonaire'], country:'Netherlands', aliases:['ボネール','ボネール島']},
    // https://www.siamdive.com/cn/explore/dive-center/red-alert-diving
    // https://www.padi.com/ko/dive-center/amerika-habjunggug-usa/red-alert-diving/
    {names:['Florida Panhandle'], country:'United States of America', aliases:['佛罗里达狭长地带','佛罗里达州狭长地带','플로리다 팬핸들']},
    // https://travel.padi.com/zh-hans/dive-trip/neuschottland/halifax-nova-scotia-local-shore-dives-12607/
    // https://www.padi.com/ja/dive-center/canada/east-coast-scuba-watersports/
    // https://travel.padi.com/ko/dive-center/kaenada/east-coast-scuba-watersports/
    {names:['Nova Scotia'], country:'Canada', aliases:['新斯科舍省','ノバスコシア州','노바스코샤']},
    // https://www.scubago.com/cn/explore/destination/the-great-lakes-9750222
    // https://www.padi.com/ja/diving-in/canada/
    // https://travel.padi.com/ko/diving-in/kaenada/
    {names:['Great Lakes'], country:'Canada', aliases:['五大湖','오대호']},
    // https://www.scubago.com/cn/explore/destination/north-island-9749699
    // https://www.diveseason.com/dive/tutukaka-poor-knights/
    // https://www.newzealand.com/jp/diving/
    // https://www.newzealand.com/kr/diving/
    {names:['Poor Knights Islands'], country:'New Zealand', aliases:['普尔骑士群岛','穷骑士群岛','窮騎士群島','プアナイツ諸島','プアー・ナイツ諸島','푸어 나이츠 제도','푸어나이츠 군도']},
    // https://www.padi.com/zh-hans/diving-in/ke-su-mei-er/
    // https://www.padi.com/ja/diving-in/kosumeru/
    // https://www.padi.com/ko/destinations/mexico/cozumel
    {names:['Cozumel'], country:'Mexico', aliases:['科苏梅尔','コスメル','コズメル','코수멜','코주멜']},
    // https://www.padi.com/zh-hans/dive-sites/australie/great-barrier-reef/
    // https://www.padi.com/ko/diving-in/great-barrier-reef/
    {names:['Great Barrier Reef'], country:'Australia', aliases:['大堡礁','그레이트 배리어 리프','グレートバリアリーフ','グレート・バリア・リーフ']},
    // https://www.padi.com/zh-hans/diving/japan
    // https://www.padi.com/ja/diving-in/japan/
    // https://www.padi.com/ko/diving-in/okinawa/
    {names:['Okinawa','Okinawa Prefecture'], country:'Japan', aliases:['冲绳','沖縄','오키나와']},
    // https://www.padi.com/zh-hans/dive-site/thailand/similan-islands-national-marine-park/
    // https://www.padi.com/ja/dive-site/taiwang-guo/christmas-point/
    // https://www.padi.com/ko/dive-center/taegug/similan-divers-co-ltd/
    {names:['Thailand Similan Islands'], country:'Thailand', aliases:['斯米兰群岛','シミラン諸島','시밀란 섬']},
    // https://morefun-philippines.sdyf-pros.dragontrail.cn/wp-content/uploads/sites/6/2024/07/%E8%8F%B2%E5%BE%8B%E5%AE%BE%E6%BD%9C%E6%B0%B4%E6%89%8B%E5%86%8C2024V5.pdf
    // https://www.padi.com/ja/diving-in/huirihin/huerutokarera/
    // https://www.padi.com/ko/diving-in/pilripin/puereuto-galrera/
    {names:['Philippines Puerto Galera'], country:'Philippines', aliases:['海豚湾','プエルトガレラ','プエルト・ガレラ','푸에르토 갈레라']},
    // https://www.padi.com/zh-hans/dive-center/philippines/zhuilang-bohol/
    // https://www.padi.com/ja/diving-in/hoho-ru/
    // https://www.padi.com/ko/dive-shops/bohol/
    {names:['Bohol','Philippines Bohol'], country:'Philippines', aliases:['薄荷岛','ボホール','보홀']},
    // https://www.padi.com/zh-hans/diving-in/su-wu-sheng/
    // https://www.padi.com/ja/diving-in/sehuzhou/
    // https://www.padi.com/ko/diving-in/sebuju/
    {names:['Cebu'], country:'Philippines', aliases:['宿务','セブ島','세부']},
    // https://travel.padi.com/zh-hans/dive-center/hong-du-la-si/utila-dive-centre/
    // https://www.padi.com/ja/diving-in/roatandao-touteiradao/
    {names:['Utila'], country:'Honduras', aliases:['乌提拉','乌蒂拉','ウティラ島']},
    // https://www.padi.com/zh-hans/diving-in/ya-su-er-qun-dao/
    // https://www.padi.com/ja/dive-shops/asoresuzhu-dao/
    // https://www.padi.com/ko/diving-in/a-joreseu/
    {names:['Azores'], country:'Portugal', aliases:['亚速尔群岛','アゾレス諸島','아조레스']},
    // https://www.padi.com/zh-hans/dive-center/nan-fei/into-the-blue/
    // https://www.padi.com/ja/dive-center/nan-ahurikagong-he-guo/pisces-divers/
    // https://www.padi.com/ko/diving-in/namapeurika-gonghwagug/keipeutaun/
    {names:['Cape Town'], country:'South Africa', aliases:['开普敦','ケープタウン','케이프타운']},
    // https://www.padi.com/zh-hans/diving-in/ba-li-a-li-qun-dao/
    // https://travel.padi.com/ja/diving-in/harearesuzhu-dao/
    {names:['Balearic Islands'], country:'Spain', aliases:['巴利阿里群岛','バレアレス諸島']},
    // https://www.padi.com/ja/diving-in/huriteitsushiyukoronhiazhou/
    {names:['British Columbia'], country:'Canada', aliases:['ブリティッシュコロンビア州']},
    // PADI diving sources are recorded beside each independently reviewed entry.
    // https://www.padi.com/zh-hant/exploration/?lang=en
    // https://www.padi.com/ko/destinations/egypt
    {names:['Red Sea'], country:'Egypt', aliases:['红海','紅海','홍해']},
    // https://www.padi.com/zh-hans/dive-center/hong-du-la-si/sun-divers-roatan/
    // https://www.padi.com/ko/dive-center/onduraseu/native-sons-water-sports/
    {names:['Roatan'], country:'Honduras', aliases:['罗阿坦','罗阿坦岛','로아탄','ロアタン島']},
    // https://www.padi.com/zh-hans/conservation/activities/activite-de-preservation-45838/
    // https://www.padi.com/zh-hant/diving-in/ke-li-dao/
    // https://www.padi.com/ja/diving-in/haridao/
    {names:['Bali'], country:'Indonesia', aliases:['巴厘岛','巴厘','峇里島','バリ島']},
    // https://www.padi.com/zh-hans/diving-in/bo-nai-er/
    // https://blog.padi.com/jp/eco-travel-destinations-leading-marine-protection/
    {names:['Bonaire'], country:'Bonaire, Sint Eustatius and Saba', aliases:['博奈尔','博内尔','ボネール']},
    {names:['Lembeh','Lembeh Strait'], country:'Indonesia', aliases:['蓝碧','蓝碧海峡','蓝贝','蓝贝海峡','伦贝','伦贝海峡','藍碧','藍碧海峽','倫貝','倫貝海峽','レンベ','レンベ海峡','렘베','렘베 해협']},
    {names:['Raja Ampat'], country:'Indonesia', aliases:['四王群岛','四王群島','拉贾安帕特','拉賈安帕特','ラジャアンパット','ラジャ・アンパット','라자 암팟','라자 앰팟']},
    {names:['Sipadan'], country:'Malaysia', aliases:['诗巴丹','詩巴丹','シパダン','시파단']},
    {names:['Tubbataha','Tubbataha Reef','Tubbataha Reefs'], country:'Philippines', aliases:['图巴塔哈','圖巴塔哈']},
    {names:['Komodo','Komodo National Park'], country:'Indonesia', aliases:['科莫多','科摩多','コモド','코모도']},
    {names:['Manado Bunaken'], country:'Indonesia', aliases:['美娜多','万鸦老','マナド','마나도']},
    {names:['Manado Bunaken','Bunaken'], country:'Indonesia', aliases:['布纳肯','布納肯','ブナケン','부나켄']},
    {names:['Philippines Anilao','Anilao'], country:'Philippines', aliases:['阿尼洛','アニラオ','아닐라오']},
    {names:['Carinthia'], country:'Austria', aliases:['Kärnten','克恩顿','ケルンテン']},
    {names:['Bavaria'], country:'Germany', aliases:['Bayern','巴伐利亚']},
    {names:['Quintana Roo'], country:'Mexico', aliases:['金塔纳罗奥','金塔纳罗奥州']},
    {names:['Koh Tao'], country:'Thailand', aliases:['涛岛','龟岛','濤島','龜島','タオ島','꼬따오']},
    {names:['Mabul'], country:'Malaysia', aliases:['马布','马步','馬布','馬步','マブール','마불']},
    {names:['Philippines Malapascua','Malapascua'], country:'Philippines', aliases:['妈妈拍丝瓜','媽媽拍絲瓜','妈妈岛','媽媽島','媽媽怕絲瓜','マラパスクア','말라파스쿠아']}

  ];
  // Site aliases are matched only to exact recorded names and a known country.
  // Blue Corner also exists in Indonesia and Japan; its Palau aliases must not
  // turn those separate records into the Palau site.
  // https://www.padi.com/ja/diving-in/harao/
  // https://blog.padi.com/ko/shark-diving-the-best-dive-sites-in-the-world/
  // https://blog.padi.com/ko/best-scuba-diving-destinations-in-the-world/
  const siteAliases = [
    {"names": ["Jocker Reef"], "country": "Seychelles", "siteIds": ["ab38266c-9371-426b-b2a6-d45b2cce7049"], "aliases": ["Joker Reef"]},
    {"names": ["Wobby Rock, Gneering Shoals"], "country": "Australia", "siteIds": ["40fe99c3-946e-4959-b3b2-681b3c86c249"], "aliases": ["Wobbie Rock"]},
    {"names": ["Wobby Rock, Gneering Shoals"], "country": "Australia", "siteIds": ["40fe99c3-946e-4959-b3b2-681b3c86c249"], "aliases": ["Nurse Rock"]},
    {"names": ["Hauler Wreck"], "country": "Australia", "siteIds": ["f2ae2711-96b0-4ae1-8e89-372190aa07f5"], "aliases": ["Tasman Hauler Wreck"]},
    {"names": ["Seraya Secrets"], "country": "Indonesia", "siteIds": ["96cfa0fb-d8fe-4c41-888d-3de96c2b12da"], "aliases": ["Seraya Secret"]},
    {"names": ["Two Oceans Aquarium Predator Tank"], "country": "South Africa", "siteIds": ["8c5b81ab-2f7c-4127-bca4-549ae8072ec6"], "aliases": ["I&J Predator Exhibit"]},
    {"names": ["The Gardens"], "country": "New Zealand", "siteIds": ["bcd39620-f6ae-4cad-8a41-10d74a041f54"], "aliases": ["Sandager Reef"]},
    {"names": ["Mbigo Mbigo"], "country": "Solomon Islands", "siteIds": ["87740301-5696-4f5a-85c0-e5733bdddfc0"], "aliases": ["Rainbow Rainbow"]},
    {"names": ["Parc"], "country": "Mauritius", "siteIds": ["bc257c76-12dc-46b4-a4cb-b4f93c5d654f"], "aliases": ["Park"]},
    {"names": ["Passe de Tiputa"], "country": "French Polynesia", "siteIds": ["b0c6f913-188c-49d9-90a0-cde132fc2840"], "aliases": ["Hiria Pass"]},
    {"names": ["Mary Island"], "country": "Solomon Islands", "siteIds": ["4d92d82b-96e9-4851-82f1-3cb44d9f4a3a"], "aliases": ["Devil's Island"]},
    {"names": ["Chira Rani - Patate Bleue"], "country": "France", "siteIds": ["8c89ab66-179b-429b-a94b-2fe2d93e7c24"], "aliases": ["Chira Rani"]},
    {"names": ["Galeão Sacramento"], "country": "Brazil", "siteIds": ["2cdc1cff-c8ee-42a7-b01e-3b57dd81a68e"], "aliases": ["Galeão Santíssimo Sacramento"]},
    {"names": ["B-17 Flying Fortress"], "country": "Solomon Islands", "siteIds": ["e9d817b9-1b37-4941-8ac5-f7b1ca884952"], "aliases": ["Bessie the Jap Basher"]},
    {"names": ["Mary Island"], "country": "Solomon Islands", "siteIds": ["4d92d82b-96e9-4851-82f1-3cb44d9f4a3a"], "aliases": ["Mborokua"]},
    {"names": ["L’Orient, Wreck"], "country": "Mauritius", "siteIds": ["03af1953-df79-4d9b-bd8a-76e6c6eac7c9"], "aliases": ["Orient Wreck"]},
    {"names": ["Roche Moyenne"], "country": "France", "siteIds": ["3340ce0e-d0b4-44ae-a216-d7d635ff3ef9"], "aliases": ["The Middle-sized Rock"]},
    {"names": ["Canyons - Moorea (Tahiti)"], "country": "French Polynesia", "siteIds": ["4c60bda8-b5f0-4aff-8c32-d7d842ae9b69"], "aliases": ["Opunohu Canyons"]},
    {"names": ["Broccoli Patch"], "country": "Australia", "siteIds": ["a16ac5e5-5f64-48ac-bff4-82beb10145b9"], "aliases": ["Broccoli Patches"]},
    {"names": ["Sandy 2nd’s - Lady Elliot Island"], "country": "Australia", "siteIds": ["ce003907-96fc-4780-b962-28bd56704889"], "aliases": ["Sandy Seconds"]},
    {"names": ["Ilha Montão de Trigo"], "country": "Brazil", "siteIds": ["3a50fd65-34cf-4c97-9000-d6ff2981634a"], "aliases": ["Ilha Monte de Trigo"]},
    {"names": ["Blue Chromis Reef"], "country": "Virgin Islands, British", "siteIds": ["1d61f0e3-317b-4fb9-a201-656864c39012"], "aliases": ["Chromis Reef"]},
    {"names": ["Alice in Wonderland, BVI"], "country": "Virgin Islands, British", "siteIds": ["e27071b2-f5bc-4bd8-88cb-2335132cf65b"], "aliases": ["Alice's Wonderland"]},
    {"names": ["Sabolon Kecil"], "country": "Indonesia", "siteIds": ["6d3c9b50-d847-4863-803f-7eb586aa67d1"], "aliases": ["Sabolin Kecil"]},
    {"names": ["Fish Soup N/W Rock"], "country": "Australia", "siteIds": ["b87c0127-e97d-4af0-9152-a647dfc20b0e"], "aliases": ["NW Rock Fish Soup"]},
    {"names": ["RED MERCS"], "country": "New Zealand", "siteIds": ["ad2c750b-9749-4040-9d03-08e2e0039fd5"], "aliases": ["Whakau"]},
    {"names": ["RED MERCS"], "country": "New Zealand", "siteIds": ["ad2c750b-9749-4040-9d03-08e2e0039fd5"], "aliases": ["Red Mercury Island"]},
    {"names": ["Chapeirão Mau Mau"], "country": "Brazil", "siteIds": ["633b7f96-903a-4453-a666-e0a7d59f4466"], "aliases": ["Chapeirão Maumau"]},
    {"names": ["GROS MORNE INTERIEUR"], "country": "Guadeloupe", "siteIds": ["8108bc22-44be-4851-b8d1-331819451901"], "aliases": ["Gros Morne intérieur"]},
    {"names": ["Kongo"], "country": "Kenya", "siteIds": ["093d631f-7ac8-43e3-bfbd-cf4c48ba7d0d"], "aliases": ["Kongo Reef"]},
    {"names": ["Giants Castle"], "country": "Mozambique", "siteIds": ["09781462-5598-48b7-aee0-d28ddd3a8cde"], "aliases": ["Galleria Reef"]},
    {"names": ["Chapeirao Atlantida"], "country": "Brazil", "siteIds": ["d8c4a47d-c5a9-404d-aa13-965d7a5bfb59"], "aliases": ["Chapeirões Atlântida"]},
    {"names": ["Chapeirao Atlantida"], "country": "Brazil", "siteIds": ["d8c4a47d-c5a9-404d-aa13-965d7a5bfb59"], "aliases": ["Chapeirão Atlântida"]},
    {"names": ["Papa Mashillingi"], "country": "Kenya", "siteIds": ["be8eeeb0-302b-460e-9876-4a60e058dd8c"], "aliases": ["Papa Mashilingi"]},
    {"names": ["Passe Bandrelé"], "country": "France", "siteIds": ["e2c3ae55-da48-4972-8741-646b77f27588"], "aliases": ["La Lolita"]},
    {"names": ["Anse Petit Cour"], "country": "Seychelles", "siteIds": ["68dd28f4-7644-4848-987d-997c44a1370b"], "aliases": ["Anse Petite Cour"]},
    {"names": ["Corveta Camaquã"], "country": "Brazil", "siteIds": ["3718c036-3eab-4ab5-be83-8fd1cea352f4"], "aliases": ["Camaqua C6"]},
    {"names": ["Blue Cathedral"], "country": "Philippines", "siteIds": ["8311d026-1000-4e98-a5a4-b58a8acdf8ce"], "aliases": ["蓝色大教堂"]},
    {"names": ["Old #12"], "country": "Cayman Islands", "siteIds": ["70f65a4a-8065-44a3-b1bb-929d82250334"], "aliases": ["Old Number 12"]},
    {"names": ["Rodney's Rock"], "country": "Dominica", "siteIds": ["17a6dccf-00ed-4388-88db-f190421cbea6"], "aliases": ["Tarou Point"]},
    {"names": ["L'Abym"], "country": "Dominica", "siteIds": ["f7372386-0e9d-4ae7-b769-78ecb72e817d"], "aliases": ["The Abyss"]},
    {"names": ["Tanjung Gemok"], "country": "Malaysia", "siteIds": ["7ffba48b-4803-42fb-96e6-deb43be7ed14"], "aliases": ["Tanjung Gemuk"]},
    {"names": ["Vietnamese Wreck"], "country": "Malaysia", "siteIds": ["2a2e95b8-437a-4837-a3f1-3587c2e956fe"], "aliases": ["Pasir Tani Wreck"]},
    {"names": ["Vietnamese Wreck"], "country": "Malaysia", "siteIds": ["2a2e95b8-437a-4837-a3f1-3587c2e956fe"], "aliases": ["Pasir Tani"]},
    {"names": ["Torpedo Alley"], "country": "Indonesia", "siteIds": ["976cc7de-b664-4284-81c4-bd55bbf2c261"], "aliases": ["Torpedo Point"]},
    {"names": ["Perpendicular Wall"], "country": "Australia", "siteIds": ["28f54cd4-96d0-4246-b811-e8991f1f989f"], "aliases": ["Perp Wall"]},
    {"names": ["Pufana"], "country": "French Polynesia", "siteIds": ["b216b07a-ae3a-4e57-b58c-6d9415b17b6b"], "aliases": ["Pufana Reef"]},
    {"names": ["Lonsdale Wall"], "country": "Australia", "siteIds": ["f828d497-18f1-445b-ba3c-09519f42b0e9"], "aliases": ["Lonsdale Wall Deep"]},
    {"names": ["Foggy Reef"], "country": "Australia", "siteIds": ["3f21c892-0f05-4814-a899-70f3fbb0c7c3"], "aliases": ["Lonsdale Wall - Foggy Reef"]},
    {"names": ["Mount Mutiny (Hi8)"], "country": "Fiji", "siteIds": ["0808b6f0-c532-4d16-b82f-1993b982df06"], "aliases": ["Hi 8"]},
    {"names": ["Great White Wall"], "country": "Fiji", "siteIds": ["123df416-a23d-44a8-bd0d-2caa6e9a9cde"], "aliases": ["White Wall"]},
    {"names": ["Blue MaoMao Arch"], "country": "New Zealand", "siteIds": ["79aac375-3294-4612-a0fa-25087963eaf6"], "aliases": ["蓝毛茂拱门"]},
    {"names": ["Serpent Rock"], "country": "New Zealand", "siteIds": ["7f2cbdb6-c554-4c23-90af-24bc8fad3b24"], "aliases": ["Kaka Rock"]},
    {"names": ["Matts Crack"], "country": "New Zealand", "siteIds": ["c98c06a6-4797-40eb-9355-68df78e65478"], "aliases": ["Long Cave"]},
    {"names": ["Barren Arch"], "country": "New Zealand", "siteIds": ["8a6e1340-5969-439c-a299-49c909aecb63"], "aliases": ["Splendid Arch"]},
    {"names": ["Roche Nord"], "country": "France", "siteIds": ["339e0a7c-7cf9-435a-b243-91650dabe063"], "aliases": ["Northern Rock"]},
    {"names": ["Partridge Point"], "country": "South Africa", "siteIds": ["121b1b53-8a5c-44d0-8f18-37db29f017c0"], "aliases": ["Seal Rock"]},
    {"names": ["Pinnacle 1"], "country": "Indonesia", "siteIds": ["64b565d6-85a1-4b77-a187-5623d43d53ee"], "aliases": ["Fishmania"]},
    {"names": ["May Tag"], "country": "Fiji", "siteIds": ["2e28b2cd-c3f5-4548-a4ef-5ec5d9a4efeb"], "aliases": ["Maytag"]},
    {"names": ["Boat Rock"], "country": "Australia", "siteIds": ["ba69a33f-d585-43ae-aa1a-7da737ab0a93"], "aliases": ["The Pinnacle"]},
    {"names": ["Suenos"], "country": "Nicaragua", "siteIds": ["e834422b-92ea-4cff-97b2-5eec7a8c8ff4"], "aliases": ["Sueños"]},
    {"names": ["R.M.S. Maitai"], "country": "Cook Islands", "siteIds": ["42c73b52-e6cd-45ae-8e20-1b908ac4d8d3"], "aliases": ["The Boiler"]},
    {"names": ["No-name Reef"], "country": "Mexico", "siteIds": ["98373e14-2cc6-45a2-a1ba-39e138326b20"], "aliases": ["Yellow House"]},
    {"names": ["Jutten island"], "country": "South Africa", "siteIds": ["ce9d3323-3b40-4b12-bb4f-c042d4d4723d"], "aliases": ["Jutten-eiland"]},
    {"names": ["Grotte aux Dentelles"], "country": "France", "siteIds": ["3b7ebdc4-0b9b-44ea-b8b9-847cc5cab50e"], "aliases": ["Grottes aux Dentelles"]},
    {"names": ["LE SOUS MARIN"], "country": "France", "siteIds": ["1372e397-0ab4-4ff8-b509-ac0be7e2d6e9"], "aliases": ["Rocher du Sous-marin"]},
    {"names": ["Froggy Pond"], "country": "South Africa", "siteIds": ["44b94840-1d4a-49a9-b7e7-eabc6e2a023e"], "aliases": ["Frank's Bay"]},
    {"names": ["Gili Selang"], "country": "Indonesia", "siteIds": ["a4b48b28-ec3c-41fd-9016-02858a31aad7"], "aliases": ["Selang Express"]},
    {"names": ["Gouldens Sinkhole"], "country": "Australia", "siteIds": ["cccdcac2-004c-43a8-b6ce-82b68a999574"], "aliases": ["Gouldens Waterhole"]},
    {"names": ["Gouldens Sinkhole"], "country": "Australia", "siteIds": ["cccdcac2-004c-43a8-b6ce-82b68a999574"], "aliases": ["Gouldens Hole"]},
    {"names": ["LA PERLE"], "country": "France", "siteIds": ["56886fcb-ea23-4029-8500-0626cb26d7e5"], "aliases": ["Îlet la Perle"]},
    {"names": ["LA PERLE"], "country": "France", "siteIds": ["56886fcb-ea23-4029-8500-0626cb26d7e5"], "aliases": ["Rocher de la Perle"]},
    {"names": ["Kapal Wall"], "country": "Indonesia", "siteIds": ["843bf947-1454-483a-95fb-d04d302de14e"], "aliases": ["Kapal Edge"]},
    {"names": ["Cabeço Dois Irmaos"], "country": "Brazil", "siteIds": ["99ec60c3-97da-453d-b776-eae2992fb39f"], "aliases": ["Cabeço 2 Irmãos"]},
    {"names": ["Mae Ilha Caves"], "country": "Brazil", "siteIds": ["d3edeb6d-db22-45d6-94bf-1092ce32b138"], "aliases": ["Caverninhas da Ilha Mãe"]},
    {"names": ["Rena (Wreck)"], "country": "New Zealand", "siteIds": ["011e95b9-5ce2-425f-9f2f-51988d2a6dab"], "aliases": ["MV Rena"]},
    {"names": ["Rip Bank"], "country": "Australia", "siteIds": ["a76c8404-4897-407b-99ae-0de8ccfcbcbf"], "aliases": ["Ripbank"]},
    {"names": ["Plic Mramori"], "country": "Croatia", "siteIds": ["acd524aa-bdf2-46b5-907b-83ed9dcdeb0e"], "aliases": ["Pličina Mramori"]},
    {"names": ["Complejo Aquatico Medellin"], "country": "Colombia", "siteIds": ["7bba5181-ac2d-4556-aa3e-03f1a4fa9d25"], "aliases": ["Complejo Acuático César Zapata"]},
    {"names": ["POINTE LAMARRE"], "country": "France", "siteIds": ["843a9f01-6f9b-402d-8ebd-d09eebccb646"], "aliases": ["Tombant de Coucoune"]},
    {"names": ["POINTE LAMARRE"], "country": "France", "siteIds": ["843a9f01-6f9b-402d-8ebd-d09eebccb646"], "aliases": ["La Coucoune"]},
    {"names": ["Photographer’s Reef"], "country": "South Africa", "siteIds": ["0d8b1c51-e483-44f5-8377-8fc3c84f43f5"], "aliases": ["JJM Reef"]},
    {"names": ["Atlantis Reef Pinnacles"], "country": "South Africa", "siteIds": ["1c7818a8-9634-4ae0-9ec2-857a3e80e0ca"], "aliases": ["Pillars of Hercules"]},
    {"names": ["The village (Babi)"], "country": "Indonesia", "siteIds": ["ac9cccb1-128b-4c89-9878-6e67e75d37d7"], "aliases": ["The Village (Babi South)"]},
    {"names": ["Scoglio a Penna"], "country": "Italy", "siteIds": ["5ccdeec4-dc4c-4dc6-a163-ac1062542f28"], "aliases": ["Scoglio Penna"]},
    {"names": ["Car Pile - Grenada"], "country": "Grenada", "siteIds": ["cf640240-f3d3-455d-bb35-b2c2adc8c720"], "aliases": ["Car Park Wreck"]},
    {"names": ["Car Pile - Grenada"], "country": "Grenada", "siteIds": ["cf640240-f3d3-455d-bb35-b2c2adc8c720"], "aliases": ["Car Pile Wreck"]},
    {"names": ["Duiker Island"], "country": "South Africa", "siteIds": ["c1a26c3e-16e0-4253-af96-f977b8782724"], "aliases": ["Duikereiland"]},
    {"names": ["Duiker Island"], "country": "South Africa", "siteIds": ["c1a26c3e-16e0-4253-af96-f977b8782724"], "aliases": ["Seal Island"]},
    {"names": ["Hideaway Bay"], "country": "New Zealand", "siteIds": ["9b475dec-74f6-40b5-9d55-d856349d3615"], "aliases": ["Dutchmans Cove"]},
    {"names": ["Ilha Mae / Ponta Sul"], "country": "Brazil", "siteIds": ["303ed67f-6c65-43ee-98c0-01e98be63647"], "aliases": ["Ponta Sul da Ilha Mãe"]},
    {"names": ["Justin’s Caves, Cape Town, South Africa"], "country": "South Africa", "siteIds": ["6d68091e-0b15-444c-832b-6413b7706882"], "aliases": ["Justins"]},
    {"names": ["Bread Loaf"], "country": "Mozambique", "siteIds": ["c2662adb-548e-42d1-a304-1204dc10019d"], "aliases": ["Breadloaf"]},
    {"names": ["Große Steinwand"], "country": "Austria", "siteIds": ["ab640577-3126-4bf6-8d50-eb8f7940617a"], "aliases": ["Grosse Steinwand"]},
    {"names": ["Anna-Maria"], "country": "Sweden", "siteIds": ["dcad4cf4-756a-43a7-9204-b036eeacec79"], "aliases": ["Saltskutan"]},
    {"names": ["Playing Field"], "country": "Cayman Islands", "siteIds": ["eee8209f-189f-42c3-b78c-39f797e70ea3"], "aliases": ["Playing Field Reef"]},
    {"names": ["le sec de la Gabinière"], "country": "France", "siteIds": ["d3b50f47-619e-4797-b9fa-fefd9566d9cf"], "aliases": ["Ilot de la Gabinière - Le sec"]},
    {"names": ["le sec de la Gabinière"], "country": "France", "siteIds": ["d3b50f47-619e-4797-b9fa-fefd9566d9cf"], "aliases": ["Gabinière Sud"]},
    {"names": ["Shark Bowl"], "country": "United States", "siteIds": ["d009e5f6-e963-4397-b973-3aad0d279dcf"], "aliases": ["Coral Bowl"]},
    {"names": ["B-29 Aircraft Wreck"], "country": "United States", "siteIds": ["b99755f3-cdb0-4c0c-b6e5-80652a8bea19"], "aliases": ["Aguadilla Superfortress Wreck"]},
    {"names": ["Papua Passage"], "country": "Cook Islands", "siteIds": ["6b605a4e-a98b-4e64-867c-7bcb39e72516"], "aliases": ["Avaiti"]},
    {"names": ["Ho Mei III - Salvador"], "country": "Brazil", "siteIds": ["a40b9037-4cea-4781-8b76-9911dbb40ff9"], "aliases": ["Chinês"]},
    {"names": ["Olang Sanctuary"], "country": "Philippines", "siteIds": ["c804d268-098d-4d18-8a6c-aa8163c0e34e"], "aliases": ["Olang Marine Sanctuary"]},
    {"names": ["Otter Cove"], "country": "United States", "siteIds": ["cbbfdbaa-48fd-4f0a-9706-4c965015a110"], "aliases": ["Otter Cove Beach"]},
    {"names": ["McCurly’s Wall"], "country": "Cayman Islands", "siteIds": ["2ccf9fff-cc6a-414e-bdff-f109893b630c"], "aliases": ["McCurley's Wall"]},
    {"names": ["Jardins de Sainte-Luce"], "country": "France", "siteIds": ["62e1c978-eda2-41c3-a923-08114ef0cdb1"], "aliases": ["Jardin Tropical"]},
    {"names": ["Balboa (Wreck)"], "country": "Cayman Islands", "siteIds": ["797966f8-2c0b-4751-80d8-fcc3f47855f9"], "aliases": ["Wreck of the Balboa"]},
    {"names": ["bargibenti"], "country": "New Caledonia", "siteIds": ["ea52396a-a9a2-484f-aea7-2ccec8abc887"], "aliases": ["Bargibanti"]},
    {"names": ["Dolphin (Wreck)"], "country": "Dominican Republic", "siteIds": ["f21861e6-dc1e-4a30-8584-99902090ae38"], "aliases": ["Dolphin Wreck at Portillo"]},
    {"names": ["Ilet Requin"], "country": "France", "siteIds": ["b43b0aae-d6a2-4b03-a953-8c639e0d611d"], "aliases": ["Sec de Anse Marcel"]},
    {"names": ["Ilet Requin"], "country": "France", "siteIds": ["b43b0aae-d6a2-4b03-a953-8c639e0d611d"], "aliases": ["Marcel Rock"]},
    {"names": ["SAS Goodhope, wreck"], "country": "South Africa", "siteIds": ["3e25e96e-cac7-4cd0-a50a-6b257366de7a"], "aliases": ["HMSAS Good Hope"]},
    {"names": ["SAS Goodhope, wreck"], "country": "South Africa", "siteIds": ["3e25e96e-cac7-4cd0-a50a-6b257366de7a"], "aliases": ["SAS Good Hope"]},
    {"names": ["Passe en S #10"], "country": "France", "siteIds": ["dda0e90a-cdd8-42e0-9fb8-fa525baa095a"], "aliases": ["passe en S bouée 10"]},
    {"names": ["Tamarindo Chico"], "country": "United States", "siteIds": ["2266857f-d3a7-4d0c-bd1c-62a210fb9c2b"], "aliases": ["Chico Tamarindo"]},
    {"names": ["Tamarindo Chico"], "country": "United States", "siteIds": ["2266857f-d3a7-4d0c-bd1c-62a210fb9c2b"], "aliases": ["Punta Tamarindo Chico"]},
    {"names": ["Passe en S #7B"], "country": "France", "siteIds": ["909b1584-7d19-4512-84a8-80e19361c79b"], "aliases": ["passe en S bouée 7b"]},
    {"names": ["Kolo-Kolo"], "country": "Indonesia", "siteIds": ["1f8b64bb-ad02-4572-b52e-b54081d4b260"], "aliases": ["Kolo Kolo"]},
    {"names": ["Bucca Quay"], "country": "Honduras", "siteIds": ["b89b6f68-ba88-431f-843f-1f5ae5e73e40"], "aliases": ["West End Wall"]},
    {"names": ["Boka Bartol (1)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["9fe4a1d5-35c8-45a9-b8b5-c2a8de5f7099"], "aliases": ["Boca Bartol"]},
    {"names": ["Village - Dominica"], "country": "Dominica", "siteIds": ["b408fbbf-5fb9-4c62-b6ee-14fdd9a9594f"], "aliases": ["The Village"]},
    {"names": ["Buccaneer Molinere Bay (Wreck)"], "country": "Grenada", "siteIds": ["422e268e-e64f-48bd-bf06-e79122304a37"], "aliases": ["Molinere Buccaneer Wreck"]},
    {"names": ["Les Tinyes"], "country": "France", "siteIds": ["ba691fdc-6d44-4027-9e81-896feac8c141"], "aliases": ["Les Tyñes"]},
    {"names": ["Les Tinyes"], "country": "France", "siteIds": ["ba691fdc-6d44-4027-9e81-896feac8c141"], "aliases": ["Les Tignes"]},
    {"names": ["GEM STONE BAY"], "country": "New Zealand", "siteIds": ["51d4dd30-ac2e-4321-9f54-81182702d6e1"], "aliases": ["Waimata"]},
    {"names": ["GEM STONE BAY"], "country": "New Zealand", "siteIds": ["51d4dd30-ac2e-4321-9f54-81182702d6e1"], "aliases": ["Gemstone Bay"]},
    {"names": ["Passe en S #9"], "country": "France", "siteIds": ["2506a25a-1601-4a8b-9fa0-767479b4fd13"], "aliases": ["Bouée N° 9 de la Passe en S"]},
    {"names": ["Turtle Bommie"], "country": "Australia", "siteIds": ["f63f30d5-11e0-4d7f-9373-eb72c4931c2b"], "aliases": ["Turtle Bommie Lady Musgrave Lagoon"]},
    {"names": ["HMNZS Waikato wreck"], "country": "New Zealand", "siteIds": ["6dad8762-878c-46a1-a1e7-609d44a53a7c"], "aliases": ["HMNZSワイカト"]},
    {"names": ["Ilha do Farol - Alcatrazes"], "country": "Brazil", "siteIds": ["f7814bbc-31f8-463b-bfe2-4805a7cab3d9"], "aliases": ["Ilha do Porto Alcatrazes"]},
    {"names": ["E6"], "country": "Fiji", "siteIds": ["16ad6650-2a7e-40b1-85b1-c5382a1fccda"], "aliases": ["E-6"]},
    {"names": ["Cleanerfish Bay"], "country": "New Zealand", "siteIds": ["a02d1ffc-8bef-47f2-9120-55b50cf3fae9"], "aliases": ["Cleaner Fish Bay"]},
    {"names": ["Bushy East Channel"], "country": "Maldives", "siteIds": ["94671006-0ecc-4182-8fde-02a31a01f2da"], "aliases": ["Bushy East Corner"]},
    {"names": ["PAUL THOMAS"], "country": "Guadeloupe", "siteIds": ["86dd8cb6-dabf-415b-a5ce-7777a9cb6155"], "aliases": ["Anse Thomas", "Anse Paul Thomas"]},
    {"names": ["Cabeço Submarino"], "country": "Brazil", "siteIds": ["1279af45-3cc5-4016-83c4-e309f5b3984e"], "aliases": ["Cabeço do Submarino"]},
    {"names": ["Heron Island - Gorgonia Hole"], "country": "Australia", "siteIds": ["51f4e1ce-9cc7-4851-88b6-b91c4df1ab2e"], "aliases": ["Gorgonian Hole"]},
    {"names": ["Tarpon Bridge"], "country": "Curaçao", "siteIds": ["f7fc9f79-7c13-460d-bc49-e0c970944bdf"], "aliases": ["Love Cave"]},
    {"names": ["Slipway Saldanha Bay"], "country": "South Africa", "siteIds": ["5766eb61-54ac-4de2-bd95-3f8566c402c2"], "aliases": ["Slipways Restaurant Wreck"]},
    {"names": ["Nassimo Thila"], "country": "Maldives", "siteIds": ["6f9e026a-a913-491f-8cec-e1ca4977666e"], "aliases": ["Paradise Rock", "Virgin Reef"]},
    {"names": ["Passe en S #6"], "country": "France", "siteIds": ["271c35a0-7250-48e3-b3b8-ef8317eff010"], "aliases": ["Passe en S bouée 6"]},
    {"names": ["Récif Prony"], "country": "New Caledonia", "siteIds": ["8961ba5d-f60c-4171-973b-4a6ec051dfcb"], "aliases": ["Récif de Prony"]},
    {"names": ["Taurikura"], "country": "New Zealand", "siteIds": ["fa0dfd6a-2d0a-4701-8489-d35398fea0ef"], "aliases": ["Taurikura Bay"]},
    {"names": ["Sec à Zitte"], "country": "France", "siteIds": ["4098b3b1-96bf-4cd5-8d69-610df5940284"], "aliases": ["Sec Zitte"]},
    {"names": ["La Piscine de Salomon"], "country": "France", "siteIds": ["331b3506-1b00-4c19-951d-4ced4b17a8ef"], "aliases": ["Cap Salomon La Piscine"]},
    {"names": ["Dream House"], "country": "Fiji", "siteIds": ["4e56c7b7-797c-4f84-9608-b02c07688bef"], "aliases": ["Dreamhouse"]},
    {"names": ["Reliance"], "country": "Brazil", "siteIds": ["e94328ad-feae-43c0-8ffc-28c3a920244d"], "aliases": ["Naufrágio Reliance"]},
    {"names": ["Jackfish Alley"], "country": "Egypt", "siteIds": ["15c7b234-fa58-487b-97bd-dd08536dc865"], "aliases": ["Stingray Alley"]},
    {"names": ["SS Coogee, wreck"], "country": "Australia", "siteIds": ["026e1c44-0137-475a-9549-be1764a0fade"], "aliases": ["HMAS Coogee", "Lancashire Witch"]},
    {"names": ["MV Antipolis, wreck"], "country": "South Africa", "siteIds": ["07450dee-5a25-4cd6-837a-0f537232ea6e"], "aliases": ["Épave Antipolis"]},
    {"names": ["EN1"], "country": "Mozambique", "siteIds": ["e238642d-2c54-4db5-ae4f-bbc7f0a1abf5"], "aliases": ["EN1 Reef"]},
    {"names": ["Piège à Requins"], "country": "France", "siteIds": ["ef7d69e6-535e-4548-a979-63685e0adcd2"], "aliases": ["Piège à Requin"]},
    {"names": ["Nakanoshima Channel"], "country": "Japan", "siteIds": ["19bdd41c-6c9e-4553-94bb-363fd3e14805"], "aliases": ["中之島チャネル"]},
    {"names": ["Nakanoshima Channel"], "country": "Japan", "siteIds": ["19bdd41c-6c9e-4553-94bb-363fd3e14805"], "aliases": ["中の島チャネル"]},
    {"names": ["Eidsvold  Wreck"], "country": "Australia", "siteIds": ["df14e21c-4459-4df7-988d-1cecc623fdfd"], "aliases": ["アイドスボルド・レック"]},
    {"names": ["Pam Liguria, wreck"], "country": "Chile", "siteIds": ["54bbaaba-a355-4d44-8caa-8212d4275f5a"], "aliases": ["naufragio PAM Liguria"]},
    {"names": ["French Cap Pinnacle"], "country": "United States", "siteIds": ["40ffd21c-8dfe-40c2-a0c5-5398e7366f35"], "aliases": ["French Cap", "Frenchman's Cap"]},
    {"names": ["Manta"], "country": "Mozambique", "siteIds": ["392346f9-fbef-4e5e-b4f0-31fb6123318c"], "aliases": ["マンタリーフ"]},
    {"names": ["Manta"], "country": "Mozambique", "siteIds": ["392346f9-fbef-4e5e-b4f0-31fb6123318c"], "aliases": ["Manta Reef"]},
    {"names": ["Flat Rock - The Pinnacles"], "country": "Australia", "siteIds": ["c3b1a403-a186-437a-90fa-05f33a2336e1"], "aliases": ["The Pinnacles - Flat Rock"]},
    {"names": ["Lighthouse Reef - Cayman Brac"], "country": "Cayman Islands", "siteIds": ["54c89b12-1448-41b6-b9fd-907efdf50302"], "aliases": ["Lighthouse Reef"]},
    {"names": ["Jetty House Reef Naya Gawana"], "country": "Indonesia", "siteIds": ["05ba2975-dad0-440e-8d85-aa9fdc80a5f4"], "aliases": ["Naya Gawana House Reef"]},
    {"names": ["La grotte Sakatia"], "country": "Madagascar", "siteIds": ["49fe7f4c-78c8-4145-a9ea-c4254992a13e"], "aliases": ["Grotte Sakatia"]},
    {"names": ["Double Cove Marine Reserve"], "country": "New Zealand", "siteIds": ["19f34208-3016-4881-ba2b-37f3481ac116"], "aliases": ["Double Cove Fish Reserve"]},
    {"names": ["Bodekull"], "country": "Sweden", "siteIds": ["4ee241c9-8ce9-40d7-a2ab-0ef543eeb7db"], "aliases": ["Dalarövraket"]},
    {"names": ["Gee Six"], "country": "Fiji", "siteIds": ["d31d4446-e319-4848-a7cc-79578cd51b07"], "aliases": ["Gee-Six"]},
    {"names": ["Stone Henge"], "country": "Fiji", "siteIds": ["fbc5cb72-a8be-4b0f-b12e-eae2b25073ae"], "aliases": ["Stonehenge"]},
    {"names": ["Grotta azzurra"], "country": "Italy", "siteIds": ["0adc49fd-e3a0-4a07-8a7f-c48fcab397a1"], "aliases": ["Blue Grotto"]},
    {"names": ["St. Andrews Lakes"], "country": "United Kingdom", "siteIds": ["cc5653b7-1d3d-4644-8460-0085ab803800"], "aliases": ["St Andrew's Lakes", "St Andrew’s Lakes", "St Andrews Lake"]},
    {"names": ["Tamarindo Beach"], "country": "United States", "siteIds": ["54890cde-c0b6-435a-970e-998f2575fbb9"], "aliases": ["Playa Tamarindo"]},
    {"names": ["RIVIERE CLAIRE"], "country": "France", "siteIds": ["2afa5a9f-7bb8-459f-ad0f-cf8a72d964f9"], "aliases": ["La Rivière Claire"]},
    {"names": ["Roches Merveilleuses"], "country": "France", "siteIds": ["1d36fadd-78e5-4c60-8530-aa2c4b3b045d"], "aliases": ["Les Roches Merveilleuses"]},
    {"names": ["Pallas"], "country": "Cayman Islands", "siteIds": ["cf2c11b5-78fd-41f3-a71d-596db9e242d7"], "aliases": ["Pallas Reef", "Pallas Wreck"]},
    {"names": ["Navarra"], "country": "France", "siteIds": ["9724ec9a-a13e-46b5-ac5b-9d746f0c9a74"], "aliases": ["Épave du Navarra"]},
    {"names": ["Illa de Ses Aligues"], "country": "Spain", "siteIds": ["b56d3c9c-606e-40f1-86e8-738291ad5690"], "aliases": ["Illa de ses Àguiles", "Illa de ses Àligues"]},
    {"names": ["Haji"], "country": "Tanzania, United Republic of", "siteIds": ["c7a41f68-80ce-42f6-a5bd-0986e448e9a9"], "aliases": ["Haji Reef"]},
    {"names": ["Kevs Ledge"], "country": "Mozambique", "siteIds": ["ad31c033-ca89-42d1-a05d-b2f4f5963d5b"], "aliases": ["Kev's Ledge", "Kev’s Ledge"]},
    {"names": ["Jardim dos Corais - Alcatrazes"], "country": "Brazil", "siteIds": ["fde91d3d-2b66-4625-b4e1-27d02d69d5f9"], "aliases": ["Jardim dos Corais"]},
    {"names": ["Lean"], "country": "Indonesia", "siteIds": ["5b787bc6-3950-455d-bc74-39be79e926f5"], "aliases": ["Lean Wall"]},
    {"names": ["Promenade Point"], "country": "New Zealand", "siteIds": ["29a93b8f-f027-499f-bc55-035ec49545ce"], "aliases": ["Kai Iwi Lakes - Promenade Point"]},
    {"names": ["Tori Ike"], "country": "Japan", "siteIds": ["9bd11621-e257-4259-a957-feecbfb97bf1"], "aliases": ["通池"]},
    {"names": ["Tori Ike"], "country": "Japan", "siteIds": ["9bd11621-e257-4259-a957-feecbfb97bf1"], "aliases": ["通り池", "Tori-ike"]},
    {"names": ["Meros"], "country": "Costa Rica", "siteIds": ["0ad72c8a-3916-4cdb-815f-c01448be8a79"], "aliases": ["Los Meros"]},
    {"names": ["Scorpion Rock Praslin"], "country": "Seychelles", "siteIds": ["83d59b5f-69c4-4d80-a0c3-3ca17029020a"], "aliases": ["Scorpion Rock"]},
    {"names": ["Flag Pole Little St James"], "country": "United States", "siteIds": ["c5515b7a-e085-41c0-8f12-d94676c51758"], "aliases": ["Flag Pole (Little St. James)"]},
    {"names": ["Roche Roube"], "country": "France", "siteIds": ["d8097578-6d1e-4ead-853d-bcd401d485f7"], "aliases": ["Sec de Roche Roube"]},
    {"names": ["Severence Wreck - Lady Elliot Island"], "country": "Australia", "siteIds": ["aef2246b-5089-452c-b1a5-d93df4689839"], "aliases": ["Severance", "Severance Wreck", "Severance Shipwreck", "The Severance"]},
    {"names": ["Punta Catalina"], "country": "Costa Rica", "siteIds": ["e2c51724-5e15-4f83-8eb1-604d50283222"], "aliases": ["Punta Catalinas"]},
    {"names": ["Anse 3 airs"], "country": "France", "siteIds": ["53d408ca-e2f1-42e6-b67a-be334e74090c"], "aliases": ["Anse Trois Airs", "3 Airs Cove"]},
    {"names": ["Sea Venture"], "country": "France", "siteIds": ["d6146c3a-5fd1-4db4-ab8f-05d881b2b392"], "aliases": ["Sea-Venture", "Épave du Sea Venture", "L'épave du Sea Venture"]},
    {"names": ["Xlighter 127"], "country": "Malta", "siteIds": ["4cc4ab7d-7ca8-4a69-bbdc-59fbe1c0576f"], "aliases": ["卡洛里塔"]},
    {"names": ["X127 Lighter / Carolita"], "country": "Malta", "siteIds": ["bfba9326-40f1-45a5-ba05-0aa8260abe30"], "aliases": ["卡洛里塔"]},
    {"names": ["Carolita X127"], "country": "Malta", "siteIds": ["e4efe498-39c9-47da-ac0c-50878df7ce49"], "aliases": ["卡洛里塔"]},
    {"names": ["Carolita"], "country": "Malta", "siteIds": ["964cf450-47cc-4822-a2d1-0d99707830bb"], "aliases": ["卡洛里塔"]},
    {"names": ["Xlighter 127"], "country": "Malta", "siteIds": ["4cc4ab7d-7ca8-4a69-bbdc-59fbe1c0576f"], "aliases": ["X127 Lighter", "X127", "Carolita", "Coralita"]},
    {"names": ["X127 Lighter / Carolita"], "country": "Malta", "siteIds": ["bfba9326-40f1-45a5-ba05-0aa8260abe30"], "aliases": ["X127 Lighter", "X127", "Carolita", "Coralita"]},
    {"names": ["Carolita X127"], "country": "Malta", "siteIds": ["e4efe498-39c9-47da-ac0c-50878df7ce49"], "aliases": ["X127 Lighter", "X127", "Carolita", "Coralita"]},
    {"names": ["Carolita"], "country": "Malta", "siteIds": ["964cf450-47cc-4822-a2d1-0d99707830bb"], "aliases": ["X127 Lighter", "X127", "Carolita", "Coralita"]},
    {"names": ["Maggie’s Maze"], "country": "Cayman Islands", "siteIds": ["a4afa7f5-b30a-4d00-afd8-cfc81e600476"], "aliases": ["Maggie's Maze"]},
    {"names": ["Brenneckes Ledge"], "country": "United States", "siteIds": ["b10d83ab-ab3b-446b-9739-d73816be2938"], "aliases": ["Brennecke's Ledge", "Brennecke’s Ledge"]},
    {"names": ["Togo"], "country": "France", "siteIds": ["fe1351dc-708d-4052-8717-e5358c457e3d"], "aliases": ["Ville de Valence", "Le Togo Ville de Valence"]},
    {"names": ["SS Maori, wreck"], "country": "South Africa", "siteIds": ["41f5504f-8ef1-480a-8cad-ce0ca8f0b2e3"], "aliases": ["The Maori", "Maori wreck"]},
    {"names": ["Gotham, Sodwana Bay"], "country": "South Africa", "siteIds": ["ebe1238a-d13e-4770-842a-677bddf78a4f"], "aliases": ["Gotham City", "Gotham Five Mile"]},
    {"names": ["Bobby’s Wall"], "country": "Philippines", "siteIds": ["d701f2be-24db-4638-b0c7-ea87fa10cd6a"], "aliases": ["Bobby's Wall"]},
    {"names": ["Dolphins Den"], "country": "Honduras", "siteIds": ["e5ef8950-2683-48f8-ac8a-55257467cb42"], "aliases": ["Dolphin's Den", "Dolphin’s Den"]},
    {"names": ["East Chute"], "country": "Cayman Islands", "siteIds": ["d4b5619b-45f9-4145-a389-6e7b042e7702"], "aliases": ["Cayman Mariner"]},
    {"names": ["San Francisco Maru"], "country": "Micronesia, Federated States of", "siteIds": ["c457ff13-a1c4-4ac2-a3c1-c38a907c7241"], "aliases": ["三藩丸", "サンフランシスコ丸", "桑港丸"]},
    {"names": ["Jack McKenny’s Canyons"], "country": "Cayman Islands", "siteIds": ["b99aba3f-57ef-4701-805c-7d5905a7ca28"], "aliases": ["Jack McKenney's Canyons", "Jack McKenney’s Canyons", "Jack McKenny's Canyon", "Jack McKenny’s Canyon", "McKenny's Wall", "McKenny’s Wall"]},
    {"names": ["L’Abym North"], "country": "Dominica", "siteIds": ["116f73e8-4527-4bac-8c7f-f65b84cd1178"], "aliases": ["L'Abym North"]},
    {"names": ["Old Issac’s"], "country": "Cayman Islands", "siteIds": ["38bd3bdd-90cd-486b-a10c-e705b03b711d"], "aliases": ["Old Isaac's", "Old Isaac’s"]},
    {"names": ["Barbara Beach"], "country": "Curaçao", "siteIds": ["6e04e065-6613-40bd-8c62-784dc3a001eb"], "aliases": ["Santa Barbara Beach"]},
    {"names": ["Ilot Bandrelé #2"], "country": "France", "siteIds": ["fcd87c5b-5f9b-4536-8deb-caf15935b971"], "aliases": ["Îlot Bandrélé 2", "Ilot Bandrele 2"]},
    {"names": ["KAY MARECHAL"], "country": "France", "siteIds": ["ccaed80e-35e7-4bd0-a014-12458dcea339"], "aliases": ["Caye Maréchal", "Caye Marechal", "Vron Vron", "Le Vron Vron"]},
    {"names": ["Kankirixche Cenote"], "country": "Mexico", "siteIds": ["7598489f-313b-44ad-bd23-c6a65cffe936"], "aliases": ["Cenote Kankirixche", "Cenote Kankirixché"]},
    {"names": ["Shacks Beach"], "country": "United States", "siteIds": ["e8c6326c-f7db-44f4-94b4-2a69ef8eb608"], "aliases": ["Shacks Beach Blue Hole", "Shacks Beach Caverns", "Cueva de Kike Bravo", "Blue Hole"]},
    {"names": ["Caster Rock"], "country": "South Africa", "siteIds": ["863e5ef7-ee3c-4936-9bb7-ebc4ad7364ac"], "aliases": ["Castor Rock"]},
    {"names": ["Devil’s Dropoff"], "country": "Australia", "siteIds": ["d96d12a3-e1b8-4e65-8bd3-5e0e630cf72a"], "aliases": ["Devil's Dropoff", "Devil's Drop Off", "Devil’s Drop Off", "Devils Drop Off"]},
    {"names": ["La Caye D Obian"], "country": "France", "siteIds": ["369799fe-20d9-4afb-97c1-f33c91978f00"], "aliases": ["Caye d'Obian", "Caye d’Obian", "La Caye d'Obian", "La Caye d’Obian", "Le fer à cheval"]},
    {"names": ["No Man’s Land"], "country": "Fiji", "siteIds": ["4dda8995-5251-427d-a3db-2bc6f915df05"], "aliases": ["No Man's Land"]},
    {"names": ["Pubudus Playground"], "country": "Honduras", "siteIds": ["4c1ad67f-0fca-4a73-b207-b777ba83bb87"], "aliases": ["Pubudu's Playground", "Pubudu’s Playground"]},
    {"names": ["Punta Soldado"], "country": "United States", "siteIds": ["e43c61f7-e694-49b2-bd2c-4dcb2713b328"], "aliases": ["Punta del Soldado", "Playa Punta Soldado"]},
    {"names": ["Willy‘s Rock"], "country": "Seychelles", "siteIds": ["5e04ffbb-1049-4110-8e37-7e0a538edc0d"], "aliases": ["Willy's Rock", "Willy’s Rock", "Willy's Rocks", "Willie's Rock", "Willie's Rocks", "Willie’s Rock"]},
    {"names": ["Nancy’s Cup of Tea"], "country": "Cayman Islands", "siteIds": ["549ebe75-b659-42d8-aa81-f5dffb3d8424"], "aliases": ["Nancy's Cup of Tea", "Magic Roundabout"]},
    {"names": ["Lucy’s Wall"], "country": "Australia", "siteIds": ["71762f7c-48af-4e5f-a907-2fb84026f9dd"], "aliases": ["Lucy's Wall", "Lucys Wall", "Training Wall", "Lucy's Breakwall"]},
    {"names": ["Valan’s Wall, Carriacou"], "country": "Grenada", "siteIds": ["7a96cf06-b16d-4a80-896e-fde21a3a4062"], "aliases": ["Valan's Wall"]},
    {"names": ["Fessej Rock"], "country": "Malta", "siteIds": ["e8f0b7a3-1cc4-4a92-a31b-572e2b901cae"], "aliases": ["Black Rock", "Il-Ġebla tal-Fessej"]},
    {"names": ["Sandy Island Drift, Carriacou"], "country": "Grenada", "siteIds": ["2505b6f5-9646-4051-bf9b-7577638d9d3f"], "aliases": ["Sandy Island Lighthouse", "Divers Surprise", "Diver's Surprise", "Diver’s Surprise"]},
    {"names": ["Passe Saziley"], "country": "France", "siteIds": ["d069ca24-d776-4273-8b00-d98ca9268d84"], "aliases": ["Passe de Saziley"]},
    {"names": ["Alcatraz"], "country": "Philippines", "siteIds": ["a1b8236d-59af-4ccf-b6dd-6faebdf52e59"], "aliases": ["Alcatraz Reef", "Alcatraz Rock"]},
    {"names": ["Quecy"], "country": "France", "siteIds": ["e82a0715-ff3a-438b-b988-214bd417cf3f"], "aliases": ["Pointe Quecy", "La Pointe Quecy"]},
    {"names": ["House Reef Selayar Dive Resort"], "country": "Indonesia", "siteIds": ["70e98b9b-f294-49ec-8747-11dacb0eb189"], "aliases": ["Selayar Dive Resort House Reef"]},
    {"names": ["Anau"], "country": "French Polynesia", "siteIds": ["546c34f1-6223-4bfc-a3d0-117f57f1efa6"], "aliases": ["阿瑙"]},
    {"names": ["Tapu"], "country": "French Polynesia", "siteIds": ["872d5d92-24a9-49b0-bb3a-b940dfaf3eb3"], "aliases": ["塔普"]},
    { names: ["Vallée aux Mérous"], country: "France", siteIds: ["5ba75849-1b56-43bd-bcf0-e5c369eed2ce"], aliases: ["Grouper Valley"] },
    { names: ["Wonder Reef On The Gold Coast"], country: "Australia", siteIds: ["452145c6-e431-49f7-a3fe-d0eeb5da28e0"], aliases: ["Gold Coast Dive Attraction"] },
    {"names": ["Kelly’s Caverns"], "country": "Cayman Islands", "siteIds": ["6d3cbdff-fa5e-4967-8382-ad146f484780"], "aliases": ["Kelly's Caverns"]},
    {"names": ["KORAPUKI"], "country": "New Zealand", "siteIds": ["d3d6109f-7d99-43ff-8928-bcfb70a8b4c5"], "aliases": ["Rabbit Island", "Korapuki Island"]},
    {"names": ["Raunglap"], "country": "Mauritius", "siteIds": ["59e0653d-5cf8-428d-9502-8f18b72d5ae5"], "aliases": ["Ruang Lap", "Ruang Lap Wreck", "Épave de Ruang Lap"]},
    {"names": ["Isla Frijoles"], "country": "Panama", "siteIds": ["4785405b-e6bf-4e7f-a99b-46b9205d0aaf"], "aliases": ["Frijoles Island"]},
    {"names": ["Passe en S #3"], "country": "France", "siteIds": ["50c18c63-9af7-44b5-8bac-1cf05894c71a"], "aliases": ["Passe en S bouée 3"]},
    {"names": ["L'arbre Mort"], "country": "France", "siteIds": ["08bc5fc9-1572-4661-a47c-9fc9e624f2f8"], "aliases": ["Tombant de l'Arbre Mort", "Tombant de l’Arbre Mort"]},
    {"names": ["Cannibal Rock Komodo"], "country": "Indonesia", "siteIds": ["f0b469bb-5a8c-4456-a13a-77fb7a4c81fc"], "aliases": ["食人岩"]},
    {"names": ["Craters Edge"], "country": "Dominica", "siteIds": ["47b4d66b-5368-403c-9399-14234ff77245"], "aliases": ["Crater's Edge", "Crater’s Edge", "Crater's Edge Pinnacle", "Crater’s Edge Pinnacle"]},
    {"names": ["Plantation Pinnacle"], "country": "Fiji", "siteIds": ["9ee3d57c-556c-47d2-9397-15bbc5252b8e"], "aliases": ["Plantation Pinnacles"]},
    {"names": ["Yellow Wall Komodo"], "country": "Indonesia", "siteIds": ["798955f4-0d23-4edd-b742-116b4ae745a0"], "aliases": ["Yellow Wall of Texas", "黄墙", "黃牆"]},
    {"names": ["Les 3 Vallées"], "country": "France", "siteIds": ["52a912ff-062b-4489-a088-8890eaf90efc"], "aliases": ["Les Trois Vallées", "Les Trois-Vallées"]},
    {"names": ["Ponquogue Bridge"], "country": "United States", "siteIds": ["43e3a046-869d-4a8e-b03d-a2216d5040d7"], "aliases": ["Old Ponquogue Bridge", "Old Ponquogue Bridge Marine Park"]},
    {"names": ["Puri Jati"], "country": "Indonesia", "siteIds": ["6c07420d-1958-4f0c-9f30-c7c504685e87"], "aliases": ["PJ", "Puri Jati Secret Bay", "プリジャティ"]},
    {"names": ["Cerro Gordo Beach"], "country": "United States", "siteIds": ["ccad5d7a-39b7-41cd-9af9-66ef3a176e2d"], "aliases": ["Playa Cerro Gordo", "Balneario de Cerro Gordo", "Balneario Cerro Gordo"]},
    {"names": ["Bird Rock"], "country": "New Zealand", "siteIds": ["51a14a49-ef28-4cef-8bdf-37fd3b61f16f"], "aliases": ["Mahenotapuku", "Mahenotapuku Rock", "Mahenutapuku Rock"]},
    {"names": ["Tugboat Boris (Wreck)"], "country": "Grenada", "siteIds": ["295dc8a5-c1d7-401c-918a-d127b8d540a8"], "aliases": ["Boris Wreck", "Boris Shipwreck"]},
    {"names": ["A World Adrift Underwater Sculpture Park"], "country": "Grenada", "siteIds": ["3659a573-ae5b-47f1-bb0e-476d119c9f42"], "aliases": ["Un mundo a la deriva", "Parque de esculturas submarinas Un mundo a la deriva"]},
    {"names": ["Yulliet Kecil"], "country": "Indonesia", "siteIds": ["98dbe63e-a276-419e-b1a6-d1bb3f3e1664"], "aliases": ["Yilliet Kecil", "Juliet Small"]},
    {"names": ["Double Wreck"], "country": "Netherlands", "siteIds": ["1df6048d-0b3c-4299-a534-529d5de67f6f"], "aliases": ["SE-501", "SE 501"]},
    {"names": ["The Caves - Acapulco"], "country": "Mexico", "siteIds": ["41c27335-9d53-4c27-b1d3-0b5e049b25ff"], "aliases": ["Las Cuevas"]},
    {"names": ["Devils Point"], "country": "New Zealand", "siteIds": ["5c312004-d77c-43f6-b489-5b1b633b7768"], "aliases": ["Devil's Point", "Devil’s Point"]},
    {"names": ["Fenda Jorge Grego"], "country": "Brazil", "siteIds": ["434a6bbd-6d60-467c-ac44-addf2878b981"], "aliases": ["Fenda de Jorge Grego", "Ilha de Jorge Grego - Fenda"]},
    {"names": ["Ever Propérity"], "country": "New Caledonia", "siteIds": ["9cd6f7a9-76b3-4939-ab12-e13601594d75"], "aliases": ["Ever Prosperity", "Ever Prosperity wreck", "Épave Ever Prosperity"]},
    {"names": ["Barwon Banks"], "country": "Australia", "siteIds": ["6a393560-eeb9-4c82-a373-32396ae2fc4f"], "aliases": ["The Banks", "Barwon Bank"]},
    {"names": ["San Dimitri Point"], "country": "Malta", "siteIds": ["18104a19-4be8-4314-99b2-6746a58540fb"], "aliases": ["Il-Ponta ta' San Dimitri", "Il-Ponta ta’ San Dimitri", "Tirxa", "Dimitri Point"]},
    {"names": ["Historic Dive Wreck Clan Mc William"], "country": "Tonga", "siteIds": ["5184133f-b387-447d-b7c3-cb2f5f2108b7"], "aliases": ["Clan MacWilliam", "Clan MacWilliam Wreck", "Clan McWilliam", "Clan McWilliam Wreck"]},
    {"names": ["La Jetée, Carriacou"], "country": "Grenada", "siteIds": ["e5806ad9-d858-46cd-b6ec-fab950d7ede0"], "aliases": ["Hillsborough Jetty", "Jetty Hillsborough", "Le Jettois"]},
    {"names": ["Cement Plant"], "country": "Barbados", "siteIds": ["548eaa4c-9027-421e-b8bd-f29b5415dfd2"], "aliases": ["Cement Plant Pier", "Cement Pier", "Cement Works"]},
    {"names": ["Fausse Passe de Paea"], "country": "French Polynesia", "siteIds": ["62e6ff5a-78b4-4df2-b55b-c82c9337b026"], "aliases": ["Passe du Gouverneur", "Fausse passe de Paea PK18", "Governor's Pass", "Governor’s Pass"]},
    {"names": ["Chico 2"], "country": "France", "siteIds": ["9454a785-8331-475a-8295-e2683c00cdc5"], "aliases": ["Chico II"]},
    {"names": ["Muelle de Azúcar"], "country": "United States", "siteIds": ["585a0a1d-feac-4176-8dd6-b51baabceb7f"], "aliases": ["Muelle de la Azúcar"]},
    {"names": ["Jack Point"], "country": "Indonesia", "siteIds": ["34ffa766-3ff1-4fcc-b8d0-7c2b6f1022d5"], "aliases": ["Jackpoint"]},
    {"names": ["Whangaumu Bay"], "country": "New Zealand", "siteIds": ["cad13b78-6158-41ec-92fb-9ba51547ecf1"], "aliases": ["Wellingtons Bay", "Wellington's Bay", "Wellington’s Bay"]},
    {"names": ["Cuevas de la luz"], "country": "Spain", "siteIds": ["158c6c01-1b90-4d8d-989c-276619858760"], "aliases": ["Cave of Light", "Caves of Light", "Cueva de la Luz", "Na Coloms", "Ullal de Na Coloms"]},
    { names: ["Charles L. Brown, wreck"], country: "Netherlands", siteIds: ["f9f4ba2d-24fc-4a01-9a2e-a619a145b93c"], aliases: ["Charlie Brown", "查尔斯-布朗"] },
    { names: ["Criminal Rock"], country: "Seychelles", siteIds: ["7ab60f0c-f0e4-4804-92ab-467d0d27db53"], aliases: ["Ros Kriminel"] },
    { names: ["Abu Helal"], country: "Egypt", siteIds: ["47e3d9eb-b8eb-45c2-a106-02c12cb5a213"], aliases: ["Abu Hilal", "Ras Abu Helal", "Little Canyon", "Small Canyon", "アブヘラル", "リトルキャニオン", "رأس أبو هلال"] },
    { names: ["Madelines"], country: "Honduras", siteIds: ["18e290e6-4387-4de2-82f2-a7433c80d812"], aliases: ["Madeline's", "Madeline’s"] },
    { names: ["Riana’s Arch"], country: "Mozambique", siteIds: ["71ecee07-6d71-42e2-b6db-f2891d223402"], aliases: ["Riana's Arch", "Rianna's Ledge", "Rianna’s Ledge"] },
    { names: ["Isla de Paco"], country: "Spain", siteIds: ["c128293d-4d0e-463d-b51a-f8296ff4fd98"], aliases: ["Isla de Adentro"] },
    { names: ["Le tombant de colombier"], country: "France", siteIds: ["f54081d3-1a99-4434-821a-57ca272999d2"], aliases: ["Colombier Wall"] },
    { names: ["Haï Siang, wreck"], country: "France", siteIds: ["4fd3f13c-e5f9-4c0e-957c-483eb1f4d172"], aliases: ["Haï-Siang", "Hai-Siang", "Alcyang", "Épave Haï-Siang"] },
    { names: ["Eagle Nest"], country: "Indonesia", siteIds: ["201e7f18-61e9-4ba5-a5c9-aacb8c440f9d"], aliases: ["Eagle's Nest", "Eagle’s Nest", "Eagles Nest"] },
    { names: ["Heron Island - North Bombie"], country: "Australia", siteIds: ["17b7231b-af65-4040-bd47-4374766c81ec"], aliases: ["North Bommie"] },
    { names: ["Linda's Wall"], country: "Honduras", siteIds: ["551d7d22-572d-4593-9561-984862e0ec7b"], aliases: ["Linda’s Wall"] },
    { names: ["Mwanamochi"], country: "Kenya", siteIds: ["5bd5e724-06c5-4e6a-ac3f-bededd36327d"], aliases: ["Mwanamoji"] },
    { names: ["Bualo"], country: "Indonesia", siteIds: ["1efd9f5c-28d4-4399-b4fa-9adad84864e1"], aliases: ["부알로"] },
    { names: ["Christophers Coral"], country: "Honduras", siteIds: ["8ddfed7f-0ffb-4e06-b798-7007a9ff1d9e"], aliases: ["Christopher's Coral", "Christopher’s Coral"] },
    { names: ["Chunchacah"], country: "Mexico", siteIds: ["6fd776cd-feb6-4914-a584-fc5d0ea93f80"], aliases: ["Chun Chacaab", "Chunchaca", "Chunchacab"] },
    { names: ["Mcgregor’s Bay"], country: "New Zealand", siteIds: ["8948175a-19e1-4b50-b3c4-69047d43f4fc"], aliases: ["McGregors Bay", "McGregor's Bay"] },
    { names: ["Brizare Rock, Mahé"], country: "Seychelles", siteIds: ["ba7e569e-51c8-4a5d-bdc9-b301ec3b552e"], aliases: ["Brissare Rocks", "Brissare Rock", "Brissaire Rock", "Brissaire Rocks"] },
    { names: ["Ben Ben Garden"], country: "Indonesia", siteIds: ["3b657d7b-7fe3-4bfa-b76a-04804fb23612"], aliases: ["Benben Garden"] },
    { names: ["Es Cargol"], country: "Spain", siteIds: ["b00af69f-fe04-4985-9fea-98278f39b8f4"], aliases: ["Escull de Es Cargol", "Es Caragol", "Es Caragol Reef", "El Caracol", "Es Caracol"] },
    { names: ["épave du Umbolt"], country: "New Caledonia", siteIds: ["0cdf9b2d-e4e8-432f-adc4-ece2bd4d382e"], aliases: ["Humboldt", "Épave du Humboldt", "Fukumaru"] },
    { names: ["Flat Rock - Blue Corner"], country: "Australia", siteIds: ["eca72083-f54a-40af-89ad-6ba02a8dcb9d"], aliases: ["Blue Corner"] },
    { names: ["Sakatia reef"], country: "Madagascar", siteIds: ["24791cbf-0bd5-4f26-b704-c8e5e1e30b9d"], aliases: ["Récif de Sakatia"] },
    { names: ["Teavanui Pass"], country: "French Polynesia", siteIds: ["1e7eb985-15e7-4c5a-a8b5-4f9871cd1004"], aliases: ["Passe de Teavanui", "Passe Teavanui"] },
    { names: ["Cabeço da Sapata"], country: "Brazil", siteIds: ["7287bcdd-6365-47ce-94ba-39c889c8e8f4"], aliases: ["Cabeço Sapata"] },
    { names: ["Parcel das Ancoras - Laje de Santos"], country: "Brazil", siteIds: ["aa3b84d7-c1c4-4164-bacc-737563b7befe"], aliases: ["Parcel das Âncoras", "Laje de Santos - Parcel das Âncoras"] },
    { names: ["Playa Shon Mosa"], country: "Curaçao", siteIds: ["572e0e85-d874-4f3c-a0bd-74613ce936c2"], aliases: ["Big Sponge", "Mike's Reef", "Mike’s Reef", "Playa Shon Moso"] },
    { names: ["Phillips Dive Pier"], country: "Cuba", siteIds: ["e7d1802b-08d5-4005-9221-07faeb053d52"], aliases: ["Phillips Park Dive Pier", "Phillip's Dive Park", "Phillip’s Dive Park"] },
    { names: ["Jetty, Tanah Ampo"], country: "Indonesia", siteIds: ["e463b324-9be7-45af-a975-b366d58927ff"], aliases: ["The Jetty", "Bali Jetty", "Tanah Ampo Pier", "Tanah Ampo Jetty"] },
    { names: ["Chorizo"], country: "Dominican Republic", siteIds: ["a1b59fc6-dc49-43b9-9854-5562d8010b79"], aliases: ["Chorizo Reef"] },
    { names: ["Brightledge"], country: "Barbados", siteIds: ["ef4a7793-1ad2-421e-b590-1016ec8b7af1"], aliases: ["Bright Ledge", "Bright Ledge Reef"] },
    { names: ["Maraldi"], country: "Brazil", siteIds: ["f2f541ff-8929-4868-b8bb-f0578463e78c"], aliases: ["Naufrágio Maraldi", "Maraldi Shipwreck"] },
    { names: ["Riko Riko cave"], country: "New Zealand", siteIds: ["96839e09-611f-445a-a549-07884f57eef6"], aliases: ["瑞克瑞克", "瑞克瑞克海穴"] },
    { names: ["Chuckles"], country: "Seychelles", siteIds: ["7eaccada-66e5-4cc0-968a-eeead45aed77"], aliases: ["Chukkles"] },
    { names: ["Steves Ledge"], country: "Mozambique", siteIds: ["78e86706-8c15-43b9-85f3-5e7d35b59690"], aliases: ["Steve's Ledge", "Steve’s Ledge"] },
    { names: ["Enfer de Dante"], country: "France", siteIds: ["b5bb7124-6ab6-45e4-86c5-37017886eaca"], aliases: ["L'Enfer de Dante", "L’Enfer de Dante"] },
    { names: ["Sao Jose"], country: "Brazil", siteIds: ["bb1e811e-8cb5-4969-839b-60d2a33aea73"], aliases: ["São José", "Rebocador São José", "Rebocador Sao Jose"] },
    { names: ["Pasir Timbul"], country: "Indonesia", siteIds: ["e6d8e7af-07f5-4072-93fd-67f54826c857"], aliases: ["廷布爾沙洲", "帕西爾·廷布爾"] },
    { names: ["Ilhas Maricas - Naufragio do Moreno"], country: "Brazil", siteIds: ["5766813c-d2d0-4e0c-bf80-fdbaa75ca79d"], aliases: ["Naufrágio Moreno", "Moreno Wreck"] },
    { names: ["Lago Llopango"], country: "El Salvador", siteIds: ["7f72a73c-6be6-4ee2-9c1b-7726e7c6764a"], aliases: ["Lago Ilopango", "Lago de Ilopango", "Lake Ilopango", "伊洛潘戈湖", "イロパンゴ湖"] },
    { names: ["Deep Blue, Carriacou"], country: "Grenada", siteIds: ["ea3ecfb2-790c-461f-9c1b-aac87294dbd0"], aliases: ["The Deep Blue"] },
    { names: ["Wreck Taman Nukila"], country: "Indonesia", siteIds: ["954b9819-60c1-4733-bf40-7a524e021a9b"], aliases: ["KM Pari Wreck", "KM. Pari Wreck"] },
    { names: ["The Abyss"], country: "Indonesia", siteIds: ["7f7eb093-4600-41b8-b613-880541e602d9"], aliases: ["Abyss"] },
    { names: ["Menara  II"], country: "Indonesia", siteIds: ["9b114ead-e582-4fe8-b269-b32957ca85ca"], aliases: ["Menara 2", "Menara Dua"] },
    { names: ["San Miguel Island"], country: "United States", siteIds: ["503562fc-ad34-423c-aab9-d7791b837923"], aliases: ["圣米格尔岛", "サンミゲル島"] },
    { names: ["2 EL MOTOR"], country: "Spain", siteIds: ["757b9620-fd81-43f8-bfdf-94ecb439266f"], aliases: ["El Motor"] },
    { names: ["Epave du Gustavia (Wreck)"], country: "France", siteIds: ["6df11757-8e41-41d1-9537-481904a4e8bd"], aliases: ["Le Gustavia", "Gustavia Wreck", "Geocanique"] },
    { names: ["Bonnie&#039;s Arch"], country: "Cayman Islands", siteIds: ["43ad4dac-f611-4e07-a211-dd786239d18c"], aliases: ["Bonnie's Arch", "Bonnie’s Arch", "Bonnies Arch"] },
    { names: ["Curtin Artificial Reef"], country: "Australia", siteIds: ["05fb323c-771e-45fd-aa21-62d8d0cc7337"], aliases: ["Curtin Reef"] },
    { names: ["Tribuana Indoor Pool"], country: "Indonesia", siteIds: ["210bc4d7-c227-4a77-983e-cc97f4e1d8e3"], aliases: ["Tribuana Dive Center", "Kolam Selam Tribuana"] },
    { names: ["Stingray Point, Boca Chica"], country: "Dominican Republic", siteIds: ["dfef071f-3d89-4375-a913-ba1da2e08cbc"], aliases: ["Stingray"] },
    { names: ["The Passage"], country: "Indonesia", siteIds: ["4a1b11b2-d545-4989-a020-b958fc6fe704"], aliases: ["Kabui Passage"] },
    { names: ["Laguna Kaan Luum"], country: "Mexico", siteIds: ["2e754a58-13e5-4615-b51c-1bbce1e5ebbd"], aliases: ["Kaan Luum Cenote", "Cenote Kaan Luum"] },
    { names: ["L&#039;Aiguille de Prony."], country: "New Caledonia", siteIds: ["33693089-0093-43e0-97cb-85936efc14a7"], aliases: ["L'Aiguille de Prony", "L’Aiguille de Prony", "Aiguille de Prony", "Prony needle", "Prony's needle", "Prony’s needle", "Needle of Prony"] },
    { names: ["l’arche"], country: "New Caledonia", siteIds: ["81ed64a2-0b2a-4369-87cd-f2b17625f7fd"], aliases: ["l'arche"] },
    { names: ["chira rochi"], country: "France", siteIds: ["0014bb56-bff9-45d8-b075-6eb358239d8c"], aliases: ["Chira Rocchi"] },
    { names: ["Pulau Air Bagian Barat"], country: "Indonesia", siteIds: ["691dd87a-aeed-4a60-9705-f029680277ad"], aliases: ["Barat Pulau Air"] },
    { names: ["Baja Fria"], country: "Spain", siteIds: ["516768bb-0994-41de-9f72-52e227eebfc5"], aliases: ["Baja Fría", "La Baja Fría"] },
    { names: ["Pyramid Rock"], country: "South Africa", siteIds: ["0ac51017-23f7-4276-b1c6-4d20a494e081"], aliases: ["Pyramid Rocks"] },
    { names: ["Iuias"], country: "Brazil", siteIds: ["1aa8d015-99df-4027-9003-7b126f54bffa"], aliases: ["Iúias"] },
    { names: ["Pulau sangiang"], country: "Indonesia", siteIds: ["b1cb660f-0eac-4a11-880a-b32cf8478077"], aliases: ["Pulau Sanghyang", "Sanghyang Island"] },
    { names: ["Lighthouse Komodo"], country: "Indonesia", siteIds: ["8030e0bc-3fa5-4963-b335-7edada481a57"], aliases: ["The Lighthouse (Gili Lawa Laut)", "The Lighthouse"] },
    { names: ["Grande Caye de Sainte-Luce"], country: "France", siteIds: ["ea4275c7-4a49-4ea9-8173-a3e671f45169"], aliases: ["La Grande Caye"] },
    { names: ["La Poza, Xcalak"], country: "Mexico", siteIds: ["8e4b4583-6d2b-48d5-87f3-36b1caa7cc4d"], aliases: ["The Tarpon Hole", "Tarpon Hole"] },
    { names: ["Piste de ski - Mayotte"], country: "France", siteIds: ["07d1958c-ca4a-4ca3-a509-46322b155dc4"], aliases: ["La Piste de Ski"] },
    { names: ["Le Toulonnais"], country: "Monaco", siteIds: ["f05c0468-d90f-4300-b27e-7069591e111a"], aliases: ["Épave du Toulonnais"] },
    { names: ["Conception Rocks"], country: "Seychelles", siteIds: ["88105fe1-fb2e-41a1-b900-16b38ad93d99"], aliases: ["Conception Rock"] },
    { names: ["THE MAORI LADY"], country: "New Zealand", siteIds: ["a477406e-f075-49de-9cc6-be2b061f2157"], aliases: ["Maori Lady"] },
    { names: ["M.V. Mataora"], country: "Cook Islands", siteIds: ["c6ddd837-897e-47b2-ae96-a888a0dff8df"], aliases: ["Mataora Wreck", "MV Mataora"] },
    { names: ["Waecicu"], country: "Indonesia", siteIds: ["72274c60-9f80-423b-9908-4ed086b1157a"], aliases: ["Wae Cicu", "Wae Cicu Beach"] },
    { names: ["Glasi, Hergiswil"], country: "Switzerland", siteIds: ["ba99c308-a7cb-492b-bf5e-380d73263c89"], aliases: ["Glasi Hergiswil"] },
    { names: ["Préyebère Anemone Garden"], country: "Mauritius", siteIds: ["44b033bc-7b3d-4520-8fc9-0da47a5c16e6"], aliases: ["Anemone Garden"] },
    { names: ["Snake Pit - GBR"], country: "Australia", siteIds: ["5e37dc79-a1fe-49b6-a1e4-f6c23f2fed68"], aliases: ["The Snake Pit", "Snake Pit (Ribbon Reef 10)"] },
    { names: ["AMELIE"], country: "France", siteIds: ["50999e35-e9ea-458d-a889-a62f1c7d7957"], aliases: ["Épave de l'Amélie", "Épave de l’Amélie", "Amelie Wreck", "The Raisin Tree Wreck", "Amélie/Résinier"] },
    { names: ["Breath Taker"], country: "Fiji", siteIds: ["2520b023-c26a-4f06-b2e4-010ee48f2f06"], aliases: ["Breathtaker", "Breath-taker"] },
    { names: ["Plage aux tortues"], country: "France", siteIds: ["d5b6667f-c485-4c81-9998-d495fc0f8abe"], aliases: ["Plage de N'Gouja", "Plage de N’Gouja", "N'Gouja", "N’Gouja"] },
    { names: ["Willemstoren  Lighthouse"], country: "Bonaire, Sint Eustatius and Saba", siteIds: ["3511bea3-f3ed-497e-91bb-1302fb2de786"], aliases: ["Willems Toren"] },
    { names: ["ÎLe Fourchue"], country: "France", siteIds: ["bf4cfa02-a883-4439-aa27-0a064e50721a"], aliases: ["Fork Island", "Île Fourche", "Ile Fourche"] },
    { names: ["Palmetto Keyhole"], country: "Honduras", siteIds: ["dc9d4363-d035-4fed-a24f-e749d50b8a08"], aliases: ["Key hole (Palmetto)"] },
    { names: ["Dragon Teeth"], country: "Seychelles", siteIds: ["7f548a75-0594-4307-884d-a67f12f588f4"], aliases: ["Dragon's Teeth", "Dragon’s Teeth", "Dragons Teeth"] },
    { names: ["Nebo Wreck, Aliwal Shoal"], country: "South Africa", siteIds: ["eaf89371-2d06-4490-856b-84d16e416878"], aliases: ["SS Nebo", "SS Nebo wreck"] },
    { names: ["Hap’s Reef"], country: "Guam", siteIds: ["6c803df2-c5ff-49bd-b152-e459771738c3"], aliases: ["Hap's Reef", "Haps Reef"] },
    { names: ["Le Ponton Ucpa"], country: "France", siteIds: ["196d14b1-1ad8-40c8-aca7-273904a53539"], aliases: ["Ponton UCPA Saint-Pierre", "Ponton UCPA (Saint-Pierre)"] },
    { names: ["Little Ohinau"], country: "New Zealand", siteIds: ["6bfeef92-8d86-4200-9d5e-83282f9787e7"], aliases: ["Ohinauiti Island", "Ohinauiti"] },
    { names: ["Palung Palung"], country: "Indonesia", siteIds: ["d5913cc5-eefe-4b4e-8c08-84d3502b5917"], aliases: ["Palung-Palung"] },
    { names: ["Deep Sponge - 2 Mile Reef"], country: "South Africa", siteIds: ["9f6218ba-06e9-4beb-8c6d-fc8a05862163"], aliases: ["Deep Sponge Reef"] },
    { names: ["Timur Pramuka"], country: "Indonesia", siteIds: ["37101faa-78f6-4122-a2cd-aa7a39a1aa9d"], aliases: ["Timur Pulau Pramuka"] },
    { names: ["South Dolphin"], country: "Kenya", siteIds: ["21f88691-56df-44b3-95fa-c3fdd31ab6fb"], aliases: ["South Dolphin Point"] },
    { names: ["Jam"], country: "Indonesia", siteIds: ["2044a7aa-51f8-4bc5-b761-8b665dd46f58"], aliases: ["Wreck / Jam", "Wreck/Jam"] },
    { names: ["Cap Matoopa"], country: "Seychelles", siteIds: ["5dfe8b2e-2e00-4d3a-8378-c9e0de4e65dc"], aliases: ["Kap Matoupa", "Pointe Matoopa"] },
    { names: ["Tian Xiang (Wreck)"], country: "Mauritius", siteIds: ["3c8bb2b2-0767-4109-bf73-49f8d4c09d54"], aliases: ["Tiang Xiang", "Épave Tiang Xiang", "Tiang Xiang Wreck"] },
    { names: ["Coral Gardens - Lady Elliot Island"], country: "Australia", siteIds: ["ead2dc80-30ae-4b24-97c8-571e07712127"], aliases: ["珊瑚花园"] },
    { names: ["Blausee"], country: "Switzerland", siteIds: ["cc08e180-dd85-4628-b270-ba72bb0a6f07"], aliases: ["Lac Bleu", "Le Lac bleu"] },
    { names: ["Florida"], country: "Brazil", siteIds: ["753b44ae-fb40-40e5-b058-ba15a7ec8c32"], aliases: ["Reboque", "Naufrágio Flórida", "Rebocador Florida"] },
    { names: ["Neptune’s Rhapsody"], country: "Fiji", siteIds: ["4d5ee37f-04a0-4106-8e25-b5f7123f781c"], aliases: ["Neptune's Rhapsody", "Neptunes Rhapsody"] },
    { names: ["loadstone reef"], country: "Australia", siteIds: ["3b971788-aaff-49db-9893-37d103c3e980"], aliases: ["Lodestone Reef", "磁石礁", "ロデストーン・リーフ"] },
    { names: ["Marble Arch"], country: "Mozambique", siteIds: ["9d1b9909-0ebe-4eb6-a0f8-056901fc9e09"], aliases: ["Marble Arch Reef"] },
    { names: ["Marche de l’Empreur"], country: "France", siteIds: ["5294afad-c185-46ed-b3dd-88a9c45b316f"], aliases: ["Marche de l'Empereur", "Marche de l’Empereur", "La Marche de l'Empereur", "La Marche de l’Empereur"] },
    { names: ["Point Guirnard"], country: "Dominica", siteIds: ["f63daac5-acfd-4bc0-8178-3bd93df96630"], aliases: ["Pointe Guignard", "Point Guignard"] },
    { names: ["Canyones, Boca Chica"], country: "Dominican Republic", siteIds: ["cd08aed1-3ed1-4595-a643-955d4735cff1"], aliases: ["Los Cañones", "Cañones"] },
    { names: ["Taharoa Domain (Kai Iwi Lakes)"], country: "New Zealand", siteIds: ["71714cb5-e66f-48cd-909e-f7f61b886f1c"], aliases: ["Lake Taharoa", "Taharoa Lake"] },
    { names: ["Naufrágio Buenos Aires (Wreck)"], country: "Brazil", siteIds: ["4726cc87-6fef-4de4-ab5d-fefe3d72247b"], aliases: ["Naufrágio Buenos Ayres", "Buenos Ayres"] },
    { names: ["New Reef (Dom Te Te)"], country: "Indonesia", siteIds: ["4b4ca674-78bb-48d2-9121-5c88a17ce601"], aliases: ["Dom Te Te"] },
    { names: ["Urquharts Bay"], country: "New Zealand", siteIds: ["49e69f83-3172-401f-b585-152f1237f38d"], aliases: ["Urquhart Bay"] },
    {"names": ["Blijkpolder"], "country": "Netherlands", "siteIds": ["61af10ff-7235-4111-83b9-06821ac3cc9e"], "aliases": ["Blijkpolderplas", "Nederhorst den Berg, De Kooi"]},
    {"names": ["HMAS Perth II"], "country": "Australia", "siteIds": ["dfaf9626-e2ec-408a-ba35-9f6befad92c4"], "aliases": ["HMAS Perth (II)", "HMAS Perth Wreck"]},
    {"names": ["Tanjung Kopi"], "country": "Indonesia", "siteIds": ["378a1b3b-dad5-4471-9ed3-88c6903a81df"], "aliases": ["Coffee Point", "Coffee Corner"]},
    {"names": ["Muda Kan"], "country": "Maldives", "siteIds": ["44fa44a1-449c-4314-99b0-bec3ee1dac9b"], "aliases": ["Manta Point"]},
    {"names": ["Babylon, Cayman"], "country": "Cayman Islands", "siteIds": ["3c59fb8f-ce7b-44ab-8b27-824a589fa4a9"], "aliases": ["巴比伦"]},
    {"names": ["Crossover"], "country": "Indonesia", "siteIds": ["8dd959b6-ffa7-411d-b8f9-1cdd0fd61fc1"], "aliases": ["Cross Over", "Crossover Reef"]},
    {"names": ["Mudjimba Island Reef SW"], "country": "Australia", "siteIds": ["2a44567c-6d90-4ded-81f5-0dc18f405de6"], "aliases": ["Old Woman Island"]},
    {"names": ["Star Gerren"], "country": "Aruba", "siteIds": ["211d2855-e3e3-4443-ab68-d64a3a362b44"], "aliases": ["Star Gerren Wreck"]},
    {"names": ["Los Tubos"], "country": "United States", "siteIds": ["2ce0db8b-dfe0-42cf-ad86-e41409201881"], "aliases": ["Playa Los Tubos", "Playa Los Tubos, Manatí, PR"]},
    {"names": ["St. Abbs"], "country": "United Kingdom", "siteIds": ["657ac9b2-7c59-4b6c-a55a-2cb3b09031c0"], "aliases": ["圣阿布斯", "圣艾布斯", "聖阿布斯", "聖艾布斯", "セントアブス"]},
    {"names": ["L&#039;autre Monde"], "country": "France", "siteIds": ["fc86b0e2-2401-4f1b-a22b-d22b8745c830"], "aliases": ["L'autre Monde", "L’autre Monde"]},
    {"names": ["Kapalua Beach"], "country": "United States", "siteIds": ["b720ebb5-3c1c-4761-a5f0-53f5ac7806e5"], "aliases": ["Kapalua Bay Beach"]},
    {"names": ["Larry’s Lair (47)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["62a4bb2a-e2a8-496f-a6f2-0c6bd5d7587a"], "aliases": ["Larry's Lair", "Larry's Liar", "Larry’s Liar"]},
    {"names": ["Shag Rock - Horseshoe"], "country": "Australia", "siteIds": ["52bc1e16-1ba2-4dcc-be89-ee2eb7a94569"], "aliases": ["Shag Rock Horseshoe"]},
    {"names": ["Dennis’ Dropoff"], "country": "Honduras", "siteIds": ["96e2a832-f735-430a-ab83-078f0bbf66e8"], "aliases": ["Dennis' Dropoff", "Dennis drop off"]},
    {"names": ["The lion’s Den"], "country": "Fiji", "siteIds": ["ce7565a1-0f7c-4c90-ba67-da07b5e9afeb"], "aliases": ["The Lion's Den"]},
    {"names": ["Extasy"], "country": "New Caledonia", "siteIds": ["b24e2378-789a-4a20-ba6b-a8e29fc4e4f3"], "aliases": ["Passe d'Extasy", "Passe d’Extasy"]},
    {"names": ["Jeannies Glory (48)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["8bc8f4a9-1531-4eae-8eea-92d164839a85"], "aliases": ["Jeannie's Glory", "Jeannie’s Glory"]},
    {"names": ["Gabi"], "country": "Dominican Republic", "siteIds": ["ea7d3060-f51a-462d-90af-a686c37fe41d"], "aliases": ["Gabi Reef"]},
    {"names": ["Simon’s Town Harbor"], "country": "South Africa", "siteIds": ["b5b8d917-187f-414f-9171-645a31e48d8a"], "aliases": ["Simon's Town Harbor", "Simon's Town Harbour", "Simon’s Town Harbour"]},
    {"names": ["Spotters Reef"], "country": "Grenada", "siteIds": ["9ae2d981-da89-4d35-91f4-d796c04fa8c9"], "aliases": ["Spotter's Reef", "Spotter’s Reef"]},
    {"names": ["Two Oceans I &amp; J Ocean Exhibit"], "country": "South Africa", "siteIds": ["f0dc0860-329e-4a96-b4d4-9c1a171c40ec"], "aliases": ["I&J Ocean Exhibit", "I & J Ocean Exhibit", "Two Oceans I & J Ocean Exhibit"]},
    {"names": ["MKVI"], "country": "Australia", "siteIds": ["5257fe71-2b25-4df6-8dd8-0f3de5a65830"], "aliases": ["MK6"]},
    {"names": ["Anina (Wreck)"], "country": "Grenada", "siteIds": ["aeb16e14-3b7d-4507-9333-03feb08eaa92"], "aliases": ["MV Anina", "MV Anina Shipwreck", "MS Trinwillershagen"]},
    {"names": ["Bossy’s Canyon"], "country": "France", "siteIds": ["f5fc66a4-529f-4df7-9035-fc84a2dca4f9"], "aliases": ["Bossy's Canyon", "Boxy's Canyon", "Boxy’s Canyon", "Bosys Canyon", "Bosys's Canyon"]},
    {"names": ["Dapdap"], "country": "Philippines", "siteIds": ["a68fcf1a-f0e6-4605-a253-679b90c076ce"], "aliases": ["Dap Dap"]},
    {"names": ["Calhaus"], "country": "Brazil", "siteIds": ["b3c42527-5eee-42ae-81e4-c14351a6a5fd"], "aliases": ["Rochedos dos Calhaus"]},
    {"names": ["Gola del Lupo"], "country": "Switzerland", "siteIds": ["4788a4ed-b8a1-47c8-b9a9-8b3a5370490b"], "aliases": ["Wolfsrachen", "Maggia-Gola del Lupo"]},
    {"names": ["Naufragio Germania"], "country": "Brazil", "siteIds": ["166c2be9-7aa9-4162-a833-85e4285af13d"], "aliases": ["Naufrágio Germânia"]},
    {"names": ["Maracaibo Reef"], "country": "Mexico", "siteIds": ["e4660cef-51e2-49ab-9fd5-e255301e765c"], "aliases": ["Arrecife Maracaibo", "Maracaibo Wall", "Punta Sur - Maracaibo"]},
    {"names": ["GREEN ISLAND"], "country": "New Zealand", "siteIds": ["fa5d0a38-49ef-4f52-8552-ae2c69a723d3"], "aliases": ["Grave Yard"]},
    {"names": ["Guacamaya Island"], "country": "Costa Rica", "siteIds": ["c01005f5-6ccb-4643-b777-fee958dc0f58"], "aliases": ["Guacamaya"]},
    {"names": ["Trevor’s Rocks"], "country": "New Zealand", "siteIds": ["8a30ac16-8c0c-47ba-a374-0a27d6ddbdb9"], "aliases": ["Trevor's Rocks"]},
    {"names": ["Dragon Bay"], "country": "Grenada", "siteIds": ["c2bae0c3-56fb-40c4-b690-3c46eac004c2"], "aliases": ["Dragon Bay Reef"]},
    {"names": ["Rolland"], "country": "Madagascar", "siteIds": ["d0682e4f-a92e-44bd-a12c-07e27e50b630"], "aliases": ["Roland Point"]},
    {"names": ["Wonder Wall"], "country": "Philippines", "siteIds": ["c24447bf-1217-45f3-9262-e3eaa4988add"], "aliases": ["Wonderwall"]},
    { names: ["Laje de Santos - Boca da Baleia"], country: "Brazil", siteIds: ["be58d60d-16fc-4e77-925b-e93c1f476c3f"], aliases: ["Whale's Mouth", "Whale’s Mouth"] },
    { names: ["Fantasy Reef"], country: "Thailand", siteIds: ["0c53c9e9-cb05-4b27-9c9b-9b17b56c3f28"], aliases: ["Chicken Hair Reef", "กองหินแฟนตาซี", "แฟนตาซีรีฟ"] },
    { names: ["Skillion Cave"], country: "Australia", siteIds: ["503a6eab-abf4-4b6f-9151-b9718e240bee"], aliases: ["Skillion Caves"] },
    { names: ["Sharks Pit"], country: "Guam", siteIds: ["188ffc2b-ff9c-4aa5-89fc-67b708c9529d"], aliases: ["Shark Pit", "Shark's Pit", "Shark’s Pit"] },
    { names: ["Marianne"], country: "Seychelles", siteIds: ["fa5ec60c-75f1-4e69-955f-822ca276f78b"], aliases: ["玛丽安岛", "Marianne Island"] },
    { names: ["Hepp’s Pipeline"], country: "Cayman Islands", siteIds: ["345ad92f-b825-4963-b777-efd53b7fdf70"], aliases: ["Hepp's Pipeline"] },
    { names: ["L’ile bleue/Blue Island"], country: "French Polynesia", siteIds: ["27c6a38a-9d2a-4b5a-95b3-6df82e4a17e1"], aliases: ["L'île Bleue", "L’île Bleue", "L'ile bleue"] },
    { names: ["Ilha de Currais"], country: "Brazil", siteIds: ["88e4ab18-ca6b-4c0e-b9e2-be05371b272b"], aliases: ["Ilha dos Currais", "Ilhas dos Currais"] },
    { names: ["Lighthouse Wall"], country: "Cayman Islands", siteIds: ["11d0936d-81a4-4389-a20e-0f8cba47f0fc"], aliases: ["Lighthouse Wall 2"] },
    { names: ["Cobalt Ridge"], country: "Cayman Islands", siteIds: ["5f131db1-d696-4266-a1b2-d83270c80518"], aliases: ["Cobalt Coast", "Cobalt Coast house reef"] },
    { names: ["Mermaid’s Grotto"], country: "Japan", siteIds: ["a21bf69b-8722-4bc1-a4dd-b27995e00835"], aliases: ["アポガマ", "マーメイドグロット", "Apogama", "Mermaid's Grotto", "Mermaids Grotto"] },
    { names: ["Rainbow Warrior"], country: "New Zealand", siteIds: ["f17fee31-395a-4509-a668-558bd24a09cb"], aliases: ["レインボー・ウォーリア号", "レインボー・ウォリアー"] },
    { names: ["la passe du puits"], country: "Mauritius", siteIds: ["07a9a44f-6cff-43ee-9102-94ba078ef07c"], aliases: ["Passe de Belle Mare", "La Passe Belle Mare"] },
    { names: ["Kohanee"], country: "Grenada", siteIds: ["cf1abd47-add3-439f-855a-a6be7a672aba"], aliases: ["Kahonee", "Kohanee Reef"] },
    { names: ["Wall Street"], country: "Philippines", siteIds: ["cb1e040f-a4da-4900-9c50-fe5d605621be"], aliases: ["ウォールストリート"] },
    { names: ["Whibbles Reef"], country: "Grenada", siteIds: ["2f303db0-8433-492f-a900-8142e357d121"], aliases: ["Whibble Reef", "Wibbles"] },
    { names: ["Grandes Jorasses"], country: "France", siteIds: ["48da1080-ea5e-4e77-8ca4-cfc964d0fb62"], aliases: ["Les Grandes Jorasses", "Grande Jorasse"] },
    { names: ["SAS  Pietermaritzburg, wreck"], country: "South Africa", siteIds: ["12eff08e-121e-46b2-9b4d-e9840d711bd3"], aliases: ["HMS Pelorus", "PMB wreck"] },
    { names: ["Igloo"], country: "Kenya", siteIds: ["603b31f2-9497-4a76-9ae4-80c9fda133d7"], aliases: ["Igloo Reef"] },
    { names: ["La Farola"], country: "Dominican Republic", siteIds: ["8b47803d-f1bb-4e64-a6e4-50e6a3646ad1"], aliases: ["Muro de la Farola", "La Farola Cay"] },
    { names: ["Neregando"], country: "Maldives", siteIds: ["294d738e-9364-4c35-b0f0-f30eea7f4f14"], aliases: ["Neregado", "Neregando Fanno"] },
    { names: ["Tortilla"], country: "Costa Rica", siteIds: ["fa7d03e7-c798-4b0a-a32a-cc0273000b80"], aliases: ["La Tortilla"] },
    { names: ["Million Dollar Point"], country: "Vanuatu", siteIds: ["3d2889be-f88d-42e9-8171-dd3f3ea5ddd9"], aliases: ["One Million Dollar Point", "Million Dollar Beach"] },
    { names: ["Critters Alley"], country: "Tanzania, United Republic of", siteIds: ["3d15a512-f07a-4a28-81a6-8c76aab2d398"], aliases: ["Critter's Alley", "Critter’s Alley"] },
    { names: ["Aquarium Gros Ilets"], country: "France", siteIds: ["9bd323ff-ddb8-4566-9722-34fbb1924255"], aliases: ["Aquarium des Gros Islets"] },
    { names: ["alfasma"], country: "Saudi Arabia", siteIds: ["0804fb38-05d2-4a62-946f-984f2871adc4"], aliases: ["Al Fasma"] },
    { names: ["Pipeline"], country: "Australia", siteIds: ["5d70cd57-23a9-40f3-9760-047017377533"], aliases: ["The Pipeline", "The Pipeline (Nelson Bay)"] },
    { names: ["Lighthouse Bommie"], country: "Australia", siteIds: ["9dea9894-7684-4e0e-a377-497f64a41329"], aliases: ["ライトハウスボミー"] },
    { names: ["Los Molinos"], country: "Spain", siteIds: ["49dc0415-7e4e-4c6c-8cdc-3b302757e2c2"], aliases: ["La Pared de Calaiza", "Pared de Calaiza"] },
    { names: ["Baleine du pain de sucre"], country: "France", siteIds: ["1f3d41fe-b34d-4416-a4a3-253e715a8ce3"], aliases: ["Baleine du Pain-de-Sucre"] },
    { names: ["P-47 Plane Wreck"], country: "Indonesia", siteIds: ["45048c28-a3df-4799-a4ed-8c0bbe7d806f"], aliases: ["P47 Plane Wreck"] },
    { names: ["Fish Bowl"], country: "Sint Maarten (Dutch part)", siteIds: ["a882c6aa-d579-4aaf-ae7b-b4b3731611b2"], aliases: ["Fishbowl"] },
    { names: ["Elijah’s Reef"], country: "Fiji", siteIds: ["b1c1307a-4702-4ebe-9c02-a749479c19fa"], aliases: ["Elijah's Reef"] },
    { names: ["Pillarsteen"], country: "Indonesia", siteIds: ["8f81443e-dcb7-4eb0-b51e-dea47af85424"], aliases: ["Pillar Rock"] },
    { names: ["Le Remorqueur"], country: "France", siteIds: ["06c5698f-b25d-465a-b746-729a1352a566"], aliases: ["Tintamarre wreck", "Epave de Tintamarre", "Épave de Tintamarre"] },
    { names: ["Elpida Wreck"], country: "Cyprus", siteIds: ["6a416cbb-1af6-4ba4-86f3-9ca2edb70f1b"], aliases: ["MV Elpida", "Elpida Shipwreck", "Ναυάγιο Ελπίδα"] },
    { names: ["Atlantic Princess Wreck (Bayahibe)"], country: "Dominican Republic", siteIds: ["51c450a2-392a-458c-9e18-0d0c248276c0"], aliases: ["Naufragio Atlantic Princess"] },
    {"names": ["Bajo Alcyone"], "country": "Costa Rica", "siteIds": ["270ede74-2a34-4ea9-bc9d-d8b29db0c8c2"], "aliases": ["バホ・アルシオーネ", "바호 알시오네"]},
    {"names": ["Cap d’Artrutx"], "country": "Spain", "siteIds": ["9f142bc9-0e14-4c76-860d-f57a9e16aba2"], "aliases": ["Cap d'Artrutx"]},
    {"names": ["Îlot Maître"], "country": "New Caledonia", "siteIds": ["1c3f66ec-836f-44a0-8688-25d1d68e10b5"], "aliases": ["メトル島"]},
    {"names": ["Cinco Ribeiras"], "country": "Portugal", "siteIds": ["7216cc8c-ff30-4a4a-bf59-84f1a9a4fb52"], "aliases": ["Gruta das Cinco Ribeiras", "Five Creeks Cavern"]},
    {"names": ["Devil’s Table"], "country": "Saint Vincent and the Grenadines", "siteIds": ["e51c5413-2e21-47c2-b685-8434b56bbe6a"], "aliases": ["Devil's Table"]},
    {"names": ["Dunia Kecil"], "country": "Indonesia", "siteIds": ["f668c6d7-5ba2-4a77-b6eb-b36d8905c4e2"], "aliases": ["Small World"]},
    {"names": ["L2D “Tabby“ (Japaness DC-3)"], "country": "Philippines", "siteIds": ["413db1ec-fcbe-46ed-9559-3c085013c2cd"], "aliases": ["L2D Tabby", "Japanese DC-3"]},
    {"names": ["Punta des Morter"], "country": "Spain", "siteIds": ["a203011b-6c26-42c1-a50b-6df8ac3cd2b5"], "aliases": ["Punta des Murter"]},
    {"names": ["L’âne rouge"], "country": "France", "siteIds": ["b8942eb5-fad0-4ec4-be4a-18afccc45b23"], "aliases": ["L'âne rouge"]},
    {"names": ["Zacatoso"], "country": "Mexico", "siteIds": ["bddd3ef9-fb0b-4b47-b2cd-add20dd47ec0"], "aliases": ["Zacatoso Reef"]},
    {"names": ["Kinondo"], "country": "Kenya", "siteIds": ["ebe3fa27-ddbd-4948-a50d-57eb73bdb61b"], "aliases": ["Kinondo Reef"]},
    {"names": ["Scotts Head Pinnacle"], "country": "Dominica", "siteIds": ["7bc62538-80d2-47c5-9b5e-b8572cc0369f"], "aliases": ["Scott's Head Pinnacle", "Scott’s Head Pinnacle"]},
    {"names": ["Manta Ray Bay"], "country": "Australia", "siteIds": ["93d3d082-64e4-4f15-838e-2b58a1452e19"], "aliases": ["Mantaray Bay"]},
    {"names": ["La Pointe au Sel"], "country": "France", "siteIds": ["3e6c7d48-8008-4fd6-ac6c-d63815c9fef3"], "aliases": ["Grand tombant de la Pointe au Sel"]},
    {"names": ["Sharks Tooth Kaikoura"], "country": "New Zealand", "siteIds": ["b2c7926b-ef82-4f2e-b241-e71a303a2b65"], "aliases": ["Shark's Tooth", "Shark’s Tooth"]},
    {"names": ["BR-20 Wreck"], "country": "Italy", "siteIds": ["bf143d68-59d7-4664-bd51-ea6c80a7f91f"], "aliases": ["Relitto BR20", "Relitto aereo Fiat BR20", "BR 20 Cicogna"]},
    {"names": ["Mornington Pier"], "country": "Australia", "siteIds": ["8c4bbacd-260b-426e-ada6-a8c33cf2e468"], "aliases": ["莫宁顿码头", "Mornington Jetty"]},
    {"names": ["Vaagali South"], "country": "Maldives", "siteIds": ["6449335c-1f4c-4899-9ecd-a98607d87933"], "aliases": ["Vaagali Faru South", "Vaageli Faru South"]},
    {"names": ["Lane Gilchrest Reef"], "country": "United States of America", "siteIds": ["e68f18a1-9454-45dd-9c30-6ade486aad23"], "aliases": ["Lane Gilchrist Reef", "Mayor Lane Gilchrist Reef"]},
    {"names": ["Saint Yves"], "country": "France", "siteIds": ["3a0d9674-5d38-4874-8e8a-ea891d015e31"], "aliases": ["Trou de St-Yves", "Trou Saint-Yves"]},
    {"names": ["Adakule Cave"], "country": "Türkiye", "siteIds": ["9b98926b-46b8-4802-b4dd-ca483a57fb7d"], "aliases": ["Adakule Mağarası"]},
    {"names": ["Gamat Bay"], "country": "Indonesia", "siteIds": ["27f0fb35-febe-4a8f-b3b2-d472c82f5eb9"], "aliases": ["加马特湾", "ガマットベイ", "가맛 베이"]},
    {"names": ["Mitsune"], "country": "Japan", "siteIds": ["c84e6771-168b-4e8b-9ae2-b73d0cd2cd14"], "aliases": ["三つ根"]},
    {"names": ["Boka Katuna"], "country": "Netherlands", "siteIds": ["5bcfc39d-1ac8-4b9b-a0b6-a19016549178"], "aliases": ["Boca Katuna"]},
    {"names": ["Fukashima Island"], "country": "Japan", "siteIds": ["e197b960-3504-4512-8447-27ff5ac329d5"], "aliases": ["深島"]},
    {"names": ["Gorishoek De Punt"], "country": "Netherlands", "siteIds": ["4156953c-8fd2-4e5c-9338-d47d0086c49a"], "aliases": ["De Punt (Gorishoek)", "Gorishoek - De Punt (78a)"]},
    {"names": ["Relitto della Piattaforma Paguro"], "country": "Italy", "siteIds": ["52a42b29-0738-4e4a-a947-108f60f4f971"], "aliases": ["Relitto del Paguro", "Relitto Paguro", "Piattaforma Paguro"]},
    {"names": ["Cinderella’s Castle"], "country": "Cayman Islands", "siteIds": ["00984333-6699-4c32-aea7-9af51a9fe54f"], "aliases": ["Cinderella's Castle"]},
    {"names": ["HTMS Kled Keaw Ship Wreck"], "country": "Thailand", "siteIds": ["0a7fe86a-6dcc-446e-b347-5e7782c13cd0"], "aliases": ["Kled Kaew Wreck", "HTMS Kled Kaew", "Klad Kaew Wreck", "Kled Gaeow", "Kled Geaw", "Kled Kaeo Wreck", "The Phi Phi Wreck", "เรือจมเกล็ดแก้ว", "เรือหลวงเกล็ดแก้ว"]},
    {"names": ["Bezdan"], "country": "Croatia", "siteIds": ["f37f48d7-d9e4-444f-8743-76215241b70d"], "aliases": ["Cape Bezdan", "Punta Bezdan", "The Abyss"]},
    {"names": ["Smith Cove"], "country": "Cayman Islands", "siteIds": ["cb2b961d-e2ec-4e08-9575-9de5e517d368"], "aliases": ["Smith Barcadere", "Smith's Barcadere", "Smith’s Barcadere"]},
    // B-29 is a local dive-site name; the Saipan wreck is an H8K flying boat.
    {"names": ["H8K Japanese Sea Reconnaissance Plane"], "country": "United States of America", "siteIds": ["4acd48c6-fad8-4020-90f6-b1a88839dc51"], "aliases": ["二式飛行艇", "H8Kエミリー", "B-29", "B29"]},
    {"names": ["Jim Atria"], "country": "United States of America", "siteIds": ["d991227b-20e5-4cfe-b383-77256d4b1e20"], "aliases": ["Poinciana", "Atria Reef"]},
    {"names": ["Ritidian Point"], "country": "Guam", "siteIds": ["5dab08c0-c0eb-4981-b8e2-7b6c5af28e3e"], "aliases": ["リティディアン岬"]},
    {"names": ["Osaki Lion Fish Palace"], "country": "Japan", "siteIds": ["19f78851-5241-4437-8a5f-32669d6e51ff"], "aliases": ["大崎ミノカサゴ宮殿", "ミノカサゴ宮殿"]},
    {"names": ["Selsey Lifeboat Station"], "country": "United Kingdom", "siteIds": ["21f4bbe0-b44f-479c-822b-9e2bbb5927a0"], "aliases": ["Selsey Lifeboat"]},
    {"names": ["滘西洲"], "country": "China", "siteIds": ["66a51573-24e4-4b1d-b7ea-e571bffa3b8a"], "aliases": ["Kau Sai Chau"]},
    {"names": ["Ho Mei III - Salvador"], "country": "Brazil", "siteIds": ["a40b9037-4cea-4781-8b76-9911dbb40ff9"], "aliases": ["Naufrágio Ho Mei III", "Homei III"]},
    {"names": ["Lake Kleifarvatn"], "country": "Iceland", "siteIds": ["0611a370-3b5e-4311-92c6-4ab627cd5b58"], "aliases": ["克莱瓦湖", "克莱法尔瓦腾湖", "クライファルヴァトン湖"]},
    {"names": ["Groupers Rocks, Mnemba Island"], "country": "Tanzania, United Republic of", "siteIds": ["9e332908-e1ed-45a6-b5df-abe2871f208d"], "aliases": ["Grouper's Rock", "Grouper’s Rock"]},
    {"names": ["Schweriner Lastensegler (Wreck)"], "country": "Germany", "siteIds": ["8c70f395-e624-44a1-ab28-835028becf13"], "aliases": ["Lastensegler Schweriner See"]},
    {"names": ["Ko Tae Nai"], "country": "Thailand", "siteIds": ["df84bb80-13d4-4d41-be54-4a97ff306546"], "aliases": ["Koh Tae Nai"]},
    {"names": ["Merkanti Reef (Divewise House Reef)"], "country": "Malta", "siteIds": ["91ee8d69-cdcd-486a-931f-2fb095583b6d"], "aliases": ["Dragonara Reef", "Mercanti Reef"]},
    {"names": ["Nippo Maru"], "country": "Federated States of Micronesia", "siteIds": ["1eff0142-7485-4507-8c1b-8a9d760c7e36"], "aliases": ["日豊丸", "Nippo-maru"]},
    {"names": ["Malpelo"], "country": "Colombia", "siteIds": ["02e2420d-02b2-4506-9725-f8be34da4c99"], "aliases": ["马尔佩洛岛", "馬爾佩洛島", "マルペロ", "マルペロ島"]},
    {"names": ["Secca dei Monaci"], "country": "Italy", "siteIds": ["62137ad9-3b6e-4261-a3f3-8770d5e9a141"], "aliases": ["Monks Rock"]},
    {"names": ["Jack-A-Dan West, Carriacou"], "country": "Grenada", "siteIds": ["df0048e9-cbfc-41c0-8382-3314611e818b"], "aliases": ["Jack-A-Dan West Side"]},
    {"names": ["M and M Unauna"], "country": "Indonesia", "siteIds": ["db8a85f0-ebd7-4f26-aba5-17a3129396e3"], "aliases": ["M&M"]},
    {"names": ["Champagne"], "country": "Dominica", "siteIds": ["91563a80-0aa3-4e31-b4ad-59120aa7b924"], "aliases": ["Champagne Reef"]},
    {"names": ["Banc Doré"], "country": "France", "siteIds": ["84d2bcdf-1317-402d-a793-a298b1621617"], "aliases": ["Le Banc Doré", "Banc de sable"]},
    {"names": ["Cuatro piedras, Catalina Islands"], "country": "Costa Rica", "siteIds": ["0a1bbb8e-a9b6-4005-8cd8-82e478420acf"], "aliases": ["Four Rocks"]},
    {"names": ["Saveiros"], "country": "Brazil", "siteIds": ["34121cb1-15d0-48fd-9fb0-72b832d45b03"], "aliases": ["Naufrágio Saveiros", "Rebocador Saveiros"]},
    {"names": ["Gonçalo Coelho"], "country": "Brazil", "siteIds": ["5f211c35-dbea-42ce-a8cf-b827a5f606a6"], "aliases": ["Naufrágio Gonçalo Coelho"]},
    {"names": ["Mike's Maze"], "country": "Sint Maarten (Dutch part)", "siteIds": ["8db1aba2-cf0c-4275-97e4-c7b9bb8e83e0"], "aliases": ["Mike’s Maze"]},
    {"names": ["Bianca C (Wreck)"], "country": "Grenada", "siteIds": ["60b0a48b-31f4-4d62-8ca9-e9d828450c7c"], "aliases": ["比安卡C号", "比安卡 C 号", "比安卡C號", "Titanic of the Caribbean"]},
    {"names": ["Moya Reef"], "country": "Fiji", "siteIds": ["3e38af4e-d34d-44ed-96fa-16726d002c14"], "aliases": ["莫亚礁", "莫亞礁"]},
    {"names": ["Uepi Point"], "country": "Solomon Islands", "siteIds": ["890f52be-3c9b-491b-8366-d9409e9e88df"], "aliases": ["The Point"]},
    {"names": ["Passe Bandrelé"], "country": "France", "siteIds": ["e2c3ae55-da48-4972-8741-646b77f27588"], "aliases": ["Passe Brandélé", "Passe Brandele", "Passe de Bandrélé"]},
    {"names": ["The Crack at Pulau Babi"], "country": "Indonesia", "siteIds": ["a5648353-d8cc-44fb-825e-ddce29b23c74"], "aliases": ["Pulau Babi / The Crack"]},
    {"names": ["Ti’ Voilier"], "country": "France", "siteIds": ["7bcb2059-e54b-42ce-abb4-8d6c6d1f56d5"], "aliases": ["Ti' Voilier", "Ti Voilier", "Petit Voilier"]},
    {"names": ["Ricks Reef"], "country": "Egypt", "siteIds": ["8e7140bb-6dcd-47be-ae3c-e8c3dce21641"], "aliases": ["Rick's Reef", "Rick’s Reef", "Reeks Reef"]},
    {"names": ["Motu Nuhi-Nuhi (l’aquarium)"], "country": "French Polynesia", "siteIds": ["915c785a-e501-4135-9a64-9c70cd1e7b78"], "aliases": ["Motu Nuhi Nuhi", "Nuhi Nuhi Motu", "Motu Nuhi-Nuhi (l'aquarium)", "The Aquarium Rangiroa"]},
    {"names": ["Chimney"], "country": "Virgin Islands, British", "siteIds": ["911c009a-e700-49e6-85a0-40f014b47282"], "aliases": ["The Chimney"]},
    {"names": ["Meeddhoo Outside"], "country": "Maldives", "siteIds": ["f3c993da-d95a-4b2f-af59-8ac31e792357"], "aliases": ["Meedhoo Outside", "Meddhoo Outside"]},
    {"names": ["Canons"], "country": "Australia", "siteIds": ["36d449d6-e7ee-464b-8487-34d77d013cba"], "aliases": ["Cannons", "The Cannons", "Gerhard's Canons", "Gerhard’s Canons"]},
    {"names": ["Faille de Poe"], "country": "New Caledonia", "siteIds": ["0a34bfee-e724-43a1-9510-41048c6c3b6d"], "aliases": ["Faille de Poé", "Faille Shark", "Faille de l'îlot Shark", "Faille de l’îlot Shark"]},
    {"names": ["Milligerplas"], "country": "Netherlands", "siteIds": ["16f539e1-eb2e-45e4-a284-e4a15eed766c"], "aliases": ["Milliger plas"]},
    {"names": ["INCH CAPE 1"], "country": "United Arab Emirates", "siteIds": ["aa68fdf0-5052-4489-bc48-b92b5f73d2fc"], "aliases": ["Inchcape 1", "Inchcape 1 Wreck"]},
    {"names": ["Sandy Island Lighthouse, Carriacou"], "country": "Grenada", "siteIds": ["f0be8397-64c9-4f91-b8ff-7b3f9994cdc9"], "aliases": ["Diver's Surprise", "Diver’s Surprise", "Divers Surprise"]},
    {"names": ["Ladder Labyrinth Red"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["de3af3d6-11e5-4f5b-aeed-93b319e83a21"], "aliases": ["Ladder Lab", "Ladder Labyrinth"]},
    {"names": ["Parcel do Coronel"], "country": "Brazil", "siteIds": ["4704d184-de31-4796-874c-b47a542b2c67"], "aliases": ["Laje do Coronel", "Parcel dos Coronéis"]},
    {"names": ["MV Shakem, wreck"], "country": "Grenada", "siteIds": ["978f3829-3ed6-48d3-9d5f-54c9b16d7d1e"], "aliases": ["Shark Elm"]},
    {"names": ["Banc des Licornes"], "country": "Madagascar", "siteIds": ["ebdd86ab-9cad-4715-80a5-201c76aba9cf"], "aliases": ["Unicorns", "Licorne", "Licornes"]},
    {"names": ["Edna’s Anchor"], "country": "Cook Islands", "siteIds": ["2acda2d9-6e33-4132-99d8-ac17de73f54c"], "aliases": ["Edna's Anchor", "Ednas Anchor"]},
    {"names": ["USS  Emmons"], "country": "Japan", "siteIds": ["ff86b889-167d-40e3-9ec8-6b35998d8b18"], "aliases": ["エモンズ", "USSエモンズ", "沈船エモンズ"]},
    {"names": ["Danglebens Pinnacles"], "country": "Dominica", "siteIds": ["7461a39d-c883-4715-b0e3-69094fc98435"], "aliases": ["Dangleben's Pinnacles", "Dangleben’s Pinnacles"]},
    {"names": ["J4 Submarine Wreck"], "country": "Australia", "siteIds": ["d94849a3-4d87-43b6-80c0-e18a0fdd3c80"], "aliases": ["HMAS J4", "90 foot Submarine", "Shallow Submarine", "J4 26m Submarine"]},
    {"names": ["Shaab Hamdallah"], "country": "Egypt", "siteIds": ["5575f62d-3560-44cf-a01c-9099a9249322"], "aliases": ["Sha ab Hamdalla", "Shaab Hamdhallah"]},
    {"names": ["Wied il-Mielah"], "country": "Malta", "siteIds": ["dcbc0880-51f6-415a-acb0-853604e9343d"], "aliases": ["Wied il-Mielaħ", "Salt Valley Window", "Wied il-Mielah Window", "It-Tieqa ta' Wied il-Mielah", "It-Tieqa ta’ Wied il-Mielah"]},
    {"names": ["Segara"], "country": "Indonesia", "siteIds": ["2104a3d5-cc50-477c-8768-6dd5be83dafe"], "aliases": ["Segara Point"]},
    {"names": ["Lundy Island"], "country": "United Kingdom", "siteIds": ["f209b364-79e5-49d2-bfe5-f506a9f05578"], "aliases": ["伦迪岛", "倫迪島", "ランディ島"]},
    {"names": ["Rebocador Marte"], "country": "Brazil", "siteIds": ["b276904f-c2e8-4557-b50b-409b654b5085"], "aliases": ["Naufrágio Marte"]},
    {"names": ["Warahnus"], "country": "Indonesia", "siteIds": ["2135939c-c4e8-467a-9e02-e74ad6931959"], "aliases": ["Warahnus Jetty"]},
    {"names": ["Ladiko"], "country": "Greece", "siteIds": ["ef1b2c97-cfa2-4b39-b589-ed1256810581"], "aliases": ["Ladiko Bay", "Λαδικό"]},
    {"names": ["Ray&#039;s point"], "country": "Seychelles", "siteIds": ["945a0c74-ed58-4440-b4ce-13bb82ec48e3"], "aliases": ["Ray's point"]},
    {"names": ["Cenote Tak Be Lum"], "country": "Mexico", "siteIds": ["d440e2d8-033a-4d38-ba68-654a617dc334"], "aliases": ["Tak Be Lu’um", "Tak Be Lu'um", "Taak Be Luum", "Taak Bi Lum", "Tak Be Luum"]},
    {"names": ["Playa Forti"], "country": "Curaçao", "siteIds": ["f4d78618-7d22-4bb5-909a-5db3683ebec3"], "aliases": ["Sweet Alice"]},
    {"names": ["Sorpresa"], "country": "Costa Rica", "siteIds": ["159f6ac7-2158-47aa-8ca4-c6245ea5bb8a"], "aliases": ["Surprise Reef"]},
    {"names": ["Onderwater Natuurpark Zegersloot"], "country": "Netherlands", "siteIds": ["4352cd8a-041e-4e8c-b8a5-5ec967239ddb"], "aliases": ["Zegersloot Onderwaterpark", "Onderwaterpark Zegersloot"]},
    {"names": ["Coral Stairs Bali"], "country": "Indonesia", "siteIds": ["f32f927f-0f44-487c-bd38-00f0e2d537d8"], "aliases": ["Coral Stairs"]},
    {"names": ["Cara a Cara"], "country": "Honduras", "siteIds": ["516b5ff0-ff5d-4af8-899e-2ec50a7ae356"], "aliases": ["Marco's Place", "Marco’s Place", "Marcos Place"]},
    {"names": ["Blue Reef / Debbie II (Wreck)"], "country": "Aruba", "siteIds": ["129265ab-487e-488f-93fc-ff1bb36c1fe6"], "aliases": ["Debbie II Wreck", "Debbie II / Blue Reef"]},
    {"names": ["Xcalak"], "country": "Mexico", "siteIds": ["a3624326-6bd8-4380-8e2a-481cab19642d"], "aliases": ["艾克斯卡拉克", "斯卡拉克"]},
    {"names": ["Soug Bohar"], "country": "Egypt", "siteIds": ["c931557c-ee62-4a21-8172-e57f4bb75750"], "aliases": ["Soug Bahar", "Sug Bohar"]},
    {"names": ["Brady’s Corner (Shark Fin Cave)"], "country": "New Zealand", "siteIds": ["e5e9a6c9-f79e-4cdd-873e-486a18d1a3ca"], "aliases": ["Brady's Corner"]},
    {"names": ["Bellatrix"], "country": "Brazil", "siteIds": ["f761c918-45c1-49a1-a720-579c3167f96c"], "aliases": ["Naufrágio Bellatrix", "Rebocador Bellatrix"]},
    {"names": ["Pointe Lezarde"], "country": "France", "siteIds": ["6d68eeef-39c8-4fee-81ac-80f8e6cd0312"], "aliases": ["Pointe de la Lézarde", "La Pointe de la Lézarde"]},
    {"names": ["Daku Arch"], "country": "Philippines", "siteIds": ["5462f57b-e681-4900-8161-1a1b258ab918"], "aliases": ["达库拱门", "達庫拱門"]},
    {"names": ["Shinkoku Maru"], "country": "Micronesia, Federated States of", "siteIds": ["4088af38-74c4-4d36-9744-f453d13e1b37"], "aliases": ["神国丸", "神國丸", "Shinkoku-maru"]},
    {"names": ["Wythmenerplas"], "country": "Netherlands", "siteIds": ["df0c3f68-9434-4503-a3ea-ddf3cfb0be9e"], "aliases": ["Wijthmenerplas", "Wijthemerplas", "Wythemerplas"]},
    {"names": ["Charco Verde"], "country": "Spain", "siteIds": ["24dd081f-0447-4039-94c5-fe3f03807392"], "aliases": ["Arcos de Charco Verde", "Arcos del Charco Verde"]},
    {"names": ["Cañones Es Vedranell"], "country": "Spain", "siteIds": ["b1a22894-3797-4662-9aca-5e8f7a1c86b1"], "aliases": ["Cañones de Es Vedranell", "Los Cañones de es Vedranell"]},
    {"names": ["Bajo de Emilio"], "country": "Spain", "siteIds": ["bb181a89-6ee3-4131-9bca-9c6702541e58"], "aliases": ["Bajo de Fuera", "Piedra del Muelle", "El Bajo de Emilio"]},
    {"names": ["Agua Negra Cozumel"], "country": "Mexico", "siteIds": ["cc2411e1-b8eb-44bb-8e6c-e0dc7253eccb"], "aliases": ["Blackwater Cozumel"]},
    {"names": ["Naufragio Victory 8B"], "country": "Brazil", "siteIds": ["fe30529b-71c3-4f8a-95fc-6a6dcc2b488b"], "aliases": ["Poli Premier", "Naufrágio Victory 8B"]},
    {"names": ["Piscinas Naturais - Porto de Galinhas"], "country": "Brazil", "siteIds": ["e0fefe14-8a64-4c39-a09d-9ab153154289"], "aliases": ["Piscinas Naturais de Porto de Galinhas"]},
    {"names": ["Siete Pecados"], "country": "Philippines", "siteIds": ["426740cd-3e9a-4c5f-ad67-f495d0a4d7e3"], "aliases": ["七子岛", "七子島", "七子礁", "七姐妹岩"]},
    {"names": ["Mercurius"], "country": "Brazil", "siteIds": ["38e82910-3884-4b41-8378-c2c70172af71"], "aliases": ["Naufrágio Mercúrius", "Rebocador Mercurius"]},
    {"names": ["S'Aigua blanca"], "country": "Spain", "siteIds": ["84b19340-9735-492a-a4ee-6557ab17453d"], "aliases": ["Sa Aigua Blanca", "Isla de las Gaviotas", "Ilha das Gaivotas", "Island of the Seagulls"]},
    {"names": ["Amity Point"], "country": "Australia", "siteIds": ["e83a3dba-a652-4160-9e85-b7115e78b6d7"], "aliases": ["Amity Point jetty and wall"]},
    {"names": ["Maherida"], "country": "Greece", "siteIds": ["171be1ca-34f8-4199-b644-1aaf583daa50"], "aliases": ["Macherida", "Μαχαιρίδα"]},
    {"names": ["Bajo Mariajo"], "country": "Colombia", "siteIds": ["04207709-6813-4bb0-8598-3654252b5ebd"], "aliases": ["Die Untiefe Mariajo"]},
    {"names": ["Cap Salomon"], "country": "France", "siteIds": ["13069a57-84c5-4d2d-b5cb-f298da5ffe9c"], "aliases": ["Pointe Salomon"]},
    {"names": ["Punta dell’Arpa"], "country": "Italy", "siteIds": ["518ae23c-e332-43df-ac1c-e628b03b9580"], "aliases": ["Punta dell'Arpa", "Scoglio del Cornuto"]},
    {"names": ["Stingray City - Grand Cayman"], "country": "Cayman Islands", "siteIds": ["997de852-0504-49c5-99f7-09486c23c241"], "aliases": ["黄貂鱼城"]},
    {"names": ["Pinacle d’Actineria"], "country": "New Caledonia", "siteIds": ["b9ff9dbe-7bec-4508-b5d6-bb98cb90f451"], "aliases": ["Pinacle d'Actineria"]},
    {"names": ["Passe bateau sud"], "country": "France", "siteIds": ["8b3e2c0f-4581-4ba5-9bff-086f211afe9c"], "aliases": ["Passe Bateaux Sud"]},
    {"names": ["Blue MaoMao Arch"], "country": "New Zealand", "siteIds": ["79aac375-3294-4612-a0fa-25087963eaf6"], "aliases": ["Blue Mao Mao Arch"]},
    {"names": ["Bau de la Ferrera"], "country": "Spain", "siteIds": ["b44243af-38ea-4afe-948a-c476fd0a1299"], "aliases": ["Bau de la Ferrara", "El Bau de la Ferrera"]},
    {"names": ["Abwonderdive House Reef"], "country": "Indonesia", "siteIds": ["58d83a46-7729-4081-b333-a8eeba826bb8"], "aliases": ["ABW House Reef"]},
    {"names": ["Ti&#039; Mur"], "country": "France", "siteIds": ["cdd8b753-345f-4752-81ea-6c479fb22d64"], "aliases": ["Ti' Mur", "Ti’ Mur"]},
    {"names": ["Marilyn’s Cut"], "country": "Cayman Islands", "siteIds": ["a392b58e-a024-4a05-b2c6-d9bfe0d48f5a"], "aliases": ["Marilyn's Cut"]},
    {"names": ["Beau Vallon Beach"], "country": "Seychelles", "siteIds": ["6355b2d1-bb90-401e-8c9f-ccbc97c17d3c"], "aliases": ["ボー・ヴァロン・ビーチ", "博瓦隆", "布法隆海滩"]},
    {"names": ["Keauhou Bay"], "country": "United States", "siteIds": ["b718607b-1305-4ced-a5e2-eb8ec4d7b33b"], "aliases": ["ケアウホウ湾", "Manta Village"]},
    {"names": ["Broughton  Island  The Looking Glass"], "country": "Australia", "siteIds": ["65d33c29-763d-4bcd-a25c-7357b9edc743"], "aliases": ["Looking Glass", "The Looking Glass"]},
    {"names": ["Srikandi Speedboat (Wreck)"], "country": "Indonesia", "siteIds": ["ffc1ab41-8ba0-429b-88db-bf51f040a683"], "aliases": ["Srikandi-Marina Shipwreck", "マリナレック", "パチャレック"]},
    {"names": ["Batu Bolong, Nusa Penida"], "country": "Indonesia", "siteIds": ["508191d2-d940-483e-8a9d-db67642384ee"], "aliases": ["Donut", "Batu Meling"]},
    {"names": ["Glovers Reef"], "country": "Grenada", "siteIds": ["22519d2f-bb8d-4c61-8add-315a8735bd83"], "aliases": ["Glover's Reef", "Glover’s Reef"]},
    {"names": ["Roonies"], "country": "South Africa", "siteIds": ["baaa6c41-4836-4b7a-a885-c95e47349346"], "aliases": ["Rooneys"]},
    {"names": ["Les tunnels d’Actinéria"], "country": "New Caledonia", "siteIds": ["2a42a8d6-a61d-40a9-9b33-47715b94deb2"], "aliases": ["Les tunnels d'Actinéria"]},
    { names: ["Waynes World"], country: "South Africa", siteIds: ["540ca5ef-8899-4745-a574-e2b75623d021"], aliases: ["Wayne's World", "Wayne’s World"] },
    { names: ["Robs Bottom"], country: "Mozambique", siteIds: ["f5423b3b-10e9-47cc-8a29-4c105d8db34e"], aliases: ["Rob's Bottom", "Rob’s Bottom"] },
    { names: ["Antonio Lorenzo"], country: "France", siteIds: ["ab94ccc5-5d74-4b77-b165-78528dc2fc74"], aliases: ["Épave Antonio Lorenzo"] },
    { names: ["Beacon Reef"], country: "Thailand", siteIds: ["3f5d156f-972f-4233-a877-072299333043"], aliases: ["灯塔礁", "燈塔礁"] },
    { names: ["Playa Hundu"], country: "Curaçao", siteIds: ["6e402cd1-46c1-407e-ad8f-2d4d4deb0acf"], aliases: ["Playa Hundu Lost Anchor"] },
    { names: ["The Ozone Shipwreck"], country: "Australia", siteIds: ["0bf8bec7-34f1-4f09-b168-7299956327f1"], aliases: ["PS Ozone"] },
    { names: ["Harbor Reef / Pilot Boat"], country: "Aruba", siteIds: ["76f0c2d0-4311-48ce-87b8-72486447660c"], aliases: ["Harbour Reef (Pilot Boat)"] },
    { names: ["Rio de Janeiro (Wreck)"], country: "Brazil", siteIds: ["35e28508-5e17-4204-b4af-e522ef01a048"], aliases: ["Califórnia", "Naufrágio Rio de Janeiro"] },
    { names: ["Hunga"], country: "Tanzania, United Republic of", siteIds: ["1567c9c6-b802-495e-8806-f3ebd8b7075b"], aliases: ["Hunga Reef"] },
    { names: ["Greta’s Place"], country: "Indonesia", siteIds: ["8c1e01b7-0720-48b0-9609-b6ae533d4ce6"], aliases: ["Greta's Place"] },
    { names: ["Tanjung Sari"], country: "Indonesia", siteIds: ["0065fbde-eedb-4a84-9090-681db8231781"], aliases: ["Shark Point", "Citizen Point"] },
    { names: ["Lovers Point"], country: "United States", siteIds: ["41c6748c-b744-4336-a43f-7c23e5ec6417"], aliases: ["Lovers Point Park"] },
    { names: ["Catherine Hill Coal Loader"], country: "Australia", siteIds: ["eb357347-3fd5-46d3-8cfb-1ad4fc3c06df"], aliases: ["Catherine Hill Bay Coal Loader Wreck"] },
    { names: ["Papa Whisky, Tahiti"], country: "French Polynesia", siteIds: ["5257f10c-cee5-4e52-a116-aa81fd4090ca"], aliases: ["Radio Whisky"] },
    { names: ["MV Mikhail Lermontov, wreck"], country: "New Zealand", siteIds: ["ed881db2-13c8-46d5-8a61-eb4be435e587"], aliases: ["Михаил Лермонтов"] },
    { names: ["Kary&#039;s smiles"], country: "France", siteIds: ["6da2a809-260e-4030-9fe5-c2a033cceca3"], aliases: ["Kary’s smile", "Kary's smile"] },
    { names: ["Yenkoranu"], country: "Indonesia", siteIds: ["9c1ffb99-ec83-4cb4-a672-aac0d8fe4a1b"], aliases: ["Yenkoranu Jetty", "Yenkoranu码头", "Yenkoranu碼頭"] },
    { names: ["7 Miles Reef"], country: "South Africa", siteIds: ["79110285-4b77-4990-b2b2-253ae6384769"], aliases: ["7 Mile Reef", "Seven Mile Reef"] },
    { names: ["Punta dels Farallons"], country: "Spain", siteIds: ["b5274c24-94c7-4b63-bfd4-18e546741756"], aliases: ["Pta Farallons S"] },
    { names: ["Crystal Palace, Rottnest Island"], country: "Australia", siteIds: ["7f94c6e0-d7cb-4230-b540-6c6f31b29170"], aliases: ["Crystal Palace (Dyer Island)"] },
    { names: ["Monkey Head"], country: "Costa Rica", siteIds: ["cfb18626-6e89-4716-8cde-ecaa2954e823"], aliases: ["Cabeza de Mono"] },
    { names: ["Merimbula Wharf"], country: "Australia", siteIds: ["602d9dfd-396f-488c-b810-d7591aa79b81"], aliases: ["Merimbula Jetty", "Merimbula Aquarium Wharf"] },
    { names: ["IRAKO"], country: "Philippines", siteIds: ["55b7c378-4eaa-4bae-909a-c5e057f50660"], aliases: ["伊良湖", "イラコ", "Irako Wreck", "Irako Maru"] },
    { names: ["Airplane Wreck (Santa Martha)"], country: "Curaçao", siteIds: ["e618f974-c49f-449d-b837-5b68f2458bc8"], aliases: ["Santa Martha Bay"] },
    { names: ["Bidadari"], country: "Indonesia", siteIds: ["89b64627-03e6-4927-8132-fd4c6f4f7cda"], aliases: ["天使岛", "比达达里岛", "Angel Island"] },
    { names: ["Betty Blue"], country: "Sweden", siteIds: ["d80053e4-ff9e-4341-9777-e5e4a7cbe993"], aliases: ["Vraket Betty Blue", "Betty Blue Gålö"] },
    { names: ["Blue & White"], country: "Guam", siteIds: ["23fc1474-39e1-403c-ad3c-bd02a264adad"], aliases: ["Blue and White"] },
    { names: ["Secret Bay"], country: "Indonesia", siteIds: ["d88f0af5-9a54-4df8-9475-2ba8eacb252f"], aliases: ["秘密海湾", "Gilimanuk Bay"] },
    { names: ["El Corsario"], country: "Mexico", siteIds: ["f78f53a0-feca-43fb-93c8-cb408883452c"], aliases: ["Barco Hundido El Corsario"] },
    { names: ["Papetoai Aquarium"], country: "French Polynesia", siteIds: ["c46b8903-c9e0-4ef7-9ea3-680ffa2c6626"], aliases: ["Aquarium de Papetoai"] },
    { names: ["Malvin Norte"], country: "Spain", siteIds: ["b33bb16a-a5cd-4e67-91f7-31e1be35e637"], aliases: ["Malvin del Norte", "Malvin North"] },
    { names: ["Divers Leap"], country: "Curaçao", siteIds: ["3f2e1fee-7171-4573-ac05-474e92660984"], aliases: ["Diver's Leap", "Diver’s Leap"] },
    { names: ["Steve’s Bommie - Ribbon No 3 Reef"], country: "Australia", siteIds: ["c901930e-1d1b-4ccc-86e0-d09fd7fa5bee"], aliases: ["Steve's Bommie"] },
    { names: ["The BISTRO - Shark Dive AQUATREK"], country: "Fiji", siteIds: ["9d51205e-9bdb-415e-976d-8193c18175d7"], aliases: ["Aquatrek - The Bistro"] },
    { names: ["La Cheminée"], country: "France", siteIds: ["27164f82-2df6-4886-b18a-e31d0d7b47b0"], aliases: ["La Cheminée, Cap Homard"] },
    { names: ["Bat Island: Big Scare, Gran Susto"], country: "Costa Rica", siteIds: ["142d8068-95a5-4bb1-bf14-cbe3cce37a97"], aliases: ["El Gran Susto"] },
    { names: ["Illetes"], country: "Spain", siteIds: ["1ae5ef0a-e294-4a21-94d5-a86f2b6dba48"], aliases: ["Illetas"] },
    { names: ["Norman Wildside - Central"], country: "Australia", siteIds: ["cfc278cf-3bcb-4239-a502-eceb65ed2c3d"], aliases: ["Norman Reef Wildside Central", "Wildside Central - Norman Reef"] },
    { names: ["Passe de 3 Bassins"], country: "France", siteIds: ["2f569041-71a9-4003-ae22-e2eaa8e2c15b"], aliases: ["Passe de Trois Bassins", "Passe des Trois Bassins"] },
    { names: ["Les Grottes du Portail"], country: "France", siteIds: ["f7a49cd6-36df-4cea-92ec-8725874286dd"], aliases: ["Grottes à Requins", "Grotte aux requins"] },
    { names: ["Labyrinth/Kenny’s Reef"], country: "Honduras", siteIds: ["3d557b45-f5e1-4b83-a4f1-11fd8d1415ca"], aliases: ["Kenny's Reef", "Labyrinth / Kenny's Reef"] },
    { names: ["ART Reef by Vhils"], country: "Portugal", siteIds: ["b37ac760-ccc8-45f7-bcb1-ef2dd365725a"], aliases: ["EDP Art Reef by Vhils"] },
    { names: ["Sandy’s Plateau"], country: "Curaçao", siteIds: ["67e67636-02cb-4562-9545-759738e86517"], aliases: ["Sandy's Plateau"] },
    { names: ["Mikes Cupboard"], country: "Mozambique", siteIds: ["5e8cf94d-9c2a-44b8-994d-3c792d40dffb"], aliases: ["Mike's Cupboard"] },
    { names: ["Plavi Jadran"], country: "Croatia", siteIds: ["085d1464-2753-47ab-94d9-f985f0d90ebc"], aliases: ["Olupina Plavi Jadran"] },
    { names: ["Punt Canon"], country: "Curaçao", siteIds: ["3ab87c09-7b7d-4a6f-8429-3826e8669c84"], aliases: ["Punt Kanon", "Awa di Oostpunt"] },
    { names: ["Miralles, Wreck"], country: "Argentina", siteIds: ["d9d34360-8bce-4ba3-b045-fbdd6a44004e"], aliases: ["Naufragio Miralles", "Pecio Miralles"] },
    { names: ["Stillwater Cove"], country: "United States", siteIds: ["be005703-dd76-4f12-8f96-5082d78d46d4"], aliases: ["Stillwater Cove (Sonoma)"] },
    { names: ["Basura"], country: "Philippines", siteIds: ["8ff87784-f4aa-407d-939f-c90198622e50"], aliases: ["バスラ"] },
    { names: ["Desecheo Island"], country: "United States", siteIds: ["b3e264c6-ff67-4490-aaee-e789a89735a8"], aliases: ["Isla Desecheo", "Isla de Desecheo"] },
    { names: ["Kary&#039;s smiles"], country: "France", siteIds: ["6da2a809-260e-4030-9fe5-c2a033cceca3"], aliases: ["Kary's smiles"] },
    { names: ["Malayan (Wreck)"], country: "Philippines", siteIds: ["b8845c66-07a6-466f-b7ab-f6a6b3db633d"], aliases: ["Malayan Wreck"] },
    { names: ["Punta de las Animas"], country: "Spain", siteIds: ["5a91e785-875e-49f7-bbec-d905f5b1bd75"], aliases: ["Punta de las Ánimas"] },
    { names: ["Kirby’s Rock"], country: "Philippines", siteIds: ["6be51d29-3237-46ba-95a6-4b269c72bac3"], aliases: ["Kirby's Rock"] },
    { names: ["Récif Tabu"], country: "New Caledonia", siteIds: ["55f915ec-4966-4c76-ada6-d43ef0bb8946"], aliases: ["Récif Tabou"] },
    { names: ["Scotts Head Drop Off"], country: "Dominica", siteIds: ["f982218a-7056-4545-90f1-e1fd9cd6ed16"], aliases: ["Scott’s Head Drop Off", "Scott's Head Drop Off"] },
    { names: ["Lagon de St. François"], country: "France", siteIds: ["4003bbe4-dda5-43ac-a958-9c670e036a6c"], aliases: ["Lagon de Saint-François", "Lagoon of Saint François"] },
    { names: ["La Diéppoise, wreck"], country: "New Caledonia", siteIds: ["2627a1e1-e7f2-4594-ad2d-47e4613a6dac"], aliases: ["Épave de la Dieppoise", "Dieppoise wreck"] },
    { names: ["Banco Rosario"], country: "Madagascar", siteIds: ["f3488e05-f2ee-4c83-9c12-7327a9464629"], aliases: ["Banc Rosario", "Rosario Bank", "Rosario Plateau"] },
    { names: ["Jane Sea (Wreck)"], country: "Aruba", siteIds: ["571a42b7-9ca2-46b8-88e3-881dd82e7be9"], aliases: ["Jane C", "Jane C Wreck"] },
    { names: ["Cova do Sonho"], country: "Portugal", siteIds: ["7929b0a8-71d7-49b3-bbdc-0e0cd13f5206"], aliases: ["Cova do Sono"] },
    { names: ["Shag Rock - Sunken Reef"], country: "Australia", siteIds: ["de39f297-c670-47ba-93cd-d3c7bd57ad8b"], aliases: ["Sunken Reef"] },
    { names: ["Arco Iris, Brumel Island"], country: "Costa Rica", siteIds: ["74bf02c6-554a-496a-a725-8f9827c78903"], aliases: ["Rainbow"] },
    { names: ["Naufragio Agenor Gordilho"], country: "Brazil", siteIds: ["f768eead-e5e5-4604-92ba-c630e6bd2daf"], aliases: ["Ferry Boat Agenor Gordilho", "Ferry-boat Agenor Gordilho"] },
    { names: ["Olaf Sakatia"], country: "Madagascar", siteIds: ["30607579-1a04-4b69-b0d5-0961032d3af4"], aliases: ["Olaf", "Olaf's Reef", "Olaf’s Reef"] },
    { names: ["KT Mawar"], country: "Mauritius", siteIds: ["4ad64321-8fc4-42dd-b956-94b224952934"], aliases: ["KT Mawar Wreck", "Épave du KT Mawar"] },
    { names: ["Harley Reef"], country: "Guam", siteIds: ["a3f634ba-6309-4ca9-bb79-78cd2a342e84"], aliases: ["ハーレーリーフ"] },
    { names: ["Cathedral II"], country: "United States", siteIds: ["2af18893-b9b5-43f7-ba93-9664a7db5d15"], aliases: ["Second Cathedral", "Cathedral 2", "Cathedral #2"] },
    { names: ["Albatros, wreck"], country: "Argentina", siteIds: ["dbe611ec-5035-4b00-ab6f-28aa8a257371"], aliases: ["Naufragio Albatros"] },
    { names: ["Coco Reef"], country: "Dominican Republic", siteIds: ["766d4402-47b8-4b3e-bbc6-678dfb525a21"], aliases: ["Cocco Reef", "Coco Reef Coral Nursery"] },
    { names: ["Stragglers' Reef"], country: "United States", siteIds: ["89924a24-0149-4fb8-a6fd-c5247070dae1"], aliases: ["Stragglers", "The Stragglers", "Stragglers Rocks"] },
    { names: ["Kuata Back Reef"], country: "Fiji", siteIds: ["bdfccb63-45d4-41ad-8928-133021b2d367"], aliases: ["Back Wall"] },
    { names: ["Tavaniko Point"], country: "Fiji", siteIds: ["ec2c62f0-3cac-44b3-ae8f-e2f6710c58d4"], aliases: ["Tavuniko Point"] },
    { names: ["Underwater Military Museum"], country: "Jordan", siteIds: ["1ebb8a13-271b-41ed-a6f2-808c4013a0fc"], aliases: ["水下军事博物馆", "水下軍事博物館", "海底军事博物馆", "Military Museum"] },
    { names: ["Dredger Rock, Mahé"], country: "Seychelles", siteIds: ["573cdce9-6eb6-49c8-8c21-dc52ee81eaed"], aliases: ["Dredger Wreck"] },
    { names: ["Corporal  Meiss (37)"], country: "Bonaire, Sint Eustatius and Saba", siteIds: ["586355d1-6730-49ad-84a6-5a7e686a0d8a"], aliases: ["North Belnem", "Dick's Place", "Dick’s Place"] },
    { names: ["Doc Poulson (Wreck)"], country: "Cayman Islands", siteIds: ["62aed15d-7296-421b-8de6-45817d49f9e8"], aliases: ["Doc Paulson", "Doc Poulson沉船", "Doc Poulson号"] },
    { names: ["Kondey Kandu"], country: "Maldives", siteIds: ["85a0239e-629d-43dd-ae5c-ebfebcf1432b"], aliases: ["Kodey Kandu"] },
    { names: ["Shaab Nakari"], country: "Egypt", siteIds: ["d9f2d22d-29ec-4ae4-be3a-820eede44fac"], aliases: ["Sha'ab Nakari", "Sha’ab Nakari"] },
    { names: ["MAHURANGI IS/ GOAT IS"], country: "New Zealand", siteIds: ["2c340867-373d-4e59-90c8-f4f2bf4e3009"], aliases: ["Mahurangi Island", "Mahurangi Goat Island"] },
    { names: ["Trinity Caves"], country: "Cayman Islands", siteIds: ["642c6ddc-627b-44a4-bfe0-e8374f58f361"], aliases: ["三一洞穴"] },
    { names: ["Ilha Josefa"], country: "Brazil", siteIds: ["8cf67abe-b14a-4a7b-8e68-e1812f59c6c4"], aliases: ["Ilha da Josefa", "Josefa Island"] },
    { names: ["Jackson's Bar"], country: "India", siteIds: ["91684de9-4487-4d3e-a210-e8842d68e5a9"], aliases: ["Jackson’s Bar"] },
    { names: ["Kunaavashi Kandu"], country: "Maldives", siteIds: ["d3daa08e-0258-41f2-ac04-4db902a8f7de"], aliases: ["ކުނާވަށި ކަނޑު"] },
    { names: ["Joe Patti Memorial Reef (Wreck)"], country: "United States", siteIds: ["735af4f4-be63-4927-aebd-7c77084f01c6"], aliases: ["Joe Patti Barge"] },
    { names: ["Texas (The Point)"], country: "Honduras", siteIds: ["4b12ab67-95b9-4179-a1d9-53d55b59697d"], aliases: ["Texas Point"] },
    { names: ["Sunrise Beach - Horsetooth Reservoir"], country: "United States", siteIds: ["e7de3575-6dbb-4322-bbe9-92a4126bf42b"], aliases: ["Sunrise Beach"] },
    { names: ["Punta Falconiera"], country: "Italy", siteIds: ["5e5234fe-7df5-4b99-8ba8-dbe92cc53ff7"], aliases: ["La Falconiera"] },
    { names: ["Velassaru Cave"], country: "Maldives", siteIds: ["6d4aaf60-4997-4ec7-bdcd-926f05069418"], aliases: ["Velassaru Caves", "Vellasaru Caves"] },
    { names: ["Seven Octopuses"], country: "Mexico", siteIds: ["ca5b2b82-951e-48b1-9ebd-5d4a4cd1d97c"], aliases: ["Siete Pulpos"] },
    { names: ["Astron, wreck"], country: "Dominican Republic", siteIds: ["69375b66-92fe-421b-a739-aae7fcb82ec6"], aliases: ["Pecio Astron", "El Astron"] },
    { names: ["Adabanko Reef"], country: "Türkiye", siteIds: ["926985f0-5350-4b2e-8ce8-81ce7f8dd2a3"], aliases: ["Adabanko", "Ada Banko", "Adabanko Resifi"] },
    { names: ["Maakandu Outside"], country: "Maldives", siteIds: ["6485eb80-7fbe-463f-9a45-372781f59562"], aliases: ["Maa Kandu Beyru"] },
    { names: ["South Canyon Watamu"], country: "Kenya", siteIds: ["010c5af7-788d-4513-8e65-437825b610d6"], aliases: ["South Canyon"] },
    { names: ["Urisee"], country: "Austria", siteIds: ["d12fe680-f538-4350-ab2f-0274ea4636d4"], aliases: ["Lake Uri"] },
    {"names": ["Cantarell"], "country": "Mexico", "siteIds": ["e6fb3343-fc6b-4aea-9613-b13f41aae086"], "aliases": ["Eagle Ray Wall", "Cantarel"]},
    {"names": ["Baxter’s Reef"], "country": "New Zealand", "siteIds": ["913e43c6-0029-4795-a3bf-bd7cc96620eb"], "aliases": ["Baxter's Reef", "Baxters Reef"]},
    {"names": ["KeiSei 113, Wreck"], "country": "Mauritius", "siteIds": ["60364769-e865-49d0-901d-f70e038d82d1"], "aliases": ["Kei Sei 113"]},
    {"names": ["Grecian  Rocks"], "country": "United States", "siteIds": ["59314a0a-a09b-4d1c-b8f0-ba1ed49fee69"], "aliases": ["Grecian Reef"]},
    {"names": ["Big Fish Country"], "country": "Indonesia", "siteIds": ["bc0f1812-e765-4666-ab16-314381875989"], "aliases": ["Maratua Channel"]},
    {"names": ["Siren’s"], "country": "Malta", "siteIds": ["ea3f2294-7b24-4a4b-837e-6093ff1a12f0"], "aliases": ["Siren's", "Siren's Bay", "Siren’s Bay"]},
    {"names": ["Fuikbaai / Newport"], "country": "Curaçao", "siteIds": ["33d1beb2-dad9-484e-94af-15af347db1b5"], "aliases": ["Nieuwpoort"]},
    {"names": ["Arashi (Wreck)"], "country": "Aruba", "siteIds": ["32db2a12-6be7-473c-bfd8-9a33c745b2cd"], "aliases": ["Arashi Airplane", "Arashi Reef"]},
    {"names": ["Boduhiti Thila"], "country": "Maldives", "siteIds": ["add13722-08c1-430d-b65d-143a23f24930"], "aliases": ["Bodu Hithi Thila", "Boduhithi Thila"]},
    {"names": ["Sanur Beach"], "country": "Indonesia", "siteIds": ["3b0951af-6a52-45b9-aad3-b092bd19f237"], "aliases": ["沙努尔海滩", "萨努尔海滩", "サヌールビーチ", "Pantai Sanur"]},
    {"names": ["Arguineguin Reef"], "country": "Spain", "siteIds": ["a61fa352-b089-4c2c-a96b-91053c398a14"], "aliases": ["Baja de Arguineguín", "Arrecife de Arguineguín"]},
    {"names": ["Petites Jorasses, Anses-d&#039;Arlet"], "country": "France", "siteIds": ["1247df7a-32a3-4e62-a0d2-5236285e74f7"], "aliases": ["Petites Jorasses, Anses-d'Arlet", "Les Petites Jorasses"]},
    {"names": ["La Main Jaune"], "country": "France", "siteIds": ["ab058a16-9e32-4931-a7b9-85b5592c4336"], "aliases": ["The Yellow Hand"]},
    {"names": ["Cenote Maravillas"], "country": "Mexico", "siteIds": ["163b0881-939e-4a85-b8d1-66847824d159"], "aliases": ["Chim Chan Luub", "Cenote Maravilla"]},
    {"names": ["Ashos Gap (Shark Cleaning Station)"], "country": "Australia", "siteIds": ["f34f9741-1c30-4eef-a156-cda77e5d3cd4"], "aliases": ["Asho's Gap", "Asho’s Gap"]},
    {"names": ["Komati Springs"], "country": "South Africa", "siteIds": ["8b6fd3a9-e597-4e7b-bfb4-9e7db7bad741"], "aliases": ["Badgat"]},
    {"names": ["Taurus e Virgo"], "country": "Brazil", "siteIds": ["d35b86ad-f267-4ae2-a170-dcb828e17a61"], "aliases": ["Naufrágios Taurus e Virgo"]},
    {"names": ["La Zélée, Tahiti"], "country": "French Polynesia", "siteIds": ["b3216bf1-4453-43b8-a6b9-f0dcd3da708e"], "aliases": ["Épave La Zélée", "Épave de la Zélée"]},
    {"names": ["Ta Cenc"], "country": "Malta", "siteIds": ["49e1eb98-6469-4d87-9f1a-989dbd8c7562"], "aliases": ["Ta' Ċenċ", "Ta’ Ċenċ", "Ta' Cenc", "Ta’ Cenc"]},
    {"names": ["Three Sisters Komodo"], "country": "Indonesia", "siteIds": ["fc99bf53-d6dc-4248-b617-17926a45c1ac"], "aliases": ["Tiga Dara"]},
    {"names": ["Isla Murada"], "country": "Spain", "siteIds": ["dec213a5-5d81-4586-b206-2814d73af6af"], "aliases": ["Illa Murada"]},
    {"names": ["Tabyanas"], "country": "Honduras", "siteIds": ["74c5c139-f5df-4922-a902-f300a1b538a2"], "aliases": ["Tabyana", "Herbie's Fantasy", "Herbie’s Fantasy", "Herbie's Place", "Herbie’s Place"]},
    {"names": ["Small Reef"], "country": "Türkiye", "siteIds": ["632144e2-7ae8-47f3-be26-0ae3e379685e"], "aliases": ["Küçük Resif"]},
    {"names": ["Sandy Island Garden, Carriacou"], "country": "Grenada", "siteIds": ["bd37c2f2-86b5-41d2-b423-988db05f33d5"], "aliases": ["Sandy Garden"]},
    {"names": ["St Annaland"], "country": "Netherlands", "siteIds": ["b9e4f7d2-110c-459a-8a4f-19a6ff80f399"], "aliases": ["Sint Annaland", "Sint-Annaland"]},
    {"names": ["Catuan (Wreck)"], "country": "Dominican Republic", "siteIds": ["bcca874b-0894-4303-bfba-42710cad7888"], "aliases": ["Naufragio Catuán", "El Catuán"]},
    {"names": ["Kuata Front Reef"], "country": "Fiji", "siteIds": ["fb18e3f9-3328-41cd-8c6c-de123a542f10"], "aliases": ["Kuata Beach"]},
    {"names": ["Blue Cave"], "country": "Honduras", "siteIds": ["da3eab51-d425-46d1-9bfe-0f4071f177d9"], "aliases": ["The Cave"]},
    {"names": ["Les Arches de Sakatia"], "country": "Madagascar", "siteIds": ["b248f341-b670-4c0f-8502-263b1e331622"], "aliases": ["The Sakatia Arches", "Ark of Sakatia"]},
    {"names": ["Madrépore Manta Point"], "country": "Madagascar", "siteIds": ["c16803d9-eec5-46e6-a24b-d1fe176a9f2d"], "aliases": ["Madrépore"]},
    {"names": ["Angels Canyon Bali"], "country": "Indonesia", "siteIds": ["184027e0-da19-4609-a4cc-d364941c62cc"], "aliases": ["エンジェルス・キャニオン", "Angel’s Canyon", "Angel's Canyon"]},
    {"names": ["Brixham Breakwater Beach"], "country": "United Kingdom", "siteIds": ["190b24f9-c4f7-4e53-8658-f798f6a07a92"], "aliases": ["Brixham Breakwater"]},
    {"names": ["Parasasa Beach / Crash Site"], "country": "Curaçao", "siteIds": ["39391cc4-c7a1-477a-89d1-161eaa5dc514"], "aliases": ["The Crash"]},
    {"names": ["Kleine Knip"], "country": "Curaçao", "siteIds": ["d1b816f9-6aa1-4690-8758-7c6adab8bbe3"], "aliases": ["Kenepa Chiki", "Playa Kenepa Chiki"]},
    {"names": ["Alcyone, Cocos Island"], "country": "Costa Rica", "siteIds": ["45488ac1-44ce-43f0-af6a-0c1f8bd5e79b"], "aliases": ["Bajo Alcyone", "바호 알시오네", "バホ アルシオン", "バホ・アルシオーネ"]},
    {"names": ["Jackson Wall and Reef - Grand Cayman"], "country": "Cayman Islands", "siteIds": ["77c2bb76-23f0-4730-808b-156b39bd930a"], "aliases": ["Jackson Wall", "Jackson Wall Little Cayman"]},
    {"names": ["3rd Gutter"], "country": "Australia", "siteIds": ["f96388e1-860d-492b-9624-b41bd6c18ade"], "aliases": ["Third Gutter"]},
    {"names": ["Cod Hole"], "country": "Australia", "siteIds": ["6e4a2734-dfa0-4d1e-920d-cf8e66df9310"], "aliases": ["The Cod Hole (Port Macquarie)"]},
    {"names": ["Soufreire Pinnacles"], "country": "Dominica", "siteIds": ["d08905ad-5b96-4a76-8f82-939ae983a206"], "aliases": ["Soufriere Pinnacles", "Soufrière Pinnacles"]},
    {"names": ["Golden Dream"], "country": "Fiji", "siteIds": ["a846e807-77d8-4ee6-b7d5-ec9f872a6f9d"], "aliases": ["Golden Dreams"]},
    {"names": ["King Abdullah Reef"], "country": "Jordan", "siteIds": ["3902553f-4123-4a82-8e45-fb7a87a66722"], "aliases": ["شعاب الملك عبد الله"]},
    {"names": ["Coffins Patch"], "country": "United States", "siteIds": ["5688b63b-fcf0-4072-975a-edeeba2ec8f0"], "aliases": ["Coffin's Patch", "Coffin’s Patch"]},
    {"names": ["Agujeros azules"], "country": "Spain", "siteIds": ["d3f5c61c-86a3-4c89-b65f-3838c39a5c9d"], "aliases": ["The Blue Holes"]},
    {"names": ["Bambous"], "country": "Mauritius", "siteIds": ["21e79efd-dacb-4085-8b8a-5b6fe0c2f96d"], "aliases": ["Colin Bambous", "Collin Bambous"]},
    {"names": ["Lady Musgrave Aquarium"], "country": "Australia", "siteIds": ["ccb37717-c2e6-4fe3-b9a6-0751f6254a40"], "aliases": ["The Aquarium (Lady Musgrave Lagoon)", "Aquarium Reef"]},
    {"names": ["Half Moon Wall"], "country": "Honduras", "siteIds": ["27e59af6-fab7-4088-a923-435d9e655167"], "aliases": ["Half Moon Bay Wall"]},
    {"names": ["Taket Malang"], "country": "Indonesia", "siteIds": ["a4806b88-484e-4070-a4bc-d2a7945213e3"], "aliases": ["Takat Malang"]},
    {"names": ["Monastery Beach"], "country": "United States", "siteIds": ["480018de-2156-4e5e-865e-4772a0ea819e"], "aliases": ["San Jose Creek Beach", "修道院海滩"]},
    {"names": ["The Arch"], "country": "United States", "siteIds": ["c7f95ee8-b75c-44d5-ba09-16c5c5c3f932"], "aliases": ["Cayo Yerba"]},
    {"names": ["Boulders Beach"], "country": "South Africa", "siteIds": ["ec0c5efd-0e4d-4b53-ac46-c19e1970e51c"], "aliases": ["企鹅滩", "博爾德斯海灘", "ボルダーズ・ビーチ", "ボルダーズビーチ"]},
    {"names": ["Grand coude de Kele"], "country": "New Caledonia", "siteIds": ["89f244b5-d45a-4c42-aec1-690a2649433e"], "aliases": ["Great Elbow of Kele", "Kélé elbow"]},
    {"names": ["Black Island “WONDERWALL“"], "country": "Australia", "siteIds": ["0c470ad6-c1ee-48b5-b5b7-dfa7996b1a29"], "aliases": ["Black Island Wonderwall"]},
    {"names": ["Circle Divers Dahab House Reef"], "country": "Egypt", "siteIds": ["e326f2f9-5eba-4d95-bb1b-0f1374468e1d"], "aliases": ["Circle Divers House Reef", "House Reef Dahab"]},
    {"names": ["Landers"], "country": "South Africa", "siteIds": ["968f00fd-9d22-45a9-9c1e-ebed7a2443ab"], "aliases": ["Landers Reef"]},
    {"names": ["Monkey Reef"], "country": "Indonesia", "siteIds": ["e11bb2a9-f5a7-4353-a1c1-cb5ddf317810"], "aliases": ["Kubu Monkey Reef"]},
    {"names": ["La Baleine"], "country": "France", "siteIds": ["cc944eb9-6b98-4283-8e16-f190e78edc5a"], "aliases": ["Pointe de la Baleine"]},
    {"names": ["Marico Oog"], "country": "South Africa", "siteIds": ["885a192e-00c1-478e-a9fa-0c583249e609"], "aliases": ["Marico Eye", "Eye of Marico"]},
    {"names": ["Pointe de la Croix"], "country": "France", "siteIds": ["0a4bd5e0-5cfd-446d-a716-875481fafd46"], "aliases": ["La Pointe de la Croix"]},
    {"names": ["Mainit Corner"], "country": "Philippines", "siteIds": ["afbe9cd8-3a04-429a-9bc6-60a22392e935"], "aliases": ["Mainit Point"]},
    {"names": ["Miyaru Faru"], "country": "Maldives", "siteIds": ["03cb6366-da66-4530-a14c-fdcdcc8c5fde"], "aliases": ["Shark Reef"]},
    {"names": ["Pablo’s Place"], "country": "Honduras", "siteIds": ["08d7008e-a159-4143-9be3-3c3332d6cb7a"], "aliases": ["Pablo's Place", "Pablos Place"]},
    {"names": ["Ponte JK"], "country": "Brazil", "siteIds": ["1635c9cd-1339-4188-808a-e6e7290d23f3"], "aliases": ["Ponte Juscelino Kubitschek", "Terceira Ponte"]},
    {"names": ["Tabularasa Wreck"], "country": "Indonesia", "siteIds": ["f26ce855-009c-4f88-9a1a-01e15ad0be3d"], "aliases": ["Kapal AUP"]},
    {"names": ["Chocolate Island Malapascua"], "country": "Philippines", "siteIds": ["5924325a-64b7-467a-b5f1-610780af9fc1"], "aliases": ["巧克力岛", "巧克力島", "초콜릿 아일랜드"]},
    {"names": ["THE TWINS, Waikato"], "country": "New Zealand", "siteIds": ["ab094605-bb15-4672-959e-86b9feb275ec"], "aliases": ["Motumāhanga"]},
    {"names": ["Seafan Valley"], "country": "Mauritius", "siteIds": ["b1ac6424-940b-4ea9-adcb-c3db0d5fd38c"], "aliases": ["Sea Fan Valley"]},
    {"names": ["Tangalooma Wrecks"], "country": "Australia", "siteIds": ["70522311-3758-4e75-bddb-e669970ca507"], "aliases": ["天阁露玛沉船区", "天閣露瑪沉船點", "天閣露瑪沉船區"]},
    {"names": ["Illa de Tirant"], "country": "Spain", "siteIds": ["f8aa363b-4425-402d-b9cc-c25e8cb4c7d8"], "aliases": ["Isla de Tirant"]},
    {"names": ["Gildenburgh Water"], "country": "United Kingdom", "siteIds": ["65ed87d5-f2d8-4180-8813-6723364ef3ce"], "aliases": ["Gildy", "Gildenburgh Waters"]},
    {"names": ["Cartanza Wreck"], "country": "United States", "siteIds": ["9a57549e-505b-4817-8653-0d6590f22549"], "aliases": ["Cartanza Senora", "Cartanza Señora", "Cartanser Senior"]},
    {"names": ["L’Eveillé"], "country": "Mauritius", "siteIds": ["d5127bc8-8326-4513-be14-685877d2d865"], "aliases": ["L'Eveillé"]},
    {"names": ["Dharavandhoo Thila"], "country": "Maldives", "siteIds": ["c3971099-2f0b-4bc8-aaa7-fada8389a643"], "aliases": ["Daravandhoo Thila"]},
    {"names": ["Turtle Town Maui"], "country": "United States", "siteIds": ["8b4feb83-2e0a-4e06-9ce5-f20c1203ff84"], "aliases": ["海龟镇", "海龜鎮", "タートルタウン"]},
    {"names": ["Tres Cocos Canyons"], "country": "Belize", "siteIds": ["da1e8a7b-d6ca-450f-b38a-c72d83d813d1"], "aliases": ["Three Coconuts"]},
    {"names": ["Corporal  Meiss (37)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["586355d1-6730-49ad-84a6-5a7e686a0d8a"], "aliases": ["North Belnem"]},
    {"names": ["Nukove (7)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["ddf9850e-de6a-4382-a901-001e8c5e539a"], "aliases": ["Doblet"]},
    {"names": ["Red Slave (60)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["7ea08fd0-ff4e-4ef9-9dab-26c0932f862f"], "aliases": ["Peleké"]},
    {"names": ["Salt City (50)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["20177891-974a-4a32-835a-c49db9947eaf"], "aliases": ["Salina Abou"]},
    {"names": ["Tori’s Reef (52)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["bb2e06a3-8071-477a-ad5e-5f469fdf8aa9"], "aliases": ["Tori's Reef"]},
    {"names": ["Labyrinth"], "country": "Cook Islands", "siteIds": ["947bd9ce-970c-42b6-9101-4a01eb161cf8"], "aliases": ["Dave’s Cave", "Dave's Cave", "The Maze", "Croc Caverns", "Nikao Tunnels", "Blackrock Tunnels"]},
    {"names": ["Cod Hole - Ribbon No 10 Reef - GBR"], "country": "Australia", "siteIds": ["355e4281-b48a-441b-a457-189193a0012f"], "aliases": ["The Cod Hole"]},
    { names: ["Sabolan Besar"], country: "Indonesia", siteIds: ["b7f1b55b-9dea-4e77-a3ed-f3f89a8f0d05"], aliases: ["Sabolon Besar"] },
    { names: ["Yanui Beach"], country: "Thailand", siteIds: ["a42c326d-baf8-46b8-9f7b-b1034570f531"], aliases: ["雅努伊海滩", "雅努伊海灘", "ヤヌイ・ビーチ", "Ya Nui Beach"] },
    { names: ["tinderbox"], country: "Australia", siteIds: ["1c3466e7-33dc-4601-a1f2-2fc1213f2743"], aliases: ["Tinderbox Marine Reserve", "Tinderbox Marine Nature Reserve"] },
    { names: ["Hastings Reef - Fish Bowl"], country: "Australia", siteIds: ["9b26d171-6e47-48ca-ac2c-825931f104f0"], aliases: ["Fish Bowl (Hastings Reef)", "The Fishbowl", "The Fish Bowl"] },
    { names: ["Lighthouse Bommie - Lady Elliot Island"], country: "Australia", siteIds: ["3a3cff3e-2980-49b4-b710-2cab269305a8"], aliases: ["Lighthouse Bommies"] },
    { names: ["Protea Banks"], country: "South Africa", siteIds: ["72e79523-8146-4f02-b6a2-5316870c92e6"], aliases: ["普羅蒂亞淺灘", "プロティアバンクス"] },
    { names: ["Office"], country: "Mozambique", siteIds: ["ec03649d-ca9c-4b69-845c-7946229c18c5"], aliases: ["The Office", "Office Reef"] },
    { names: ["FRIWEN WALL"], country: "Indonesia", siteIds: ["ccc7232b-8591-44df-afe7-264d8239566a"], aliases: ["弗里温墙", "Friwin Wall", "弗里文·沃爾", "Friwinbonda"] },
    { names: ["Wahoo"], country: "Panama", siteIds: ["98bb60aa-62f5-4806-b0ef-e973fb5b28b3"], aliases: ["Wahoo Rock"] },
    { names: ["Le Tombant Saint Étienne"], country: "French Polynesia", siteIds: ["64e38d2a-24e5-4563-9488-b639923c5fe8"], aliases: ["Tombant St Etienne", "Tombant de Saint-Etienne"] },
    { names: ["First Bay North"], country: "Jordan", siteIds: ["171d149c-42f2-4b42-8b85-e174ab8329e6"], aliases: ["First Bay (North)"] },
    { names: ["Maui"], country: "United States", siteIds: ["a8175384-c1e0-4d79-89d6-f5327cf0cdf9"], aliases: ["毛伊岛", "茂宜岛", "毛伊島", "茂宜島", "マウイ島", "마우이"] },
    { names: ["Paliton Wall"], country: "Philippines", siteIds: ["6e7f69ee-b8be-4524-8c54-cb43884a4537"], aliases: ["帕里顿墙", "帕利顿墙", "帕里頓牆", "帕利頓牆", "パリトンウォール"] },
    { names: ["Coral Gardens - Dominican Republic"], country: "Dominican Republic", siteIds: ["f7ba4cfa-7334-4c08-b2b5-4a0eac7a18e8"], aliases: ["Jardines de Coral"] },
    { names: ["Shark Point Madagascar"], country: "Madagascar", siteIds: ["fd4e6c27-c3f6-42ad-bb2f-5956ca0a3502"], aliases: ["Grand Banc"] },
    { names: ["Martha’s Quarry"], country: "United States", siteIds: ["96a25b58-afe6-4525-8ac0-fa90eeca6d63"], aliases: ["Martha's Quarry"] },
    { names: ["Puako"], country: "United States", siteIds: ["ca333a10-a2e6-4a20-a01c-a9eda01cf100"], aliases: ["普阿科", "プアコー"] },
    { names: ["Gili Biaha, Candidasa"], country: "Indonesia", siteIds: ["e7c93632-7fc3-4b86-8542-b1955bec4edb"], aliases: ["吉利比亚哈", "鲨鱼洞", "ビアハ島", "Gili Bahia"] },
    { names: ["Faro"], country: "Panama", siteIds: ["8c948342-b7e8-4c13-9dd4-f8996eab446b"], aliases: ["El Faro", "Faro (Light House)"] },
    { names: ["Long Caye Wall"], country: "Belize", siteIds: ["defacca7-f177-4f5b-a896-7e53e38ad24a"], aliases: ["The Aquarium", "Aquarium (Long Caye Wall)"] },
    { names: ["Shark Bank"], country: "Seychelles", siteIds: ["420fdb84-136e-4e76-9273-1bb1a248ba13"], aliases: ["シャークバンク"] },
    { names: ["Vertigo"], country: "Micronesia, Federated States of", siteIds: ["185b08a5-18af-4fac-b15e-f493b9704359"], aliases: ["Vertigo (Yap)"] },
    { names: ["MV Produce, wreck"], country: "South Africa", siteIds: ["ab84dd3a-18ce-446d-905a-1aca6c1c448e"], aliases: ["MV Produce Wreck", "Produce Wreck"] },
    { names: ["Spooky Channel"], country: "Honduras", siteIds: ["50ece0ef-5763-4692-a8a4-3be73c552739"], aliases: ["Canal de terror"] },
    { names: ["El Gilwa"], country: "Egypt", siteIds: ["edd63795-ef07-4d93-89b4-d939f31a2aea"], aliases: ["El Gilwa Oost"] },
    { names: ["Batee Tokong"], country: "Indonesia", siteIds: ["ed08078d-6f7f-45b5-9447-8ba0bd703d61"], aliases: ["Istana Moray", "Bate Tokong"] },
    { names: ["Pinnacles"], country: "Australia", siteIds: ["c99d894b-67b3-4a71-bab1-31073abea0b7"], aliases: ["The Pinnacles"] },
    { names: ["Ilha Rasa - Portinho"], country: "Brazil", siteIds: ["6eb67abc-5da9-4db5-b6bc-7315bb0d8cc8"], aliases: ["Portinho - Ilha Rasa"] },
    { names: ["Wailea"], country: "United States", siteIds: ["2bbdb95d-3a33-41b4-85cb-13bb41b7cd4b"], aliases: ["威雷亚", "威雷亞", "ワイレア", "와일레아"] },
    { names: ["Silver Steps"], country: "United Kingdom", siteIds: ["87e1bd20-c5c1-405a-818e-68451b098a01"], aliases: ["Pendennis Point"] },
    { names: ["Cornelius Bay"], country: "Curaçao", siteIds: ["f69b3fc8-3e87-4bfa-8d80-4df092632ac2"], aliases: ["Corneliusbaai"] },
    { names: ["Cenote Zapote (Hells Bells)"], country: "Mexico", siteIds: ["5cfe1bd0-1dd7-4719-be5d-5b19aba1ebc1"], aliases: ["Hell's Bells", "Hell’s Bells", "Las Campanas del Infierno", "Cenote Campanas del Infierno"] },
    { names: ["Nudi Rock Raja Ampat"], country: "Indonesia", siteIds: ["684742eb-3050-4e8e-89f7-2330887bfbb6"], aliases: ["누디락", "누디 록"] },
    { names: ["Barracuda - Cozumel"], country: "Mexico", siteIds: ["915dd20e-6a59-4e1c-8812-341faba0b721"], aliases: ["Barracuda Reef", "Arrecife Barracuda"] },
    { names: ["Water Factory / Fisherman’s Wharf"], country: "Curaçao", siteIds: ["34166762-bdd7-48ba-b937-0deb4fe5f77b"], aliases: ["Fisherman's Wharf", "Fisherman's Wharf (Water Factory)"] },
    { names: ["Devil’s Grotto North"], country: "Cayman Islands", siteIds: ["7eab2f92-ad05-4183-a11d-c529057c71f6"], aliases: ["Devil's Grotto North", "Devils Grotto North"] },
    { names: ["Julian Rocks - Split Bommie"], country: "Australia", siteIds: ["98d5a30f-90bd-47f0-b39f-30b620525ca5"], aliases: ["Split Bombie"] },
    { names: ["Naufragio Blackadder"], country: "Brazil", siteIds: ["079cc5ba-464c-4093-bbd7-2aedb23a789a"], aliases: ["Naufrágio do Blackadder"] },
    { names: ["The Gutter"], country: "Australia", siteIds: ["aecabb5c-05a0-45dd-9f1d-ed23ef9a800f"], aliases: ["The Gutter (Shellharbour)"] },
    { names: ["MV Xlendi (Wreck)"], country: "Malta", siteIds: ["38d463e2-a606-4a9e-aa58-dd66112374ec"], aliases: ["MV Xlendi Wreck", "Xlendi Ferry"] },
    { names: ["Airport Beach"], country: "United States", siteIds: ["8c285735-8905-4cfb-ad5c-ffc466bda0a9"], aliases: ["Kahekili Beach Park", "Kahekili Beach", "Old Airport Beach"] },
    { names: ["Heron Island"], country: "Australia", siteIds: ["d285c440-80d5-4d4f-95ed-71ad89b38284"], aliases: ["赫伦岛", "苍鹭岛", "海龍島", "ヘロン島", "헤론 섬"] },
    { names: ["Blue Bay the Wall"], country: "Curaçao", siteIds: ["33992c4a-f2a0-41a9-b26e-e24cfbd8d053"], aliases: ["Blue Bay Wall"] },
    { names: ["Merika Falhagando"], country: "Maldives", siteIds: ["8f062f04-e258-4fcf-9d14-c46da3e9a22c"], aliases: ["Tiger Point", "Tiger Harbor", "Tiger Harbour", "Tiger Zone"] },
    { names: ["Tubod"], country: "Philippines", siteIds: ["e2913bb8-57e4-496d-9deb-864710bd08d9"], aliases: ["Tubod Sanctuary", "Tubod Marine Sanctuary", "图博德海洋保护区"] },
    { names: ["Dr. Grooms Garden"], country: "Grenada", siteIds: ["2a1c8c8f-f826-498c-a715-cc5abccb01a3"], aliases: ["Dr. Groom's Gardens", "Dr. Groom’s Gardens", "Dr. Grooms"] },
    { names: ["Gravel Loader"], country: "Australia", siteIds: ["bddb074e-3abe-4b98-889a-6eff3c2e75f4"], aliases: ["The Gravel Loader", "Bass Point Gravel Loader"] },
    { names: ["Deux Arches"], country: "France", siteIds: ["bf9d5bc5-6074-4911-a96c-0f45975f3f36"], aliases: ["Les Arches", "Les 2 Arches"] },
    { names: ["Cenote Nicte Ha"], country: "Mexico", siteIds: ["190410c1-6450-42b7-ba69-c6f93ad910a9"], aliases: ["Cenote Nic Te Ha", "Cenote Nicte-Ha"] },
    { names: ["Rubiah Sea Garden"], country: "Indonesia", siteIds: ["39e23346-16f7-4caa-96b4-4c367086d924"], aliases: ["Taman Laut Rubiah"] },
    { names: ["Les trois Pointes"], country: "France", siteIds: ["60af1508-8958-4aed-a60d-461506b351c3"], aliases: ["Les 3 pointes"] },
    { names: ["Flagstaff"], country: "Australia", siteIds: ["fc64e097-09a6-4513-8826-a6bdf553e9db"], aliases: ["Flag Staff", "Moon Island Bay"] },
    { names: ["Little Brother Cenote"], country: "Mexico", siteIds: ["edfd6550-3717-4c35-845c-eb5f5f078c5d"], aliases: ["Cenote Little Brother", "Little Brother"] },
    { names: ["Mellow Yellow"], country: "Fiji", siteIds: ["963c94c9-bbca-40b4-b778-7ea4eff811fc"], aliases: ["Yellow Mellow"] },
    { names: ["Anita’s Reef"], country: "Thailand", siteIds: ["c24e18ad-28db-4ac7-86b0-f8b0d3a5d07c"], aliases: ["Anita's Reef", "Hin Muan Deaw"] },
    {"names": ["Koh Yawa Bon"], "country": "Thailand", "siteIds": ["e3670e50-c03b-4192-8184-e82fd142ce5f"], "aliases": ["Koh Ya Wa Bon", "Yawabon"]},
    {"names": ["Museum of Underwater Art, Coral Greenhouse"], "country": "Australia", "siteIds": ["c536701a-077c-47a5-b901-6c3af0db4219"], "aliases": ["MOUA Coral Greenhouse"]},
    {"names": ["Light House"], "country": "Seychelles", "siteIds": ["1c942a17-6b21-4473-a23f-a787c1b4a6ba"], "aliases": ["Lighthouse"]},
    {"names": ["Flying Fish Cove (Jetty dive)"], "country": "Australia", "siteIds": ["99c7994a-e1d0-474b-883d-3ef4a9a7066d"], "aliases": ["飞鱼湾", "フライング・フィッシュ・コーブ"]},
    {"names": ["El Chuncho"], "country": "Peru", "siteIds": ["50423693-7de5-464b-8bed-ad63c6cb237b"], "aliases": ["El Chuncho - Pucusana"]},
    {"names": ["Saporken Dive Site"], "country": "Indonesia", "siteIds": ["eee06747-0a58-425f-bf80-b4b0932e8cbc"], "aliases": ["Saporkren", "Saporken Jetty"]},
    {"names": ["Hastings Reef Blue Lagoon"], "country": "Australia", "siteIds": ["76337322-2f18-4653-9769-9c5d9abcb54b"], "aliases": ["Blue Lagoon (Hastings Reef)"]},
    {"names": ["Poor Knights Island NZ"], "country": "New Zealand", "siteIds": ["446cda4d-38bf-4608-a949-418836837a87"], "aliases": ["普尔骑士群岛", "穷骑士群岛", "窮騎士群島", "プアナイツ諸島", "プアー・ナイツ諸島", "푸어 나이츠 제도", "푸어나이츠 군도"]},
    {"names": ["Piscina Olimpica U.N. Medellin"], "country": "Colombia", "siteIds": ["ad1b6dec-6edc-4d3b-a163-d8ca40ec1558"], "aliases": ["Piscina Olímpica Universidad Nacional Medellín"]},
    {"names": ["Beacon Point"], "country": "Curaçao", "siteIds": ["e2c27d80-c02d-4dd1-badd-ae2b2c02a811"], "aliases": ["Kabes di Baranka"]},
    {"names": ["Chloes Coral"], "country": "Honduras", "siteIds": ["5d9fe734-658f-4e96-860d-2940b82b5f8c"], "aliases": ["Chloe's Coral", "Chloe’s Coral"]},
    {"names": ["Alex  Cave"], "country": "Malta", "siteIds": ["b2270525-0a7a-4a7b-a74c-4a271deb6ac8"], "aliases": ["Alex's Cave", "Alex’s Cave", "Alex Cave", "Cominotto Cave"]},
    {"names": ["I Comprida - Face Norte"], "country": "Brazil", "siteIds": ["f70ac066-0137-4dc5-847d-83b300b644c4"], "aliases": ["Enseada Norte"]},
    {"names": ["Lampione"], "country": "Italy", "siteIds": ["bb4610af-fe32-4ccb-be74-5f168368ea18"], "aliases": ["Scoglio di Lampione", "Lampione Rock"]},
    {"names": ["Urabain, Wreck"], "country": "Argentina", "siteIds": ["c7a67d42-4d6f-4acb-9b6c-132efebb4509"], "aliases": ["Hundimiento Urabain", "Naufragio Urabain"]},
    {"names": ["Tyrrel Bay"], "country": "Grenada", "siteIds": ["eb6d42c5-5042-4a86-9669-8ab4a8b5f9d9"], "aliases": ["MV Tyrrel Bay", "Tyrrel Bay Wreck"]},
    {"names": ["rocher creole"], "country": "France", "siteIds": ["0538e431-f53b-46de-b9fd-b81c9ae1a2e0"], "aliases": ["Creole Rock"]},
    {"names": ["La Pota del Llop"], "country": "Spain", "siteIds": ["c9bfc1af-afb3-4f93-949d-fd316504ecbc"], "aliases": ["Pota de Llop", "Wolf's Paw", "Wolf’s Paw"]},
    {"names": ["La Grotte de Arue"], "country": "French Polynesia", "siteIds": ["6284cffe-0581-4621-a78e-8dec89cb76f7"], "aliases": ["Grotte d'Arue", "Grotte d’Arue"]},
    {"names": ["Fisherman's Cove Reef"], "country": "Seychelles", "siteIds": ["a9320e65-2a2a-430b-974f-8c170b23817a"], "aliases": ["Fishermans Cove Reef", "Fisherman’s Cove Reef"]},
    {"names": ["Gibson Bight"], "country": "Honduras", "siteIds": ["70967c54-94fd-4b73-a480-27b71512e877"], "aliases": ["吉布森湾"]},
    {"names": ["Batu Kelebit"], "country": "Indonesia", "siteIds": ["81a521b3-941d-4bb0-8fa2-400d702fb524"], "aliases": ["Batu Klebit", "Kelebit Rocks", "巴图凯莱比特"]},
    {"names": ["Table Rock Lake"], "country": "United States", "siteIds": ["af1c2c48-dca1-494c-84ff-d9eb38ed93ca"], "aliases": ["桌岩湖"]},
    {"names": ["San Juan Reef"], "country": "Mexico", "siteIds": ["3f7de7dd-e15d-4049-b976-38e643541113"], "aliases": ["Arrecife San Juan"]},
    {"names": ["Los Arcos - Playa del Carmen"], "country": "Mexico", "siteIds": ["fc05bd81-b737-45b7-a06d-8035c75b8b57"], "aliases": ["The Arches"]},
    {"names": ["Whitehouse Rock"], "country": "India", "siteIds": ["789444a6-af5d-4c3e-abc5-c275dd0350b5"], "aliases": ["White House Rock"]},
    {"names": ["Peters Place"], "country": "Honduras", "siteIds": ["662f5510-cc18-4247-bb16-a35e702a6fb0"], "aliases": ["Peter's Place", "Peter’s Place"]},
    {"names": ["El Aquario"], "country": "Honduras", "siteIds": ["be84595c-244d-4cbc-8add-40325cf2271f"], "aliases": ["Aquarium"]},
    {"names": ["Panteronisi"], "country": "Greece", "siteIds": ["7f1961e1-1f75-436f-ac77-772666fdf726"], "aliases": ["Cavern of Panteronisi", "Panderonisi cavern"]},
    {"names": ["Klein Curaçao"], "country": "Curaçao", "siteIds": ["708cfb99-ee5d-4131-9654-40497ad47f32"], "aliases": ["小库拉索岛", "クラインキュラソー"]},
    {"names": ["Dosthill Quarry"], "country": "United Kingdom", "siteIds": ["8602125e-7a1f-4bbe-885f-4790fb9bd64b"], "aliases": ["Dozzy"]},
    {"names": ["Arvoredo - Saco do Engenho"], "country": "Brazil", "siteIds": ["61858d8d-dfba-43fd-b5e3-c236cb6230f5"], "aliases": ["Engenho"]},
    {"names": ["Pinnicles Ponta Malongane"], "country": "Mozambique", "siteIds": ["b3997509-138c-4c14-a6c2-d4360ceb661e"], "aliases": ["Pinnacles Ponta Malongane", "Pinnacles"]},
    {"names": ["Fischbalmen"], "country": "Switzerland", "siteIds": ["3af0a5b8-1804-4ca3-a1e0-bb80b3ee1cf0"], "aliases": ["Beatenbucht – Fischbalmen", "Beatenbucht - Fischbalmen"]},
    {"names": ["Portsea Pier"], "country": "Australia", "siteIds": ["5f54cb63-7b0f-44a8-b763-0541619a7388"], "aliases": ["波特西码头", "波特西碼頭"]},
    {"names": ["Catalinas Island, North"], "country": "Costa Rica", "siteIds": ["9649e914-446f-4d54-8d8c-48c4741faaa3"], "aliases": ["Las Catalinas North"]},
    {"names": ["Ledges of Little St. James"], "country": "United States", "siteIds": ["63c775b6-17ba-4d2a-b6f9-f879d1220eb1"], "aliases": ["Ledges of Little Saint James", "Ledges of Little St James"]},
    {"names": ["L’Ilot"], "country": "Seychelles", "siteIds": ["452baedb-7144-45f0-aa4b-4f23534deb69"], "aliases": ["L'Ilot", "L'Îlot"]},
    {"names": ["Dongelberg"], "country": "Belgium", "siteIds": ["0c3155f9-f38d-47cc-9eef-1f754bb891e5"], "aliases": ["Carrière de Dongelberg", "Steengroeve van Dongelberg"]},
    {"names": ["La Caye des Boucaniers"], "country": "France", "siteIds": ["6a9d5c7f-58c7-4d77-8709-1b1415ca99ac"], "aliases": ["Bouée Rouge/Caye des Boucaniers"]},
    {"names": ["Guaraguao I"], "country": "Dominican Republic", "siteIds": ["cd53fea0-6278-474f-b133-7c25e4f38d1a"], "aliases": ["Guaraguao1", "Guaraguao 1"]},
    {"names": ["Tokai Maru (Wreck)"], "country": "Guam", "siteIds": ["59bd0af1-b74a-45d5-a160-4ce707b25dac"], "aliases": ["東海丸"]},
    {"names": ["Estudiantes"], "country": "Costa Rica", "siteIds": ["755cb85d-954e-41ad-aad7-249d02f5ffd3"], "aliases": ["Los Estudiantes", "The Students"]},
    {"names": ["Barracuda Point"], "country": "Curaçao", "siteIds": ["96dea5ad-6ef5-4231-85f4-dd7d005f5945"], "aliases": ["Punt'i Piku", "Punt’i Piku"]},
    {"names": ["Barco Hundido - Wreck Cadete Juan Escutia C-56"], "country": "Mexico", "siteIds": ["f62311f5-284b-4f69-b316-9d76b90cd791"], "aliases": ["C-56 Juan Escutia", "C56 Juan Escutia", "Juan Escutia C-56", "ARM Cadete Juan Escutia"]},
    {"names": ["Catalina Island - Dominican Republic"], "country": "Dominican Republic", "siteIds": ["174d53b1-5ac1-4ed5-8547-a407d0806bc6"], "aliases": ["Isla Catalina"]},
    {"names": ["Cape Mansuar"], "country": "Indonesia", "siteIds": ["9773365d-45f5-44ed-8faf-f8a74374b497"], "aliases": ["曼苏尔角", "曼苏尔海角"]},
    {"names": ["Le Jardin de Petit Canal"], "country": "France", "siteIds": ["88087cab-f475-42be-8a8a-55cddbef3fb3"], "aliases": ["Jardin de Petit-Canal", "Le Jardin de Petit-Canal"]},
    {"names": ["Mur de corail/Coral Wall"], "country": "French Polynesia", "siteIds": ["e11a21b1-3cb1-4a07-9909-d2e3c13a94d7"], "aliases": ["Le Mur de Corail", "Turtle Reef"]},
    {"names": ["Agincourt Reefs"], "country": "Australia", "siteIds": ["bee22aa0-dbb5-48f3-82ac-fac818e7b0af"], "aliases": ["阿金考特礁", "阿金科特礁", "Agincourt Reef"]},
    {"names": ["Momo Beach"], "country": "Philippines", "siteIds": ["8e5c7008-e9c6-4776-91b2-093511f162d2"], "aliases": ["莫莫海滩", "모모 비치"]},
    {"names": ["Sculpture Park"], "country": "Grenada", "siteIds": ["c25d73a6-d37c-4f89-b2ff-38433a9221cd"], "aliases": ["Molinere Underwater Sculpture Park", "Molinere Bay Underwater Sculpture Park", "Underwater Sculpture Park"]},
    {"names": ["Flynn Reef"], "country": "Australia", "siteIds": ["e1bbb820-e250-4c5c-9528-378356e6906c"], "aliases": ["弗林礁"]},
    {"names": ["Julian Rocks - Hugos Trench"], "country": "Australia", "siteIds": ["d7bd8f9e-c05f-4919-a0c7-26bbf8700edd"], "aliases": ["Hugo's Trench", "Hugo’s Trench"]},
    {"names": ["Oswaldo’s Drop Off"], "country": "Curaçao", "siteIds": ["388d3288-5c6f-4a7f-a667-baa3aecec428"], "aliases": ["Oswaldo's Drop Off", "Sunscape House Reef", "Kon Tiki Beach Reef"]},
    {"names": ["Anna Jacobapolder"], "country": "Netherlands", "siteIds": ["09decd23-c631-4769-8b6b-f1b80bb01fae"], "aliases": ["Anna-Jacobapolder", "Zijpe"]},
    {"names": ["1 / 4 Wreck (Stern Courier)"], "country": "Grenada", "siteIds": ["58049de8-8113-444d-95d7-790e659f78bf"], "aliases": ["Quarter Wreck", "¼ Wreck"]},
    {"names": ["Cuevitas - Dominican Republic"], "country": "Dominican Republic", "siteIds": ["0fce8e01-5587-4e6e-b912-02b63296d7f7"], "aliases": ["Las Cuevitas de Las Ballenas", "Las Cuevitas"]},
    {"names": ["Släggö"], "country": "Sweden", "siteIds": ["5c1af959-dfca-4581-9782-41dda7c5afd7"], "aliases": ["Dyk-bryggan", "Dykbryggan"]},
    {"names": ["Sec Pate"], "country": "France", "siteIds": ["14720ced-a4a5-472e-812c-bebaab56c3d7"], "aliases": ["Sec Pâté", "Le Sec Pâté", "Sec Paté", "Le Sec Paté"]},
    // The source name contains a malformed apostrophe; divers also use Sa Rata.
    {"names": ["Massa ďOr"], "country": "Spain", "siteIds": ["fbcfcbf8-6ee7-476f-ab1b-f3a31a98c0af"], "aliases": ["Massa d'Or", "Massa d’Or", "La Massa d'Or", "La Rata", "Sa Rata", "Sa Freu"]},
    {"names": ["Raggedy Cay"], "country": "Honduras", "siteIds": ["6f81dbe0-851e-4441-976f-e206bd1cbc01"], "aliases": ["Ragged Cay"]},
    {"names": ["Gerombong"], "country": "Indonesia", "siteIds": ["34c119e1-642b-498a-a953-e73bbba015e6"], "aliases": ["Gerombong Reef", "Pura Gerombong", "Secret Rock"]},
    {"names": ["St. Marie Reef"], "country": "Curaçao", "siteIds": ["67eb5957-d41e-4c07-b22d-494569e018c2"], "aliases": ["Rif St Marie", "St Marie Rif"]},
    {"names": ["Los Morros"], "country": "Mexico", "siteIds": ["c60d18e6-3c29-4ef3-9253-5d447a1f158d"], "aliases": ["Los Moros"]},
    {"names": ["Main Beach Wreck - Tassie III"], "country": "Australia", "siteIds": ["8f0745bb-0fbf-4481-a396-fe01d7b1dcbc"], "aliases": ["MV Tassie III", "S-77 Tassie III"]},
    {"names": ["First Cathedral"], "country": "United States", "siteIds": ["b2ea6e4d-87bb-41ea-94a7-a0f25b5e81c7"], "aliases": ["第一大教堂", "1st Cathedral"]},
    {"names": ["Doljo point"], "country": "Philippines", "siteIds": ["13c78dba-1985-4603-939d-d7a7adb58d4d"], "aliases": ["多爾霍角", "돌호 포인트", "Duljo Point"]},
    // Cayman Brac wreck retains its former frigate number in dive guides.
    {"names": ["MV Captain Keith Tibbetts (Wreck)"], "country": "Cayman Islands", "siteIds": ["d751ae36-4e96-4080-9d04-2735efffda19"], "aliases": ["Frigate 356", "Russian Frigate 356", "キャプテン・キース・ティベッツ"]},
    {"names": ["Kahekili Beach Park"], "country": "United States", "siteIds": ["3f37f995-c790-4b21-8262-3033d5f68358"], "aliases": ["Airport Beach", "Old Airport Beach"]},
    {"names": ["Koh Rok"], "country": "Thailand", "siteIds": ["1198b122-0853-445c-9e05-fa0b758b5c9e"], "aliases": ["เกาะรอก", "ロック島"]},
    {"names": ["Cottage By The Sea"], "country": "Australia", "siteIds": ["cbaa8c01-84d8-42e4-973c-26640a26ade6"], "aliases": ["Cottage By The Sea Reef"]},
    {"names": ["Ulua Beach Park"], "country": "United States", "siteIds": ["ca8a4ca7-394f-4d05-93f2-687f0f07e229"], "aliases": ["乌鲁阿海滩"]},
    // Both names refer to the aircraft wrecks off Renaissance Island.
    {"names": ["Airplanes (Wreck)"], "country": "Aruba", "siteIds": ["6f88bfaa-d23d-4ec2-8794-62f0fab77fd8"], "aliases": ["Renaissance Airplanes", "Sonesta Airplanes"]},
    {"names": ["Duzillet"], "country": "Switzerland", "siteIds": ["fe163655-8887-43ca-a749-e345d06eb616"], "aliases": ["Étang du Duzillet", "Gouille du Duzillet"]},
    {"names": ["El Peñon - Dominican Republic"], "country": "Dominican Republic", "siteIds": ["e7dc1e8f-e2c5-4868-acd0-bfb5eecdb993"], "aliases": ["Peñón Reef", "Arrecife Peñón"]},
    {"names": ["Pailas"], "country": "Costa Rica", "siteIds": ["b676e8bc-400f-4022-98ff-a129cd82d9ca"], "aliases": ["Las Pailas"]},
    {"names": ["Tobia Island"], "country": "Egypt", "siteIds": ["bcf380c6-3cd8-49d1-a44b-b8b14de861cf"], "aliases": ["托比亚岛"]},
    {"names": ["Spotted Bay"], "country": "Honduras", "siteIds": ["6d71f2c0-b5cf-4f60-8dce-2d6309883734"], "aliases": ["斯波特湾"]},
    {"names": ["Palong  Wall"], "country": "Thailand", "siteIds": ["a2cb5caf-8691-4489-99d4-3ada4ed11147"], "aliases": ["Palong Bay", "Pallong Bay", "ผาป่ะหล่อง"]},
    // This record describes the Kona dive destination as a whole.
    {"names": ["Kona"], "country": "United States", "siteIds": ["b48528fe-8d05-4b4a-9018-31a8a296fc58"], "aliases": ["科纳", "科納", "コナ"]},
    // Bayahibe wreck uses its former cargo-ship name and dive-site spelling.
    {"names": ["St. George (Wreck)"], "country": "Dominican Republic", "siteIds": ["a118159c-a81d-4d97-97ea-3fde68a1045f"], "aliases": ["Norbrae", "Saint George Wreck"]},
    {"names": ["Cenote Kukulkan"], "country": "Mexico", "siteIds": ["c5256d10-fc23-4673-88b2-3d0b1eaf22b7"], "aliases": ["库库尔坎仙人洞"]},
    // Guanacaste operator calls the turtle-mooring wreck site Key Largo.
    {"names": ["La Tortuga"], "country": "Costa Rica", "siteIds": ["31b5ce55-7229-4614-8e82-767f28f90ab8"], "aliases": ["Key Largo"]},
    {"names": ["Punta Restinga"], "country": "Spain", "siteIds": ["f16d2274-52ab-41b9-9939-05901450c77e"], "aliases": ["Punta de La Restinga"]},
    // Island names used for this Phuket dive destination.
    {"names": ["Mai Thon"], "country": "Thailand", "siteIds": ["ad38ec16-3b17-4cf6-8f67-1214db45d778"], "aliases": ["迈通岛", "เกาะไม้ท่อน", "Maiton Island", "Ko Mai Thon", "Honeymoon Island"]},
    {"names": ["Cerebros"], "country": "Mexico", "siteIds": ["8a83a47a-bd41-4858-8357-b03b706cabc7"], "aliases": ["Brains"]},
    // Former vessel names and local Spanish dive-site spelling.
    {"names": ["C-50 Rivapalacios (Wreck)"], "country": "Mexico", "siteIds": ["5a266be7-5618-44e2-a173-fd0e67913c9a"], "aliases": ["C-50 Riva Palacio", "ARM Riva Palacio", "USS Jubilant (AM-255)", "C50 Rivapalacio", "Barco Hundido C50 Rivapalacio"]},
    {"names": ["Edmonds Underwater Park"], "country": "United States", "siteIds": ["9139d365-4142-4fa7-b5a5-133a3c8a6ae0"], "aliases": ["Brackett's Landing", "Bruce Higgins Underwater Trails", "Edmonds UW Park"]},
    {"names": ["Kandooma Caves"], "country": "Maldives", "siteIds": ["ee3148c4-9e41-4692-9897-23e3dc01d9f2"], "aliases": ["康杜玛洞穴"]},
    {"names": ["Moc Che Deep"], "country": "Mexico", "siteIds": ["f20d19ba-ebda-4179-a65d-f1edf7b0c7d5"], "aliases": ["Moc Che Profundo", "Moc-Che Deep"]},
    // Curaçao dive operator spelling of Playa Jeremi.
    {"names": ["Playa Jeremi"], "country": "Curaçao", "siteIds": ["9032d667-eef2-42e3-8dfb-e3e0b09de85a"], "aliases": ["Jeremy"]},
    // Guadeloupe operators also call the mooring site Les Sources.
    {"names": ["Bouée Anticyclonique"], "country": "France", "siteIds": ["1e6de0fd-39f1-4887-be2e-ec2da3b34a87"], "aliases": ["Les Sources", "Les sources d’eau chaude", "Les sources d'eau chaude", "La bouée anticyclonique"]},
    // Operators use these names for the dive accessed from Makena Landing.
    {"names": ["Makena Landing"], "country": "United States", "siteIds": ["eaf3c3bb-3142-4404-8865-1e91afc9c3c4"], "aliases": ["Five Graves", "Five Caves", "5 Caves", "Turtle Town", "Turtle Arches"]},
    // French ligature spelling used by the Port-Louis dive operator.
    {"names": ["Oeil"], "country": "France", "siteIds": ["c5ebee9d-d8b4-4682-bb9c-6ea3add77af1"], "aliases": ["Œil"]},
    // St Croix shore dive commonly called Cane Bay Wall.
    {"names": ["Cane Bay"], "country": "United States", "siteIds": ["da561699-8759-497d-9d61-f057bd038085"], "aliases": ["Cane Bay Wall", "Cane Bay Drop Off", "Cane Bay Drop-off", "凯恩湾峭壁"]},
    // This record names the Cayman Brac destination, not a single reef.
    {"names": ["Cayman Brac"], "country": "Cayman Islands", "siteIds": ["2d84c2ae-a1ac-4fc9-b038-a841a7b9fdf7"], "aliases": ["开曼布拉克", "开曼布拉克岛", "開曼布拉克", "開曼布拉克島", "ケイマン・ブラック島", "ケイマンブラック島", "ケイマンブラク", "ケイマンブラク島"]},
    {"names": ["Punta Sur - Devil’s Throat"], "country": "Mexico", "siteIds": ["f83ce4a6-3567-4e79-b3f2-284adca5b547"], "aliases": ["Garganta del Diablo", "La Garganta del Diablo"]},
    {"names": ["Carriere Flintkote"], "country": "Canada", "siteIds": ["a36acd8a-b2f9-4a29-8f07-ee9f3647a438"], "aliases": ["Flintkote Quarry"]},
    // Local dive operator uses Turning Point for Virador.
    {"names": ["Virador"], "country": "Costa Rica", "siteIds": ["03e7738c-fd59-47a3-9f02-e0fd0d46e7c3"], "aliases": ["Turning Point"]},
    // Diver spellings and Dhivehi channel name for this Huvadhoo site.
    {"names": ["Maarehaa Kandu"], "country": "Maldives", "siteIds": ["0c43c690-fca8-4f39-accc-40bc301ef107"], "aliases": ["Marehaa Kandu", "Maarehaa Channel", "Maareehaa Kandu", "މާރެހާ ކަނޑު"]},
    // Chinese dive-site name for the Ras Abu Galum reef near Dahab.
    {"names": ["Ras Abu Galum"], "country": "Egypt", "siteIds": ["b68fe0df-398e-41ea-b970-09cf6795545b"], "aliases": ["拉斯阿布加卢姆", "阿布加卢姆"]},
    // The NSW aquatic reserve and dive site also use the singular spelling.
    { names: ["Bushrangers Bay"], country: "Australia", siteIds: ["96e513e4-a18f-4cfa-ab43-948cd80eb2af"], aliases: ["Bushranger Bay", "Bushrangers Bay Aquatic Reserve"] },
    // Rangiroa dive-site spelling used in French diving references.
    { names: ["Eolienne"], country: "French Polynesia", siteIds: ["7138366f-16d5-4c34-b2d8-bcf96f071b6f"], aliases: ["L’Éolienne", "L'Éolienne", "L'Eolienne"] },
    // The Nosy Be plateau has English names used by dive operators.
    { names: ["Banc des Fusiliers"], country: "Madagascar", siteIds: ["56c452a3-2633-4b5b-a451-6e13147fd9cb"], aliases: ["Fusiliers Bank", "Fusilers Bank", "Fusillier Plateau"] },
    // A Guadeloupe dive survey uses the geographic point name.
    { names: ["Machette"], country: "France", siteIds: ["10a3208c-d399-4e0a-9ee1-22bc0155988c"], aliases: ["Pointe Machette"] },
    // Sharm divers formerly called this canyon Wichita Falls.
    { names: ["White Knight"], country: "Egypt", siteIds: ["3a106b88-0b69-4598-a0d1-9190e327fd24"], aliases: ["Wichita Falls"] },
    // PADI’s Chinese dive description uses this name for Bunaken’s Mandolin.
    { names: ["Mandolin"], country: "Indonesia", siteIds: ["558e570e-c2f4-4b56-9c71-b86747669ac7"], aliases: ["曼陀林"] },
    // The dataset uses the destination name as a dive record here.
    { names: ["Punta Cana"], country: "Dominican Republic", siteIds: ["83416dcb-c5fa-4b2f-a5f1-72f8ebff80a1"], aliases: ["蓬塔卡纳", "蓬塔卡納", "プンタカナ", "プンタ・カナ"] },
    // Saint-François has a separate Japanese Garden on the opposite coast.
    { names: ["Jardin Japonais"], country: "France", siteIds: ["d20eb0c6-d911-4483-a336-aeb27ddcde81"], aliases: ["Japanese Garden"] },
    // This Japanese Garden is the Guadeloupe site north of Pointe Malendure.
    { names: ["Jardin Japonais"], country: "France", siteIds: ["5a5dd053-de81-4b1e-b1b5-405f3c82b0b9"], aliases: ["Japanese Garden", "Le Jardin Japonais"] },
    // This Curaçao dive is the Saba tugboat wreck, not the island of Saba.
    { names: ["Saba"], country: "Curaçao", siteIds: ["8b924dc7-286d-4ab0-91cc-a315a82b5fcb"], aliases: ["Saba Wreck", "Tugboat Saba"] },
    // Guadeloupe dive operators and local guides use these French forms.
    { names: ["Pointe Malendure"], country: "France", siteIds: ["3e76a996-7095-4675-9fd1-c6ecb41fd1a4"], aliases: ["La pointe Malendure", "Pointe de Malendure"] },
    // Menorca sources spell the contracted place name in both forms.
    { names: ["Cala’n Forcat"], country: "Spain", siteIds: ["3d9c6294-debd-42e8-bff3-76d20b0821af"], aliases: ["Cala'n Forcat", "Cala en Forcat"] },
    // North Komodo’s channel has local and translated dive names.
    { names: ["Golden Passage Komodo"], country: "Indonesia", siteIds: ["fdf41d45-73b7-4a0a-8841-b55ee39e5566"], aliases: ["黄金通道", "ゴールデン・パッセージ", "Gili Lawa Passage"] },
    // Local dive guides reverse the bay and headland in this site’s name.
    { names: ["Norah Head (Cabbage Tree Bay)"], country: "Australia", siteIds: ["18b068e9-b737-4163-b1e8-002a79129ef2"], aliases: ["Cabbage Tree Bay (Norah Head)", "Cabbage Tree Bay, Norah Head"] },
    // NOAA records the earlier Atlantis name for the Key Biscayne memorial reef.
    { names: ["Neptune Memorial Reef"], country: "United States", siteIds: ["510bcaeb-1ada-4536-8237-5b65b3be6649"], aliases: ["Atlantis Memorial Reef", "Atlantis Reef Project"] },
    // Menjangan dive guides use Roman numerals and the ranger-station name.
    { names: ["Pos 1"], country: "Indonesia", siteIds: ["da6fcfa0-bdfb-491d-9142-71d83622f461"], aliases: ["Pos I", "Pos Satu", "Jetty Post I", "Pos I Ranger Station"] },
    // Swiss dive-club records distinguish this Herrliberg entry from the larger car park.
    { names: ["Kleiner Parkplatz"], country: "Switzerland", siteIds: ["7fe9e017-5366-4801-8a94-d0dd067e9033"], aliases: ["Kleiner P", "Kastanie"] },
    // Marujín was the vessel’s earlier name before it became El Condesito.
    { names: ["El Condesito (Wreck)"], country: "Spain", siteIds: ["882c5c39-4c98-473c-ae7c-216830d0d195"], aliases: ["Marujín", "The Condesito"] },
    // The decommissioned vessel and hull number are used by local diving sources.
    { names: ["HMAS Swan (Wreck)"], country: "Australia", siteIds: ["bca9e258-4ab6-453a-9b48-8777f23222e1"], aliases: ["ex-HMAS Swan", "HMAS Swan DE 50", "HMAS Swan (DE 50)"] },
    // Fuvahmulah operators use these names for the north-point dive.
    { names: ["Thoondu"], country: "Maldives", siteIds: ["92a89e38-f8b8-4e83-bc0f-f41162b5a019"], aliases: ["Hudhukede", "Kedevari", "胡杜克德"] },
    // Granada’s dive guide records Los Coches as this site’s local name.
    { names: ["Piedra de la Higuera"], country: "Spain", siteIds: ["f68d34d5-181a-4c05-a407-f055fc3825f1"], aliases: ["Los Coches"] },
    // English dive reporting calls this Fernando de Noronha site Dry Rocks.
    { names: ["Pedras Secas"], country: "Brazil", siteIds: ["a82c6871-9322-400f-b223-b74f7123be27"], aliases: ["Dry Rocks"] },
    // The Mooloolaba operator formerly called this site Wobby Rock.
    { names: ["Nurse Rock"], country: "Australia", siteIds: ["36a9a5c6-93c3-4cd3-905c-29ef28547a90"], aliases: ["Wobby Rock"] },
    // The local Maltese name and tunnel nickname refer to Billinghurst itself.
    { names: ["Billinghurst Cave"], country: "Malta", siteIds: ["566f8e0d-f48e-4f18-8bd6-3e458fff7321"], aliases: ["Billingshurst Cave", "Booming Cave", "Railway Tunnel", "Għar ix-Xiħ", "Ghar ix-Xih"] },
    // Blue Caves here denotes the North Ari thila, not unrelated blue holes.
    { names: ["Maalhos Thila"], country: "Maldives", siteIds: ["96901eed-bdb3-4611-bf1d-596cd100c3f6"], aliases: ["Blue Caves"] },
    // A Krk dive centre identifies the same reef in Croatian and English.
    { names: ["Plic Tenki"], country: "Croatia", siteIds: ["12105a8d-9a63-42ee-a502-11c5104447bc"], aliases: ["Tenki reef"] },
    // A regional marine-life report uses the alternative Portuguese preposition.
    { names: ["Laje Dois Irmãos"], country: "Brazil", siteIds: ["816c63eb-e4c4-4c56-a3cd-bd6e4033dce7"], aliases: ["Laje dos Dois Irmãos"] },
    // Tenerife operators use the bay and village names for this shore dive.
    { names: ["El Poris"], country: "Spain", siteIds: ["b1fbc761-51e0-48d1-bc28-7b6475f5ea47"], aliases: ["El Poris Bay", "Porís de Abona"] },
    // Veracruz dive guides use both the Spanish and English names.
    { names: ["Catedrales"], country: "Mexico", siteIds: ["13ca0613-2ea0-4c78-8187-456d47777a89"], aliases: ["Las Catedrales", "The Cathedrals"] },
    // Aqaba sources commonly put Hercules before the aircraft model.
    { names: ["C-130 Hercules, wreck"], country: "Jordan", siteIds: ["3d832f6f-b46b-49cb-b1ce-e71b296f7391"], aliases: ["Hercules C-130", "C-130 Hercules Plane Wreck", "C-130 Hercules Aircraft"] },
    // The recorded label is the island destination; local dive operators abbreviate Saint.
    { names: ["Saint George’s Caye"], country: "Belize", siteIds: ["d36fd433-11a2-4839-afab-86c4f08058b4"], aliases: ["St. George’s Caye", "St. George's Caye", "St George's Caye"] },
    // The Hawaiian name identifies Maui’s Black Rock, not its namesakes.
    { names: ["Black Rock - Hawaii"], country: "United States", siteIds: ["45d76fa7-6300-4573-baa4-f1c651145589"], aliases: ["Puʻu Kekaʻa", "Puu Kekaa"] },
    // Location-qualified names distinguish this beach from Australian namesakes.
    { names: ["Little Beach - NSW"], country: "Australia", siteIds: ["83e594e5-9f65-4d3f-ab5c-9b3eec4ed61c"], aliases: ["Little Beach - Nelson Bay", "Little Beach (Nelson Bay)"] },
    // Tascó Gros is one islet within the wider Tascons dive area.
    { names: ["Tascó Gros"], country: "Spain", siteIds: ["0642fd96-b4b1-4685-b933-d3a74140f649"], aliases: ["El Tascó Gross", "Tascó Gran"] },
    // Ras Mohammed Wall is distinct from the neighboring Shark Reef.
    { names: ["Shark Observatory"], country: "Egypt", siteIds: ["66b5a1e6-3420-4c48-9632-c21eb8344e6d"], aliases: ["Ras Mohammed Wall", "シャーク・オブザーバトリー"] },
    // Regional dive-site documentation records the historic local name.
    { names: ["Bajo de Fuera"], country: "Spain", siteIds: ["cd3d396d-4ac7-4494-b8b2-cc83260497e0"], aliases: ["Piedra del Vapor", "La Piedra del Vapor"] },
    // Maa Kandu contains this specific cleaning station; the channel is broader.
    { names: ["Addu Manta Point"], country: "Maldives", siteIds: ["b27e845c-8862-4cb9-8ac0-d7eb0eb14a8f"], aliases: ["Mudakan", "Mudakan Manta Point", "Maa Kandu Manta Point"] },
    // Local cenote operators use both c and k spellings for Kukulkan.
    { names: ["Cenote Kukulcan"], country: "Mexico", siteIds: ["bfc6624e-51fe-41a2-90e7-991b32f1949c"], aliases: ["Cenote Kukulkan", "Kukulkan"] },
    // Cozumel dive guides use the Spanish reef name for this site.
    { names: ["Las Palmas Reef"], country: "Mexico", siteIds: ["35a1cb87-6787-49bd-804e-48646be9954f"], aliases: ["Arrecife Las Palmas", "Las Palmas"] },
    // The local dive guide and transport authority identify this Woodman Point jetty.
    { names: ["Ammo Jetty"], country: "Australia", siteIds: ["9769492b-25bf-48a2-9c83-c9fa188f20e6"], aliases: ["Ammunition Jetty", "Woodman Point Jetty", "Woodman Point Ammo Jetty", "Woodmans Point Jetty"] },
    // These names refer to the Silfra fissure as a whole, not an individual section.
    { names: ["Silfra Diving"], country: "Iceland", siteIds: ["5e646533-e7d6-4205-9a94-fa82a4c78204"], aliases: ["西尔夫拉", "席尔弗拉", "シルフラ"] },
    // Alcúdia dive operator identifies the Cabo Pinar cavern by both names.
    { names: ["Swiss Cheese"], country: "Spain", siteIds: ["f836f867-f7ff-4362-9ba7-58aa0cde219b"], aliases: ["Queso suizo", "El queso suizo"] },
    // https://www.westernaustralia.com/cn/attraction/exmouth-navy-pier/59cb344eec83773e725c3197
    // https://www.divers.world/zh-cn/divesite/ningaloo-reef/exmouth-navy-pier/
    // https://www.bluerides.com/ja/daibingu-pointo/navy-pier
    { names: ["Exmouth Navy Pier"], country: "Australia", siteIds: ["15fb3e17-236b-4618-82cb-1439a1486f4f"], aliases: ["埃克斯茅斯海军码头", "Point Murat Navy Pier", "ネイビーピア"] },
    // https://www.justgottadive.com/dive_resources/dive_sites/pedernales-wreck
    { names: ["Pedernalis (Wreck)"], country: "Aruba", siteIds: ["a44259d2-c276-4d4a-ad6e-b995dee568a9"], aliases: ["Pedernales", "Pedernales Wreck"] },
    // https://musan.com.cy/faq/
    // https://travel.padi.com/ja/dive-site/kihurosu/musan/
    { names: ["MUSAN"], country: "Cyprus", siteIds: ["a38781c6-753b-4ee4-9995-bb896de8df2b"], aliases: ["Museum of Underwater Sculpture Ayia Napa", "アギアナパの水中彫刻博物館"] },
    // https://www.scubago.com/cn/explore/destination/granitic-islands-9752986
    // https://www.padi.com/zh-hans/dive-site/sai-she-er/btc-baie-ternay-center/
    // https://www.scubago.com/ja/explore/destination/granitic-islands-9752986
    { names: ["Baie Ternay Marine Park"], country: "Seychelles", siteIds: ["fdf2c823-264c-41c2-87ec-9f5de10d4234"], aliases: ["特尔奈湾海洋公园", "特奈湾海洋公园", "ベイ・テルネ海洋公園"] },
    // https://www.lustricadiving.it/dives/doctors-rock/
    // https://usticadiving.com/index.php?do=discover-ustica&id=17
    { names: ["Scoglio del Medico"], country: "Italy", siteIds: ["77b58b6c-cde8-49cb-b4fc-dead8c8f1c12"], aliases: ["Doctor’s Rock", "Doctor's Rock", "Medico Rock"] },
    // https://kknews.cc/zh-tw/travel/xgk2pmg.html
    { names: ["Fridays Rock"], country: "Philippines", siteIds: ["8459d6d4-abab-4bef-9ddd-689546d9bb2e"], aliases: ["星期五岩"] },
    // https://www.scubago.com/tw/explore/destination/north-guam-9749648
    // https://guam-navi.jp/gun-beach/
    // https://tour.interpark.com/freeya/Spot/View.aspx?SpotNo=85757
    { names: ["Gun Beach"], country: "Guam", siteIds: ["9056b4e9-ae4b-49eb-8850-328fa21060d1"], aliases: ["枪滩", "槍灘", "炮灘", "ガンビーチ", "건 비치", "건비치"] },
    // https://scubadiving.place/divesite/corner-bar-corner-bay
    { names: ["Corner bar"], country: "Cambodia", siteIds: ["cf415af4-e0c5-458a-8cd0-285327212015"], aliases: ["Corner Bay"] },
    // https://www.edenplongee.fr/Sur-le-site-de-plongee-de-l-Avion-un-Cessna-Agwagon-188_a60.html
    { names: ["Avion Cessna 188"], country: "France", siteIds: ["473e3b7c-d73e-4c44-9cf7-2d6a30eaa56e"], aliases: ["Cessna Agwagon 188", "Avion de Port-Louis"] },
    // https://www.neptuneliveaboards.com/zh/blog/dampier-strait-diving/
    // https://www.wtp.co.jp/area/detail/28/Raja%20Ampat/
    // https://www.bluerides.com/ko/vessels/blue-manta/raja-ampat-misool-10n
    { names: ["Manta Ridge"], country: "Indonesia", siteIds: ["c66d16b2-4f87-45de-9dbb-68d32f7c356d"], aliases: ["蝠鲼脊", "マンタリッジ", "만타 리지"] },
    // https://history.ifeng.com/c/8lkkcyfpqYh
    // https://blog.padi.com/ko/wreck-diving-best-dive-sites-in-the-world/
    // https://www.jica.go.jp/Resource/jica-ri/IFIC_and_JBICI-Studies/jica-ri/publication/archives/jica/kyakuin/pdf/200407_02_05.pdf
    { names: ["SS President Coolidge (Wreck)"], country: "Vanuatu", siteIds: ["1eedf563-f0f0-45ea-844d-493350267980"], aliases: ["柯立芝总统号", "柯立芝總統號", "프레지던트 쿨리지", "プレジデント・クーリッジ"] },
    // https://www.papuaparadise.com/news/dive-sites-in-raja-ampat/
    { names: ["Batu Lima"], country: "Indonesia", siteIds: ["e20ed80f-c7cb-472d-a934-7fc3ce02d73b"], aliases: ["Five Rocks"] },
    // https://www.komodoresort.com/zh/komodo-liveaboard/
    // https://komodonationalpark.com/ko/komodo-diving-snorkeling/
    { names: ["Manta Alley"], country: "Indonesia", siteIds: ["877fd63c-7f3f-47af-9c7a-d64058c92fbb"], aliases: ["曼塔巷", "만타 앨리"] },
    // https://www.eleutheratahiti.com/fr/calendrier
    { names: ["Les 3 Pitons"], country: "French Polynesia", siteIds: ["d882a086-4688-4fad-9aeb-b2707a574f74"], aliases: ["Trois Pitons", "Les Trois Pitons"] },
    // https://divecodex.com/es/sites/cabo-san-antonio
    { names: ["Cabo San Antonio"], country: "Spain", siteIds: ["a854f64a-36b7-4309-8183-c9e40df03ee6"], aliases: ["Cap de Sant Antoni"] },
    // https://www.scubalo.com/divesites/indonesia/nusa-penida/buyuk
    { names: ["Buyuk"], country: "Indonesia", siteIds: ["abfffbdb-49ea-49d9-a015-5341c3814225"], aliases: ["Buyuk Point"] },
    // https://divechamp.com/divesite/tug-2-wreck
    { names: ["Tug 2, Wreck"], country: "Mauritius", siteIds: ["4027637e-c01d-412b-9427-e137a48e20d6"], aliases: ["Tug II"] },
    // https://www.scubago.com/cn/explore/destination/little-cayman-9750206
    // https://www.divers.world/zh-tw/diveshop/reef-divers-at-little-cayman/
    // https://www.bluerides.com/ja/liveaboards/cayman-islands
    { names: ["Little Cayman"], country: "Cayman Islands", siteIds: ["571e4a1e-e7bc-44bc-b230-a8dd9dddd874"], aliases: ["小开曼", "小开曼岛", "小開曼", "小開曼島", "リトルケイマン"] },
    // https://www.hellodive.com/dive/pointlist/84.html
    // https://travel.padi.com/ja/dive-site/intoneshia/ceningan-wall-2/
    { names: ["Ceningan wall, Nusa Lembongan, Bali, Indonesia"], country: "Indonesia", siteIds: ["9dfe03d7-1fee-4348-946e-048f49b04a43"], aliases: ["金银岛海墙", "チュニガンウォール"] },
    // https://reefwander.com/diving/ambergris-caye/paradise-canyons/
    { names: ["Paradise Canyons"], country: "Belize", siteIds: ["d57fe7d7-e6cf-450e-9c26-7e73244d9d3c"], aliases: ["Paradise Canyon"] },
    // https://www.padi.com/zh-hans/dive-site/ao-da-li-ya/flinders-pier/
    // https://divedb.net/sites/flinders-pier
    { names: ["Flinders Pier"], country: "Australia", siteIds: ["3041cfac-5be9-47f2-9087-5b855ec31265"], aliases: ["弗林德斯码头", "Flinders Jetty"] },
    // https://www.divers.world/divesite/dahab/bannerfish-bay/
    { names: ["Bannerfish Bay"], country: "Egypt", siteIds: ["385dd470-b082-4de7-9913-0bf9e188a5ab"], aliases: ["Banner Fish Bay", "Trash Area"] },
    // https://www.divers.world/divesite/florida-keys-national-marine-sanctuary/sombrero-reef/
    { names: ["Sombrero Reef"], country: "United States", siteIds: ["c9e51385-35c1-421a-ab07-d5fd272610fb"], aliases: ["Sombrero Key Reef"] },
    // https://www.reef.org/db/reports/geo?region_code=TWA&zones=87010007
    { names: ["Buraco do Inferno"], country: "Brazil", siteIds: ["a47492f8-7514-4741-b91d-68dd04ad7576"], aliases: ["Hell Hole"] },
    // https://redcostabrava.com/canons-de-tamariu-inmersiones-de-buceo-en-la-costa-brava/
    // https://palamosdivecenter.com/en/canons-de-tamariu/
    { names: ["Canons de Tamariu"], country: "Spain", siteIds: ["c2343ae3-086e-4a57-9c2b-7aff254ec4cb"], aliases: ["Cañones de Tamariu", "Tamariu Canyons"] },
    // https://aquatica.se/utfarder/
    { names: ["Ön, Limhamn"], country: "Sweden", siteIds: ["589b7a9f-ea8a-400c-b239-2a1e16408adb"], aliases: ["Ön i Limhamn"] },
    // https://viconservationsociety.org/wp-content/uploads/2024/11/CC-STT-Guide-Final.pdf
    { names: ["Coki Point Beach"], country: "United States", siteIds: ["a932ffb7-8eff-4268-b2ac-9e22ea0afe9d"], aliases: ["Coki Beach"] },
    // https://cairnsdiveadventures.com.au/review/tusa-dive-trip-review/
    { names: ["Saxon Reef Magic Wall"], country: "Australia", siteIds: ["22955985-4ed5-4ad3-a746-51a64f6f6422"], aliases: ["Magic Wall Saxon Reef"] },
    // https://www.scubago.com/en/explore/destination/guam-9749646
    // https://portofguam.com/sites/default/files/ea_marine_survey_combined.pdf
    { names: ["Outhouse Beach"], country: "Guam", siteIds: ["8d0440eb-f972-4fbe-8a88-86c04db791e6"], aliases: ["Apra Beach", "Divers Beach", "Diver’s Beach"] },
    // https://www.manadodive.co.kr/research/bunaken
    // https://divememo.com/en/dive-sites/alung-banua
    { names: ["Alung Banua"], country: "Indonesia", siteIds: ["280dfe34-5b2a-4e77-a687-868570e84893"], aliases: ["알룽 바누아", "Alban"] },
    // https://conanp.gob.mx/conanp/dominios/islasgc/files/Guia_buceo.pdf
    { names: ["Swanee Reef"], country: "Mexico", siteIds: ["5a135a43-85e5-4029-9325-92004fd9b49b"], aliases: ["Swany Rock", "Roca Swany", "Roca Swanee"] },
    // https://kefidivers.com/el/dive-sites/shore
    // https://www.divingchaniacrete.com/diving-programs-for-certified-divers/elephant-cave-program/
    { names: ["Elephants Cave"], country: "Greece", siteIds: ["9f2e70dd-3a0d-4566-97ac-7b32cabb4a7a"], aliases: ["Σπήλαιο Ελεφάντων", "Σπήλαιο των Ελεφάντων"] },
    // https://abcdive972.com/sites-plongee-martinique/
    { names: ["Pointe Lezarde"], country: "France", siteIds: ["6d68eeef-39c8-4fee-81ac-80f8e6cd0312"], aliases: ["Pointe de la Lézarde", "La Pointe de la Lézarde"] },
    // https://scuba.network/dive-site/afeabf52-bc9a-48c7-96bc-ef110543dcd9/dive-log/212fcd01-353a-4515-8417-b9c8afcbcef4
    { names: ["Eight Acre Lake"], country: "United Kingdom", siteIds: ["7dd8f9c2-505e-48af-b4f8-578d39007fe5"], aliases: ["8 Acre Lake"] },
    // https://www.duikersgids.nl/en/dive-spots/jan-thiel-baai
    { names: ["Jan Thiel baai"], country: "Curaçao", siteIds: ["c6886ed9-f053-4f3b-8d42-b360aaf3c83b"], aliases: ["Jan Thiel Bay"] },
    // https://thisis-egypt.com/diving/sites/abu-kafan-north
    { names: ["Abu Kafan North"], country: "Egypt", siteIds: ["ce9d7b0b-c3de-4dce-a55d-f5634c7c6451"], aliases: ["Abu Gafan North"] },
    // https://seychellen.com/tauchspots-seychellen/
    { names: ["Coral Garden"], country: "Seychelles", siteIds: ["47a75503-70ab-4d2c-bdd6-6c410a3db412"], aliases: ["Coral Gardens"] },
    // https://temoanadiving.com/centres-de-plongee/eleuthera-tahiti
    { names: ["Hydravion et Goelett"], country: "French Polynesia", siteIds: ["6f7542b4-a48a-4cac-9047-d90bcac004d8"], aliases: ["Hydravion et Goélette", "Hydravion & Goélette"] },
    // https://www.scubago.com/en/explore/divesite/pink-beach-komodo-77790
    // https://discoverindonesia.co/zh/blog/diving-komodo
    { names: ["Pink Beach Komodo"], country: "Indonesia", siteIds: ["feb7f204-aa19-44c2-a025-48b21b5a7963"], aliases: ["Pantai Merah", "粉红沙滩"] },
    // https://www.divinginelba.com/siti-di-immersione/isola-delba/relitto-di-pomonte/
    { names: ["Relitto di Pomonte"], country: "Italy", siteIds: ["6e3f1429-1761-4167-98be-4320b27b0fd5"], aliases: ["Elviscot", "Relitto Elviscot"] },
    // https://www.padi.com/zh-hant/dive-center/duo-ming-ni-jia/scubacaribe-bayahibe-dr/
    // https://travel.padi.com/zh-hans/dive-trip/bayahibe/10-dive-package-16884/
    { names: ["Bayahibe"], country: "Dominican Republic", siteIds: ["aa588a42-0bf3-4f38-ad5d-51a473d95478"], aliases: ["巴亚希贝", "巴亞希貝"] },
    // https://www.padi.com/zh-hans/dive-site/ai-ji-he-hong-hai/um-sid/
    // https://scuba.aura.llc/dive-sites/umm-sid/
    { names: ["Um Sid"], country: "Egypt", siteIds: ["11afa6ab-8753-4d48-877b-73bfd09efd36"], aliases: ["乌姆西德", "Umm El Sid", "Um El Sid"] },
    // https://roatansplashinn.com/en/diving/dive-sites/the-odyssey
    { names: ["Odyssey (Wreck)"], country: "Honduras", siteIds: ["e8c34034-cf64-4ecc-b719-b7ef884e2fb5"], aliases: ["The Odyssey", "The Odyssey Wreck"] },
    // https://divemap.be/dive-sites/underwater-cave-menjangan.html
    { names: ["Underwater Cave"], country: "Indonesia", siteIds: ["c78e9c90-217e-4ff1-8a10-d40ef90da99c"], aliases: ["Underwater Cave Menjangan"] },
    // https://thelakeuk.com/activities/scuba-diving/
    { names: ["Cromhall Quarry"], country: "United Kingdom", siteIds: ["5b533958-9c3a-48e1-9880-faab79e8e642"], aliases: ["The Lake at Cromhall Quarry"] },
    // https://maxdivebali.com/dive-sites/gili-tepekong-and-mimpang/
    // https://reefwander.com/diving/padangbai-candidasa/gili-mimpang/
    { names: ["Gili Mimpang, Candidasa"], country: "Indonesia", siteIds: ["f2188051-21c8-48d9-9916-f45ee02dec0e"], aliases: ["Batu Tiga", "Three Rocks", "ギリミンパン", "バトゥティガ"] },
    // https://goldcoastdiveadventures.com.au/north-stradbroke-island-dive-sites/
    { names: ["Flat Rock - Nursery"], country: "Australia", siteIds: ["0c9bd707-1edf-454e-bcf8-5f7e93713e4a"], aliases: ["Flat Rock The Nursery", "The Nursery"] },
    // https://www.scubago.com/cn/explore/divesite/menjangan-bat-cave-136667
    // https://xn--eckya9b7cr9ksc.com/menjangan-diving-tour-enjoy-diving-and-hot-spring/
    { names: ["Menjangan - Bat Cave"], country: "Indonesia", siteIds: ["8b3c2fd7-3d35-4810-9184-40f70fc6a18f"], aliases: ["蝙蝠洞", "バットケーブ"] },
    // https://travel.padi.com/zh-hans/dive-trip/pacific-coast-of-mexico/marietas-islands-dive-adventure-national-park-scuba-snorkel-experience-from-sayulita-11899/
    // https://www.divers.world/zh-cn/country/mx/
    { names: ["Islas Marietas"], country: "Mexico", siteIds: ["1185ecfe-dd87-46c8-9ed0-bf5574d8d028"], aliases: ["玛丽埃塔斯岛", "玛丽埃塔群岛", "马里埃塔群岛"] },
    // https://www.divingcenterposeidonroses.com/pf/inmersion-el-gat-costa-brava-cap-de-creus/
    // https://www.submarinismocostabrava.com/compromiso-azul/rutas-de-inmersiones-ecoguiadas-en-la-costa-brava
    { names: ["El Gat"], country: "Spain", siteIds: ["0a2c0275-ab51-4648-8d0a-e5455d2df0b7"], aliases: ["El Gato", "El Gat del Cap Norfeu"] },
    // https://pro.reunion.fr/sites/default/files/2017-09/IRT-Guide%20activite%202017_FR%20WEB.pdf
    { names: ["Sec Jaune"], country: "France", siteIds: ["ffdd82d8-a59f-4623-a6f0-4814d8373ab0"], aliases: ["Le Sec Jaune"] },
    // https://pepedivemahahual.com/preguntas-frecuentes-sobre-el-buceo-en-mahahual/
    { names: ["Acuario"], country: "Mexico", siteIds: ["e9c7b489-c28f-4ea2-8948-fcff25afd510"], aliases: ["El Acuario"] },
    // https://happybubbles.com/tr/ds-big-reef/
    { names: ["Big Reef"], country: "Türkiye", siteIds: ["17f9dc02-174e-4f22-8a38-72a4ce4c3ec1"], aliases: ["Büyük Resif"] },
    // https://bleumarineplongee.re/nos-spots-de-plongee-a-la-reunion/
    { names: ["Tour de Boucan"], country: "France", siteIds: ["949f5a44-ae4a-4edb-a1d8-c41f1fa0092c"], aliases: ["La Tour de Boucan"] },
    // https://www.swiss-divers.ch/informationen/tauchplaetze/bodensee/wildsau-berlingen/
    { names: ["Berlingen, Wildsau"], country: "Switzerland", siteIds: ["2716af03-2441-4c2d-9764-4bec9b6f0714"], aliases: ["Wildsau Berlingen", "Wildsau"] },
    // https://www.duikbuddygezocht.nl/locaties/locatie/venue/285%3Agrasbroek
    // https://duikplaats.net/nederland/overijssel/het-grasbroek
    { names: ["Grasbroek"], country: "Netherlands", siteIds: ["c2ff0475-e295-468d-a109-a72f69567259"], aliases: ["'t Grasbroek", "Het Grasbroek"] },
    // https://divecodex.com/sites/vilingili-kandu
    {"names": ["Vilingili Kandu"], "country": "Maldives", "siteIds": ["7b447d7d-67ec-4df5-8df8-37d2bef9886c"], "aliases": ["Villingili Kandu"]},
    // https://www.justgottadive.com/dive_resources/travel_articles/cave-diving-belizes-ambergris-caye-love-tunnels-victoria-canyons
    {"names": ["Tuffy Canyon"], "country": "Belize", "siteIds": ["6a8f3635-f02e-4a02-864c-38a8b005c7c8"], "aliases": ["Tuffy Rocks", "Tuffy Canyons"]},
    // https://www.sea-point.co.jp/blog/overseas/maldives/20th6days/
    {"names": ["Villivaru Giri"], "country": "Maldives", "siteIds": ["2eb749ad-2e33-45ec-97d3-98bb162df328"], "aliases": ["ヴィルバルギリ"]},
    // https://endheridivecenter.com/five-rocks-rheeti-thila/ and the sources in the review ledger.
    {"names": ["Five Rocks"], "country": "Maldives", "siteIds": ["e76fc46e-ad2f-4c2e-9cae-073c7fa99430"], "aliases": ["Reethi Thila", "Rheeti Thila", "五石礁"]},
    // https://www.divers-guide.com/en/car-pile
    {"names": ["Car Pile - Marie Pampoen (Wreck)"], "country": "Curaçao", "siteIds": ["8ecd51c6-f574-4670-9b5c-e5b58ee05f25"], "aliases": ["Carpile Marie Pampoen"]},
    // https://observatoriodoturismo.es.gov.br/Media/observatorio/Pesquisas/Inventarios%20Municipais/Guarapari.pdf
    {"names": ["Ilha Escalvada"], "country": "Brazil", "siteIds": ["122f1036-c7f4-4941-910e-a174d93da682"], "aliases": ["Ilha da Escalvada"]},
    // https://www.scubago.com/ja/explore/destination/flores-9752455 and the sources in the review ledger.
    {"names": ["Wai Nilu"], "country": "Indonesia", "siteIds": ["c8a4093f-86ac-41a1-a00e-ba5ed2acfc50"], "aliases": ["ワイニル", "Wainilu"]},
    // https://pmc.ncbi.nlm.nih.gov/articles/PMC10622855/
    {"names": ["Bikini"], "country": "South Africa", "siteIds": ["475c1c87-aebc-4e31-a6d2-0e54ddbffbf1"], "aliases": ["Bikini Reef"]},
    // https://www.padi.com/zh-hans/dive-site/ao-da-li-ya/rottnest-island/ and the sources in the review ledger.
    {"names": ["Rottnest Island"], "country": "Australia", "siteIds": ["753b4fc0-17ca-45b8-84aa-eb2ba6edc6be"], "aliases": ["罗特尼斯岛", "罗特内斯特岛", "ロットネスト島"]},
    // https://manta-dive-giliair.com/gili-islands-dive-sites/goodheart-all-levels
    {"names": ["Good Heart"], "country": "Indonesia", "siteIds": ["4f74ca0f-d7b4-4680-8621-db4be63860eb"], "aliases": ["Goodheart"]},
    // https://turismofuencalientedelapalma.com/fuencaliente/playa-de-las-cabras/
    {"names": ["Las  Cabras"], "country": "Spain", "siteIds": ["c7c0153f-109c-42f5-a0a6-8b1189f9c232"], "aliases": ["Playa de las Cabras"]},
    // https://ultramarina.com/voyage-plongee-ocean-indien/seychelles/mahe
    {"names": ["Twin Barges"], "country": "Seychelles", "siteIds": ["ea576fe4-9efa-49f5-93d6-619b12778145"], "aliases": ["Twin Barges Wreck"]},
    // https://taucher.net/tauchplatz-messinghausener_see__see_im_berg___brilon_-_messinghausen-haz2343
    {"names": ["Messinghausen, See im Berg"], "country": "Germany", "siteIds": ["4e74b1eb-6e60-40dd-971c-72b291863f0d"], "aliases": ["Messinghausener See"]},
    // https://sportnature.var.fr/plongee/pointe-de-montremian/
    {"names": ["Pointe de Montrémian"], "country": "France", "siteIds": ["dc701956-0191-4884-8dd5-e60199b6ef99"], "aliases": ["La piste de ski"]},
    // https://oceanworx.co.za/diving-the-shoal.html
    {"names": ["Chunnel"], "country": "South Africa", "siteIds": ["976b98fe-9fa3-41f4-a693-42637de3d0b9"], "aliases": ["Chunnel Cave"]},
    // https://www.ezdivemag.com/en/magic-moalboal/ and the sources in the review ledger.
    {"names": ["Kasai Wall"], "country": "Philippines", "siteIds": ["ea86bf2d-e381-4226-b0f3-3dcc22bdedd3"], "aliases": ["Kasai House Reef", "卡赛墙"]},
    // https://www.kkday.com/zh-cn/product/124072-dolphin-and-seal-swim-and-reef-snorkel-tour-melbourne and the sources in the review ledger.
    {"names": ["Popes Eye"], "country": "Australia", "siteIds": ["b2e92add-c6ca-4235-a78e-61fe367dc2fa"], "aliases": ["教皇之眼", "Pope's Eye", "Popes Eye Annulus"]},
    // https://www.scubago.com/de/explore/divesite/voglstangsee-3832
    {"names": ["Voglstangsee"], "country": "Germany", "siteIds": ["a66fb9d4-33d2-450f-ba78-d7b1c75a9226"], "aliases": ["Vogelstangsee"]},
    // https://www.africanwatersports.co.za/diving/cathedral-reef-dive/
    {"names": ["Cathedral"], "country": "South Africa", "siteIds": ["48094813-3dfc-4d8f-a59d-1660c2ea3162"], "aliases": ["Cathedral Reef"]},
    // https://travel.padi.com/zh-hans/dive-site/a-lu-ba/antilla-wreck/
    {"names": ["Antilla (Wreck)"], "country": "Aruba", "siteIds": ["74d089d8-18b5-4b3c-8d43-610fa2db5f43"], "aliases": ["安蒂拉号"]},
    // https://www.divecuracao.info/dive-travel-curacao/curacao-dive-travel-guide/curacao-beaches/
    {"names": ["Snake Bay"], "country": "Curaçao", "siteIds": ["084525e5-cf98-4d36-9264-6da669a38ce8"], "aliases": ["Playa Wachi", "Slangenbaai"]},
    // https://www.timyeotravel.com/uploads/1/4/2/1/142109617/bonaire_dive_sites.pdf
    {"names": ["Pink Beach (53)"], "country": "Bonaire, Sint Eustatius and Saba", "siteIds": ["1f35026f-a94c-458a-a55c-ab1feab89229"], "aliases": ["Kabayé"]},
    // https://www.visit-mexico.mx/guerrero/ecotourism-and-adventure-in-acapulco/
    {"names": ["El Jardin"], "country": "Mexico", "siteIds": ["7fb97361-3696-4475-95ae-bf357c640646"], "aliases": ["The Garden"]},
    // https://www.mardaysresort.com/concurso/bases-competicion.pdf
    {"names": ["San Martin Sur"], "country": "Spain", "siteIds": ["130611ba-cfb3-4774-88ce-91750ce84eca"], "aliases": ["Cabo San Martín Sur"]},
    // https://vie-sous-marine.photo/site/passe-exterieure-de-boulari
    {"names": ["Passe exterieure Boulari"], "country": "New Caledonia", "siteIds": ["5352e08a-9e09-48c4-a7d6-17344649c7ff"], "aliases": ["Passe extérieure de Boulari"]},
    // https://tahiti-aqua.com/docs/hirodive_info.pdf and the sources in the review ledger.
    {"names": ["Tapu"], "country": "French Polynesia", "siteIds": ["872d5d92-24a9-49b0-bb3a-b940dfaf3eb3"], "aliases": ["タプー", "タプ"]},
    // https://www.klook.com/zh-HK/blog/philippines-diving/ and the sources in the review ledger.
    {"names": ["Angol Point"], "country": "Philippines", "siteIds": ["044188a2-5090-45b2-81bd-22d3fa8b2f7e"], "aliases": ["安戈尔角", "安戈爾角", "安格點", "앙골"]},
    // https://reefwander.com/diving/central-coast-nsw/ex-hmas-adelaide/
    {"names": ["Adelaide (Wreck)"], "country": "Australia", "siteIds": ["ffc43ebd-7885-4a0c-ac10-7f20456337b3"], "aliases": ["Ex-HMAS Adelaide", "HMAS Adelaide"]},
    // https://www.scubalov.in/havelock-island/havelock-dive-sites/the-slope/
    {"names": ["Slope"], "country": "India", "siteIds": ["b9801517-2101-40bc-9b48-889585ee8115"], "aliases": ["The Slope"]},
    // https://www.divers.world/divesite/sodwana-bay/4-buoy/
    {"names": ["Four Buoy, Sodwana Bay"], "country": "South Africa", "siteIds": ["87f09f31-03f9-4588-8be8-8da6beebb365"], "aliases": ["4 Buoy"]},
    // https://www.magnumbelize.com/wp-content/uploads/2018/10/islandtours.pdf
    {"names": ["Long Caye Aquarium"], "country": "Belize", "siteIds": ["798a7b3e-ae89-403e-8e45-f5ca223fa3ad"], "aliases": ["The Aquarium"]},
    // https://www.padi.com/zh-hant/dive-site/ao-da-li-ya/flinders-reef-2/ and the sources in the review ledger.
    {"names": ["Flinders Reef"], "country": "Australia", "siteIds": ["e7a0ad53-23e4-4617-bf73-4cae2020a793"], "aliases": ["弗林德斯礁", "플린더스 리프", "福林德礁", "費蓮達礁"]},
    // https://cebu.travel/diving/malapascua
    {"names": ["Quiliano"], "country": "Philippines", "siteIds": ["f4b9de98-26f0-4db0-9ebc-9a3e133e92db"], "aliases": ["Quilliano", "Guilliano"]},
    // https://islasaona.com/explore/isla-saona-vs-isla-catalina/
    {"names": ["Catalina The Wall"], "country": "Dominican Republic", "siteIds": ["b8f74ac2-82b2-421c-ba46-873949a624b5"], "aliases": ["El Muro"]},
    // https://www.barcelo.com/guia-turismo/es/republica-dominicana/republica-dominicana/que-ver/donde-bucear-en-punta-cana/
    {"names": ["Catalina Aquarium"], "country": "Dominican Republic", "siteIds": ["cc9101ec-157d-4bb6-b240-23d7da4352e5"], "aliases": ["El Acuario"]},
    // https://tahtilbahar.com/sites/anchorbay
    {"names": ["Anchor Bay"], "country": "Malta", "siteIds": ["b0be2cdd-007f-417b-a362-2bd968a7f3fd"], "aliases": ["Il-Prajjet", "Prajjet Bay", "Popeye Village"]},
    // https://deepdivemexico.com/arrecife-barracuda-en-playa-del-carmen/?lang=es and https://scubaspotadvisor.com/en/diving-spots/mexico/playa-del-carmen/barracuda-8479
    {"names": ["Barracuda - Playa del Carmen"], "country": "Mexico", "siteIds": ["aee63b68-1384-4fb7-96aa-1dd6d53c6a76"], "aliases": ["Arrecife Barracuda", "Barracuda Reef"]},
    // https://www.scubago.com/ja/explore/divesite/anau-22315
    {"names": ["Anau"], "country": "French Polynesia", "siteIds": ["546c34f1-6223-4bfc-a3d0-117f57f1efa6"], "aliases": ["アナウ"]},
    // https://www.buceoenrepublicadominicana.com/inmersiones/catalina-the-wall/
    {"names": ["Catalina The Wall"], "country": "Dominican Republic", "siteIds": ["b8f74ac2-82b2-421c-ba46-873949a624b5"], "aliases": ["La Pared", "The Wall Catalina"]},
    // https://programadestinosmexico.com/guias-turisticas-de-mexico/acapulco-guia/Travel-Guide-Acapulco.pdf
    {names:['Casa Del Árabe'], country:'Mexico', siteIds:['b1f76b98-242b-4a9c-9804-1df99aebdde4'], aliases:["Arab's House"]},
    // https://travel.padi.com/zh-hans/dive-center/ai-ji-he-hong-hai/coral-diving-club/
    // https://www.dive-club.com/diveclub/%E3%83%80%E3%82%A4%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88/%E3%83%80%E3%82%A4%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88%E3%80%80%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%BB%E3%83%8E%E3%83%BC%E3%82%B9/?lang=ja
    {names:['Ras Ghamila'], country:'Egypt', siteIds:['c03392b7-b420-4f5c-89df-f73b4cb2526b'], aliases:['拉斯加米拉','ラス・ガミーラ','Ras Gamila']},
    // https://scubaviva.ch/shop/events/tagesevent/ledi-wracks-walensee
    {names:['Ledi Wracks'], country:'Switzerland', siteIds:['d2cae8d8-871a-4d86-9227-1ba3873b4c01'], aliases:['Lediwracks']},
    // https://www.diveclub-marumar.com/point/
    {names:['Cenote Dream Gate'], country:'Mexico', siteIds:['1c0219e4-9b5e-4ca2-9d54-aff606ab2157'], aliases:['ドリームゲート']},
    // https://www.divers.world/fr/divesite/nosy-be-archipelago/mitsio-wreck/
    {names:['Mitsio Wreck'], country:'Madagascar', siteIds:['1038e262-ec00-444f-b192-81e153d86f5d'], aliases:['Mistio Wreck']},
    // https://seekocean.cn/destinations/anilao
    {names:['Twin Rocks'], country:'Philippines', siteIds:['02e832cc-5e64-46c8-9218-2c16070ef105'], aliases:['双石']},
    // https://www.scubalife.hr/lina/
    // https://krnica.com/web_pages.php?kat=Wrecks&r=73
    {names:['Lina (Wreck)'], country:'Croatia', siteIds:['6d94f915-a67c-45a5-a487-9218b3d1c27f'], aliases:['Kraljica Kvarnera','Nuevo Estramadura','Ville de Nemours']},
    // https://www.padi.com/ja/dive-site/suhein/el-bajon-5/
    {names:['El Bajón'], country:'Spain', siteIds:['61bc1302-57d5-41cd-9f95-f961c901b3ce'], aliases:['エル・バホン']},
    // https://diveandsea-tahiti.com/club-de-plongee-tahiti/
    {names:['La Faille St Etienne, Tahiti'], country:'French Polynesia', siteIds:['523334e0-6834-4b69-97a3-efe77bf3100d'], aliases:['Faille Saint Étienne']},
    // https://www.padi.com/ko/dive-site/oseuteureilria/fly-point/
    {names:['Fly Point'], country:'Australia', siteIds:['bd9bb575-a98d-477d-9fa4-ddc821a84265'], aliases:['플라이 포인트']},
    // https://www.scubago.com/cn/explore/divesite/montego-bay-115950
    // https://www.divers.world/zh-hk/country/jm/
    {names:['Montego Bay'], country:'Jamaica', siteIds:['0a2c2306-7d00-4989-b88f-d9db9d5d1574'], aliases:['蒙特哥湾','蒙特哥灣']},
    // https://vie-sous-marine.photo/site/fausse-passe-d-uitoe
    {names:['Fausse passe de Uitoé'], country:'New Caledonia', siteIds:['0a9d6d87-f510-44e3-bd43-b5cc6a281c14'], aliases:["Fausse passe d'Uitoé"]},
    // https://www.picture-worl.org/plongee-sous-marine-penetration-epave-caledonie-toho-v-lagon-noumea.html
    {names:['Toho V (Wreck)'], country:'New Caledonia', siteIds:['b2eed636-db66-4a86-8919-0c319db092ca'], aliases:['Calédonie Toho 5','Toho 5']},
    // https://www.divers.world/divesite/sodwana-bay/antons/
    {names:['Antons'], country:'South Africa', siteIds:['06e55200-2ce8-4279-a5fb-4361330c7dd8'], aliases:["Anton's Cave"]},
    // https://www.padi.com/zh-hans/dive-center/gu-ba/cuba-gardens-of-the-queen/
    // https://www.padi.com.tw/ko/diving-in/jareudin-delra-reina-jardines-de-la-reina/
    {names:['Jardines de la Reina'], country:'Cuba', siteIds:['d5f23680-93ce-4025-a9b2-dcf320d788c6'], aliases:['女王花园','女王花园群岛','Gardens of the Queen','자르딘 델라 레이나']},
    // https://www.bluerides.com/zh/mudidi/maldives/qianshui-didian
    // https://www.diveworldwide.com/pdf/Dive_Worldwide_Spring_2022_Brochure.pdf
    {names:['Kudimaa (Wreck)'], country:'Maldives', siteIds:['d796b0df-b580-4c9b-ac4d-5ce3b199243b'], aliases:['库迪马沉船','Kudhimaa Wreck','Machchafushi Wreck']},
    // https://www.padi.com/es/sitio-buceo/mexico/cuavitas/
    {names:['Cuevitas'], country:'Mexico', siteIds:['7cc09015-a932-4b82-af52-1f78b8c42fe1'], aliases:['Cuavitas']},
    // https://www.bluerides.com/zh/qianshui-didian/roca-partida
    // https://www.wtp.co.jp/area/47/Socorro/
    {names:['Roca Partida'], country:'Mexico', siteIds:['ef293d73-40e9-41f9-a766-b756e4268f13'], aliases:['罗卡帕蒂达','ロカパルティダ']},
    // https://www.amedjepundivers.com/dive-sites/amed/japanese-shipwreck
    {names:['Japanese Shipwreck (Wreck)'], country:'Indonesia', siteIds:['5dc20762-563c-4def-824b-6d7b3975f972'], aliases:['Japanese Wreck']},
    // https://www.bluerides.com/zh/qianshui-didian/guraidhoo-corner
    // https://www.diversetravel.co.uk/wp-content/uploads/2019/07/Sharktastic.pdf
    {names:['Guraidhoo Corner'], country:'Maldives', siteIds:['40c4b9a7-d235-4c49-b045-8acbf9df2453'], aliases:['古莱杜角','Guraidhoo Kandu South']},
    // https://www.scubadoctor.com.au/diveshop/index.php?main_page=divesite&site=St-Leonards-Pier
    {names:['St Leonards Pier'], country:'Australia', siteIds:['91fb2107-f346-46e6-993a-e410243b3930'], aliases:['St Leonards Jetty and Breakwater']},
    // https://www.scubaspotadvisor.com/en/diving-spots/mauritius/beau-bassin-rose-hill/la-cathedrale-1018
    {names:['La Cathédrale'], country:'Mauritius', siteIds:['555148fd-901b-42b2-a073-4e409d38a1cb'], aliases:['The Cathedral']},
    // https://tahtilbahar.com/sites/xattlahmarreef-xattlahmar
    {names:["Xatt L'Ahmar Reef"], country:'Malta', siteIds:['c8c04e06-8539-421b-9fa0-1e8d2bbcca69'], aliases:['Red Bay Reef']},
    // https://travel.padi.com/zh-hans/dive-site/mo-xi-ge/cenote-angelita/
    // https://www.kwda.co.kr/skin/html/book/2024-W-dentist.pdf
    // https://oacis.repo.nii.ac.jp/record/2254/files/kam3649.pdf
    {names:['Cenote Angelita'], country:'Mexico', siteIds:['593e81e7-2241-4259-a3be-3a1318fc95e5'], aliases:['小天使','앙헬리타','アンヘリータ']},
    // https://bluetrend.media/wreck-diving-with-dugong-in-coron-philippines/
    // https://www.pacificwarwrecks.com/gallery/akitsushima
    {names:['AKITSUSHIMA'], country:'Philippines', siteIds:['50ff3696-31fa-4be1-af3b-64788f9f7b91'], aliases:['秋津洲','秋津洲號']},
    // https://divememo.com/zh/dive-sites/fang-ming-wreck
    {names:['Fang Ming (Wreck)'], country:'Mexico', siteIds:['e291d5f2-4b8d-4ab1-80b9-69f632a47953'], aliases:['方銘號']},
    // https://jp.scubafreedom.com/?q=carwash
    // https://www.kwda.co.kr/skin/html/book/2024-W-dentist.pdf
    {names:['Cenote Car Wash (Aktun Ha)'], country:'Mexico', siteIds:['e3dfd53f-4a2f-48da-92cc-fa73ec9a7b2b'], aliases:['カーウォッシュ','アクトゥンハ','카워시']},
    // https://blog.padi.com/seeking-adventure-in-malaysias-perhentian-islands/
    {names:['Batu Layar'], country:'Malaysia', siteIds:['21595059-b135-4b70-ab9d-1cc07730eaad'], aliases:['Sail Rock']},
    // https://www.padi.com/zh-hant/dive-site/kai-man-qun-dao/ex/
    // https://blog.padi.com/ko/the-10-best-dive-sites-for-underwater-photography/
    // https://howisitgoing44.hatenablog.jp/entry/2017/01/27/184755
    {names:['USS Kittiwake (Wreck)'], country:'Cayman Islands', siteIds:['6401c78c-d572-43c7-8937-bcaa53991892'], aliases:['基蒂韋克號','키티웨이크','キティウェイク']},
    // https://news.blueforcefleet.com/snorkeling-in-the-red-sea/
    // https://71guardians.com/dive-sites/small-crack/
    {names:['Small Crack'], country:'Egypt', siteIds:['002e1a3e-bdd1-4532-9e35-e3892f68f7c3'], aliases:['Fossma Saghir','Small Passage']},
    // https://raja.meridianadventuredive.com/blog/friwen-wall-raja-ampat-local-dive-site-guide/
    // https://www.bluerides.com/ko/daiving-poineu/friwin-wall
    {names:['Friwen Wall, Raja Ampat'], country:'Indonesia', siteIds:['d326b806-0f23-43e6-bca9-0e449d85637d'], aliases:['Friwin Wall','프리윈 월']},
    // https://www.padi.com/ja/dive-site/nan-ahurikagong-he-guo/windmill-beach/
    {names:['Windmill Beach'], country:'South Africa', siteIds:['7f1de30f-c581-46d9-a783-e1a39819e011'], aliases:['ウィンドミルビーチ']},
    // https://tahititourisme.pf/experiences/les-spots-a-ne-pas-manquer/aquarium-de-faaa-faaa-fr-3346359/
    {names:['L&#039; Aquarium, Tahiti'], country:'French Polynesia', siteIds:['2b69f1a8-07e8-4531-af68-e8f572c76269'], aliases:["L'Aquarium Tahiti","Aquarium de Faa'a"]},
    // https://turismo.cartagena.es/gestion/documentos/54832.pdf
    {names:['Naranjito'], country:'Spain', siteIds:['419fbb53-36b8-4ef1-bd4a-9b63a710b6a7'], aliases:['Isla Gomera','Nadir']},
    // https://maldives-magazine.com/diving/ari-atoll.htm
    // https://www.bluerides.com/zh/qianshui-didian/maamigili-beyru
    {names:['Maamigili Beyru'], country:'Maldives', siteIds:['0767134f-f8cf-44ae-b7b5-183087830aff'], aliases:['Maamigili Outside','马米吉利贝鲁']},
    // https://jp.scubafreedom.com/?q=tajmaha
    // https://www.kooxdiving.com/en/activities/diving-in-cenotes/cenote-tajma-ha/
    {names:['Cenote Tajma  Ha'], country:'Mexico', siteIds:['da2566fb-2ebb-4b78-9e3d-78d7ec6c4042'], aliases:['タージマハ','Cenote Taj Mahal']},
    // https://diveplaza.com/ar/sites/abu-kafan-safaga
    // https://thisis-egypt.com/diving/sites/abu-kafan
    {names:['Abu Kafan'], country:'Egypt', siteIds:['ba5a6773-1e14-4009-ab7e-b75b9fcbc5af'], aliases:['ابو كفان','أبو كفن','Abu Gafan','Abu Kifan','Abu Qafan']},
    // https://www.hellodive.com/dive/pointlist/25.html
    // https://msocean.com.tw/archives/46905
    // https://divingholic.com/barracuda-lake-202304
    {names:['Barracuda Lake'], country:'Philippines', siteIds:['39e673c4-233f-4b0f-a7e3-f202d4754dd6'], aliases:['冷热湖','冷熱湖','海狼湖','바라쿠다 레이크']},
    // https://www.wediveutila.com/utila-dive-sites
    {names:['Ted&#039;s Point'], country:'Honduras', siteIds:['60211a54-e6f0-4b02-9198-28613bf1d878'], aliases:["Ted's Point",'Teds Point']},
    // https://divemap.be/dive-sites/el-natural-aguadilla.html
    {names:['El Natural'], country:'United States', siteIds:['808dc9ab-a63b-4ec7-9d86-07af6e1df035'], aliases:['Gas Chamber']},
    // https://turkeyscuba.com/tr/dive-sites/lego-hill
    {names:['Lego Hill'], country:'Türkiye', siteIds:['8b208cac-19cb-42a9-b534-c141fc0ffcdc'], aliases:['Legovil']},
    // https://divecodex.com/es/sites/portichol-norte
    {names:['Portitxol Norte'], country:'Spain', siteIds:['dba31f6f-5fda-4ebf-8b4b-acd4f5c1706b'], aliases:['Portichol Norte','Portixoll North']},
    // https://www.manadodive.co.kr/research/bunaken
    {names:['Lekuan 3'], country:'Indonesia', siteIds:['4155dd42-74ca-415f-a5ee-3d9c7f54d883'], aliases:['Lekuan III','레쿠안 III','레쿠안 3']},
    // https://www.indonesia.travel/sg/zh-cn/destination/bali-nusa-tenggara/bali/bali---menjangan-island
    {names:['Anchor Wreck'], country:'Indonesia', siteIds:['13c5ea96-7c39-4891-a34d-ef863afd32b7'], aliases:['Anker Wreck','Kapal Budak']},
    // https://martiniquepro.org/wp-content/uploads/2024/08/BrochureDiving_US.pdf
    {names:['Rocher du Diamant'], country:'France', siteIds:['dfcd8e57-eaa4-45d0-9b61-60248c674a99'], aliases:['Diamond Rock']},
    // https://jp.scubafreedom.com/?q=eden
    // https://travel.padi.com/dive-site/mexico/jardin-del-eden/
    {names:['Jardin del Eden Cenote (Ponderosa)'], country:'Mexico', siteIds:['15bf5383-b717-41f0-9a99-5ffaabf16f3c'], aliases:['セノーテ・エデン','セノーテポンデローサ','Garden of Eden']},
    // https://www.barefootsharkencounters.com/the-awakening-shark-dive-fiji
    {names:['The Awakening Bull Shark Dive'], country:'Fiji', siteIds:['2fdb5fa0-954d-4320-aa43-50f8edad3080'], aliases:['Awakening Shark Dive']},
    // https://www.padi.com/es/sitio-buceo/italia/scoglio-remaiolo/
    {names:['Scoglio del Remaiolo'], country:'Italy', siteIds:['7245d6d6-1ce4-49b6-8bbb-213426ba5162'], aliases:['Scoglio di Remaiolo']},
    // https://endheridivecenter.com/rangali-madivaru-manta-point/
    // https://www.shorediving.com/loc/mv/alif-dhaal-atoll/alifu-dhaalu-atoll/mandhoo
    {names:['Rangali Madivaru'], country:'Maldives', siteIds:['3e1ce1cf-90c1-4220-84c5-40a6b21cd0b3'], aliases:['Madivaru Rangali','Rangali Madivaru Manta Point']},
    // https://www.mikumbadiving.com/fam-island-paradise/
    {names:['Batu Rufas'], country:'Indonesia', siteIds:['aa75b416-5bf5-4616-9f29-2c523b74fda2'], aliases:['Batu Rufus']},
    // https://sunsethouse.com/divers-at-sunset-house/
    {names:['Sunset House Reef'], country:'Cayman Islands', siteIds:['ff15aad1-71b7-43b9-9568-0475c074310d'], aliases:['Sunset Reef']},
    // https://www.alonaboholdiversclub.com/scuba-diving-areas-in-bohol/dive-sites-in-panglao/
    // https://www.diveseason.com/dive/bohol/arco-point/
    {names:['Arco Point'], country:'Philippines', siteIds:['c1987215-8021-405a-be7b-e3a29b21edf1'], aliases:['Hole in the Wall','墙上的洞']},
    // https://www.padi.com/dive-site/indonesia/simons-reef/
    {names:['Simon’s Reef'], country:'Indonesia', siteIds:['e0c04b45-de5e-4275-bb6f-3336e31e4cf7'], aliases:['사이먼리프']},
    // https://www.dive-club.com/diveclub/%E3%83%80%E3%82%A4%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88/%E3%83%80%E3%82%A4%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88%E3%80%80%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%BB%E3%83%9F%E3%83%89%E3%83%AB/?lang=ja
    {names:['Middle Garden'], country:'Egypt', siteIds:['87f5dc4b-58ae-41b3-8dbc-ea4e96ed2c5d'], aliases:['ミドルガーデン','ミドル・ガーデン']},
    // https://busseltonjetty.com.au/wp-content/uploads/2024/01/Chinese-Simplified.pdf
    // https://www.busseltonjetty.com.au/wp-content/uploads/2024/01/Chinese-Traditional.pdf
    // https://busseltonjetty.com.au/wp-content/uploads/2024/01/Japanese.pdf
    {names:['Busselton Jetty'], country:'Australia', siteIds:['fc806c04-359f-403a-a5b5-8b9afe58b78d'], aliases:['巴瑟尔顿码头','巴瑟爾頓碼頭','バッセルトン桟橋']},
    // https://www.padi.com/zh-hant/dive-site/ai-ji-he-hong-hai/anemone-city-ras-mohammed/
    // https://thisis-egypt.com/diving/sites/anemone-city
    // https://aphroditeliveaboard.com/ja/north-tiran/
    {names:['Anemone City'], country:'Egypt', siteIds:['083d0167-c66f-4c71-bc00-0a282b31fb1b'], aliases:['海葵城','مدينة شقائق النعمان','アネモネシティ']},
    // https://tournews.tw/coron-dive-guide/
    // https://www.diveandcruise.cn/destination/coron-and-apo-reef
    // https://morefun-philippines.sdyf-pros.dragontrail.cn/wp-content/uploads/sites/6/2024/07/%E8%8F%B2%E5%BE%8B%E5%AE%BE%E6%BD%9C%E6%B0%B4%E6%89%8B%E5%86%8C2024V5.pdf
    {names:['Kogyo Maru'], country:'Philippines', siteIds:['14e475c0-c9c0-4f50-8009-8cba8f835faa'], aliases:['興業丸','兴业丸','工业丸号']},
    // https://anthonyskey.com/front-porch/
    {names:['Anthony’s Key Resort House Reef'], country:'Honduras', siteIds:['563d403d-bdaa-4066-a8c6-ad7eb2a7e650'], aliases:['Front Porch Reef','Front Porch']},
    // https://tpwd.texas.gov/state-parks/balmorhea/swimming-and-scuba-diving
    {names:['Balmorhea State Park'], country:'United States', siteIds:['ae0a4fcd-e945-4a49-9555-44ead7eca7f3'], aliases:['San Solomon Springs']},
    // https://thisis-egypt.com/diving/sites/far-garden
    {names:['Far Garden'], country:'Egypt', siteIds:['e73531f8-1221-487d-8525-6d9ad8b9dc6d'], aliases:['الحديقة البعيدة','Far Gardens']},
    // https://divemap.be/dive-sites/piscadera-piscadera-playa-largu-piscadera-playa-playa-grandi.html
    {names:['Piscadera Bay'], country:'Curaçao', siteIds:['ab9f809d-a858-4675-aaf7-015961f70f0c'], aliases:['Piscaderabaai','Piscadera Playa Largu']},
    // https://kdiver.com/ph/shop/Cebu-Malapascua-Sol-Divers-Cecilia?sea=%2Fbuddy%3Fview%3Dmeet%26id%3D63
    {names:['Dakit Dakit'], country:'Philippines', siteIds:['58dc25b4-103e-4727-a7d0-50c857768082'], aliases:['다킷 다킷','다킷-다킷']},
    // https://www.hellodive.com/dive/detail/7.html
    // https://www.bluerides.com/ja/daibingu-pointo/kuni/belize
    // https://www.liveaboard.com/kr/diving/belize/blue-hole
    {names:['Great Blue Hole - Belize'], country:'Belize', siteIds:['9b18e578-9032-4a0d-b4ea-ee8a6642b4eb'], aliases:['大蓝洞','大藍洞','伯利兹大蓝洞','グレートブルーホール','그레이트 블루 홀']},
    // https://www.divers.world/divesite/st-john-s-fury-shoals/abu-galawa-soraya/
    {names:['Abu Galawa Soraya'], country:'Egypt', siteIds:['2c55184c-c2c5-477f-87b3-deefaf9bd431'], aliases:['Abu Galawa Small','Abu Galawa Saghir','Abu Galawi Soraya']},
    // https://bonaire.com/en/dive-sites/eighteenth-palm/
    {names:['18th Palm'], country:'Bonaire, Sint Eustatius and Saba', siteIds:['dcec47b8-815e-49d1-b85d-a1d0d83cb09f'], aliases:['Eighteenth Palm','18 Palms','Eighteen Palms']},
    // https://hawaiitour.world-tours.jp/en/column/diving-spot
    // https://andyoucreations.com/ko/%EA%B1%B0%EB%B6%81%EC%9D%B4-%EC%8A%A4%EB%85%B8%ED%81%B4%EB%A7%81-%EC%98%88%EC%95%BD%ED%95%98%EA%B8%B0/
    {names:['Turtle Canyon'], country:'United States', siteIds:['37f13ccc-32d7-421d-9b3c-3251112be6f0'], aliases:['タートルキャニオン','터틀 캐니언']},
    // https://divecodex.com/sites/lusong-gunboat
    // https://reefwander.com/diving/coron/lusong-gunboat/
    {names:['Lusong Gunboat'], country:'Philippines', siteIds:['d6a8eb69-58ff-448e-b62f-04f8cac718e4'], aliases:['Lusong Wreck','Lusong Island Gunboat']},
    // https://www.padi.com/dive-site/denmark/amager-strandpark-og-havheksen/
    {names:['Amager Strandpark - Havheksen'], country:'Denmark', siteIds:['02b75cf5-ee51-4c8a-83a7-e1ce49d8606b'], aliases:['The Sea Witch']},
    // https://www.curacao.com/en/activity/playa-grandi-playa-piskado
    {names:['Playa Grandi / Playa Piscado'], country:'Curaçao', siteIds:['92364fff-a353-4e3a-bfc7-6714decc06a1'], aliases:['Playa Piskadó','Playa Piskado']},
    // https://www.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/chicken-reef/
    // https://marinediving.com/area/indonesia/rajaampat/
    {names:['Chicken Reef'], country:'Indonesia', siteIds:['006c7db3-1715-4f23-bd45-14e62b4749c9'], aliases:['鸡礁','チキンリーフ']},
    // https://www.aqabadive.com/ar/%D8%AF%D9%84%D9%8A%D9%84-%D8%A7%D9%84%D8%BA%D9%88%D8%B5-%D9%81%D9%8A-%D8%B4%D8%B9%D8%A7%D8%A8-%D8%A7%D9%84%D9%83%D9%8A%D9%88%D9%8A-%D8%A7%D9%84%D8%B9%D9%82%D8%A8%D8%A9/
    {names:['Kiwi Reef'], country:'Jordan', siteIds:['f0158c0f-6add-41bc-8ee3-f913867c8844'], aliases:['شعاب الكيوي']},
    // https://divecodex.com/es/sites/illes-formigues
    {names:['Illes Formigues'], country:'Spain', siteIds:['3ddb2fba-9bc1-4e48-8788-11d671ff0496'], aliases:['Formigues Islands','Islas Formigues','Islas Hormigas']},
    // https://wetset.com/dive-sites/
    {names:['The Wall'], country:'Mexico', siteIds:['058d0f2f-2490-4277-b4eb-fadfa3b5c800'], aliases:['La Pared']},
    // https://profundonomundo.com/pontos-de-mergulho-cozumel/
    {names:['San Francisco Wall'], country:'Mexico', siteIds:['0c39d2f3-7cbf-45bb-8956-dbff85dab437'], aliases:['Parede São Francisco']},
    // https://www.aircalin.nc/en/inspire-me/new-caledonia/sea/diving-new-caledonia
    {names:['Tépava'], country:'New Caledonia', siteIds:['efb443ab-0b48-4a77-a4c3-668ca24255cd'], aliases:['Tepava Potato']},
    // https://www.phuket-scuba.com/diving-liveaboards-divesites.html
    {names:['Hideaway Bay'], country:'Thailand', siteIds:['6c579423-9139-459e-820f-c4ffdf7e9b2d'], aliases:['Hideaway Reef']},
    // https://www.vg-wackersdorf.de/wackersdorf-tourismus/unsere-angebote/tauchen
    {names:['Murner See Rutsche'], country:'Germany', siteIds:['87bd6802-c3a8-411a-b25b-c4b6a92fdf48'], aliases:['Rutschn','Rutsch’n']},
    // https://www.amira-indonesien.de/wp-content/uploads/sites/4/2019/02/2018-02-ScubaNet-Raja_Ampat_mit_der_MV_Amira.pdf
    {names:['Blue Magic'], country:'Indonesia', siteIds:['f7d2465f-0fe3-421d-9b35-2337c9d457f1'], aliases:['블루매직','블루 매직']},
    // https://m.sohu.com/a/1053559827_145439/
    {names:['Batu Malang'], country:'Malaysia', siteIds:['ef652574-246f-4439-b1ae-34c2b131da5c'], aliases:['巴都马浪']},
    // https://www.divers.world/fr/divesite/nosy-be-archipelago/tanikely-nord/
    {names:['Tanikely Pain de Sucre'], country:'Madagascar', siteIds:['a7e7e390-e593-4dd0-bc26-640ee3ccc6d0'], aliases:['Tanikely Nord','Tanikely North','Petit Pain de Sucre']},
    // https://maltadives.com/sites/thepoint-reqqapoint/en
    {names:['Reqqa Point'], country:'Malta', siteIds:['07fe6160-ad81-4728-a917-74e865b42494'], aliases:['Ras ir-Reqqa','Reqqa Reef']},
    // https://balisharks.com/menjangan-island-diving/
    {names:['Menjangan - Pos 2'], country:'Indonesia', siteIds:['47a508bf-3846-4474-bcdf-a4511f09a182'], aliases:['Pos II']},
    // https://www.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/citrus-ridge/
    // https://www.padi.com/zh-hant/dive-site/yin-du-ni-xi-ya/citrus-ridge/
    {names:['Citrus Ridge'], country:'Indonesia', siteIds:['3485702c-bc23-48af-a01e-0ad5eaa7c016'], aliases:['柑橘岭','柑橘嶺']},
    // https://ttb.ch/tauchplaetze/schweiz?b=1000128&c=ND1000016&s=djEtqbXh4LP2L76k75XPNKTKPzp9_ejrSFKOuY7Qaii_b5U%3D
    // https://kaltunddunkel.ch/tauchplaetze
    {names:['Serrieres'], country:'Switzerland', siteIds:['ae3f44c3-854c-4e08-994a-7f522bc6a832'], aliases:['Serrières Marlboro','Serrières Philip Morris']},
    // https://travel.padi.com/zh-hans/dive-site/mo-xi-ge/pelican-rock/
    // https://travel.padi.com/ja/dive-site/mekishiko/pelican-rock/
    {names:['Pelican Rock'], country:'Mexico', siteIds:['a9922833-57d5-41c3-b9e7-e2ff7f12d4df'], aliases:['鹈鹕岩','ペリカンロック']},
    // https://www.scubago.com/cn/explore/divesite/pelican-rock-716453
    {names:['Pelican Rock'], country:'Costa Rica', siteIds:['1935052e-0067-4b5e-bad0-207d02418b91'], aliases:['鹈鹕岩']},
    // https://diverout.com/es/dive-sites/hn/west-end-wall
    {names:['West End Wall'], country:'Honduras', siteIds:['a721675c-a932-47c7-90cd-89c71ddf1141'], aliases:['Pared de West End']},
    // https://www.padi.com/zh-hans/dive-site/jordan/wreck-of-the-cedar-pride/
    // https://wowjordan.com/ar/listing/cedar-pride/
    {names:['Cedar Pride, wreck'], country:'Jordan', siteIds:['d775e666-458e-4eaa-bd94-dba61d3d8fbe'], aliases:['雪松骄傲号','سيدار برايد']},
    // https://travel.padi.com/zh-hans/dive-site/ku-la-suo/double-reef/
    {names:['Double Reef'], country:'Curaçao', siteIds:['4989b42a-8d2c-42af-be96-22a55cc894ed'], aliases:['双礁']},
    // https://letsdive.app/sites/the-canyon-el-can
    // https://www.wtp.co.jp/area/detail/169/Socorro/
    {names:['San Benedicto Canyon'], country:'Mexico', siteIds:['80cdf224-de2a-4339-b5ea-f0cb0a319331'], aliases:['El Cañón','The Canyon','キャニオン']},
    // https://www.freedomdive.com/th/dive_location/khao-lak
    // https://www.seadragondivecenter.com/diving-day-trips/khao-lak-reefs/
    {names:['Khao Na Yak'], country:'Thailand', siteIds:['f837d822-3dd7-4bd7-8e9d-71180148522b'], aliases:['เขาหน้ายักษ์','Khao Nayak Reef']},
    // https://www.divejct-phuket.com/diveblog/2025/09/28/christmas-point-similan-liveaboard/
    // https://www.hellodive.com/index.php/dive/pointlist/48.html
    {names:['Christmas Point'], country:'Thailand', siteIds:['1e82c4b9-4eb8-40cc-ac9c-0e2dd893ea6d'], aliases:['クリスマスポイント','圣诞潜点']},
    // https://www.ezdivemag.com/zh/%E5%8B%9D%E6%99%AF%E4%B9%8B%E9%96%93%E7%9A%84%E5%A4%A9%E5%A0%82/
    {names:['Seahorse Bay'], country:'Indonesia', siteIds:['2498a501-284a-4875-a798-984fbea73a69'], aliases:['海馬灣']},
    // https://cairnsaustralia.com/attraction/milln-reef/
    {names:['Milln Reef - The Whale'], country:'Australia', siteIds:['47b8d4ec-1182-4ec1-8786-7ed2c5ff848e'], aliases:['Whale Bommie']},
    // https://banyantreedivers.com/articles/mala-wharf-maui/
    {names:['Mala Wharf'], country:'United States', siteIds:['9d160013-e2fe-4b88-bae0-7a94a33358ad'], aliases:['Mala Pier']},
    // https://pdf.secretchina.com/UnitedKingdom/2020_1014_665/KZG_665.pdf
    {names:['Fish Rock Cave'], country:'Australia', siteIds:['dff87a2b-5cc9-4c49-8361-4fa5af02a7a9'], aliases:['魚岩','鱼岩洞']},
    // https://www.divers.world/es/divesite/roatan/el-aguila/
    {names:['El Aguila (Wreck)'], country:'Honduras', siteIds:['344b6ea7-9707-4a9f-945d-356ce1da961f'], aliases:['El Aguila Wreck','The Eagle','El Águila']},
    // https://www.divers.world/divesite/belize-barrier-reef-ambergris-caye/tackle-box-canyons/
    {names:['Tackle Box'], country:'Belize', siteIds:['5139429a-182f-403f-8092-cd37645b898c'], aliases:['Tackle Box Canyons','Tackle Box Canyon']},
    // https://xicodivecenter.com/zh-CN/first-time-cenote-diving-everything-you-need-to-know/
    // https://oacis.repo.nii.ac.jp/record/2254/files/kam3649.pdf
    {names:['Cenote Chac Mool'], country:'Mexico', siteIds:['0411ebe4-21f7-4dfc-85c6-1e2eeaa983fa'], aliases:['查克莫尔','チャックモール']},
    // https://www.scubago.com/cn/explore/destination/lighthouse-reef-9750366
    {siteIds:['0a8f16c3-06a1-4081-a715-09ced4bc8c20'], aliases:['半月岛墙']},
    // https://destinationcozumel.com/discover-scuba-diving-in-cozumel-paradise-reef/
    // https://www.scubago.com/es/explore/destination/cozumel-9750450
    {siteIds:['63ee624c-b6f2-49fb-87c2-9a462dceb529'], aliases:['Paradise Reef','Arrecife Paraíso']},
    // https://www.hellodive.com/uploads/2021/20210207/Philippines_diving.pdf
    // https://dcomeabroad.com/philippines-info/studylife/elnido_diving/
    {siteIds:['39e2144a-a418-47a4-9f4e-a5e80b01a726'], aliases:['南米尼洛克','南米尼洛']},
    // https://reefwander.com/diving/aliwal-shoal/raggies-cave/
    {siteIds:['bbf25c56-0293-44c8-9657-b79fdea1fcdb'], aliases:['Raggie Cave']},
    // https://www.youtube.com/watch?v=mUx2wl2Ipqo
    // https://www.siamdive.com/cn/blogs/htms-prab-741-wreck-diving-guide
    {siteIds:['e834757c-8fac-41f4-98d9-907cbb4743fb'], aliases:['เรือหลวงปราบ 741','HTMS Prap']},
    // https://www.scubago.com/en/explore/divesite/playa-cas-abao-142223
    {siteIds:['c2332b87-e906-4427-9bd7-580c304561f3'], aliases:['Playa Cas Abou','Cas Abou']},
    // https://www.dawndiveslanzarote.com/mejores-inmersiones-en-lanzarote/
    {siteIds:['369ecd41-c73c-47fa-bf3e-5d78169d614f'], aliases:['Calimera Reef']},
    // https://divecodex.com/sites/mgarr-ix-xini
    // https://tahtilbahar.com/sites/mgarrixxini
    {siteIds:['ab193cb3-9a81-4f47-99d9-3ce1309a3f54'], aliases:['Imġarr ix-Xini','Harbour of the Galleys']},
    // https://www.komodoresort.com/zh/blog/komodo-day-trip/
    // https://www.scubatimes.co.kr/articles/current-affairs-diving-komodo-with-aggressor-adventures-muorsf3v-xmhsnq
    {siteIds:['192903e2-0367-488e-97fd-abe06ecb1923'], aliases:['小塔塔瓦','타타와 케칠']},
    // https://www.oceantherapycharters.com/dive-sites
    {siteIds:['12593a97-b03f-4b0c-bff1-a1c3cba0f58a'], aliases:['Point Panic Pipe']},
    // https://scubadownunder.com/dive-sites/cook-island
    // https://goldcoastdiveadventures.com.au/cook-island-diving/
    {siteIds:['2e5e2c08-54bd-4ab3-9d40-fd12ddec01cc'], aliases:['Northern Ledges','Cook Island Northern Wall']},
    // https://www.scubago.com/en/explore/divesite/san-pedro-canyons-belize-199643
    // https://divebooker.com/tuffy-canyons-baz14891
    {siteIds:['7fb676cf-45a7-4065-a81c-e15077d79388'], aliases:['Tuffy Canyons','Tuffy Rocks']},
    // https://divesites.com.au/dive-site/the-caves-lady-musgrave
    {siteIds:['3b81c51d-a335-435d-a6f7-c614c1b3e6b1'], aliases:['The Caves Lady Musgrave']},
    // https://diveplaza.com/ar/sites/near-garden
    {siteIds:['099f30ca-3adb-4cc1-bc80-096929eb216c'], aliases:['الحديقة القريبة']},
    // https://hobo-ya-similan.com/similan/divesite/deepsix.html
    {siteIds:['7c7eca96-550c-4b88-9fa4-40cb66e557b6'], aliases:['ディープ シックス','ディープシックス']},
    // https://cdnc.heyzine.com/files/uploaded/11463057147015816d1d6472bd73fef6a20bc911.pdf
    // https://www.wtp.co.jp/area/detail/28/Raja%20Ampat/
    {siteIds:['6343ae6d-6436-48c3-8346-8ed434c3fa08'], aliases:['曼塔桑迪','マンタサンディ']},
    // https://natlib.govt.nz/records/35295991
    // https://www.performancediver.co.nz/trips-and-events/dive-spots
    {siteIds:['1e4de4a7-3bb6-4d00-8550-004a7597b3ff'], aliases:['Te Kohuroa','Matheson Bay']},
    // https://scuba-diving-tahiti.com/dive-site/la-vallee-blanche/
    // https://tahititourisme.pf/experiences/les-spots-a-ne-pas-manquer/vallee-blanche-papeete-fr-3347331/
    {siteIds:['89067520-f644-464a-b13b-2b28dda0eb63'], aliases:['White Valley','La vallée aux requins']},
    // https://travel.padi.com/zh-hans/dive-center/curacao/go-west-diving-2/
    // https://travel.padi.com/ko/dive-center/kwiraso/go-west-diving-2/
    {siteIds:['27bbdc7d-5953-4786-b0ce-147bf3758d10'], aliases:['爱丽丝梦游仙境','앨리스 인 원더랜드']},
    // https://www.scubaspotadvisor.com/es/puntos-de-buceo/mexico/mahahual/mahahual-reef-1311
    {siteIds:['fd7f27bc-7045-4d68-b6f5-5a0ba580ee0f'], aliases:['Arrecife Mahahual']},
    // https://vie-sous-marine.photo/site/spot-aux-mantas
    {siteIds:['3c4692ff-05b1-4ffc-8e80-49f469a280b7'], aliases:['Spot aux Mantas']},
    // https://www.scubago.com/en/explore/destination/brazil-9749765
    {siteIds:['59dcbbe4-4b1c-49b9-a84b-23e2e1c795c3'], aliases:['Ponta Grossa do Sítio Forte']},
    // https://www.tauchrevierdeutschland.de/2015-brechtsee/
    {siteIds:['741119c7-8df9-4d83-97c4-9a7ff5f46592'], aliases:['Baggersee Brecht']},
    // https://maltadives.com/sites/tug2-exiles/en
    {siteIds:['f0b835e2-ba58-4f63-9654-31cba0927445'], aliases:['Tugboat 2','Tug Boat 2','Tuo Lun Er Hao']},
    // https://www.padi.com/ja/dive-site/ekuatoru/kicker-rock/
    {siteIds:['7548cd06-d262-4a36-bcb9-b3a898eab4e8'], aliases:['キッカーロック','スリーピング ライオン']},
    // https://iyoulifeday.com/entry/%EC%84%B8%EB%B6%80-%EB%A7%89%ED%83%84-%EB%8B%A4%EC%9D%B4%EB%B9%99-%EC%9E%85%EC%9E%A5%EB%A3%8C-%EB%82%B4%EA%B3%A0-%EA%B0%88-%ED%95%84%EC%9A%94-%EC%9E%88%EC%9D%84%EA%B9%8C-%EC%83%B9%EA%B7%B8%EB%A6%B4%EB%9D%BC-%ED%83%90%EB%B6%88%EB%A6%AC-%ED%9E%90%EB%A3%A8%EB%9A%B1%EC%95%88
    {siteIds:['032b6454-318a-4c0d-9b1c-916cb848ca7d'], aliases:['샹그릴라 해양 보호구역']},
    // https://scubasensationcc.com/divetours/esmeralda
    {siteIds:['f7f02dd1-7f0a-4d92-aace-35ecb2b045f8'], aliases:['Esmeralda Canyons']},
    // https://www.padi.com/zh-hans/dive-site/ao-da-li-ya/blairgowrie-pier-2/
    // https://www.scubadoctor.com.au/diveshop/index.php?main_page=divesite&site=Blairgowrie-Pier
    {siteIds:['a02c1cf8-95e4-4246-8b0a-b41d6af4e4f4'], aliases:['布莱尔高里码头','Blairgowrie Jetty']},
    // https://vivabluediving.com/inmersiones/playa-de-jabillo/
    // https://www.turismoteguise.com/es/naturaleza-playas/el-jablillo
    {siteIds:['26654013-b164-4da5-91f2-fcd8547efcbf'], aliases:['Playa del Jablillo','El Jablillo']},
    // https://www.scubago.com/en/explore/divesite/flynn-reef-2-gordonand039s-71696
    {siteIds:['e2f02035-1edd-460b-adcc-c96b531037ba'], aliases:["Gordon's Mooring","Flynn Reef - 2 Gordon's"]},
    // https://www.neptuneliveaboards.com/zh/blog/raja-ampat-islands-in-indonesia/
    // https://www.scubago.com/ja/explore/destination/indonesia-9752445
    {siteIds:['b36ee1f4-7404-4dd8-8540-b81a06aabd9b'], aliases:['米奥斯昆','ミオスクン']},
    // https://maltadives.com/sites/cathedralcave/en
    // https://tahtilbahar.com/sites/cathedralcave
    {siteIds:['0fdc841b-490b-41c7-a3c2-500ab276d6ff'], aliases:['Blue Dome','Ghar ir-Rih','Għar ir-Riħ','Cave of Wind']},
    // https://vilaombakdivers.com/zh/%E6%BD%9C%E7%82%B9/
    {siteIds:['6b1a2564-ef8d-437d-b544-f22988bd30a5'], aliases:['Mirko礁','Mirko Reef']},
    // https://www.scubago.com/en/explore/divesite/menjangan-eel-garden-113895
    {siteIds:['80262094-a16c-4b55-9f70-0e0161e16898'], aliases:['Garden Eel']},
    // https://egyptdivers.com/hurghada/dive-sites/carless-reef/
    {siteIds:['d21fb77e-2f45-4012-8ed8-ab661b7660d5'], aliases:['Careless Reef']},
    // https://www.duikersgids.nl/en/dive-spots/marie-pampoen
    {siteIds:['4698875e-96ff-4ba0-9839-72db82ff1344'], aliases:['Pierbaai']},
    // https://www.scubago.com/ar/explore/divesite/ras-nasrani-200837
    // https://viamare.jp/%E6%B5%B7%E5%A4%96%E3%83%84%E3%82%A2%E3%83%BC%E3%81%AE%E3%81%94%E5%A0%B1%E5%91%8A/5478/
    {siteIds:['971ca4c7-6077-42ad-a832-88589956a1bb'], aliases:['رأس نصراني','ラス・ナスラニ']},
    // https://diveschool.pro/en/dive-sites/zeelandbrug/
    {siteIds:['c19b1a92-5a08-4b31-9dfa-5cec6e2ebf88'], aliases:['Zeeland Bridge']},
    // https://www.blacktipdiverscr.com/las-catalinas
    {siteIds:['db147e30-aa5d-427f-a7d3-60ae163e6411'], aliases:['El Clásico']},
    // https://curacao.day/en/dive-sites
    {siteIds:['20532eb7-4cac-413c-8f04-96fa124f6306'], aliases:['Boka Sami']},
    // https://jp.scubafreedom.com/?q=pit
    // https://www.lumosdive.com/cenote-diving
    {siteIds:['33bcd6f6-6151-4510-a364-95efff41563d'], aliases:['エル・ピット','세노테 엘핏','세노테 엘 핏']},
    // https://www.dresseldivers.com/blog/punta-francesa-reef/
    {siteIds:['ab4d7c9c-8022-403f-884d-67e4f5cb2062'], aliases:['La Francesa','La Francesca','La Dama Francesa']},
    // https://medusadive.com/ullastres-iii/
    {siteIds:['c95fa310-706c-48f5-9492-bb56b3a6a5fa'], aliases:['Ullastres III']},
    // https://www.sunshinedive.com/dive-site
    // https://traveldive.co.kr/12
    {siteIds:['621e25bf-07bd-4d1a-95de-584cbcb75c0e'], aliases:['선셋리프','선셋 리프']},
    // https://blog.padi.com/cn/top-dive-travel-destinations-as-recommended-padi-travel/
    // https://trip.hellodive.com/package/The_SS_Yongala_Wreck_Dive_Day_Trip_Townsville
    // https://oceana.ne.jp/from_ocean/64571
    // https://dive.heeho.net/spots/ss-yongala
    {siteIds:['a8039b55-bb7b-4652-9544-079c0b855091'], aliases:['永加拉','永嘉拉沉船','ヨンガラレック','SSヨンガラ','SS 용갈라']},
    // https://www.divers.world/divesite/bay-of-naples/banco-di-santa-croce/
    {siteIds:['ec91ceaf-70e8-4447-a1be-c77a2260147e'], aliases:['Banco Santa Croce','Santa Croce Bank','Banco di Santacroce','Secca del Bikini']},
    // https://divecodex.com/sites/palancar-horseshoe
    {siteIds:['7c71b426-85da-4286-bc2a-efcfb35e25eb'], aliases:['La Herradura','Palancar Herradura']},
    // https://www.scubago.com/tw/explore/destination/panglao-9753628
    // https://www.scubago.com/ko/explore/divesite/danao-wall-253888
    // https://french-touch-diving.com/zh-CN/%E8%8F%B2%E5%BE%8B%E5%AE%BE%E6%BD%9C%E6%B0%B4/%E9%82%A6%E5%8A%B3%E6%BD%9C%E6%B0%B4/
    {siteIds:['041eeba1-b6ae-4677-9763-b0dda3b6e76a'], aliases:['达瑙墙','達瑙牆','다나오 월']},
    // https://divesites.com.au/dive-site/troppos-norman-reef
    {siteIds:['e13cb587-0d79-42e9-ae74-66c226f6f0cc'], aliases:["Troppo's"]},
    // https://www.siamdive.com/ja/explore/dive-center/kuramathi-dive-club
    {siteIds:['bfe3173c-5b24-44f6-b9a8-b518482e3b28'], aliases:['クラマティのハウスリーフ']},
    // https://www.mvgiamani.com/thailand-dive-sites/koh-bon-koh-tachai-dive-sites/koh-bon-pinnacle/
    // https://hobo-ya-similan.com/similan/divesite/bonpinnacle.html
    {siteIds:['eb506a51-0231-45fe-a9fa-016272e43415'], aliases:['Hin Luang','コ ボン ピナクル']},
    // https://www.padi.com/dive-site/portugal/pedra-do-leao-lions-rock/
    {siteIds:['3df8b701-92ac-43c6-a54f-fe8f54ba15ba'], aliases:['Lion’s Rock','Lions Rock']},
    // https://www.hellodive.com/news/121.html
    // https://divesites.com.au/dive-site/rye-pier
    {siteIds:['437bd142-0d56-4374-bb6c-e9458b146956'], aliases:['莱依码头','萊依碼頭','Rye Jetty']},
    // https://www.divers.world/zh-cn/divesite/bali/lipah-bay/
    {siteIds:['2c013d2e-cf77-4132-b1a2-cfcb4d2031f1'], aliases:['利帕湾','利帕灣']},
    // https://vilaombakdivers.com/zh/%E6%BD%9C%E7%82%B9/
    {siteIds:['5a4aff86-f991-45af-ba72-94e0f492c509'], aliases:['美诺斜坡','美諾斜坡']},
    // https://www.hellodive.com/dive/pointlist/53.html
    // https://feeldeep.com.ph/ja-home
    // https://www.neverdieve.com/fundiving
    {siteIds:['9fe2f9fa-20e4-4d63-a364-c2884b6c3e74'], aliases:['塔利马','塔利馬','タリマ海洋保護区','탈리마']},
    // https://ilhamuseu.org/ilha-das-cabras/
    {siteIds:['000bd772-c75f-4032-9307-0a549104ce56'], aliases:['Santuário Ecológico da Ilha das Cabras','Ilhote das Cabras']},
    // https://portghalib.com/media/news/2018/torfet
    {siteIds:['310ec3b2-69af-4ed1-878e-8d0c5131abcf'], aliases:['Villa Kharafi','Villa Al Kharafi']},
    // https://www.padi.com/zh-hans/dive-center/belize/turneffe-flats/
    // https://www.travelbelize.org/zh-tw/attraction/wit-turneffe-dive-snorkel-site/
    {siteIds:['f1e9a159-535a-48c8-ba95-e70a110bb7f7'], aliases:['特内夫环礁','特內夫環礁','圖內夫環礁']},
    // https://www.scubago.com/tw/explore/divesite/molokini-crater-86297
    // https://www.jtb.co.jp/kaigai_guide/hawaii/the_united_states_of_america/IMU/112179/
    {siteIds:['22d584d6-ec67-4f33-a9c8-11fea992d629'], aliases:['莫洛基尼火山口','モロキニ島']},
    // https://www.blueoceandive.de/en/diving/dive-sites/
    {siteIds:['1ea29c4e-02c7-49b2-b841-f590c085b8ec'], aliases:['El Bells']},
    // https://publications.gov.cy/assets/user/publications/2019/2019_326/HTML/38/
    {siteIds:['679c4ff8-fd17-4a62-ae05-9ace7d071071'], aliases:['Σπηλιά του Κύκλωπα']},
    // https://files.hawaii.gov/dbedt/erp/Doc_Library/2021-06-23-HA-DEA-Kaukalaelae-Point-and-Makako-Bay-Installation-of-Day-Use-Mooring-Buoys.pdf
    {siteIds:['2ffd53f2-20d1-49d8-8308-ed49dda62056'], aliases:['Makako Bay','Manta Heaven','Manta Ray Heaven']},
    // https://komodounderwater.com/siaba-kecil-secret-garden/
    {siteIds:['35b9d445-df3e-472b-aa2c-5449c31d17c9'], aliases:['Secret Garden']},
    // https://www.crystallake.org/home/showpublisheddocument/21520/637998894309400000
    {siteIds:['887ee05f-8f63-4230-9db0-3bd9df476501'], aliases:['Three Oaks Recreation Area Scuba Zone']},
    // https://scuba10.net/scuba-diving-playa-del-carmen/
    // https://divebooker.com/chunzubul-baz11780
    {siteIds:['45b362fa-0ab2-4508-8906-6b89ea1fe7e2'], aliases:['Chunzumbul','Chun Zumbul Reef']},
    // https://kohtaothailand.com/dive-sites/tao-thong/
    {siteIds:['22a3492f-df98-47b5-ba21-676bc96f751f'], aliases:['Tao Thong']},
    // https://www.duikersgids.nl/toolenburger-plas
    {siteIds:['fbdb88f1-96f7-4c38-93bb-a3f053dff9bf'], aliases:['Toolenburger Plas','Recreatieplas Toolenburg']},
    // https://buceotenerife.net/el-bufadero-o-palm-mar-wall-sigue-mereciendo-la-pena-este-conocido-punto-de-buceo/
    {siteIds:['d98caa5b-53ae-4d85-a388-591b98609ed0'], aliases:['El Bufadero','Buffadero','Palmar Wall']},
    // https://www.submarinismocostabrava.com/fr/ecoguides-sous-marins-costa-brava/rutas-de-inmersiones-ecoguiadas-en-la-costa-brava/cala-viuda-coves-del-mila
    {siteIds:['66111954-90d0-4381-95c8-7da47dd04831'], aliases:['Coves del Milà']},
    // https://travel.padi.com/zh-hans/dive-site/ai-ji-he-hong-hai/shark-yolanda-reef-ras-mohammed/
    {siteIds:['e05e36ea-ef4f-4f5d-9202-da86e5e28b79','bb5a81fd-f431-4d1b-931a-8514594d3276'], aliases:['鲨鱼礁和约兰达礁','鯊魚礁和約蘭達礁']},
    // https://www.padi.com/dive-site/australia/manta-ray-bommie/
    {siteIds:['f275c5a9-883d-4c5c-9752-cc8e0d598b95'], aliases:['Manta Ray Bommie']},
    // https://bonairian.com/en/dive-sites/karpata/
    {siteIds:['d1392200-defe-4b01-a767-f2999348a5bc'], aliases:['Karpata Reef']},
    // https://www.purpledivepenida.com/batu-mulapan
    {siteIds:['afb8546d-4b56-415f-a9eb-92e2e2c0e3ef'], aliases:['Batu Mulapan']},
    // https://www.puertodelcarmen.com/wp-content/uploads/2024/10/Evolucion-del-proyecto-ZEConsciente-2021-2024-para-dossier-actualizado-a-18-de-octubre.pdf
    {siteIds:['673088dc-750d-4fbd-8afd-cb34fae5d59a'], aliases:['Pila de la Barrilla','Playa de Pila de la Barrilla']},
    // https://www.padi.com/de/tauchplatz/spanien/el-balito-marazur/
    // https://tenerife-diving.club/es/nosotros/lugares-buceo/desde-la-costa/
    {siteIds:['b858a164-63de-4aaa-a05d-a584d5b0a09b'], aliases:['El Balito Marazur','El Balito Marazul']},
    // https://www.padi.com/dive-site/malta/comino-island-santa-marija-cave/
    {siteIds:['4ca785c8-9746-4828-a288-a7d54f8a2217'], aliases:['Santa Marija Caves','Comino Caves','Ghemieri Caves']},
    // https://www.padi.com/zh-hans/dive-site/ai-ji-he-hong-hai/ras-katy/
    // https://www.dive-club.com/diveclub/%E3%83%80%E3%82%A4%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88/%E3%83%80%E3%82%A4%E3%83%96%E3%83%BB%E3%82%B5%E3%82%A4%E3%83%88%E3%80%80%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%BB%E3%82%B5%E3%82%A6%E3%82%B9/?lang=ja
    // https://taucher.net/tauchplatz-ras_kati__sharm_el_sheik_-haz2492
    {siteIds:['c62a8145-8065-43e7-bc46-5499be71e456'], aliases:['拉斯·凯蒂','拉斯·凱蒂','ラス・カティ','Ras Kati']},
    // https://vie-sous-marine.photo/site/passe-interieure-de-boulari
    {siteIds:['a67d17f1-0e00-48bc-915f-301868b9ebe9'], aliases:['Passe de Boulari intérieure']},
    // https://www.padi.com/zh-hans/dive-site/a-la-bo-lian-he-qiu-chang-guo/shark-island-2/
    // https://lokalee.app/ar/recommendations/shark-island
    {siteIds:['b68dc851-76e9-41f1-ad53-d0eb18914d91'], aliases:['鲨鱼岛','鯊魚島','جزيرة القرش']},
    // https://www.bluerides.com/ja/daibingu-pointo/koh-talang
    {siteIds:['98ecf21e-840e-402f-87d6-64ce89966f02'], aliases:['コ・タラン・ステップス']},
    // https://www.divers.world/zh-cn/divesite/raja-ampat/yenbuba-jetty/
    // https://www.neptuneliveaboards.com/zh/blog/dampier-strait-diving/
    {siteIds:['389d4056-49f0-4fdf-bddd-53862defa063'], aliases:['Yenbuba码头','Yenbuba碼頭','延布巴']},
    // https://tcaarau.ch/newtca/index.php/sichtweiten/sichtweiten-tauchplatzliste/location/5390
    {siteIds:['f008e48f-d26b-4dab-8b34-12a9ae7b5cc0'], aliases:['Zofiger Fisch','Bajazzo']},
    // The Lower Saxony bathing-water atlas uses Geester See for this reservoir.
    // https://www.apps.nlga.niedersachsen.de/batlas/index.php?b=DENI_PR_TK25_3409_01&p=bx
    {siteIds:['b9c95988-0185-4acc-85ea-cd402905a430'], aliases:['Geester See']},
    // https://www.padi.com/zh-hans/dive-site/fei-lu-bin/olympia-maru/
    {siteIds:['90d0fcbe-e886-479c-b92f-6a0f0de77f7d'], aliases:['奥林匹亚丸号']},
    // https://www.padi.com/zh-hans/dive-site/thailand/sail-rock-7/
    {siteIds:['e15ede43-d4df-4edb-abdb-22ece34e97d2'], aliases:['帆船石','Hin Bai']},
    // https://seaexplorersclub.com/htms-sattakut/
    {siteIds:['0ea38ae1-542d-43cc-8346-6c7098e82baa'], aliases:['HTMS Sattakut','LCI 742','USN LCI 739']},
    // The tourism dive guide names Kimud 基姆德浅滩; the operator also uses Kimod.
    // https://morefun-philippines.sdyf-pros.dragontrail.cn/wp-content/uploads/sites/6/2024/07/%E8%8F%B2%E5%BE%8B%E5%AE%BE%E6%BD%9C%E6%B0%B4%E6%89%8B%E5%86%8C2024V5.pdf
    // https://www.malapascuabeachresort.com/diving/
    {siteIds:['0c52b806-1483-492f-a528-c78101404de8'], aliases:['基姆德浅滩','基姆德淺灘','Kimod Shoal']},
    // Boga Wreck is also called Kubu Wreck; both catalog entries name it.
    // https://letsdivetulamben.com/dive-sites/boga-wreck/
    {siteIds:['c1aa604c-1a2d-4ab8-a9a5-76702e056a72','ba84eff4-018a-4ed2-96ac-d3ae1e1e9ef1'], aliases:['Kubu Wreck']},
    // Cozumel's Santa Rosa Wall names refer to this wall dive.
    // https://www.padi.com/zh-hans/dive-site/mo-xi-ge/santa-rosa-wall-2/
    // https://www.diveandcruise.cn/blog/cozumel-diving-guide
    // https://www.bluerides.com/ja/daibingu-pointo/santa-rosa-wall
    {siteIds:['b1b412a9-b25f-4722-a987-a4dded681a70'], aliases:['圣罗莎墙','圣罗莎大断层','サンタローザウォール']},
    // Diving sources name the Toyapakeh reef in Chinese, Japanese and Korean.
    // https://www.hellodive.com/dive/pointlist/251.html
    // https://scubali.com/ja/lembongan/
    // https://www.okdiversbali.com/ko/portfolio/%ED%86%A0%EC%95%BC%ED%8C%8C%EC%BC%80-%EB%88%84%EC%82%AC%ED%8E%98%EB%8B%88%EB%8B%A4%EC%84%AC/
    {siteIds:['4d2844b4-994f-45bd-8470-3d89e74c90f9'], aliases:['托亚帕克','トヤパケ','토야파케']},
    // Fisherman's Bank is this Ras Mohammed site, not Zanzibar's namesake.
    // https://www.divers.world/divesite/sharm-el-sheikh-ras-mohammed/jackfish-alley/
    {siteIds:['15c7b234-fa58-487b-97bd-dd08536dc865'], aliases:["Fisherman's Bank"]},
    // These names describe Fiji's Somosomo Rainbow Reef, not its namesakes.
    // https://www.padi.com/zh-hans/dive-site/fei-ji/rainbow-reef-5/
    // https://www.padi.com/ja/dive-site/huishi/rainbow-reef-5/
    {siteIds:['7ba5c6d0-1da3-4cfe-91e7-fb30d7620c8c'], aliases:['彩虹礁','レインボーリーフ']},
    // Japanese diving accounts use several spacings for Koh Haa Lagoon.
    // https://life-with-dive.jp/kohhaalagoon-kohhaa-thailand/
    // https://www.divejct-phuket.com/diveblog/2026/10/13/mv-seatopia-south-andaman-liveaboard-2026/
    {siteIds:['2d61fd4e-5449-4bc2-9c15-70510dca2e7f'], aliases:['コハー・ラグーン','コ・ハー・ラグーン','コー・ハー・ラグーン']},
    // Amed diver's Korean log names the Jemeluk wall dive.
    // https://divingholic.com/dive-concepts-tulamben-2023
    {siteIds:['bd171ebe-cd67-4779-9799-3b32ec4b7fc8'], aliases:['제멜룩 월']},
    // Two nearby records refer to the uniquely named Salem Express wreck.
    // https://www.liveaboard.com/zh/diving/egypt/salem-express
    // https://www.liveaboard.com/kr/diving/egypt/salem-express
    {siteIds:['4a212ba1-beca-4f38-b43f-579b7855ccf3','a8fc4eba-86bc-4b15-a6e6-86c5a836d890'], aliases:['塞勒姆快船','塞勒姆快车号','살렘 익스프레스']},
    // Cozumel's Paradise Reef is also known by its Spanish name.
    // https://www.padi.com/zh-hans/dive-site/mo-xi-ge/paradise-reef-4/
    // https://www.divers.world/divesite/cozumel-reefs-national-marine-park/paradise-reef/
    {siteIds:['880de6d9-d2e3-4c04-ae82-4ca2837bc72c'], aliases:['天堂礁','Paraiso','Paraíso','Paraiso Reef']},
    // SSI uses this Japanese name for Florida's Molasses Reef dive area.
    // https://www.scubago.com/ja/explore/divesite/molasses-reef-3020
    {siteIds:['4fb69c8d-7e97-4842-b995-2ed9cabfeea1'], aliases:['モラセスリーフ']},
    // The Bonaire salt pier is a specific shore dive, not every salt pier.
    // https://blog.padi.com/cn/diving-in-bonaire/
    // https://whatismylocation.ai/zh/quanqiu-zuijia-qianshui-mudidi
    {siteIds:['a58307c8-02f3-4d75-a94e-6bc6adc5b468'], aliases:['盐墩','盐码头']},
    // Sources identify these names with Koh Tao's Hin Wong Bay.
    // https://marinediving.com/area/thai/gulf_of_thailand/
    // https://www.thailandaddict.com/zh/koh-tao-guide
    {siteIds:['3e7a5a02-5437-442d-8bc7-4c150a8e3eb2'], aliases:['ヒンウォンベイ','欣旺湾']},
    // Sharm's Temple dive is distinct from other sites with that name.
    // https://www.padi.com/ko/dive-site/ijibteu-wa-honghae/temple/
    // https://www.dive-club.com/diveclub/%E3%83%80%E3%82%A4%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88/%E3%83%80%E3%82%A4%E3%83%96%E3%83%BB%E3%82%B5%E3%82%A4%E3%83%88%E3%80%80%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%BB%E3%82%B5%E3%82%A6%E3%82%B9/?lang=ja
    {siteIds:['a40b9a2d-7560-45d7-b276-593193e6c958'], aliases:['템플','テンプル']},
    // Black Forest is a common name; these sources identify Balicasag.
    // https://www.hellodive.com/dive/detail/Philippines_Balicasag_Island
    // https://bohol.jp/?page_id=73
    // https://www.letsgodiving.co.kr/DIVINGPOINT
    {siteIds:['83167995-4713-4aa4-b5d9-4123c8bdea09'], aliases:['黑森林','ブラック・フォレスト','블랙 포레스트']},
    // The Catalina dive park is also called Avalon Underwater Park.
    // https://scubabydesign.com/visiting-casino-point/casino-point-dive-park/
    {siteIds:['64d1824a-e36e-47ab-bb54-4f9efa29f0f2'], aliases:['Avalon Underwater Park']},
    // Phuket's Koh Doc Mai is known as Flower Island among divers.
    // https://www.padi.com/zh-hans/dive-site/thailand/koh-doc-mai-2/
    // https://www.divejct-phuket.com/diveblog/2026/10/13/mv-seatopia-south-andaman-liveaboard-2026/
    {siteIds:['6f7cad64-8efb-4690-b138-3dab5c4a1523'], aliases:['花岛','Flower Island','コ・ドクマイ']},
    // The Gold Coast dive guide also spells this Wavebreak Island.
    // https://divesites.com.au/dive-site/wave-break-island
    {siteIds:['9d8138c0-c9e1-475f-8f87-97bb347806dd'], aliases:['Wavebreak Island']},
    // Cozumel dive guide uses the shorter reef name for Punta Dalila.
    // https://cozumeldivehub.com/dive-sites/punta-dalila-reef-cozumel-dive-site
    {siteIds:['7dd92fa5-1ffc-4234-904f-fbf67e7d5237'], aliases:['Dalila Reef']},
    // Raja Ampat divers use these Chinese and Korean names for Melissa’s Garden.
    // https://7scuba.com/divesites/rajaampat/
    // https://www.rajaride.com/blog/ko/diving-guide
    {siteIds:['6c4e81de-9648-404c-8a32-69db89707e5c'], aliases:['玛丽莎的花园','瑪麗莎的花園','멜리사스 가든','멜리사 가든']},
    // Beacon Rock is the reef near, but distinct from, the Dunraven wreck.
    // https://thisis-egypt.com/diving/sites/beacon-rock
    {siteIds:['bd43d007-e65c-4d20-9939-d8c1ef37c072'], aliases:["Sha'ab Mahmud beacon",'Beacon Rock (Dunraven reef)']},
    // PADI names this Curaçao site Ocean Encounters House Reef.
    // https://www.padi.com/dive-site/curacao/stella-maris-ocean-encounters-house-reef/
    {siteIds:['f23f0ce6-273f-4371-b5ff-38cecab8a1ba'], aliases:['Ocean Encounters House Reef']},
    // Guadeloupe National Park names this mooring L’Aquarium.
    // https://www.guadeloupe-parcnational.fr/sites/guadeloupe-parcnational.fr/files/atoms/files/depliant_ilets-pigeon_6_volets_png.pdf
    {siteIds:['590c9de6-6ffe-4490-b403-fffd1bba8080'], aliases:['L’Aquarium']},
    // Sharm dive guides use multiple transliterations for Ras Za’atar.
    // https://sharm101.com/diving/dive-sites/ras-zaatar
    {siteIds:['3b8e5774-04a5-473c-930a-7a5b7eed6f1e'], aliases:['Ras Zaatar','Ras Zatar']},
    // Cozumel operators also spell Colombia Reef Columbia Reef.
    // https://www.dresseldivers.com/blog/columbia-reef/
    {siteIds:['95a1c41d-f5a6-4802-ab81-29b5e50d7022'], aliases:['Columbia Reef','Colombia Regular']},
    // PADI's Traditional Chinese guide names Gabr el Bint 加布爾賓特.
    // https://www.padi.com/zh-hant/dive-site/ai-ji-he-hong-hai/gabr-el-bint/
    {siteIds:['5a104c19-5210-4069-85cd-81ce19d77235'], aliases:['加布爾賓特','加布尔宾特','少女之墓']},
    // Similan divers call Elephant Head Rock 象头岩 and Hin Pusa.
    // https://www.hellodive.com/index.php/dive/detail/info/48.html
    // https://divecodex.com/sites/elephant-head-rock
    // https://hobo-ya-similan.com/similan/divesite/elephant.html
    {siteIds:['67bc7bfd-dd44-4a8f-85df-98272e7ff9d8'], aliases:['象头岩','象頭岩','象头石','象頭石','Hin Pusa','Hin Pusar','エレファントヘッドロック']},
    // The facility calls itself Transfo Duiktank.
    // https://www.duiktanktransfo.be/
    {siteIds:['4927bbbf-ddf9-43e0-9203-1210f83bd5f6'], aliases:['Transfo Duiktank']},
    // Similan dive guides call Three Trees 三棵树.
    // https://www.hellodive.com/dive/pointdetail/48/4208916735.html
    {siteIds:['b639e137-1141-4f3a-9296-7ce6c4f7ea6b'], aliases:['三棵树','三棵樹']},
    // Nusa Penida's Manta Bay is separate from Manta Point.
    // https://neptunescubadiving.com/zh/blog/diving-manta-rays-nusa-penida/
    // https://kdiver.com/id/shop/Bali-Nusa-Penida-Mantascape-Diving
    {siteIds:['8586415f-3ba6-4297-8c24-02a486c493fa'], aliases:['蝠鲼湾','蝠鱝灣','曼塔湾','曼塔灣','만타 베이']},
    // German divers also call this quarry Steinbruchsee Horka.
    // https://taucher.net/tauchplatz-steinbruch_horka-bericht-hlz12338
    {siteIds:['cc6cc236-ab08-455b-8418-84bcd9ae0868'], aliases:['Steinbruchsee Horka','Horkaer Steinbruch']},
    // Perhentian dive center writes this site Sanchoi Wreck.
    // https://btsdivers.com/dive-site/
    {siteIds:['f6ef523c-9b14-499c-a2aa-d32d0aebf48f'], aliases:['Sanchoi Wreck']},
    // Gozo dive center calls the Middle Finger pinnacle Ras il-Ħobż.
    // https://www.atlantisgozo.com/dive-sites/ras-il-hobz/
    {siteIds:['633ff653-78db-42e4-8f9e-c2826d000cf3'], aliases:['Ras il-Ħobż','Ras il-Hobz','Middle Finger Reef']},
    // NSW divers know the bridge dive as Swansea Channel.
    // https://centralcoastdivers.com.au/pages/local-shore-dives
    {siteIds:['a776557c-1000-4b86-a5ed-e3bd30c1eb4a'], aliases:['Swansea Channel']},
    // California divers also use the island's full name Santa Catalina Island.
    // https://dan.org/alert-diver/article/santa-catalina-island/
    {siteIds:['324f3118-6084-4512-b80b-a8dc25b33bb2'], aliases:['Santa Catalina Island']},
    // CDWS identifies the Hurghada minesweeper known as El Mina as Minya.
    // https://www.cdws.travel/wreck-diving/minya
    {siteIds:['9a6bedaf-01ca-4324-aa2b-c3bb873043bb'], aliases:['Minya','El Minya','Minija']},
    // C-53 was formerly USS Scuffle; both entries share the wreck coordinates.
    // https://dan.org/alert-diver/article/cozumel-revisited/
    // https://divecodex.com/sites/felipe-xicotencatl-c-53
    {siteIds:['daba2826-ab5c-4067-85ab-3c31e7c6cd79','d6869270-e668-5ad4-9d03-2ab5acf81b88'], aliases:['USS Scuffle','Pecio C-53','ARM General Felipe Xicoténcatl']},
    // Cozumel operators also list Tormentos as Tormentos Reef.
    // https://pelagicventuresscuba.com/cozumel-dive-sites/tormentos-reef-cozumel/
    {siteIds:['9ee56a90-73d5-4ac0-863f-b2aa60e9c46d'], aliases:['Tormentos Reef']},
    // Bonaire dive map names site 51 The Invisibles Reef.
    // https://divoceanbonaire.com/wp-content/uploads/2025/12/dive-sites.pdf
    {siteIds:['aa8ff57e-eb71-4fed-8364-4b586ce4ccf9'], aliases:['The Invisibles','The Invisibles Reef']},
    // Komodo dive sources call Castle Rock 城堡岩 and 卡斯尔岩.
    // https://www.scubago.com/cn/explore/divesite/castle-rock-komodo-109654
    // https://pinta-liveaboard.com/zh/blog/castle-rock-or-crystal-rock-komodo-pinnacles/
    {siteIds:['d0d02e01-2667-460b-9371-ca0dcd2f69c0','58eb8ead-363d-43b7-ac23-fae2645e7b69'], aliases:['城堡岩','卡斯尔岩','卡斯爾岩','キャッスルロック']},
    // Cozumel guides also call the brick field Palancar Ladrillos.
    // https://divecodex.com/sites/palancar-bricks
    {siteIds:['ba870135-1544-4147-816e-f52534dbbbe5'], aliases:['Palancar Ladrillos','Colombia Bricks','Columbia Bricks']},
    // Guadeloupe dive guide renders Le Jardin de Corail as The Coral Garden.
    // https://visiteguadeloupe.com/en/cousteau-reserve-guadeloupe-snorkeling-diving-pigeon-islets/
    {siteIds:['574a1e1c-c698-4840-9946-ac1e48ab1bd1'], aliases:['The Coral Garden']},
    // Key Largo dive operator uses the French name Récif français.
    // https://www.scubafunflorida.com/fr/key-largo-dive-trips/french-reef/
    {siteIds:['2ff79b20-70cf-49f2-9741-6ca4b3a61e4d'], aliases:['Récif français']},
    // Pramuka Island is the English place name used for this reef dive.
    // https://divemap.be/dive-sites/pulau-pramuka.html
    {siteIds:['739ed560-7163-4a68-a2ac-b2a24fd7ef90'], aliases:['Pramuka Island']},
    // Tenerife dive centers call Montaña Amarilla Yellow Mountain.
    // https://dive-tenerife.com/dive-site/yellow-mountain/
    {siteIds:['6bb036a7-d82e-404b-8116-7377834f7956'], aliases:['Yellow Mountain']},
    // German dive guides name this lake Baggersee Linkenheim.
    // https://www.pro-taucher.de/tauchplaetze/europa/deutschland/baden-wuerttemberg/streitkoepflesee/
    {siteIds:['de234f62-acd0-4a6c-9769-1f755b7f1fac'], aliases:['Badesee Streitköple','Baggersee Linkenheim']},
    // Khobar dive operator also calls Half Moon Bay خليج نصف القمر.
    // https://www.adventurekhobar.com/ar/diving-al-khobar-and-dammam
    {siteIds:['d9ae5984-5bb1-45f9-b290-679323d0fc58'], aliases:['خليج نصف القمر']},
    // Cozumel dive guides use these alternate Tunich spellings.
    // https://divecodex.com/sites/punta-tunich
    {siteIds:['2c3a4b34-69b9-4b67-ab4a-e67bac2d4561'], aliases:['Punta Tuniche','Punta Tunish','Tunich Reef']},
    // Sharm dive operator uses the Arabic name خليج القرش.
    // https://www.redseamarinesharm.net/ar/mawaqe-ghaws-sharm-el-sheikh
    {siteIds:['ddc24996-f7d7-4c28-9e96-e6a03f258f90'], aliases:['خليج القرش','鲨鱼湾','鯊魚灣','Shark Bay']},
    // Casa Cenote is also Cenote Manatí; Japanese divers call it カサセノーテ.
    // https://deepdivemexico.com/our-cenote-dive-sites-in-the-region/the-casa-cenote/?lang=en
    // https://www.diveclub-marumar.com/point/
    {siteIds:['f29a3cf2-b2c5-4566-8936-3e34cbf65e12'], aliases:['Cenote Manatí','Cenote Manati','Cenote Manatee','カサセノーテ']},
    // Phi Phi dive guides also spell Pileh Wall as Phi Leh or Piley Wall.
    // https://www.divers.world/divesite/phi-phi-islands/pileh-wall/
    {siteIds:['aa7af00d-a1ae-49af-b444-50206988cc6e'], aliases:['Phi Leh Wall','Piley Wall']},
    // Hurghada dive operators also call Ras Disha Torfa Ras Disha.
    // https://egyptdivers.com/hurghada/dive-sites/ras-disha/
    // https://cloudfront.masterliveaboards.com/website-docs/Egypt/Itineraries/Northern-Red-Sea-Wrecks-and-Reefs-Itinerary.pdf
    {siteIds:['95ec2ef3-7a25-4739-b3b3-4a0412a78656'], aliases:['Torfa Ras Disha','Disha Malagk','Disha Malagka']},
    // South Malé dive operator calls Cocoa Corner 可可角.
    // https://maldives.holidayinnresorts.com/zh-hans/recreation-facilities/diving/diving-sites/
    {siteIds:['8a62f3f4-419d-4c54-8c67-fc9edc96c1e8'], aliases:['可可角']},
    // The Poor Knights site is also called The Canyon by local divers.
    // https://www.seafriends.org.nz/issues/res/pk/night_dive.htm
    {siteIds:['b56f57bb-9b1c-4234-b880-dad97ced72e7'], aliases:['The Canyon']},
    // Dutch and Belgian dive clubs call Bergse Diepsluis Oesterdam.
    // https://www.dios.be/index.php?i=80&p=pagina
    {siteIds:['80a2f073-f19c-401c-a89a-a0d3fd987d78'], aliases:['Oesterdam','Gat van Tholen']},
    // Cretan dive center uses the Greek site name Μονοναύτης.
    // https://www.diversclub-crete.gr/el/sites-mononaftis-gr/
    {siteIds:['046e089c-b3c2-4cba-a9c1-3106ba9717d2'], aliases:['Μονοναύτης','Μονοναύτη','Mononaftis Rock']},
    // Padang Bai snorkeling guides use these names for Tanjung Jepun.
    // https://www.kkday.com/zh-cn/product/131795-blue-lagoon-snorkeling-tanjung-jepun-tour-bali-indonesia
    // https://4travel.jp/travelogue/11883817
    {siteIds:['c05e0b46-2179-4045-9e54-c29f42316ba6'], aliases:['丹绒捷鹏','丹戎杰蓬','タンジュンジュプン','タンジュンジェプン']},
    // The Sauwandarek dive follows the reef by the village jetty.
    // https://divernet.com/features/local-guide-to-raja-ampat-dive-sites-sauwandarek-jetty/
    {siteIds:['19e2eedc-5728-4224-af20-487f74a5d8b2'], aliases:['Sauwandarek Jetty']},
    // Gili dive operators use these names for Deep Turbo, not Shallow Turbo.
    // https://vilaombakdivers.com/zh/%E6%BD%9C%E7%82%B9/
    // https://www.sunshinedive.com/dive-site
    // https://www.padi.com/ja/dive-site/intoneshia/deep-turbo/
    {siteIds:['30dc8cdf-ebc4-4de0-9a33-c5454dca2d4b'], aliases:['深涡轮','深渦輪','딥터보','ディープターボ']},
    // Havelock dive operators also call Nemo Reef the Nemo Beach dive site.
    // https://frogman.in/nemo-reef-scuba-diving-havelock/
    {siteIds:['c099ba04-5cb7-41fb-8d60-8186f5ac7824'], aliases:['Nemo Beach']},
    // Greek dive guide identifies the Protaras site as Γκριν Μπέι.
    // https://simerini.sigmalive.com/media/documents/IN_LOVE_WITH_CYPRUS_BINDER.pdf
    {siteIds:['b9d3aea3-6748-4442-bd31-5e18050a516c'], aliases:['Γκριν Μπέι','Green Bay Beach']},
    // Hin Wong Pinnacle is offshore from the separate Hin Wong Bay site.
    // https://japancoralgranddivers.com/course_fun/point.html
    // https://www.padi.com/dive-site/thailand/hin-wong/
    {siteIds:['0273f356-329a-4c68-be42-d85550651b8d'], aliases:['ヒンウォンピナクル','Hin Wong Pinnacles']},
    // Khao Lak dive operators also spell the wreck Boon Sung and Boonsong.
    // https://www.localdivethailand.com/phuket-diving-sites/the-similan-and-surin-islands/boonsung-wreck/
    // https://www.idcphuket.com/scuba-diving/boonsong-wreck-khao-lak/
    {siteIds:['761fc2e3-9c19-4b5f-bf38-f6d0d84f04fc'], aliases:['Boon Sung Wreck','Boonsong Wreck']},
    // Two catalog records describe the same Komodo Crystal Rock pinnacle.
    // https://www.scubago.com/cn/explore/divesite/crystal-rock-komodo-132149
    // https://marinediving.com/area/komodo/
    {siteIds:['3b9f386a-25fd-4023-9015-d378f3944898','b64f80e3-d9e8-46af-ae9e-fdb380da1692'], aliases:['水晶岩','クリスタルロック','クリスタル・ロック']},
    // Dahab dive guide records Orca House Reef as Moray Garden.
    // https://71guardians.com/dive-sites/moray-garden/
    {siteIds:['71e381ad-5706-4f92-b71b-a8871de0a8f0'], aliases:['Orca House Reef','Marey Garden']},
    // Murcia's dive guide calls the Cabo de Palos cove Cala Escalerica.
    // https://www.turismoregiondemurcia.es/webs/murciaturistica/folletos/1/PTMDOC_1_3872019.pdf
    {siteIds:['85f5c87b-1af4-44ac-8932-455dc19aeeaa'], aliases:['Cala Escalerica','Cala Escalera']},
    // Coron operators call this wreck East Tangat Gunboat, distinct from Lusong.
    // https://piratescoron.com/dive-sites/
    {siteIds:['76a8d900-4bd9-4baf-8ef1-6ef0e9fce955'], aliases:['Terukaze Maru','East Tangat Gunboat','East Tangat Wreck']},
    // Tiran's Woodhouse Reef has established Chinese, Japanese and Korean names.
    // https://www.seawolf-safari.de/zh/divesite/woodhouse-reef
    // https://www.liveaboard.com/ja/diving/egypt/woodhouse-reef
    // https://www.padi.com.cn/ko/diving-in/tiran-haehyeob/
    {siteIds:['2a291d90-d225-4b3f-b9b8-057c93321907'], aliases:['伍德豪斯礁','ウッドハウスリーフ','ウッドハウス・リーフ','우드하우스 리프']},
    // PADI lists the northern Kata Beach reef under both word orders.
    // https://travel.padi.com/dive-site/thailand/kata-beach-north/
    {siteIds:['2ebe0cef-fea9-4788-9f93-f12a2b3a7011'], aliases:['Kata Beach North','Kata Beach Reef North']},
    // São Miguel divers also call the Dori wreck SS Dori.
    // https://reefwander.com/diving/sao-miguel-azores/dori/
    {siteIds:['db6b9914-9239-4739-ae16-df917c44315f'], aliases:['SS Dori','MV Dori']},
    // Les Ferranelles is also charted as Ferranelles and Les Ferrenelles.
    // https://divemap.be/dive-sites/ferranelles.html
    {siteIds:['c89d036d-e2f3-45bb-8c66-edbe741c18ab'], aliases:['Ferranelles','Les Ferrenelles']},
    // Curaçao dive guides refer to this site as Daaibooi Baai.
    // https://scubasnap.app/destinations.php?country=Curacao&divesite=Daaibooi+Baai
    {siteIds:['08394c27-b6fc-4f82-bbcc-342ce303927e'], aliases:['Daaibooi Baai']},
    // Northern Nursery is the named dive area at Nguthungulli Julian Rocks.
    // https://www.dpird.nsw.gov.au/fishing/marine-protected-areas/marine-parks/cape-byron-marine-park/scuba-diving-and-snorkelling
    {siteIds:['be4585b2-015f-4254-8319-9e915487c239'], aliases:['Northern Nursery']},
    // Big Brother is one island, not the two-island Brothers group.
    // https://www.bluerides.com/ja/daibingu-pointo/big-brother
    // https://dive.heeho.net/spots/big-brother-island
    {siteIds:['5b0a6fc7-7d5c-411f-afb1-c1e3e378361f'], aliases:['ビッグブラザー','빅브라더','Al Akhawain Kebir']},
    // Kubu Reef is separate from the nearby Boga wreck.
    // https://diverout.com/zh-Hant/dive-sites/id/kubu-reef
    {siteIds:['ac37b998-b1ce-4f3f-8321-838d6e52ed43'], aliases:['庫布礁','库布礁']},
    // The St. Croix pier dive is at Ann E. Abramson Marine Facility.
    // https://reefwander.com/diving/st-croix/frederiksted-pier/
    {siteIds:['15e02bdb-f84f-43d1-925a-a11ff06388de'], aliases:['Ann E. Abramson Marine Facility']},
    // Local and PADI dive guides list these names for Safaga and Gozo.
    // https://www.padi.com/dive-site/egypt/gamul-kebir/
    {siteIds:['b6df7cbd-f21d-41ef-86c2-f862af589b51'], aliases:['Gamul Kabir','Gamul Al Kabeir','Gamul al Kebeir']},
    // https://tahtilbahar.com/sites/inlandseatunnel-dwejra
    {siteIds:['037eeb37-bc91-49af-952c-1bcb846316da'], aliases:['Il-Qawra','Inland Sea Tunnel']},
    // REEF records Claudia and Claude as spellings of this Fury Shoals reef.
    // https://www.reef.org/db/zonecodes/list/?region_code=IORS
    {siteIds:['8d943276-e3bf-45b5-9602-c480c0f9f6cc'], aliases:["Sha'ab Claudia","Sha'ab Claude",'Claudia Reef','Abu Aklas']},
    // South Ari divers use Chinese, Japanese and alternate Latin spellings.
    // https://www.divers.world/ja/divesite/ari-atoll/kudarah-thila/
    // https://travel.padi.com/zh-hans/dive-center/ma-er-dai-fu/euro-divers-lux-south-ari-atoll/
    {siteIds:['053f27ee-3fb0-48ae-91f6-fc70174b32fb'], aliases:['Kudarah Thila','Kudahrah Thila','クダラ・ティラ','库达拉蒂拉','库达拉提拉','庫達拉蒂拉','庫達拉提拉']},
    // Xlendi Bay is known locally as Ix-Xlendi.
    // https://tahtilbahar.com/sites/xlendibay
    {siteIds:['4be432e2-22d5-4c5f-8cb2-609d61b15e68'], aliases:['Ix-Xlendi','Xlendi Tunnel and Reef']},
    // Swiss divers still recognize the former TZT name and current WZT acronym.
    // https://tcaarau.ch/newtca/index.php/sichtweiten/sichtweiten-tauchplatzliste/location/5446
    {siteIds:['b2d6b7ae-c9d8-4c62-abc3-a9d50ff036d9'], aliases:['WZT','TZT','Tauchsportzentrum Tiefenbrunnen']},
    // Cape Kri is also known as Tapor Tamiyam.
    // https://www.divers.world/zh-tw/divesite/raja-ampat/cape-kri/
    // https://xn--eckya9b7cr9ksc.com/raja-ampat-diving-4/
    {siteIds:['a7ced4d1-f0e1-486c-b524-d08036c9673a'], aliases:['克里角','ケープクリ']},
    // Safaga research records Tobia Soraya as Tobia Segir.
    // https://www.vliz.be/imisdocs/publications/267356.pdf
    {siteIds:['14ea6d64-39c7-4458-8a08-47b622cd9432'], aliases:['Tobia Segir']},
    // The Curaçao dive area Caracasbaai is also called Caracas Bay.
    // https://scuba.network/dive-site/00bc1b43-709d-4c00-9260-8d6f128a9091
    {siteIds:['bf78ccbf-d7b3-41cb-a56f-484168f25a4d'], aliases:['Caracas Bay']},
    // Similan Island 8 divers use these names for Turtle Rock.
    // https://www.hellodive.com/index.php/dive/pointlist/48.html
    // https://bluemarine-divers.com/blog/similan-diving/
    {siteIds:['191872a5-4631-471f-825a-57ed8430181c'], aliases:['海龟岩','海龜岩','タートルロック']},
    // Breakwater Cove is the dive area entered from San Carlos Beach.
    // https://opendivesites.org/Breakwater_Cove
    {siteIds:['76a9fca6-6816-41f1-8ab8-332af484013b'], aliases:['San Carlos Beach']},
    // PADI's Traditional Chinese wreck guide calls Hilma Hooker 希爾瑪號.
    // https://www.padi.com/zh-hant/dive-site/caribbean-netherlands/hilma-hooker/
    {siteIds:['a0005094-194b-4b02-ac1e-1adde4def1f4'], aliases:['希爾瑪號','希尔玛号']},
    // PADI calls the Koh Tao training reef 浮力世界.
    // https://travel.padi.com/zh-hans/dive-site/thailand/buoyancy-world/
    {siteIds:['8be8adbf-393b-4ddc-a619-5892217770ec'], aliases:['浮力世界']},
    // Curaçao dive centers use Porto Marie and Playa Porto Mari interchangeably.
    // https://www.central-dive-curacao.com/playa-porto-mari
    {siteIds:['919f5818-e7ed-422f-af27-dea25223c60d'], aliases:['Porto Marie','Playa Porto Mari','Playa Porto Marie']},
    // Belgian dive federation identifies the quarry as La Roche Fontaine.
    // https://www.lifras.be/doc/202/141024_CLL_Roche.pdf
    {siteIds:['8eb4a1b9-8352-4853-ac19-2d31df512194'], aliases:['La Roche Fontaine','Carrière de Rochefontaine','Carriere de Rochefontaine']},
    // The outer Ras Abu Soma wall is also called Ras Abu Soma Drift.
    // https://71guardians.com/dive-sites/ras-abu-soma/
    {siteIds:['846af5c0-c0da-42c1-aa54-f76b3c712deb'], aliases:['Ras Abu Soma Drift']},
    // The southern plateau has distinct dive-site names from the north.
    // https://divemap.be/dive-sites/elphinstone-reef.html
    {siteIds:['35796dc3-1d95-479d-9beb-bcd42efcdea5'], aliases:['Elphinstone Reef South','Elphinstone zuid']},
    // Chinese diving guides call Lanzarote's Museo Atlántico 大西洋博物馆.
    // https://www.divers.world/zh-cn/divesite/lanzarote-south-coast-museo-atlantico/museo-atlantico/
    {siteIds:['e1e3b7d5-0f3f-4538-9916-daa3deef1c5f'], aliases:['大西洋博物馆','大西洋博物館']},
    // Marsa Alam divers use these spellings for Marsa Assalaya.
    // https://sealog.life/sites/marsa-assalaya-152157
    // https://deepsouthdiverseg.com/tours/marsa-assalaya/
    {siteIds:['8c03e5ec-28dd-4190-a015-6c8eeaeabcec'], aliases:['Marsa Asalaya',"Kilo Saba'a",'Sharm Assalaya']},
    // PADI uses these Chinese names for the Radazul dive area.
    // https://www.padi.com/zh-hans/dive-site/xi-ban-ya/radazul-3/
    {siteIds:['d8073fab-acdf-4105-9ec8-9ad714381849'], aliases:['拉达祖尔','拉達祖爾','拉达苏尔','拉達蘇爾']},
    // Tiran liveaboards call Thomas Reef 托马斯礁.
    // https://aphroditeliveaboard.com/zh/north-tiran/
    {siteIds:['03de7c33-d571-43a2-8072-7e7f774bf5b0'], aliases:['托马斯礁','托馬斯礁']},
    // The Pemuteran Biorock dive site is also called Karang Lestari.
    // https://indive.io/sites/menjangan-pemuteran/pemuteran-biorock
    {siteIds:['6e17f6fb-b26d-469d-a92c-f1b27d882b61'], aliases:['Pemuteran Biorock','Karang Lestari']},
    // Hong Kong Underwater Association lists this site as 橋咀洲.
    // https://www.prodiver-hk.com/_files/ugd/bd15dc_5be7c5719d90469fa72de57221768d74.pdf
    {siteIds:['52f486f9-6988-44f3-a82c-d0e373a11c63'], aliases:['橋咀洲','桥咀洲']},
    // Fish Head is the protected Mushimasmingili Thila in North Ari Atoll.
    // https://www.fao.org/fishery/docs/CDrom/bobp/cd1/Bobp/Publns/MIS/0007.pdf
    {siteIds:['eb9e602a-e0bc-4a8e-b2f4-19cb2fc63146'], aliases:['Mushimasmingili Thila','Mushi Mas Mingili Thila','Shark Thila']},
    // A Vaavu dive log names this channel ミヤル・カンドゥ.
    // https://otosann-preciousdays.blogspot.com/2009/07/
    {siteIds:['34a4c8f9-c798-400b-ad7a-cda32680b91d'], aliases:['ミヤル・カンドゥ']},
    // North Ari's Maaya Thila has established Chinese and Japanese dive names.
    // https://www.hellodive.com/dive/pointlist/44.html
    // https://diveity.com/ja/dive-spots/maaya-thila
    {siteIds:['36c23070-335f-4f42-929e-080deb468db7'], aliases:['玛亚蒂拉','马亚蒂拉','瑪雅·蒂拉','マーヤ・ティラ']},
    // Penida operators abbreviate Pura Mas Gading as PMG.
    // https://www.scubacenterasia.com/dive-site/pura-mas-gading/
    {siteIds:['7ca1a936-a6ba-4067-99dd-63dac6943733'], aliases:['PMG']},
    // A Cozumel operator calls Cedar Pass Paseo del Cedral Reef.
    // https://www.blueh2ocozumel.com/copy-of-scuba-diving-dy8xb
    {siteIds:['0055b9a6-0d13-497a-9f5a-356318afcbb5'], aliases:['Paseo del Cedral Reef']},
    // Portugal Dive gives this English form for the Sesimbra site.
    // https://www.portugaldive.com/best-dives/spot/baia-da-armacao-1.html
    {siteIds:['e9b775c3-b8d8-412e-97c7-42592854629c'], aliases:['Armação Bay','Armacao Bay']},
    // Kandooma Thila is a distinct reef in South Male Atoll.
    // https://www.padi.com/zh-hans/dive-site/ma-er-dai-fu/kandooma-thila/
    // https://stworld.jp/area/maldives/hotel/south_male_atoll/24318
    {siteIds:['82e21a8d-95af-400a-957f-763848c64f9e'], aliases:['坎杜玛蒂拉','カンドゥマティラ']},
    // Safaga divers use these alternative spellings for Gamul Soraya.
    // https://www.nemodive.com/diving-with-nemo/dive-sites-around-safaga/gamul-soraya/?lang=en
    // https://71guardians.com/dive-sites/gamul-soraya/
    {siteIds:['f594d23b-9663-4ba1-90c2-3395d8e293ac'], aliases:['Gamul Al Saghair','Gamoul Soraya']},
    // The Gili dive center distinguishes Shallow Turbo from Deep Turbo.
    // https://www.sunshinedive.com/dive-site
    {siteIds:['1f12028f-8dd2-4b3a-a76f-b23536fe30bb'], aliases:['쉘로우터보']},
    // The Canyon is a common name; PADI's Dahab source matches this pin.
    // https://www.padi.com/zh-hans/dive-site/ai-ji-he-hong-hai/canyon-2/
    {siteIds:['e5a368a3-1de3-4a52-93ac-06d46cfa9ea9'], aliases:['峡谷','峽谷']},
    // Local cave-diving documentation records the previous name of this sink.
    // https://www.mejeme.com/dive/hgrotto.htm
    {siteIds:['3ffd8065-2dad-4b43-84cc-54ba028f6807'], aliases:['Edwards Sink']},
    // Tatawa Besar is distinct from nearby Tatawa Kecil.
    // https://neptunescubadiving.com/zh/komodo-diving/
    // https://komodonationalpark.com/ko/komodo-diving-snorkeling/
    // https://nob-log.info/archives/20135
    {siteIds:['8944f693-7aca-48e5-8c52-9111eb87dc7e'], aliases:['塔塔瓦大岛','塔塔瓦大礁','塔塔瓦贝萨尔','塔塔瓦·贝萨尔','타타와 베사르','タタワ バサール']},
    // PADI identifies the Ohio quarry in Chinese and Japanese.
    // https://www.padi.com/zh-hant/dive-site/mei-li-jian-he-zhong-guo-usa/gilboa-quarry/
    // https://www.padi.com.tw/ja/diving-in/ohaio/
    {siteIds:['5e3410af-e80a-4728-b4dd-248879e2873e'], aliases:['吉爾伯採石場','ギルボア採石場']},
    // Amed operators call this artificial reef Pyramids.
    // https://diveity.com/ja/dive-spots/pyramids-amed
    {siteIds:['2a3415bf-0e11-46d2-be29-81a4b50493ac'], aliases:['Pyramids','The Pyramids']},
    // PADI names this La Jolla Shores shore-dive area in Chinese and Japanese.
    // https://www.padi.com/zh-hans/dive-site/mei-li-jian-he-zhong-guo-usa/la-jolla-shores/
    // https://www.padi.com/ja/dive-site/united-states-of-america-usa/la-jolla-shores/
    {siteIds:['b136ca86-f2f3-4320-968f-d040a7e9a306'], aliases:['拉霍亚海岸','ラホヤ海岸']},
    // The Safaga dive center explains the seven-pillar nickname.
    // https://blueaqua-gdc.com/wp-content/uploads/2025/02/Divesites-Blue-Aqua-3.pdf
    {siteIds:['8d018886-8951-45e8-a813-d17bcdf5fb8a'], aliases:['Seven Pillars','Seven Pinnacles']},
    // Divers use these localized names for the two-eye cenote complex.
    // https://www.diveandcruise.cn/blog/dive-in-the-mexican-cenotes
    // https://jp.scubafreedom.com/?q=dosojos
    // https://travel.padi.com/ko/dive-site/mexico/cenote-dos-ojos-4/
    {siteIds:['a1fac657-c231-4a30-852a-cef2d006c573'], aliases:['双眼','双眼天坑','ドスオホス','ドス・オホス','도스 오호스']},
    // Monterey divers commonly call San Carlos Beach the Breakwater.
    // https://montereyscubaboard.com/monterey-dive-sites/san-carlos-beach/
    // https://pacificscubadivers.com/charters/breakwater-beach-fun-dives-2-dives
    {siteIds:['9ebe082d-3538-40c4-9c4c-fc9abca77040'], aliases:['Breakwater','Breakwater Beach','Breakwater Cove']},
    // Meno Wall and adjacent Meno Slope are separate Gili Meno dives.
    // https://vilaombakdivers.com/zh/%E6%BD%9C%E7%82%B9/
    // https://www.scubago.com/cn/explore/divesite/meno-wall-117817
    {siteIds:['6878f515-6d73-407c-82fd-eb1f0948c101'], aliases:['美诺海墙','梅诺墙','메노월']},
    // This record names Makassar Reef; other Komodo pins are kept separate.
    // https://www.wetfrogdivers.com/scuba-diving-komodo/dive-spots-komodo/
    {siteIds:['e5fb29e8-374d-4805-9a09-35249f7d738e'], aliases:['Karang Makasar','Karang Makassar']},
    // This bay is also marketed as Oriental Bay; avoid generalizing beyond it.
    // https://sealog.life/sites/marsa-gabal-el-rosas-ducks-center-1595
    {siteIds:['36e91e1e-f012-4833-be41-895fcf106d72'], aliases:['Oriental Bay']},
    // SSI uses localized names in the body of its Gili Air reef profile.
    // https://www.scubago.com/ko/explore/divesite/hans-reef-140578
    // https://www.scubago.com/cn/explore/wildlife/spade_fish-324
    {siteIds:['f6e98246-e184-43e9-a268-a5b3842ce02f'], aliases:['한스 리프','汉斯礁']},
    // PADI uses this Chinese name for Lembongan's mangrove-coast dive.
    // https://www.padi.com/zh-hans/dive-site/indonesia/mangrove-point/
    {siteIds:['3b567830-d310-4195-8df4-3702c8ef5099'], aliases:['红树林潜水点']},
    // Madivaru names several Maldivian sites; PADI matches this Rasdhoo pin.
    // https://www.bluerides.com/zh/mudidi/maldives/qianshui-didian
    // https://www.bluerides.com/ja/daibingu-pointo/madivaru-corner
    // https://www.bluerides.com/ko/daiving-poineu/madivaru-corner
    {siteIds:['ee3d0f83-e11c-4c4a-8287-eed9c152dcf1'], aliases:['马迪瓦鲁角','マディバルーコーナー','마디바루 코너']},
    // Turtle Heaven also names other sites; this usage is Pura Ped in Penida.
    // https://nusalembongan.org/dive-sites/
    {siteIds:['bb0262b5-fafe-4752-b793-5d1e0b5f1c69'], aliases:['Turtle Heaven']},
    // SSI's localized descriptions identify this Cozumel reef record.
    // https://www.scubago.com/cn/news/cozumel-scuba-diving-dive-sites-2805
    // https://www.scubago.com/ko/explore/divesite/yucab-reef-90753
    {siteIds:['aa0354f4-a7c2-4a9c-9a6b-a2c3c41f41f2'], aliases:['尤卡布礁','尤卡布','유캡','ユカブ・リーフ']},
    // PADI documents the Pelham quarry's former name, scoped to its site ID.
    // https://www.padi.com/dive-site/united-states-of-america-usa/blue-water-park/
    {siteIds:['b21fef6b-a65f-40bb-9bd9-e9e9ef0f7150'], aliases:['Dive Alabama']},
    // PADI describes the northernmost Tiran reef represented by this pin.
    // https://www.padi.com/zh-hans/dive-site/sha-te-a-la-bo/jackson-reef/
    {siteIds:['73142385-282a-4fe4-8bf2-2ba1a35567ae'], aliases:['杰克逊礁','傑克遜礁']},
    // Malapascua diving references distinguish Gato Island and Monad Shoal.
    // https://howdiving.com/guides/malapascua-thresher-shark-guide
    // https://silverspoon99.com/%E3%80%90%E3%83%95%E3%82%A3%E3%83%AA%E3%83%94%E3%83%B3%E3%80%91%E3%83%9E%E3%83%A9%E3%83%91%E3%82%B9%E3%82%AF%E3%82%A2/
    {siteIds:['7015f625-541c-4f52-aee6-b0895a61d919'], aliases:['加托岛','加托島','ガト島']},
    {siteIds:['81db1656-6a38-4dba-b862-c34ea950b640'], aliases:['モナドショール']},
    // SSI's Korean diving article describes the Florida spring.
    // https://www.divessi.com/ko/blog/diving-the-devils-den-9673.html
    {siteIds:['025fb079-1af5-4466-9fdc-e7346c999268'], aliases:['데블스 덴','데빌스 덴']},
    // Gordon Reef here is the southernmost Tiran reef, not other namesakes.
    // https://www.bluerides.com/zh/qianshui-didian/gordon-reef
    // https://aphroditeliveaboard.com/ja/north-tiran/
    {siteIds:['989d9aae-9bee-49f6-b97b-017906d02950'], aliases:['戈登礁','ゴードン・リーフ']},
    // Sources identify the isolated Egyptian reef by name; source pins differ.
    // https://www.padi.com/zh-hant/dive-site/ai-ji-he-hong-hai/daedalus-reef/
    // https://aphroditeliveaboard.com/ko/daedalus-reef/
    // https://aphroditeliveaboard.com/ja/daedalus-reef/
    {siteIds:['05210ba8-9427-4d44-9b46-e5b1e7c6d0c5'], aliases:['代達羅斯礁','阿布基贊','다이달루스 리프','다이달러스 암초','ダイダロス']},
    // Two nearby catalog records identify the Gili Meno Bounty wreck site.
    // https://www.padi.com/ja/dive-site/intoneshia/bounty-wreck/
    // https://traveldive.co.kr/12
    {siteIds:['d3a4032a-3009-4fda-9d5c-b2bad31e17a5','a257e065-02a8-47a7-971d-d1536a0721cf'], aliases:['バウンティレック','バウンティ・レック','바운티 렉']},
    // Green Rock is a shared name; the tourism authority identifies Koh Tao.
    // https://www.thailandtravel.or.jp/green-rock/
    {siteIds:['8b89ae55-eb26-400e-8e3b-df3378c44102'], aliases:['グリーンロック']},
    // Utah's tourism office uses this Chinese name for the Midway dive site.
    // https://www.visitutah.com/zh-cn/articles/6-things-to-do-at-utahs-homestead-crater
    {siteIds:['928566c8-ae28-4dde-a414-5c9ffe3fba39'], aliases:['霍姆斯特德火山口']},
    // Pottery Pinnacle is distinct from neighboring Three Rocks despite combined dives.
    // https://kohtaothailand.com/dive-sites/three-rocks-pottery/
    {siteIds:['407edb17-0312-42cb-b473-3ab44a752f74'], aliases:['Pottery Pinnacle','Pottery Pinnacles']},
    // Japanese diving sources use several spellings for this named shipwreck.
    // https://www.padi.com/ja/dive-site/eshihutotohong-hai/thistlegorm-wreck/
    // https://www.divessi.com/ja/blog/wreck-diving--zenobia-vs-thistlegorm-1203
    // https://tsumishima.com/soraweb/2018/10/02/101_201810_Redsea.pdf
    {siteIds:['24578a6d-215e-4d04-8c74-334bddbc60d7'], aliases:['シスルゴーム','シストレゴーム','ティスルゴーム']},
    // Shark Island is a common name; these sources identify the Koh Tao site.
    // https://www.thailandtravel.or.jp/shark-island/
    // https://www.hellodive.com/dive/detail/info/23.html
    {siteIds:['2116ca0d-362c-4c88-8675-f51857138205'], aliases:['シャークアイランド','鲨鱼岛']},
    // The Japanese diving guide identifies Hin Pee Wee beside the Sattakut wreck.
    // https://life-with-dive.jp/kohtao-thailand/
    {siteIds:['ac74f1c5-ee13-4d35-a38b-3beebcca8498'], aliases:['ヒンピーウィー']},
    // PADI places this Tanote Bay dive within the same Koh Tao bay.
    // https://travel.padi.com/zh-hans/dive-site/thailand/tanote-bay/
    // https://www.bigbluediving.com/koh-tao-dive-sites/aow-tanote/
    {siteIds:['227bee51-e969-4d17-a9ba-5ff0517c9e1b'], aliases:['塔诺特湾','塔諾特灣','Aow Tanote']},
    // Crystal Bay occurs elsewhere; PADI's Penida coordinates match this pin.
    // https://www.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/crystal-bay-2/
    {siteIds:['06c2add5-bd53-46a4-bba1-d7a83cddba18'], aliases:['水晶湾']},
    // The operator's Chinese name is tied to the catalog pin by PADI's coordinates.
    // https://neptunescubadiving.com/zh/komodo-diving/
    // https://www.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/mawan/
    {siteIds:['bd81ed39-d684-4b8d-ae06-52639afb2172'], aliases:['马万']},
    // PADI's translated Komodo page and pin identify this exact Manta Point;
    // Indonesia has several other unrelated points with the same English name.
    // https://travel.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/manta-point-komodo/
    {siteIds:['6b9ce539-316e-463c-a278-453e5565aeeb'], aliases:['曼塔角']},
    // https://dive-tenerife.com/es/sitio-de-buceo/bah%C3%ADa-de-abades/
    {siteIds:['65388b7d-3548-4d2f-9cb9-1ee7e4c65bd6'], aliases:['Bahía de Abades']},
    // https://duikplaats.net/nederland/utrecht/eiland-4
    // https://www.duikersgids.nl/actueel/eiland-4-het-blijft-een-fantastische-duikplaats
    {siteIds:['aa7088d0-e2c2-446d-b9e1-ae438de5347a'], aliases:['Eiland 4']},
    // Dolphin House is a shared nickname; only this Samadai record is matched.
    // https://blog.padi.com/cn/top-10-dive-sites-in-egypt/
    // https://travel.padi.com/zh-hant/dive-site/ai-ji-he-hong-hai/shaab-samadai-dolphin-house/
    // https://travel.padi.com/ja/dive-site/eshihutotohong-hai/shaab-samadai-dolphin-house/
    {siteIds:['cf580194-edd8-4527-83d3-89505a5cd59d'], aliases:['海豚屋','海豚之家','萨马代礁','沙阿布薩馬代','シャーブ・サマダイ','ドルフィン・ハウス']},
    // https://vilaombakdivers.com/zh/%E6%BD%9C%E7%82%B9/
    // https://www.sunshinedive.com/fundiving
    {siteIds:['26637d74-ec44-4e54-b8d9-bbc06a760f53','c4db7253-35c2-4147-9475-20b46bf194f1'], aliases:['海龟天堂','터틀 헤븐']},
    // PADI names this Komodo site but places its map pin in the Philippines;
    // the recorded location was independently matched through SSI and Blue Rides.
    // https://www.bluerides.com/ko/daiving-poineu/siaba-besar
    // https://pinta-liveaboard.com/zh/blog/is-komodo-diving-dangerous-for-beginners/
    {siteIds:['c88c36d2-a077-4ca2-b095-e4d3622f968a'], aliases:['西亚巴贝萨尔','西阿巴贝萨尔','シアバ・ベサール','시아바 베사르']},
    // Matching is restricted to Komodo records: Batu Bolong also names sites
    // in Nusa Penida, while the nearby catalog pins remain separate records.
    // https://www.padi.com/zh-hans/dive-center/yin-du-ni-xi-ya/taa-dive-resort/
    // https://www.komodoresort.com/zh/komodo-liveaboard/
    {siteIds:['1aa8e744-abd5-47ed-916b-acb0de9bf028','f8cedff1-c153-49e0-b376-f9b9979eab07'], aliases:['巴都博隆','巴图博隆']},
    // https://www.komodoresort.com/zh/komodo-liveaboard/
    {siteIds:['d0d02e01-2667-460b-9371-ca0dcd2f69c0','58eb8ead-363d-43b7-ac23-fae2645e7b69'], aliases:['城堡岩']},
    // https://www.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/shotgun-2/
    {siteIds:['ec48c5d7-ca5f-4349-8e80-89deef0119f7','fef2c31d-8aef-4c89-a512-f82c7072a84c'], aliases:['大锅','霰弹枪']},
    // https://travel.padi.com/zh-hans/dive-site/fei-lu-bin/monad-shoal-thresher-shark-divers-mooring-line/
    {siteIds:['9f7e5d44-c3f4-410d-80fa-18bc9846e9cc'], aliases:['莫纳德浅滩']},
    // https://www.divessi.com/ko/blog/diving-the-devils-den-9673.html
    // https://www.padi.com/ko/dive-site/amerika-habjunggug-usa/devils-den/
    {siteIds:['025fb079-1af5-4466-9fdc-e7346c999268'], aliases:['데블스 덴','악마의 동굴']},
    // PADI's map pin differs from the catalog; the named offshore reef and
    // lighthouse are corroborated by the independent location below.
    // https://www.padi.com/zh-hans/dive-site/ai-ji-he-hong-hai/daedalus-reef/
    // https://diveplaza.com/regions/daedalus
    {siteIds:['05210ba8-9427-4d44-9b46-e5b1e7c6d0c5'], aliases:['代达罗斯礁','ダイダロス']},
    // https://www.visitutah.com/zh-cn/articles/6-things-to-do-at-utahs-homestead-crater
    {siteIds:['928566c8-ae28-4dde-a414-5c9ffe3fba39'], aliases:['霍姆斯特德火山口']},
    // https://www.padi.com/ja/dive-site/eshihutotohong-hai/ss-thistlegorm/
    {siteIds:['24578a6d-215e-4d04-8c74-334bddbc60d7'], aliases:['シスルゴーム','シスルゴーム号']},
    // https://scubadiverlife.com/dive-site-lake-phoenix-virginia/
    {siteIds:['526a5e3f-6590-4e6c-a3f0-075d9815cdd5'], aliases:['Lake Rawlings']},
    // https://discoverydivers.com/zh-hans/blog/thailand-marine-national-parks-opening-closures
    // https://www.siamdive.com/cn/blogs/monsoon-season-diving-thailand-koh-tao-september-cn
    {siteIds:['fe6d2e5e-7709-49a5-b43e-ef82559a2a37'], aliases:['西南尖峰','西南礁']},
    // https://travel.padi.com/zh-hans/dive-site/thailand/tanote-bay/
    {siteIds:['227bee51-e969-4d17-a9ba-5ff0517c9e1b'], aliases:['塔诺特湾']},
    // https://divecodex.com/es/sites/mar-menuda
    {siteIds:['969f00c0-900d-4bbb-a0ba-28ec3755a3e9'], aliases:['Cala Mar Menuda','La Mar Menuda','Platja de la Mar Menuda']},

    // https://cn.kohsanuk.com/cruises/snorkeling/premium-diving-discovery
    {siteIds:['fed8a1d0-5bf4-435f-9539-b366c7ded1d2','24226288-9ff4-4b39-a549-4eca921d36dd'], aliases:['芒果湾']},
    // https://www.padi.com/zh-hans/dive-site/thailand/koh-bida-nok/
    {siteIds:['9e0f1d6e-1435-4dd3-9d53-57076a97a179'], aliases:['比达诺克']},
    // https://travel.padi.com/zh-hans/dive-trip/bali-indonesia/morning-dive-trip-mantapoint-crystal-bay-14841/
    {siteIds:['06c2add5-bd53-46a4-bba1-d7a83cddba18'], aliases:['水晶湾']},

    // https://cn.kohsanuk.com/cruises/snorkeling/premium-diving-discovery
    // https://discoverydivers.com/zh-hans/blog/thailand-marine-national-parks-opening-closures
    {siteIds:['822b44a1-0e07-40f3-89d1-fb4dbe50b008'], aliases:['春蓬尖峰','春蓬礁']},
    // https://cn.kohsanuk.com/cruises/snorkeling/premium-diving-discovery
    {siteIds:['0d11452c-967f-4504-beb0-f1d57794177e'], aliases:['双子岩']},
    // https://cn.kohsanuk.com/cruises/snorkeling/premium-diving-discovery
    {siteIds:['189e631c-598d-46f4-b338-da8097d0a9fe'], aliases:['日本花园']},
    // https://www.aulanocean.com/zh/%E5%89%AF%E6%9C%AC-maldive
    {siteIds:['db0985d2-6be8-4147-9cd0-2d5d8f168bd6'], aliases:['白石']},

    // https://www.padi.com/ja/dive-site/taiwang-guo/richelieu-rock-3/
    // https://blog.padi.com/ko/jacques-cousteaus-favorite-dive-destinations-around-the-world/
    {names:['Richelieu Rock'], country:'Thailand', aliases:['リシュリュー・ロック','리슐리외 록','黎塞留岩','黎塞留岩石','黎胥留礁','里契留岩','리체리우 락']},
    // https://www.padi.com/zh-hans/dive-site/yin-du-ni-xi-ya/tulamben/
    // https://www.padi.com/zh-hans/dive-center/yin-du-ni-xi-ya/dive-dwell/
    {names:['Tulamben'], country:'Indonesia', aliases:['图兰奔','图蓝本']},
    // https://www.padi.com/ja/dive-site/taiwang-guo/christmas-point/
    {names:['Christmas Point'], country:'Thailand', aliases:['クリスマスポイント']},
    // https://www.padi.com/ja/dive-site/taiwang-guo/deep-six-2/
    {names:['Deep Six'], country:'Thailand', aliases:['ディープ・シックス']},
    // https://www.padi.com/zh-hans/dive-site/hong-du-la-si/marys-place-2/
    {names:["Mary's Place",'Mary’s Place'], country:'Honduras', aliases:['玛丽之地']},
    {names:['Blue Corner','Blue Corner Palau'], country:'Palau', aliases:['蓝角','藍角','ブルーコーナー','블루 코너']},
    {names:['German Channel'], country:'Palau', aliases:['德国水道','德國水道','ジャーマンチャンネル']},
    {names:['Monad Shoal'], country:'Philippines', aliases:['莫纳德浅滩','莫納德淺灘','모나드 숄']},
    {names:['USAT Liberty Wreck'], country:'Indonesia', aliases:['自由号沉船','自由號沉船','リバティ沈船','리버티 난파선']}
  ];
  const countryAliases = {indonesia:['印尼'], palau:['帛琉']};
  // Country labels come from the browser's locale data for every supported UI
  // language. Build once and keep the dataset's original country as the key.
  // Dataset labels include ISO long forms and historical English names that do
  // not match CLDR's English display names. Map only unambiguous labels; ANT,
  // Indian Ocean Territories, and International waters require separate review.
  const countryCodes = {
    'antigua and barbuda':'AG', 'bonaire sint eustatius and saba':'BQ',
    'bosnia and herzegovina':'BA', 'cabo verde':'CV', 'east timor':'TL',
    'federated states of micronesia':'FM', 'micronesia federated states of':'FM',
    'iran islamic republic of':'IR', 'korea republic of':'KR', 'south korea':'KR',
    'myanmar':'MM', 'russian federation':'RU', 'saint kitts and nevis':'KN',
    'saint lucia':'LC', 'saint pierre and miquelon':'PM',
    'saint vincent and the grenadines':'VC', 'sao tome and principe':'ST',
    'sint maarten dutch part':'SX', 'taiwan province of china':'TW',
    'tanzania united republic of':'TZ', 'tanzania united republic of tanzania':'TZ',
    'united republic of tanzania':'TZ', 'the bahamas':'BS', 'trinidad and tobago':'TT',
    'turkey':'TR', 'turks and caicos islands':'TC', 'united states virgin islands':'VI',
    'united states of america':'US', 'venezuela bolivarian republic of':'VE',
    'viet nam':'VN', 'virgin islands british':'VG'
  };
  const countryNames = new Map();
  if (typeof Intl.DisplayNames === 'function') {
    const languages = [...Object.keys(copy), 'zh-Hant'];
    const displays = languages.map(lang => new Intl.DisplayNames([lang], {type:'region'}));
    const english = displays[0];
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a,b), name = english.of(code);
      if (!name || name === code) continue;
      countryNames.set(normalize(name), displays.map(display => display.of(code)).filter(value => value && value !== code));
    }
    for (const [label, code] of Object.entries(countryCodes)) {
      countryNames.set(label, displays.map(display => display.of(code)).filter(value => value && value !== code));
    }
  }
  // Search indexes ask for aliases once per mapped site. Normalize the static
  // tables once, rather than scanning thousands of entries for every record.
  // Sets preserve filter() semantics when two spellings normalize to one key.
  function aliasIndex(entries, byId = false) {
    const index = new Map();
    const add = (key, entry) => {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(entry);
    };
    entries.forEach((entry, order) => {
      const value = { order, aliases:entry.aliases };
      if (entry.siteIds) {
        if (byId) entry.siteIds.forEach(id => add(`id:${id}`, value));
      } else {
        for (const name of entry.names) add(JSON.stringify([normalize(entry.country), normalize(name)]), value);
      }
    });
    return index;
  }
  const placeAliasIndex = aliasIndex(placeAliases);
  const siteAliasIndex = aliasIndex(siteAliases, true);
  function aliasesFor(name, country = '') {
    const parent = normalize(country);
    return parent ? [...(placeAliasIndex.get(JSON.stringify([parent, normalize(name)])) || [])].flatMap(entry => entry.aliases) : [];
  }
  function verifiedSiteNames(siteId) {
    const entries = root.DIVE_SITE_NAME_TRANSLATIONS?.verifiedBySiteId?.[String(siteId || '')] || {};
    return Object.values(entries).map(entry => typeof entry === 'string' ? entry : entry?.name).filter(Boolean);
  }
  function siteSearchAliases(country, siteName = '', siteId = '') {
    const named = siteAliasIndex.get(JSON.stringify([normalize(country), normalize(siteName)])) || [];
    const identified = siteAliasIndex.get(`id:${String(siteId)}`) || [];
    // A site can match both a legacy name entry and a scoped ID entry. Retain
    // their original table order, including repeated alias values.
    return [...new Set([...named, ...identified])].sort((a, b) => a.order - b.order).flatMap(entry => entry.aliases);
  }
  function searchAliases(country, labels, siteName = '', siteId = '') {
    const parent = normalize(country);
    return [...(countryNames.get(parent) || []), ...(countryAliases[parent] || []), ...aliasesFor(country, country),
      ...labels.flatMap(label => aliasesFor(label, country)), ...siteSearchAliases(country, siteName, siteId)];
  }
  const resultCopy = {
    en:['Destinations','Dive sites','Explore {name}','{count} dive sites','Destination','Dive site','Search a destination or dive site, or choose a filter.','No destinations or dive sites match your search.','Loading destinations and dive sites…'],
    zh:['目的地','潜点','探索{name}','{count} 个潜点','目的地','潜点','搜索目的地或潜点，或选择筛选条件。','没有匹配的目的地或潜点。','正在加载目的地和潜点…'],
    ja:['目的地','ダイブサイト','{name}を探索','{count} ダイブサイト','目的地','ダイブサイト','目的地やダイブサイトを検索するか、絞り込みを選択してください。','一致する目的地やダイブサイトはありません。','目的地とダイブサイトを読み込み中…'],
    fr:['Destinations','Sites de plongée','Explorer {name}','{count} sites de plongée','Destination','Site de plongée'],
    de:['Reiseziele','Tauchplätze','{name} erkunden','{count} Tauchplätze','Reiseziel','Tauchplatz'],
    es:['Destinos','Puntos de buceo','Explorar {name}','{count} puntos de buceo','Destino','Punto de buceo'],
    it:['Destinazioni','Siti di immersione','Esplora {name}','{count} siti di immersione','Destinazione','Sito di immersione'],
    pt:['Destinos','Pontos de mergulho','Explorar {name}','{count} pontos de mergulho','Destino','Ponto de mergulho'],
    ru:['Направления','Дайв-сайты','Исследовать {name}','Дайв-сайтов: {count}','Направление','Дайв-сайт'],
    ko:['목적지','다이빙 포인트','{name} 둘러보기','다이빙 포인트 {count}곳','목적지','다이빙 포인트'],
    nl:['Bestemmingen','Duiklocaties','Verken {name}','{count} duiklocaties','Bestemming','Duiklocatie'],
    sv:['Resmål','Dykplatser','Utforska {name}','{count} dykplatser','Resmål','Dykplats'],
    no:['Reisemål','Dykkesteder','Utforsk {name}','{count} dykkesteder','Reisemål','Dykkested'],
    id:['Destinasi','Lokasi selam','Jelajahi {name}','{count} lokasi selam','Destinasi','Lokasi selam']
  };
  function resultsText(lang) {
    const text = resultCopy[lang] || resultCopy.en;
    const value = index => text[index] || resultCopy.en[index];
    const showAll = {en:'Show all {count} destinations',zh:'显示全部 {count} 个目的地',ja:'目的地をすべて表示（{count}件）',fr:'Afficher les {count} destinations',de:'Alle {count} Reiseziele anzeigen',es:'Mostrar los {count} destinos',it:'Mostra tutte le {count} destinazioni',pt:'Mostrar todos os {count} destinos',ru:'Показать все направления: {count}',ko:'목적지 {count}곳 모두 보기',nl:'Alle {count} bestemmingen tonen',sv:'Visa alla {count} resmål',no:'Vis alle {count} reisemål',id:'Tampilkan semua {count} destinasi'};
    const back = {en:'Back to results',zh:'返回搜索结果',ja:'検索結果に戻る',fr:'Retour aux résultats',de:'Zurück zu den Ergebnissen',es:'Volver a los resultados',it:'Torna ai risultati',pt:'Voltar aos resultados',ru:'Назад к результатам',ko:'검색 결과로 돌아가기',nl:'Terug naar resultaten',sv:'Tillbaka till resultaten',no:'Tilbake til resultatene',id:'Kembali ke hasil'};
    return {destinations:value(0),sites:value(1),explore:name => value(2).replace('{name}',name),count:count => (text === resultCopy.en && count === 1 ? '{count} dive site' : value(3)).replace('{count}',new Intl.NumberFormat(lang).format(count)),showAll:count => (showAll[lang] || showAll.en).replace('{count}',new Intl.NumberFormat(lang).format(count)),back:back[lang] || back.en,destination:value(4),site:value(5),prompt:value(6),empty:value(7),loading:value(8)};
  }
  function context(area, lang) {
    const text = copy[lang] || copy.en;
    const missingCountry = {
      en:'Country not recorded',zh:'未记录国家',ja:'国の記録なし',fr:'Pays non renseigné',
      de:'Land nicht erfasst',es:'País no registrado',it:'Paese non registrato',pt:'País não registrado',
      ru:'Страна не указана',ko:'국가 기록 없음',nl:'Land niet vastgelegd',sv:'Land ej registrerat',
      no:'Land ikke registrert',id:'Negara tidak tercatat'
    };
    // Identical names can describe an ocean and multiple national regions.
    // Keep their distinct memberships; never infer a missing parent country.
    return [text[area.type === 'country' ? 2 : area.type === 'ocean' ? 4 : 3],
      area.type === 'region' ? area.country || missingCountry[lang] || missingCountry.en : ''
    ].filter(Boolean).join(' · ');
  }
  function destinations(areas, query, acceptsSite = () => true) {
    // Keep the complete set for expansion. The menu controls the initial preview;
    // counts and extents honor the same active filters.
    return search(areas,query).map(area => {
      const positions = area.siteIndices.map((index,at) => acceptsSite(index) ? at : -1).filter(at => at >= 0);
      return {...area, siteIndices:positions.map(at => area.siteIndices[at]), points:positions.map(at => area.points[at])};
    }).filter(area => area.siteIndices.length);
  }
  function build(sites, locations) {
    const groups = new Map();
    sites.forEach((site,index) => {
      const lat = Number(site[1]), lng = Number(site[2]);
      if (site[1] == null || site[2] == null || String(site[1]).trim() === '' || String(site[2]).trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const country = String(site[9] || '').trim();
      const location = locations?.bySiteId?.[String(site[12] || '')] || {};
      const add = (name,type,parent) => {
        name = String(name || '').trim();
        if (!name) return;
        const key = `${type}:${normalize(parent)}:${normalize(name)}`;
        if (!groups.has(key)) groups.set(key,{key,name,type,country:parent,siteIndices:new Set(),points:[]});
        const area = groups.get(key);
        if (!area.siteIndices.has(index)) { area.siteIndices.add(index);area.points.push([lat,lng]); }
      };
      add(country,'country','');
      [...(location.stateProvince || []),...(location.commonArea || []),site[10]].filter(Boolean).forEach(name => {
        if (normalize(name) !== normalize(country)) add(name,'region',country);
      });
      (location.oceanArea || []).forEach(name => add(name,'ocean',''));
    });
    return [...groups.values()].map(area => ({...area,siteIndices:[...area.siteIndices],search:normalize([area.name, area.country, ...aliasesFor(area.name, area.country), ...searchAliases(area.type === 'country' ? area.name : area.country, [])].join(' '))}));
  }
  function search(areas,query) {
    const key = normalize(query), tokens = key.split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const exactAlias = area => (area.type === 'country' ? searchAliases(area.name, []) : aliasesFor(area.name, area.country)).some(alias => normalize(alias) === key);
    return areas.filter(area => tokens.every(token => area.search.includes(token)))
      .sort((a,b) => Number(normalize(b.name) === key) - Number(normalize(a.name) === key) || Number(exactAlias(b)) - Number(exactAlias(a)) || Number(normalize(b.name).startsWith(key)) - Number(normalize(a.name).startsWith(key)) || a.name.localeCompare(b.name) || a.country.localeCompare(b.country));
  }
  function bounds(points) {
    if (!points.length) return null;
    // Fit the smallest longitude arc, so Fiji/Pacific areas do not zoom out
    // across the entire world. These are mapped-site extents, not borders.
    const lons = points.map(point => (point[1] + 360) % 360).sort((a,b) => a-b);
    let gap = -1, start = lons[0];
    lons.forEach((lon,index) => {
      const next = index + 1 < lons.length ? lons[index + 1] : lons[0] + 360;
      if (next - lon > gap) { gap = next - lon;start = next % 360; }
    });
    const west = start > 180 ? start - 360 : start;
    return [[Math.min(...points.map(point => point[0])),west],[Math.max(...points.map(point => point[0])),west + 360 - gap]];
  }
  const api = {build,search,bounds,destinations,resultsText,context,searchAliases,siteSearchAliases,verifiedSiteNames,text:lang => copy[lang] || copy.en};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasAreaSearch = api;
})(typeof window === 'object' ? window : globalThis);
