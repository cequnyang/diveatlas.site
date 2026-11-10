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
    return {destinations:value(0),sites:value(1),explore:name => value(2).replace('{name}',name),count:count => (text === resultCopy.en && count === 1 ? '{count} dive site' : value(3)).replace('{count}',new Intl.NumberFormat(lang).format(count)),destination:value(4),site:value(5),prompt:value(6),empty:value(7),loading:value(8)};
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
    // Bound area suggestions so broad country queries still expose individual
    // sites on the first page. Counts and extents honor the same active filters.
    return search(areas,query).map(area => {
      const positions = area.siteIndices.map((index,at) => acceptsSite(index) ? at : -1).filter(at => at >= 0);
      return {...area, siteIndices:positions.map(at => area.siteIndices[at]), points:positions.map(at => area.points[at])};
    }).filter(area => area.siteIndices.length).slice(0,3);
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
    return [...groups.values()].map(area => ({...area,siteIndices:[...area.siteIndices],search:normalize(`${area.name} ${area.country}`)}));
  }
  function search(areas,query) {
    const key = normalize(query), tokens = key.split(' ').filter(Boolean);
    if (!tokens.length) return [];
    return areas.filter(area => tokens.every(token => area.search.includes(token)))
      .sort((a,b) => Number(normalize(b.name) === key) - Number(normalize(a.name) === key) || Number(normalize(b.name).startsWith(key)) - Number(normalize(a.name).startsWith(key)) || a.name.localeCompare(b.name) || a.country.localeCompare(b.country));
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
  const api = {build,search,bounds,destinations,resultsText,context,text:lang => copy[lang] || copy.en};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasAreaSearch = api;
})(typeof window === 'object' ? window : globalThis);
