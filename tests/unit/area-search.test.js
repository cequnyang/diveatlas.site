const {test} = require('node:test');
const assert = require('node:assert/strict');
const {build,search,bounds} = require('../../js/area-search');
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
  assert.equal(search(areas,'equateur').length,2);
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
