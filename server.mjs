// server.ts
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function getPort() {
  const portArgIdx = process.argv.indexOf("--port");
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const p = parseInt(process.argv[portArgIdx + 1], 10);
    if (!isNaN(p)) return p;
  }
  const rawPort = process.env.PORT;
  if (rawPort && !isNaN(Number(rawPort))) {
    return parseInt(rawPort, 10);
  }
  return 3e3;
}
function getHost() {
  const hostArgIdx = process.argv.indexOf("--host");
  if (hostArgIdx !== -1 && process.argv[hostArgIdx + 1]) {
    return process.argv[hostArgIdx + 1];
  }
  return "0.0.0.0";
}
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err);
});
async function startServer() {
  const app = express();
  app.set("trust proxy", true);
  const PORT = getPort();
  const HOST = getHost();
  app.use(express.json());
  const healthCheckResponse = (req, res) => {
    res.status(200).json({
      status: "healthy",
      app: "Linebazar Kolkata Bus Tracking",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      uptime: process.uptime()
    });
  };
  app.get("/api/health", healthCheckResponse);
  app.get("/healthz", (req, res) => res.status(200).send("OK"));
  app.get("/health", (req, res) => res.status(200).send("OK"));
  app.get("/_ah/health", (req, res) => res.status(200).send("OK"));
  app.post("/api/paymentWebhook", (req, res) => {
    const { subscriberId, amount } = req.body;
    console.log(`[Payment Webhook Received] Subscriber: ${subscriberId}, Amount: \u20B9${amount || 19}`);
    res.json({
      success: true,
      verified: true,
      provider: "razorpay_webhook_simulator",
      paidThroughDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString()
    });
  });
  const distPath = path.resolve(__dirname, "dist");
  const isDev = process.env.NODE_ENV === "development";
  const hasDist = fs.existsSync(path.resolve(distPath, "index.html"));
  const isProduction = !isDev && (process.env.NODE_ENV === "production" || hasDist);
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const indexHtmlPath = path.resolve(__dirname, "index.html");
        if (fs.existsSync(indexHtmlPath)) {
          let template = fs.readFileSync(indexHtmlPath, "utf-8");
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } else {
          next();
        }
      } catch (e) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.get("*", (req, res) => {
      const indexPath = path.resolve(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send("<!doctype html><html><head><title>Linebazar - Kolkata Bus Transit</title></head><body><h1>Linebazar Transit Service Active</h1></body></html>");
      }
    });
  }
  const server = app.listen(PORT, HOST, () => {
    console.log(`Linebazar server listening on http://${HOST}:${PORT} (production: ${isProduction})`);
  });
  const shutdown = () => {
    console.log("Shutting down server gracefully...");
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
