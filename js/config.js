// Public Supabase connection for Treasure Crown. The anon key is safe to ship
// in client code — Row-Level Security restricts data to the signed-in owner.
// App version — shown in Setup so you can confirm a device has the latest update.
// Bump this together with the service-worker cache in sw.js on every deploy.
export const APP_VERSION = 'v65';
export const SUPABASE_URL = "https://yicouwpxiubtobahynrx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpY291d3B4aXVidG9iYWh5bnJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MjU0NTksImV4cCI6MjEwMTEwMTQ1OX0.WvcauJAOInfAmqF-vvy0wP5DDBRppqqAmvOyQzYmngc";
