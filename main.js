/**
 * قاعدة بيانات محلية عبر IndexedDB (بدون سيرفر).
 * اسم القاعدة: athar_db | مخزن: users (المفتاح: uid) | فهرس فريد: email
 * ترحيل لمرة واحدة من localStorage القديم (athar_local_v1) إن وُجد.
 */

const IDB_NAME = "athar_db";
const IDB_VERSION = 1;
const USERS_STORE = "users";
const LEGACY_LS_KEY = "athar_local_v1";

let idbConnection = null;
let idbInitPromise = null;

let userData = null;
let hoursUnsub = null;
let adminUnsub = null;
let hoursSyncHandler = null;
let adminSyncHandler = null;

function showNotification(message, duration = 4000) {
    const toast = document.getElementById("notification-toast");
    const messageEl = document.getElementById("notification-message");
    messageEl.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

function showLoader(v) {
    document.getElementById("loader").style.display = v ? "flex" : "none";
}

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
            if (!db.objectStoreNames.contains(USERS_STORE)) {
                const os = db.createObjectStore(USERS_STORE, { keyPath: "uid" });
                os.createIndex("by_email", "email", { unique: true });
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

async function loadDb() {
    await ensureIdbInit();
    const db = await openIdb();
    const users = await idbGetAllUsers(db);
    return { users };
}

async function saveDb(dbPayload) {
    await ensureIdbInit();
    const db = await openIdb();
    await idbReplaceAllUsers(db, dbPayload.users);
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

function findUserByEmail(db, email) {
    const e = email.trim().toLowerCase();
    return db.users.find((u) => u.email.trim().toLowerCase() === e) || null;
}

function toPublicUser(u) {
    return {
        uid: u.uid,
        name: u.name,
        email: u.email,
        phone: u.phone,
        dob: u.dob,
        hours: parseInt(u.hours, 10) || 0,
        role: u.role,
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
    };
}

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
                const hrs = parseInt(u.hours, 10) || 0;
                if (userData) userData.hours = hrs;
                updateChart(hrs);
            })
            .catch((err) => console.error(err));
    };
    window.addEventListener("athar-db-changed", hoursSyncHandler);
    hoursUnsub = setInterval(hoursSyncHandler, 1200);
    hoursSyncHandler();
}

