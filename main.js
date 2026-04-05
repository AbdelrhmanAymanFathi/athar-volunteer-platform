/**
 * IndexedDB: users (uid) + events (id)
 * أدوار: admin | leader | student
 * منظّمة: leader@pnu.edu.sa — مسؤولة: admin@pnu.edu.sa
 */

const IDB_NAME = "athar_db";
const IDB_VERSION = 2;
const USERS_STORE = "users";
const EVENTS_STORE = "events";
const LEGACY_LS_KEY = "athar_local_v1";
const LEADER_EMAIL = "leader@pnu.edu.sa";
const ADMIN_EMAIL = "admin@pnu.edu.sa";

let idbConnection = null;
let idbInitPromise = null;

let userData = null;
let hoursUnsub = null;
let adminUnsub = null;
let hoursSyncHandler = null;
let adminSyncHandler = null;

/** كلية الفعاليات المعروضة حالياً */
let currentCollegeForEvents = "";

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
            if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
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

function findUserByEmail(db, email) {
    const e = email.trim().toLowerCase();
    return db.users.find((u) => u.email.trim().toLowerCase() === e) || null;
}

function toPublicUser(u) {
    const row = normalizeUserRow(u);
    return {
        uid: row.uid,
        name: row.name,
        email: row.email,
        phone: row.phone,
        dob: row.dob,
        hours: parseInt(row.hours, 10) || 0,
        role: row.role,
        volunteerEventIds: [...row.volunteerEventIds],
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
                if (userData) {
                    userData.hours = hrs;
                    userData.volunteerEventIds = [...(u.volunteerEventIds || [])];
                }
                updateChart(hrs);
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

    if (navAdmin) navAdmin.classList.add("is-hidden");
    if (navLeader) navLeader.classList.add("is-hidden");
    if (navProfile) navProfile.classList.remove("is-hidden");

    if (userData.role === "admin") {
        if (navAdmin) navAdmin.classList.remove("is-hidden");
        if (navProfile) navProfile.classList.add("is-hidden");
    } else if (userData.role === "leader") {
        if (navLeader) navLeader.classList.remove("is-hidden");
    }
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
    const role = resolveRoleFromEmail(email);

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
            normalizeUserRow(existing);
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
    updateNavForRole();
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

function escapeAttr(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function refreshEventsListUI() {
    const list = document.getElementById("events-list");
    const fab = document.getElementById("fab-add-event");
    if (!list) return;

    const { events } = await loadDb();
    const collegeEvents = events.filter(
        (ev) => ev.college === currentCollegeForEvents
    );
    const isLeader = userData && userData.role === "leader";
    const canRegister =
        userData &&
        userData.role !== "admin" &&
        (userData.role === "student" || userData.role === "leader");

    if (fab) {
        fab.classList.toggle("is-hidden", !isLeader);
    }

    if (!collegeEvents.length) {
        list.innerHTML = `
            <p class="events-empty-hint">لا توجد فعاليات مضافة لهذه الكلية بعد.${
                isLeader ? " استخدمي زر «+» لإضافة فعالية." : ""
            }</p>`;
        return;
    }

    const registered = new Set(userData?.volunteerEventIds || []);

    list.innerHTML = collegeEvents
        .map((ev) => {
            const title = escapeHtml(ev.title);
            const loc = escapeHtml(ev.location || "");
            const dateStr = escapeHtml(ev.date || "");
            const timeStr = escapeHtml(ev.time || "");
            const regBadge = registered.has(ev.id)
                ? '<span class="hours-tag event-registered-badge">مسجّلة في سجلك</span>'
                : canRegister
                  ? '<span class="event-tap-hint">اضغطي لتسجيل المشاركة</span>'
                  : "";
            const delBtn = isLeader
                ? `<button type="button" class="btn-delete-event" onclick="event.stopPropagation(); deleteCollegeEvent('${escapeAttr(ev.id)}')" aria-label="حذف الفعالية"><i class="fas fa-trash-alt"></i></button>`
                : "";

            const clickable =
                canRegister && !registered.has(ev.id)
                    ? `event-card--clickable" role="button" tabindex="0" onclick="registerForEvent('${escapeAttr(ev.id)}')`
                    : `event-card--static"`;

            const regClass = registered.has(ev.id) ? " event-card--registered" : "";

            return `
            <div class="event-card${regClass} ${clickable}>
                <div class="event-details">
                    <h4>${title}</h4>
                    <p><i class="far fa-calendar-alt"></i> <b>التاريخ:</b> ${dateStr}</p>
                    <p><i class="far fa-clock"></i> <b>الوقت:</b> ${timeStr}</p>
                    <p><i class="fas fa-map-marker-alt"></i> <b>المكان:</b> ${loc}</p>
                </div>
                <div class="event-card-actions">
                    ${regBadge}
                    ${delBtn}
                </div>
            </div>`;
        })
        .join("");
}

async function openEvents(college) {
    currentCollegeForEvents = college;
    document.getElementById("college-name-display").innerText =
        "فعاليات كلية " + college;
    goToPage("events-page");
    await refreshEventsListUI();
}

async function registerForEvent(eventId) {
    if (!userData || userData.role === "admin") {
        if (userData && userData.role === "admin") {
            showNotification("حساب المسؤولة لا يُسجَّل في الفعاليات.");
        }
        return;
    }
    if (userData.volunteerEventIds.includes(eventId)) {
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
        showNotification("تم تسجيل الفعالية في سجلك التطوعي.");
        await refreshEventsListUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر التسجيل في الفعالية.");
    } finally {
        showLoader(false);
    }
}

function openAddEventModal() {
    if (!userData || userData.role !== "leader") return;
    const m = document.getElementById("add-event-modal");
    if (!m) return;
    const lab = document.getElementById("add-event-college-label");
    if (lab) lab.textContent = currentCollegeForEvents || "—";
    m.classList.add("is-open");
    document.getElementById("new-event-title").value = "";
    document.getElementById("new-event-location").value = "";
    document.getElementById("new-event-date").value = "";
    document.getElementById("new-event-time").value = "";
}

function closeAddEventModal() {
    const m = document.getElementById("add-event-modal");
    if (m) m.classList.remove("is-open");
}

async function submitNewEvent(e) {
    e.preventDefault();
    if (!userData || userData.role !== "leader") return;

    const title = document.getElementById("new-event-title").value.trim();
    const location = document.getElementById("new-event-location").value.trim();
    const date = document.getElementById("new-event-date").value;
    const time = document.getElementById("new-event-time").value;

    if (!title) {
        showNotification("أدخلي اسم الفعالية.");
        return;
    }
    if (!currentCollegeForEvents) {
        showNotification("اختر الكلية من الصفحة الرئيسية أولاً.");
        return;
    }

    showLoader(true);
    try {
        const db = await loadDb();
        const ev = {
            id: newUid(),
            college: currentCollegeForEvents,
            title,
            location,
            date,
            time,
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

async function deleteCollegeEvent(eventId) {
    if (!userData || userData.role !== "leader") return;

    showLoader(true);
    try {
        const db = await loadDb();
        const next = db.events.filter((ev) => ev.id !== eventId);
        if (next.length === db.events.length) {
            showNotification("الفعالية غير موجودة.");
            return;
        }
        await saveEvents(next);

        for (const u of db.users) {
            normalizeUserRow(u);
            u.volunteerEventIds = u.volunteerEventIds.filter((id) => id !== eventId);
        }
        await saveDb(db);

        if (userData) {
            userData.volunteerEventIds = userData.volunteerEventIds.filter(
                (id) => id !== eventId
            );
        }

        showNotification("تم حذف الفعالية.");
        await refreshEventsListUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر حذف الفعالية.");
    } finally {
        showLoader(false);
    }
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

function goToLeaderHome() {
    goToPage("home-page");
    closeNavMenu();
    showNotification("اختر الكلية، ثم أضيفي أو حذفي الفعاليات من صفحة الفعاليات.");
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

    if (id === "events-page" && currentCollegeForEvents) {
        refreshEventsListUI().catch(console.error);
    }
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

window.addEventListener("athar-db-changed", () => {
    const ep = document.getElementById("events-page");
    if (
        ep &&
        ep.classList.contains("active") &&
        currentCollegeForEvents
    ) {
        refreshEventsListUI().catch(console.error);
    }
});

document.addEventListener("DOMContentLoaded", () => {
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
        }
    });
    window.addEventListener(
        "resize",
        () => {
            if (window.innerWidth > 900) closeNavMenu();
        },
        { passive: true }
    );
});
