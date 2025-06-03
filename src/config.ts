import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.terminai');
    this.configFile = path.join(this.configDir, 'config.json');
  }

  async ensureGeminiApiKey(): Promise<string> {
   // console.log('[DEBUG] Checking for Gemini API key...');
    
    // Check environment variable first
    const envKey = process.env.GEMINI_API_KEY;
    if (envKey) {
    //  console.log('[DEBUG] Found API key in environment variable');
      return envKey;
    }

    // Check saved config file
    const savedKey = this.loadSavedApiKey();
    if (savedKey) {
    //  console.log('[DEBUG] Found API key in saved configuration');
      return savedKey;
    }

    // If no key found, prompt user
    console.log('🔑 Gemini API key not found. Please enter your API key to continue.');
    console.log('💡 You can get a free API key from: https://makersuite.google.com/app/apikey');
    console.log('🔒 Your key will be securely saved locally for future use.\n');

    const apiKey = await this.promptForApiKey();
    await this.saveApiKey(apiKey);
    
    console.log('✅ API key saved successfully!\n');
    return apiKey;
  }

  private loadSavedApiKey(): string | null {
    try {
      if (!fs.existsSync(this.configFile)) {
        return null;
      }

      const configData = fs.readFileSync(this.configFile, 'utf8');
      const config = JSON.parse(configData);
      return config.geminiApiKey || null;
    } catch (error) {
      console.log('[DEBUG] Error loading saved API key:', error);
      return null;
    }
  }

  private async promptForApiKey(): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('Enter your Gemini API key: ', (apiKey) => {
        rl.close();
        const trimmedKey = apiKey.trim();
        if (trimmedKey) {
          resolve(trimmedKey);
        } else {
          console.log('❌ API key cannot be empty. Please try again.');
          // Recursively ask again if empty
          this.promptForApiKey().then(resolve);
        }
      });

      // Handle any potential hanging by setting a timeout
      setTimeout(() => {
        console.log('\n⚠️  Input timeout. Please restart terminai and try again.');
        rl.close();
        process.exit(1);
      }, 60000); // 60 second timeout
    });
  }

  private async saveApiKey(apiKey: string): Promise<void> {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { mode: 0o700 }); // Only user can read/write
      }

      // Load existing config or create new one
      let config: any = {};
      if (fs.existsSync(this.configFile)) {
        const existingData = fs.readFileSync(this.configFile, 'utf8');
        config = JSON.parse(existingData);
      }

      // Update with new API key
      config.geminiApiKey = apiKey;
      config.lastUpdated = new Date().toISOString();

      // Save with restricted permissions
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
      
      console.log(`[DEBUG] API key saved to: ${this.configFile}`);
    } catch (error) {
      console.error('❌ Error saving API key:', error);
      throw error;
    }
  }

  clearSavedApiKey(): void {
    try {
      if (fs.existsSync(this.configFile)) {
        const configData = fs.readFileSync(this.configFile, 'utf8');
        const config = JSON.parse(configData);
        delete config.geminiApiKey;
        fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
        console.log('✅ Saved API key cleared');
      }
    } catch (error) {
      console.error('Error clearing API key:', error);
    }
  }
} 