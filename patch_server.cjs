const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  /const audio = message\.serverContent\?\.modelTurn\?\.parts\?\.\[0\]\?\.inlineData\?\.data;[^}]*if \(audio\) \{[^}]*clientWs\.send\(JSON\.stringify\(\{ audio \}\)\);[^}]*\}/s,
  `if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                } else if ((part as any).audio?.data) {
                  clientWs.send(JSON.stringify({ audio: (part as any).audio.data }));
                }
              }
            }`
);

fs.writeFileSync('server.ts', server);
