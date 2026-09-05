import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from 'dotenv';
dotenv.config();

const defaultGemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "createObject",
      description: "Places an individual 3D object in the raytraced scene with custom geometry, position, color, and PBR/emissive material.",
      parameters: {
        type: "object",
        properties: {
          shape: {
            type: "string",
            enum: ["sphere", "box", "cylinder", "capsule", "torus", "cone", "crystal", "lantern"],
            description: "Shape geometry: 'sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'crystal', or 'lantern'."
          },
          position: {
            type: "array",
            items: { type: "number" },
            description: "[x, y, z] coordinates. The house is centered at [0, 0, 0]. Ground is y=0. Porch is at [0, 0.4, 1.8]. Pathway extends forward towards z=4.0. Roof top is around y=2.8."
          },
          size: {
            type: "array",
            items: { type: "number" },
            description: "[width/radius, height, depth]. e.g. [0.4, 0.4, 0.4] for medium orb, or [0.15, 0.6, 0.15] for pillar/lantern."
          },
          color: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] normalized color from 0.0 to 1.0 (e.g. [1.0, 0.85, 0.3] for warm gold, [0.2, 0.8, 1.0] for cyan crystal, [1.0, 0.3, 0.2] for ruby)."
          },
          roughness: {
            type: "number",
            description: "0.0 (mirror-like glossy) to 1.0 (matte clay)."
          },
          metallic: {
            type: "number",
            description: "0.0 (dielectric) to 1.0 (pure reflective metal)."
          },
          emissive: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] emissive intensity for glowing lights and lanterns (e.g. [2.0, 1.5, 0.8] for a luminous warm lantern)."
          },
          label: {
            type: "string",
            description: "A short descriptive name (e.g. 'golden porch lantern', 'floating crystal')."
          }
        },
        required: ["shape", "position", "size", "color"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "batchCreateObjects",
      description: "Spawns multiple coordinated 3D objects at once to construct scenes, arrays of path lanterns, crystal gardens, or decorative arrangements.",
      parameters: {
        type: "object",
        properties: {
          objects: {
            type: "array",
            items: {
              type: "object",
              properties: {
                shape: { type: "string", enum: ["sphere", "box", "cylinder", "capsule", "torus", "cone", "crystal", "lantern"] },
                position: { type: "array", items: { type: "number" } },
                size: { type: "array", items: { type: "number" } },
                color: { type: "array", items: { type: "number" } },
                roughness: { type: "number" },
                metallic: { type: "number" },
                emissive: { type: "array", items: { type: "number" } },
                label: { type: "string" }
              },
              required: ["shape", "position", "size", "color"]
            },
            description: "Array of object definitions to spawn simultaneously."
          }
        },
        required: ["objects"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "modifyObject",
      description: "Modifies or restyles existing dynamic objects in the scene by index or descriptive label.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index of the dynamic object to alter." },
          label: { type: "string", description: "Label of the object to alter if index is unknown." },
          position: { type: "array", items: { type: "number" } },
          size: { type: "array", items: { type: "number" } },
          color: { type: "array", items: { type: "number" } },
          emissive: { type: "array", items: { type: "number" } },
          roughness: { type: "number" },
          metallic: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "removeObject",
      description: "Removes a specific dynamic object from the scene by index or label.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index of object to remove." },
          label: { type: "string", description: "Label or description of the object to remove." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clearObjects",
      description: "Clears all user-created dynamic 3D objects from the raytraced scene.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "setLighting",
      description: "Adjusts the solar angle, time of day, volumetric godrays, and global illumination.",
      parameters: {
        type: "object",
        properties: {
          timeOfDay: {
            type: "number",
            description: "Time of day from 0.0 to 1.0 (0.05=night with stars, 0.2=sunrise, 0.35=crisp noon, 0.68=golden hour, 0.82=vibrant sunset, 0.92=twilight blue hour)."
          },
          godrayIntensity: {
            type: "number",
            description: "Volumetric sunbeam intensity from 0.0 (clear) to 2.5 (dramatic atmospheric shafts)."
          },
          giIntensity: {
            type: "number",
            description: "Global illumination diffuse bounce intensity (0.0 to 2.0)."
          },
          aoIntensity: {
            type: "number",
            description: "Ambient occlusion contact shadow depth (0.0 to 2.0)."
          },
          reflectionsEnabled: {
            type: "boolean",
            description: "Whether raytraced specular reflections are active."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "setAtmosphere",
      description: "Controls atmospheric wind, chimney smoke drift, cloud density, and sound effects.",
      parameters: {
        type: "object",
        properties: {
          smokeSpeed: { type: "number", description: "Speed of chimney smoke rising (0.0 to 3.0)." },
          windSpeed: { type: "number", description: "Wind sway for trees and foliage (0.0 to 3.0)." },
          cloudDensity: { type: "number", description: "Atmospheric cloud density (0.0 to 1.5)." },
          audioEnabled: { type: "boolean", description: "Toggle ambient environmental sounds." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "setCamera",
      description: "Positions and angles the camera freely, or switches to a cinematic camera preset.",
      parameters: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: ["svg_perspective", "cinematic", "meadow", "sunset", "aerial", "dramatic_low", "close_up"],
            description: "Quick camera composition preset."
          },
          azimuth: { type: "number", description: "Horizontal orbit angle in radians." },
          elevation: { type: "number", description: "Vertical pitch angle in radians (e.g. 1.48 for eye level, 0.8 for high overhead, 1.8 for dramatic ground view)." },
          distance: { type: "number", description: "Camera distance from target (4.0 = close, 10.0 = medium, 16.0 = wide establishing)." },
          target: { type: "array", items: { type: "number" }, description: "[x, y, z] point in 3D space the camera is looking at." },
          fov: { type: "number", description: "Field of view in degrees (35 = telephoto portrait, 50 = standard, 70 = wide-angle)." }
        }
      }
    }
  }
];

const CLAUDE_TOOLS = OPENAI_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters
}));

