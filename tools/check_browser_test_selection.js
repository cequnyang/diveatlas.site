'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const config = require('../playwright.config');

function inventory(unfiltered) {
  const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--list', '--reporter=json'], {
    cwd:path.resolve(__dirname, '..'), encoding:'utf8', maxBuffer:32 * 1024 * 1024,
    env:{ ...process.env, INTERACTION_POLICY_INVENTORY:unfiltered ? '1' : '0' }
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  const report = JSON.parse(result.stdout);
  if (report.errors?.length) throw new Error(JSON.stringify(report.errors));
  const entries = [];
  function visit(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests) entries.push({
          key:JSON.stringify([spec.file, spec.line, spec.title, test.projectName]),
          tags:(spec.tags || []).map(tag => tag.startsWith('@') ? tag : `@${tag}`), projectName:test.projectName,
          mobile:Boolean(config.projects.find(project => project.name === test.projectName).use.isMobile)
        });
      }
      visit(suite.suites);
    }
  }
  visit(report.suites);
  return entries;
}

function assertSelection(all, selected) {
  const expected = new Set();
  const eligible = new Set();
  for (const entry of all) {
    const mobileOnly = entry.tags.includes('@mobile-only');
    const desktopOnly = entry.tags.includes('@desktop-only');
    if (mobileOnly && desktopOnly) throw new Error(`Conflicting viewport tags: ${entry.key}`);
    if ((!mobileOnly || entry.mobile) && (!desktopOnly || !entry.mobile)) {
      expected.add(entry.key);
      eligible.add(JSON.stringify(JSON.parse(entry.key).slice(0, 3)));
    }
  }
  // A tag must never make a test disappear from every configured project.
  for (const entry of all) {
    if (!eligible.has(JSON.stringify(JSON.parse(entry.key).slice(0, 3)))) {
      throw new Error(`No applicable project for interaction test: ${entry.key}`);
    }
  }
  const actual = new Set(selected.map(entry => entry.key));
  if (expected.size === 0 || expected.size !== actual.size || [...expected].some(key => !actual.has(key))) {
    throw new Error('Browser project selection omits applicable tests or includes an inapplicable viewport.');
  }
}

if (require.main === module) {
  const all = inventory(true);
  const selected = inventory(false);
  assertSelection(all, selected);
  console.log(`Browser selection policy passed (${selected.length} selected project/test pairs; every test has an applicable project).`);
}

module.exports = { assertSelection };
