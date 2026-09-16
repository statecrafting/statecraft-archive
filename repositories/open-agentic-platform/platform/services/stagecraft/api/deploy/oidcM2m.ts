type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

type CacheEntry = {
  token: string;
  expiresAtMs: number;
};

let cache: CacheEntry | null = null;

export async function fetchClientCredentialsToken(opts: {
  oidcEndpoint: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  scope?: string;
}): Promise<TokenResponse> {
  const url = `${opts.oidcEndpoint.replace(/\/+$/, "")}/auth/v1/oidc/token`;

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", opts.clientId);
  body.set("client_secret", opts.clientSecret);
  body.set("resource", opts.resource);
  if (opts.scope) body.set("scope", opts.scope);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OIDC token fetch failed: ${resp.status} ${t}`);
  }

  return (await resp.json()) as TokenResponse;
}

export async function getCachedDeploydAuthHeader(opts: {
  oidcEndpoint: string;
  resource: string;
  scope?: string;
  clientId: string;
  clientSecret: string;
  skewSeconds?: number;
}): Promise<string> {
  const skewMs = (opts.skewSeconds ?? 30) * 1000;

  if (cache && Date.now() + skewMs < cache.expiresAtMs) {
    return `Bearer ${cache.token}`;
  }

  const tok = await fetchClientCredentialsToken({
    oidcEndpoint: opts.oidcEndpoint,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    resource: opts.resource,
    scope: opts.scope,
  });

  cache = {
    token: tok.access_token,
    expiresAtMs: Date.now() + tok.expires_in * 1000,
  };

  return `Bearer ${tok.access_token}`;
}
