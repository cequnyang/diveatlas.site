const {test} = require('node:test');
const assert = require('node:assert/strict');
const {build,search,bounds,destinations,resultsText,context} = require('../../js/area-search');
const site = (id,name,country,lat,lng,region = '') => {
  const row = [];row[0]=name;row[1]=lat;row[2]=lng;row[9]=country;row[10]=region;row[12]=id;return row;
};

test('area lookup uses geographic labels rather than dive-site names and deduplicates shared labels',() => {
  const areas = build([site('a','Shark Reef','Indonesia',-1,130,'Raja Ampat'),site('b','Blue Hole','Indonesia',-2,131,'Raja Ampat')],{
    bySiteId:{a:{commonArea:['Raja Ampat','Raja Ampat'],oceanArea:['Ceram Sea']}}
  });
  assert.equal(search(areas,'Shark Reef').length,0);
  const raja = search(areas,'Raja Ampat Indonesia')[0];
  assert.equal(raja.type,'region');assert.equal(raja.siteIndices.length,2);
  assert.equal(search(areas,'Indonesia')[0].type,'country');
  assert.equal(search(areas,'Ceram Sea')[0].type,'ocean');
});

test('homonymous regions in different countries remain distinct and names match accents',() => {
  const areas = build([site('a','A','France',1,2,'Équateur'),site('b','B','Ecuador',3,4,'Équateur')],{});
  // Ecuador's French alias remains searchable alongside both exact region names.
  assert.deepEqual(search(areas,'equateur').map(area => [area.name,area.country]),[
    ['Équateur','Ecuador'],['Équateur','France'],['Ecuador','']
  ]);
  assert.equal(search(areas,'EQUATEUR france')[0].country,'France');
  assert.deepEqual(search(areas,''),[]);
});

test('area extents cross the dateline along the short arc and single-location areas remain valid',() => {
  const result = bounds([[-18,179],[-17,-179]]);
  assert.equal(result[1][1]-result[0][1],2);
  assert.equal(result[0][0],-18);assert.equal(result[1][0],-17);
  assert.deepEqual(bounds([[0,0]]),[[0,0],[0,0]]);
  assert.equal(bounds([]),null);
});

test('invalid or missing locations do not become area results at the equator',() => {
  const areas = build([site('a','A','Invalid',null,10),site('b','B','Invalid','',10),site('c','C','Invalid',95,10),site('d','D','Valid',0,0)],{});
  assert.equal(search(areas,'Invalid').length,0);
  assert.equal(search(areas,'Valid')[0].siteIndices.length,1);
});

test('destination suggestions keep counts and extents aligned with filtered sites', () => {
  const areas = build([site('a','A','Indonesia',-1,130,'Raja Ampat'),site('b','B','Indonesia',-2,131,'Raja Ampat')],{});
  const [area] = destinations(areas,'Raja Ampat',index => index === 1);
  assert.deepEqual(area.siteIndices,[1]);
  assert.deepEqual(area.points,[[-2,131]]);
  assert.equal(search(areas,'Raja Ampat')[0].siteIndices.length,2);
  assert.deepEqual(destinations(areas,'Raja Ampat',() => false),[]);
  assert.deepEqual(destinations(areas,''),[]);
});

test('broad destination queries retain all matches and keep the exact country first', () => {
  const areas = build(Array.from({length:8},(_,i) => site(String(i),'Site','Indonesia',i,100+i,`Region ${i}`)),{});
  const matches = destinations(areas,'Indonesia');
  assert.equal(matches.length,9);
  assert.equal(matches[0].type,'country');
  assert.deepEqual(matches.slice(1).map(area => area.name),Array.from({length:8},(_,i) => `Region ${i}`));
  assert.equal(resultsText('en').explore(matches[0].name),'Explore Indonesia');
  assert.equal(resultsText('en').count(8),'8 dive sites');
});

