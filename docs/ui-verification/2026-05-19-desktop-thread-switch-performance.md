# Desktop Thread Switch Performance UI Verification

Date: 2026-05-19

Rebuilt app launch command:

```sh
./node_modules/.bin/pnpm --filter desktop preview
```

Tested workflows:

- Switched between existing completed desktop conversation threads in the running rebuilt Electron app.
- Confirmed a selected completed thread rendered immediately with terminal run cards showing "Completed - review loads on demand" and no eager review counts until interaction.
- Expanded a completed run card and confirmed review pills updated from pending/unknown values to loaded tests, risk, diff, memory, and log counts.
- Opened the run inspector from a completed run card and confirmed summary, diff/test/risk/memory/log entry points still load through the inspector.
- Submitted `@fake` prompts from the composer and confirmed active streaming, sidebar active-run counts, terminal completion, assistant transcript output, and post-run review pills.

Observed results:

- Thread switching did not block on visible review hydration; the selected conversation changed promptly.
- Lazy review loading worked from both card expansion and inspector open.
- Active fake runs streamed event text and updated sidebar run counts while running, then finalized assistant output after completion.

Remaining UI risks or gaps:

- The manual cancel attempt raced the short fake-run duration in this local preview and the run completed before the click landed. Cancellation remains covered by the desktop service tests; a slower preview fake-run delay would make future manual cancellation checks easier.
