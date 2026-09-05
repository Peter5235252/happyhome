const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'const session = await ai.live.connect({',
  `const session = await ai.live.connect({`
);

server = server.replace(
  'console.log("Client connected to Live API WebSocket");',
  `console.log("Client connected to Live API WebSocket");`
);

// We want to send a setup message or initial prompt
server = server.replace(
  'clientWs.on("message", (data) => {',
  `
      // Send an initial prompt to make the AI greet the user
      // @ts-ignore
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [{ text: "Hello! I just connected to the 3D raytraced world. Please introduce yourself and let me know I can ask you to create objects." }]
          }
        ],
        turnComplete: true
      });

      clientWs.on("message", (data) => {`
);

fs.writeFileSync('server.ts', server);
