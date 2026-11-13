'use strict';

const { parse } = require('acorn');

// Parse syntax rather than matching source text: comments, strings, formatting,
// computed member access and parameterized test titles must not change policy.
function assertTestPolicy(source, filename) {
  const ast = parse(source, { ecmaVersion:'latest', sourceType:'module', locations:true });
  function reject(node, message) {
    throw new Error(`${filename}:${node.loc.start.line}: ${message}`);
  }
  function propertyName(node) {
    return node.computed ? node.property.value : node.property.name;
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MemberExpression' && ['skip', 'fixme', 'todo', 'only'].includes(propertyName(node))) {
      reject(node, 'Skip/focus APIs are forbidden; select viewport-specific browser tests with @mobile-only or @desktop-only tags.');
    }
    if (node.type === 'Property') {
      const key = node.computed ? node.key.value : node.key.name || node.key.value;
      if (['skip', 'only', 'todo'].includes(key) && node.value.type === 'Literal' && node.value.value === true) {
        reject(node, 'Unconditional test exclusion/focus is forbidden.');
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
}

module.exports = { assertTestPolicy };