const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "createObject",
    description: "Places an individual 3D object in the raytraced scene with custom geometry, position, color, and PBR/emissive material.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        shape: { type: Type.STRING, description: "'sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'crystal', or 'lantern'" },
        position: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[x, y, z] coordinates." },
        size: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[width/radius, height, depth]." },
        color: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] normalized 0.0 to 1.0." },
        roughness: { type: Type.NUMBER, description: "0.0 to 1.0." },
        metallic: { type: Type.NUMBER, description: "0.0 to 1.0." },
        emissive: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] glow intensity." },
        label: { type: Type.STRING, description: "Short descriptive label." }
      },
      required: ["shape", "position", "size", "color"]
    }
  },
  {
    name: "batchCreateObjects",
    description: "Spawns multiple coordinated 3D objects at once to construct scenes, arrays of path lanterns, crystal gardens, or decorative arrangements.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        objects: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              shape: { type: Type.STRING },
              position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              size: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              color: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              roughness: { type: Type.NUMBER },
              metallic: { type: Type.NUMBER },
              emissive: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              label: { type: Type.STRING }
            },
            required: ["shape", "position", "size", "color"]
          }
        }
      },
      required: ["objects"]
    }
  },
  {
    name: "modifyObject",
    description: "Modifies or restyles existing dynamic objects in the scene by index or descriptive label.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        index: { type: Type.NUMBER },
        label: { type: Type.STRING },
        position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        size: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        color: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        emissive: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        roughness: { type: Type.NUMBER },
        metallic: { type: Type.NUMBER }
      }
    }
  },
  {
    name: "removeObject",
    description: "Removes a specific dynamic object from the scene by index or label.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        index: { type: Type.NUMBER },
        label: { type: Type.STRING }
      }
    }
  },
  {
    name: "clearObjects",
    description: "Clears all user-created dynamic 3D objects from the raytraced scene.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "setLighting",
    description: "Adjusts the solar angle, time of day, volumetric godrays, and global illumination.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeOfDay: { type: Type.NUMBER, description: "0.0 to 1.0 (0.05=night, 0.2=sunrise, 0.35=noon, 0.7=golden hour, 0.82=sunset, 0.92=twilight)" },
        godrayIntensity: { type: Type.NUMBER, description: "0.0 to 2.5" },
        giIntensity: { type: Type.NUMBER, description: "0.0 to 2.0" },
        aoIntensity: { type: Type.NUMBER, description: "0.0 to 2.0" },
        reflectionsEnabled: { type: Type.BOOLEAN }
      }
    }
  },
  {
    name: "setAtmosphere",
    description: "Controls atmospheric wind, chimney smoke drift, cloud density, and sound effects.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        smokeSpeed: { type: Type.NUMBER },
        windSpeed: { type: Type.NUMBER },
        cloudDensity: { type: Type.NUMBER },
        audioEnabled: { type: Type.BOOLEAN }
      }
    }
  },
  {
    name: "setCamera",
    description: "Positions and angles the camera freely, or switches to a cinematic camera preset.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        preset: { type: Type.STRING, description: "'svg_perspective', 'cinematic', 'meadow', 'sunset', 'aerial', 'dramatic_low', 'close_up'" },
        azimuth: { type: Type.NUMBER },
        elevation: { type: Type.NUMBER },
        distance: { type: Type.NUMBER },
        target: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        fov: { type: Type.NUMBER }
      }
    }
  }
];

