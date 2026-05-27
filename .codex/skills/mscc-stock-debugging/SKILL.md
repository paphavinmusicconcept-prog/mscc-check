---
name: mscc-stock-debugging
description: Debug and safely change the MSCC stock checker project. Use when working on the MSCC stock search/admin app, CSV upload flow, Thai CSV encoding, GitHub API writes to mscc-stock-data, Render deploy issues, stale search data, cache/performance problems, or when deciding the right model level before coding.
---

# MSCC Stock Debugging

Use this skill for the MSCC stock checker app and its data-upload flow. Be precise: separate facts, assumptions, risks, and next steps before changing code.

## Start Here

1. Read `AGENTS.md` in the project root if it exists.
2. Inspect the relevant code before proposing a fix. Usually start with `server.js`.
3. State the work difficulty and recommended model level:
   - Documentation or checklist only: GPT-5.5 reasoning low.
   - One-file code change with clear scope: GPT-5.5 reasoning mid.
   - GitHub API, Render deploy, encoding, cache, or multi-system bug: GPT-5.5 reasoning high.
4. Before editing, tell the user what will be changed and why.
5. After editing, validate locally and say whether the change is only local, pushed to GitHub, or deployed/live.

## Project Facts

Live app repo:

```text
paphavinmusicconcept-prog/mscc-check
```

Stock data repo:

```text
paphavinmusicconcept-prog/mscc-stock-data
```

Older/related repo:

```text
paphavinmusicconcept-prog/MSCC-check-stock
```

Treat `mscc-check` as the live app repo unless the user says otherwise.

The app is a plain Node.js HTTP server:

```text
server.js
index.html
```

Important routes:

```text
/          search page
/search    JSON search API
/health    service/data health
/admin     protected CSV upload page
/admin/upload
```

## CSV Rules

The admin upload flow accepts exactly these files:

```text
stock_mscc.CSV
stock_mscc_werehouse.CSV
stock_beh_hq.CSV
stock_beh_werehouse.CSV
```

`stock_wt.CSV` is not part of the current upload flow.

Expected human workflow:

1. Export CSV from Express.
2. Rename the files only.
3. Do not open and save them in Excel unless necessary.
4. Upload all 4 files through `/admin`.

For encoding changes:

- Treat uploaded CSV as bytes first.
- Do not assume UTF-8.
- Preserve support for `Windows-874` and `UTF-8`.
- Normalize accepted uploads to UTF-8 before GitHub commit.
- If Thai text is already corrupted before upload, do not promise full recovery.

## GitHub API Rules

Never hard-code `GITHUB_TOKEN` or passwords.

The upload flow writes to the data repo. Token permission must include repository contents read/write for `mscc-stock-data`.

For batch commits using GitHub git object APIs, the branch ref path must be:

```text
/git/refs/heads/{branch}
```

Do not use:

```text
/git/ref/heads/{branch}
```

That path caused a 404 when updating the branch.

## Cache And Performance

When pages are slow, check for repeated GitHub requests.

Expected behavior:

- Search should use cached catalog data.
- `GITHUB_REFRESH_TTL_MS` should prevent GitHub fetches on every request.
- `refreshPromise` should prevent duplicate simultaneous refreshes.
- After `/admin/upload`, rebuild the cache from uploaded files immediately.

If `/admin` is slow during upload, inspect the GitHub write flow. A single batch commit is preferred over one commit per file.

## Debugging Workflow

Use this order for bugs:

1. Capture the exact symptom or error text.
2. Identify the layer:
   - Browser/UI
   - Server route
   - CSV validation
   - Encoding decode/normalize
   - GitHub API read/write
   - Cache/search catalog
   - Render deploy/runtime
3. Read the exact code path.
4. Explain facts vs assumptions to the user.
5. Make the smallest safe change.
6. Validate.
7. Report status precisely.

For user-facing updates, prefer this format:

```text
Facts:
- ...

Assumptions:
- ...

Risk:
- low/medium/high, because ...

Next step:
- ...
```

## Validation Checklist

Before saying a code change is done:

```bash
node --check server.js
```

Then verify the relevant items:

- CSV filename list still matches the 4 allowed files.
- `stock_wt.CSV` was not accidentally reintroduced.
- Thai encoding path still handles `Windows-874` and `UTF-8`.
- GitHub branch ref endpoint is `/git/refs/heads/{branch}`.
- Search/admin are not forcing GitHub refresh on every request.
- The change is pushed to `mscc-check/main` if the user expects live behavior.
- Render has had time to deploy before claiming the live site is fixed.

## Communication Rule

The user prefers accuracy over speed. Do not guess silently. If there are multiple plausible causes, present them as possibilities with evidence and ask the user to help choose only when the choice changes risk or scope.
