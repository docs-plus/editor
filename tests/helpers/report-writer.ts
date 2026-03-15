import fs from "node:fs";
import path from "node:path";

/**
 * Writes a JSON report to test-reports/.
 * Ensures directory exists.
 */
export function writeReport(
  filename: string,
  data: Record<string, unknown>,
): string {
  const outDir = path.join(process.cwd(), "test-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  return filepath;
}