function buildSystemPrompt(context: any): string {
  const objectsDesc = context?.dynamicObjects && context.dynamicObjects.length > 0
    ? context.dynamicObjects.map((o: any, idx: number) => `[#${idx} ${o.label || o.shape} at ${JSON.stringify(o.position || [])}]`).join(', ')
    : 'None currently.';

  const memorySection = context?.memory
    ? `
CROSS-SESSION USER MEMORY (Saved from previous sessions):
- Memory Summary: ${context.memory.summary || "First meeting."}
- Remembered Preferences & Facts:
${(context.memory.facts || []).map((f: string) => `  • ${f}`).join('\n') || "  • None recorded yet."}
*(Use this memory context naturally to personalize your creative suggestions, honor their aesthetic preferences, and remember their past creations!)*`
    : '';

  return `You are the creative, highly capable, and spontaneous AI 3D Director & Voice Companion for "Happy Home" — a live photorealistic WebGPU raytracer.
You have full creative agency to sculpt the world, place and shape objects, paint lighting and atmosphere, choreograph camera perspectives, and converse with the user.

3D SCENE COORDINATES & GEOMETRY:
- The cottage is centered around [0, 0, 0]. Front porch & door are at [0, 0.4, 1.8].
- The cobblestone pathway extends forward from z = 1.8 to z = 5.0 (x between -0.8 and 0.8).
- The front lawn areas are x: -4.0 to -1.2 (left) and x: 1.2 to 4.0 (right).
- Ground level is y = 0.0 to 0.3. Floating items can be placed at y = 1.0 to 2.5.
- Roof gable peaks at y = 2.8. Chimney is at [1.0, 3.2, -0.4].

CURRENT 3D SCENE STATE:
- Dynamic Objects: ${context?.dynamicObjectsCount || 0} objects (${objectsDesc})
- Time of Day: ${context?.settings?.timeOfDay ?? 0.35} (0.05=starry night, 0.2=sunrise, 0.35=noon, 0.7=golden hour, 0.82=sunset, 0.92=twilight)
- Volumetric Godrays: ${context?.settings?.godrayIntensity ?? 1.2}x
- Global Illumination: ${context?.settings?.giIntensity ?? 1.0}x
- Camera: Preset "${context?.settings?.cameraPreset ?? 'svg_perspective'}"
${memorySection}

CORE AGENTIC BEHAVIORS:
1. CHAIN ACTIONS FREELY: You can call multiple tools in a single response! For instance, when requested to make an evening scene, seamlessly chain 'setLighting', 'batchCreateObjects' (for glowing lanterns along the walkway), and 'setCamera' for a cinematic angle.
2. NATURAL & CONVERSATIONAL VOICE: ALWAYS provide a warm, genuine, conversational spoken response in natural English. Explain what you created or adjusted, share your creative thinking, and invite the user into the creative flow.
3. NEVER USE ROBOTIC FALLBACK TEMPLATES: Avoid repetitive phrases like "I have placed that object for you" or "Ready for your next command". Speak with authentic personality, enthusiasm, and style.
4. SPOKEN AUDIO RULES: Your speech will be read aloud. Keep it concise (1 to 3 natural sentences). Do not use markdown symbols (*, #, \`, bullets, emojis) in the spoken text.`;
}

