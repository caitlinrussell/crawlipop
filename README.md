# Crawlipop

A small SEO ops dashboard that:

- shows Search Console performance at a glance,
- turns recent query/page changes into recommendations,
- lets you create a Linear issue directly from a suggestion.

The app ships with demo data so the interface is usable before you connect any external services.

## Run it

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

## Environment

```env
PORT=3000
GOOGLE_SITE_URL=sc-domain:example.com
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=
GOOGLE_DATA_DELAY_DAYS=2
SYNC_SCHEDULE=17 */6 * * *
LINEAR_API_KEY=
LINEAR_DEFAULT_TEAM_ID=
```

Recommended setup:

- Put your Google service account JSON in a local file and set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`.
- Use `GOOGLE_SITE_URL=sc-domain:example.com` for domain properties or the full URL for URL-prefix properties.
- Set `LINEAR_DEFAULT_TEAM_ID` if you want one-click issue creation without choosing a team in the UI.

## Search Console setup

1. Create a Google Cloud service account and download its JSON key.
2. Add that service account email to the Search Console property with access to the property.
3. Fill in `GOOGLE_SITE_URL` plus either `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Start the app and click `Sync Search Console`.

The server queries two rolling windows, compares them, and generates recommendations from:

- high-impression / low-CTR queries,
- near-page-one queries,
- pages losing clicks while still ranking well,
- pages with strong momentum worth expanding.

## Linear setup

1. Create a Linear personal API key.
2. Set `LINEAR_API_KEY`.
3. Optionally set `LINEAR_DEFAULT_TEAM_ID`, or choose a team from the dropdown in the UI.

When you click a suggestion, Crawlipop creates a Linear issue with a prefilled title, metrics, evidence, and next steps.

## Notes

- Search Console data is delayed by default with `GOOGLE_DATA_DELAY_DAYS=2` to avoid partial fresh-day data.
- The app caches the latest dashboard payload in `.data/dashboard-cache.json`.
- If Search Console sync fails after a prior successful sync, the last cached snapshot is kept and the error is shown in the UI.

## References

- Google Search Console Search Analytics API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- Google Search Console authorization: https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- Search Console owners, users, and permissions: https://support.google.com/webmasters/answer/7687615
- Linear developer SDK: https://linear.app/developers/sdk
- Linear GraphQL API usage: https://linear.app/developers/oauth-actors#making-api-requests-on-behalf-of-the-user
