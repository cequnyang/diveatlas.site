# Interaction test policy

The interaction gate prevents browser coverage from silently disappearing while
allowing a test to target its applicable viewport. A failed gate blocks Pages
deployment; it is not evidence that a new site version was deployed.

## Usage

Declare viewport scope with Playwright tags, including on parameterized tests:

```js
for (const state of ['displaced', 'swiped-away']) {
  test(`opening welcome preserves ${state}`, { tag:'@mobile-only' }, async ({ page }) => {
    // Exercise the mobile behavior here.
  });
}
```

Use `@desktop-only` for desktop-specific behavior. Leave shared tests untagged.
Do not use skip/fixme/todo/only APIs or maintain test-name exceptions.

Run `npm run check:test-policy` to validate syntax and the actual Playwright
collection. Run `npm run test:interactions` for unit, policy, build and browser
checks; the deployment workflow additionally checks dataset boundaries and the
configured R2 release before building. Install locked dependencies with `npm ci`
and Chromium with `npx playwright install chromium`.

## Why this structure exists

The former exception mechanism matched an entire declaration as source text.
Changing a fixed title into a template in a loop invalidated its exception even
though the intended mobile coverage was unchanged. Tags express scope through
Playwright's supported selection mechanism, independent of names and formatting.

The gate has three complementary checks:

- Acorn parses test syntax and rejects skip/focus member access and unconditional
  Node test exclusion options. Strings and comments containing examples are safe.
- The collection check compares unfiltered and normal Playwright inventories. It
  verifies every applicable project/test pair remains selected, rejects conflicting
  viewport tags, and rejects tests with no applicable configured project. The
  inventory environment flag disables viewport filtering only for this comparison.
- The browser reporter fails a run if any selected test finishes as skipped,
  including runtime exclusions introduced through aliases or annotations.

The syntax check is a guard against mistakes, not a JavaScript security sandbox.
The runtime check supplies a second layer for exclusions not visible statically.
Use the configured reporter in release runs; overriding `--reporter` bypasses it.
The collection command deliberately overrides the reporter because listing tests
does not execute them.

Existing optional Node tests for generated ocean-heat prototypes and the local
MERMAID pilot retain their conditional data-availability checks. They are separate
from the browser interaction gate and may report five skips without those local
artifacts. This change does not claim those experiments were executed.

## Regression coverage

`tests/unit/interaction-test-policy.test.js` covers dynamic titles, formatting,
computed skip calls, conflicting tags, missing project coverage and runtime skips.
The actual collection check runs as part of `check:test-policy` in both local
aggregate verification and the required CI job. Production deployment depends on
that job and publishes its tested artifact.

Browser assertions that depend on the published data must wait for their actual
ready state. The comparison suite queries all mapped site records and allows up
to 90 seconds per query within a 180-second test budget; it still asserts the
same coverage and values. Search tests allow 30 seconds for the cold catalogue
and index within a 60-second flow budget. These are bounded data waits, not
unconditional delays. Gesture tests wait for the entrance to finish before
injecting touches at the grip's measured coordinates, so they test the resting
sheet rather than racing a moving hit target.
