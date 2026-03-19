import path from "node:path";
import os from "node:os";

/** Global config directory: ~/.config/toby */
export const GLOBAL_CONFIG_DIR = path.join(
	os.homedir(),
	".config",
	"toby",
);

/** Local config directory relative to project root */
export const LOCAL_CONFIG_DIR = ".toby";

/** Default specs directory name */
export const DEFAULT_SPECS_DIR = "specs";

/** PRD output directory relative to local config */
export const PRD_DIR = "prd";

/** Status file name */
export const STATUS_FILE = "status.json";

/** Config file name */
export const CONFIG_FILE = "toby.config.json";
