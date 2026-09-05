const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  '// Send audio',
  '// Send audio\n            if (message.serverContent) { console.log("serverContent parts length:", message.serverContent?.modelTurn?.parts?.length); }\n            if (message.serverContent?.modelTurn?.parts?.[0]) {\n              const p = message.serverContent.modelTurn.parts[0];\n              console.log("part keys:", Object.keys(p));\n              if (p.inlineData) console.log("has inlineData");\n              if (p.executableCode) console.log("has executableCode");\n              if (p.functionCall) console.log("has functionCall");\n            }'
);

fs.writeFileSync('server.ts', server);
