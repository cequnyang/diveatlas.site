const base=require('./playwright.config.js');
module.exports={...base,projects:base.projects.map(p=>({...p,testMatch:p.name.includes('mobile')?['saved-trips.spec.js','saved-trips-mobile.spec.js']:['saved-trips.spec.js']})),outputDir:'test-results/saved-trips',workers:1};
