const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const regex = /systemInstruction: "You are a raw audio transcription engine\. You must transcribe the user's audio verbatim\. Do not hallucinate, do not respond to questions, do not describe background noise, and do not invent any prompt instructions\. If the audio is empty, noise, or silence, output absolutely nothing\.",/m;

const replacement = `systemInstruction: "You are a raw audio transcription engine. You must transcribe the user's audio verbatim. Output EXACTLY and ONLY what is spoken. If no words are clearly spoken, or if it is just silence or background noise, you MUST output the exact string 'SILENCE_DETECTED'. Do not hallucinate, do not respond to questions.",`;

code = code.replace(regex, replacement);

const transcriptRegex = /let transcript = \(execution\.result\.text \|\| ""\)\.trim\(\);\n\n\s*\/\/ Strip any extra quotes or backticks if generated\n\s*transcript = transcript\.replace\(\/\^\["'`\]\+\|\["'`\]\+\$\/g, ''\)\.trim\(\);/m;

const transcriptReplacement = `let transcript = (execution.result.text || "").trim();

      // Strip any extra quotes or backticks if generated
      transcript = transcript.replace(/^["'\`]+|["'\`]+$/g, '').trim();
      
      // Filter out silence token and typical hallucinations
      if (transcript === "SILENCE_DETECTED" || transcript.includes("it appears that for")) {
        transcript = "";
      }`;

code = code.replace(transcriptRegex, transcriptReplacement);

fs.writeFileSync('server.ts', code, 'utf-8');
