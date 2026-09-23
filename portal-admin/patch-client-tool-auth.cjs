const fs = require('fs');

const indexPath = process.env.E3I_PORTAL_INDEX || '/app/dist/index.html';
let source = fs.readFileSync(indexPath, 'utf8');

const tag = '<script src="/client-tool-auth.js"></script>';
if (!source.includes(tag)) {
  const firstScript = source.indexOf('<script');
  if (firstScript < 0) throw new Error('index.html has no script tag for auth bridge injection');
  source = `${source.slice(0, firstScript)}  ${tag}\n${source.slice(firstScript)}`;
  fs.writeFileSync(indexPath, source, 'utf8');
}

const patched = fs.readFileSync(indexPath, 'utf8');
if (patched.indexOf(tag) < 0) throw new Error('client-tool auth bridge injection failed');
if (patched.indexOf(tag) !== patched.indexOf('<script')) {
  throw new Error('client-tool auth bridge must load before application scripts');
}

console.log('E3I_CLIENT_TOOL_AUTH_PATCH_OK');
