// server/app-env.js

/**
 * This file handles:
 *   1) all environment/configuration setup (NODE_ENV, .env parsing, Mongo URI, port, migrations, etc.)
 *   2) exporting four Express-related functions that app-core.js expects:
 *        • setupExpressServer()
 *        • ensureSystemSettingsInitiated()
 *        • serveOctoFarmRoutes(app)
 *        • serveOctoFarmNormally(app, quick_boot)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const isDocker = require('is-docker');
const envUtils = require('./utils/env.utils');
const dotenv = require('dotenv');
const { AppConstants } = require('./constants/app.constants');
const Logger = require('./handlers/logger.js');
const { status, up } = require('migrate-mongo');
const { LOGGER_ROUTE_KEYS } = require('./constants/logger.constants');

// Initialize a logger for this module (SERVER_ENVIRONMENT)
const logger = new Logger(LOGGER_ROUTE_KEYS.SERVER_ENVIRONMENT, false);

// Paths to package.json / package-lock.json, and .env file
const packageJsonPath = path.join(__dirname, '../package.json');
const packageLockPath = path.join(__dirname, '../package-lock.json');
const packageLockFile = require(packageLockPath);
const dotEnvPath = path.join(__dirname, '../.env');

// -----------------------------------------------------------------------------------------------------
// 1) ENVIRONMENT‐SETUP FUNCTIONS (NODE_ENV, VERSION, MONGO URI, PORT, LOG LEVEL, etc.)
// -----------------------------------------------------------------------------------------------------

/**
 * If NODE_ENV is missing or unknown, set it to default production
 * and write it to .env (unless we're inside Docker).
 */
function ensureNodeEnvSet() {
  const environment = process.env[AppConstants.NODE_ENV_KEY];
  if (!environment || !AppConstants.knownEnvNames.includes(environment)) {
    const newEnvName = AppConstants.defaultProductionEnv;
    process.env[AppConstants.NODE_ENV_KEY] = newEnvName;
    logger.warning(
      `NODE_ENV="${environment}" was not set (or not recognized). Defaulting to NODE_ENV="${newEnvName}".`
    );

    // Don’t write to .env if we’re in Docker
    if (isDocker()) return;

    envUtils.writeVariableToEnvFile(
      path.resolve(dotEnvPath),
      AppConstants.NODE_ENV_KEY,
      newEnvName
    );
  } else {
    logger.info(`✓ NODE_ENV correctly set: ${environment}`);
  }
}

/**
 * Ensure process.env[VERSION_KEY] is always defined.
 * If missing, pull from package.json → “version” field, 
 * set NON_NPM_MODE_KEY = 'true', and log accordingly.
 */
function ensureEnvNpmVersionSet() {
  const packageJsonVersion = require(packageJsonPath).version;
  if (!process.env[AppConstants.VERSION_KEY]) {
    process.env[AppConstants.VERSION_KEY] = packageJsonVersion;
    process.env[AppConstants.NON_NPM_MODE_KEY] = 'true';
    logger.info(
      `✓ Running OctoFarm version ${packageJsonVersion} in non-NPM mode!`
    );
  } else {
    logger.debug(
      `✓ Running OctoFarm version ${process.env[AppConstants.VERSION_KEY]} in NPM mode!`
    );
  }

  // If the env VAR doesn’t match package.json, overwrite it
  if (process.env[AppConstants.VERSION_KEY] !== packageJsonVersion) {
    process.env[AppConstants.VERSION_KEY] = packageJsonVersion;
    logger.warning(
      `~ Synchronized OctoFarm version to ${packageJsonVersion} (it was outdated).`
    );
  }
}

/**
 * If “.git” (deprecated) config path exists (./middleware/db.js), migrate it into .env
 * or else write MONGO default into .env.
 */
function fetchMongoDBConnectionString(persistToEnv = false) {
  // If MONGO_KEY is not set:
  if (!process.env[AppConstants.MONGO_KEY]) {
    logger.warning(
      `~ ${AppConstants.MONGO_KEY} not set. Assuming default: ${AppConstants.defaultMongoStringUnauthenticated}`
    );
    printInstructionsURL(); // print docs link
    process.env[AppConstants.MONGO_KEY] = AppConstants.defaultMongoStringUnauthenticated;

    // If asked to persist and not in Docker, write to .env
    if (persistToEnv && !isDocker()) {
      envUtils.writeVariableToEnvFile(
        path.resolve(dotEnvPath),
        AppConstants.MONGO_KEY,
        AppConstants.defaultMongoStringUnauthenticated
      );
    }
  }
  return process.env[AppConstants.MONGO_KEY];
}

