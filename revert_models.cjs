const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

// Put back gemini-3.8-flash
code = code.replace(/gemini-2\.5-flash/g, 'gemini-3.8-flash');

code = code.replace(/return \['gemini-3\.8-flash', 'gemini-1\.5-flash'\];/g, "return ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-1.5-flash'];");
code = code.replace(/return \[model, 'gemini-3\.8-flash', 'gemini-1\.5-flash'\];/g, "return [model, 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-1.5-flash'];");

fs.writeFileSync('server.ts', code, 'utf-8');
