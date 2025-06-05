import { GoogleGenerativeAI } from '@google/generative-ai';
import { DirectoryContext } from './shell';

export interface CommandTranslationResult {
  command: string;
  explanation?: string;
}

export class AiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
 //   console.log('[DEBUG] Initializing Gemini AI service...');
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' });
  }

  async translateCommand(userInput: string, directoryContext?: DirectoryContext): Promise<CommandTranslationResult | null> {
    try {
    //  console.log(`[DEBUG] Translating command via AI: "${userInput}"`);
      
      const systemPrompt = this.createSystemPrompt(directoryContext);
      let prompt = `${systemPrompt}\n\nUser input: "${userInput}"`;
      
      // Add directory context to the prompt if available
      if (directoryContext && !directoryContext.error) {
        prompt += `\n\nCurrent directory context:\n`;
        prompt += `Working directory: ${directoryContext.currentDirectory}\n`;
        prompt += `Directory contents:\n${directoryContext.contents}`;
        
        // Add environment information if available
        if (directoryContext.environment) {
          prompt += `\n\nDevelopment Environment Context:\n`;
          
          // Python environment info
          if (directoryContext.environment.python?.isVirtualEnv) {
            const pyEnv = directoryContext.environment.python;
            prompt += `- Python Virtual Environment: ACTIVE (${pyEnv.envType}`;
            if (pyEnv.envName) prompt += ` - ${pyEnv.envName}`;
            prompt += `)\n`;
          } else if (directoryContext.environment.python?.envName) {
            prompt += `- Python Virtual Environment: Available but not active (${directoryContext.environment.python.envName})\n`;
          }
          
          // Node.js environment info
          if (directoryContext.environment.node?.hasPackageJson) {
            const nodeEnv = directoryContext.environment.node;
            prompt += `- Node.js Project: Detected`;
            if (nodeEnv.packageManager) prompt += ` (${nodeEnv.packageManager})`;
            if (nodeEnv.hasNodeModules) prompt += ` with node_modules installed`;
            prompt += `\n`;
          }
          
          // Git repository info
          if (directoryContext.environment.git?.isGitRepo) {
            const gitEnv = directoryContext.environment.git;
            prompt += `- Git Repository: Active`;
            if (gitEnv.branch) prompt += ` (branch: ${gitEnv.branch})`;
            prompt += `\n`;
          }
          
          // Docker environment info
          const dockerEnv = directoryContext.environment.docker;
          if (dockerEnv?.hasDockerfile || dockerEnv?.hasDockerCompose) {
            prompt += `- Docker: Detected (`;
            const dockerFeatures = [];
            if (dockerEnv.hasDockerfile) dockerFeatures.push('Dockerfile');
            if (dockerEnv.hasDockerCompose) dockerFeatures.push('Docker Compose');
            prompt += dockerFeatures.join(', ') + `)\n`;
          }
          
          // Other language environments
          const otherEnv = directoryContext.environment.other;
          if (otherEnv?.hasGemfile) prompt += `- Ruby Project: Detected (Gemfile)\n`;
          if (otherEnv?.hasCargoToml) prompt += `- Rust Project: Detected (Cargo.toml)\n`;
          if (otherEnv?.hasGoMod) prompt += `- Go Project: Detected (go.mod)\n`;
        }
      } else if (directoryContext?.error) {
        prompt += `\n\nNote: Could not get directory context - ${directoryContext.error}`;
      }

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

     // console.log(`[DEBUG] AI raw response: ${text}`);

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

  private createSystemPrompt(directoryContext?: DirectoryContext): string {
    const osInfo = process.platform === 'darwin' ? 'macOS' : process.platform;
    
    let contextInstructions = '';
    if (directoryContext && !directoryContext.error) {
      contextInstructions = `

DIRECTORY CONTEXT AVAILABLE:
You have been provided with the current working directory and its contents. Use this information to:
- Reference actual files and directories that exist in the current location
- Suggest commands that work with the specific files present
- Provide more accurate file paths and operations
- Understand the project structure and context (e.g., if package.json exists, assume Node.js project)
- Make suggestions that are relevant to the current directory's content
- When users ask to "copy", "move", "delete", or "edit" files, prioritize actual filenames from the directory listing
- Detect file types and suggest appropriate commands (e.g., if .js files are present, suggest Node.js related commands)
- Use relative paths when files are in the current directory instead of absolute paths

VIRTUAL ENVIRONMENT & DEVELOPMENT CONTEXT:
You are also provided with development environment information. Use this to:
- For Python: If a virtual environment is ACTIVE, use commands that work within that environment (python, pip, etc.)
- For Python: If a virtual environment is available but not active, suggest activating it first when relevant
- For Node.js: Use the detected package manager (npm, yarn, pnpm) for dependency commands
- For Git: Include branch information in git-related suggestions and be aware of repository status
- For Docker: Suggest docker commands when Dockerfile or docker-compose files are present
- For language-specific projects: Use appropriate commands for the detected language/framework

CONTEXT-AWARE EXAMPLES:
If directory contains "package.json" and user asks "install dependencies" → suggest "npm install"
If directory contains "video.mp4" and user asks "extract audio" → suggest "ffmpeg -i video.mp4 -vn -acodec libmp3lame audio.mp3"
If directory contains "app.py" and user asks "run the app" → suggest "python app.py" or "python3 app.py"
If user asks "list typescript files" and .ts files exist → suggest "ls *.ts" or reference actual .ts filenames
If user asks "copy the config file" and config.json exists → suggest "cp config.json config.json.bak"
If Python virtual environment is ACTIVE and user asks "install pandas" → suggest "pip install pandas"
If Python virtual environment exists but not active and user asks "install pandas" → suggest "source venv/bin/activate && pip install pandas" (or appropriate activation for detected env type)
If Node.js project with yarn detected and user asks "add dependency" → suggest "yarn add <package>"
If Git repository on 'main' branch and user asks "create feature branch" → suggest "git checkout -b feature/branch-name"

Always prefer using actual file names and paths from the directory context when they match the user's intent.`;
    }
    
    return `You are a highly precise command-line assistant that translates natural language requests into shell commands specifically for **${osInfo}**. Your primary goal is to generate the *exact* command that best and most safely fulfills the user's intention on this operating system, including interactions with common command-line interface (CLI) tools.${contextInstructions}

IMPORTANT INSTRUCTIONS:
1.  You MUST respond ONLY with valid JSON in this exact format: \`{"command": "<shell_command>"}\`
2.  Do NOT include any explanations, markdown, or additional text.
3.  The command MUST be a single line, syntactically correct, and directly executable in the default shell of **${osInfo}**.
4.  The command MUST be the most common, direct, and safest way to achieve the user's stated intention on **${osInfo}**. Prioritize commands that are standard and widely available, or common flags for well-known CLIs.
5.  Carefully analyze the user's request to understand their specific goal. Ensure the generated command and its options precisely match this goal. For example, if a user asks to "find text in files," differentiate between searching filenames and searching file content.
6.  Avoid commands with destructive potential (e.g., \`rm\` without specific, safe targeting, \`git reset --hard\`, \`ffmpeg\` overwriting files without explicit backup flags if not implied by the request like "convert") unless the user's intent is explicitly and unambiguously to perform such an operation on user-specified, non-critical targets.
7.  Focus on common operations including, but not limited to:
    *   **File and Directory Management:** \`ls\`, \`cd\`, \`pwd\`, \`mkdir\`, \`rmdir\`, \`cp\`, \`mv\`, \`touch\`, \`cat\`, \`head\`, \`tail\`, \`grep\`, \`find\`.
    *   **System Information:** \`df\`, \`du\`, \`free\`, \`uname\`, \`ps\`, \`top\`/\`htop\` (or OS-equivalent).
    *   **Permissions:** \`chmod\`, \`chown\` (use with caution and precision).
    *   **Archiving/Compression:** \`tar\`, \`zip\`, \`unzip\`, \`gzip\`, \`gunzip\`.
    *   **Version Control (e.g., Git):** \`git status\`, \`git add\`, \`git commit\`, \`git push\`, \`git pull\`, \`git branch\`, \`git checkout\`, \`git log\`, \`git clone\`. Assume the user is in a git repository context if the command implies it.
    *   **Media Manipulation (e.g., FFmpeg):** Common conversions, audio extraction, resizing. Prioritize simple, common use cases. For complex \`ffmpeg\` operations, if ambiguity exists, it's safer to ask for clarification.
8.  If the request is unclear, ambiguous, could have multiple valid interpretations leading to different commands, is too complex for a single, safe command line (especially for tools like \`ffmpeg\` or \`git\` where many options can interact), or is potentially dangerous (e.g., requests involving \`rm -rf /\`, modifying critical system files without explicit safeguards, or commands that could lead to unintended data loss), you MUST return: \`{"command": "echo 'I cannot safely or accurately interpret that command. Please be more specific, simplify your request, or rephrase it.'\"}\`. **When in doubt, err on the side of caution and clarity.**

Examples (these are general; adapt to the specific shell conventions of ${osInfo} if it implies a different shell, e.g., PowerShell on Windows):

**General Shell Commands:**
- "list all files including hidden ones in the current directory, with details" → \`{"command": "ls -la"}\`
- "show my current working directory path" → \`{"command": "pwd"}\`
- "find all files exactly named 'report.txt' starting from the current user's home directory" → \`{"command": "find ~ -type f -name 'report.txt'"}\`
- "check free disk space on all mounted filesystems in human-readable format" → \`{"command": "df -h"}\`
- "show all currently running processes with user and cpu/memory usage" → \`{"command": "ps aux"}\` (or \`Get-Process\` for PowerShell)
- "create a new directory named 'my_documents' in the current location" → \`{"command": "mkdir my_documents"}\`
- "delete a single file named 'temporary_notes.txt' in the current directory" → \`{"command": "rm temporary_notes.txt"}\`
- "search for the exact phrase 'error code 123' in all log files within the /var/log directory" → \`{"command": "grep -r 'error code 123' /var/log"}\`

**Git Examples:**
- "show git status" → \`{"command": "git status"}\`
- "add all new and modified files to git staging" → \`{"command": "git add ."}\`
- "add the file 'README.md' to git staging" → \`{"command": "git add README.md"}\`
- "pull the latest changes from the remote repository" → \`{"command": "git pull"}\`
- "push my committed changes to the remote repository" → \`{"command": "git push"}\`
- "list all local git branches" → \`{"command": "git branch"}\`
- "switch to the git branch named 'develop'" → \`{"command": "git checkout develop"}\`
- "clone the repository from https://github.com/example/myproject.git" → \`{"command": "git clone https://github.com/example/myproject.git"}\`

**FFmpeg Examples:**
- "convert input.mp4 to output.avi" → \`{"command": "ffmpeg -i input.mp4 output.avi"}\`
- "extract the audio from video.mkv into audio.mp3" → \`{"command": "ffmpeg -i video.mkv -vn -acodec libmp3lame audio.mp3"}\` (Note: be mindful of common codec choices)
- "change the resolution of my_clip.mov to 640x480 and save as small_clip.mov" → \`{"command": "ffmpeg -i my_clip.mov -vf scale=640:480 small_clip.mov"}\`
- "convert my_animation.gif to a webp file named animation.webp" → \`{"command": "ffmpeg -i my_animation.gif animation.webp"}\`
- "cut the first 10 seconds from video.mp4 and save as intro.mp4" → \`{"command": "ffmpeg -i video.mp4 -ss 00:00:00 -t 00:00:10 -c copy intro.mp4"}\`


Remember: Respond with JSON only, no other text. The command's accuracy for **${osInfo}**, its adherence to common practices for the specified CLI tools, and precise fulfillment of the user's intent are paramount.`;
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
       // console.log(`[DEBUG] Parsed command: ${parsed.command}`);
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