import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  
  // WebSocket Server for the Agent Assistant
  const wss = new WebSocketServer({ server: httpServer });

  let agentProcess: any = null;
  const agentLogs: string[] = [];

  // Start Agent Runtime (Python)
  try {
    const agentPath = path.join(__dirname, "agent", "runtime.py");
    agentProcess = spawn("python3", [agentPath]);
    
    agentProcess.stdout.on("data", (data: any) => {
      const output = data.toString();
      console.log(`[AGENT] ${output}`);
      agentLogs.push(`[STDOUT] ${output}`);
      broadcastToClients({ type: "agent_log", data: output });
    });

    agentProcess.stderr.on("data", (data: any) => {
      const error = data.toString();
      console.error(`[AGENT ERROR] ${error}`);
      agentLogs.push(`[STDERR] ${error}`);
      broadcastToClients({ type: "agent_error", data: error });
    });

    agentProcess.on("close", (code: number) => {
      console.log(`Agent process exited with code ${code}`);
      broadcastToClients({ type: "agent_status", status: "OFFLINE", code });
    });
  } catch (err) {
    console.error("Failed to start agent process:", err);
  }

  function broadcastToClients(message: any) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  wss.on("connection", (ws) => {
    console.log("Client connected to Agent IPC");
    ws.send(JSON.stringify({ type: "agent_status", status: agentProcess ? "ONLINE" : "OFFLINE" }));
    
    ws.on("message", (message) => {
      const data = JSON.parse(message.toString());
      if (data.type === "command") {
        console.log(`Received command for agent: ${data.command}`);
        // In a real isolated environment, this would be passed to the Python executor
        if (agentProcess && agentProcess.stdin) {
          agentProcess.stdin.write(JSON.stringify(data) + "\n");
        }
      }
    });
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      agent: agentProcess ? "running" : "not_found",
      logs: agentLogs.slice(-10)
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Server failed to start:", err);
});
