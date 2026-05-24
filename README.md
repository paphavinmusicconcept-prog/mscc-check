# MSCC Check

Stock checker MVP for LINE OA / LIFF.

## Recommended setup

Use a separate GitHub repo for the stock CSV only.

Example:

```text
mscc-stock-data/
  data/
    stock_wt.CSV
```

Update flow:

1. Open the CSV file in GitHub web.
2. Edit the file directly in the browser.
3. Commit the change.
4. This app reads the raw CSV URL and refreshes on the next cache cycle.

## Environment

Create a local `.env` from `.env.example`, then set the real raw URL once the stock repo exists.

```bash
CSV_SOURCE=github
GITHUB_RAW_URL_WT=https://raw.githubusercontent.com/OWNER/mscc-stock-data/main/data/stock_wt.CSV
CACHE_TTL_MS=60000
```

## Local fallback

If `CSV_SOURCE` is not set, the app still reads:

```text
data/stock_wt.CSV
```

## Run

```bash
npm start
```
