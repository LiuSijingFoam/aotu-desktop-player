import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const privateConfigFiles = [".env", ".env.local"];
const allowedKeys = [
  "AOTU_MEDIA_SALT",
  "AOTU_API_BASE_URL",
  "AOTU_H5_HOME_URL",
  "AOTU_APP_USER_AGENT",
  "AOTU_PUBLIC_USER_AGENT",
];

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readPrivateConfig() {
  const combined = {};
  for (const filename of privateConfigFiles) {
    try {
      Object.assign(
        combined,
        parseEnv(await fs.readFile(path.join(projectRoot, filename), "utf8")),
      );
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return combined;
}

const privateConfig = await readPrivateConfig();
const runtimeConfig = {};
for (const key of allowedKeys) {
  const value = process.env[key] ?? privateConfig[key];
  if (typeof value === "string" && value.trim()) {
    runtimeConfig[key] = value.trim();
  }
}

if (
  !runtimeConfig.AOTU_MEDIA_SALT ||
  runtimeConfig.AOTU_MEDIA_SALT.startsWith("replace-with-") ||
  runtimeConfig.AOTU_MEDIA_SALT.length < 16
) {
  throw new Error(
    "请先在未提交的 .env.local 中设置有效的 AOTU_MEDIA_SALT，再打包桌面应用。",
  );
}

// Sites metadata is not part of the Windows desktop distribution.
await fs.rm(path.join(projectRoot, "dist", ".openai"), {
  recursive: true,
  force: true,
});

const outputDir = path.join(projectRoot, ".desktop");
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, "runtime-config.json"),
  `${JSON.stringify(runtimeConfig, null, 2)}\n`,
  { mode: 0o600 },
);

process.stdout.write("桌面运行配置已准备完成。\n");
