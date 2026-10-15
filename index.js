// -----------------------------------------------------------------------------
// Entry point of the Gladys Nintendo Parental Controls integration.
//
// SDK wiring only: the integration itself lives in src/app.js, which takes the
// Gladys client as a parameter so the tests run it against the SDK's fake
// Gladys. Handlers are registered before connect().
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
//     (read by the SDK);
//   - TZ, the time zone of Gladys: Nintendo counts "today" in it.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp({ gladys });
app.register();

// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT); what was seen today is saved first.
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, shutting down`);
  await app.stop();
});

logger.info('Starting the Nintendo Parental Controls integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
