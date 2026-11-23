'use strict';
// Builds dist/secret-kale-demo.html: the whole app in one page, playing against bots with no server.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const eng = fs.readFileSync(path.join(__dirname, 'public/engine.js'), 'utf8');
const tag = '<script src="engine.js"></script>';
if (html.indexOf(tag) < 0) throw new Error('engine script tag not found in public/index.html');
let out = html.replace(tag, '<script>window.__DEMO=true</script>\n<script>\n' + eng + '\n</script>');
// the demo is one file: the fonts go in as data URIs, and the preload hints are dropped
out = out.replace(/<link rel="preload"[^>]*>\n?/g, '');
out = out.replace(/url\((fonts\/[a-z0-9-]+\.woff2)\)/g, (m, f) =>
  'url(data:font/woff2;base64,' + fs.readFileSync(path.join(__dirname, 'public', f)).toString('base64') + ')');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/secret-kale-demo.html'), out);
console.log('wrote dist/secret-kale-demo.html (' + out.length + ' bytes)');
