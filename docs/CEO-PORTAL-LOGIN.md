# CEO Portal direct sign-in

This receiver uses CEO Portal protocol v1 and AI Brain's existing Supabase Auth
session. It signs in an explicitly configured, pre-existing active administrator;
it never copies CEO Portal roles, changes a password, or provisions a profile.

## Production settings

Set these server-only variables in AI Brain's Vercel Production environment:

| Variable                    | Value                                           |
| --------------------------- | ----------------------------------------------- |
| `PORTAL_LOGIN_ENABLED`      | `true` after configuration and deployment       |
| `CEO_PORTAL_ORIGIN`         | `https://practiscale-ceo-portal.vercel.app`     |
| `AI_BRAIN_ORIGIN`           | `https://practiscale-rag-chatbot.vercel.app`    |
| `CEO_PORTAL_APP_ID`         | AI Brain's catalogue UUID in CEO Portal         |
| `CEO_PORTAL_TARGET_USER_ID` | Existing AI Brain Supabase Auth UUID            |
| `CEO_PORTAL_CLIENT_SECRET`  | New random connection secret, at least 32 bytes |

Store the matching `<catalogue-app-uuid>:<secret>` value in CEO Portal's
`APP_LOGIN_ADDITIONAL_CLIENT_SECRETS_AI_BRAIN`. Preserve all other connection
secret variables. No secret belongs in a `NEXT_PUBLIC_` variable or Git.

In CEO Portal, add AI Brain with One-click login, register the exact public
origin, grant only the CEO access, and link that identity to the existing AI
Brain user UUID. Do not select an account by a supplied email address.

## Protocol and safety

- `/auth/portal/start` validates configuration and the opaque ticket, creates
  independent PKCE/state per launch, and stores the verifier in an HttpOnly,
  Secure, SameSite=Lax transaction cookie lasting five minutes.
- `/auth/portal/callback` requires the matching browser transaction before
  redeeming the one-use code server-to-server. Version, audience, target UUID
  and bounded request IDs are checked; redirects and timeouts fail closed.
- The exact allowlisted user must exist in Auth, have a confirmed email, not be
  banned, and have an active `admin` or `super_admin` profile. Lookup failures
  refuse login. The profile is rechecked before session cookies are committed.
- A verified session for another account is preserved and refused. The same
  account's existing session is reused, including its AAL2 assurance level.
- For a fresh session, `auth.admin.generateLink` returns a token hash without
  sending email. Its user ID must match the verified target, and `verifyOtp`
  runs through a cookie-aware client. Cookie changes are staged and only
  returned after the final identity/profile/MFA checks succeed.
- Enrolled two-step verification remains required. A new AAL1 session is sent
  to the existing native authenticator screen; an MFA lookup error fails closed.
- The two public bridge routes enforce these checks themselves. Other routes
  retain their existing middleware, profile checks and row-level security.
- Bridge responses are no-store/no-referrer. Logs contain fixed outcomes and
  correlation IDs only, never tickets, codes, verifiers, hashes or secrets.
- Demo mode cannot activate this connection. Ordinary password login is kept.
- Rate limiting is per server instance, like the existing app limiter; CEO
  Portal additionally protects ticket issuance and redemption.

## Verification and rollback

`npm test -- test/portal-login.test.ts` exercises the real handlers with isolated
Auth/DB fixtures, including wrong audience, replay refusal, account conflicts,
inactive users, database failures, session cookie staging and enrolled MFA.
Run the full suite, lint, typecheck and build before release. Exercise the
cross-site callback in a browser, including a fresh native session.

For rollback, disable the connection in CEO Portal and set
`PORTAL_LOGIN_ENABLED=false` in AI Brain, then redeploy. Existing password
accounts, sessions, history, permissions and data are unaffected. No schema
migration is required.
