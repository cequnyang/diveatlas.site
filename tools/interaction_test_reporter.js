'use strict';

// Project filters exclude inapplicable viewports before execution. Any skipped
// browser test left in the selected suite is therefore a coverage failure,
// including exclusions introduced through aliases or runtime annotations.
class InteractionTestReporter {
  onBegin(config, suite) {
    this.suite = suite;
  }

  onEnd() {
    const skipped = this.suite.allTests().filter(test => test.outcome() === 'skipped');
    if (skipped.length) {
      console.error('Selected interaction tests did not run:\n' + skipped.map(test => test.titlePath().join(' > ')).join('\n'));
      return { status:'failed' };
    }
  }
}

module.exports = InteractionTestReporter;
