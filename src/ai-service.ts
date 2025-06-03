import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CommandTranslationResult {
  command: string;
  explanation?: string;
}

export class AiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    console.log('[DEBUG] Initializing Gemini AI service...');
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' });
  }

  async translateCommand(userInput: string): Promise<CommandTranslationResult | null> {
    try {
      console.log(`[DEBUG] Translating command via AI: "${userInput}"`);
      
      const systemPrompt = this.createSystemPrompt();
      const prompt = `${systemPrompt}\n\nUser input: "${userInput}"`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log(`[DEBUG] AI raw response: ${text}`);

      return this.parseAiResponse(text);
    } catch (error: any) {
      // Show full error details for debugging
      console.error('[DEBUG] AI service full error:', error);
      
      // Also show a more user-friendly summary
      if (error?.status === 400 && error?.errorDetails?.[0]?.reason === 'API_KEY_INVALID') {
        console.log('[DEBUG] Summary: API key is invalid');
      } else if (error?.status) {
        console.log(`[DEBUG] Summary: HTTP ${error.status} error`);
      } else {
        console.log('[DEBUG] Summary: Unknown AI service error');
      }
      return null;
    }
  }

  private createSystemPrompt(): string {
    const osInfo = process.platform === 'darwin' ? 'macOS' : process.platform;
    
    return `You are a command-line assistant that translates natural language requests into shell commands for ${osInfo}.

IMPORTANT INSTRUCTIONS:
1. You MUST respond ONLY with valid JSON in this exact format: {"command": "<shell_command>"}
2. Do NOT include any explanations, markdown, or additional text
3. The command should be a single line that can be executed directly in the shell
4. Focus on common operations like file management, directory navigation, system information, etc.
5. If the request is unclear or potentially dangerous, return: {"command": "echo 'I cannot safely interpret that command. Please be more specific.'"}

Examples:
- "list files" → {"command": "ls -la"}
- "show current directory" → {"command": "pwd"}
- "find files with txt extension" → {"command": "find . -name '*.txt'"}
- "check disk space" → {"command": "df -h"}
- "show running processes" → {"command": "ps aux"}

Remember: Respond with JSON only, no other text.`;
  }

  private parseAiResponse(responseText: string): CommandTranslationResult | null {
    try {
      // Clean up the response - remove any markdown code blocks or extra text
      let jsonText = responseText.trim();
      
      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Parse the cleaned JSON text directly
      const parsed = JSON.parse(jsonText);
      
      if (parsed.command) {
        console.log(`[DEBUG] Parsed command: ${parsed.command}`);
        return {
          command: parsed.command,
          explanation: parsed.explanation
        };
      } else {
        console.log('[DEBUG] No command found in AI response');
        return null;
      }
    } catch (error) {
      console.error('[DEBUG] Error parsing AI response:', error);
      console.error('[DEBUG] Raw response was:', responseText);
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('[DEBUG] Testing AI connection...');
      const result = await this.translateCommand('say hello');
      return result !== null;
    } catch (error) {
      // Show full error for debugging
      console.error('[DEBUG] AI connection test full error:', error);
      console.log('[DEBUG] AI connection test failed - this is usually due to an invalid API key');
      return false;
    }
  }
}       