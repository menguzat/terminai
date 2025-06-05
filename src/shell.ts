import { spawn, ChildProcessWithoutNullStreams, execSync, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './config';
import { AiService } from './ai-service';

export interface DirectoryContext {
  currentDirectory: string;
  contents: string;
  error?: string;
  environment?: {
    python?: {
      isVirtualEnv: boolean;
      envType?: 'venv' | 'virtualenv' | 'conda' | 'poetry' | 'pipenv';
      envName?: string;
      envPath?: string;
    };
    node?: {
      hasNodeModules: boolean;
      packageManager?: 'npm' | 'yarn' | 'pnpm';
      hasPackageJson: boolean;
    };
    git?: {
      isGitRepo: boolean;
      branch?: string;
    };
    docker?: {
      hasDockerfile: boolean;
      hasDockerCompose: boolean;
    };
    other?: {
      hasGemfile: boolean; // Ruby
      hasCargoToml: boolean; // Rust
      hasGoMod: boolean; // Go
    };
  };
}

export class TerminaiShell {
  private shellProcess: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private currentDirectory: string = process.cwd();
  private configManager: ConfigManager;
  private aiService: AiService | null = null;
  private historyFile: string;
  private currentRunningProcess: ChildProcess | null = null; // Track running process for signal handling
  private aiSuggestionContext: { originalCommand: string; isAiSuggestion: boolean } | null = null; // Track AI suggestion context
  
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
            // Clear AI suggestion context if user just pressed enter with empty input
            this.aiSuggestionContext = null;
            promptUser();
            return;
          }
          
          try {
            // Check if this is an AI-suggested command
            if (this.aiSuggestionContext && this.aiSuggestionContext.isAiSuggestion) {
              // Execute as AI-suggested command with original context
              await this.executeCommand(trimmedInput, true, this.aiSuggestionContext.originalCommand);
              // Clear the context after execution
              this.aiSuggestionContext = null;
            } else {
              // Execute as regular user command
              await this.executeCommand(trimmedInput);
            }
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
          // Clear any AI suggestion context
          if (this.aiSuggestionContext) {
            console.log('\n❌ AI suggestion cancelled.');
            this.aiSuggestionContext = null;
            
            // Clear the prefilled text by accessing the internal line buffer
            if (this.rl) {
              // Clear the internal line buffer - this accesses readline internals
              const readlineWithInternals = this.rl as any;
              if (readlineWithInternals.line !== undefined) {
                readlineWithInternals.line = '';
                readlineWithInternals.cursor = 0;
                readlineWithInternals._refreshLine();
              }
            }
            
            promptUser(); // Start a new prompt
          } else {
            // No command running, exit terminai
            console.log('\n👋 Goodbye!');
            this.cleanup();
            resolve();
          }
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
  
  /**
   * Gets directory context including current directory path and contents
   * Works cross-platform with appropriate directory listing commands
   * @returns DirectoryContext object with directory info and contents
   */
  private async getDirectoryContext(): Promise<DirectoryContext> {
    const context: DirectoryContext = {
      currentDirectory: this.currentDirectory,
      contents: '',
      error: undefined
    };

    try {
      // Get platform-appropriate directory listing command
      const platform = process.platform;
      let listCommand: string;

      switch (platform) {
        case 'win32':
          // Check if we're using PowerShell or CMD
          const shellConfig = this.getShellConfig();
          if (shellConfig.shell.toLowerCase().includes('powershell')) {
            listCommand = 'Get-ChildItem -Force | Format-Table -AutoSize';
          } else {
            listCommand = 'dir /a';
          }
          break;
        
        case 'darwin':
        case 'linux':
        default:
          listCommand = 'ls -al';
          break;
      }

      // Execute the directory listing command
      const output = execSync(listCommand, {
        cwd: this.currentDirectory,
        encoding: 'utf8',
        timeout: 5000, // 5 second timeout to prevent hanging
        maxBuffer: 1024 * 1024 // 1MB max buffer to prevent memory issues
      });

      context.contents = output.toString().trim();
      
      // console.log(`[DEBUG] Directory context gathered for: ${context.currentDirectory}`);
      // console.log(`[DEBUG] Directory contents length: ${context.contents.length} chars`);
      
    } catch (error: any) {
      context.error = `Failed to get directory contents: ${error.message}`;
      console.log(`[DEBUG] Error getting directory context: ${error.message}`);
      
      // Fallback: try to get at least basic file listing using Node.js fs
      try {
        const files = fs.readdirSync(this.currentDirectory);
        context.contents = `Files in directory:\n${files.join('\n')}`;
        context.error = undefined; // Clear error since we got fallback data
      } catch (fallbackError: any) {
        context.error = `Could not access directory: ${fallbackError.message}`;
      }
    }

    // Detect development environments
    try {
      context.environment = await this.detectEnvironments();
    } catch (envError: any) {
      console.log(`[DEBUG] Error detecting environments: ${envError.message}`);
    }

    return context;
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
      
      // Gather directory context for better AI suggestions
      const directoryContext = await this.getDirectoryContext();
      
      const translation = await this.aiService!.translateCommand(originalCommand, directoryContext);
      
      if (!translation || !translation.command) {
        console.log('❌ AI could not translate the command');
        return;
      }

      console.log(`💡 AI suggests: ${translation.command}`);
      if (translation.explanation) {
        console.log(`📝 Explanation: ${translation.explanation}`);
      }
      console.log('✏️  You can edit the command below and press Enter to execute, or Ctrl+C to cancel:');

      // Add the original command to history
      this.addToHistory(originalCommand);
      
      // Set AI suggestion context so the next command is treated as AI-suggested
      this.aiSuggestionContext = {
        originalCommand: originalCommand,
        isAiSuggestion: true
      };
      
      // Prefill the AI-suggested command into the readline interface
      if (this.rl) {
        this.rl.write(translation.command);
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
      
      // Gather directory context for better AI fix suggestions  
      const directoryContext = await this.getDirectoryContext();
      
      // Create a detailed prompt with context
      const fixPrompt = `The user originally asked: "${originalPrompt}"
      
You previously suggested this command: ${failedCommand}

But it failed with exit code ${exitCode} and this error output:
${errorOutput.trim()}

Please provide a corrected command that addresses the error and fulfills the user's original request.`;

      const translation = await this.aiService!.translateCommand(fixPrompt, directoryContext);
      
      if (!translation || !translation.command) {
        console.log('❌ AI could not provide a fix for the command');
        return;
      }

      console.log(`💡 AI suggests a fix: ${translation.command}`);
      if (translation.explanation) {
        console.log(`📝 Explanation: ${translation.explanation}`);
      }
      console.log('✏️  You can edit the fixed command below and press Enter to execute, or Ctrl+C to cancel:');

      // Set AI suggestion context so the next command is treated as AI-suggested
      // Keep the original command context for proper tracking
      this.aiSuggestionContext = {
        originalCommand: originalPrompt,
        isAiSuggestion: true
      };

      // Prefill the AI-fixed command into the readline interface
      if (this.rl) {
        this.rl.write(translation.command);
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

  /**
   * Detects various development environments and virtual environments
   * @returns Environment detection results
   */
  private async detectEnvironments(): Promise<DirectoryContext['environment']> {
    const environment: NonNullable<DirectoryContext['environment']> = {};

    try {
      // Get list of files and directories in current directory
      const items = fs.readdirSync(this.currentDirectory);
      const files = new Set(items);

      // Python environment detection
      environment.python = this.detectPythonEnvironment(files);

      // Node.js environment detection  
      environment.node = this.detectNodeEnvironment(files);

      // Git repository detection
      environment.git = await this.detectGitEnvironment();

      // Docker environment detection
      environment.docker = this.detectDockerEnvironment(files);

      // Other language environments
      environment.other = this.detectOtherEnvironments(files);

    } catch (error: any) {
      console.log(`[DEBUG] Error in environment detection: ${error.message}`);
    }

    return environment;
  }

  private detectPythonEnvironment(files: Set<string>): NonNullable<DirectoryContext['environment']>['python'] {
    const pythonEnv = {
      isVirtualEnv: false,
      envType: undefined as any,
      envName: undefined as string | undefined,
      envPath: undefined as string | undefined
    };

    // Check for virtual environment indicators
    const virtualEnvVar = process.env.VIRTUAL_ENV;
    const condaEnvVar = process.env.CONDA_DEFAULT_ENV;
    const poetryEnvVar = process.env.POETRY_ACTIVE;

    if (virtualEnvVar) {
      pythonEnv.isVirtualEnv = true;
      pythonEnv.envType = 'venv';
      pythonEnv.envPath = virtualEnvVar;
      pythonEnv.envName = path.basename(virtualEnvVar);
    } else if (condaEnvVar) {
      pythonEnv.isVirtualEnv = true;
      pythonEnv.envType = 'conda';
      pythonEnv.envName = condaEnvVar;
    } else if (poetryEnvVar) {
      pythonEnv.isVirtualEnv = true;
      pythonEnv.envType = 'poetry';
    } else if (process.env.PIPENV_ACTIVE) {
      pythonEnv.isVirtualEnv = true;
      pythonEnv.envType = 'pipenv';
    }

    // Check for Python project files
    if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('setup.py') || files.has('Pipfile')) {
      // If we found Python project files but no active virtual env, check for local venv folders
      if (!pythonEnv.isVirtualEnv) {
        const commonVenvNames = ['venv', 'env', '.venv', '.env'];
        for (const venvName of commonVenvNames) {
          if (files.has(venvName)) {
            try {
              const venvPath = path.join(this.currentDirectory, venvName);
              const stats = fs.statSync(venvPath);
              if (stats.isDirectory()) {
                pythonEnv.envName = venvName;
                pythonEnv.envPath = venvPath;
                // Note: not marking as active since it's not currently activated
              }
            } catch {
              // Ignore errors checking venv directories
            }
          }
        }
      }
    }

    return pythonEnv;
  }

  private detectNodeEnvironment(files: Set<string>): NonNullable<DirectoryContext['environment']>['node'] {
    const nodeEnv = {
      hasNodeModules: files.has('node_modules'),
      hasPackageJson: files.has('package.json'),
      packageManager: undefined as any
    };

    // Detect package manager
    if (files.has('yarn.lock')) {
      nodeEnv.packageManager = 'yarn';
    } else if (files.has('pnpm-lock.yaml')) {
      nodeEnv.packageManager = 'pnpm';
    } else if (files.has('package-lock.json') || nodeEnv.hasPackageJson) {
      nodeEnv.packageManager = 'npm';
    }

    return nodeEnv;
  }

  private async detectGitEnvironment(): Promise<NonNullable<DirectoryContext['environment']>['git']> {
    const gitEnv = {
      isGitRepo: false,
      branch: undefined as string | undefined
    };

    try {
      // Check if .git directory exists
      const gitPath = path.join(this.currentDirectory, '.git');
      if (fs.existsSync(gitPath)) {
        gitEnv.isGitRepo = true;

        // Try to get current branch
        try {
          const branchOutput = execSync('git branch --show-current', {
            cwd: this.currentDirectory,
            encoding: 'utf8',
            timeout: 2000
          });
          gitEnv.branch = branchOutput.toString().trim();
        } catch {
          // Fallback: try to read from .git/HEAD
          try {
            const headPath = path.join(gitPath, 'HEAD');
            const headContent = fs.readFileSync(headPath, 'utf8');
            const match = headContent.match(/ref: refs\/heads\/(.+)/);
            if (match) {
              gitEnv.branch = match[1].trim();
            }
          } catch {
            // Unable to determine branch
          }
        }
      }
    } catch (error: any) {
      console.log(`[DEBUG] Error detecting git environment: ${error.message}`);
    }

    return gitEnv;
  }

  private detectDockerEnvironment(files: Set<string>): NonNullable<DirectoryContext['environment']>['docker'] {
    return {
      hasDockerfile: files.has('Dockerfile') || files.has('dockerfile'),
      hasDockerCompose: files.has('docker-compose.yml') || files.has('docker-compose.yaml') || files.has('compose.yml')
    };
  }

  private detectOtherEnvironments(files: Set<string>): NonNullable<DirectoryContext['environment']>['other'] {
    return {
      hasGemfile: files.has('Gemfile'), // Ruby
      hasCargoToml: files.has('Cargo.toml'), // Rust
      hasGoMod: files.has('go.mod') // Go
    };
  }
} 