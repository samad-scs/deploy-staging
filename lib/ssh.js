const { NodeSSH } = require("node-ssh");
const chalk = require("chalk");

const ssh = new NodeSSH();

async function connectToServer(host, username, privateKeyPath) {
  try {
    await ssh.connect({
      host,
      username,
      privateKeyPath,
    });
    console.log(chalk.green("Successfully connected to server!"));
    return ssh;
  } catch (error) {
    console.error(chalk.red("Failed to connect to server:"), error);
    throw error;
  }
}

async function runCommand(command, cwd) {
  try {
    const result = await ssh.execCommand(command, { cwd });
    if (result.stderr) {
      console.error(chalk.yellow(`STDERR: ${result.stderr}`));
    }
    console.log(chalk.blue(`STDOUT: ${result.stdout}`));
    return result;
  } catch (error) {
    console.error(chalk.red(`Failed to execute command: ${command}`), error);
    throw error;
  }
}

module.exports = {
  connectToServer,
  runCommand,
  ssh,
};
