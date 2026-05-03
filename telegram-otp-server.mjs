import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "";
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const sessions = new Map();
let telegramOffset = 0;
let telegramPollInFlight = false;

function json(res, status, payload) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify(payload));
}

function generateSessionId() {
    return randomBytes(12).toString("hex");
}

function generateOtpCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function isSessionExpired(session) {
    return !session || Date.now() > session.expiresAt;
}

function sanitizeLabel(value) {
    return String(value || "").trim().slice(0, 120);
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function callTelegram(method, body) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error("telegram-token-missing");
    }

    const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );

    const result = await response.json();
    if (!response.ok || !result.ok) {
        throw new Error(result.description || `telegram-${method}-failed`);
    }
    return result.result;
}

async function sendTelegramMessage(chatId, text) {
    return callTelegram("sendMessage", {
        chat_id: chatId,
        text,
    });
}

async function handleTelegramStartCommand(message) {
    const text = String(message?.text || "").trim();
    const match = text.match(/^\/start(?:\s+verify_([a-f0-9]+))?$/i);
    const chatId = message?.chat?.id;

    if (!chatId) return;

    if (!match || !match[1]) {
        await sendTelegramMessage(
            chatId,
            "أهلًا بك. افتحي رابط التحقق من داخل منصة أثر ليصلك رمز التحقق هنا."
        );
        return;
    }

    const sessionId = match[1];
    const session = sessions.get(sessionId);
    if (!session || isSessionExpired(session)) {
        await sendTelegramMessage(
            chatId,
            "انتهت صلاحية جلسة التحقق. ارجعي إلى منصة أثر واطلبي رمزًا جديدًا."
        );
        return;
    }

    session.chatId = chatId;
    session.telegramUserId = message?.from?.id || "";
    session.telegramUsername = message?.from?.username || "";
    session.deliveredAt = Date.now();

    await sendTelegramMessage(
        chatId,
        [
            `رمز التحقق الخاص بك في منصة أثر هو: ${session.code}`,
            `صلاحية الرمز: 5 دقائق`,
            `الهوية المرتبطة: ${session.label || "غير محددة"}`,
        ].join("\n")
    );
}

async function pollTelegramUpdates() {
    if (!TELEGRAM_BOT_TOKEN || telegramPollInFlight) return;

    telegramPollInFlight = true;
    try {
        const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=20&offset=${telegramOffset}`
        );
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload.description || "telegram-getUpdates-failed");
        }

        for (const update of payload.result || []) {
            telegramOffset = Math.max(telegramOffset, (update.update_id || 0) + 1);
            if (update.message?.text?.startsWith("/start")) {
                await handleTelegramStartCommand(update.message);
            }
        }
    } catch (error) {
        console.error("Telegram polling error:", error.message);
    } finally {
        telegramPollInFlight = false;
    }
}

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (now > session.expiresAt + 60_000) {
            sessions.delete(sessionId);
        }
    }
}

const server = createServer(async (req, res) => {
    if (!req.url) {
        json(res, 400, { ok: false, error: "invalid-request" });
        return;
    }

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/telegram/health") {
        json(res, 200, {
            ok: true,
            botConfigured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_USERNAME),
            botUsername: TELEGRAM_BOT_USERNAME,
        });
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/telegram/request-otp") {
        try {
            if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_BOT_USERNAME) {
                json(res, 503, {
                    ok: false,
                    error: "telegram-not-configured",
                });
                return;
            }

            const body = await readJsonBody(req);
            const label = sanitizeLabel(body.label || body.email || body.phone);
            if (!label) {
                json(res, 400, { ok: false, error: "missing-label" });
                return;
            }

            const sessionId = generateSessionId();
            const code = generateOtpCode();
            const expiresAt = Date.now() + OTP_TTL_MS;

            sessions.set(sessionId, {
                sessionId,
                code,
                label,
                createdAt: Date.now(),
                expiresAt,
                attempts: 0,
                deliveredAt: null,
                chatId: null,
                telegramUserId: "",
                telegramUsername: "",
                verifiedAt: null,
            });

            json(res, 200, {
                ok: true,
                sessionId,
                expiresAt,
                botUsername: TELEGRAM_BOT_USERNAME,
                botUrl: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=verify_${sessionId}`,
            });
        } catch (error) {
            console.error(error);
            json(res, 500, { ok: false, error: "request-otp-failed" });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/telegram/verify-otp") {
        try {
            const body = await readJsonBody(req);
            const session = sessions.get(String(body.sessionId || ""));
            if (!session || isSessionExpired(session)) {
                json(res, 410, { ok: false, error: "session-expired" });
                return;
            }

            session.attempts += 1;
            if (session.attempts > OTP_MAX_ATTEMPTS) {
                sessions.delete(session.sessionId);
                json(res, 429, { ok: false, error: "too-many-attempts" });
                return;
            }

            const submittedCode = String(body.code || "").trim();
            if (submittedCode !== session.code) {
                json(res, 400, { ok: false, error: "invalid-code" });
                return;
            }

            session.verifiedAt = Date.now();

            json(res, 200, {
                ok: true,
                verificationMethod: "telegram",
                telegramUserId: session.telegramUserId,
                telegramUsername: session.telegramUsername,
                chatId: session.chatId,
            });
        } catch (error) {
            console.error(error);
            json(res, 500, { ok: false, error: "verify-otp-failed" });
        }
        return;
    }

    json(res, 404, { ok: false, error: "not-found" });
});

server.listen(PORT, () => {
    console.log(`Telegram OTP server listening on http://localhost:${PORT}`);
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_BOT_USERNAME) {
        console.log(
            "Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME to enable Telegram OTP delivery."
        );
    }
});

setInterval(cleanupExpiredSessions, 30_000);
setInterval(pollTelegramUpdates, 2_000);