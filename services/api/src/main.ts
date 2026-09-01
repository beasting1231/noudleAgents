import { createRelayApp } from "./app.js";

const context = await createRelayApp({ logger: true });

try {
  await context.app.listen({ host: context.config.host, port: context.config.port });
} catch (error) {
  context.app.log.error(error);
  process.exitCode = 1;
  await context.app.close();
}
