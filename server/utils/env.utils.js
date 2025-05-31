// server/utils/env.utils.js

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const isDocker = require("is-docker"); // note: `require("is-docker")` returns a boolean
const Logger = require("../handlers/logger.js");
const { LOGGER_ROUTE_KEYS } = require("../constants/logger.constants");

// We pass `false` as the second argument so that logger doesn’t try to write to a “logs/” folder before we create it.
const logger = new Logger(LOGGER_ROUTE_KEYS.UTILS_ENV_LOGGER, false);

/**
 * Returns true if the process is running under PM2.
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
 * Returns true if NODE was explicitly invoked (rare).
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
 * Write (or update) a single key=value pair in the given .env file.
 *
 * - absoluteEnvPath must be an absolute path to the .env file (e.g. /OctoFarm/.env).
 * - variableKey is the environment‐variable name (e.g. "SUPER_SECRET_KEY").
 * - variableValue is the new value (string, number, etc).
 *
 * In Docker containers we do not persist .env changes, so if isDocker is true we simply bail out.
 */
function writeVariableToEnvFile(absoluteEnvPath, variableKey, variableValue) {
  if (isDocker) {
    logger.error("Tried to persist setting to .env in Docker mode. Skipping.");
    return;
  }

  // Load the current .env (if missing, dotenv.config() will set .parsed to {} and .error.code === "ENOENT")
  const current = dotenv.config({ path: absoluteEnvPath });
  if (current.error && current.error.code !== "ENOENT") {
    logger.error("Could not parse existing .env file:", current.error);
    throw new Error(
      "Failed to parse .env file. Make sure it uses KEY=VALUE lines only."
    );
  }
  if (current.error && current.error.code === "ENOENT") {
    logger.warning("Creating .env file because it did not exist:", absoluteEnvPath);
  }

  // Merge existing parsed values (if any) with the new one:
  const newEnvObject = {
    ...((current.parsed && typeof current.parsed === "object") ? current.parsed : {}),
    [variableKey]: variableValue,
  };

  // Serialize back to text:
  const newEnvText = stringifyDotEnv(newEnvObject);
  fs.writeFileSync(absoluteEnvPath, newEnvText);
  logger.info(`✓ Wrote ${variableKey} to ${absoluteEnvPath}`);
}

/**
 * Verify that package.json exists at project root and has name === "octofarm-server".
 *
 * Returns true if everything checks out, or false (and logs errors) if not.
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
 * Ensure that an /images folder exists under the project root,
 * and that a "bg.jpg" is present. If missing, copy over the default.
 *
 * - rootPath should be the absolute path to your project’s root directory (e.g. "/OctoFarm").
 *
 * This no longer tries to create “../images” relative to the running directory;
 * instead it always uses the project root in order to avoid EACCES when PM2 is launched.
 */
function ensureBackgroundImageExists(rootPath) {
  // 1) Target directory for runtime images:
  const targetBgDir = path.join(rootPath, "images");
  const targetBgPath = path.join(targetBgDir, "bg.jpg");

  // 2) If /images folder does not exist yet, create it:
  if (!fs.existsSync(targetBgDir)) {
    try {
      fs.mkdirSync(targetBgDir, { recursive: true });
      logger.info("✓ Created images folder at:", targetBgDir);
    } catch (mkdirErr) {
      logger.error("✗ Failed to create images folder:", mkdirErr);
      return;
    }
  }

  // 3) If bg.jpg is already present, we’re done:
  if (fs.existsSync(targetBgPath)) {
    logger.debug("✓ Background image already exists:", targetBgPath);
    return;
  }

  // 4) Otherwise, attempt to copy the default from server/utils/bg_default.jpg
  //    We assume bg_default.jpg sits in <root>/server/utils/bg_default.jpg
  const defaultBgPath = path.join(rootPath, "server", "utils", "bg_default.jpg");
  if (!fs.existsSync(defaultBgPath)) {
    logger.error("✗ Cannot find default background at:", defaultBgPath);
    return;
  }

  // 5) Copy default → <root>/images/bg.jpg
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
