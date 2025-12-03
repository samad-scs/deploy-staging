#!/usr/bin/env node

const { Command } = require("commander");
const { deploy } = require("./lib/deploy");
const program = new Command();
const packageJson = require("./package.json");

program
  .name("dp-stag")
  .description("Deploy projects to staging server")
  .version(packageJson.version);

program
  .command("deploy")
  .description("Deploy a project to staging")
  .option("-p, --project <path>", "Project folder name in /var/www/")
  .option("-f, --framework <type>", "Framework type (nestjs, expressjs, etc.)")
  .option("-y, --yes", "Skip interactive prompts and use defaults", false)
  .option("--ai", "Enable AI features", false)
  .action((options) => {
    deploy(options);
  });

// Handle default command if no args or just options passed to main
if (process.argv.length < 3) {
  program.help();
}

program.parse(process.argv);
