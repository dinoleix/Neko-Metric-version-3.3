# Isolated multi-tenant development environment

Created on 18 October 2026. This environment is for multi-tenant development only. It has no production Green Neko data, user accounts, rules, or deployment traffic.

| Resource | Development value | Production impact |
| --- | --- | --- |
| Firebase project | `nekometrics-mt-dev-2026` | None |
| Firebase web app | `NekoMetrics Multi-Tenant Dev Web` | None |
| Firestore database | Pending API enablement and initial provisioning | None |
| Vercel project | `neko-metrics-multitenant-dev` | None |
| Git branch | `codex/multitenant-foundation` | Separate from `main` |

## Branch behaviour

- `main` remains the production branch and continues to deploy the existing NekoMetrics site.
- `codex/multitenant-foundation` is the development branch.
- The separate Vercel project is configured to use `npm run build:multitenant`, which loads the `multitenant-dev` Firebase environment.
- The existing production Vercel project and production Firebase project are not relinked or changed.

## Remaining one-time setup

### Firebase

1. In the Firebase or Google Cloud console for `nekometrics-mt-dev-2026`, enable the **Cloud Firestore API**.
2. Create the default Firestore database using:
   - Edition: **Standard**
   - Region: **nam5**
   - Delete protection: **Disabled** for disposable development data
3. Enable the intended sign-in methods in Firebase Authentication for test users. Start with Email/Password; enable Google only if required for acceptance testing.
4. Do not import Green Neko production data. The initial tenant tests use synthetic data only.

### Vercel

1. Complete the Vercel account-security choice currently displayed for the logged-in account.
2. In `neko-metrics-multitenant-dev` → Settings → Git, connect the GitHub repository `dinoleix/Neko-Metric-version-3-3`.
3. Set `codex/multitenant-foundation` as the production branch of this *development project*. This does not change the production NekoMetrics project.
4. Confirm preview deployments are created only from non-production branches.

## Local development

1. Copy `.env.multitenant-dev.example` to `.env.multitenant-dev.local`.
2. Fill in the isolated Firebase browser configuration only.
3. Run `npm run dev:multitenant`.
4. Run `npm run build:multitenant` before committing.

The `.env.multitenant-dev.local` file is ignored by Git. Never put production API keys or a production Firebase project ID in it.
