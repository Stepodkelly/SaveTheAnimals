import { spawn } from "node:child_process";

const children = [
  spawn("node", ["server/index.js"], { stdio: "inherit" }),
  spawn("npx", ["vite", "--host", "127.0.0.1"], { stdio: "inherit" })
];

function stop() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stop();
      process.exit(code);
    }
  });
}
