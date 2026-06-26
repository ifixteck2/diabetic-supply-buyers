import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });
const password = await rl.question("Enter admin password to hash: ");
rl.close();

if (!password || password.length < 10) {
  console.error("Use a password at least 10 characters long.");
  process.exit(1);
}

const salt = crypto.randomBytes(18).toString("base64url");
const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
console.log(`scrypt$${salt}$${hash}`);
