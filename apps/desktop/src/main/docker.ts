import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DockerStartResult = {
  status: "started" | "already-running" | "unsupported" | "failed";
  message: string;
};

let dockerStartInFlight: Promise<DockerStartResult> | null = null;

async function commandSucceeds(command: string, args: string[], timeout = 3_000): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function dockerIsRunning(): Promise<boolean> {
  if (await commandSucceeds("docker", ["info", "--format", "{{.ServerVersion}}"])) return true;

  if (process.platform === "darwin") {
    return commandSucceeds("pgrep", ["-f", "Docker Desktop.app/Contents/MacOS/Docker Desktop"]);
  }
  if (process.platform === "win32") {
    return commandSucceeds("tasklist.exe", ["/FI", "IMAGENAME eq Docker Desktop.exe", "/NH"]);
  }
  return commandSucceeds("pgrep", ["-f", "docker-desktop"]);
}

async function launchDocker(): Promise<DockerStartResult> {
  if (await dockerIsRunning()) {
    return { status: "already-running", message: "Docker is already running." };
  }

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", "Docker"]);
    } else if (process.platform === "win32") {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process 'Docker Desktop'",
      ]);
    } else {
      const started = await commandSucceeds("systemctl", ["--user", "start", "docker-desktop"], 10_000);
      if (!started) {
        return { status: "unsupported", message: "Start Docker Desktop from your applications menu." };
      }
    }
    return { status: "started", message: "Docker is starting. Live agents will reconnect automatically." };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? `Docker could not be started: ${error.message}` : "Docker could not be started.",
    };
  }
}

export function startDocker(): Promise<DockerStartResult> {
  if (dockerStartInFlight) {
    return Promise.resolve({ status: "already-running", message: "Docker is already starting." });
  }

  dockerStartInFlight = launchDocker().finally(() => {
    dockerStartInFlight = null;
  });
  return dockerStartInFlight;
}
