# Phase 3A dependency review (2026-10-24)

The user reported five high-severity findings during `npm ci`. A fresh audit of
the existing lockfile reported **seven high entries**, representing two advisory
roots and their affected parent packages. No automatic `npm audit fix` or forced
upgrade was run.

| Advisory | Installed affected dependency | App relevance | Targeted correction |
| --- | --- | --- | --- |
| [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | `body-parser 2.3.0` through Express; parent entries also flag Express and express-rate-limit | Compressed JSON parsing runs before authentication. A valid compressed frame with invalid trailing bytes can cause an uncaught decoder error/process crash; the 64 KB body limit alone does not address this | Update only the permitted transitive body-parser minor to patched **2.4.0** in the lockfile |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Nested `zod 4.1.11` through `@vercel/cli-config` → `@vercel/oidc` → `@vercel/functions` | Excessive validation issues for oversized invalid collections can exhaust memory. The app's direct API validator was already patched `4.6.7`; the older copy belongs to the SDK's CLI/config parsing path | Scoped npm override `@vercel/cli-config.zod: "$zod"` reuses the existing patched **4.6.7** direct dependency |

The Express, rate-limit and Vercel SDK major versions remain unchanged. No package
was removed to hide audit findings. The lockfile removes the vulnerable nested
Zod copy and updates body-parser; package integrity checks remain enabled.

Review checks include the existing authentication/approval/weekly/booking suites,
build/type checks, pure Vercel config/auth-schema compatibility with the patched
Zod, and an isolated HTTP regression sending compressed JSON plus invalid trailing
bytes and confirming the process handles subsequent requests. No test sends
malformed traffic to production or reads real CLI credentials.

At review, the corrected lockfile reports **zero known npm vulnerabilities**.
CI also runs `npm audit --audit-level=high` and blocks high/critical findings.
Reproduce with the normal clean installation and audit:

```sh
npm ci
npm audit
npm audit --omit=dev
npm run build
npm run typecheck:release
npm test
```

These dependency corrections remain in PR #2/preview until the production
backup, native-connectivity, migration and verification gates succeed. Production
deployment and variables are unchanged. No paid service, upgrade, trial, purchase
or additional infrastructure is required.