test('same-name ocean and regional destinations have distinct contexts without merging their sites', () => {
  const areas = build([
    site('a','Reef A','Egypt',27,34,'Red Sea'),
    site('b','Reef B','',26,35,'Red Sea'),
    site('c','Reef C','Israel',29,35,'Red Sea')
  ],{bySiteId:{a:{oceanArea:['Red Sea','Red Sea'],commonArea:['Red Sea']}}});
  const all = search(areas,'Red Sea');
  assert.equal(all.length,4);
  assert.equal(new Set(all.map(area => area.key)).size,4);
  assert.deepEqual(all.map(area => context(area,'en')),['Ocean area','Region · Country not recorded','Region · Egypt','Region · Israel']);
  assert.deepEqual(all.map(area => area.siteIndices.length),[1,1,1,1]);
  assert.equal(context(all[2],'zh'),'地区 · Egypt');
  assert.equal(context(all[1],'zh'),'地区 · 未记录国家');
});

test('localized aliases match destinations and remain scoped to their country', () => {
  const areas = build([site('a','A','Indonesia',1,2,'Lembeh Strait'),site('b','B','France',3,4,'Lembeh Strait'),site('c','C','',5,6,'Lembeh Strait')],{});
  assert.equal(search(areas,'蓝碧')[0].country,'Indonesia');
  assert.equal(search(areas,'蓝碧').length,1);
  assert.equal(search(areas,'藍碧')[0].country,'Indonesia');
  assert.equal(search(areas,'印度尼西亚')[0].name,'Indonesia');
  assert.ok(require('../../js/area-search').searchAliases('Indonesia',['Lembeh Strait']).includes('蓝碧'));
  assert.ok(!require('../../js/area-search').searchAliases('France',['Lembeh Strait']).includes('蓝碧'));
});

test('site aliases use a known country and an exact site name', () => {
  const {searchAliases} = require('../../js/area-search');
  const palauBlueCornerId = '67b0fa7f-b4d9-4fdb-89c0-ae8fb5d10dcb';
  assert.ok(searchAliases('Palau', [], 'Blue Corner', palauBlueCornerId).includes('蓝角'));
  assert.ok(searchAliases('Palau', [], 'Blue Corner', palauBlueCornerId).includes('ブルーコーナー'));
  assert.ok(!searchAliases('Palau', [], 'Blue Corner').includes('蓝角'));
  assert.ok(!searchAliases('Indonesia', [], 'Blue Corner', 'unrelated-site').includes('蓝角'));
  assert.ok(!searchAliases('', [], 'Blue Corner').includes('蓝角'));
  assert.ok(!searchAliases('Palau', [], 'Blue Corner North').includes('蓝角'));
  assert.ok(searchAliases('Philippines', ['Philippines Malapascua']).includes('妈妈拍丝瓜'));
});

test('country translations cover unambiguous dataset long forms without treating oceans as countries', () => {
  const areas = build([site('a','A','United States of America',1,2),site('b','B','East Timor',2,3),site('c','C','Korea, Republic of',3,4)],{});
  assert.equal(search(areas,'美国')[0].name,'United States of America');
  assert.equal(search(areas,'东帝汶')[0].name,'East Timor');
  assert.equal(search(areas,'韩国')[0].name,'Korea, Republic of');
});

test('source-backed destination and site aliases retain geographic scope', () => {
  const {searchAliases} = require('../../js/area-search');
  for (const [country,label,alias] of [['Egypt','Red Sea','红海'],['Honduras','Roatan','罗阿坦'],['Indonesia','Bali','峇里島'],['Bonaire, Sint Eustatius and Saba','Bonaire','博奈尔']]) {
    assert.ok(searchAliases(country,[label]).includes(alias));
    assert.ok(!searchAliases('France',[label]).includes(alias));
  }
  assert.ok(searchAliases('Honduras',[], 'Mary’s Place').includes('玛丽之地'));
  assert.ok(!searchAliases('New Zealand',[], 'Mary’s Place').includes('玛丽之地'));
});

