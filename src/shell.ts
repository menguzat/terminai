import { spawn, ChildProcessWithoutNullStreams, execSync } from 'child_process';
import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from './config';
import { AiService } from './ai-service';

export class TerminaiShell {
  private shellProcess: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private currentDirectory: string = process.cwd();
  private configManager: ConfigManager;
  private aiService: AiService | null = null;
  
  constructor() {
    this.configManager = new ConfigManager();
  }
  
  async start(): Promise<void> {
    console.log('[DEBUG] TerminaiShell starting...');
    
    // Initialize AI service with API key BEFORE setting up readline interface
    try {
      const apiKey = await this.configManager.ensureGeminiApiKey();
      this.aiService = new AiService(apiKey);
      
      // Test AI connection
      // const connectionOk = await this.aiService.testConnection();
      // if (connectionOk) {
      //   console.log('✅ AI service connected successfully!');
      // } else {
      //   console.log('⚠️  AI service connection failed - this usually means the API key is invalid.');
      //   console.log('💡 You can get a valid API key from: https://makersuite.google.com/app/apikey');
      //   console.log('🔄 To update your API key, run: rm ~/.terminai/config.json && terminai');
      //   this.aiService = null; // Disable AI features for this session
      // }
    } catch (error) {
      console.error('❌ Failed to initialize AI service:', error);
      console.log('⚠️  Continuing without AI features...');
      this.aiService = null;
    }
    
    // NOW initialize readline interface after API key setup is complete
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: this.completer.bind(this)
    });
    
    // Start the interactive loop
    this.showWelcome();
    await this.startInteractiveLoop();
  }
  
  private showWelcome(): void {
    console.log('✅ Terminai shell is ready!');
    if (this.aiService) {
      console.log('🤖 AI-powered command translation is active');
      console.log('💡 Type commands as usual, or use natural language for complex operations');
    } else {
      console.log('💡 Type commands as usual (AI features temporarily unavailable)');
    }
    console.log('🚪 Type "exit" or press Ctrl+C to quit\n');
  }
  
  private async startInteractiveLoop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const promptUser = () => {
        const prompt = this.createPrompt();
        this.rl!.question(prompt, async (input) => {
          const trimmedInput = input.trim();
          
          if (trimmedInput === 'exit' || trimmedInput === 'quit') {
            console.log('👋 Goodbye!');
            this.cleanup();
            resolve();
            return;
          }
          
          if (trimmedInput === '') {
            promptUser();
            return;
          }
          
          try {
            await this.executeCommand(trimmedInput);
          } catch (error) {
            console.error('[DEBUG] Command execution error:', error);
          }
          
          promptUser();
        });
      };
      
      // Handle Ctrl+C
      this.rl!.on('SIGINT', () => {
        console.log('\n👋 Goodbye!');
        this.cleanup();
        resolve();
      });
      
      promptUser();
    });
  }
  
  private createPrompt(): string {
    const username = os.userInfo().username;
    const hostname = os.hostname();
    const currentDir = path.basename(this.currentDirectory);
    
    return `[AI] ${username}@${hostname} ${currentDir} % `;
  }
  
  private async executeCommand(command: string, skipAiTranslation: boolean = false): Promise<void> {
    return new Promise((resolve) => {
     // console.log(`[DEBUG] Executing command: ${command}`);
      
      // Handle cd command specially to maintain directory state
      if (command.startsWith('cd ')) {
        this.handleCdCommand(command);
        resolve();
        return;
      }
      
      // For other commands, spawn a new shell process
      const shellProcess = spawn('/bin/zsh', ['-c', command], {
        cwd: this.currentDirectory,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let hasOutput = false;
      
      // Handle stdout
      shellProcess.stdout.on('data', (data) => {
        hasOutput = true;
        process.stdout.write(data);
      });
      
      // Handle stderr
      shellProcess.stderr.on('data', (data) => {
        hasOutput = true;
        process.stderr.write(data);
      });
      
      // Handle process completion
      shellProcess.on('close', async (code) => {
        if (code === 0) {
       //   console.log(`[DEBUG] Command completed successfully (exit code: ${code})`);
        } else {
          console.log(`[DEBUG] Command failed (exit code: ${code})`);
          
          // Phase 4: AI Command Translation Implementation
          // Only attempt AI translation if not already an AI-suggested command
          if (this.aiService && !skipAiTranslation) {
            console.log('🤖 Command failed. Attempting AI translation...');
            await this.handleFailedCommand(command);
          } else if (skipAiTranslation) {
            console.log('❌ AI-suggested command also failed');
          } else {
            console.log('❌ Command failed and AI service is not available');
          }
        }
        
        if (!hasOutput) {
          console.log('[DEBUG] Command completed with no output');
        }
        
        resolve();
      });
      
      shellProcess.on('error', (error) => {
        console.error(`[DEBUG] Shell process error: ${error.message}`);
        resolve();
      });
    });
  }
  
  private handleCdCommand(command: string): void {
    const parts = command.split(' ');
    let targetDir = parts[1] || os.homedir();
    
    // Handle relative paths
    if (!path.isAbsolute(targetDir)) {
      targetDir = path.resolve(this.currentDirectory, targetDir);
    }
    
    try {
      process.chdir(targetDir);
      this.currentDirectory = process.cwd();
      console.log(`[DEBUG] Changed directory to: ${this.currentDirectory}`);
    } catch (error) {
      console.error(`cd: no such file or directory: ${targetDir}`);
    }
  }
  
  private async handleFailedCommand(originalCommand: string): Promise<void> {
    try {
      console.log('🔄 Asking AI to translate the command...');
      
      const translation = await this.aiService!.translateCommand(originalCommand);
      
      if (!translation || !translation.command) {
        console.log('❌ AI could not translate the command');
        return;
      }

      console.log(`💡 AI suggests: ${translation.command}`);
      if (translation.explanation) {
        console.log(`📝 Explanation: ${translation.explanation}`);
      }

      // Ask for user confirmation
      const userConfirmed = await this.askUserConfirmation();
      
      if (userConfirmed) {
        console.log('✅ Executing AI-suggested command...');
        await this.executeCommand(translation.command, true);
      } else {
        console.log('❌ Command execution cancelled by user');
      }
    } catch (error) {
      console.error('[DEBUG] Error in AI command translation:', error);
      console.log('❌ Failed to get AI translation');
    }
  }

  private async askUserConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl!.question('❓ Execute this command? (y/N): ', (answer) => {
        const response = answer.trim().toLowerCase();
        resolve(response === 'y' || response === 'yes');
      });
    });
  }
  
  private completer(line: string): [string[], string] {
    try {
      // Parse the command line to determine what we're completing
      const parts = line.split(' ');
      const lastPart = parts[parts.length - 1];
      
      if (parts.length === 1) {
        // Completing a command - use PATH lookup
        const pathCommands = this.getPathCommands();
        const basicCommands = ['ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'find', 'exit'];
        const allCommands = [...new Set([...basicCommands, ...pathCommands])];
        const hits = allCommands.filter(cmd => cmd.startsWith(lastPart));
        return [hits, lastPart];
      } else {
        // Completing a file/directory - use file system
        return this.getFileCompletions(lastPart);
      }
    } catch (error) {
      // Fallback to basic completion
      const basicCompletions = ['ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'find', 'exit'];
      const hits = basicCompletions.filter((c) => c.startsWith(line));
      return [hits.length ? hits : basicCompletions, line];
    }
  }

  private getPathCommands(): string[] {
    try {
      const pathOutput = execSync('echo $PATH', { 
        encoding: 'utf8',
        cwd: this.currentDirectory 
      });
      const paths = pathOutput.trim().split(':');
      const commands: string[] = [];
      
      for (const dirPath of paths) {
        try {
          const commandsInDir = execSync(`ls "${dirPath}" 2>/dev/null || true`, { 
            encoding: 'utf8',
            cwd: this.currentDirectory 
          });
          commands.push(...commandsInDir.trim().split('\n').filter(cmd => cmd.length > 0));
        } catch {
          // Skip directories that can't be read
        }
      }
      
      return [...new Set(commands)].slice(0, 50); // Limit to avoid overwhelming
    } catch {
      return [];
    }
  }

  private getFileCompletions(partial: string): [string[], string] {
    try {
      // Handle different completion cases
      let searchPattern = partial;
      let searchDir = this.currentDirectory;
      
      // If partial contains a path separator, extract directory part
      if (partial.includes('/')) {
        const lastSlash = partial.lastIndexOf('/');
        const dirPart = partial.substring(0, lastSlash + 1);
        searchPattern = partial.substring(lastSlash + 1);
        
        if (dirPart.startsWith('/')) {
          searchDir = dirPart;
        } else {
          searchDir = path.resolve(this.currentDirectory, dirPart);
        }
      }
      
      // Get files and directories
      const lsOutput = execSync(`ls -1a "${searchDir}" 2>/dev/null || true`, { 
        encoding: 'utf8' 
      });
      
      const entries = lsOutput.trim().split('\n').filter(entry => 
        entry.length > 0 && 
        entry !== '.' && 
        entry !== '..' &&
        entry.startsWith(searchPattern)
      );
      
      // Add directory separator for directories
      const completions = entries.map(entry => {
        const fullPath = path.join(searchDir, entry);
        try {
          const stats = execSync(`test -d "${fullPath}" && echo "dir" || echo "file"`, { 
            encoding: 'utf8' 
          });
          return stats.trim() === 'dir' ? entry + '/' : entry;
        } catch {
          return entry;
        }
      });
      
      return [completions, searchPattern];
    } catch (error) {
      return [[], partial];
    }
  }
  
  private cleanup(): void {
    if (this.rl) {
      this.rl.close();
    }
    if (this.shellProcess) {
      this.shellProcess.kill();
    }
  }
} 