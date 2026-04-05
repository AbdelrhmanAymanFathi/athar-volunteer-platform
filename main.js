/**
 * أثر (Athar) — IndexedDB فقط، بدون خادم.
 * المخازن: users | events | notifications
 * أدوار: admin | leader | student
 */

const IDB_NAME = "athar_db";
const IDB_VERSION = 3;
const USERS_STORE = "users";
const EVENTS_STORE = "events";
const NOTIFICATIONS_STORE = "notifications";
const LEGACY_LS_KEY = "athar_local_v1";
const THEME_KEY = "athar_theme";
const EVENTS_VIEW_KEY = "athar_events_view";
const LEADER_EMAIL = "leader@pnu.edu.sa";
const ADMIN_EMAIL = "admin@pnu.edu.sa";

/** كلمة مرور ثابتة لحسابي الإدارة والقائدة فقط */
const ADMIN_LEADER_PASSWORD = "P@ssw0rd";

const WHATSAPP_GROUP_URL =
    "https://chat.whatsapp.com/IEIqX7xdIGB0siKRT8u9x";

/** حد أقصى لحجم صورة الفعالية (بايت) — تقريباً 600 كيلوبايت */
const MAX_EVENT_IMAGE_BYTES = 620 * 1024;

let idbConnection = null;
let idbInitPromise = null;

let userData = null;
let hoursUnsub = null;
let adminUnsub = null;
let hoursSyncHandler = null;
let adminSyncHandler = null;

/** كلية الفعاليات الحالية (متزامنة مع قائمة التصفية) */
let currentCollegeForEvents = "";

/** وضع عرض الفعاليات: list | calendar */
let eventsViewMode = "list";
let calendarMonthCursor = null;

let routerSuppressHash = false;

/** تثبيت PWA */
let deferredInstallPrompt = null;

// ——— إشعارات Toast ———

function showNotification(message, duration = 4000) {
    const toast = document.getElementById("notification-toast");
    const messageEl = document.getElementById("notification-message");
    if (!toast || !messageEl) return;
    messageEl.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), duration);
}

function showLoader(v) {
    const el = document.getElementById("loader");
    if (el) {
        el.style.display = v ? "flex" : "none";
        el.setAttribute("aria-busy", v ? "true" : "false");
    }
}

// ——— IndexedDB ———

function openIdb() {
    if (idbConnection) return Promise.resolve(idbConnection);

    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB غير متاح"));
            return;
        }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            idbConnection = req.result;
            idbConnection.onclose = () => {
                idbConnection = null;
            };
            resolve(idbConnection);
        };
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            const tx = e.target.transaction;

            if (!db.objectStoreNames.contains(USERS_STORE)) {
                const os = db.createObjectStore(USERS_STORE, { keyPath: "uid" });
                os.createIndex("by_email", "email", { unique: true });
            }
            if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
            }
            if (e.oldVersion < 3) {
                if (db.objectStoreNames.contains(EVENTS_STORE)) {
                    const evOs = tx.objectStore(EVENTS_STORE);
                    if (!evOs.indexNames.contains("by_college")) {
                        evOs.createIndex("by_college", "college", {
                            unique: false,
                        });
                    }
                    if (!evOs.indexNames.contains("by_date")) {
                        evOs.createIndex("by_date", "date", { unique: false });
                    }
                }
                if (!db.objectStoreNames.contains(NOTIFICATIONS_STORE)) {
                    const ns = db.createObjectStore(NOTIFICATIONS_STORE, {
                        keyPath: "id",
                    });
                    ns.createIndex("by_uid", "uid", { unique: false });
                    ns.createIndex("by_created", "createdAt", {
                        unique: false,
                    });
                }
            }
        };
    });
}

function idbGetAllUsers(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(USERS_STORE, "readonly");
        const r = tx.objectStore(USERS_STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
}

function idbGetAllEvents(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(EVENTS_STORE, "readonly");
        const r = tx.objectStore(EVENTS_STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
}

function idbReplaceAllUsers(db, users) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(USERS_STORE, "readwrite");
        const store = tx.objectStore(USERS_STORE);
        store.clear();
        for (let i = 0; i < users.length; i++) {
            store.put(users[i]);
        }
        tx.oncomplete = () => {
            window.dispatchEvent(new CustomEvent("athar-db-changed"));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("abort"));
    });
}

function idbReplaceAllEvents(db, events) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(EVENTS_STORE, "readwrite");
        const store = tx.objectStore(EVENTS_STORE);
        store.clear();
        for (let i = 0; i < events.length; i++) {
            store.put(events[i]);
        }
        tx.oncomplete = () => {
            window.dispatchEvent(new CustomEvent("athar-db-changed"));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("abort"));
    });
}

function idbPutNotification(db, note) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(NOTIFICATIONS_STORE, "readwrite");
        const r = tx.objectStore(NOTIFICATIONS_STORE).put(note);
        r.onsuccess = () => {
            window.dispatchEvent(new CustomEvent("athar-db-changed"));
            resolve();
        };
        r.onerror = () => reject(r.error);
    });
}

function idbGetNotificationsForUid(db, uid) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(NOTIFICATIONS_STORE, "readonly");
        const store = tx.objectStore(NOTIFICATIONS_STORE);
        if (!store.indexNames.contains("by_uid")) {
            const r = store.getAll();
            r.onsuccess = () => {
                const all = r.result || [];
                resolve(all.filter((n) => n.uid === uid));
            };
            r.onerror = () => reject(r.error);
            return;
        }
        const r = store.index("by_uid").getAll(uid);
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
}

async function migrateLegacyLocalStorage(db) {
    const users = await idbGetAllUsers(db);
    if (users.length > 0) return;
    try {
        const raw = localStorage.getItem(LEGACY_LS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.users) || parsed.users.length === 0) return;
        await idbReplaceAllUsers(db, parsed.users);
        localStorage.removeItem(LEGACY_LS_KEY);
    } catch (e) {
        console.warn("Athar: فشل ترحيل localStorage", e);
    }
}

function ensureIdbInit() {
    if (!idbInitPromise) {
        idbInitPromise = (async () => {
            const db = await openIdb();
            await migrateLegacyLocalStorage(db);
        })();
    }
    return idbInitPromise;
}

function normalizeUserRow(u) {
    const row = { ...u };
    if (!Array.isArray(row.volunteerEventIds)) row.volunteerEventIds = [];
    return row;
}

const VOLUNTEER_GRADUATION_TARGET = 50;

function sumVolunteerHoursFromEvents(userRow, events) {
    const row = normalizeUserRow(userRow);
    const ids = row.volunteerEventIds || [];
    const map = new Map((events || []).map((e) => [e.id, e]));
    let sum = 0;
    for (const id of ids) {
        const ev = map.get(id);
        if (!ev) continue;
        const vh = parseInt(ev.volunteerHours, 10);
        sum += Number.isFinite(vh) && vh > 0 ? vh : 4;
    }
    return sum;
}

function totalVolunteerHoursForDisplay(userRow, events) {
    const fromEvents = sumVolunteerHoursFromEvents(userRow, events);
    const manual = parseInt(userRow.hours, 10) || 0;
    return fromEvents + manual;
}

async function loadDb() {
    await ensureIdbInit();
    const db = await openIdb();
    const [users, events] = await Promise.all([
        idbGetAllUsers(db),
        idbGetAllEvents(db),
    ]);
    return {
        users: users.map(normalizeUserRow),
        events: Array.isArray(events) ? events : [],
    };
}

async function saveDb(dbPayload) {
    await ensureIdbInit();
    const db = await openIdb();
    await idbReplaceAllUsers(db, dbPayload.users);
}

async function saveEvents(events) {
    await ensureIdbInit();
    const db = await openIdb();
    await idbReplaceAllEvents(db, events);
}

function newUid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return "u_" + Date.now() + "_" + Math.random().toString(36).slice(2, 12);
}

