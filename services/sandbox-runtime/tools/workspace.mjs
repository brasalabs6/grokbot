#!/usr/bin/env node
/** Authenticated control-plane helper. Never serve directly over the network. */
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

const ROOT = "/workspace";
const MAX_FILE = 48 * 1024;
const MAX_ITEMS = 200;
const method = process.argv[2];
const path = process.argv[3] ?? ".";
function reject(code) {
  process.stdout.write(JSON.stringify({ error: { code }, ok: false }));
  process.exitCode = 1;
}
async function safePath(relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 1024 ||
    isAbsolute(relative) ||
    relative.includes("\0") ||
    relative.split(/[\\/]+/).includes("..")
  ) {
    throw new Error("INVALID_WORKSPACE_PATH");
  }
  const root = await realpath(ROOT);
  const destination = resolve(root, relative);
  if (destination !== root && !destination.startsWith(root + sep)) {
    throw new Error("WORKSPACE_TRAVERSAL");
  }
  const actual = await realpath(destination);
  if (actual !== root && !actual.startsWith(root + sep)) {
    throw new Error("WORKSPACE_SYMLINK_ESCAPE");
  }
  const info = await lstat(destination);
  if (info.isSymbolicLink()) {
    throw new Error("SYMLINK_NOT_ALLOWED");
  }
  return { destination, info, root };
}
try {
  if (!["list", "read"].includes(method)) {
    throw new Error("INVALID_WORKSPACE_OPERATION");
  }
  const { destination, root, info } = await safePath(path);
  if (method === "list") {
    if (!info.isDirectory()) {
      throw new Error("NOT_A_DIRECTORY");
    }
    const entries = await readdir(destination, { withFileTypes: true });
    const sorted = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_ITEMS);
    const items = await Promise.all(
      sorted.map(async (item) => {
        const entry = resolve(destination, item.name);
        const stat = await lstat(entry);
        return {
          modifiedAt: stat.mtime.toISOString(),
          name: item.name,
          size: stat.size,
          type: item.isSymbolicLink()
            ? "symlink"
            : item.isDirectory()
              ? "directory"
              : item.isFile()
                ? "file"
                : "other",
        };
      })
    );
    process.stdout.write(
      JSON.stringify({
        items,
        kind: "directory",
        ok: true,
        path,
        total: entries.length,
        truncated: entries.length > MAX_ITEMS,
      })
    );
  } else {
    if (!info.isFile()) {
      throw new Error("NOT_A_REGULAR_FILE");
    }
    if (info.size > MAX_FILE) {
      throw new Error("FILE_TOO_LARGE");
    }
    const bytes = await readFile(destination);
    if (bytes.includes(0)) {
      throw new Error("BINARY_FILE_UNSUPPORTED");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    process.stdout.write(
      JSON.stringify({
        content: text,
        kind: "file",
        modifiedAt: info.mtime.toISOString(),
        ok: true,
        path,
        size: info.size,
      })
    );
  }
} catch (error) {
  reject(error instanceof Error ? error.message : "WORKSPACE_ERROR");
}
