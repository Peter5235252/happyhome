const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const regex = /const execution = await executeGeminiWithQuotaFallback\(\s*"gemini-3.8-flash",\s*async \(activeModel\) => \{\s*return await genAI\.models\.generateContent\(\{\s*model: activeModel,\s*contents,\s*\}\);\s*\},\s*'audio transcription'\s*\);/;

const replacement = `const execution = await executeGeminiWithQuotaFallback(
        "gemini-2.5-flash",
        async (activeModel) => {
          return await genAI.models.generateContent({
            model: activeModel,
            contents,
            systemInstruction: "You are a raw audio transcription engine. You must transcribe the user's audio verbatim. Do not hallucinate, do not respond to questions, do not describe background noise, and do not invent any prompt instructions. If the audio is empty, noise, or silence, output absolutely nothing.",
            config: {
              temperature: 0.0,
            }
          });
        },
        'audio transcription'
      );`;

code = code.replace(regex, replacement);
fs.writeFileSync('server.ts', code, 'utf-8');