async function hashPassword(pw) {
    const enc = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

let adminLeaderPwdHashCache = null;
async function getAdminLeaderPasswordHash() {
    if (!adminLeaderPwdHashCache) {
        adminLeaderPwdHashCache = await hashPassword(ADMIN_LEADER_PASSWORD);
    }
    return adminLeaderPwdHashCache;
}

function isAdminOrLeaderEmail(email) {
    const e = email.trim().toLowerCase();
    return e === ADMIN_EMAIL.toLowerCase() || e === LEADER_EMAIL.toLowerCase();
}

function findUserByEmail(db, email) {
    const e = email.trim().toLowerCase();
    return db.users.find((u) => u.email.trim().toLowerCase() === e) || null;
}

function toPublicUser(u) {
    const row = normalizeUserRow(u);
    const ids = Array.isArray(row.volunteerEventIds) ? row.volunteerEventIds : [];
    return {
        uid: row.uid,
        name: row.name,
        email: row.email,
        phone: row.phone,
        dob: row.dob,
        hours: parseInt(row.hours, 10) || 0,
        role: row.role,
        volunteerEventIds: [...ids],
    };
}

function buildUserPayload(uid, name, email, phone, dob, role) {
    return {
        uid,
        name,
        email,
        phone,
        dob,
        hours: 0,
        role,
        volunteerEventIds: [],
    };
}

function resolveRoleFromEmail(email) {
    const e = email.trim().toLowerCase();
    if (e === ADMIN_EMAIL.toLowerCase()) return "admin";
    if (e === LEADER_EMAIL.toLowerCase()) return "leader";
    return "student";
}

// ——— التحقق من البريد والجوال ———

function validatePnuEmail(email) {
    const e = String(email || "").trim().toLowerCase();
    if (!e.endsWith("@pnu.edu.sa")) return false;
    const local = e.slice(0, -"@pnu.edu.sa".length);
    return local.length >= 2 && !/\s/.test(local);
}

/** جوال سعودي: 05xxxxxxxx */
function validateSaudiMobile(phone) {
    const d = normalizeSaudiPhone(phone);
    return /^05[0-9]{8}$/.test(d);
}

function normalizeSaudiPhone(phone) {
    let s = String(phone || "").replace(/\s+/g, "").replace(/^\+966/, "0");
    if (/^5[0-9]{8}$/.test(s)) s = "0" + s;
    return s;
}

// ——— الشارات والمستويات ———

function getBadgeLevel(hours) {
    const h = parseInt(hours, 10) || 0;
    if (h >= 50) {
        return {
            key: "legend",
            name: "أسطورة التطوع",
            desc: "أنجزتِ 50 ساعة فأكثر — إلهام لزميلاتك!",
        };
    }
    if (h >= 25) {
        return {
            key: "hero",
            name: "بطلة التطوع",
            desc: "بين 25 و49 ساعة — أداء متميز.",
        };
    }
    if (h >= 10) {
        return {
            key: "active",
            name: "نشيطة",
            desc: "بين 10 و24 ساعة — واصلِ!",
        };
    }
    return {
        key: "beginner",
        name: "مبتدئة",
        desc: "أقل من 10 ساعات — ابدئي رحلتكِ!",
    };
}

function updateBadgeUI(hours) {
    const b = getBadgeLevel(hours);
    const nameEl = document.getElementById("badge-level-name");
    const descEl = document.getElementById("badge-level-desc");
    const wrap = document.getElementById("badge-display");
    if (nameEl) nameEl.textContent = b.name;
    if (descEl) descEl.textContent = b.desc;
    if (wrap) {
        wrap.classList.remove(
            "badge-display--beginner",
            "badge-display--active",
            "badge-display--hero",
            "badge-display--legend"
        );
        wrap.classList.add("badge-display--" + b.key);
    }
}

// ——— إشعارات داخلية ———

async function addNotificationForUid(uid, title, body) {
    if (!uid) return;
    await ensureIdbInit();
    const db = await openIdb();
    const note = {
        id: newUid(),
        uid,
        title: String(title || "").slice(0, 120),
        body: String(body || "").slice(0, 500),
        createdAt: Date.now(),
        read: false,
    };
    await idbPutNotification(db, note);
}

function findLeaderUid(users) {
    const l = (users || []).find((u) => u.role === "leader");
    return l ? l.uid : null;
}

function countRegistrationsForEvent(db, eventId) {
    let n = 0;
    for (const u of db.users) {
        const row = normalizeUserRow(u);
        if (row.volunteerEventIds && row.volunteerEventIds.includes(eventId)) {
            n++;
        }
    }
    return n;
}

// ——— اشتراك الساعات ———

function clearHoursSubscription() {
    if (hoursUnsub) {
        clearInterval(hoursUnsub);
        hoursUnsub = null;
    }
    if (hoursSyncHandler) {
        window.removeEventListener("athar-db-changed", hoursSyncHandler);
        hoursSyncHandler = null;
    }
}

function clearAdminSubscription() {
    if (adminUnsub) {
        clearInterval(adminUnsub);
        adminUnsub = null;
    }
    if (adminSyncHandler) {
        window.removeEventListener("athar-db-changed", adminSyncHandler);
        adminSyncHandler = null;
    }
}

function subscribeCurrentUserHours(uid) {
    clearHoursSubscription();
    hoursSyncHandler = () => {
        loadDb()
            .then((db) => {
                const u = db.users.find((x) => x.uid === uid);
                if (!u) return;
                const hrs = totalVolunteerHoursForDisplay(u, db.events);
                if (userData) {
                    userData.hours = hrs;
                    userData.volunteerEventIds = [
                        ...normalizeUserRow(u).volunteerEventIds,
                    ];
                }
                updateChart(hrs);
                updateBadgeUI(hrs);
            })
            .catch((err) => console.error(err));
    };
    window.addEventListener("athar-db-changed", hoursSyncHandler);
    hoursUnsub = setInterval(hoursSyncHandler, 1200);
    hoursSyncHandler();
}

function updateNavForRole() {
    const navAdmin = document.getElementById("nav-admin");
    const navLeader = document.getElementById("nav-leader");
    const navProfile = document.getElementById("nav-profile");
    const notifBtn = document.getElementById("btn-notifications");
    const certBtn = document.getElementById("btn-export-certificate");

    if (navAdmin) navAdmin.classList.add("is-hidden");
    if (navLeader) navLeader.classList.add("is-hidden");
    if (navProfile) navProfile.classList.remove("is-hidden");
    if (notifBtn) notifBtn.classList.remove("is-hidden");
    if (certBtn) certBtn.classList.toggle("is-hidden", userData.role === "admin");

    if (userData.role === "admin") {
        if (navAdmin) navAdmin.classList.remove("is-hidden");
        if (navProfile) navProfile.classList.add("is-hidden");
        if (notifBtn) notifBtn.classList.add("is-hidden");
    } else if (userData.role === "leader") {
        if (navLeader) navLeader.classList.remove("is-hidden");
    }
}

function getAuthPassword() {
    const el = document.getElementById("login-password");
    return el ? el.value : "";
}

function getAuthMode() {
    const w = document.getElementById("login-wrapper");
    return w && w.dataset.authMode === "register" ? "register" : "login";
}

function setAuthMode(mode) {
    const wrap = document.getElementById("login-wrapper");
    const extra = document.getElementById("reg-extra-fields");
    const tabLogin = document.getElementById("tab-login");
    const tabRegister = document.getElementById("tab-register");
    const btn = document.getElementById("auth-submit-btn");
    if (!wrap || !extra) return;

    const isRegister = mode === "register";
    wrap.dataset.authMode = isRegister ? "register" : "login";
    extra.hidden = !isRegister;

    if (tabLogin) {
        tabLogin.classList.toggle("auth-tab--active", !isRegister);
        tabLogin.setAttribute("aria-selected", !isRegister ? "true" : "false");
    }
    if (tabRegister) {
        tabRegister.classList.toggle("auth-tab--active", isRegister);
        tabRegister.setAttribute("aria-selected", isRegister ? "true" : "false");
    }
    if (btn) {
        btn.textContent = isRegister ? "إنشاء حساب" : "تسجيل الدخول";
    }

    const pw = document.getElementById("login-password");
    if (pw) {
        pw.setAttribute(
            "autocomplete",
            isRegister ? "new-password" : "current-password"
        );
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    if (getAuthMode() === "register") {
        await handleRegister();
    } else {
        await handleLogin();
    }
}

async function handleLogin() {
    const email = document.getElementById("reg-email").value.trim();
    const password = getAuthPassword();

    if (!email) {
        showNotification("أدخلي البريد الجامعي.");
        return;
    }
    if (!validatePnuEmail(email)) {
        showNotification("البريد يجب أن يكون بصيغة الجامعة وينتهي بـ @pnu.edu.sa");
        return;
    }
    if (!password || password.length < 6) {
        showNotification("كلمة المرور مطلوبة ولا تقل عن 6 أحرف.");
        return;
    }

    showLoader(true);

    try {
        const pwdHash = await hashPassword(password);
        const db = await loadDb();
        const existing = findUserByEmail(db, email);

        if (!existing) {
            showNotification(
                "لا يوجد حساب بهذا البريد. أنشئي حساباً من «تسجيل جديد»."
            );
            return;
        }

        if (isAdminOrLeaderEmail(email)) {
            const expected = await getAdminLeaderPasswordHash();
            if (pwdHash !== expected) {
                showNotification("كلمة المرور غير صحيحة.");
                return;
            }
            if (existing.pwdHash !== expected) {
                existing.pwdHash = expected;
                await saveDb(db);
            }
        } else if (existing.pwdHash !== pwdHash) {
            showNotification("كلمة المرور غير صحيحة.");
            return;
        }

        userData = toPublicUser(existing);

        if (userData && userData.role !== "admin") {
            subscribeCurrentUserHours(userData.uid);
        } else {
            clearHoursSubscription();
        }

        startApp();
    } catch (err) {
        console.error(err);
        showNotification(
            "تعذّر تسجيل الدخول. تأكدي أن المتصفح يدعم IndexedDB."
        );
    } finally {
        showLoader(false);
    }
}

async function handleRegister() {
    const fullname = document.getElementById("reg-fullname").value.trim();
    const names = fullname.split(/\s+/).filter(Boolean);
    if (names.length < 3) {
        showNotification("مطلوب على الأقل ثلاثة أسماء");
        return;
    }

    const email = document.getElementById("reg-email").value.trim();
    const password = getAuthPassword();
    const phoneRaw = document.getElementById("reg-phone").value.trim();
    const dob = document.getElementById("reg-dob").value;
    const role = resolveRoleFromEmail(email);

    if (!validatePnuEmail(email)) {
        showNotification("البريد يجب أن ينتهي بـ @pnu.edu.sa");
        return;
    }
    if (!password || password.length < 6) {
        showNotification("كلمة المرور مطلوبة ولا تقل عن 6 أحرف.");
        return;
    }
    const phone = normalizeSaudiPhone(phoneRaw);
    if (!validateSaudiMobile(phone)) {
        showNotification("رقم جوال سعودي غير صالح (مثال: 05xxxxxxxx).");
        return;
    }
    if (!dob) {
        showNotification("أدخلي تاريخ الميلاد.");
        return;
    }

    if (role === "admin" || role === "leader") {
        if (password !== ADMIN_LEADER_PASSWORD) {
            showNotification(
                "كلمة مرور حساب المسؤولة أو القائدة غير صحيحة. استخدمي كلمة المرور المعتمدة من المنصة."
            );
            return;
        }
    }

    showLoader(true);

    try {
        const pwdHash =
            role === "admin" || role === "leader"
                ? await getAdminLeaderPasswordHash()
                : await hashPassword(password);
        const db = await loadDb();
        const existing = findUserByEmail(db, email);

        if (existing) {
            showNotification("البريد مسجّل مسبقاً. استخدمي «تسجيل الدخول».");
            return;
        }

        const uid = newUid();
        const row = {
            ...buildUserPayload(uid, fullname, email, phone, dob, role),
            pwdHash,
        };
        db.users.push(row);
        await saveDb(db);
        userData = toPublicUser(row);

        if (userData && userData.role !== "admin") {
            subscribeCurrentUserHours(userData.uid);
        } else {
            clearHoursSubscription();
        }

        startApp();
    } catch (err) {
        console.error(err);
        showNotification(
            "تعذّر إنشاء الحساب. تأكدي أن المتصفح يدعم IndexedDB."
        );
    } finally {
        showLoader(false);
    }
}

function startApp() {
    document.getElementById("login-wrapper").style.display = "none";
    document.getElementById("about-modal").style.display = "flex";

    document.getElementById("prof-name-title").innerText = userData.name;
    document.getElementById("prof-name").innerText = userData.name;
    document.getElementById("prof-email").innerText = userData.email;
    document.getElementById("prof-phone").innerText = userData.phone;
    document.getElementById("prof-dob").innerText = userData.dob;

    if (userData && userData.role !== "admin") {
        void refreshVolunteerHoursUI();
    } else {
        updateChart(0);
        updateBadgeUI(0);
    }
    updateNavForRole();
    void refreshNotificationUI();
}

async function refreshVolunteerHoursUI() {
    if (!userData || userData.role === "admin") return;
    try {
        const db = await loadDb();
        const u = db.users.find((x) => x.uid === userData.uid);
        if (!u) return;
        const hrs = totalVolunteerHoursForDisplay(u, db.events);
        userData.hours = hrs;
        userData.volunteerEventIds = [
            ...normalizeUserRow(u).volunteerEventIds,
        ];
        updateChart(hrs);
        updateBadgeUI(hrs);
    } catch (err) {
        console.error(err);
    }
}

function updateChart(h) {
    const hrs = parseInt(h, 10) || 0;
    const cap = VOLUNTEER_GRADUATION_TARGET;
    const percent = Math.min((hrs / cap) * 100, 100);
    const circle = document.getElementById("chart-circle");
    if (circle) {
        circle.style.background = `conic-gradient(var(--primary) ${percent}%, var(--chart-track, #eee) 0%)`;
        const sp = circle.querySelector("span");
        if (sp) sp.innerText = percent.toFixed(0) + "%";
    }
    const sumEl = document.getElementById("hours-summary");
    if (sumEl) {
        sumEl.innerText = `أنجزتِ ${hrs} من ${cap} ساعة تطوعية`;
    }
    updateBadgeUI(hrs);
}

function escapeHtml(text) {
    if (text === undefined || text === null) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
}

function escapeAttr(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formatEventDateDisplay(iso) {
    if (!iso) return "";
    try {
        const d = new Date(
            String(iso).includes("T") ? iso : `${iso}T12:00:00`
        );
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleDateString("ar-SA", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    } catch {
        return String(iso);
    }
}

function parseEventDate(ev) {
    if (!ev || !ev.date) return null;
    const d = new Date(
        String(ev.date).includes("T") ? ev.date : `${ev.date}T12:00:00`
    );
    return Number.isNaN(d.getTime()) ? null : d;
}

function getEventsFilterCollege() {
    const sel = document.getElementById("events-filter-college");
    return sel ? sel.value : "";
}

function getFilteredCollegeEvents(events) {
    const search = (
        document.getElementById("events-search")?.value || ""
    )
        .trim()
        .toLowerCase();
    const dateFilter = document.getElementById("events-filter-date")?.value || "";
    const collegeFilter = getEventsFilterCollege();

    return (events || []).filter((ev) => {
        if (collegeFilter && ev.college !== collegeFilter) return false;
        if (search && !String(ev.title || "").toLowerCase().includes(search)) {
            return false;
        }
        if (dateFilter && ev.date !== dateFilter) return false;
        return true;
    });
}

async function refreshEventsListUI() {
    const list = document.getElementById("events-list");
    const cal = document.getElementById("events-calendar");
    const fab = document.getElementById("fab-add-event");
    const leaderPanel = document.getElementById("leader-stats-panel");
    if (!list) return;

    const { events, users } = await loadDb();
    const dbSnapshot = { users, events };
    const collegeEvents = getFilteredCollegeEvents(events);

    const isLeader = userData && userData.role === "leader";
    const canRegister =
        userData &&
        userData.role !== "admin" &&
        (userData.role === "student" || userData.role === "leader");

    if (fab) {
        fab.classList.toggle("is-hidden", !isLeader);
    }
    if (leaderPanel) {
        leaderPanel.classList.toggle("is-hidden", !isLeader);
        if (isLeader) {
            renderLeaderStats(dbSnapshot, collegeEvents);
        }
    }

    if (eventsViewMode === "calendar") {
        list.innerHTML = "";
        if (cal) {
            cal.classList.remove("is-hidden");
            cal.setAttribute("aria-hidden", "false");
            renderEventsCalendar(collegeEvents);
        }
        return;
    }

    if (cal) {
        cal.classList.add("is-hidden");
        cal.setAttribute("aria-hidden", "true");
    }

    if (!collegeEvents.length) {
        list.innerHTML = `
            <p class="events-empty-hint">لا توجد فعاليات مطابقة للبحث أو التصفية.${
                isLeader ? " استخدمي زر «+» لإضافة فعالية." : ""
            }</p>`;
        return;
    }

    const registered = new Set(userData?.volunteerEventIds || []);

    list.innerHTML = collegeEvents
        .map((ev) => {
            const title = escapeHtml(ev.title);
            const loc = escapeHtml(ev.location || "");
            const dateStr = escapeHtml(formatEventDateDisplay(ev.date));
            const timeStr = escapeHtml(ev.time || "");
            const vh = Math.max(1, parseInt(ev.volunteerHours, 10) || 4);
            const isReg = registered.has(ev.id);
            const imgHtml = ev.imageData
                ? `<div class="event-card__thumb"><img src="${escapeHtml(ev.imageData)}" alt="" loading="lazy" /></div>`
                : "";

            const regNote = isReg
                ? '<span class="hours-tag hours-tag--status">مسجّلة في سجلك</span>'
                : canRegister
                  ? '<span class="event-tap-hint">اضغطي على البطاقة للتسجيل</span>'
                  : "";

            const canRegClass =
                canRegister && !isReg ? "event-card--can-register" : "";

            const delBtn = isLeader
                ? `<button type="button" class="btn-delete-event" data-delete-id="${escapeHtml(ev.id)}" aria-label="حذف الفعالية"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>`
                : "";

            const unregisterBtn =
                canRegister && isReg
                    ? `<button type="button" class="btn-unregister-event" data-unreg-id="${escapeHtml(ev.id)}" aria-label="إلغاء التسجيل من هذه الفعالية"><i class="fas fa-user-minus" aria-hidden="true"></i> إلغاء التسجيل</button>`
                    : "";

            const regCount = countRegistrationsForEvent(dbSnapshot, ev.id);

            return `
            <div class="event-card${isReg ? " event-card--registered" : ""} ${canRegClass}" data-event-id="${escapeHtml(ev.id)}">
                ${imgHtml}
                <div class="event-details">
                    <h4>${title}</h4>
                    <p><i class="far fa-calendar-alt" aria-hidden="true"></i> <b>التاريخ:</b> ${dateStr}</p>
                    <p><i class="far fa-clock" aria-hidden="true"></i> <b>الوقت:</b> ${timeStr}</p>
                    <p><i class="fas fa-map-marker-alt" aria-hidden="true"></i> <b>المكان:</b> ${loc}</p>
                    <p class="event-meta-line"><i class="fas fa-users" aria-hidden="true"></i> <b>المسجلات:</b> ${regCount}</p>
                </div>
                <div class="event-card-actions">
                    <span class="hours-tag">+${vh} ساعات مكتسبة</span>
                    ${regNote}
                    ${unregisterBtn}
                    <a class="btn-whatsapp" href="${WHATSAPP_GROUP_URL}" target="_blank" rel="noopener noreferrer">
                        <i class="fab fa-whatsapp" aria-hidden="true"></i> انضمام للمجموعة
                    </a>
                    ${delBtn}
                </div>
            </div>`;
        })
        .join("");
}

function renderLeaderStats(db, filteredEvents) {
    const sumEl = document.getElementById("leader-stats-summary");
    const tbody = document.getElementById("leader-stats-table-body");
    if (!sumEl || !tbody || !userData) return;

    const myUid = userData.uid;
    const allEv = db.events || [];
    const createdByLeader = allEv.filter(
        (e) => e.createdByUid === myUid || !e.createdByUid
    );
    const totalCreated = createdByLeader.length;

    const rows = (filteredEvents.length ? filteredEvents : allEv).map((ev) => ({
        title: ev.title,
        college: ev.college,
        count: countRegistrationsForEvent(db, ev.id),
    }));
    const totalRegsInView = rows.reduce((a, r) => a + r.count, 0);

    sumEl.innerHTML = `
      <div class="leader-stat-card"><span class="leader-stat-card__val">${totalCreated}</span><span class="leader-stat-card__lbl">فعاليات منشأة (إجمالي)</span></div>
      <div class="leader-stat-card"><span class="leader-stat-card__val">${totalRegsInView}</span><span class="leader-stat-card__lbl">تسجيلات الطالبات (العرض الحالي)</span></div>
    `;

    tbody.innerHTML = rows.length
        ? rows
              .map(
                  (r) =>
                      `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.college)}</td><td><b>${r.count}</b></td></tr>`
              )
              .join("")
        : "<tr><td colspan=\"3\">لا توجد بيانات</td></tr>";
}

const AR_MONTHS = [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
];

function renderEventsCalendar(collegeEvents) {
    const host = document.getElementById("events-calendar");
    if (!host) return;

    if (!calendarMonthCursor) {
        calendarMonthCursor = new Date();
        calendarMonthCursor.setDate(1);
    }

    const y = calendarMonthCursor.getFullYear();
    const m = calendarMonthCursor.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const byDay = new Map();
    for (const ev of collegeEvents) {
        if (!ev.date) continue;
        const parts = String(ev.date).split("-");
        if (parts.length < 3) continue;
        const dy = parseInt(parts[2], 10);
        if (!byDay.has(dy)) byDay.set(dy, []);
        byDay.get(dy).push(ev);
    }

    const dowLabels = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
    let grid = `<div class="cal-header">
      <button type="button" class="cal-nav-btn" aria-label="الشهر السابق" onclick="calendarNav(-1)"><i class="fas fa-chevron-right"></i></button>
      <h3 class="cal-title">${AR_MONTHS[m]} ${y}</h3>
      <button type="button" class="cal-nav-btn" aria-label="الشهر التالي" onclick="calendarNav(1)"><i class="fas fa-chevron-left"></i></button>
    </div>`;
    grid += '<div class="cal-weekdays">';
    for (let i = 0; i < 7; i++) {
        grid += `<span>${dowLabels[i]}</span>`;
    }
    grid += "</div><div class=\"cal-grid\">";

    const offset = (firstDow + 6) % 7;
    for (let i = 0; i < offset; i++) {
        grid += '<div class="cal-cell cal-cell--empty"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const list = byDay.get(d) || [];
        const dots =
            list.length > 0
                ? `<span class="cal-dots">${list
                      .slice(0, 3)
                      .map(() => '<i class="fas fa-circle"></i>')
                      .join("")}</span>`
                : "";
        const titles = list
            .map((ev) => escapeHtml(ev.title))
            .join("، ");
        grid += `<div class="cal-cell${list.length ? " cal-cell--has" : ""}" title="${titles}">
            <span class="cal-day-num">${d}</span>
            ${dots}
            ${
                list.length
                    ? `<ul class="cal-event-list">${list
                          .map(
                              (ev) =>
                                  `<li>${escapeHtml(ev.title)} — ${escapeHtml(ev.time || "")}</li>`
                          )
                          .join("")}</ul>`
                    : ""
            }
        </div>`;
    }
    grid += "</div>";
    host.innerHTML = grid;
}

function calendarNav(delta) {
    if (!calendarMonthCursor) calendarMonthCursor = new Date();
    calendarMonthCursor.setMonth(calendarMonthCursor.getMonth() + delta);
    refreshEventsListUI().catch(console.error);
}

function setEventsViewMode(mode) {
    eventsViewMode = mode === "calendar" ? "calendar" : "list";
    localStorage.setItem(EVENTS_VIEW_KEY, eventsViewMode);
    const bList = document.getElementById("btn-view-list");
    const bCal = document.getElementById("btn-view-calendar");
    if (bList && bCal) {
        bList.classList.toggle("view-toggle__btn--active", mode === "list");
        bCal.classList.toggle("view-toggle__btn--active", mode === "calendar");
        bList.setAttribute("aria-pressed", mode === "list" ? "true" : "false");
        bCal.setAttribute("aria-pressed", mode === "calendar" ? "true" : "false");
    }
    refreshEventsListUI().catch(console.error);
}

function onEventsFilterChange() {
    refreshEventsListUI().catch(console.error);
}

function onCollegeFilterChange() {
    const sel = document.getElementById("events-filter-college");
    const v = sel ? sel.value : "";
    currentCollegeForEvents = v;
    const titleEl = document.getElementById("college-name-display");
    if (titleEl) {
        titleEl.textContent = v ? "فعاليات كلية " + v : "جميع الفعاليات";
    }
    syncRouterHash("events-page");
    refreshEventsListUI().catch(console.error);
}

function openEvents(college) {
    currentCollegeForEvents = college;
    const sel = document.getElementById("events-filter-college");
    if (sel) sel.value = college;
    const titleEl = document.getElementById("college-name-display");
    if (titleEl) titleEl.textContent = "فعاليات كلية " + college;
    goToPage("events-page");
}

async function registerForEvent(eventId) {
    if (!userData || userData.role === "admin") {
        if (userData && userData.role === "admin") {
            showNotification("حساب المسؤولة لا يُسجَّل في الفعاليات.");
        }
        return;
    }
    const curIds = Array.isArray(userData.volunteerEventIds)
        ? userData.volunteerEventIds
        : [];
    if (curIds.includes(eventId)) {
        showNotification("هذه الفعالية مسجّلة مسبقاً في سجلك.");
        return;
    }

    showLoader(true);
    try {
        const db = await loadDb();
        const u = db.users.find((x) => x.uid === userData.uid);
        if (!u) {
            showNotification("تعذّر تحديث الحساب.");
            return;
        }
        normalizeUserRow(u);
        u.volunteerEventIds.push(eventId);
        await saveDb(db);
        userData.volunteerEventIds = [...u.volunteerEventIds];

        const ev = db.events.find((e) => e.id === eventId);
        const evTitle = ev ? ev.title : "فعالية";
        await addNotificationForUid(
            userData.uid,
            "تم التسجيل",
            `تمت إضافة «${evTitle}» إلى سجلك التطوعي.`
        );
        const leaderUid = findLeaderUid(db.users);
        if (leaderUid && leaderUid !== userData.uid) {
            await addNotificationForUid(
                leaderUid,
                "تسجيل جديد",
                `${userData.name} سجّلت في «${evTitle}».`
            );
        }

        showNotification("تم تسجيل الفعالية في سجلك التطوعي.");
        await refreshEventsListUI();
        await refreshVolunteerHoursUI();
        await refreshNotificationUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر التسجيل في الفعالية.");
    } finally {
        showLoader(false);
    }
}

async function unregisterFromEvent(eventId) {
    if (!userData || userData.role === "admin") return;
    const ok = await showConfirmModal({
        title: "إلغاء التسجيل",
        text: "هل أنتِ متأكدة من إلغاء تسجيلك من هذه الفعالية؟",
        danger: true,
        okText: "إلغاء التسجيل",
    });
    if (!ok) return;

    showLoader(true);
    try {
        const db = await loadDb();
        const u = db.users.find((x) => x.uid === userData.uid);
        if (!u) {
            showNotification("تعذّر تحديث الحساب.");
            return;
        }
        normalizeUserRow(u);
        u.volunteerEventIds = u.volunteerEventIds.filter((id) => id !== eventId);
        await saveDb(db);
        userData.volunteerEventIds = [...u.volunteerEventIds];

        const ev = db.events.find((e) => e.id === eventId);
        await addNotificationForUid(
            userData.uid,
            "تم إلغاء التسجيل",
            `أُزيلت «${ev ? ev.title : "الفعالية"}» من سجلك.`
        );

        showNotification("تم إلغاء التسجيل من الفعالية.");
        await refreshEventsListUI();
        await refreshVolunteerHoursUI();
        await renderUpcomingEvents();
        await refreshNotificationUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر إلغاء التسجيل.");
    } finally {
        showLoader(false);
    }
}

function openAddEventModal() {
    if (!userData || userData.role !== "leader") return;
    const m = document.getElementById("add-event-modal");
    if (!m) return;
    const collegeFromFilter = getEventsFilterCollege();
    const lab = document.getElementById("add-event-college-label");
    const wrap = document.getElementById("add-event-college-wrap");
    const selCol = document.getElementById("new-event-college-select");

    if (collegeFromFilter) {
        if (lab) lab.textContent = collegeFromFilter;
        if (wrap) wrap.hidden = true;
    } else {
        if (lab) lab.textContent = "اختيار من القائمة";
        if (wrap) wrap.hidden = false;
        if (selCol) selCol.value = "";
    }

    m.classList.add("is-open");
    document.getElementById("new-event-title").value = "";
    document.getElementById("new-event-location").value = "";
    document.getElementById("new-event-date").value = "";
    document.getElementById("new-event-time").value = "";
    const fi = document.getElementById("new-event-image");
    if (fi) fi.value = "";
}

function closeAddEventModal() {
    const m = document.getElementById("add-event-modal");
    if (m) m.classList.remove("is-open");
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

async function submitNewEvent(e) {
    e.preventDefault();
    if (!userData || userData.role !== "leader") return;

    const title = document.getElementById("new-event-title").value.trim();
    const location = document.getElementById("new-event-location").value.trim();
    const date = document.getElementById("new-event-date").value;
    const time = document.getElementById("new-event-time").value;
    const collegeSel = document.getElementById("new-event-college-select");
    const filterCollege = getEventsFilterCollege();

    let college = filterCollege || (collegeSel && collegeSel.value);
    if (!college) {
        showNotification("اختر الكلية من القائمة أو من صفحة كلية محددة.");
        return;
    }

    if (!title) {
        showNotification("أدخلي اسم الفعالية.");
        return;
    }

    let imageData = null;
    const fileInput = document.getElementById("new-event-image");
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const f = fileInput.files[0];
        if (f.size > MAX_EVENT_IMAGE_BYTES) {
            showNotification("حجم الصورة كبير جداً. اختاري صورة أصغر.");
            return;
        }
        try {
            imageData = await readFileAsDataUrl(f);
        } catch {
            showNotification("تعذّر قراءة الصورة.");
            return;
        }
    }

    showLoader(true);
    try {
        const db = await loadDb();
        const ev = {
            id: newUid(),
            college,
            title,
            location,
            date,
            time,
            volunteerHours: 4,
            createdByUid: userData.uid,
            imageData: imageData || undefined,
        };
        db.events.push(ev);
        await saveEvents(db.events);
        closeAddEventModal();
        showNotification("تمت إضافة الفعالية.");
        await refreshEventsListUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر حفظ الفعالية.");
    } finally {
        showLoader(false);
    }
}

/** تأكيد موحّد — يعيد Promise<boolean> */
function showConfirmModal({
    title,
    text,
    danger,
    okText,
}) {
    return new Promise((resolve) => {
        const m = document.getElementById("confirm-modal");
        const t = document.getElementById("confirm-modal-title");
        const p = document.getElementById("confirm-modal-text");
        const ok = document.getElementById("confirm-modal-ok");
        const cancel = document.getElementById("confirm-modal-cancel");
        const icon = document.getElementById("confirm-modal-icon");
        if (!m || !ok || !cancel) {
            resolve(false);
            return;
        }
        if (t) t.textContent = title || "تأكيد";
        if (p) p.textContent = text || "";
        if (okText) ok.textContent = okText;
        ok.classList.toggle("btn-login--danger", !!danger);
        if (icon) {
            icon.innerHTML = danger
                ? '<i class="fas fa-exclamation-triangle"></i>'
                : '<i class="fas fa-question-circle"></i>';
        }
        m.classList.add("is-open");
        m.setAttribute("aria-hidden", "false");

        function cleanup() {
            ok.removeEventListener("click", onOk);
            cancel.removeEventListener("click", onCancel);
            m.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKey);
            m.classList.remove("is-open");
            m.setAttribute("aria-hidden", "true");
        }
        function onOk() {
            cleanup();
            resolve(true);
        }
        function onCancel() {
            cleanup();
            resolve(false);
        }
        function onBackdrop(ev) {
            if (ev.target === m) onCancel();
        }
        function onKey(ev) {
            if (ev.key === "Escape") onCancel();
        }
        ok.addEventListener("click", onOk);
        cancel.addEventListener("click", onCancel);
        m.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKey);
        ok.focus();
    });
}

async function openVolunteerLogModal() {
    const modal = document.getElementById("volunteer-log-modal");
    const ul = document.getElementById("volunteer-log-list");
    if (!modal || !ul || !userData || userData.role === "admin") return;

    modal.classList.add("is-open");
    ul.innerHTML = "";

    const db = await loadDb();
    const u = db.users.find((x) => x.uid === userData.uid);
    const ids = u ? normalizeUserRow(u).volunteerEventIds : [];
    if (u) {
        userData.volunteerEventIds = [...ids];
    }
    const eventMap = new Map(db.events.map((ev) => [ev.id, ev]));

    if (!ids.length) {
        ul.innerHTML =
            '<li class="volunteer-log-empty">لم تسجّلي في أي فعالية بعد. زوري صفحة الكلية واضغطي على الفعالية.</li>';
        return;
    }

    ul.innerHTML = ids
        .map((id) => {
            const ev = eventMap.get(id);
            const label = ev
                ? escapeHtml(ev.title)
                : escapeHtml(id) + " (فعالية محذوفة)";
            return `<li><i class="fas fa-check-circle" aria-hidden="true"></i> ${label}</li>`;
        })
        .join("");
}

function closeVolunteerLogModal() {
    const modal = document.getElementById("volunteer-log-modal");
    if (modal) modal.classList.remove("is-open");
}

async function renderUpcomingEvents() {
    const ul = document.getElementById("upcoming-events-list");
    if (!ul || !userData || userData.role === "admin") {
        if (ul) ul.innerHTML = "";
        return;
    }

    const db = await loadDb();
    const u = db.users.find((x) => x.uid === userData.uid);
    const ids = u ? normalizeUserRow(u).volunteerEventIds : [];
    const eventMap = new Map(db.events.map((ev) => [ev.id, ev]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = [];
    for (const id of ids) {
        const ev = eventMap.get(id);
        if (!ev) continue;
        const d = parseEventDate(ev);
        if (!d) continue;
        d.setHours(0, 0, 0, 0);
        if (d >= today) upcoming.push(ev);
    }
    upcoming.sort(
        (a, b) => parseEventDate(a) - parseEventDate(b)
    );

    if (!upcoming.length) {
        ul.innerHTML =
            '<li class="upcoming-events-empty">لا توجد فعاليات قادمة في سجلك.</li>';
        return;
    }

    ul.innerHTML = upcoming
        .map((ev) => {
            return `<li class="upcoming-event-item">
              <strong>${escapeHtml(ev.title)}</strong>
              <span class="upcoming-event-meta">${escapeHtml(formatEventDateDisplay(ev.date))} — ${escapeHtml(ev.time || "")}</span>
            </li>`;
        })
        .join("");
}

async function exportVolunteerCertificatePdf() {
    if (!userData || userData.role === "admin") return;
    if (typeof html2canvas === "undefined" || !window.jspdf) {
        showNotification("تعذّر تحميل مكتبات التصدير. تحققي من الاتصال.");
        return;
    }
    await refreshVolunteerHoursUI();
    const hrs = userData.hours || 0;
    document.getElementById("cert-student-name").textContent = userData.name;
    document.getElementById("cert-hours").textContent = String(hrs);
    document.getElementById("cert-date").textContent =
        new Date().toLocaleDateString("ar-SA", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });

    const el = document.getElementById("certificate-print-area");
    const inner = el.querySelector(".certificate-inner");
    el.classList.add("certificate-print-area--visible");
    el.setAttribute("aria-hidden", "false");
    showLoader(true);
    try {
        const canvas = await html2canvas(inner, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
        });
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4",
        });
        const img = canvas.toDataURL("image/png");
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const ratio = canvas.height / canvas.width;
        const imgH = pageW * ratio;
        pdf.addImage(img, "PNG", 0, 0, pageW, Math.min(imgH, pageH));
        const safeName = userData.name.replace(/[^\w\u0600-\u06FF-]+/g, "-");
        pdf.save(`athar-certificate-${safeName}.pdf`);
        showNotification("تم حفظ ملف PDF.");
    } catch (e) {
        console.error(e);
        showNotification("تعذّر إنشاء ملف PDF.");
    } finally {
        el.classList.remove("certificate-print-area--visible");
        el.setAttribute("aria-hidden", "true");
        showLoader(false);
    }
}

