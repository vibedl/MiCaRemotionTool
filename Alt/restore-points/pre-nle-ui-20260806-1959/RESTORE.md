# Restore point: pre-NLE UI (20260806-1959)

Snapshot before the Premiere/DaVinci-style layout redesign.

## Restore

```powershell
Copy-Item -Force Alt\restore-points\pre-nle-ui-20260806-1959\webapp\* webapp\
Copy-Item -Force Alt\restore-points\pre-nle-ui-20260806-1959\src\* src\
Copy-Item -Force Alt\restore-points\pre-nle-ui-20260806-1959\package.json .
Copy-Item -Force Alt\restore-points\pre-nle-ui-20260806-1959\vite.config.ts .
```

Then refresh the browser / restart `pnpm studio`.

If a git repo exists: `git checkout <tag-or-commit>` (see below).
