// Proxies Azure Retail Prices API to bypass browser CORS.
// Forwards currencyCode and $filter; passes through pagination via "next" param.

module.exports = async function (context, req) {
  const params = new URLSearchParams();
  if (req.query.currencyCode) params.set('currencyCode', req.query.currencyCode);
  if (req.query['$filter']) params.set('$filter', req.query['$filter']);
  if (req.query['$skip']) params.set('$skip', req.query['$skip']);
  if (req.query['$top']) params.set('$top', req.query['$top']);

  // Optional: pass-through full next-page link
  let url;
  if (req.query.next) {
    url = req.query.next;
  } else {
    url = `https://prices.azure.com/api/retail/prices?${params.toString()}`;
  }

  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      // Function default timeout is 230s; abort after 30s to fail fast
      signal: AbortSignal.timeout(30000)
    });
    const text = await resp.text();
    context.res = {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: text
    };
  } catch (e) {
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream fetch failed', detail: String(e) })
    };
  }
};
