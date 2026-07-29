/**
 * The SafeSend wizard driver — runs INSIDE a Vercel Sandbox (Playwright,
 * Chromium). Exported as a source string; the orchestrator writes it into
 * the sandbox and executes it with node.
 *
 * Deterministic port of spike/recipes/safesend.json:
 *   navigate SendLinkRedirect → fill recipient email → Verify →
 *   wait for the access code (the ORCHESTRATOR reads it from the mailbox
 *   and writes /vercel/sandbox/otp.txt — the driver just polls the file) →
 *   fill the 8 code boxes → Authenticate → Download All (ZIP; falls back
 *   to per-row Download links) → files land in /vercel/sandbox/downloads.
 *
 * Status protocol (stdout lines the orchestrator watches via status.txt):
 *   VERIFY_SENT | LOCKED | EXPIRED | DOWNLOADED <n> | FAILED <reason>
 */

export const SAFESEND_DRIVER_SOURCE = String.raw`
import { chromium } from "playwright-core";
import fs from "node:fs";
import { execSync } from "node:child_process";

const LINK = process.env.SS_LINK;
const RECIPIENT = process.env.SS_RECIPIENT;
const OTP_FILE = "/vercel/sandbox/otp.txt";
const OUT_DIR = "/vercel/sandbox/downloads";
const STATUS = "/vercel/sandbox/status.txt";
const status = (line) => { fs.appendFileSync(STATUS, line + "\n"); console.log(line); };

fs.mkdirSync(OUT_DIR, { recursive: true });
const exe = execSync("find /root/.cache/ms-playwright /home -name chrome -path '*chrome-linux*' 2>/dev/null | head -1").toString().trim();
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

try {
  await page.goto(LINK, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const body = (await page.textContent("body").catch(() => "")) || "";
  if (/locked/i.test(body) && /minutes/i.test(body)) { status("LOCKED"); process.exit(0); }
  if (/expired|no longer available/i.test(body)) { status("EXPIRED"); process.exit(0); }

  // Verify step: enter the ORIGINAL RECIPIENT's email (SafeSend validates it).
  const emailBox = page.getByPlaceholder(/email/i).or(page.locator('input[type="email"]')).first();
  await emailBox.fill(RECIPIENT, { timeout: 15000 });
  await page.getByRole("button", { name: /verify/i }).first().click({ timeout: 10000 });
  status("VERIFY_SENT");

  // The access code: orchestrator reads the mailbox and writes otp.txt.
  let code = null;
  const deadline = Date.now() + Number(process.env.SS_OTP_WAIT_MS || 210000);
  while (Date.now() < deadline) {
    if (fs.existsSync(OTP_FILE)) { code = fs.readFileSync(OTP_FILE, "utf8").trim(); break; }
    await page.waitForTimeout(2000);
  }
  if (!code) { status("FAILED otp-timeout"); process.exit(0); }

  // 8 individual boxes (recipe: fill_otp) — fall back to a single input.
  const boxes = page.locator('input[maxlength="1"]');
  if (await boxes.count() >= code.length) {
    for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]);
  } else {
    await page.locator('input[type="text"],input[type="tel"]').first().fill(code);
  }
  await page.getByRole("button", { name: /authenticate/i }).first().click({ timeout: 10000 });
  await page.waitForTimeout(4000);
  const after = (await page.textContent("body").catch(() => "")) || "";
  if (/invalid|incorrect/i.test(after) && /code/i.test(after)) { status("FAILED bad-code"); process.exit(0); }

  // Download All (ZIP). Recipe caveat: match the real control, not the
  // stepper label; fall back to per-row Download links.
  const saved = [];
  const tryDownload = async (locator) => {
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      locator.click(),
    ]);
    const name = dl.suggestedFilename();
    const to = OUT_DIR + "/" + name;
    await dl.saveAs(to);
    saved.push(name);
  };
  const all = page.getByRole("button", { name: /download all/i }).first();
  if (await all.count()) {
    await tryDownload(all).catch(() => {});
  }
  if (saved.length === 0) {
    const rows = page.getByRole("button", { name: /^download$/i });
    const n = await rows.count();
    for (let i = 0; i < n; i++) await tryDownload(rows.nth(i)).catch(() => {});
  }
  if (saved.length === 0) { status("FAILED no-download"); process.exit(0); }
  status("DOWNLOADED " + saved.length);
} catch (err) {
  status("FAILED " + String(err && err.message ? err.message : err).slice(0, 200).replace(/\n/g, " "));
} finally {
  await browser.close().catch(() => {});
}
`;