/**
 * If MONGO_KEY isn’t in process.env, attempt migration from deprecated middleware/db.js,
 * otherwise write default to .env.
 */
function ensureMongoDBConnectionStringSet() {
  let conn = process.env[AppConstants.MONGO_KEY];
  const deprecatedConfigFolder = '../middleware/';
  const deprecatedConfigFilePath = deprecatedConfigFolder + 'db.js';

  if (!conn) {
    // If in Docker, just fetch (entrypoint sees it)
    if (isDocker()) {
      fetchMongoDBConnectionString(false);
      return;
    }

    // If no deprecated file, just write default into .env
    if (!fs.existsSync(deprecatedConfigFilePath)) {
      fetchMongoDBConnectionString(true);
      return;
    }

    // Else, pull MongoURI from the deprecated file, if present
    const mongoFallbackURI = require(deprecatedConfigFilePath).MongoURI;
    if (!mongoFallbackURI) {
      logger.info(
        `~ Found deprecated 'middleware/db.js', but no MongoURI inside it. Clearing it.`
      );
      removeDeprecatedMongoURIConfigFile();
      logger.info(
        `~ ${AppConstants.MONGO_KEY} not set. Using default: ${AppConstants.defaultMongoStringUnauthenticated}`
      );
      printInstructionsURL();
      process.env[AppConstants.MONGO_KEY] = AppConstants.defaultMongoStringUnauthenticated;
    } else {
      // We have a fallback URI → migrate it into .env
      removeDeprecatedMongoURIConfigFile();
      logger.info(
        `~ Migrated MongoURI from deprecated middleware to .env: ${mongoFallbackURI}`
      );
      envUtils.writeVariableToEnvFile(
        path.resolve(dotEnvPath),
        AppConstants.MONGO_KEY,
        mongoFallbackURI
      );
      process.env[AppConstants.MONGO_KEY] = mongoFallbackURI;
    }
  } else {
    // If MONGO_KEY was set and the deprecated file still exists, remove it
    if (fs.existsSync(deprecatedConfigFilePath)) {
      logger.info(
        `~ Found deprecated middleware file '${deprecatedConfigFilePath}', but MONGO_KEY already set. Clearing it.`
      );
      removeDeprecatedMongoURIConfigFile();
    }
    logger.info(`✓ ${AppConstants.MONGO_KEY} is set!`);
  }
}

/**
 * Write instructions URL for new users
 */
function printInstructionsURL() {
  const instructionsReferralURL =
    'https://docs.octofarm.net/installation/setup-environment.html';
  logger.info(
    `Please read ${instructionsReferralURL} for environment‐configuration steps.`
  );
}

/**
 * Remove deprecated middleware/db.js and then delete the folder if empty.
 */
function removeDeprecatedMongoURIConfigFile() {
  const deprecatedConfigFolder = '../middleware/';
  const deprecatedConfigFilePath = deprecatedConfigFolder + 'db.js';

  try {
    logger.info(`~ Removing deprecated file ${deprecatedConfigFilePath}`);
    fs.rmSync(deprecatedConfigFilePath);
  } catch (err) {
    logger.error(`~ Could not remove deprecated file: ${deprecatedConfigFilePath}`, err.toString());
  }
  removeFolderIfEmpty(deprecatedConfigFolder);
}

/**
 * Attempt to rmdir a folder if empty (silent if not empty).
 */
function removeFolderIfEmpty(folder) {
  fs.rmdir(folder, (err) => {
    if (err) {
      logger.error(`~ Could not clear up folder ${folder} (not empty)`);
    } else {
      logger.info(`✓ Removed empty folder ${folder}`);
    }
  });
}

/**
 * If OCTOFARM_PORT is missing/invalid, write default to .env and set it.
 */
