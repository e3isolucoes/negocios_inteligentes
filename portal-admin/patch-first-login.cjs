const fs = require('fs');

const SERVER = '/app/dist/server.cjs';
const INDEX = '/app/dist/index.html';
const SERVER_SNIPPET = '/tmp/first-login-server-snippet.txt';

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${label}: marker not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: marker is not unique`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

let server = fs.readFileSync(SERVER, 'utf8');

if (!server.includes('E3I_FIRST_LOGIN_PATCH_V1')) {
  const loginMarker = 'app.post("/api/auth/login", async (req, res) => {';
  const helperBlock = fs.readFileSync(SERVER_SNIPPET, 'utf8');
  server = replaceOnce(server, loginMarker, `${helperBlock}${loginMarker}`, 'login route');

  const loginPosition = server.indexOf(loginMarker);
  const loginWindowEnd = Math.min(server.length, loginPosition + 9000);
  const loginWindow = server.slice(loginPosition, loginWindowEnd);
  const lookupRegex = /const user = users\.find\(\(u\) => u\.email\.toLowerCase\(\) === normalizedEmail\);/;
  const match = loginWindow.match(lookupRegex);
  if (!match) throw new Error('login user lookup marker not found');

  const guard = [
    match[0],
    '    if (user?.mustChangePassword) {',
    '      let setupResult = { sent: false, throttled: false };',
    '      try {',
    '        setupResult = await e3iIssuePasswordSetupCode(user);',
    '      } catch (error) {',
    '        console.error("[first-login] initial code delivery failed", error instanceof Error ? error.message : error);',
    '      }',
    '      return res.status(428).json({',
    '        code: "PASSWORD_CHANGE_REQUIRED",',
    '        error: setupResult.sent || setupResult.throttled',
    '          ? "Primeiro acesso: defina uma nova senha usando o código enviado ao seu e-mail."',
    '          : "Primeiro acesso: é necessário definir uma nova senha. Use a opção de reenviar o código.",',
    '        email: user.email,',
    '      });',
    '    }',
  ].join('\n');

  const patchedWindow = loginWindow.replace(lookupRegex, guard);
  server = server.slice(0, loginPosition) + patchedWindow + server.slice(loginWindowEnd);
}

fs.writeFileSync(SERVER, server, 'utf8');

let index = fs.readFileSync(INDEX, 'utf8');
if (!index.includes('/first-login.css')) {
  if (!index.includes('</head>')) throw new Error('index.html has no </head> marker');
  index = index.replace('</head>', '  <link rel="stylesheet" href="/first-login.css">\n</head>');
}

const authBridgeTag = '<script src="/client-tool-auth.js"></script>';
const firstLoginTag = '<script src="/first-login.js"></script>';

if (!index.includes(authBridgeTag)) {
  const firstLoginPosition = index.indexOf(firstLoginTag);
  const firstScriptPosition = index.indexOf('<script');
  const insertionPoint = firstLoginPosition >= 0 ? firstLoginPosition : firstScriptPosition;
  const authBridgeScript = `  ${authBridgeTag}\n`;
  if (insertionPoint >= 0) {
    index = `${index.slice(0, insertionPoint)}${authBridgeScript}${index.slice(insertionPoint)}`;
  } else if (index.includes('</head>')) {
    index = index.replace('</head>', `${authBridgeScript}</head>`);
  } else {
    throw new Error('index.html has no script or </head> marker for auth bridge');
  }
}

if (!index.includes(firstLoginTag)) {
  const authBridgePosition = index.indexOf(authBridgeTag);
  const insertionPoint = authBridgePosition + authBridgeTag.length;
  if (authBridgePosition < 0) throw new Error('client-tool auth bridge must exist before first-login overlay');
  index = `${index.slice(0, insertionPoint)}\n  ${firstLoginTag}${index.slice(insertionPoint)}`;
}
fs.writeFileSync(INDEX, index, 'utf8');

const patchedServer = fs.readFileSync(SERVER, 'utf8');
const patchedIndex = fs.readFileSync(INDEX, 'utf8');
const authBridgeScriptPosition = patchedIndex.indexOf(authBridgeTag);
const firstLoginScriptPosition = patchedIndex.indexOf(firstLoginTag);
const firstScriptPosition = patchedIndex.indexOf('<script');
const secondScriptPosition = patchedIndex.indexOf('<script', firstScriptPosition + 1);
if (!patchedServer.includes('E3I_FIRST_LOGIN_PATCH_V1')) throw new Error('server onboarding helper validation failed');
if (!patchedServer.includes('PASSWORD_CHANGE_REQUIRED')) throw new Error('server onboarding guard validation failed');
if (!patchedServer.includes('res.status(428)')) throw new Error('first-login status validation failed');
if (authBridgeScriptPosition < 0) throw new Error('client-tool auth bridge injection validation failed');
if (firstLoginScriptPosition < 0) throw new Error('frontend onboarding injection validation failed');
if (firstScriptPosition !== authBridgeScriptPosition) throw new Error('client-tool auth bridge must load before application scripts');
if (secondScriptPosition !== firstLoginScriptPosition) throw new Error('first-login overlay must load immediately after auth bridge');
console.log('PORTAL_CLIENT_TOOL_AUTH_PATCH_OK');
console.log('PORTAL_FIRST_LOGIN_PATCH_OK');
