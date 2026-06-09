import { spawn } from "node:child_process";

export class CommandRunner {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        shell: false,
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        options.onLog?.(chunk.toString(), "info");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        options.onLog?.(chunk.toString(), "warning");
      });

      child.on("error", reject);
      child.on("close", (code) => {
        const result = {
          code,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt
        };

        if (code === 0) {
          resolve(result);
          return;
        }

        const error = new Error(stderr || stdout || `${command} exited with ${code}`);
        error.result = result;
        reject(error);
      });
    });
  }
}

export const commandRunner = new CommandRunner();