test('new source-backed destination and point names do not cross country boundaries', () => {
  const {searchAliases} = require('../../js/area-search');
  assert.ok(searchAliases('Mexico',['Cozumel']).includes('コズメル'));
  assert.ok(searchAliases('Australia',['Great Barrier Reef']).includes('大堡礁'));
  assert.ok(searchAliases('Japan',['Okinawa Prefecture']).includes('오키나와'));
  assert.ok(searchAliases('Thailand',['Thailand Similan Islands']).includes('斯米兰群岛'));
  assert.ok(searchAliases('Thailand',[],'Christmas Point').includes('クリスマスポイント'));
  assert.ok(!searchAliases('Canada',[],'Christmas Point').includes('クリスマスポイント'));
  assert.ok(searchAliases('Indonesia',[],'Tulamben').includes('图蓝本'));
});

test('similar dive-point names can have different verified translations by stable ID', () => {
  const {verifiedSiteNames} = require('../../js/area-search');
  global.DIVE_SITE_NAME_TRANSLATIONS = {verifiedBySiteId:{one:{zh:{name:'海狼风暴点'}}}};
  try {assert.deepEqual(verifiedSiteNames('one'),['海狼风暴点']);assert.deepEqual(verifiedSiteNames('two'),[]);}
  finally {delete global.DIVE_SITE_NAME_TRANSLATIONS;}
});

test('stable-ID site aliases do not match neighboring records with the same name', () => {
  const {searchAliases} = require('../../js/area-search');
  assert.ok(searchAliases('Thailand', [], 'Twins Koh Tao', '0d11452c-967f-4504-beb0-f1d57794177e').includes('双子岩'));
  assert.ok(!searchAliases('Thailand', [], 'Twins Koh Tao', 'other').includes('双子岩'));
  assert.ok(searchAliases('Thailand', [], 'Chumphon Pinnacle', '822b44a1-0e07-40f3-89d1-fb4dbe50b008').includes('春蓬尖峰'));
});

test('Poor Knights localized aliases stay within the recorded destination', () => {
  const areas = build([site('a','A','New Zealand',-35,174,'Poor Knights Islands'),site('b','B','Australia',-34,152,'Poor Knights Islands')],{});
  assert.deepEqual(search(areas,'穷骑士群岛').map(area => area.country),['New Zealand']);
  assert.equal(search(areas,'プアー・ナイツ諸島')[0].country,'New Zealand');
  assert.equal(search(areas,'푸어 나이츠 제도')[0].country,'New Zealand');
});

test('source-backed site names apply only to the verified record', () => {
  const {siteSearchAliases} = require('../../js/area-search');
  assert.ok(siteSearchAliases('United States','Devils Den','025fb079-1af5-4466-9fdc-e7346c999268').includes('데블스 덴'));
  assert.ok(!siteSearchAliases('United States','Devils Den','other').includes('데블스 덴'));
  assert.ok(siteSearchAliases('Philippines','Monad Shoal, Thresher Shark Divers Mooring Line','9f7e5d44-c3f4-410d-80fa-18bc9846e9cc').includes('莫纳德浅滩'));
});

test('Komodo dive-site aliases exclude Penida namesakes', () => {
  const {siteSearchAliases} = require('../../js/area-search');
  assert.ok(siteSearchAliases('Indonesia','Batu Bolong Komodo','1aa8e744-abd5-47ed-916b-acb0de9bf028').includes('巴图博隆'));
  assert.ok(!siteSearchAliases('Indonesia','Batu Bolong, Nusa Penida','508191d2-d940-483e-8a9d-db67642384ee').includes('巴图博隆'));
  assert.ok(siteSearchAliases('Indonesia','Siaba Besar','c88c36d2-a077-4ca2-b095-e4d3622f968a').includes('시아바 베사르'));
});

