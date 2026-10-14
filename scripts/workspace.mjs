import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnv = join(root, ".env");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      // Only terminate process trees created by this command.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = code;
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

function run(command, args, cwd = root) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    children.add(child);
    child.once("error", (error) => { children.delete(child); reject(error); });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (stopping) return resolveRun();
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${signal ?? code}.`));
    });
  });
}

function npm(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error("Use npm run to execute workspace commands.");
  return run(process.execPath, [cli, ...args]);
}

function gradle(task, extraArgs = []) {
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";
  return run(java, [
    "-Dorg.gradle.appname=gradlew", "-classpath",
    join(root, "backend", "gradle", "wrapper", "gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain", task, "--console=plain", ...extraArgs,
  ], join(root, "backend"));
}

try {
  switch (process.argv[2]) {
    case "dev":
      console.log("insAuto: http://127.0.0.1:3001 | API: http://127.0.0.1:8081");
      await Promise.race([gradle("bootRun"), npm(["run", "dev", "--workspace", "frontend"])]);
      stop();
      break;
    case "frontend": await npm(["run", "dev", "--workspace", "frontend"]); break;
    case "backend": await gradle("bootRun"); break;
    case "backend-test": await gradle("test", process.argv.slice(3)); break;
    case "test":
      await npm(["test", "--workspace", "@insauto/frontend"]);
      await npm(["test", "--workspace", "@insauto/mcp-server"]);
      await gradle("test");
      break;
    case "build":
      await npm(["run", "build", "--workspace", "frontend"]);
      await gradle("bootJar");
      break;
    case "mcp":
      await run(process.execPath, [join(root, "packages", "mcp-server", "src", "index.mjs")]);
      break;
    default: throw new Error("Unknown workspace command.");
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
