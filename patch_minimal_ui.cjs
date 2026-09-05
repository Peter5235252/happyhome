const fs = require('fs');
let code = fs.readFileSync('src/components/MinimalUI.tsx', 'utf8');
const importMic = `import { Mic, MicOff } from 'lucide-react';`;
if (!code.includes('Mic,')) {
    code = code.replace(/import {([^}]+)} from 'lucide-react';/, (match, p1) => {
        return `import {${p1}, Mic, MicOff} from 'lucide-react';`;
    });
}

const voiceBtn = `
          {/* Agent Voice Toggle */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => {
              if (toggleVoiceMode) toggleVoiceMode();
            }}
            className={\`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium backdrop-blur-xl border transition-all \${
              isVoiceActive
                ? 'bg-rose-500/25 border-rose-400/40 text-rose-200 shadow-md animate-pulse'
                : 'bg-neutral-950/45 border-white/10 text-neutral-300 hover:bg-neutral-900/60'
            }\`}
            title="Talk to Gemini Agent"
          >
            {isVoiceActive ? <Mic className="h-3.5 w-3.5 text-rose-400" /> : <MicOff className="h-3.5 w-3.5 text-neutral-400" />}
            <span className="hidden sm:inline">Voice</span>
          </motion.button>
`;

code = code.replace('{/* Audio Feedback Toggle */}', voiceBtn + '\n          {/* Audio Feedback Toggle */}');

fs.writeFileSync('src/components/MinimalUI.tsx', code);
