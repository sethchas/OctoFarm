// server/utils/env.utils.js

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const isDocker = require("is-docker"); // note: isDocker is a function
const Logger = require("../handlers/logger.js");
const { LOGGER_ROUTE_KEYS } = require("../constants/logger.constants");

// We pass `false` so that this logger doesn’t try to write into a logs/ folder
// before we create it.  (It will still print to the console.)
const logger = new Logger(LOGGER_ROUTE_KEYS.UTILS_ENV_LOGGER, false);

/**
 * Returns true if PM2 is running this process.
 */
function isPm2() {
  return (
    "PM2_HOME" in process.env ||
    "PM2_JSON_PROCESSING" in process.env ||
    "PM2_CLI" in process.env
  );
}

/**
 * Returns true if nodemon is running this script.
 */
function isNodemon() {
  return (
    "npm_lifecycle_script" in process.env &&
    process.env.npm_lifecycle_script.includes("nodemon")
  );
}

/**
 * Returns true if someone explicitly set NODE in env (rare).
 */
function isNode() {
  return "NODE" in process.env;
}

/**
 * Turn an object into a string suitable for writing to a .env file.
 * (Copied from https://github.com/bevry/envfile)
 */
function stringifyDotEnv(obj) {
  let result = "";
  for (const [key, value] of Object.entries(obj)) {
    if (!key) continue;
    const line = `${key}=${String(value)}`;
    result += line + "\n";
  }
  return result;
}

/**
 * Write or update one key=value pair in the given .env file (absolute path).
 *
 * If we detect we’re in Docker, bail out early (we don’t persist .env inside containers).
 */
function writeVariableToEnvFile(absoluteEnvPath, variableKey, variableValue) {
  if (isDocker()) {
    logger.error("Tried to persist setting to .env in Docker mode. Skipping.");
    return;
  }

  // Load whatever is already in .env (if missing, parsed will be {}, error.code==="ENOENT")
  const loaded = dotenv.config({ path: absoluteEnvPath });
  if (loaded.error && loaded.error.code !== "ENOENT") {
    logger.error("Could not parse existing .env file:", loaded.error);
    throw new Error(
      "Failed to parse .env file. Make sure it only contains KEY=VALUE lines."
    );
  }
  if (loaded.error && loaded.error.code === "ENOENT") {
    logger.warning("Creating .env file because it did not exist:", absoluteEnvPath);
  }

  // Merge the old values with the new one
  const newEnvObject = {
    ...((loaded.parsed && typeof loaded.parsed === "object") ? loaded.parsed : {}),
    [variableKey]: variableValue,
  };

  // Serialize back to text and overwrite
  const newEnvText = stringifyDotEnv(newEnvObject);
  fs.writeFileSync(absoluteEnvPath, newEnvText);
  logger.info(`✓ Wrote ${variableKey} to ${absoluteEnvPath}`);
}

/**
 * Verify that package.json exists at project root (rootPath) and has name=== "octofarm-server".
 * Returns true if OK, false (and logs errors) otherwise.
 */
function verifyPackageJsonRequirements(rootPath) {
  try {
    const dirContents = fs.readdirSync(rootPath);
    if (!dirContents.includes("package.json")) {
      logger.error(`FAILURE: could not find 'package.json' in root (${rootPath})`);
      return false;
    }
    const pkg = require(path.join(rootPath, "package.json"));
    if (!pkg.name) {
      logger.error("X 'name' property is missing from package.json. Aborting.");
      return false;
    }
    if (pkg.name.toLowerCase() !== "octofarm-server") {
      logger.error(
        `X package.json.name (${pkg.name.toLowerCase()}) !== 'octofarm-server'. Aborting.`
      );
      return false;
    }
    logger.debug("✓ Validated package.json name === 'octofarm-server'.");
    return true;
  } catch (err) {
    logger.error("Error while verifying package.json requirements:", err);
    return false;
  }
}

/**
 * Ensure that <rootPath>/images exists and that a bg.jpg is present.
 * If missing, copy the default from server/utils/bg_default.jpg.
 *
 * - rootPath should be your project’s absolute root (e.g. "/OctoFarm").
 *   You typically calculate this in app-env.js via `path.resolve(__dirname, "..")`.
 */
function ensureBackgroundImageExists(rootPath) {
  // 1) Where we want <rootPath>/images
  const targetBgDir = path.join(rootPath, "images");
  const targetBgPath = path.join(targetBgDir, "bg.jpg");

  // 2) If /images doesn’t exist, create it:
  if (!fs.existsSync(targetBgDir)) {
    try {
      fs.mkdirSync(targetBgDir, { recursive: true });
      logger.info("✓ Created images folder at:", targetBgDir);
    } catch (mkdirErr) {
      logger.error("✗ Failed to create images folder:", mkdirErr);
      return;
    }
  }

  // 3) If bg.jpg already exists, we’re done:
  if (fs.existsSync(targetBgPath)) {
    logger.debug("✓ Background image already exists:", targetBgPath);
    return;
  }

  // 4) Otherwise, copy the default.  (bg_default.jpg is in server/utils alongside this file.)
  const defaultBgPath = path.join(__dirname, "bg_default.jpg");
  if (!fs.existsSync(defaultBgPath)) {
    logger.error("✗ Cannot find default background at:", defaultBgPath);
    return;
  }

  // 5) Copy default → <rootPath>/images/bg.jpg
  try {
    const buffer = fs.readFileSync(defaultBgPath);
    fs.writeFileSync(targetBgPath, buffer);
    logger.info(`✓ Copied default background to ${targetBgPath}`);
  } catch (copyErr) {
    logger.error("✗ Failed to copy default background:", copyErr);
  }
}

module.exports = {
  isPm2,
  isNodemon,
  isNode,
  writeVariableToEnvFile,
  verifyPackageJsonRequirements,
  ensureBackgroundImageExists,
};