function goToLeaderHome() {
    goToPage("home-page");
    closeNavMenu();
    showNotification(
        "اختر الكلية، ثم أضيفي أو حذفي الفعاليات من صفحة الفعاليات."
    );
}

function renderAdminTable(users, events) {
    const table = document.getElementById("admin-table-body");
    const evs = events || [];
    table.innerHTML = "";
    const rows = [];
    users.forEach((u) => {
        if (u.role === "admin") return;
        const displayHrs = totalVolunteerHoursForDisplay(u, evs);
        const manualHrs = parseInt(u.hours, 10) || 0;
        const uid = escapeHtml(u.uid);
        const name = escapeHtml(u.name);
        rows.push(`<tr>
                    <td>${name}</td>
                    <td><b>${displayHrs}</b> ساعة${
                        manualHrs > 0
                            ? ` <span style="color:#666;font-size:0.85em">(يدوي: ${manualHrs})</span>`
                            : ""
                    }</td>
                    <td><button type="button" class="btn-admin-add" data-add-hours="${uid}" data-manual="${manualHrs}" style="background:#2e7d32; color:white; border:none; padding:8px 15px; border-radius:8px; cursor:pointer; font-weight:bold;">+5 ساعات</button></td>
                </tr>`);
    });
    if (!rows.length) {
        table.innerHTML =
            "<tr><td colspan='3' style='text-align:center;'>لا توجد طالبات مسجّلات بعد.</td></tr>";
    } else {
        table.innerHTML = rows.join("");
    }
}