function fetchOctoFarmPort() {
  let port = process.env[AppConstants.OCTOFARM_PORT_KEY];
  if (Number.isNaN(parseInt(port))) {
    logger.warning(
      `~ ${AppConstants.OCTOFARM_PORT_KEY} is not a valid port (got: ${port}). Using default: ${AppConstants.defaultOctoFarmPort}`
    );
    if (!isDocker()) {
      envUtils.writeVariableToEnvFile(
        path.resolve(dotEnvPath),
        AppConstants.OCTOFARM_PORT_KEY,
        AppConstants.defaultOctoFarmPort
      );
      logger.info(
        `~ Wrote ${AppConstants.OCTOFARM_PORT_KEY}=${AppConstants.defaultOctoFarmPort} to .env`
      );
    }
    process.env[AppConstants.OCTOFARM_PORT_KEY] =
      AppConstants.defaultOctoFarmPort.toString();
    port = process.env[AppConstants.OCTOFARM_PORT_KEY];
  }
  return port;
}

/**
 * Check if OCTOFARM_PORT exists; if not, set default in memory (no .env write).
 */
function ensurePortSet() {
  if (!process.env[AppConstants.OCTOFARM_PORT_KEY]) {
    logger.info(
      `~ ${AppConstants.OCTOFARM_PORT_KEY} missing. Defaulting to ${AppConstants.defaultOctoFarmPort}`
    );
    printInstructionsURL();
    process.env[AppConstants.OCTOFARM_PORT_KEY] =
      AppConstants.defaultOctoFarmPort.toString();
  }
}

/**
 * If LOG_LEVEL not set or invalid, default it to AppConstants.defaultLogLevel.
 */
function ensureLogLevelSet() {
  const logLevel = process.env[AppConstants.LOG_LEVEL];
  if (!logLevel || !AppConstants.knownLogLevels.includes(logLevel)) {
    logger.info(
      `~ ${AppConstants.LOG_LEVEL} not set or invalid. Defaulting to ${AppConstants.defaultLogLevel}`
    );
    process.env[AppConstants.LOG_LEVEL] = AppConstants.defaultLogLevel.toString();
  }
}

/**
 * Before everything else, verify that package.json has “name”: "octofarm-server"
 * and that you’re running it in the proper folder. If not, abort.
 */
function setupPackageJsonVersionOrThrow() {
  const result = envUtils.verifyPackageJsonRequirements(path.join(__dirname, '../server'));
  if (!result) {
    if (envUtils.isPm2()) {
      removePm2Service('Package.json validation failed.');
    }
    throw new Error('Aborting OctoFarm server.');
  }
}

/**
 * Remove the PM2 service if OctoFarm fails to start.
 */
function removePm2Service(reason) {
  logger.error('Aborting and removing PM2 service because: ' + reason);
  try {
    execSync('pm2 delete octofarm');
  } catch (e) {
    // ignore if pm2 delete fails
  }
}

/**
 * If there’s a package.json in “server/” and the “name” field is wrong, abort.
 */
function verifyPackageJsonRequirements(rootPath) {
  return envUtils.verifyPackageJsonRequirements(rootPath);
}

/**
 * The master setup routine for reading/parsing .env (unless skipDotEnv = true),
 * then validating/fixing all required environment variables.
 */
function setupEnvConfig(skipDotEnv = false) {
  if (!skipDotEnv) {
    // We must run this from the CWD of app.js
    dotenv.config({ path: dotEnvPath });
    logger.info('✓ Parsed environment and (optional) .env file');
  }

  ensureNodeEnvSet();
  setupPackageJsonVersionOrThrow();
  ensureEnvNpmVersionSet();
  ensureMongoDBConnectionStringSet();
  ensurePortSet();
  envUtils.ensureBackgroundImageExists(__dirname);
  ensurePageTitle();
  ensureLogLevelSet();
  ensureSuperSecretKeySet();
}

/**
 * Checks for a valid “templates” folder under /server.
 * If missing, error out (different messaging depending on Docker / PM2 / /“pkg”).
 */
