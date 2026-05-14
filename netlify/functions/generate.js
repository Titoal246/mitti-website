exports.handler = async function (event) {
  // CORS preflight
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'API key not configured on server. Add ANTHROPIC_API_KEY to Netlify environment variables.' }),
    };
  }

  let system, user, max_tokens;
  try {
    ({ system, user, max_tokens } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  if (!system || !user) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required fields: system and user.' }) };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 4000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok || data.type === 'error') {
      const msg = data?.error?.message || data?.message || 'API error ' + response.status;
      return { statusCode: response.status, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };

  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out. Please try again.' : err.message;
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
  }
};
