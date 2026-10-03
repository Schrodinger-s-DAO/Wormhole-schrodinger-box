const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const owned = [];
let stopping = false;

function quote(value) {
  return `"${value}"`;
}

function bin(name) {
  const file = process.platform === "win32" ? `${name}.cmd` : name;
  return path.join(root, "node_modules", ".bin", file);
}

function start(line) {
  const child = spawn(line, { cwd: root, stdio: "inherit", shell: true });
  owned.push(child);
  return child;
}

function runLine(line) {
  return new Promise((resolve, reject) => {
    const child = spawn(line, { cwd: root, stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Comando fallito (${code}): ${line}`));
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: true, stdio: "ignore" });
  } else {
    child.kill("SIGINT");
  }
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of owned) killTree(child);
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8545,
        path: "/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        },
        timeout: 1500
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).result);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(body);
    req.end();
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

async function waitForChain() {
  const deadline = Date.now() + 120000;
  let last = "nessuna risposta";
  while (Date.now() < deadline) {
    try {
      const id = await rpcCall("eth_chainId", []);
      if (String(id).toLowerCase() === "0x7a69") return;
      if (typeof id === "string") {
        throw new Error(`La porta 8545 è occupata da un'altra chain (${id}). Ferma quel processo e riprova.`);
      }
    } catch (error) {
      if (error.message.startsWith("La porta 8545")) throw error;
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Il nodo Hardhat non risponde sulla porta 8545 (${last}).`);
}

async function contractsAreLive() {
  const file = path.join(root, "frontend", "public", "deployments.json");
  if (!fs.existsSync(file)) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  const address = parsed?.contracts?.boxA;
  if (!address) return false;
  try {
    const code = await rpcCall("eth_getCode", [address, "latest"]);
    return typeof code === "string" && code !== "0x" && code !== "0x0";
  } catch {
    return false;
  }
}

async function main() {
  console.log("Avvio il banco di prova…");
  const nodeWasUp = await portOpen(8545);
  if (!nodeWasUp) {
    console.log("Avvio il nodo Hardhat su 127.0.0.1:8545");
    console.log("La prima compilazione può richiedere un minuto.");
    const node = start(`${quote(bin("hardhat"))} node`);
    node.on("exit", (code) => {
      if (!stopping) {
        console.error("Il nodo si è chiuso.", code);
        shutdown(code || 1);
      }
    });
  } else {
    console.log("Nodo già in ascolto sulla porta 8545");
  }

  await waitForChain();

  if (await contractsAreLive()) {
    console.log("Deploy locale già presente, lo riuso.");
  } else {
    console.log("Deploy dei contratti sul nodo locale…");
    await runLine(
      `${quote(bin("hardhat"))} run ${quote(path.join(root, "scripts", "deployLocal.js"))} --network localhost`
    );
  }

  const viteWasUp = await portOpen(5173);
  if (!viteWasUp) {
    console.log("Avvio la pagina su http://127.0.0.1:5173");
    const vite = start(
      `${quote(bin("vite"))} --config ${quote(path.join(root, "frontend", "vite.config.mjs"))}`
    );
    vite.on("exit", (code) => {
      if (!stopping) shutdown(code || 0);
    });
  } else {
    console.log("La pagina è già servita sulla porta 5173");
  }

  console.log("\nBanco pronto: http://127.0.0.1:5173");
  console.log("Apri questo indirizzo in due browser e collega un wallet diverso in ciascuno.\n");

  if (nodeWasUp && viteWasUp) {
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  shutdown(1);
});
