// server/utils/env.utils.js

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const isDocker = require("is-docker");
const Logger = require("../handlers/logger.js");
const { LOGGER_ROUTE_KEYS } = require("../constants/logger.constants");

const logger = new Logger(LOGGER_ROUTE_KEYS.UTILS_ENV_LOGGER, false);

/**
 * Detect if running under PM2 (by checking for known PM2 env vars).
 */
function isPm2() {
  return (
    "PM2_HOME" in process.env ||
    "PM2_JSON_PROCESSING" in process.env ||
    "PM2_CLI" in process.env
  );
}

/**
 * Detect if running under nodemon (by looking at the lifecycle script).
 */
function isNodemon() {
  return (
    "npm_lifecycle_script" in process.env &&
    process.env.npm_lifecycle_script.includes("nodemon")
  );
}

/**
 * Detect if running inside a PKG‐wrapped binary (NODE will be defined by PKG).
 */
function isNode() {
  return "NODE" in process.env;
}

/**
 * Convert an object of key/value pairs into a dotenv‐style string.
 * Copied/adapted from https://github.com/bevry/envfile
 *
 * @param {{ [key: string]: string }} obj
 * @returns {string}
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
 * Write or update one environment variable in the .env file.
 *
 * @param {string} absoluteEnvPath  Absolute path to the .env file (e.g. "/OctoFarm/.env")
 * @param {string} variableKey      The key to set (e.g. "MONGO")
 * @param {string|number} variableValue  The value to write (e.g. "mongodb://127.0.0.1:27017/octofarm")
 */
function writeVariableToEnvFile(absoluteEnvPath, variableKey, variableValue) {
  if (isDocker()) {
    logger.error("Attempted to write to .env within Docker—skipping persistence.");
    return;
  }

  // Load existing .env (if present)
  const configResult = dotenv.config({ path: absoluteEnvPath });
  if (configResult.error && configResult.error.code === "ENOENT") {
    logger.warning(`.env not found at ${absoluteEnvPath}, creating a new one.`);
  } else if (configResult.error) {
    logger.error("Failed to parse existing .env file:", configResult.error);
    throw new Error(
      "Could not parse current .env file. Please ensure it contains valid KEY=VALUE lines."
    );
  }

  // Merge old values with the new one
  const newEnv = {
    ...(configResult.parsed || {}),
    [variableKey]: String(variableValue),
  };

  const newDotEnvContent = stringifyDotEnv(newEnv);

  try {
    fs.writeFileSync(absoluteEnvPath, newDotEnvContent);
    logger.info(`Updated ${variableKey} in ${absoluteEnvPath}`);
  } catch (err) {
    logger.error(`Failed to write to .env at ${absoluteEnvPath}`, err);
    throw err;
  }
}

/**
 * Verify that package.json exists at the given rootPath and has the correct "name" field.
 *
 * @param {string} rootPath  Absolute path to the project root (e.g. "/OctoFarm")
 * @returns {boolean}        True if package.json is found and named "octofarm-server"
 */
function verifyPackageJsonRequirements(rootPath) {
  const packageJsonPath = path.join(rootPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    logger.error(`Could not find 'package.json' in ${rootPath}`);
    return false;
  }

  let pkg;
  try {
    pkg = require(packageJsonPath);
  } catch (err) {
    logger.error("Failed to load package.json:", err);
    return false;
  }

  const packageName = (pkg.name || "").toLowerCase();
  if (!packageName) {
    logger.error("Missing 'name' in package.json. Aborting OctoFarm.");
    return false;
  }

  if (packageName !== "octofarm-server") {
    logger.error(
      `Unexpected package.json name: '${packageName}'. Expected 'octofarm-server'. Aborting.`
    );
    return false;
  }

  logger.debug("✓ Verified package.json of octofarm-server");
  return true;
}

/**
 * Ensure that a background image (bg.jpg) exists under "<rootPath>/images".
 * If the "images" folder does not exist, create it. If bg.jpg is missing,
 * copy the default from "server/utils/bg_default.jpg".
 *
 * @param {string} rootPath  Absolute path to project root (e.g. "/OctoFarm")
 */
function ensureBackgroundImageExists(rootPath) {
  // 1) Build absolute path to "<rootPath>/images"
  const targetBgDir = path.resolve(rootPath, "images");
  const targetBgPath = path.join(targetBgDir, "bg.jpg");

  // 2) If "<rootPath>/images" doesn’t exist, make it.
  if (!fs.existsSync(targetBgDir)) {
    try {
      fs.mkdirSync(targetBgDir, { recursive: true });
      logger.info(`Created images directory at ${targetBgDir}`);
    } catch (err) {
      logger.error(`Failed to create images directory: ${targetBgDir}`, err);
      return;
    }
  }

  // 3) If "bg.jpg" is missing, copy default
  if (!fs.existsSync(targetBgPath)) {
    // Assume default lives at "<rootPath>/server/utils/bg_default.jpg"
    const defaultBgPath = path.resolve(rootPath, "server/utils/bg_default.jpg");

    if (!fs.existsSync(defaultBgPath)) {
      logger.error("Cannot find default background:", defaultBgPath);
      return;
    }

    try {
      const fileBuffer = fs.readFileSync(defaultBgPath);
      fs.writeFileSync(targetBgPath, fileBuffer);
      logger.info(`✓ Copied default background image to ${targetBgPath}`);
    } catch (err) {
      logger.error(
        `Failed to copy bg_default.jpg → ${targetBgPath}`,
        err
      );
    }
  } else {
    logger.debug(`Background already exists at ${targetBgPath}`);
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