async function handleAuth(e) {
    e.preventDefault();
    const fullname = document.getElementById("reg-fullname").value.trim();
    const names = fullname.split(/\s+/);
    if (names.length < 3) {
        showNotification("مطلوب على الأقل ثلاثة أسماء");
        return;
    }

    const email = document.getElementById("reg-email").value.trim();
    const passwordInput = document.querySelector(
        "#login-wrapper input[type='password']"
    );
    const password = passwordInput ? passwordInput.value : "";
    const phone = document.getElementById("reg-phone").value;
    const dob = document.getElementById("reg-dob").value;
    const isAdmin = email === "admin@pnu.edu.sa";
    const role = isAdmin ? "admin" : "student";

    if (!email) {
        showNotification("أدخلي البريد الجامعي.");
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
            const uid = newUid();
            const row = {
                ...buildUserPayload(uid, fullname, email, phone, dob, role),
                pwdHash,
            };
            db.users.push(row);
            await saveDb(db);
            userData = toPublicUser(row);
        } else {
            if (existing.pwdHash !== pwdHash) {
                showNotification("البريد مسجّل مسبقاً وكلمة المرور غير صحيحة.");
                return;
            }
            Object.assign(existing, {
                name: fullname,
                phone,
                dob,
                role,
            });
            await saveDb(db);
            userData = toPublicUser(existing);
        }

        if (userData && userData.role !== "admin") {
            subscribeCurrentUserHours(userData.uid);
        } else {
            clearHoursSubscription();
        }

        startApp();
    } catch (err) {
        console.error(err);
        showNotification(
            "تعذّر إكمال التسجيل. تأكدي أن المتصفح يدعم IndexedDB وأن التخزين غير محظور."
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

    updateChart(userData.hours);

    if (userData.role === "admin") {
        document.getElementById("nav-admin").classList.remove("is-hidden");
        document.getElementById("nav-profile").classList.add("is-hidden");
    } else {
        document.getElementById("nav-profile").classList.remove("is-hidden");
        document.getElementById("nav-admin").classList.add("is-hidden");
    }
}

function updateChart(h) {
    const hrs = parseInt(h, 10) || 0;
    const percent = Math.min((hrs / 50) * 100, 100);
    document.getElementById("chart-circle").style.background =
        `conic-gradient(var(--primary) ${percent}%, #eee 0%)`;
    document
        .getElementById("chart-circle")
        .querySelector("span").innerText = percent.toFixed(0) + "%";
    document.getElementById("hours-summary").innerText =
        `أنجزتِ ${hrs} من 50 ساعة تطوعية`;
}

function escapeHtml(text) {
    if (text === undefined || text === null) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
}

function openEvents(college) {
    document.getElementById("college-name-display").innerText =
        "فعاليات كلية " + college;
    const list = document.getElementById("events-list");
    list.innerHTML = `
            <div class="event-card">
                <div class="event-details">
                    <h4>تنظيم حفل استقبال المستجدات - ${college}</h4>
                    <p><i class="far fa-calendar-alt"></i> <b>التاريخ:</b> الأحد، 30 مارس 2026</p>
                    <p><i class="far fa-clock"></i> <b>الوقت:</b> 09:00 ص - 01:00 ظ</p>
                    <p><i class="fas fa-map-marker-alt"></i> <b>المكان:</b> المسرح الرئيسي بالكلية</p>
                </div>
                <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                    <span class="hours-tag">+4 ساعات مكتسبة</span>
                    <a href="https://chat.whatsapp.com/IEIqX7xdIGB0siKRT8u9x" target="_blank" style="text-decoration: none; width: 100%;">
                        <button style="width: 100%; padding:12px 25px; background:#25D366; color:white; border:none; border-radius:10px; cursor:pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <i class="fab fa-whatsapp"></i> انضمام للمجموعة
                        </button>
                    </a>
                </div>
            </div>
        `;
    goToPage("events-page");
}

function renderAdminTable(users) {
    const table = document.getElementById("admin-table-body");
    table.innerHTML = "";
    const rows = [];
    users.forEach((u) => {
        if (u.role === "admin") return;
        const hrs = parseInt(u.hours, 10) || 0;
        const uid = escapeHtml(u.uid);
        const name = escapeHtml(u.name);
        rows.push(`<tr>
                    <td>${name}</td>
                    <td><b>${hrs}</b> ساعة</td>
                    <td><button type="button" onclick="addHours('${uid}', ${hrs})" style="background:#2e7d32; color:white; border:none; padding:8px 15px; border-radius:8px; cursor:pointer; font-weight:bold;">+5 ساعات</button></td>
                </tr>`);
    });
    if (!rows.length) {
        table.innerHTML =
            "<tr><td colspan='3' style='text-align:center;'>لا توجد طالبات مسجّلات بعد.</td></tr>";
    } else {
        table.innerHTML = rows.join("");
    }
}

function loadAdmin() {
    goToPage("admin-page");
    clearAdminSubscription();

    const table = document.getElementById("admin-table-body");
    table.innerHTML =
        "<tr><td colspan='3' style='text-align:center;'>جاري جلب قائمة الطالبات...</td></tr>";

    adminSyncHandler = () => {
        loadDb()
            .then((db) => renderAdminTable(db.users))
            .catch((err) => console.error(err));
    };
    window.addEventListener("athar-db-changed", adminSyncHandler);
    adminUnsub = setInterval(adminSyncHandler, 1000);
    adminSyncHandler();
}

async function addHours(uid, current) {
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
    goToPage("home-page");
}

function goToPage(id) {
    if (id !== "admin-page") {
        clearAdminSubscription();
    }
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    window.scrollTo(0, 0);
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

document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("nav-menu-toggle");
    if (toggle) {
        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleNavMenu();
        });
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeNavMenu();
    });
    window.addEventListener(
        "resize",
        () => {
            if (window.innerWidth > 900) closeNavMenu();
        },
        { passive: true }
    );
});
