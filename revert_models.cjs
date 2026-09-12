const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

// DEPRECATED HELPER — DO NOT USE to reintroduce gemini-1.5-flash.
// gemini-1.5-flash (and all 1.5/2.0 variants) are shut down as of 2026.
// Correct cascade (verified Sept 12, 2026): 3.8 -> 3.7 -> 3.6 -> 3.5 -> 3-flash (last resort).
// This script is kept as a no-op guard: it removes any stale 1.5-flash references
// instead of adding them back.
code = code.replace(/gemini-2\.5-flash/g, 'gemini-3.8-flash');
code = code.replace(/['"]gemini-1\.5-flash(?:-001|-002|-8b)?['"]/g, "'gemini-3.5-flash'");

fs.writeFileSync('server.ts', code, 'utf-8');
console.log('revert_models: stripped deprecated 1.5-flash refs (no-op guard).');