async function handleGeminiCall(model: string, apiKey: string | undefined, message: string, context: any, history: any[] = []) {
  const genAI = apiKey ? new GoogleGenAI({ apiKey }) : defaultGemini;
  
  const contents = [
    ...(history || []).slice(-6).map((h: any) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    })),
    {
      role: "user",
      parts: [{ text: message }]
    }
  ];

  const response = await genAI.models.generateContent({
    model: model || "gemini-3.6-flash",
    contents,
    config: {
      systemInstruction: buildSystemPrompt(context),
      temperature: 0.75,
      tools: [
        {
          functionDeclarations: GEMINI_FUNCTION_DECLARATIONS as any
        }
      ]
    }
  });

  const candidate = response.candidates?.[0];
  const functionCalls: any[] = [];
  let speechText = "";

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args
        });
      }
      if (part.text) {
        speechText += part.text + " ";
      }
    }
  }

  // If the model invoked tools without verbal text, generate a natural conversational summary
  if (!speechText.trim() && functionCalls.length > 0) {
    try {
      const summaryRes = await genAI.models.generateContent({
        model: model || "gemini-3.6-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${buildSystemPrompt(context)}\n\nThe user requested: "${message}".\nYou just performed these 3D scene actions: ${JSON.stringify(functionCalls)}.\nIn 1-2 warm, natural, spoken sentences without markdown or bullet points, describe what you did and converse with the user.`
              }
            ]
          }
        ],
        config: { temperature: 0.75 }
      });
      speechText = summaryRes.text || "";
    } catch {
      // Fallback
    }
  }

  return { speechText: speechText.trim(), functionCalls };
}

async function handleOpenAICompatibleCall(
  endpointUrl: string,
  model: string,
  key: string,
  message: string,
  context: any,
  history: any[] = []
) {
  const messages = [
    { role: "system", content: buildSystemPrompt(context) },
    ...(history || []).slice(-6).map((h: any) => ({ role: h.role, content: h.content })),
    { role: "user", content: message }
  ];

  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      tools: OPENAI_TOOLS,
      temperature: 0.75
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  let speechText = choice?.content || "";
  const functionCalls: any[] = [];

  if (choice?.tool_calls) {
    for (const tool of choice.tool_calls) {
      if (tool.function) {
        try {
          functionCalls.push({
            name: tool.function.name,
            args: typeof tool.function.arguments === 'string' ? JSON.parse(tool.function.arguments) : tool.function.arguments
          });
        } catch (e) {
          console.warn("Failed to parse tool call args:", e);
        }
      }
    }
  }

  // If text is missing with tool calls, generate spontaneous voice text
  if (!speechText.trim() && functionCalls.length > 0) {
    try {
      const summaryRes = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: buildSystemPrompt(context) },
            { role: "user", content: `You just executed these actions for the user's prompt "${message}": ${JSON.stringify(functionCalls)}. In 1-2 natural spoken sentences, tell the user what you crafted or modified.` }
          ],
          temperature: 0.75
        })
      });
      if (summaryRes.ok) {
        const sData = await summaryRes.json();
        speechText = sData.choices?.[0]?.message?.content || "";
      }
    } catch {}
  }

  return { speechText: speechText.trim(), functionCalls };
}

