(function () {
  // Client-side MFA utilities with multi-device support.
  // Exposes window.MFA with async functions.

  const RECOVERY_KEY_PEPPER = "athar_mfa_recovery_v1";

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToBuf(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  // Base32 (RFC4648) encoder/decoder
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let output = "";
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) {
      output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
  }

  function base32Decode(input) {
    const cleaned = String(input || "").replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
    const bytes = [];
    let bits = 0;
    let value = 0;
    for (let i = 0; i < cleaned.length; i++) {
      const idx = BASE32_ALPHABET.indexOf(cleaned.charAt(i));
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(bytes);
  }

  function randomBytes(len) {
    const b = new Uint8Array(len);
    crypto.getRandomValues(b);
    return b;
  }

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return bytesToHex(hash);
  }

  async function deriveAesKeyFromPassword(password, saltBase64, iterations = 100000) {
    const salt = base64ToBuf(saltBase64);
    const pwUtf8 = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey("raw", pwUtf8, { name: "PBKDF2" }, false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return key;
  }

  function normalizeRecoveryIdentifier(value) {
    return String(value || "").trim().toLowerCase();
  }

  function buildRecoveryPassphrase(userId, recoveryIdentifier) {
    return `${RECOVERY_KEY_PEPPER}:${userId}:${normalizeRecoveryIdentifier(recoveryIdentifier)}`;
  }

  async function encryptSecretWithPassword(secretUint8, password, iterations = 100000) {
    const salt = randomBytes(16);
    const saltB64 = bufToBase64(salt);
    const key = await deriveAesKeyFromPassword(password, saltB64, iterations);
    const iv = randomBytes(12);
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, secretUint8);
    return {
      cipher: bufToBase64(cipherBuf),
      salt: saltB64,
      iv: bufToBase64(iv.buffer),
      iterations,
    };
  }

  async function decryptSecretWithPassword(cipherB64, password, saltB64, ivB64, iterations = 100000) {
    try {
      const key = await deriveAesKeyFromPassword(password, saltB64, iterations);
      const ivBuf = base64ToBuf(ivB64);
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, base64ToBuf(cipherB64));
      return new Uint8Array(plainBuf);
    } catch (err) {
      return null;
    }
  }

  async function encryptSecretForRecovery(secretUint8, userId, recoveryIdentifier, iterations = 100000) {
    const passphrase = buildRecoveryPassphrase(userId, recoveryIdentifier);
    return encryptSecretWithPassword(secretUint8, passphrase, iterations);
  }

  async function decryptSecretForRecovery(cipherB64, userId, recoveryIdentifier, saltB64, ivB64, iterations = 100000) {
    const passphrase = buildRecoveryPassphrase(userId, recoveryIdentifier);
    return decryptSecretWithPassword(cipherB64, passphrase, saltB64, ivB64, iterations);
  }

  function intToBytes(num) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(4, num >>> 0);
    view.setUint32(0, Math.floor(num / 0x100000000));
    return new Uint8Array(buf);
  }

  async function totpVerifyBase32(secretBase32, code, digits = 6, period = 30, window = 1) {
    const secret = base32Decode(secretBase32);
    const counter = Math.floor(Date.now() / 1000 / period);
    for (let i = -window; i <= window; i++) {
      const c = counter + i;
      const cbuf = intToBytes(c);
      const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, cbuf);
      const sigBytes = new Uint8Array(sig);
      const offset = sigBytes[sigBytes.length - 1] & 0xf;
      const binary = ((sigBytes[offset] & 0x7f) << 24) |
        ((sigBytes[offset + 1] & 0xff) << 16) |
        ((sigBytes[offset + 2] & 0xff) << 8) |
        (sigBytes[offset + 3] & 0xff);
      const otp = (binary % Math.pow(10, digits)).toString().padStart(digits, "0");
      if (otp === String(code).padStart(digits, "0")) return true;
    }
    return false;
  }

  function makeProvisioningUri(issuer, account, secretBase32, digits = 6, period = 30) {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const query = `secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${digits}&period=${period}`;
    return `otpauth://totp/${label}?${query}`;
  }

  function generateSecretBase32(len = 20) {
    const bytes = randomBytes(len);
    return { bytes, base32: base32Encode(bytes) };
  }

  function generateBackupCodes(count = 8, length = 10) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let c = "";
      for (let j = 0; j < length; j++) {
        c += chars[Math.floor(Math.random() * chars.length)];
      }
      codes.push(c);
    }
    return codes;
  }

  async function hashStringHex(str) {
    const enc = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return bytesToHex(digest);
  }

  function generateDeviceId() {
    return "dev_" + bytesToHex(randomBytes(8));
  }

  // IDB wrappers (main.js provides ensureIdbInit/openIdb/idbGetMfaRecord/idbPutMfaRecord/idbDeleteMfaRecord)
  async function getMfaRecord(userId) {
    await ensureIdbInit();
    const db = await openIdb();
    let rec = await idbGetMfaRecord(db, userId);
    if (!rec) return null;
    // migrate legacy single-device record (top-level cipher) to devices array
    if (!Array.isArray(rec.devices) && rec.cipher) {
      const device = {
        deviceId: generateDeviceId(),
        name: rec.accountLabel || userId,
        issuer: rec.issuer || "Athar",
        cipher: rec.cipher,
        salt: rec.salt,
        iv: rec.iv,
        iterations: rec.iterations,
        algo: rec.algo || "TOTP",
        digits: rec.digits || 6,
        period: rec.period || 30,
        createdAt: rec.createdAt || new Date().toISOString(),
      };
      rec.devices = [device];
      // remove legacy top-level fields
      delete rec.cipher;
      delete rec.salt;
      delete rec.iv;
      delete rec.iterations;
      delete rec.accountLabel;
      delete rec.issuer;
      delete rec.algo;
      delete rec.digits;
      delete rec.period;
      // persist migrated record
      await putMfaRecord(rec);
    }
    return rec;
  }

  async function putMfaRecord(record) {
    await ensureIdbInit();
    const db = await openIdb();
    return await idbPutMfaRecord(db, record);
  }

  async function deleteMfaRecord(userId) {
    await ensureIdbInit();
    const db = await openIdb();
    return await idbDeleteMfaRecord(db, userId);
  }

  async function enrollForUser(userId, password, deviceName, issuerName, recoveryIdentifier) {
    console.log("[MFA] enrollForUser called", { userId, deviceName, issuerName });
    const { bytes, base32 } = generateSecretBase32(20);
    const uri = makeProvisioningUri(issuerName || "Athar", deviceName || userId, base32);
    const encResult = await encryptSecretWithPassword(bytes.buffer, password);
    const recoveryEncResult = await encryptSecretForRecovery(
      bytes.buffer,
      userId,
      recoveryIdentifier || deviceName || userId
    );

    let record = await getMfaRecord(userId);
    let isNew = false;
    let backupPlain = null;

    const deviceId = generateDeviceId();
    const device = {
      deviceId,
      name: deviceName || `جهاز ${deviceId}`,
      issuer: issuerName || "Athar",
      cipher: encResult.cipher,
      salt: encResult.salt,
      iv: encResult.iv,
      iterations: encResult.iterations,
      recoveryCipher: recoveryEncResult.cipher,
      recoverySalt: recoveryEncResult.salt,
      recoveryIv: recoveryEncResult.iv,
      recoveryIterations: recoveryEncResult.iterations,
      algo: "TOTP",
      digits: 6,
      period: 30,
      createdAt: new Date().toISOString(),
    };

    if (!record) {
      isNew = true;
      backupPlain = generateBackupCodes(8, 10);
      const backupHashed = [];
      for (const bc of backupPlain) {
        backupHashed.push({ hash: await hashStringHex(bc), used: false });
      }
      record = {
        userId,
        devices: [device],
        backupCodes: backupHashed,
        createdAt: new Date().toISOString(),
      };
    } else {
      if (!Array.isArray(record.devices)) record.devices = [];
      record.devices.push(device);
    }

    await putMfaRecord(record);
    return { provisioningUri: uri, secretBase32: base32, backupPlain, deviceId };
  }

  async function regenerateBackupCodes(userId, password, count = 8, length = 10) {
    const record = await getMfaRecord(userId);
    if (!record) return { ok: false, reason: "no_mfa" };
    const devices = record.devices || [];
    let canDecrypt = false;
    for (const d of devices) {
      const secretBytes = await decryptSecretWithPassword(d.cipher, password, d.salt, d.iv, d.iterations);
      if (secretBytes) {
        canDecrypt = true;
        break;
      }
    }
    if (!canDecrypt) return { ok: false, reason: "wrong_password" };

    const backupPlain = generateBackupCodes(count, length);
    const backupHashed = [];
    for (const bc of backupPlain) {
      backupHashed.push({ hash: await hashStringHex(bc), used: false });
    }
    record.backupCodes = backupHashed;
    await putMfaRecord(record);
    return { ok: true, backupPlain };
  }

  async function verifyWithPassword(userId, password, codeOrBackup) {
    const record = await getMfaRecord(userId);
    if (!record) return { ok: false, reason: "no_mfa" };
    // backup codes (account-level)
    if (typeof codeOrBackup === "string" && codeOrBackup.length > 6) {
      const h = await hashStringHex(codeOrBackup);
      const idx = (record.backupCodes || []).findIndex((b) => b.hash === h && !b.used);
      if (idx !== -1) {
        record.backupCodes[idx].used = true;
        await putMfaRecord(record);
        return { ok: true, method: "backup" };
      }
    }

    // try each device
    const devices = record.devices || [];
    let anyDecrypted = false;
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      const secretBytes = await decryptSecretWithPassword(d.cipher, password, d.salt, d.iv, d.iterations);
      if (!secretBytes) continue;
      anyDecrypted = true;
      const secretBase32 = base32Encode(secretBytes);
      const ok = await totpVerifyBase32(secretBase32, String(codeOrBackup).trim(), d.digits || 6, d.period || 30, 1);
      if (ok) {
        // update lastUsed
        d.lastUsedAt = new Date().toISOString();
        await putMfaRecord(record);
        return { ok: true, method: "totp", deviceId: d.deviceId };
      }
    }

    if (!anyDecrypted) return { ok: false, reason: "wrong_password_or_corrupt" };
    return { ok: false, method: "invalid" };
  }

  async function verifyForRecovery(userId, recoveryIdentifier, code) {
    const record = await getMfaRecord(userId);
    if (!record) return { ok: false, reason: "no_mfa" };

    const devices = record.devices || [];
    let anyRecoveryCapableDevice = false;

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (!d.recoveryCipher || !d.recoverySalt || !d.recoveryIv) {
        continue;
      }
      anyRecoveryCapableDevice = true;
      const secretBytes = await decryptSecretForRecovery(
        d.recoveryCipher,
        userId,
        recoveryIdentifier,
        d.recoverySalt,
        d.recoveryIv,
        d.recoveryIterations
      );
      if (!secretBytes) {
        continue;
      }
      const secretBase32 = base32Encode(secretBytes);
      const ok = await totpVerifyBase32(secretBase32, String(code || "").trim(), d.digits || 6, d.period || 30, 1);
      if (ok) {
        return { ok: true, method: "totp", deviceId: d.deviceId };
      }
    }

    if (!anyRecoveryCapableDevice) return { ok: false, reason: "recovery_not_available" };
    return { ok: false, reason: "invalid" };
  }

  async function ensureRecoveryAccess(userId, password, recoveryIdentifier) {
    const record = await getMfaRecord(userId);
    if (!record) return { ok: false, reason: "no_mfa" };

    const devices = record.devices || [];
    let updatedCount = 0;

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (d.recoveryCipher && d.recoverySalt && d.recoveryIv) {
        continue;
      }
      const secretBytes = await decryptSecretWithPassword(d.cipher, password, d.salt, d.iv, d.iterations);
      if (!secretBytes) {
        continue;
      }
      const recoveryEncResult = await encryptSecretForRecovery(
        secretBytes.buffer,
        userId,
        recoveryIdentifier
      );
      d.recoveryCipher = recoveryEncResult.cipher;
      d.recoverySalt = recoveryEncResult.salt;
      d.recoveryIv = recoveryEncResult.iv;
      d.recoveryIterations = recoveryEncResult.iterations;
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      await putMfaRecord(record);
    }

    return { ok: true, updatedCount };
  }

  async function rewrapForPasswordReset(userId, recoveryIdentifier, newPassword) {
    const record = await getMfaRecord(userId);
    if (!record) return { ok: false, reason: "no_mfa" };

    const devices = record.devices || [];
    if (!devices.length) return { ok: false, reason: "no_devices" };

    let updatedCount = 0;
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (!d.recoveryCipher || !d.recoverySalt || !d.recoveryIv) {
        continue;
      }
      const secretBytes = await decryptSecretForRecovery(
        d.recoveryCipher,
        userId,
        recoveryIdentifier,
        d.recoverySalt,
        d.recoveryIv,
        d.recoveryIterations
      );
      if (!secretBytes) {
        continue;
      }
      const passwordEncResult = await encryptSecretWithPassword(secretBytes.buffer, newPassword);
      d.cipher = passwordEncResult.cipher;
      d.salt = passwordEncResult.salt;
      d.iv = passwordEncResult.iv;
      d.iterations = passwordEncResult.iterations;
      updatedCount += 1;
    }

    if (!updatedCount) return { ok: false, reason: "recovery_failed" };

    await putMfaRecord(record);
    return { ok: true, updatedCount };
  }

  async function getMfaDevices(userId) {
    const rec = await getMfaRecord(userId);
    if (!rec) return [];
    const devices = Array.isArray(rec.devices) ? rec.devices : [];
    return devices.map((d) => ({ deviceId: d.deviceId, name: d.name, issuer: d.issuer, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt || null }));
  }

  async function deleteMfaDevice(userId, deviceId, password) {
    const rec = await getMfaRecord(userId);
    if (!rec) return { ok: false, reason: "no_mfa" };
    const devices = rec.devices || [];
    const idx = devices.findIndex((x) => x.deviceId === deviceId);
    if (idx === -1) return { ok: false, reason: "not_found" };
    const dev = devices[idx];
    if (password) {
      const secret = await decryptSecretWithPassword(dev.cipher, password, dev.salt, dev.iv, dev.iterations);
      if (!secret) return { ok: false, reason: "wrong_password" };
    }
    devices.splice(idx, 1);
    if (devices.length === 0) {
      await deleteMfaRecord(userId);
      return { ok: true, deletedAll: true };
    }
    rec.devices = devices;
    await putMfaRecord(rec);
    return { ok: true, deletedAll: false };
  }

  async function renameMfaDevice(userId, deviceId, newName) {
    const rec = await getMfaRecord(userId);
    if (!rec) return { ok: false };
    const dev = (rec.devices || []).find((d) => d.deviceId === deviceId);
    if (!dev) return { ok: false };
    dev.name = newName;
    await putMfaRecord(rec);
    return { ok: true };
  }

  // expose API
  window.MFA = {
    base32Encode,
    base32Decode,
    generateSecretBase32,
    makeProvisioningUri,
    encryptSecretWithPassword,
    decryptSecretWithPassword,
    enrollForUser,
    verifyWithPassword,
    verifyForRecovery,
    ensureRecoveryAccess,
    getMfaRecord,
    getMfaDevices,
    deleteMfaRecord,
    deleteMfaDevice,
    renameMfaDevice,
    generateBackupCodes,
    regenerateBackupCodes,
    rewrapForPasswordReset,
    totpVerifyBase32,
  };

})();
