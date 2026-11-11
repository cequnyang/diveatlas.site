const base=require('./playwright.config.js');
module.exports={...base,projects:base.projects.map(p=>({...p,testMatch:['saved-trips.spec.js']})),outputDir:'test-results/saved-trips',workers:1};
