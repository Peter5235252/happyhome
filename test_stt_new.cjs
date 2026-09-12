const { GoogleGenAI } = require("@google/genai");

async function main() {
  const genAI = new GoogleGenAI();
  try {
    const response = await genAI.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: "Hello, this is a test without audio." }] }],
      config: {
        systemInstruction: "You are a raw audio transcription engine. You must transcribe the user's audio verbatim. Do not hallucinate, do not respond to questions, do not describe background noise, and do not invent any prompt instructions. If the audio is empty, noise, or silence, output absolutely nothing.",
        temperature: 0.0
      }
    });
    console.log("Success with 3.6! Output:", response.text);
  } catch (e) {
    console.error("Failed 3.6:", e);
  }
}
main();
