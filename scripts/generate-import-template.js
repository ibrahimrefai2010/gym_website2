// npm run import:template -- writes docs/member-import-template.xlsx (and
// the Arabic version) from the same definition the importer validates
// against (src/services/importService.js), so the template can never drift.
const fs = require("fs");
const path = require("path");
const importService = require("../src/services/importService");

(async () => {
  const dir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(dir, { recursive: true });
  for (const [lang, name] of [["en", "member-import-template.xlsx"], ["ar", "member-import-template-ar.xlsx"]]) {
    fs.writeFileSync(path.join(dir, name), Buffer.from(await importService.template("members", lang)));
    console.log(`docs/${name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
