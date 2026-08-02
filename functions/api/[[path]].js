// Cloudflare Pages Function — a same-origin proxy to Supabase.
//
// The app calls /api/rest/v1/... and /api/auth/v1/... on its OWN domain
// (treasure-crown.pages.dev). This function forwards each request server-side
// to the Supabase project and returns the response, so the browser never
// contacts supabase.co directly — which lets the app work on networks / managed
// devices that block the supabase.co domain but allow our app's domain.
const SUPABASE_URL = 'https://yicouwpxiubtobahynrx.supabase.co';

export async function onRequest(context) {
  const { request, params } = context;
  const path = (Array.isArray(params.path) ? params.path.join('/') : params.path) || '';
  const search = new URL(request.url).search;
  const target = `${SUPABASE_URL}/${path}${search}`;

  // Forward the caller's headers (apikey, Authorization, Content-Type, Prefer…)
  // minus hop-by-hop / host headers that must not be relayed.
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('x-forwarded-host');

  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const upstream = await fetch(target, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  // Return the decoded body with the original status + content type. Reading the
  // buffer lets the runtime set a correct content-length and avoids encoding
  // mismatches from passing through a compressed stream.
  const body = await upstream.arrayBuffer();
  const out = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) out.set('content-type', ct);
  const range = upstream.headers.get('content-range');
  if (range) out.set('content-range', range);
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