function bindAdminTableSync() {
    clearAdminSubscription();

    const table = document.getElementById("admin-table-body");
    table.innerHTML =
        "<tr><td colspan='3' style='text-align:center;'>جاري جلب قائمة الطالبات...</td></tr>";

    adminSyncHandler = () => {
        loadDb()
            .then((db) => renderAdminTable(db.users, db.events))
            .catch((err) => console.error(err));
    };
    window.addEventListener("athar-db-changed", adminSyncHandler);
    adminUnsub = setInterval(adminSyncHandler, 1000);
    adminSyncHandler();
}

function loadAdmin() {
    goToPage("admin-page");
    bindAdminTableSync();
}

async function addHours(uid, current) {
    const ok = await showConfirmModal({
        title: "إضافة ساعات",
        text: "هل تريدين إضافة 5 ساعات يدوية لهذه الطالبة؟",
        danger: false,
        okText: "نعم، أضيفي",
    });
    if (!ok) return;

    const next = (parseInt(current, 10) || 0) + 5;
    showLoader(true);
    try {
        const db = await loadDb();
        const u = db.users.find((x) => x.uid === uid);
        if (!u) {
            showNotification("المستخدم غير موجود.");
            return;
        }
        u.hours = next;
        await saveDb(db);
        await addNotificationForUid(
            uid,
            "تحديث الساعات",
            "تمت إضافة ساعات يدوية إلى ملفك من قبل الإدارة."
        );
    } catch (err) {
        console.error(err);
        showNotification("تعذّر تحديث الساعات.");
    } finally {
        showLoader(false);
    }
}

