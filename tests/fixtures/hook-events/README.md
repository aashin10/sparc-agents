# hook-event fixtures

Canned stdin payloads, one per hook event the plugin uses. `scripts/ci/smoke-hooks.js`
feeds every fixture whose `hook_event_name` matches a registered hook into that
hook's stdin and asserts the exit code and output shape.

**Every hook ships with a fixture in the same commit. No exceptions.** A hook
without a fixture is a hook that breaks silently three weeks later — and hooks
are the part users blame the plugin for.

Paths inside fixtures are deliberately fake and absolute-looking but rooted at
`/repo`, so `validate-no-personal-paths.js` stays clean.
