# AGENTS.md

Guidance for coding agents working on the MSCC stock checker.

## Project Summary

This repository contains the stock search and CSV upload web app for MSCC.

The app is a plain Node.js HTTP server:

- `server.js` is the main server.
- `index.html` is the search UI template.
- `/` renders the search page.
- `/search` returns JSON search results.
- `/admin` is the protected CSV upload page.
- `/admin/upload` accepts the 4 stock CSV files and commits them to the data repo.

There is no package.json in the current local workspace. Use direct Node checks such as:

```bash
node --check server.js
```

## Related Repositories

- App repo: `paphavinmusicconcept-prog/mscc-check`
- Data repo: `paphavinmusicconcept-prog/mscc-stock-data`
- Older/related repo: `paphavinmusicconcept-prog/MSCC-check-stock`

Do not assume all three repos are identical. Treat `mscc-check` as the live app repo unless the user says otherwise.

## CSV Upload Flow

The expected user workflow is:

1. Export CSV files from Express.
2. Rename files only using OS rename.
3. Do not open and save the CSV files in Excel unless absolutely necessary.
4. Drag all 4 CSV files into `/admin`.
5. Let the server validate, decode, normalize to UTF-8, and commit them to `mscc-stock-data`.

The required upload files are exactly:

```text
stock_mscc.CSV
stock_mscc_warehouse.CSV
stock_beh_hq.CSV
stock_beh_warehouse.CSV
```

`stock_wt.CSV` is not part of the current admin upload flow.

## Encoding Rules

CSV files may come from Thai/Windows systems and may be encoded as `Windows-874` or `UTF-8`.

Important rules:

- Treat uploaded files as raw bytes first.
- Do not decode uploaded CSV as UTF-8 blindly.
- Use the existing `decodeCsvForStock()` flow in `server.js`.
- Normalize accepted uploads to UTF-8 before committing to GitHub.
- If Thai text is already corrupted before upload, conversion cannot reliably recover it.
- The safest user flow is export from Express, rename only, upload through `/admin`.

## GitHub API Rules

The app reads stock CSV files from the GitHub Contents API and writes updates to the data repo.

Important env vars:

```bash
ADMIN_ID=
ADMIN_PASSWORD=
GITHUB_TOKEN=
DATA_REPO=paphavinmusicconcept-prog/mscc-stock-data
DATA_BRANCH=main
CSV_SOURCE=github
GITHUB_DATA_PATHS=data/stock_mscc.CSV,data/stock_mscc_warehouse.CSV,data/stock_beh_hq.CSV,data/stock_beh_warehouse.CSV
GITHUB_REFRESH_TTL_MS=60000
```

Do not hard-code secrets or real token values in files.

`GITHUB_TOKEN` must have access to `mscc-stock-data` with repository contents read/write permission.

The batch commit flow in `commitGitHubFiles()` uses GitHub git object endpoints. The branch ref endpoint must be:

```text
/git/refs/heads/{branch}
```

Do not change it back to:

```text
/git/ref/heads/{branch}
```

That older path caused 404 errors when updating the branch.

## Cache And Performance

`refreshIfNeeded()` caches data loaded from GitHub.

Important behavior:

- Search should not fetch GitHub on every request.
- `GITHUB_REFRESH_TTL_MS` controls how often the app checks GitHub again.
- `refreshPromise` prevents duplicate concurrent refreshes.
- After successful `/admin/upload`, rebuild cache immediately from the uploaded files.

When debugging slow `/` or `/search`, check whether the app is doing unnecessary GitHub calls.

## Search UI Rules

The search UI is in `index.html`.

Current design notes:

- Use the Bigtone logo from `assets/bigtone-logo-transparent.png`.
- Keep the search result information the same even when changing layout.
- Multiple results should scroll vertically and lazy load more rows. Do not bring back large numbered pagination unless the user asks.
- On mobile, show summary before warehouse details.
- Mobile summary layout is 2+1: first row has `Available Stock` and `SKU`, second row has product name.
- The displayed update time should prefer the successful admin upload commit time. If that metadata is missing, fallback to the latest CSV commit time.

## Deployment

The live service is expected to deploy from `mscc-check/main` on Render.

After pushing changes:

1. Wait for Render auto deploy to finish.
2. Hard refresh the live page.
3. Test `/health`.
4. Test `/search` with a known SKU.
5. Test `/admin` only when upload behavior changed.

Do not tell the user the live site is fixed until the GitHub commit is pushed and Render has had time to deploy.

## Validation Checklist

Before saying a code change is done:

1. Run syntax check:

```bash
node --check server.js
```

2. Verify the changed code is actually in the live app repo, not only local files.
3. For GitHub writes, confirm the endpoint, branch name, and token permission assumptions.
4. For CSV changes, confirm the exact 4 filenames.
5. For encoding changes, confirm `Windows-874` and `UTF-8` behavior is still handled.
6. For performance changes, confirm search/admin are not forcing GitHub refresh every request.

## Communication Rules For This Project

The user prefers careful, explicit reasoning over fast guesses.

When a bug appears, explain:

- Facts observed from code or error messages.
- Assumptions that still need verification.
- Risk level.
- Proposed next step.
- Which model level is appropriate if the work is complex.

Recommended model levels:

- Documentation, README, AGENTS updates: GPT-5.5 reasoning low.
- Normal code changes in one file: GPT-5.5 reasoning mid.
- GitHub API, Render deploy, encoding, cache, or multi-system bugs: GPT-5.5 reasoning high.

Do not claim "fixed" if the change was only made locally. Say whether it is local, pushed to GitHub, or deployed/live.