function closeAbout() {
    document.getElementById("about-modal").style.display = "none";
    document.getElementById("site-content").style.display = "block";
    document.querySelector(".site-nav").style.display = "flex";

    if (!location.hash || location.hash === "#") {
        routerSuppressHash = true;
        location.hash = "#/home";
        setTimeout(() => {
            routerSuppressHash = false;
            applyRouteFromHash();
        }, 0);
    } else {
        applyRouteFromHash();
    }
}

function getRouterHashForPage(pageId) {
    if (pageId === "home-page") return "#/home";
    if (pageId === "profile-page") return "#/profile";
    if (pageId === "admin-page") return "#/admin";
    if (pageId === "events-page") {
        if (currentCollegeForEvents) {
            return (
                "#/events?college=" +
                encodeURIComponent(currentCollegeForEvents)
            );
        }
        return "#/events";
    }
    return "#/home";
}

function parseRouterHash() {
    const raw = (location.hash || "#/home").replace(/^#/, "").trim();
    if (!raw || raw === "/") return { route: "home", college: "" };

    const [pathPart, queryPart] = raw.includes("?")
        ? raw.split("?")
        : [raw, ""];
    const seg = pathPart.split("/").filter(Boolean);
    const route = seg[0] || "home";
    const college = new URLSearchParams(queryPart).get("college") || "";
    return { route, college };
}

function syncRouterHash(pageId) {
    const siteContent = document.getElementById("site-content");
    if (!siteContent || siteContent.style.display === "none") return;

    const next = getRouterHashForPage(pageId);
    if (location.hash === next) return;

    routerSuppressHash = true;
    location.hash = next;
    setTimeout(() => {
        routerSuppressHash = false;
    }, 0);
}

function applyPageView(pageId) {
    if (pageId !== "admin-page") {
        clearAdminSubscription();
    }
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    const pageEl = document.getElementById(pageId);
    if (pageEl) pageEl.classList.add("active");
    window.scrollTo(0, 0);

    if (pageId === "events-page") {
        refreshEventsListUI().catch(console.error);
    }
    if (pageId === "profile-page") {
        renderUpcomingEvents().catch(console.error);
    }
}

function applyRouteFromHash() {
    if (routerSuppressHash) return;

    const siteContent = document.getElementById("site-content");
    if (!siteContent || siteContent.style.display === "none") return;

    const { route, college } = parseRouterHash();

    if (route === "home") {
        currentCollegeForEvents = "";
        const sel = document.getElementById("events-filter-college");
        if (sel) sel.value = "";
        applyPageView("home-page");
    } else if (route === "profile") {
        currentCollegeForEvents = "";
        applyPageView("profile-page");
    } else if (route === "admin") {
        if (!userData || userData.role !== "admin") {
            showNotification("هذه الصفحة خاصة بالمسؤولة.");
            routerSuppressHash = true;
            location.hash = "#/home";
            setTimeout(() => {
                routerSuppressHash = false;
            }, 0);
            currentCollegeForEvents = "";
            applyPageView("home-page");
            return;
        }
        applyPageView("admin-page");
        bindAdminTableSync();
    } else if (route === "events") {
        currentCollegeForEvents = college || "";
        const titleEl = document.getElementById("college-name-display");
        const sel = document.getElementById("events-filter-college");
        if (sel) sel.value = currentCollegeForEvents;
        if (titleEl) {
            titleEl.textContent = currentCollegeForEvents
                ? "فعاليات كلية " + currentCollegeForEvents
                : "جميع الفعاليات";
        }
        applyPageView("events-page");
        refreshEventsListUI().catch(console.error);
    } else {
        currentCollegeForEvents = "";
        applyPageView("home-page");
    }
}

function goToPage(id) {
    if (id !== "events-page") {
        currentCollegeForEvents = "";
        const sel = document.getElementById("events-filter-college");
        if (sel) sel.value = "";
    }
    applyPageView(id);
    syncRouterHash(id);
}

function closeNavMenu() {
    const nav = document.querySelector(".site-nav");
    const toggle = document.getElementById("nav-menu-toggle");
    if (!nav || !toggle) return;
    nav.classList.remove("nav-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "فتح القائمة");
    document.body.classList.remove("nav-menu-open-body");
}

function toggleNavMenu() {
    const nav = document.querySelector(".site-nav");
    const toggle = document.getElementById("nav-menu-toggle");
    if (!nav || !toggle) return;
    const open = !nav.classList.contains("nav-menu-open");
    nav.classList.toggle("nav-menu-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "إغلاق القائمة" : "فتح القائمة");
    document.body.classList.toggle("nav-menu-open-body", open);
}

// ——— الوضع الليلي ———

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved === "dark" || (!saved && prefersDark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const btn = document.getElementById("btn-theme-toggle");
    const icon = document.getElementById("theme-toggle-icon");
    if (btn) {
        btn.setAttribute("aria-pressed", dark ? "true" : "false");
        btn.setAttribute(
            "aria-label",
            dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الليلي"
        );
    }
    if (icon) {
        icon.className = dark ? "fas fa-sun" : "fas fa-moon";
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute("content", dark ? "#0d1f1f" : "#006064");
    }
}

function toggleDarkMode() {
    const cur =
        document.documentElement.getAttribute("data-theme") === "dark";
    const next = cur ? "light" : "dark";
    document.documentElement.setAttribute(
        "data-theme",
        next === "dark" ? "dark" : "light"
    );
    localStorage.setItem(THEME_KEY, next);
    initTheme();
}

// ——— PWA ———

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {
            console.log("Athar: تم تسجيل Service Worker");
        })
        .catch((e) => console.warn("Athar: SW", e));
}

function setupInstallPrompt() {
    const btn = document.getElementById("btn-install-pwa");
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (btn) btn.classList.remove("is-hidden");
    });
    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        if (btn) btn.classList.add("is-hidden");
        showNotification("تم تثبيت تطبيق أثر على جهازك.");
    });
}

