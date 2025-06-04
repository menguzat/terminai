import { spawn, ChildProcessWithoutNullStreams, execSync, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './config';
import { AiService } from './ai-service';

export class TerminaiShell {
  private shellProcess: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private currentDirectory: string = process.cwd();
  private configManager: ConfigManager;
  private aiService: AiService | null = null;
  private historyFile: string;
  private currentRunningProcess: ChildProcess | null = null; // Track running process for signal handling
  
  constructor() {
    this.configManager = new ConfigManager();
    this.historyFile = path.join(os.homedir(), '.terminai', 'history');
  }
  
  async start(): Promise<void> {
   // console.log('[DEBUG] TerminaiShell starting...');
    
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
    
    // Load command history from file
    this.loadHistory();
    
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
      
      // Handle Ctrl+C - improved signal handling
      this.rl!.on('SIGINT', () => {
        if (this.currentRunningProcess) {
          // Kill the running command instead of exiting terminai
          console.log('\n🛑 Interrupting running command...');
          this.currentRunningProcess.kill('SIGINT');
          this.currentRunningProcess = null;
          console.log('✅ Command interrupted. Press Enter to continue.');
          // Don't resolve - just continue to next prompt
        } else {
          // No command running, exit terminai
          console.log('\n👋 Goodbye!');
          this.cleanup();
          resolve();
        }
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
  
  /**
   * Detects the appropriate shell for the current platform
   * @returns Object containing shell executable path and arguments array
   */
  private getShellConfig(): { shell: string; args: string[] } {
    const platform = process.platform;
    
    switch (platform) {
      case 'win32':
        // Windows: Check for PowerShell first, then fallback to cmd.exe
        const comSpec = process.env.ComSpec || 'cmd.exe';
        
        // Check if PowerShell is available and preferred
        if (process.env.SHELL && process.env.SHELL.toLowerCase().includes('powershell')) {
          return {
            shell: 'powershell.exe',
            args: ['-Command']
          };
        }
        
        // Default to cmd.exe on Windows
        return {
          shell: comSpec,
          args: ['/c']
        };
        
      case 'darwin':
      case 'linux':
        // Unix-like systems: Use SHELL environment variable or sensible defaults
        const userShell = process.env.SHELL;
        
        if (userShell) {
          return {
            shell: userShell,
            args: ['-c']
          };
        }
        
        // Fallback hierarchy for Unix systems
        const fallbackShells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
        for (const shell of fallbackShells) {
          try {
            // Check if shell exists using fs.access
            fs.accessSync(shell, fs.constants.F_OK);
            return {
              shell: shell,
              args: ['-c']
            };
          } catch {
            // Shell doesn't exist, try next one
            continue;
          }
        }
        
        // Ultimate fallback
        return {
          shell: '/bin/sh',
          args: ['-c']
        };
        
      default:
        // Unknown platform, try to use environment shell or fallback
        return {
          shell: process.env.SHELL || '/bin/sh',
          args: ['-c']
        };
    }
  }
  
  private async executeCommand(command: string, skipAiTranslation: boolean = false, originalPrompt?: string): Promise<void> {
    return new Promise((resolve) => {
     // console.log(`[DEBUG] Executing command: ${command}`);
      
      // Handle cd command specially to maintain directory state
      if (command.startsWith('cd ')) {
        this.handleCdCommand(command);
        resolve();
        return;
      }
      
      // Get platform-appropriate shell configuration
      const shellConfig = this.getShellConfig();
      
      // For other commands, spawn a new shell process
      // Fix 1: Use 'inherit' for stdin to allow interactive commands
      const shellProcess = spawn(shellConfig.shell, [...shellConfig.args, command], {
        cwd: this.currentDirectory,
        stdio: ['inherit', 'pipe', 'pipe'] // Allow interactive input while capturing output
      });
      
      // Fix 2: Track the running process for signal handling
      this.currentRunningProcess = shellProcess;
      
      let hasOutput = false;
      let errorOutput = '';
      
      // Handle stdout
      shellProcess.stdout.on('data', (data) => {
        hasOutput = true;
        process.stdout.write(data);
      });
      
      // Handle stderr
      shellProcess.stderr.on('data', (data) => {
        hasOutput = true;
        errorOutput += data.toString();
        process.stderr.write(data);
      });
      
      // Handle process completion
      shellProcess.on('close', async (code) => {
        // Clear the running process reference
        this.currentRunningProcess = null;
        
        if (code === 0) {
       //   console.log(`[DEBUG] Command completed successfully (exit code: ${code})`);
        } else {
         // console.log(`[DEBUG] Command failed (exit code: ${code})`);
          
          // Phase 4: AI Command Translation Implementation
          // Only attempt AI translation if not already an AI-suggested command
          if (this.aiService && !skipAiTranslation) {
            console.log('🤖 Command failed. Attempting AI translation...');
            await this.handleFailedCommand(command);
          } else if (skipAiTranslation && originalPrompt) {
            console.log('❌ AI-suggested command also failed');
            // Offer to ask AI to fix the failed command
            await this.handleFailedAiCommand(originalPrompt, command, errorOutput, code || 1);
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
        // Clear the running process reference on error
        this.currentRunningProcess = null;
        console.error(`[DEBUG] Shell process error: ${error.message}`);
        resolve();
      });
      
      // Handle process termination (e.g., from SIGINT)
      shellProcess.on('exit', (code, signal) => {
        // Clear the running process reference
        this.currentRunningProcess = null;
        
        if (signal === 'SIGINT') {
          console.log(`[DEBUG] Command was interrupted by user (signal: ${signal})`);
        }
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
      //console.log(`[DEBUG] Changed directory to: ${this.currentDirectory}`);
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
        
        // Add both commands to history before execution
        // Add the original prompt first, then the AI command (so AI command is most recent)
        this.addToHistory(originalCommand);
        this.addToHistory(translation.command);
        
        await this.executeCommand(translation.command, true, originalCommand);
      } else {
        console.log('❌ Command execution cancelled by user');
      }
    } catch (error) {
      console.error('[DEBUG] Error in AI command translation:', error);
      console.log('❌ Failed to get AI translation');
    }
  }

  private async handleFailedAiCommand(originalPrompt: string, failedCommand: string, errorOutput: string, exitCode: number): Promise<void> {
    try {
      console.log('🔧 The AI-suggested command failed. Would you like AI to try fixing it?');
      
      const userWantsFix = await this.askUserConfirmation('🤔 Ask AI to fix the command? (y/N): ');
      
      if (!userWantsFix) {
        return;
      }
      
      console.log('🔄 Asking AI to fix the failed command...');
      
      // Create a detailed prompt with context
      const fixPrompt = `The user originally asked: "${originalPrompt}"
      
You previously suggested this command: ${failedCommand}

But it failed with exit code ${exitCode} and this error output:
${errorOutput.trim()}

Please provide a corrected command that addresses the error and fulfills the user's original request.`;

      const translation = await this.aiService!.translateCommand(fixPrompt);
      
      if (!translation || !translation.command) {
        console.log('❌ AI could not provide a fix for the command');
        return;
      }

      console.log(`💡 AI suggests a fix: ${translation.command}`);
      if (translation.explanation) {
        console.log(`📝 Explanation: ${translation.explanation}`);
      }

      // Ask for user confirmation
      const userConfirmed = await this.askUserConfirmation('❓ Execute this fixed command? (y/N): ');
      
      if (userConfirmed) {
        console.log('✅ Executing AI-fixed command...');
        
        // Add the fixed command to history
        this.addToHistory(translation.command);
        
        // Execute without further AI translation attempts to avoid infinite loops
        await this.executeCommand(translation.command, true);
      } else {
        console.log('❌ Fixed command execution cancelled by user');
      }
    } catch (error) {
      console.error('[DEBUG] Error in AI command fix:', error);
      console.log('❌ Failed to get AI fix');
    }
  }

  private addToHistory(command: string): void {
    if (this.rl) {
      // Add to readline history - this makes it available with up arrow
      // Note: history property exists at runtime but isn't in type definitions
      const readlineWithHistory = this.rl as any;
      if (readlineWithHistory.history) {
        readlineWithHistory.history.unshift(command);
        
        // Limit history size to prevent memory issues
        if (readlineWithHistory.history.length > 1000) {
          readlineWithHistory.history = readlineWithHistory.history.slice(0, 500);
        }
      }
    }
  }

  private async askUserConfirmation(promptText: string = '❓ Execute this command? (y/N): '): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl!.question(promptText, (answer) => {
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
      // Cross-platform PATH handling
      const pathEnvVar = process.platform === 'win32' ? 'PATH' : 'PATH';
      const pathSeparator = process.platform === 'win32' ? ';' : ':';
      const pathValue = process.env[pathEnvVar] || '';
      
      const paths = pathValue.split(pathSeparator).filter(p => p.length > 0);
      const commands: string[] = [];
      
      for (const dirPath of paths) {
        try {
          // Use Node.js fs instead of shell commands for cross-platform compatibility
          if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            
            // Filter for executable files (simplified approach)
            for (const file of files) {
              const fullPath = path.join(dirPath, file);
              try {
                const stats = fs.statSync(fullPath);
                
                // On Windows, check for .exe, .cmd, .bat extensions
                // On Unix, check for executable permissions
                if (process.platform === 'win32') {
                  const ext = path.extname(file).toLowerCase();
                  if (['.exe', '.cmd', '.bat', '.com'].includes(ext)) {
                    commands.push(path.basename(file, ext)); // Remove extension for completion
                  }
                } else {
                  // Unix-like systems: check if file is executable
                  if (stats.isFile() && (stats.mode & parseInt('111', 8))) {
                    commands.push(file);
                  }
                }
              } catch {
                // Skip files that can't be accessed
              }
            }
          }
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
      // Handle different completion cases with cross-platform path separators
      let searchPattern = partial;
      let searchDir = this.currentDirectory;
      
      // Support both / and \ path separators
      const pathSeparator = partial.includes('\\') ? '\\' : '/';
      const lastSeparatorIndex = Math.max(partial.lastIndexOf('/'), partial.lastIndexOf('\\'));
      
      if (lastSeparatorIndex !== -1) {
        const dirPart = partial.substring(0, lastSeparatorIndex + 1);
        searchPattern = partial.substring(lastSeparatorIndex + 1);
        
        // Handle absolute vs relative paths cross-platform
        if (path.isAbsolute(dirPart)) {
          searchDir = dirPart;
        } else {
          searchDir = path.resolve(this.currentDirectory, dirPart);
        }
      }
      
      // Use Node.js fs instead of shell commands for cross-platform compatibility
      try {
        if (!fs.existsSync(searchDir)) {
          return [[], searchPattern];
        }
        
        const entries = fs.readdirSync(searchDir, { withFileTypes: true })
          .filter(entry => {
            // Filter out hidden files on Unix (starting with .), but include them on Windows
            const includeHidden = process.platform === 'win32' || searchPattern.startsWith('.');
            const matchesPattern = entry.name.startsWith(searchPattern);
            const notCurrentOrParent = entry.name !== '.' && entry.name !== '..';
            
            return matchesPattern && notCurrentOrParent && (includeHidden || !entry.name.startsWith('.'));
          })
          .map(entry => {
            // Add appropriate separator for directories
            if (entry.isDirectory()) {
              return entry.name + (process.platform === 'win32' ? '\\' : '/');
            }
            return entry.name;
          });
        
        return [entries, searchPattern];
      } catch (error) {
        // Fallback if directory can't be read
        return [[], searchPattern];
      }
    } catch (error) {
      return [[], partial];
    }
  }
  
  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const historyContent = fs.readFileSync(this.historyFile, 'utf8');
        const historyLines = historyContent.trim().split('\n').filter(line => line.length > 0);
        
        if (this.rl) {
          const readlineWithHistory = this.rl as any;
          if (readlineWithHistory.history) {
            // Load history in reverse order since readline history is LIFO
            readlineWithHistory.history = historyLines.reverse();
          }
        }
      }
    } catch (error) {
      console.error('[DEBUG] Error loading history:', error);
    }
  }

  private saveHistory(): void {
    try {
      if (this.rl) {
        const readlineWithHistory = this.rl as any;
        if (readlineWithHistory.history && readlineWithHistory.history.length > 0) {
          // Ensure the .terminai directory exists
          const historyDir = path.dirname(this.historyFile);
          if (!fs.existsSync(historyDir)) {
            fs.mkdirSync(historyDir, { recursive: true });
          }
          
          // Save history (reverse since readline history is LIFO, but we want FIFO in file)
          const historyToSave = [...readlineWithHistory.history].reverse().slice(0, 1000); // Keep last 1000 commands
          fs.writeFileSync(this.historyFile, historyToSave.join('\n') + '\n');
        }
      }
    } catch (error) {
      console.error('[DEBUG] Error saving history:', error);
    }
  }
  
  private cleanup(): void {
    // Save history before cleanup
    this.saveHistory();
    
    if (this.rl) {
      this.rl.close();
    }
    if (this.shellProcess) {
      this.shellProcess.kill();
    }
  }
} 