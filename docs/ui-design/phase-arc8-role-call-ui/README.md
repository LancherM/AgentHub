# ARC-8 Collapsed Role Call UI

Design target for Adaptive Role Calls:

- Keep the default transcript compact with a single role-call status affordance.
- Put the RoleCall graph, todos, events, results, risks, and JSON behind one
  inspector interaction.
- Show deferred and rejected work as normal collaboration state, not run
  failures.
- Keep retry, cancel, and approval controls as explicit placeholders only.

The production implementation should stay renderer-safe: no direct SQLite,
filesystem, shell, Git, or child process access.