function triggerPwaInstall() {
    if (!deferredInstallPrompt) {
        showNotification("التثبيت غير متاح حالياً من المتصفح.");
        return;
    }
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
        deferredInstallPrompt = null;
        const btn = document.getElementById("btn-install-pwa");
        if (btn) btn.classList.add("is-hidden");
    });
}

// ——— الإشعارات ———

async function refreshNotificationUI() {
    const badge = document.getElementById("notif-badge");
    const listEl = document.getElementById("notifications-list");
    if (!userData || userData.role === "admin") {
        if (badge) {
            badge.hidden = true;
            badge.textContent = "0";
        }
        if (listEl) listEl.innerHTML = "";
        return;
    }

    await ensureIdbInit();
    const db = await openIdb();
    const notes = await idbGetNotificationsForUid(db, userData.uid);
    notes.sort((a, b) => b.createdAt - a.createdAt);

    const unread = notes.filter((n) => !n.read).length;
    if (badge) {
        badge.hidden = unread === 0;
        badge.textContent = unread > 9 ? "9+" : String(unread);
    }

    if (listEl) {
        if (!notes.length) {
            listEl.innerHTML =
                '<li class="notifications-empty">لا توجد إشعارات بعد.</li>';
        } else {
            listEl.innerHTML = notes
                .map((n) => {
                    const dt = new Date(n.createdAt).toLocaleString("ar-SA", {
                        dateStyle: "short",
                        timeStyle: "short",
                    });
                    return `<li class="notif-item${n.read ? "" : " notif-item--unread"}" data-notif-id="${escapeHtml(n.id)}">
                        <div class="notif-item__title">${escapeHtml(n.title)}</div>
                        <div class="notif-item__body">${escapeHtml(n.body)}</div>
                        <div class="notif-item__date">${escapeHtml(dt)}</div>
                    </li>`;
                })
                .join("");
        }
    }
}

