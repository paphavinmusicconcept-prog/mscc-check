# MSCC Check

Stock checker MVP for LINE OA / LIFF.

## Recommended setup

Use a separate GitHub repo for the stock CSV only.

Example:

```text
mscc-stock-data/
  data/
    stock_mscc.CSV
    stock_mscc_werehouse.CSV
    stock_beh_hq.CSV
    stock_beh_werehouse.CSV
```

Update flow:

1. Open the CSV files in GitHub web.
2. Edit or replace the CSV files directly in the browser.
3. Commit the change.
4. This app reads the raw CSV URLs and refreshes on the next cache cycle.

## Environment

Create a local `.env` from `.env.example`, then set the real raw URL once the stock repo exists.

```bash
LIFF_ID=
CSV_SOURCE=github
GITHUB_RAW_URLS=https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_mscc.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_mscc_werehouse.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_beh_hq.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_beh_werehouse.CSV
CACHE_TTL_MS=60000
```

## LIFF

Deploy this app to an HTTPS URL first, then create a LIFF app in the LINE Developers Console and set the deployed URL as the Endpoint URL.

Open the app from LINE with:

```text
https://liff.line.me/{liffId}
```

## Local fallback

If `CSV_SOURCE` is not set, the app still reads:

```text
data/stock_mscc.CSV
data/stock_mscc_werehouse.CSV
data/stock_beh_hq.CSV
data/stock_beh_werehouse.CSV
```

## Run

```bash
npm start
```