async function handleClaudeCall(model: string, key: string, message: string, context: any, history: any[] = []) {
  const messages = [
    ...(history || []).slice(-6).map((h: any) => ({ role: h.role, content: h.content })),
    { role: "user", content: message }
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(context),
      messages,
      tools: CLAUDE_TOOLS,
      temperature: 0.75
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Claude API Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  let speechText = "";
  const functionCalls: any[] = [];

  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text') {
        speechText += block.text + " ";
      } else if (block.type === 'tool_use') {
        functionCalls.push({
          name: block.name,
          args: block.input
        });
      }
    }
  }

  return { speechText: speechText.trim(), functionCalls };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API health
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Agentic Multi-Model Voice Endpoint
  app.post("/api/voice-agent", async (req, res) => {
    try {
      const { message, model = "gemini-3.6-flash", apiKey, context, history = [] } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log(`Voice Agent [Model: ${model}] prompt:`, message);

      let result: { speechText: string; functionCalls: any[] };

      // Provider Dispatcher based on verified model identifiers
      if (model.startsWith("gemini-")) {
        result = await handleGeminiCall(model, apiKey, message, context, history);
      } else if (model.startsWith("gpt-")) {
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your OpenAI API key in the settings menu to connect ChatGPT.",
            functionCalls: []
          });
        }
        result = await handleOpenAICompatibleCall("https://api.openai.com/v1/chat/completions", model, key, message, context, history);
      } else if (model.startsWith("grok-")) {
        const key = apiKey || process.env.XAI_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your xAI API key in the settings menu to connect Grok.",
            functionCalls: []
          });
        }
        result = await handleOpenAICompatibleCall("https://api.x.ai/v1/chat/completions", model, key, message, context, history);
      } else if (model.startsWith("mistral-")) {
        const key = apiKey || process.env.MISTRAL_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your Mistral API key in the settings menu to connect Mistral.",
            functionCalls: []
          });
        }
        result = await handleOpenAICompatibleCall("https://api.mistral.ai/v1/chat/completions", model, key, message, context, history);
      } else if (model.startsWith("claude-")) {
        const key = apiKey || process.env.ANTHROPIC_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your Anthropic API key in the settings menu to connect Claude.",
            functionCalls: []
          });
        }
        result = await handleClaudeCall(model, key, message, context, history);
      } else {
        // Fallback to default Gemini
        result = await handleGeminiCall("gemini-3.6-flash", apiKey, message, context, history);
      }

      let { speechText, functionCalls } = result;

      // Clean speech text
      speechText = (speechText || "")
        .replace(/[*#`_]/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      if (!speechText) {
        speechText = "I've updated the 3D scene according to your vision.";
      }

      res.json({
        speechText,
        functionCalls
      });
    } catch (err: any) {
      console.error("Voice Agent error:", err);
      res.status(500).json({ 
        error: "Failed to process voice command",
        speechText: err.message ? `Error: ${err.message.slice(0, 120)}` : "Sorry, I had trouble processing that request. Please try again!"
      });
    }
  });

  // Cross-Session Memory Summarizer Endpoint
  app.post("/api/summarize-session", async (req, res) => {
    const { history = [], currentMemory = null, model = "gemini-3.6-flash", apiKey } = req.body || {};
    try {
      if (!history || history.length === 0) {
        return res.json({ 
          summary: currentMemory?.summary || "Explored the 3D raytraced world.",
          facts: currentMemory?.facts || [],
          items: []
        });
      }

      const genAI = apiKey ? new GoogleGenAI({ apiKey }) : defaultGemini;
      const prompt = `You are the memory consolidation subsystem for the "Happy Home" WebGPU 3D raytracer AI director.
Analyze this recently concluded session between the user and the AI director.

PREVIOUS USER MEMORY PROFILE:
${JSON.stringify(currentMemory || { summary: "None yet", facts: [] }, null, 2)}

SESSION TRANSCRIPT:
${history.map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}

INSTRUCTIONS:
1. Synthesize an updated, highly coherent 2-3 sentence overview ('summary') describing the user's artistic personality, favorite lighting/moods, preferred shapes/objects, camera angles, and creative habits.
2. Compile a list of key bullet facts ('facts') capturing concrete preferences (e.g. "Prefers twilight and golden hour lighting", "Likes floating cyan crystals along the walkway", "Prefers high godray volumetric intensity").
3. Extract granular memory items ('items') categorized as:
   - "preference" (e.g. favorite color, lighting, or preset)
   - "creative_style" (e.g. minimal, lush, neon, tranquil)
   - "fact" (e.g. named the cottage, mentioned a specific project)
   - "custom_instruction" (e.g. wants short explanations, specific terminology)

OUTPUT FORMAT: Strict JSON only.
{
  "summary": "Updated concise multi-session overview text",
  "facts": ["Fact 1", "Fact 2", "Fact 3"],
  "items": [
    { "category": "preference", "text": "Prefers sunset and golden hour solar angles" },
    { "category": "creative_style", "text": "Likes placing glowing warm lanterns along the front path" }
  ]
}`;

      const summaryModel = model.startsWith("gemini-") ? model : "gemini-3.6-flash";
      const response = await genAI.models.generateContent({
        model: summaryModel,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const parsed = JSON.parse(response.text || "{}");
      res.json({
        summary: parsed.summary || currentMemory?.summary || "Enjoys crafting photorealistic 3D raytraced scenes.",
        facts: parsed.facts || currentMemory?.facts || [],
        items: parsed.items || []
      });
    } catch (err: any) {
      console.error("Session summarizer error:", err);
      res.status(500).json({ 
        error: "Failed to summarize session",
        summary: currentMemory?.summary || "Explored the 3D raytraced world.",
        facts: currentMemory?.facts || [],
        items: []
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