function toggleNotificationsPanel(ev) {
    if (ev) ev.stopPropagation();
    const panel = document.getElementById("notifications-panel");
    const btn = document.getElementById("btn-notifications");
    if (!panel || !btn) return;
    const open = panel.hasAttribute("hidden");
    if (open) {
        panel.removeAttribute("hidden");
        btn.setAttribute("aria-expanded", "true");
        void refreshNotificationUI();
    } else {
        panel.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", "false");
    }
}

function closeNotificationsPanel() {
    const panel = document.getElementById("notifications-panel");
    const btn = document.getElementById("btn-notifications");
    if (panel) panel.setAttribute("hidden", "");
    if (btn) btn.setAttribute("aria-expanded", "false");
}

async function markAllNotificationsRead() {
    if (!userData || userData.role === "admin") return;
    await ensureIdbInit();
    const db = await openIdb();
    const notes = await idbGetNotificationsForUid(db, userData.uid);
    for (const n of notes) {
        n.read = true;
        await idbPutNotification(db, n);
    }
    await refreshNotificationUI();
}

async function deleteCollegeEvent(eventId) {
    if (!userData || userData.role !== "leader") return;

    const ok = await showConfirmModal({
        title: "حذف الفعالية",
        text: "سيتم حذف الفعالية وإزالتها من سجلات التسجيل. هل أنتِ متأكدة؟",
        danger: true,
        okText: "حذف نهائي",
    });
    if (!ok) return;

    showLoader(true);
    try {
        const db = await loadDb();
        const ev = db.events.find((e) => e.id === eventId);
        const next = db.events.filter((e) => e.id !== eventId);
        if (next.length === db.events.length) {
            showNotification("الفعالية غير موجودة.");
            return;
        }
        await saveEvents(next);

        const affectedUids = [];
        for (const u of db.users) {
            normalizeUserRow(u);
            const had = u.volunteerEventIds.includes(eventId);
            u.volunteerEventIds = u.volunteerEventIds.filter((id) => id !== eventId);
            if (had) affectedUids.push(u.uid);
        }
        await saveDb(db);

        if (userData && Array.isArray(userData.volunteerEventIds)) {
            userData.volunteerEventIds = userData.volunteerEventIds.filter(
                (id) => id !== eventId
            );
        }

        const title = ev ? ev.title : "فعالية";
        for (const uid of affectedUids) {
            await addNotificationForUid(
                uid,
                "إلغاء فعالية",
                `تم حذف «${title}» وتحديث سجلك التطوعي.`
            );
        }

        showNotification("تم حذف الفعالية.");
        await refreshEventsListUI();
        await refreshNotificationUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر حذف الفعالية.");
    } finally {
        showLoader(false);
    }
}

