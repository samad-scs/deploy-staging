const { connectToServer, runCommand, ssh } = require("./ssh");
const { generateDeploymentSummary } = require("./ai");
const chalk = require("chalk");
const ora = require("ora");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const inquirer = require("inquirer");
require("dotenv").config();

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

async function updateRemoteEnv(projectPath, key, value) {
  // Check if key exists
  const checkCmd = `grep "^${key}=" ${projectPath}/.env`;
  try {
    await ssh.execCommand(checkCmd);
    // If grep succeeds (exit code 0), key exists. We use sed to replace.
    // Note: This is a basic implementation. Complex values with special chars might need escaping.
    const sedCmd = `sed -i 's|^${key}=.*|${key}=${value}|' ${projectPath}/.env`;
    await runCommand(sedCmd, projectPath);
    console.log(chalk.green(`Updated ${key} in .env`));
  } catch (e) {
    // If grep fails, key doesn't exist. Append.
    const appendCmd = `echo "${key}=${value}" >> ${projectPath}/.env`;
    await runCommand(appendCmd, projectPath);
    console.log(chalk.green(`Appended ${key} to .env`));
  }
}

async function deploy(options) {
  let { project, framework, ai, ask } = options;

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

  // Load env vars
  const host = process.env.SSH_HOST;
  const username = process.env.SSH_USERNAME || "root";
  const privateKeyPath = process.env.SSH_KEY_PATH;
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

    // Interactive Mode
    if (ask) {
      console.log(chalk.yellow("\nInteractive Mode Enabled"));

      const choices = [];
      if (framework === "nestjs") {
        choices.push("Run Prisma Generate");
        choices.push("Run Prisma DB Push");
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

    if (framework && !ask) {
      spinner.start(`Handling ${framework} specific tasks...`);
      if (
        framework.toLowerCase() === "nestjs" ||
        framework.toLowerCase() === "expressjs"
      ) {
        // Check for prisma
        // This is a simplified check, ideally we check package.json on remote or user assumes it exists
        console.log(chalk.blue("Running Prisma generate..."));
        await runCommand("npx prisma generate", projectPath);
        // await runCommand('npx prisma db push', projectPath); // Be careful with db push on staging
      }
      spinner.succeed(`${framework} tasks complete`);
    }

    spinner.start("Restarting application with PM2...");
    // Assuming the pm2 process name is the same as the project name or index
    // We try to find the process or just restart by name
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
