# 🤖 Terminai

**An AI-enhanced shell wrapper that bridges natural language and command line**

Terminai transforms your terminal experience by adding AI-powered command translation on top of your existing shell. Write commands naturally or use plain English - terminai understands both.

## ✨ Features

- **🔄 Seamless Shell Integration** - Works as a wrapper around your existing shell (zsh/bash)
- **🤖 AI Command Translation** - Failed commands automatically get translated from natural language
- **🛡️ Safety First** - Always asks for confirmation before executing AI-generated commands
- **⚡ Smart Tab Completion** - Complete file paths and commands just like your native shell
- **🔐 Secure API Management** - Safely stores your Gemini API key with proper permissions
- **🎯 Enhanced Prompt** - Clear `[AI]` indicator shows when AI features are active

## 🚀 Quick Start

### Installation

```bash
npm install -g termin-ai
```

### Setup

1. **Get a Gemini API Key** from [Google AI Studio](https://makersuite.google.com/app/apikey)

2. **Launch Terminai**
   ```bash
   terminai
   ```

3. **Enter your API key** when prompted (saved securely to `~/.terminai/config.json`)

That's it! You're ready to use AI-enhanced commands.

## 💡 Usage Examples

### Regular Commands Work Normally
```bash
[AI] user@hostname project % ls -la
[AI] user@hostname project % cd src/
[AI] user@hostname src % pwd
```

### Natural Language Commands
When a command fails, terminai automatically asks AI for help:

```bash
[AI] user@hostname project % show me all typescript files
🤖 Command failed. Attempting AI translation...
🔄 Asking AI to translate the command...
💡 AI suggests: find . -name "*.ts" -type f
❓ Execute this command? (y/N): y
✅ Executing AI-suggested command...
./src/shell.ts
./src/ai-service.ts
./src/config.ts
./src/cli.ts
```

```bash
[AI] user@hostname project % list hidden files
🤖 Command failed. Attempting AI translation...
💡 AI suggests: ls -la
❓ Execute this command? (y/N): y
```

```bash
[AI] user@hostname project % check disk space
💡 AI suggests: df -h
📝 Explanation: Display filesystem disk space usage in human readable format
❓ Execute this command? (y/N): y
```

### Smart Tab Completion
```bash
[AI] user@hostname project % cp tsconfig<TAB>
tsconfig.json

[AI] user@hostname project % cd src/<TAB>
shell.ts  ai-service.ts  config.ts  cli.ts

[AI] user@hostname project % npm run <TAB>
build  start  test
```

## 🔧 How It Works

1. **Command Execution**: Terminai first tries to execute your input as a regular shell command
2. **AI Translation**: If the command fails (non-zero exit code), it sends your input to Google's Gemini AI
3. **Smart Suggestions**: The AI interprets your natural language and suggests appropriate shell commands
4. **User Confirmation**: You review and approve the suggestion before execution
5. **Safe Execution**: The suggested command runs with full output, just like typing it yourself

## 🛡️ Security & Privacy

- **API Key Storage**: Your Gemini API key is stored locally in `~/.terminai/config.json` with user-only permissions (600)
- **No Command Logging**: Your commands and AI interactions are not stored or transmitted anywhere except to Google's Gemini API
- **User Confirmation**: AI suggestions always require explicit approval before execution
- **Sandboxed Execution**: Commands run in your current directory with your user permissions

## 🎯 Perfect For

- **Learning Command Line**: Describe what you want, learn the actual commands
- **Complex Operations**: "find all log files older than 7 days and compress them"
- **Quick Tasks**: "show me disk usage" instead of remembering `df -h`
- **File Management**: "copy all images to backup folder"
- **System Information**: "check memory usage" or "list running processes"

## 🔧 Configuration

### Environment Variables
```bash
export GEMINI_API_KEY="your-api-key-here"
```

### Config File Location
```
~/.terminai/config.json
```

### Reset Configuration
```bash
rm ~/.terminai/config.json && terminai
```

## 🎨 Examples Gallery

```bash
# File Operations
"copy all pdfs to documents folder"
→ cp *.pdf ~/Documents/

# System Monitoring  
"show me cpu usage"
→ top -n 1 | head -20

# Git Operations
"show git status with colors"
→ git status --color=always

# Network Diagnostics
"check if google is reachable"
→ ping -c 4 google.com

# Process Management
"kill all node processes"
→ pkill -f node
```

## 🚀 Advanced Usage

### Chaining Commands
```bash
[AI] user@hostname project % build and test the project
💡 AI suggests: npm run build && npm test
```

### Directory Navigation
```bash
[AI] user@hostname project % go to parent directory and list files
💡 AI suggests: cd .. && ls -la
```

### File Search
```bash
[AI] user@hostname project % find large files bigger than 100MB
💡 AI suggests: find . -size +100M -type f -exec ls -lh {} \;
```

## 🛠️ Technical Details

- **Built with**: TypeScript + Node.js
- **AI Model**: Google Gemini 2.5 Flash Preview
- **Shell Integration**: Spawns zsh/bash processes for command execution
- **Completion System**: Custom tab completion with file and command support
- **Cross-Platform**: macOS, Linux (Windows support coming soon)

## 📝 Development

```bash
# Clone the repository
git clone <repo-url>
cd terminai

# Install dependencies
npm install

# Build
npm run build

# Test locally
npm link
terminai
```

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details.

---

**Happy commanding! 🚀**

*Transform your terminal experience with the power of AI* 