window.addEventListener("athar-db-changed", () => {
    const ep = document.getElementById("events-page");
    if (ep && ep.classList.contains("active")) {
        refreshEventsListUI().catch(console.error);
    }
    void refreshNotificationUI();
});

window.addEventListener("hashchange", applyRouteFromHash);

function handleEventsListClick(e) {
    const delBtn = e.target.closest(".btn-delete-event");
    if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = delBtn.getAttribute("data-delete-id");
        if (id) deleteCollegeEvent(id);
        return;
    }
    const unBtn = e.target.closest(".btn-unregister-event");
    if (unBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = unBtn.getAttribute("data-unreg-id");
        if (id) unregisterFromEvent(id);
        return;
    }
    if (e.target.closest("a.btn-whatsapp")) {
        return;
    }
    const card = e.target.closest(".event-card[data-event-id]");
    if (!card || !card.classList.contains("event-card--can-register")) {
        return;
    }
    e.preventDefault();
    const id = card.getAttribute("data-event-id");
    if (id) registerForEvent(id);
}

function handleAdminTableClick(e) {
    const b = e.target.closest("[data-add-hours]");
    if (!b) return;
    const uid = b.getAttribute("data-add-hours");
    const manual = b.getAttribute("data-manual") || "0";
    if (uid) addHours(uid, manual);
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    registerServiceWorker();
    setupInstallPrompt();

    const savedView = localStorage.getItem(EVENTS_VIEW_KEY);
    if (savedView === "calendar" || savedView === "list") {
        eventsViewMode = savedView;
    }
    calendarMonthCursor = new Date();
    calendarMonthCursor.setDate(1);

    setAuthMode("login");

    const eventsListEl = document.getElementById("events-list");
    if (eventsListEl) {
        eventsListEl.addEventListener("click", handleEventsListClick);
    }

    const adminBody = document.getElementById("admin-table-body");
    if (adminBody) {
        adminBody.addEventListener("click", handleAdminTableClick);
    }

    const toggle = document.getElementById("nav-menu-toggle");
    if (toggle) {
        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleNavMenu();
        });
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeNavMenu();
            closeAddEventModal();
            closeVolunteerLogModal();
            closeNotificationsPanel();
            const cm = document.getElementById("confirm-modal");
            if (cm && cm.classList.contains("is-open")) {
                cm.classList.remove("is-open");
            }
        }
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#btn-notifications") && !e.target.closest("#notifications-panel")) {
            closeNotificationsPanel();
        }
    });
    window.addEventListener(
        "resize",
        () => {
            if (window.innerWidth > 900) closeNavMenu();
        },
        { passive: true }
    );

    if (eventsViewMode === "calendar") {
        setEventsViewMode("calendar");
    }
});

/** تعريفات عامة للـ HTML onclick */
window.setAuthMode = setAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
window.closeAbout = closeAbout;
window.goToPage = goToPage;
window.openEvents = openEvents;
window.loadAdmin = loadAdmin;
window.openVolunteerLogModal = openVolunteerLogModal;
window.closeVolunteerLogModal = closeVolunteerLogModal;
window.openAddEventModal = openAddEventModal;
window.closeAddEventModal = closeAddEventModal;
window.submitNewEvent = submitNewEvent;
window.goToLeaderHome = goToLeaderHome;
window.closeNavMenu = closeNavMenu;
window.toggleDarkMode = toggleDarkMode;
window.onEventsFilterChange = onEventsFilterChange;
window.onCollegeFilterChange = onCollegeFilterChange;
window.setEventsViewMode = setEventsViewMode;
window.calendarNav = calendarNav;
window.exportVolunteerCertificatePdf = exportVolunteerCertificatePdf;
window.triggerPwaInstall = triggerPwaInstall;
window.toggleNotificationsPanel = toggleNotificationsPanel;
window.markAllNotificationsRead = markAllNotificationsRead;
