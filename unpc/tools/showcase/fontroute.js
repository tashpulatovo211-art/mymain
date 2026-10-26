// Serves any Google Fonts request to Playwright by fetching it with curl (which trusts the proxy CA), cached on disk.
// Usage: const { routeAnyFonts } = require('<scratchpad>/fontroute.js'); await routeAnyFonts(context);
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CACHE = path.join(__dirname, 'fontcache');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
function get(url) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex'));
  if (!fs.existsSync(f)) execFileSync('curl', ['-sS', '-L', '-m', '30', '-A', UA, '-o', f, url]);
  return fs.readFileSync(f);
}
async function routeAnyFonts(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', (r) => {
    try { r.fulfill({ body: get(r.request().url()), contentType: 'text/css', headers: { 'access-control-allow-origin': '*' } }); }
    catch (e) { r.abort(); }
  });
  await ctx.route('https://fonts.gstatic.com/**', (r) => {
    try { r.fulfill({ body: get(r.request().url()), contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' } }); }
    catch (e) { r.abort(); }
  });
}
module.exports = { routeAnyFonts };
