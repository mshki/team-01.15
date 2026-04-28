import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { IApp, IServer } from "./contracts";
import { createComposedApp } from "./composition";
import { CreateLoggingService } from "./service/LoggingService";

export class HttpServer implements IServer {
  constructor(private readonly app: IApp) {}

  start(port: number): void {
    const expressApp = this.app.getExpressApp();
    const httpsPort = Number(process.env.HTTPS_PORT ?? port);
    const redirectPort = Number(process.env.HTTP_REDIRECT_PORT ?? 3000);
    const keyPath = process.env.HTTPS_KEY_PATH ?? path.join(process.cwd(), "certs/localhost-key.pem");
    const certPath =
      process.env.HTTPS_CERT_PATH ?? path.join(process.cwd(), "certs/localhost-cert.pem");

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    https.createServer({ key, cert }, expressApp).listen(httpsPort, () => {
      // eslint-disable-next-line no-console
      console.log(`App running on https://localhost:${httpsPort}`);
    });

    if (redirectPort !== httpsPort) {
      http
        .createServer((req, res) => {
          const location = `https://localhost:${httpsPort}${req.url ?? "/"}`;
          res.writeHead(301, { Location: location });
          res.end();
        })
        .listen(redirectPort, () => {
          // eslint-disable-next-line no-console
          console.log(`Redirecting http://localhost:${redirectPort} -> https://localhost:${httpsPort}`);
        });
    }
  }
}

const logger = CreateLoggingService();

const port = Number(process.env.HTTPS_PORT ?? process.env.PORT ?? 3443);
const app = createComposedApp(logger);
const server = new HttpServer(app);

server.start(port);
