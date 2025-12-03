const { connectToServer, runCommand, ssh } = require("./ssh");
const { generateDeploymentSummary } = require("./ai");
const chalk = require("chalk");
const ora = require("ora");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const inquirer = require("inquirer");

async function loadEnvFile() {
  try {
    const envPath = path.join(process.cwd(), "../.env");
    const envContent = await fs.readFile(envPath, "utf8");

    envContent.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          const value = valueParts.join("=").replace(/^["'](.*)["']$/, "$1");
          process.env[key] = value;
        }
      }
    });
  } catch {
    // ignore cleanup error
  }
}

await loadEnvFile();

// Load repo map
let repoMap = {};
try {
  repoMap = require("../repo-map.json");
} catch (e) {
  // Ignore if file doesn't exist or is invalid, we just won't be able to map
}

function getGitRepoInfo() {
  try {
    const remoteUrl = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
    }).trim();
    // Handle SSH and HTTPS URLs
    // SSH: git@github.com:Owner/Repo.git
    // HTTPS: https://github.com/Owner/Repo.git
    const match = remoteUrl.match(/[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function isValidProjectName(name) {
  // Allow alphanumeric, dots, underscores, and dashes.
  // Reject empty strings or anything else.
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

function escapeShellArg(arg) {
  // Escapes a string to be safe for use in a shell command (wrapped in single quotes)
  // Replaces ' with '\''
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

async function updateRemoteEnv(projectPath, key, value) {
  // Validate key (simple variable name validation)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    console.error(chalk.red(`Invalid env key: ${key}`));
    return;
  }

  const safeKey = key; // Key is validated, so it's safe to use directly if we are careful, but let's be consistent.
  const safeValue = escapeShellArg(value);

  // Check if key exists
  // We use grep with fixed string search (-F) to be safer, but grep regex is fine for simple keys
  const checkCmd = `grep "^${safeKey}=" ${projectPath}/.env`;
  try {
    await ssh.execCommand(checkCmd);
    // If grep succeeds (exit code 0), key exists. We use sed to replace.
    // We use a slightly different sed syntax to handle the escaped value safely.
    // However, inserting a shell-escaped string into a sed command is tricky.
    // A safer approach for arbitrary values is to use a temporary file or specific echo logic.

    // Let's use a safer approach:
    // 1. Read the file content (if not too huge) - might be risky for large files.
    // 2. Or use a robust sed command.

    // We will use a pattern that avoids complex sed escaping issues by using the escaped value directly in a double-quoted string context if possible,
    // OR better: construct the line and replace it.

    // Simplest robust way for remote file edit without complex sed escaping:
    // echo "key=value" > .env.tmp && grep -v "^key=" .env >> .env.tmp && mv .env.tmp .env
    // But we want to preserve order if possible.

    // Let's stick to sed but be very careful.
    // We can use the fact that we escaped the value for SHELL.
    // But sed also interprets characters.

    // Alternative: Use `sed -i '/^KEY=/c\KEY=VALUE' file`
    // We need to escape backslashes and forward slashes for sed.

    // Let's use a node-ssh approach to read, modify, write if we want 100% safety, but that's slow.

    // Let's go with the grep -v append approach for safety against injection, but it changes order (moves to bottom).
    // Actually, `grep -v` removes the line.
    // So: `grep -v "^KEY=" .env > .env.tmp; echo "KEY=VALUE" >> .env.tmp; mv .env.tmp .env`
    // This is safe and robust.

    const cmd = `grep -v "^${safeKey}=" ${projectPath}/.env > ${projectPath}/.env.tmp && echo "${safeKey}=${value.replace(
      /"/g,
      '\\"'
    )}" >> ${projectPath}/.env.tmp && mv ${projectPath}/.env.tmp ${projectPath}/.env`;
    // Wait, if I use double quotes for echo, I need to escape double quotes and backticks and $ in value.
    // escapeShellArg wraps in single quotes.

    // Let's use the single quoted value from escapeShellArg.
    // echo 'KEY=VALUE' >> file
    // This is safe.

    const safeLine = `${safeKey}=${value}`;
    const escapedLine = escapeShellArg(safeLine); // 'KEY=VALUE' (with internal quotes escaped)

    const safeUpdateCmd = `grep -v "^${safeKey}=" ${projectPath}/.env > ${projectPath}/.env.tmp && echo ${escapedLine} >> ${projectPath}/.env.tmp && mv ${projectPath}/.env.tmp ${projectPath}/.env`;

    await runCommand(safeUpdateCmd, projectPath);
    console.log(chalk.green(`Updated ${key} in .env`));
  } catch (e) {
    // If grep fails (key not found), just append.
    const safeLine = `${safeKey}=${value}`;
    const escapedLine = escapeShellArg(safeLine);
    const appendCmd = `echo ${escapedLine} >> ${projectPath}/.env`;
    await runCommand(appendCmd, projectPath);
    console.log(chalk.green(`Appended ${key} to .env`));
  }
}

async function deploy(options) {
  let { project, framework, ai, yes } = options;

  // Auto-detect project if not provided
  if (!project) {
    const repo = getGitRepoInfo();
    if (repo && repoMap[repo]) {
      project = repoMap[repo];
      console.log(
        chalk.blue(`ℹ️  Auto-detected project: ${project} (from ${repo})`)
      );
    } else {
      console.error(
        chalk.red(
          "Error: Project not specified and could not be auto-detected."
        )
      );
      console.error(
        chalk.yellow("Please provide --project or update repo-map.json.")
      );
      process.exit(1);
    }
  }

  // Validate Project Name
  if (!isValidProjectName(project)) {
    console.error(chalk.red(`Error: Invalid project name "${project}".`));
    console.error(
      chalk.yellow(
        "Project name must only contain alphanumeric characters, dots, underscores, and dashes."
      )
    );
    process.exit(1);
  }

  // Load env vars
  const host = process.env.SSH_HOST;
  console.log("host :", host);
  const username = process.env.SSH_USERNAME || "root";
  console.log("username :", username);
  const privateKeyPath = process.env.SSH_KEY_PATH;
  console.log("privateKeyPath :", privateKeyPath);
  const genAiKey = process.env.GEMINI_API_KEY;

  if (!host || !privateKeyPath) {
    console.error(
      chalk.red(
        "Error: SSH_HOST and SSH_KEY_PATH must be defined in .env file."
      )
    );
    process.exit(1);
  }

  const spinner = ora("Connecting to staging server...").start();

  try {
    await connectToServer(host, username, privateKeyPath);
    spinner.succeed("Connected to staging server");

    const projectPath = `/var/www/${project}`;

    spinner.start(`Pulling latest changes for ${project}...`);
    await runCommand("git pull origin staging", projectPath);
    spinner.succeed("Git pull complete");

    // Interactive Mode (Default, unless --yes is passed)
    if (!yes) {
      console.log(chalk.yellow("\nInteractive Mode Enabled"));

      const choices = [];
      if (framework === "nestjs") {
        choices.push("Run Prisma Generate");
        choices.push("Run Prisma DB Push");
        choices.push("Run Build");
      }
      choices.push("Update .env");
      choices.push("Continue Deployment");

      let continueLoop = true;
      while (continueLoop) {
        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: "What would you like to do?",
            choices,
          },
        ]);

        if (action === "Run Prisma Generate") {
          await runCommand("npx prisma generate", projectPath);
        } else if (action === "Run Prisma DB Push") {
          await runCommand("npx prisma db push", projectPath);
        } else if (action === "Run Build") {
          await runCommand("yarn build", projectPath);
        } else if (action === "Update .env") {
          const { key, value } = await inquirer.prompt([
            { type: "input", name: "key", message: "Env Variable Key:" },
            { type: "input", name: "value", message: "Env Variable Value:" },
          ]);
          await updateRemoteEnv(projectPath, key, value);
        } else {
          continueLoop = false;
        }
      }
    }

    if (framework) {
      spinner.start(`Handling ${framework} specific tasks...`);
      if (
        framework.toLowerCase() === "nestjs" ||
        framework.toLowerCase() === "expressjs"
      ) {
        console.log(chalk.blue("Running Prisma generate..."));
        await runCommand("npx prisma generate", projectPath);
      }

      if (framework.toLowerCase() === "nestjs") {
        console.log(chalk.blue("Running Build..."));
        await runCommand("yarn build", projectPath);
      }

      spinner.succeed(`${framework} tasks complete`);
    }

    spinner.start("Restarting application with PM2...");
    // We use the validated project name here, so it's safe from injection.
    await runCommand(
      `pm2 restart ${project} || pm2 restart index`,
      projectPath
    );
    spinner.succeed("PM2 restart complete");

    console.log(chalk.green.bold("\n🚀 Deployment Successful!"));

    if (ai) {
      await generateDeploymentSummary(
        genAiKey,
        project,
        framework || "Node.js"
      );
    }
  } catch (error) {
    spinner.fail("Deployment failed");
    console.error(error);
  } finally {
    ssh.dispose();
  }
}

module.exports = {
  deploy,
};