function getViewsPath() {
  const viewsPath = path.join(__dirname, 'templates');
  if (!fs.existsSync(viewsPath)) {
    if (isDocker()) {
      throw new Error(
        `Views folder not found at ${viewsPath} inside the Docker container.`
      );
    } else if (envUtils.isPm2()) {
      removePm2Service(
        `Views folder not found at ${viewsPath} when run under PM2. Double‐check your path.`
      );
    } else if (envUtils.isNodemon()) {
      throw new Error(
        `Views folder not found at ${viewsPath} when run under Nodemon. Double‐check your path.`
      );
    } else {
      throw new Error(
        `Views folder not found at ${viewsPath}.`
      );
    }
  } else {
    logger.debug('✓ Views folder found at:', { path: viewsPath });
  }
  return viewsPath;
}

/**
 * Run any pending migrate-mongo migrations before starting the server.
 */
async function runMigrations(db, client) {
  const migrationsStatus = await status(db);
  const pendingMigrations = migrationsStatus.filter((m) => m.appliedAt === 'PENDING');

  if (pendingMigrations.length) {
    logger.info(
      `! MongoDB has ${pendingMigrations.length} migrations left to run.`
    );
  } else {
    logger.info(
      `✓ MongoDB is up to date (${migrationsStatus.length} applied).`
    );
  }

  const migrationResult = await up(db, client);
  if (migrationResult.length > 0) {
    logger.info(
      `Applied ${migrationResult.length} migrations successfully:`,
      migrationResult
    );
  }
}

/**
 * Ensure page title is always defined (fallback to default).
 */
function ensurePageTitle() {
  if (!process.env[AppConstants.OCTOFARM_SITE_TITLE_KEY]) {
    process.env[AppConstants.OCTOFARM_SITE_TITLE_KEY] =
      AppConstants.defaultOctoFarmPageTitle?.toString();
  }
}

/**
 * Helper: is production environment?
 */
function isEnvProd() {
  return (
    process.env[AppConstants.NODE_ENV_KEY] ===
    AppConstants.defaultProductionEnv
  );
}

/**
 * Return the version of the client (from package-lock.json).
 */
function fetchClientVersion() {
  let version = packageLockFile?.dependencies[
    '@notexpectedyet/octofarm-client'
  ]?.version;
  if (!version) {
    version = 'unknown';
    logger.error(
      'Unable to parse @notexpectedyet/octofarm-client version from package-lock.json'
    );
  }
  return version;
}

/**
 * Return (and in .env, create if missing) the SUPER_SECRET_KEY.
 */
function fetchSuperSecretKey() {
  return process.env[AppConstants.SUPER_SECRET_KEY];
}

/**
 * If SUPER_SECRET_KEY missing, generate a default one, write to .env, and set it.
 */
function ensureSuperSecretKeySet() {
  const defaultKey = AppConstants.defaultSuperSecretKey;
  if (!process.env[AppConstants.SUPER_SECRET_KEY]) {
    logger.info(
      `~ ${AppConstants.SUPER_SECRET_KEY} not set. Generating a new one: ${defaultKey}`
    );
    envUtils.writeVariableToEnvFile(
      path.resolve(dotEnvPath),
      AppConstants.SUPER_SECRET_KEY,
      defaultKey
    );
    process.env[AppConstants.SUPER_SECRET_KEY] = defaultKey.toString();
  } else {
    logger.info(`✓ ${AppConstants.SUPER_SECRET_KEY} is set.`);
  }
}

// -----------------------------------------------------------------------------------------------------
// 2) EXPRESS‐RELATED FUNCTIONS (pulled from your “full code” snippet)
//    These four must be exported so that app-core.js / app.js can call them:
//      • setupExpressServer()
//      • ensureSystemSettingsInitiated()
//      • serveOctoFarmRoutes(app)
//      • serveOctoFarmNormally(app, quick_boot = false)
// -----------------------------------------------------------------------------------------------------

