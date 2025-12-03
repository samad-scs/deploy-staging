# Staging Deployer (dp-stag)

A CLI tool to automate deploying projects to a staging server. It handles SSH connections, git pulls, PM2 restarts, and framework-specific tasks.

## Features

- **Automated Deployment**: Connects via SSH, pulls latest code, and restarts PM2.
- **Auto-Project Detection**: Automatically detects the project based on the current git repository.
- **Framework Support**: Handles `nestjs` and `expressjs` specific tasks (e.g., Prisma generate).
- **AI Integration**: Generates deployment summaries using Google Gemini (optional).

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Link the package globally:
   ```bash
   npm link
   ```

## Configuration

### Environment Variables

Create a `.env` file in the project root (or ensure variables are set in your shell, e.g., `.zshrc`).

```env
SSH_HOST=your.staging.server.ip
SSH_USERNAME=root
SSH_KEY_PATH=/path/to/your/private/key
GEMINI_API_KEY=your_gemini_api_key # Optional, for AI features
```

### Repository Mapping

To enable auto-project detection, update `repo-map.json` with your repository mappings:

```json
{
  "Owner/Repo": "folder-name-on-vps"
}
```

## Usage

### Basic Deployment (Auto-detected)

Run the command from within a mapped git repository:

```bash
dp-stag deploy
```

### Manual Deployment

Specify the project folder name manually:

```bash
dp-stag deploy --project my-project-folder
```

### With Framework Handling

```bash
dp-stag deploy --project my-api --framework nestjs
```

### With Interactive Mode

Prompt for actions like Prisma commands or updating `.env` variables:

```bash
dp-stag deploy --project my-api --framework nestjs --ask
```

### With AI Summary

```bash
dp-stag deploy --ai
```

## License

ISC