test('region and site aliases require their intended geography', () => {
  const {searchAliases,siteSearchAliases} = require('../../js/area-search');
  assert.ok(searchAliases('United States of America',['Florida Panhandle']).includes('佛罗里达狭长地带'));
  assert.ok(!searchAliases('Australia',['Florida Panhandle']).includes('佛罗里达狭长地带'));
  assert.ok(siteSearchAliases('Indonesia','Turtle Heaven','26637d74-ec44-4e54-b8d9-bbc06a760f53').includes('터틀 헤븐'));
  assert.ok(!siteSearchAliases('Indonesia','Turtle Heaven','other').includes('터틀 헤븐'));
});

test('Manta Point common name remains attached to the sourced Komodo pin', () => {
  const {siteSearchAliases} = require('../../js/area-search');
  assert.ok(siteSearchAliases('Indonesia','Manta point Komodo','6b9ce539-316e-463c-a278-453e5565aeeb').includes('曼塔角'));
  assert.ok(!siteSearchAliases('Indonesia','Manta Point','c399ca62-3080-435c-ac81-6ce56bea4154').includes('曼塔角'));
});


test('Chinese dive names match only the sourced Mawan and Crystal Bay pins', () => {
  const {siteSearchAliases} = require('../../js/area-search');
  assert.ok(siteSearchAliases('Indonesia','Mawan Komodo','bd81ed39-d684-4b8d-ae06-52639afb2172').includes('马万'));
  assert.ok(siteSearchAliases('Indonesia','Crystal Bay, Nusa Penida','06c2add5-bd53-46a4-bba1-d7a83cddba18').includes('水晶湾'));
  assert.ok(!siteSearchAliases('Indonesia','Crystal Bay','unrelated-site').includes('水晶湾'));
});


test('Yucab translations stay on the sourced Cozumel record', () => {
  const {siteSearchAliases} = require('../../js/area-search');
  assert.ok(siteSearchAliases('Mexico','Yucab Reef','aa0354f4-a7c2-4a9c-9a6b-a2c3c41f41f2').includes('尤卡布礁'));
  assert.ok(!siteSearchAliases('Mexico','Yucab Reef','ae5c7eaa-44fe-47ca-a791-5e34a068aea5').includes('尤卡布礁'));
});


test('exact local region names precede another region containing the query', () => {
  const areas = build([site('a','A','Germany',1,2,'Saxony'),site('b','B','Germany',3,4,'Lower Saxony')],{});
  assert.deepEqual(search(areas,'Sachsen').map(area => area.name),['Saxony','Lower Saxony']);
  assert.deepEqual(search(areas,'Saxony').map(area => area.name),['Saxony','Lower Saxony']);
});

test('country-level aliases rank above partial matches in other destinations', () => {
  const areas = build([site('a','A','Tonga',1,2,'Tonga'),site('b','B','Cook Islands',3,4,'Cook Islands Rarotonga')],{});
  for (const alias of ['湯加','東加']) {
    const matches = search(areas, alias);
    assert.equal(matches[0].type, 'country');
    assert.equal(matches[0].name, 'Tonga');
  }
});


test('new localized destination aliases keep same-name regions in their country', () => {
  const areas = build([
    site('cocos-cr', 'A', 'Costa Rica', 5.5, -87, 'Cocos Island'),
    site('cocos-au', 'B', 'Australia', -12, 96, 'Cocos Island'),
    site('maui', 'C', 'United States of America', 20, -156, 'Hawaii Maui'),
    site('big-island', 'D', 'United States of America', 19, -155, 'Hawaii Big Island')
  ], {});
  assert.deepEqual(search(areas, '科科斯岛').map(area => area.country), ['Costa Rica']);
  assert.deepEqual(search(areas, 'マウイ島').map(area => area.name), ['Hawaii Maui']);
  assert.deepEqual(search(areas, '빅아일랜드').map(area => area.name), ['Hawaii Big Island']);
});
