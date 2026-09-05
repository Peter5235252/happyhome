const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'if (message.serverContent?.modelTurn?.parts) {',
  `if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.text) {
                  console.log("Model says:", part.text);
                }
              }`
);

fs.writeFileSync('server.ts', server);
