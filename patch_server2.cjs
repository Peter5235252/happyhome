const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'if (part.inlineData?.data) {',
  `if (part.inlineData?.data) {
                  // console.log("Sending audio chunk, mimeType:", part.inlineData.mimeType);`
);

fs.writeFileSync('server.ts', server);
