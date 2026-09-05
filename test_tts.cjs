const { GoogleGenAI } = require("@google/genai");
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: "Hello there! I am your 3D world AI companion. Let me know what you'd like to create in the scene!",
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Puck"
            }
          }
        }
      }
    });

    console.log("Response candidates:", response.candidates?.length);
    const candidate = response.candidates?.[0];
    console.log("Parts:", candidate?.content?.parts);
    if (candidate?.content?.parts?.[0]?.inlineData) {
      console.log("inlineData mimeType:", candidate.content.parts[0].inlineData.mimeType);
      console.log("inlineData data length:", candidate.content.parts[0].inlineData.data?.length);
    }
  } catch (err) {
    console.error("Error in TTS:", err);
  }
}

test();