// Import everything Express needs:
const express = require('express');
const flash = require('connect-flash');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { octofarmGlobalLimits, printerActionLimits } = require('./middleware/rate-limiting');
const morganMiddleware = require('./middleware/morgan');
const passport = require('passport');
const ServerSettingsDB = require('./models/ServerSettings');
const expressLayouts = require('express-ejs-layouts');
const LoggerCore = require('./handlers/logger.js');
const { OctoFarmTasks } = require('./tasks');
const { optionalInfluxDatabaseSetup } = require('./services/influx-export.service.js');
const { getViewsPath: _getViewsPath } = require('./app-env'); // note: re-use getViewsPath above
const { SettingsClean } = require('./services/settings-cleaner.service');
const { TaskManager } = require('./services/task-manager.service');
const exceptionHandler = require('./exceptions/exception.handler');
const { fetchSuperSecretKey: _fetchSuperSecretKey } = require('./app-env');
const { sanitizeString } = require('./utils/sanitize-utils');
const { ensureClientServerVersion } = require('./middleware/client-server-version');
const { LOGGER_ROUTE_KEYS: LOGGER_KEYS } = require('./constants/logger.constants');
const { ensureAuthenticated } = require('./middleware/auth');
const { validateParamsMiddleware } = require('./middleware/validators');
const { proxyOctoPrintClientRequests } = require('./middleware/octoprint-proxy');
const rateLimit = require('express-rate-limit');
const M_VALID = require('./constants/validate-mongo.constants');

// Create a separate logger instance for the “core” server logic
const loggerCore = new LoggerCore(LOGGER_KEYS.SERVER_CORE);

// Rate limiter for login route (e.g. max 10 attempts/minute)
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 login attempts per windowMs
  message:
    'Too many login attempts from this IP, please try again after a minute',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Builds and returns a brand-new Express “app” instance:
 *   • sets up global rate limits, sanitization, Passport hooks, Morgan, Helmet, etc.
 *   • configures view engine (EJS), static folders (views, /images, /assets, etc.)
 *   • mounts cookieParser, express.urlencoded, session+MongoStore, flash, Passport
 */
