# Working on the SDK

This repository extends OrendaEdgeManager and OrendaDevicePlatform. Read `../OrendaDocs/AGENTS.md` and `../OrendaDocs/docs/app-auth-edge-console.md` before changing runtime/auth contracts.

- Organization config remains the single source of access; OrendaService owns derived publish rules.
- Edge owns app installation, app UI proxy/auth and the `/api/v1/runtime` facade. Extend it rather than adding another Box daemon.
- Keep SDK manifest validation aligned with AppRepoServer review validation and Edge appRuntimeService.
- Never include real tokens, passwords, keys, host secrets or customer data in fixtures.
- Run `npm test` and `npm run validate`; test the generated app, not only SDK imports.
