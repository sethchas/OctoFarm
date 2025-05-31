// server/app.js

require('dotenv').config(); // if you are using a .env file
const mongoose = require('mongoose');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 1) Import the four methods from your "core" file (the code you just posted).
//    I’m assuming you saved that file as `server/app-core.js`.
const {
  setupExpressServer,
  ensureSystemSettingsInitiated,
  serveOctoFarmRoutes,
  serveOctoFarmNormally
} = require('./app-core');


// ────────────────────────────────────────────────────────────────────────────────
// Before anything else, make sure your `logs/` and `images/` directories exist
// and are writable. Winston in logger.js expects to write into `logs/…`,
// and your background‐image utility expects to write into `images/…`.
//
// From /OctoFarm (your project root) run once in the shell:
//      mkdir -p logs images
//      sudo chown -R $(whoami):$(whoami) logs images
// If you already did that, you can skip this step.
// ────────────────────────────────────────────────────────────────────────────────


// 2) Connect to MongoDB. (Adjust the connection string or options as needed.)
const MONGO_URL = process.env.MONGO || 'mongodb://localhost:27017/octofarm';
mongoose
  .connect(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => {
    console.log('✅ Connected to MongoDB');
  })
  .catch((err) => {
    console.error('❌ Could not connect to MongoDB:', err);
    process.exit(1);
  });

// 3) Call setupExpressServer() to get a fully‐configured Express `app`.
const app = setupExpressServer();

// 4) At startup, ensure your “system settings” are in place.
//    If this throws, we exit the process. Otherwise, we continue.
//    (You probably want to catch any errors and exit gracefully.)
ensureSystemSettingsInitiated()
  .then(async () => {
    console.log('✅ System settings loaded.');

    // 5) Unless you passed a "quick_boot" flag, we now register jobs, Influx setup, etc.
    //    `serveOctoFarmNormally(app)` itself _will_ call `serveOctoFarmRoutes(app)` internally,
    //    so you do not need to call `serveOctoFarmRoutes` again here.
    //
    //    If you want to skip recurring tasks on every restart, you can pass `true` as the
    //    second argument (quick_boot=true). Otherwise, pass nothing or `false`.
    await serveOctoFarmNormally(app, /* quick_boot = */ false);

    // 6) At this point the Express routes are registered and your background tasks are queued.
    //    Start the HTTP server:
    const PORT = parseInt(process.env.PORT || '4000', 10);
    app.server = http.createServer(app);

    app.server.listen(PORT, () => {
      console.log(`🚀 OctoFarm server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize system settings:', err);
    process.exit(1);
  });

