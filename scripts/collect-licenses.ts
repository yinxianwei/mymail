/** Keep upstream notices in the desktop bundle without checking in generated files. */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sections: string[] = [
  "My Mail — original and third-party license notices\n\n" +
    "Includes runtime JavaScript dependencies, linked Go modules and bundled assets.\n" +
    "Each upstream component retains its own license; inclusion does not relicense it.\n",
];

function collect(name: string, directory: string) {
  const notices = readdirSync(directory).filter((file) =>
    /^(licen[sc]e|copying|notice|copyright)([.-].*)?$/i.test(file),
  );
  const texts: string[] = [];
  for (const file of notices.sort()) {
    // Some upstream packages use a LICENSE directory.
    const path = join(directory, file);
    const entry = readdirSync(directory, { withFileTypes: true }).find(
      (e) => e.name === file,
    );
    if (entry?.isFile()) texts.push(`${file}\n\n${readFileSync(path, "utf8")}`);
    else if (entry?.isDirectory()) {
      for (const child of readdirSync(path, { withFileTypes: true })) {
        if (child.isFile())
          texts.push(
            `${file}/${child.name}\n\n${readFileSync(join(path, child.name), "utf8")}`,
          );
      }
    }
  }
  if (!texts.length) {
    // Never silently omit a dependency with no standalone notice.
    const pkgPath = join(directory, "package.json");
    const pkg = existsSync(pkgPath)
      ? JSON.parse(readFileSync(pkgPath, "utf8"))
      : {};
    const readme = readdirSync(directory).find((f) =>
      /^readme(\.md|\.txt)?$/i.test(f),
    );
    texts.push(
      `Declared license: ${JSON.stringify(pkg.license ?? "see upstream")}`,
    );
    if (readme) texts.push(readFileSync(join(directory, readme), "utf8"));
    else
      throw new Error(
        `Missing license/notice for ${name}; inspect upstream before distributing.`,
      );
  }
  sections.push(
    `\n${"=".repeat(72)}\n${name}\n${"=".repeat(72)}\n\n${texts.join("\n\n")}`,
  );
}

collect("My Mail", root);
collect("Geist and Geist Mono — OFL-1.1", join(root, "src/assets/fonts"));

const modules = execFileSync(
  "go",
  [
    "list",
    "-deps",
    "-f",
    "{{if .Module}}{{.Module.Path}}\t{{.Module.Version}}\t{{.Module.Dir}}{{end}}",
    ".",
  ],
  { cwd: root, encoding: "utf8" },
);
for (const line of [
  ...new Set(modules.trim().split("\n").filter(Boolean)),
].sort()) {
  const [name, version, directory] = line.split("\t");
  if (!version) continue; // the main module is collected above
  if (!directory)
    throw new Error(`Go module not downloaded: ${name}. Run go mod download.`);
  collect(`${name} ${version}`, directory);
}

const seen = new Set<string>();
function packageDirectory(name: string, from: string): string | undefined {
  let parent = from;
  for (;;) {
    const candidate = join(parent, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const next = resolve(parent, "..");
    if (next === parent) return undefined;
    parent = next;
  }
}
function collectPackage(name: string, from: string, optional = false) {
  const directory = packageDirectory(name, from);
  if (!directory) {
    if (optional) return;
    throw new Error(`Missing installed dependency: ${name}`);
  }
  if (seen.has(directory)) return;
  seen.add(directory);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  collect(`${pkg.name} ${pkg.version}`, directory);
  for (const child of Object.keys(pkg.dependencies ?? {}).sort())
    collectPackage(child, directory);
  for (const child of Object.keys(pkg.optionalDependencies ?? {}).sort())
    collectPackage(child, directory, true);
}
const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const name of Object.keys(app.dependencies).sort())
  collectPackage(name, root);
mkdirSync(join(root, "resources/licenses"), { recursive: true });
writeFileSync(
  join(root, "resources/licenses/THIRD_PARTY_LICENSES.txt"),
  sections.join("\n"),
);
console.log(
  `Collected ${sections.length - 1} component notices in resources/licenses/THIRD_PARTY_LICENSES.txt`,
);