function setupExpressServer() {
  const app = express();

  // Global rate limits & sanitization
  app.use(octofarmGlobalLimits);
  app.use(require('sanitize').middleware);

  // Passport initial configuration
  require('./middleware/passport.js')(passport);

  // Morgan (HTTP request logging) middleware
  app.use(morganMiddleware);

  // Helmet (security headers)
  app.use(helmet.dnsPrefetchControl());
  app.use(helmet.expectCt());
  app.use(helmet.hidePoweredBy());
  app.use(helmet.hsts());
  app.use(helmet.ieNoOpen());
  app.use(helmet.noSniff());
  app.use(helmet.originAgentCluster());
  app.use(helmet.permittedCrossDomainPolicies());
  app.use(helmet.referrerPolicy());
  app.use(helmet.xssFilter());

  // JSON body parsing
  app.use(express.json());

  // EJS / Express-Layouts setup
  const viewsPath = _getViewsPath(); // from getViewsPath() above
  app.set('views', viewsPath);
  app.set('view engine', 'ejs');
  app.use(expressLayouts);
  app.use(express.static(viewsPath));

  // Serve the React/Vite/whatever client assets folder, if present:
  const clientBase = path.join(__dirname, '../client/assets');
  app.use('/assets', express.static(clientBase));
  app.use('/css', express.static(path.join(clientBase, 'css')));
  app.use('/js', express.static(path.join(clientBase, 'js')));

  // Static “/images” served from project root /images
  app.use('/images', express.static(path.join(__dirname, '../images')));

  // Cookie parsing & URL-encoded body parser
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  // Express-Session using connect-mongo:
  app.use(
    session({
      secret: _fetchSuperSecretKey(),
      resave: false,
      saveUninitialized: true,
      store: MongoStore.create({
        mongoUrl: process.env[AppConstants.MONGO_KEY],
        ttl: 14 * 24 * 60 * 60, // 14 days
        autoRemove: 'native',
      }),
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(passport.authenticate('remember-me'));

  // Flash messages
  app.use(flash());
  app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    next();
  });

  return app;
}

/**
 * Before starting any HTTP routes, check that our “ServerSettings” collection/table
 * exists in MongoDB. If it fails (authentication error or cannot connect),
 * throw an error to abort startup.
 */
async function ensureSystemSettingsInitiated() {
  loggerCore.info('Checking server‐settings collection in MongoDB...');
  await ServerSettingsDB.find({}).catch((e) => {
    if (e.message.includes('command find requires authentication')) {
      throw new Error('Database authentication failed.');
    } else {
      throw new Error('Database connection failed.');
    }
  });
  // Once DB is connected, run any startup “cleanup” for settings
  return SettingsClean.initialise();
}

/**
 * Mount all of your OctoFarm routes onto the Express “app”:
 *   • health-check, /camera proxy, /octoprint proxy, /users, /printers, /settings, /filament, /history, /scripts, /input, /client, SSE events, etc.
 *   • ANY unmatched “*.min.js” request should return 404 + “Resource not found”
 *   • Otherwise redirect to “/” (so the React client can handle routing)
 *   • Finally use the global exception handler
 */
function serveOctoFarmRoutes(app) {
  app.use(ensureClientServerVersion);

  app.use('/', require('./routes/index', { page: 'route' }));
  app.use(
    '/camera',
    ensureAuthenticated,
    require('./routes/camera-proxy.routes.js', { page: 'route' })
  );
  app.use(
    '/octoprint/:id/:item(*)',
    ensureAuthenticated,
    validateParamsMiddleware(M_VALID.MONGO_ID),
    proxyOctoPrintClientRequests
  );
  app.use('/users', require('./routes/users.routes.js', { page: 'route' }));
  app.use(
    '/printers',
    printerActionLimits,
    require('./routes/printer-manager.routes.js', { page: 'route' })
  );
  app.use(
    '/settings',
    ensureAuthenticated,
    require('./routes/system-settings.routes.js', { page: 'route' })
  );
  app.use('/filament', require('./routes/filament-manager.routes.js', { page: 'route' }));
  app.use('/history', require('./routes/history.routes.js', { page: 'route' }));
  app.use(
    '/scripts',
    require('./routes/local-scripts-manager.routes.js', { page: 'route' })
  );
  app.use(
    '/input',
    require('./routes/external-data-collection.routes.js', { page: 'route' })
  );
  app.use('/client', require('./routes/printer-sorting.routes.js', { page: 'route' }));
  app.use(
    '/printersInfo',
    require('./routes/sse.printer-manager.routes.js', { page: 'route' })
  );
  app.use(
    '/dashboardInfo',
    require('./routes/sse.dashboard.routes.js', { page: 'route' })
  );
  app.use(
    '/monitoringInfo',
    require('./routes/sse.printer-monitoring.routes.js', { page: 'route' })
  );
  app.use('/events', require('./routes/sse.events.routes.js', { page: 'route' }));

  app.get('*', function (req, res) {
    const originalURL = sanitizeString(req.originalUrl);
    if (originalURL.endsWith('.min.js')) {
      res.status(404).send('Resource not found: ' + originalURL);
      return;
    }
    res.redirect('/');
  });

  app.use(exceptionHandler);
}

/**
 * After the routes are mounted, start all scheduled jobs (system startup tasks,
 * printer initialization, recurring tasks). Then attempt Influx setup (optional).
 * Finally return the same “app” so that app.js can call app.listen(...) on it.
 */
async function serveOctoFarmNormally(app, quick_boot = false) {
  if (!quick_boot) {
    loggerCore.info('Registering OctoFarm startup tasks and recurring jobs...');
    TaskManager.registerJobOrTask(OctoFarmTasks.SYSTEM_STARTUP_TASKS);
    TaskManager.registerJobOrTask(OctoFarmTasks.PRINTER_INITIALISE_TASK);
    for (let task of OctoFarmTasks.RECURRING_BOOT_TASKS) {
      TaskManager.registerJobOrTask(task);
    }
    try {
      await optionalInfluxDatabaseSetup();
    } catch (e) {
      loggerCore.error("Couldn't set up InfluxDB:", e.toString());
    }
  }

  serveOctoFarmRoutes(app);
  return app;
}

// -----------------------------------------------------------------------------------------------------
// 3) MODULE EXPORTS
// -----------------------------------------------------------------------------------------------------
module.exports = {
  // Environment/config exports:
  isEnvProd,
  setupEnvConfig,
  runMigrations,
  fetchMongoDBConnectionString,
  fetchOctoFarmPort,
  getViewsPath,
  fetchClientVersion,
  fetchSuperSecretKey,

  // Express-related exports:
  setupExpressServer,
  ensureSystemSettingsInitiated,
  serveOctoFarmRoutes,
  serveOctoFarmNormally,
};
