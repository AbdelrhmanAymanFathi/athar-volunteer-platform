/**
 * IndexedDB: users (uid) + events (id) + requests (id) + chats (id)
 * أدوار: admin | student
 * حسابات الإدارة حسب الكليات محددة مسبقاً داخل COLLEGE_CATALOG
 */

const IDB_NAME = "athar_db";
const IDB_VERSION = 6;
const USERS_STORE = "users";
const EVENTS_STORE = "events";
const REQUESTS_STORE = "requests";
const CHATS_STORE = "chats";
const LEGACY_LS_KEY = "athar_local_v1";
const ADMIN_ACCOUNTS_SEED_KEY = "athar_college_admin_seed_version";
const ADMIN_ACCOUNTS_SEED_VERSION = "v1";
const STUDENT_EMAIL_DOMAIN = "pnu.edu.sa";

const COLLEGE_CATALOG = [
    {
        key: "computer",
        name: "الحاسب",
        displayName: "كلية الحاسب",
        icon: "💻",
        adminEmail: "pnu31@pnu.edu.sa",
        adminPassword: "P@ssw0rd31",
    },
    {
        key: "languages",
        name: "اللغات",
        displayName: "كلية اللغات",
        icon: "🌐",
        adminEmail: "pnu51@pnu.edu.sa",
        adminPassword: "P@ssw0rd51",
    },
    {
        key: "nursing",
        name: "التمريض",
        displayName: "كلية التمريض",
        icon: "🏥",
        adminEmail: "pnu101@pnu.edu.sa",
        adminPassword: "P@ssw0rd101",
    },
    {
        key: "arts-design",
        name: "التصاميم والفنون",
        displayName: "كلية التصاميم والفنون",
        icon: "🎨",
        adminEmail: "pnu81@pnu.edu.sa",
        adminPassword: "P@ssw0rd81",
    },
    {
        key: "dentistry",
        name: "طب الأسنان",
        displayName: "كلية طب الأسنان",
        icon: "🦷",
        adminEmail: "pnu21@pnu.edu.sa",
        adminPassword: "P@ssw0rd21",
    },
    {
        key: "business",
        name: "إدارة الأعمال",
        displayName: "كلية إدارة الأعمال",
        icon: "💼",
        adminEmail: "pnu61@pnu.edu.sa",
        adminPassword: "P@ssw0rd61",
    },
];

const COLLEGE_NAME_ALIASES = {
    "الحاسب": "الحاسب",
    "كلية الحاسب": "الحاسب",
    "علوم الحاسب": "الحاسب",
    "اللغات": "اللغات",
    "كلية اللغات": "اللغات",
    "التمريض": "التمريض",
    "كلية التمريض": "التمريض",
    "التصاميم": "التصاميم والفنون",
    "كلية التصاميم": "التصاميم والفنون",
    "التصاميم والفنون": "التصاميم والفنون",
    "كلية التصاميم والفنون": "التصاميم والفنون",
    "طب الأسنان": "طب الأسنان",
    "كلية طب الأسنان": "طب الأسنان",
    "إدارة الأعمال": "إدارة الأعمال",
    "كلية إدارة الأعمال": "إدارة الأعمال",
    "ادارة الاعمال": "إدارة الأعمال",
    "كلية ادارة الاعمال": "إدارة الأعمال",
    "إدارة الاعمال": "إدارة الأعمال",
    "كلية إدارة الاعمال": "إدارة الأعمال",
};

let idbConnection = null;
let idbInitPromise = null;

let userData = null;
let hoursUnsub = null;
let adminUnsub = null;
let hoursSyncHandler = null;
let adminSyncHandler = null;

/** كلية الفعاليات المعروضة حالياً */
let currentCollegeForEvents = "";
let currentEventChatId = "";

/** يمنع حلقة لا نهائية عند مزامنة location.hash برمجياً */
let routerSuppressHash = false;

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
            if (!db.objectStoreNames.contains(REQUESTS_STORE)) {
                db.createObjectStore(REQUESTS_STORE, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(CHATS_STORE)) {
                db.createObjectStore(CHATS_STORE, { keyPath: "id" });
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

function idbGetAllRequests(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(REQUESTS_STORE, "readonly");
        const r = tx.objectStore(REQUESTS_STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
}

function idbGetAllChats(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CHATS_STORE, "readonly");
        const r = tx.objectStore(CHATS_STORE).getAll();
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

function idbReplaceAllRequests(db, requests) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(REQUESTS_STORE, "readwrite");
        const store = tx.objectStore(REQUESTS_STORE);
        store.clear();
        for (let i = 0; i < requests.length; i++) {
            store.put(requests[i]);
        }
        tx.oncomplete = () => {
            window.dispatchEvent(new CustomEvent("athar-db-changed"));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("abort"));
    });
}

function idbReplaceAllChats(db, chats) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CHATS_STORE, "readwrite");
        const store = tx.objectStore(CHATS_STORE);
        store.clear();
        for (let i = 0; i < chats.length; i++) {
            store.put(chats[i]);
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

async function ensureDefaultAccounts(db) {
    const users = await idbGetAllUsers(db);
    const adminEmails = new Set(
        COLLEGE_CATALOG.map((college) => college.adminEmail)
    );
    const shouldResetAdminCredentials =
        localStorage.getItem(ADMIN_ACCOUNTS_SEED_KEY) !==
        ADMIN_ACCOUNTS_SEED_VERSION;

    const nonLegacyUsers = users.filter((user) => {
        const email = String(user.email || "").trim().toLowerCase();
        return user.role !== "admin" || adminEmails.has(email);
    });

    const updates = [];
    let needsRewrite = false;

    for (const college of COLLEGE_CATALOG) {
        const adminIndex = nonLegacyUsers.findIndex(
            (u) => String(u.email || "").trim().toLowerCase() === college.adminEmail
        );

        if (adminIndex === -1) {
            updates.push({
                uid: newUid(),
                name: `مسؤولة ${college.displayName}`,
                email: college.adminEmail,
                phone: "",
                dob: "",
                hours: 0,
                role: "admin",
                college: college.name,
                volunteerEventIds: [],
                pwdHash: await getAdminPasswordHash(college.adminEmail),
            });
            continue;
        }

        const existing = normalizeUserRow(nonLegacyUsers[adminIndex]);
        const normalizedCollege = normalizeCollegeName(existing.college);
        if (
            !existing.pwdHash ||
            normalizedCollege !== college.name ||
            shouldResetAdminCredentials
        ) {
            nonLegacyUsers[adminIndex] = {
                ...existing,
                name: `مسؤولة ${college.displayName}`,
                college: college.name,
                pwdHash: await getAdminPasswordHash(college.adminEmail),
            };
            needsRewrite = true;
        }
    }

    if (updates.length > 0 || needsRewrite) {
        const allUsers = [...nonLegacyUsers, ...updates];
        await idbReplaceAllUsers(db, allUsers);
    }

    if (shouldResetAdminCredentials) {
        localStorage.setItem(
            ADMIN_ACCOUNTS_SEED_KEY,
            ADMIN_ACCOUNTS_SEED_VERSION
        );
    }
}

function ensureIdbInit() {
    if (!idbInitPromise) {
        idbInitPromise = (async () => {
            const db = await openIdb();
            await migrateLegacyLocalStorage(db);
            await ensureDefaultAccounts(db);
        })();
    }
    return idbInitPromise;
}

function normalizeUserRow(u) {
    const row = { ...u };
    if (!Array.isArray(row.volunteerEventIds)) row.volunteerEventIds = [];
    row.college = normalizeCollegeName(row.college);
    if (row.role === "admin") {
        const adminAccount = getAdminAccountByEmail(row.email);
        if (adminAccount && !row.college) {
            row.college = adminAccount.college;
        }
    }
    return row;
}

/** هدف التخرج التطوعي (للمخطط الدائري) */
const VOLUNTEER_GRADUATION_TARGET = 50;

/**
 * مجموع ساعات الفعاليات التي سجّلت الطالبة مشاركتها (حسب volunteerHours لكل فعالية).
 */
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

/**
 * إجمالي الساعات المعروضة: نعتمد القيمة الأعلى بين الساعات المخزنة
 * والساعات المحسوبة من الفعاليات المعتمدة لتفادي التكرار في البيانات القديمة.
 */
function totalVolunteerHoursForDisplay(userRow, events) {
    const fromEvents = sumVolunteerHoursFromEvents(userRow, events);
    const stored = parseInt(userRow.hours, 10) || 0;
    return Math.max(fromEvents, stored);
}

function getCompletedRequestCountForUser(userId, requests) {
    return (requests || []).filter(
        (request) => request.userId === userId && request.status === "completed"
    ).length;
}

function getVolunteerHoursForRequest(request, eventRecord) {
    if (!request || !eventRecord || request.status !== "completed") return 0;
    return Math.max(1, parseInt(eventRecord.volunteerHours, 10) || 4);
}

function renderAdminUsersSection(users, events, requests, adminCollege) {
    const summaryEl = document.getElementById("admin-users-summary");
    const listEl = document.getElementById("admin-users-list");
    if (!summaryEl || !listEl) return;

    const normalizedAdminCollege = normalizeCollegeName(adminCollege);
    const scopedEvents = (events || []).filter(
        (eventRecord) =>
            normalizeCollegeName(eventRecord.college) === normalizedAdminCollege
    );
    const scopedEventMap = new Map(scopedEvents.map((eventRecord) => [eventRecord.id, eventRecord]));
    const scopedRequests = (requests || []).filter((request) =>
        scopedEventMap.has(request.eventId)
    );
    const studentMap = new Map(
        (users || [])
            .map(normalizeUserRow)
            .filter((user) => user.role !== "admin")
            .map((user) => [user.uid, user])
    );
    const students = Array.from(
        scopedRequests.reduce((map, request) => {
            const student = studentMap.get(request.userId);
            const eventRecord = scopedEventMap.get(request.eventId);
            if (!student || !eventRecord) return map;

            if (!map.has(student.uid)) {
                map.set(student.uid, {
                    student,
                    requests: [],
                    completedHours: 0,
                });
            }

            const row = map.get(student.uid);
            const earnedHours = getVolunteerHoursForRequest(request, eventRecord);
            row.requests.push({
                request,
                event: eventRecord,
                earnedHours,
            });
            row.completedHours += earnedHours;
            return map;
        }, new Map()).values()
    ).sort((left, right) => {
            const hoursDiff = right.completedHours - left.completedHours;
            if (hoursDiff !== 0) return hoursDiff;
            return String(left.student.name || "").localeCompare(
                String(right.student.name || ""),
                "ar"
            );
        });

    const totalStudents = students.length;
    const totalHours = students.reduce(
        (sum, row) => sum + row.completedHours,
        0
    );
    const totalCompletedEvents = scopedRequests.filter(
        (request) => request.status === "completed"
    ).length;

    summaryEl.innerHTML = `
        <div class="admin-summary-card">
            <strong>${totalStudents}</strong>
            <span>عدد الطالبات في فعاليات ${escapeHtml(getCollegeDisplayName(normalizedAdminCollege))}</span>
        </div>
        <div class="admin-summary-card">
            <strong>${totalHours}</strong>
            <span>إجمالي الساعات المكتسبة في هذه الكلية</span>
        </div>
        <div class="admin-summary-card">
            <strong>${totalCompletedEvents}</strong>
            <span>إجمالي المشاركات المكتملة</span>
        </div>
    `;

    if (!students.length) {
        listEl.innerHTML =
            '<div class="admin-empty-state">لا توجد طالبات مرتبطات بفعاليات هذه الكلية حالياً.</div>';
        return;
    }

    listEl.innerHTML = students
        .map((row) => {
            const student = row.student;
            const completedRequestsCount = getCompletedRequestCountForUser(
                student.uid,
                scopedRequests
            );
            const eventsBreakdownHtml = row.requests
                .sort((left, right) => {
                    const leftDate = new Date(left.event.date || 0).getTime();
                    const rightDate = new Date(right.event.date || 0).getTime();
                    return rightDate - leftDate;
                })
                .map(({ request, event, earnedHours }) => {
                    const statusText =
                        request.status === "completed" ? "مكتملة" : "قيد المراجعة";
                    const statusClass =
                        request.status === "completed"
                            ? "admin-event-chip--completed"
                            : "admin-event-chip--pending";
                    return `
                        <div class="admin-user-event-row">
                            <div class="admin-user-event-row__main">
                                <strong>${escapeHtml(event.title || "-")}</strong>
                                <span>${escapeHtml(formatEventDateDisplay(event.date))}</span>
                            </div>
                            <div class="admin-user-event-row__meta">
                                <span class="admin-event-chip ${statusClass}">${statusText}</span>
                                <span class="admin-user-event-row__hours">${earnedHours} ساعة</span>
                            </div>
                        </div>
                    `;
                })
                .join("");

            return `
                <article class="admin-user-card">
                    <div class="admin-user-card__header">
                        <div>
                            <h4 class="admin-user-card__name">${escapeHtml(student.name || "-")}</h4>
                            <div class="admin-user-card__college">${escapeHtml(getCollegeDisplayName(normalizedAdminCollege))}</div>
                        </div>
                        <div class="admin-user-card__hours">
                            ${row.completedHours} ساعة
                            <small>الساعات التطوعية</small>
                        </div>
                    </div>
                    <div class="admin-user-meta">
                        <div><strong>الإيميل:</strong> ${escapeHtml(student.email || "-")}</div>
                        <div><strong>الجوال:</strong> ${escapeHtml(student.phone || "-")}</div>
                        <div><strong>الفعاليات المكتملة:</strong> ${completedRequestsCount}</div>
                    </div>
                    <div class="admin-user-events-list">
                        <div class="admin-user-events-list__title">تفصيل الفعاليات</div>
                        ${eventsBreakdownHtml}
                    </div>
                </article>
            `;
        })
        .join("");
}

async function loadDb() {
    await ensureIdbInit();
    const db = await openIdb();
    const [users, events, requests, chats] = await Promise.all([
        idbGetAllUsers(db),
        idbGetAllEvents(db),
        idbGetAllRequests(db),
        idbGetAllChats(db),
    ]);
    return {
        users: users.map(normalizeUserRow),
        events: Array.isArray(events) ? events : [],
        requests: Array.isArray(requests) ? requests : [],
        chats: Array.isArray(chats) ? chats : [],
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

async function saveRequests(requests) {
    await ensureIdbInit();
    const db = await openIdb();
    await idbReplaceAllRequests(db, requests);
}

async function saveChats(chats) {
    await ensureIdbInit();
    const db = await openIdb();
    await idbReplaceAllChats(db, chats);
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

const adminPwdHashCache = new Map();
async function getAdminPasswordHash(email) {
    const adminAccount = getAdminAccountByEmail(email);
    if (!adminAccount) {
        throw new Error("Admin account not found");
    }
    if (!adminPwdHashCache.has(adminAccount.email)) {
        adminPwdHashCache.set(
            adminAccount.email,
            await hashPassword(adminAccount.password)
        );
    }
    return adminPwdHashCache.get(adminAccount.email);
}

function normalizeCollegeName(college) {
    const value = String(college || "").trim();
    if (!value) return "";
    return COLLEGE_NAME_ALIASES[value] || value;
}

function getCollegeConfig(college) {
    const normalized = normalizeCollegeName(college);
    return COLLEGE_CATALOG.find((item) => item.name === normalized) || null;
}

function getCollegeDisplayName(college) {
    const item = getCollegeConfig(college);
    return item ? item.displayName : `كلية ${normalizeCollegeName(college)}`;
}

function getAdminAccountByEmail(email) {
    const normalized = normalizeEmailInput(email);
    const college = COLLEGE_CATALOG.find(
        (item) => item.adminEmail === normalized
    );
    if (!college) return null;
    return {
        email: college.adminEmail,
        password: college.adminPassword,
        college: college.name,
        displayName: college.displayName,
    };
}

function getUserCollege(user) {
    return normalizeCollegeName(user?.college);
}

function canUserAccessEventChat(user, eventRecord, requestRecord) {
    if (!user || !eventRecord) return false;
    if (user.role === "admin") {
        return canAdminAccessCollege(eventRecord.college);
    }
    return requestRecord?.status === "completed";
}

function canAdminAccessCollege(college) {
    if (!userData || userData.role !== "admin") return true;
    return getUserCollege(userData) === normalizeCollegeName(college);
}

function renderHomeColleges() {
    const grid = document.getElementById("colleges-grid");
    if (!grid) return;

    const colleges = userData && userData.role === "admin"
        ? COLLEGE_CATALOG.filter((college) => college.name === getUserCollege(userData))
        : COLLEGE_CATALOG;

    grid.innerHTML = colleges
        .map((college) => `
            <div class="college-card" onclick="openEvents('${escapeAttr(college.name)}')">
              <span class="college-icon">${college.icon}</span><strong>${escapeHtml(college.displayName)}</strong>
            </div>
        `)
        .join("");
}

function isAdminEmail(email) {
    const e = normalizeEmailInput(email);
    return !!getAdminAccountByEmail(e);
}

function findUserByEmail(db, email) {
    const e = normalizeEmailInput(email);
    return db.users.find((u) => u.email.trim().toLowerCase() === e) || null;
}

function getAuthEmailInput() {
    const el = document.getElementById("reg-email");
    return el ? el.value.trim() : "";
}

function normalizeEmailInput(email) {
    const value = String(email || "").trim().toLowerCase();
    if (!value) return "";
    if (value.includes("@")) return value;
    return `${value}@${STUDENT_EMAIL_DOMAIN}`;
}

function isValidStudentEmailLocalPart(value) {
    return /^\d{9}$/.test(String(value || "").trim());
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
        college: row.college,
        volunteerEventIds: [...ids],
    };
}

function buildUserPayload(uid, name, email, phone, dob, role, college = "") {
    return {
        uid,
        name,
        email,
        phone,
        dob: dob || "",
        hours: 0,
        role,
        college: normalizeCollegeName(college),
        volunteerEventIds: [],
    };
}

function resolveRoleFromEmail(email) {
    const e = normalizeEmailInput(email);
    if (isAdminEmail(e)) return "admin";
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
                const hrs = totalVolunteerHoursForDisplay(u, db.events);
                if (userData) {
                    userData.hours = hrs;
                    userData.volunteerEventIds = [
                        ...normalizeUserRow(u).volunteerEventIds,
                    ];
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
    const navProfile = document.getElementById("nav-profile");

    if (navAdmin) navAdmin.classList.add("is-hidden");
    if (navProfile) navProfile.classList.remove("is-hidden");

    if (userData.role === "admin") {
        if (navAdmin) navAdmin.classList.remove("is-hidden");
        if (navProfile) navProfile.classList.add("is-hidden");
    }
}

function getAuthPassword() {
    const el = document.getElementById("login-password");
    return el ? el.value : "";
}

function getForgotPasswordValues() {
    const newPasswordEl = document.getElementById("forgot-password-new");
    const confirmPasswordEl = document.getElementById("forgot-password-confirm");
    return {
        newPassword: newPasswordEl ? newPasswordEl.value : "",
        confirmPassword: confirmPasswordEl ? confirmPasswordEl.value : "",
    };
}

function getAuthMode() {
    const w = document.getElementById("login-wrapper");
    return w && w.dataset.authMode === "register" ? "register" : "login";
}

function syncAuthEmailField(mode) {
    const emailInput = document.getElementById("reg-email");
    if (!emailInput) return;

    const isRegister = mode === "register";
    emailInput.placeholder = isRegister
        ? "أدخلي 9 أرقام"
        : "أدخلي الرقم الجامعي";
    emailInput.inputMode = isRegister ? "numeric" : "text";
    emailInput.maxLength = isRegister ? 9 : 32;
}

function clearForgotPasswordForm() {
    const newPasswordEl = document.getElementById("forgot-password-new");
    const confirmPasswordEl = document.getElementById("forgot-password-confirm");
    if (newPasswordEl) newPasswordEl.value = "";
    if (confirmPasswordEl) confirmPasswordEl.value = "";
}

function toggleForgotPasswordPanel(forceOpen) {
    const panel = document.getElementById("forgot-password-panel");
    if (!panel || getAuthMode() !== "login") return;

    const shouldOpen =
        typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
    panel.hidden = !shouldOpen;

    if (!shouldOpen) {
        clearForgotPasswordForm();
    }
}

function syncForgotPasswordVisibility(mode) {
    const trigger = document.getElementById("forgot-password-trigger");
    const panel = document.getElementById("forgot-password-panel");
    const isRegister = mode === "register";

    if (trigger) trigger.hidden = isRegister;
    if (panel && isRegister) {
        panel.hidden = true;
        clearForgotPasswordForm();
    }
}

function syncRegisterHintsVisibility(mode) {
    const isRegister = mode === "register";
    const emailHint = document.getElementById("register-email-hint");
    const passwordHints = document.getElementById("pw-hints");

    if (emailHint) emailHint.hidden = !isRegister;
    if (passwordHints) passwordHints.hidden = !isRegister;
}

function sanitizeStudentIdInput() {
    const emailInput = document.getElementById("reg-email");
    if (!emailInput || getAuthMode() !== "register") return;

    const digitsOnly = emailInput.value.replace(/\D/g, "").slice(0, 9);
    if (emailInput.value !== digitsOnly) {
        emailInput.value = digitsOnly;
    }
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
    syncAuthEmailField(mode);
    syncForgotPasswordVisibility(mode);
    syncRegisterHintsVisibility(mode);
    if (isRegister) {
        sanitizeStudentIdInput();
    }

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
        pw.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
    }
}

async function handleForgotPasswordReset() {
    if (getAuthMode() !== "login") return;

    const emailInput = getAuthEmailInput();
    const email = normalizeEmailInput(emailInput);
    const { newPassword, confirmPassword } = getForgotPasswordValues();

    if (!emailInput) {
        showNotification("أدخلي الرقم الجامعي أولاً.");
        return;
    }
    if (!isAdminEmail(email) && !isValidStudentEmailLocalPart(emailInput)) {
        showNotification("أدخلي الرقم الجامعي الصحيح أولاً.");
        return;
    }
    if (!newPassword || newPassword.length < 6) {
        showNotification("كلمة المرور الجديدة مطلوبة ولا تقل عن 6 أحرف.");
        return;
    }
    if (newPassword !== confirmPassword) {
        showNotification("كلمتا المرور غير متطابقتين.");
        return;
    }

    showLoader(true);

    try {
        const db = await loadDb();
        const existing = findUserByEmail(db, email);
        if (!existing) {
            showNotification("لا يوجد حساب بهذا الرقم الجامعي.");
            return;
        }

        existing.pwdHash = await hashPassword(newPassword);
        await saveDb(db);
        clearForgotPasswordForm();
        toggleForgotPasswordPanel(false);
        showNotification("تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.");
    } catch (err) {
        console.error(err);
        showNotification("تعذّر تغيير كلمة المرور.");
    } finally {
        showLoader(false);
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
    const emailInput = getAuthEmailInput();
    const password = getAuthPassword();

    if (!emailInput) {
        showNotification("أدخلي الرقم الجامعي.");
        return;
    }
    if (!password || password.length < 6) {
        showNotification("كلمة المرور مطلوبة ولا تقل عن 6 أحرف.");
        return;
    }

    const email = normalizeEmailInput(emailInput);

    showLoader(true);

    try {
        const pwdHash = await hashPassword(password);
        const db = await loadDb();
        const existing = findUserByEmail(db, email);

        if (!existing) {
            showNotification(
                "لا يوجد حساب بهذا الرقم الجامعي. أنشئي حساباً من «تسجيل جديد»."
            );
            return;
        }

        if (existing.pwdHash !== pwdHash) {
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
    const names = fullname.split(/\s+/);
    if (names.length < 3) {
        showNotification("مطلوب على الأقل ثلاثة أسماء");
        return;
    }

    const emailInput = getAuthEmailInput();
    const password = getAuthPassword();
    const phone = document.getElementById("reg-phone").value.trim();
    const email = normalizeEmailInput(emailInput);
    const role = resolveRoleFromEmail(email);

    if (!emailInput) {
        showNotification("أدخلي الرقم الجامعي.");
        return;
    }
    if (!isValidStudentEmailLocalPart(emailInput)) {
        showNotification("يجب إدخال الرقم الجامعي من 9 أرقام.");
        return;
    }
    if (!password || password.length < 6) {
        showNotification("كلمة المرور مطلوبة ولا تقل عن 6 أحرف.");
        return;
    }
    if (!phone) {
        showNotification("أدخلي رقم الجوال.");
        return;
    }

    if (role === "admin") {
        showNotification(
            "حساب الإدارة موجود أساساً. استخدمي «تسجيل الدخول»."
        );
        return;
    }

    showLoader(true);

    try {
        const pwdHash = await hashPassword(password);
        const db = await loadDb();
        const existing = findUserByEmail(db, email);

        if (existing) {
            showNotification(
                "الرقم الجامعي مسجّل مسبقاً. استخدمي «تسجيل الدخول»."
            );
            return;
        }

        const uid = newUid();
        const row = {
            ...buildUserPayload(uid, fullname, email, phone, "", role),
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
    // حفظ الجلسة في localStorage
    localStorage.setItem("athar_user_session", JSON.stringify(userData));

    document.getElementById("login-wrapper").style.display = "none";
    document.getElementById("about-modal").style.display = "flex";

    document.getElementById("prof-name-title").innerText = userData.name;
    document.getElementById("prof-name").innerText = userData.name;
    document.getElementById("prof-email").innerText = userData.email;
    document.getElementById("prof-phone").innerText = userData.phone;
    renderHomeColleges();

    if (userData && userData.role !== "admin") {
        void refreshVolunteerHoursUI();
    } else {
        updateChart(0);
    }
    updateNavForRole();
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
    } catch (err) {
        console.error(err);
    }
}

function updateChart(h) {
    const hrs = parseInt(h, 10) || 0;
    const cap = VOLUNTEER_GRADUATION_TARGET;
    const percent = Math.min((hrs / cap) * 100, 100);
    document.getElementById("chart-circle").style.background =
        `conic-gradient(var(--primary) ${percent}%, #eee 0%)`;
    document
        .getElementById("chart-circle")
        .querySelector("span").innerText = percent.toFixed(0) + "%";
    document.getElementById("hours-summary").innerText =
        `أنجزتِ ${hrs} من ${cap} ساعة تطوعية`;
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

async function refreshEventsListUI() {
    const list = document.getElementById("events-list");
    const fab = document.getElementById("fab-add-event");
    if (!list) return;

    const { events, requests } = await loadDb();
    const targetCollege = normalizeCollegeName(currentCollegeForEvents);
    const collegeEvents = events.filter(
        (ev) => normalizeCollegeName(ev.college) === targetCollege
    );
    const canRegister =
        userData &&
        userData.role !== "admin";
    const canManageCollege =
        userData && userData.role === "admin" && canAdminAccessCollege(targetCollege);

    if (fab) {
        fab.classList.toggle("is-hidden", !canManageCollege);
    }

    if (!collegeEvents.length) {
        list.innerHTML = `
            <p class="events-empty-hint">لا توجد فعاليات مضافة لهذه الكلية بعد.${
                canManageCollege ? " استخدمي زر «+» لإضافة فعالية." : ""
            }</p>`;
        return;
    }

    const userRequests = requests.filter(r => r.userId === userData?.uid);
    const registeredEventIds = new Set(userRequests.map(r => r.eventId));

    list.innerHTML = collegeEvents
        .map((ev) => {
            const title = escapeHtml(ev.title);
            const loc = escapeHtml(ev.location || "");
            const dateStr = escapeHtml(formatEventDateDisplay(ev.date));
            const timeStr = escapeHtml(`${ev.timeStart || ""} - ${ev.timeEnd || ""}`);
            const desc = escapeHtml(ev.description || "");
            const vh = Math.max(1, parseInt(ev.volunteerHours, 10) || 4);
            const maxPart = parseInt(ev.maxParticipants, 10) || 0;
            const currentRequests = requests.filter(r => r.eventId === ev.id && r.status === "pending").length;
            const totalRequests = requests.filter(r => r.eventId === ev.id).length;

            const isReg = registeredEventIds.has(ev.id);
            const request = userRequests.find(r => r.eventId === ev.id);
            const statusText = request ? (request.status === "completed" ? "مكتملة" : "قيد المراجعة") : "";
                        const canOpenChat = canUserAccessEventChat(userData, ev, request);

                        const regNote = isReg
                                ? `<span class="hours-tag hours-tag--status">${statusText}</span>`
                                : canRegister && currentRequests < maxPart
                                    ? '<span class="event-tap-hint">يمكنكِ الإرسال من الزر أو من البطاقة</span>'
                                    : maxPart > 0 && currentRequests >= maxPart
                                        ? '<span class="event-tap-hint" style="color: #dc3545;">الفعالية مكتملة العدد</span>'
                                        : "";

            const canRegClass =
                canRegister && !isReg && (maxPart === 0 || currentRequests < maxPart) ? "event-card--can-register" : "";

            const delBtn = canManageCollege
                ? `<button type="button" class="btn-delete-event" data-delete-id="${escapeHtml(ev.id)}" aria-label="حذف الفعالية" onclick="event.stopPropagation(); deleteCollegeEvent('${escapeAttr(ev.id)}');"><i class="fas fa-trash-alt"></i></button>`
                : "";

            const chatBtn = canOpenChat
                ? `<button type="button" class="btn-chat btn-chat--event" data-chat-event-id="${escapeHtml(ev.id)}" onclick="event.stopPropagation(); openChat('${escapeAttr(ev.id)}').catch(console.error);"><i class="fas fa-comments"></i> شات الفعالية</button>`
                : `<button type="button" class="btn-chat btn-chat--event btn-chat--disabled" disabled>${request?.status === "pending" ? "متاح بعد اعتماد الانضمام" : "الشات للمشاركات فقط"}</button>`;

            const joinBtn = canRegister && !isReg && (maxPart === 0 || currentRequests < maxPart)
                ? `<button type="button" class="btn-join-event" data-join-event-id="${escapeHtml(ev.id)}"><i class="fas fa-paper-plane"></i> إرسال طلب الانضمام</button>`
                : "";

            return `
            <div class="event-card${isReg ? " event-card--registered" : ""} ${canRegClass}" data-event-id="${escapeHtml(ev.id)}">
                <div class="event-details">
                    <h4>${title}</h4>
                    <p><i class="far fa-calendar-alt"></i> <b>التاريخ:</b> ${dateStr}</p>
                    <p><i class="far fa-clock"></i> <b>الوقت:</b> ${timeStr}</p>
                    <p><i class="fas fa-map-marker-alt"></i> <b>المكان:</b> ${loc}</p>
                    ${desc ? `<p><i class="fas fa-info-circle"></i> <b>الوصف:</b> ${desc}</p>` : ""}
                    ${maxPart > 0 ? `<p><i class="fas fa-users"></i> <b>المشاركون:</b> ${totalRequests}/${maxPart}</p>` : (totalRequests > 0 ? `<p><i class="fas fa-users"></i> <b>الطلبات:</b> ${totalRequests}</p>` : "")}
                </div>
                <div class="event-card-actions">
                    <span class="hours-tag">+${vh} ساعات مكتسبة</span>
                    ${regNote}
                    ${joinBtn}
                    ${chatBtn}
                    ${delBtn}
                </div>
            </div>`;
        })
        .join("");
}

function openEvents(college) {
    const normalizedCollege = normalizeCollegeName(college);
    if (userData && userData.role === "admin" && !canAdminAccessCollege(normalizedCollege)) {
        showNotification("هذا الحساب مخصص لإدارة كلية واحدة فقط.");
        return;
    }
    currentCollegeForEvents = normalizedCollege;
    const titleEl = document.getElementById("college-name-display");
    if (titleEl) titleEl.textContent = "فعاليات " + getCollegeDisplayName(normalizedCollege);
    goToPage("events-page");
}

async function sendJoinRequest(eventId) {
    if (!userData) {
        showNotification("يرجى تسجيل الدخول أولاً.");
        return;
    }
    
    if (userData.role === "admin") {
        showNotification("حساب الإدارة لا يُرسل طلبات انضمام.");
        return;
    }

    const db = await loadDb();
    const existingRequest = db.requests.find(r => r.userId === userData.uid && r.eventId === eventId);
    if (existingRequest) {
        showNotification("لديك طلب انضمام مسبق لهذه الفعالية.");
        return;
    }

    const event = db.events.find(e => e.id === eventId);
    if (!event) {
        showNotification("الفعالية غير موجودة.");
        return;
    }

    const maxPart = parseInt(event.maxParticipants, 10) || 0;
    const currentRequests = db.requests.filter(r => r.eventId === eventId && r.status === "pending").length;
    if (maxPart > 0 && currentRequests >= maxPart) {
        showNotification("الفعالية مكتملة العدد.");
        return;
    }

    showLoader(true);
    try {
        const request = {
            id: newUid(),
            userId: userData.uid,
            eventId: eventId,
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        db.requests.push(request);
        await saveRequests(db.requests);
        showNotification("تم إرسال طلب الانضمام بنجاح.");
        openSuccessModal();
        await refreshEventsListUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر إرسال طلب الانضمام.");
    } finally {
        showLoader(false);
    }
}

function openAddEventModal() {
    if (!userData || userData.role !== "admin") return;
    const m = document.getElementById("add-event-modal");
    if (!m) return;
    const lab = document.getElementById("add-event-college-label");
    currentCollegeForEvents = getUserCollege(userData) || currentCollegeForEvents;
    if (lab) {
        lab.textContent = currentCollegeForEvents
            ? getCollegeDisplayName(currentCollegeForEvents)
            : "—";
    }
    m.classList.add("is-open");
    document.getElementById("new-event-title").value = "";
    document.getElementById("new-event-description").value = "";
    document.getElementById("new-event-location").value = "";
    document.getElementById("new-event-date").value = "";
    document.getElementById("new-event-time-start").value = "";
    document.getElementById("new-event-time-end").value = "";
    document.getElementById("new-event-max-participants").value = "";
    document.getElementById("new-event-hours").value = "";
}

function closeAddEventModal() {
    const m = document.getElementById("add-event-modal");
    if (m) m.classList.remove("is-open");
}

async function submitNewEvent(e) {
    e.preventDefault();
    if (!userData || userData.role !== "admin") return;

    const title = document.getElementById("new-event-title").value.trim();
    const description = document.getElementById("new-event-description").value.trim();
    const location = document.getElementById("new-event-location").value.trim();
    const date = document.getElementById("new-event-date").value;
    const timeStart = document.getElementById("new-event-time-start").value;
    const timeEnd = document.getElementById("new-event-time-end").value;
    const maxParticipants = parseInt(document.getElementById("new-event-max-participants").value) || 0;
    const volunteerHours = parseInt(document.getElementById("new-event-hours").value) || 4;

    if (!title) {
        showNotification("أدخلي اسم الفعالية.");
        return;
    }
    const adminCollege = getUserCollege(userData);
    if (!adminCollege) {
        showNotification("هذا الحساب غير مرتبط بكلية صالحة.");
        return;
    }

    showLoader(true);
    try {
        const db = await loadDb();
        const ev = {
            id: newUid(),
            college: adminCollege,
            title,
            description,
            location,
            date,
            timeStart,
            timeEnd,
            maxParticipants,
            volunteerHours,
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
    console.log("deleteCollegeEvent called with eventId:", eventId);
    if (!userData || userData.role !== "admin") {
        console.warn("User is not admin or not logged in");
        return;
    }

    showLoader(true);
    try {
        const db = await loadDb();
        console.log("Events before delete:", db.events.length);
        const targetEvent = db.events.find((ev) => ev.id === eventId);
        if (!targetEvent || !canAdminAccessCollege(targetEvent.college)) {
            showNotification("لا تملكين صلاحية حذف هذه الفعالية.");
            return;
        }
        const next = db.events.filter((ev) => ev.id !== eventId);
        console.log("Events after filter:", next.length);
        if (next.length === db.events.length) {
            showNotification("الفعالية غير موجودة.");
            showLoader(false);
            return;
        }
        await saveEvents(next);

        // إزالة الطلبات المرتبطة بالفعالية
        const updatedRequests = db.requests.filter(r => r.eventId !== eventId);
        await saveRequests(updatedRequests);

        showNotification("تم حذف الفعالية.");
        await refreshEventsListUI();
        renderAdminPage();
    } catch (err) {
        console.error("Error in deleteCollegeEvent:", err);
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
    const completedRequests = db.requests.filter(r => r.userId === userData.uid && r.status === "completed");
    const eventMap = new Map(db.events.map((ev) => [ev.id, ev]));

    if (!completedRequests.length) {
        ul.innerHTML =
            '<li class="volunteer-log-empty">لم تنجزي أي فعاليات بعد. انتظري موافقة الإدارة على طلباتك.</li>';
        return;
    }

    ul.innerHTML = completedRequests
        .map((r) => {
            const ev = eventMap.get(r.eventId);
            const label = ev
                ? escapeHtml(ev.title)
                : escapeHtml(r.eventId) + " (فعالية محذوفة)";
            return `<li><i class="fas fa-check-circle" aria-hidden="true"></i> ${label}</li>`;
        })
        .join("");
}

async function openChat(eventId) {
    if (!eventId) return;
    const modal = document.getElementById("chat-modal");
    const eventNameEl = document.getElementById("chat-event-name");
    const eventSubtitleEl = document.getElementById("chat-event-subtitle");
    if (!modal || !eventNameEl || !eventSubtitleEl) return;

    const db = await loadDb();
    const eventRecord = db.events.find((ev) => ev.id === eventId);
    const requestRecord = db.requests.find(
        (r) => r.userId === userData?.uid && r.eventId === eventId
    );

    if (!eventRecord) {
        showNotification("الفعالية غير موجودة.");
        return;
    }

    if (!canUserAccessEventChat(userData, eventRecord, requestRecord)) {
        showNotification("شات الفعالية متاح فقط للمشاركات المعتمدات.");
        return;
    }

    currentEventChatId = eventId;
    eventNameEl.textContent = eventRecord.title;
    eventSubtitleEl.textContent = getCollegeDisplayName(eventRecord.college);
    modal.classList.add("is-open");
    loadChatMessages();
}

function closeChatModal() {
    const modal = document.getElementById("chat-modal");
    currentEventChatId = "";
    if (modal) modal.classList.remove("is-open");
}

function openSuccessModal() {
    const modal = document.getElementById("success-modal");
    if (modal) modal.classList.add("is-open");
}

function closeSuccessModal() {
    const modal = document.getElementById("success-modal");
    if (modal) modal.classList.remove("is-open");
}

function closeVolunteerLogModal() {
    const modal = document.getElementById("volunteer-log-modal");
    if (modal) modal.classList.remove("is-open");
}

async function loadChatMessages() {
    const messagesEl = document.getElementById("chat-messages");
    if (!messagesEl || !currentEventChatId) return;

    const { chats, users, events, requests } = await loadDb();
    const currentEvent = events.find((ev) => ev.id === currentEventChatId);
    const requestRecord = requests.find(
        (r) => r.userId === userData?.uid && r.eventId === currentEventChatId
    );
    if (!canUserAccessEventChat(userData, currentEvent, requestRecord)) {
        closeChatModal();
        showNotification("لم يعد لديك صلاحية دخول شات هذه الفعالية.");
        return;
    }

    const userMap = new Map(users.map(u => [u.uid, u]));
    const eventChats = chats
        .filter((c) => c.eventId === currentEventChatId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (!eventChats.length) {
        messagesEl.innerHTML =
            '<div class="chat-empty-state">ابدئي أول رسالة في شات هذه الفعالية.</div>';
        return;
    }

    messagesEl.innerHTML = eventChats.map(chat => {
        const user = userMap.get(chat.userId);
        const sender = user ? user.name : "مستخدم مجهول";
        const isOwn = chat.userId === userData?.uid;
        const time = new Date(chat.timestamp).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="chat-message ${isOwn ? 'own' : 'other'}">
                <div class="sender">${escapeHtml(sender)}</div>
                <div class="text">${escapeHtml(chat.message)}</div>
                <div class="time">${time}</div>
            </div>
        `;
    }).join('');

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendChatMessage() {
    const input = document.getElementById("chat-input");
    if (!input || !userData || !currentEventChatId) return;

    const message = input.value.trim();
    if (!message) return;

    const db = await loadDb();
    const eventRecord = db.events.find((ev) => ev.id === currentEventChatId);
    const requestRecord = db.requests.find(
        (r) => r.userId === userData.uid && r.eventId === currentEventChatId
    );
    if (!canUserAccessEventChat(userData, eventRecord, requestRecord)) {
        showNotification("لا تملكين صلاحية الكتابة في شات هذه الفعالية.");
        return;
    }

    const chat = {
        id: newUid(),
        eventId: currentEventChatId,
        userId: userData.uid,
        message,
        timestamp: new Date().toISOString(),
    };

    db.chats.push(chat);
    await saveChats(db.chats);

    input.value = "";
    loadChatMessages();
}

function renderAdminPage() {
    const usersSummary = document.getElementById("admin-users-summary");
    const usersList = document.getElementById("admin-users-list");
    const list = document.getElementById("admin-events-list");
    if (!list || !usersSummary || !usersList) return;

    loadDb().then(({ events, requests, users, chats }) => {
        const adminCollege = getUserCollege(userData);
        const scopedEvents = events.filter(
            (ev) => normalizeCollegeName(ev.college) === adminCollege
        );
        renderAdminUsersSection(users, events, requests, adminCollege);
        const userMap = new Map(users.map(u => [u.uid, u]));
        const requestMap = new Map();
        const chatMap = new Map();

        requests.forEach(r => {
            if (!requestMap.has(r.eventId)) {
                requestMap.set(r.eventId, []);
            }
            requestMap.get(r.eventId).push(r);
        });

        chats.forEach((chat) => {
            if (!chat.eventId) return;
            if (!chatMap.has(chat.eventId)) {
                chatMap.set(chat.eventId, []);
            }
            chatMap.get(chat.eventId).push(chat);
        });

        if (!scopedEvents.length) {
            list.innerHTML = '<p style="text-align: center; color: #666;">لا توجد فعاليات مضافة بعد.</p>';
            return;
        }

        list.innerHTML = scopedEvents.map(ev => {
            const eventRequests = requestMap.get(ev.id) || [];
            const eventChats = (chatMap.get(ev.id) || []).sort(
                (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
            );
            const lastChat = eventChats[eventChats.length - 1] || null;
            const lastChatSender = lastChat
                ? escapeHtml(userMap.get(lastChat.userId)?.name || "مستخدم مجهول")
                : "";
            const lastChatPreview = lastChat
                ? escapeHtml(lastChat.message || "")
                : "لا توجد رسائل بعد";
            const requestsHtml = eventRequests.map(r => {
                const user = userMap.get(r.userId);
                if (!user) return '';
                const name = escapeHtml(user.name);
                const email = escapeHtml(user.email);
                const statusClass = r.status === 'completed' ? 'completed' : 'pending';
                const statusText = r.status === 'completed' ? 'مكتملة' : 'قيد المراجعة';
                return `
                    <div class="admin-request-item">
                        <div class="request-info">
                            <div class="request-name">${name}</div>
                            <div class="request-email">${email}</div>
                        </div>
                        <div class="request-status ${statusClass}">${statusText}</div>
                        <div class="request-actions">
                            ${r.status !== 'completed' ? `<button class="btn-approve" onclick="approveRequest('${r.id}')">أنجزت الساعات</button>` : ''}
                            ${r.status === 'completed' ? `<button class="btn-reject" onclick="rejectRequest('${r.id}')">تراجع</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="admin-event-card">
                    <div class="admin-event-header">
                        <h3 class="admin-event-title">${escapeHtml(ev.title)}</h3>
                        <button class="btn-delete-event" onclick="deleteCollegeEvent('${ev.id}')">
                            <i class="fas fa-trash"></i> حذف
                        </button>
                    </div>
                    <div class="admin-event-details">
                        <p><strong>الكلية:</strong> ${escapeHtml(getCollegeDisplayName(ev.college))}</p>
                        <p><strong>التاريخ:</strong> ${formatEventDateDisplay(ev.date)}</p>
                        <p><strong>الوقت:</strong> ${ev.timeStart || ''} - ${ev.timeEnd || ''}</p>
                        <p><strong>المكان:</strong> ${escapeHtml(ev.location || '')}</p>
                        <p><strong>الساعات:</strong> ${ev.volunteerHours || 4}</p>
                        <p><strong>عدد الرسائل:</strong> ${eventChats.length}</p>
                        <p><strong>آخر رسالة:</strong> ${lastChat ? `${lastChatSender}: ${lastChatPreview}` : lastChatPreview}</p>
                        ${ev.maxParticipants ? `<p><strong>الحد الأقصى:</strong> ${ev.maxParticipants}</p>` : ''}
                    </div>
                    <div class="admin-requests-list">
                        <h4>طلبات الانضمام (${eventRequests.length}):</h4>
                        ${requestsHtml || '<p style="color: #666;">لا توجد طلبات بعد.</p>'}
                    </div>
                </div>
            `;
        }).join('');
    }).catch(console.error);
}

function bindAdminTableSync() {
    clearAdminSubscription();

    const usersList = document.getElementById("admin-users-list");
    if (!usersList) return;
    usersList.innerHTML =
        '<div class="admin-empty-state">جاري جلب بيانات المستخدمين...</div>';

    adminSyncHandler = () => {
        loadDb()
            .then(({ users, events, requests }) =>
                renderAdminUsersSection(users, events, requests, getUserCollege(userData))
            )
            .catch((err) => console.error(err));
    };
    window.addEventListener("athar-db-changed", adminSyncHandler);
    adminUnsub = setInterval(adminSyncHandler, 1000);
    adminSyncHandler();
}

function loadAdmin() {
    goToPage("admin-page");
    renderAdminPage();
}

async function approveRequest(requestId) {
    if (!userData || userData.role !== "admin") return;

    showLoader(true);
    try {
        const db = await loadDb();
        const request = db.requests.find(r => r.id === requestId);
        if (!request || request.status === "completed") {
            showNotification("الطلب غير موجود أو مكتمل مسبقاً.");
            return;
        }

        const event = db.events.find(e => e.id === request.eventId);
        if (!event || !canAdminAccessCollege(event.college)) {
            showNotification("لا تملكين صلاحية تعديل هذا الطلب.");
            return;
        }

        request.status = "completed";

        // إضافة الساعات للمستخدم
        const user = db.users.find(u => u.uid === request.userId);
        if (user) {
            if (event) {
                const hours = parseInt(event.volunteerHours, 10) || 4;
                user.hours = (parseInt(user.hours, 10) || 0) + hours;
                normalizeUserRow(user);
                if (!user.volunteerEventIds.includes(request.eventId)) {
                    user.volunteerEventIds.push(request.eventId);
                }
                await saveDb(db);
            }
        }

        await saveRequests(db.requests);
        showNotification("تم قبول الطلب وإضافة الساعات.");
        renderAdminPage();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر قبول الطلب.");
    } finally {
        showLoader(false);
    }
}

async function rejectRequest(requestId) {
    if (!userData || userData.role !== "admin") return;

    showLoader(true);
    try {
        const db = await loadDb();
        const request = db.requests.find(r => r.id === requestId);
        if (!request || request.status !== "completed") {
            showNotification("الطلب غير موجود أو غير مكتمل.");
            return;
        }

        const event = db.events.find(e => e.id === request.eventId);
        if (!event || !canAdminAccessCollege(event.college)) {
            showNotification("لا تملكين صلاحية تعديل هذا الطلب.");
            return;
        }

        request.status = "pending";

        // إزالة الساعات من المستخدم
        const user = db.users.find(u => u.uid === request.userId);
        if (user) {
            if (event) {
                const hours = parseInt(event.volunteerHours, 10) || 4;
                user.hours = Math.max(0, (parseInt(user.hours, 10) || 0) - hours);
                normalizeUserRow(user);
                user.volunteerEventIds = user.volunteerEventIds.filter(id => id !== request.eventId);
                await saveDb(db);
            }
        }

        await saveRequests(db.requests);
        showNotification("تم تراجع الطلب وإزالة الساعات.");
        renderAdminPage();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر تراجع الطلب.");
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

function logout() {
    // تنظيف البيانات
    userData = null;
    clearHoursSubscription();
    clearAdminSubscription();
    localStorage.removeItem("athar_user_session");

    // إعادة عرض الـ login
    document.getElementById("login-wrapper").style.display = "flex";
    document.getElementById("site-content").style.display = "none";
    document.querySelector(".site-nav").style.display = "none";
    document.getElementById("about-modal").style.display = "none";

    // إعادة تعيين النماذج
    setAuthMode("login");
    document.getElementById("reg-email").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("reg-fullname").value = "";
    document.getElementById("reg-phone").value = "";

    // إعادة تعيين الـ hash
    routerSuppressHash = true;
    location.hash = "";
    setTimeout(() => {
        routerSuppressHash = false;
    }, 0);

    showNotification("تم تسجيل الخروج.");
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

    if (pageId === "events-page" && currentCollegeForEvents) {
        refreshEventsListUI().catch(console.error);
    }
}

function applyRouteFromHash() {
    if (routerSuppressHash) return;

    const siteContent = document.getElementById("site-content");
    if (!siteContent || siteContent.style.display === "none") return;

    const { route, college } = parseRouterHash();

    if (route === "home") {
        currentCollegeForEvents = "";
        renderHomeColleges();
        applyPageView("home-page");
    } else if (route === "profile") {
        currentCollegeForEvents = "";
        applyPageView("profile-page");
    } else if (route === "admin") {
        if (!userData || userData.role !== "admin") {
            showNotification("هذه الصفحة خاصة بالإدارة.");
            routerSuppressHash = true;
            location.hash = "#/home";
            setTimeout(() => {
                routerSuppressHash = false;
            }, 0);
            currentCollegeForEvents = "";
            applyPageView("home-page");
            return;
        }
        currentCollegeForEvents = getUserCollege(userData);
        applyPageView("admin-page");
        renderAdminPage();
    } else if (route === "events") {
        if (!college) {
            routerSuppressHash = true;
            location.hash = "#/home";
            setTimeout(() => {
                routerSuppressHash = false;
            }, 0);
            currentCollegeForEvents = "";
            applyPageView("home-page");
            return;
        }
        const normalizedCollege = normalizeCollegeName(college);
        if (userData && userData.role === "admin" && !canAdminAccessCollege(normalizedCollege)) {
            currentCollegeForEvents = getUserCollege(userData);
            routerSuppressHash = true;
            location.hash = "#/home";
            setTimeout(() => {
                routerSuppressHash = false;
            }, 0);
            renderHomeColleges();
            applyPageView("home-page");
            return;
        }
        currentCollegeForEvents = normalizedCollege;
        const titleEl = document.getElementById("college-name-display");
        if (titleEl) titleEl.textContent = "فعاليات " + getCollegeDisplayName(normalizedCollege);
        applyPageView("events-page");
        refreshEventsListUI().catch(console.error);
    } else {
        currentCollegeForEvents = "";
        renderHomeColleges();
        applyPageView("home-page");
    }
}

function goToPage(id) {
    if (id === "admin-page" && userData && userData.role === "admin") {
        currentCollegeForEvents = getUserCollege(userData);
    } else if (id !== "events-page") {
        currentCollegeForEvents = "";
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

window.addEventListener("athar-db-changed", () => {
    const ep = document.getElementById("events-page");
    const adminPage = document.getElementById("admin-page");
    if (
        ep &&
        ep.classList.contains("active") &&
        currentCollegeForEvents
    ) {
        refreshEventsListUI().catch(console.error);
    }
    if (
        adminPage &&
        adminPage.classList.contains("active") &&
        userData &&
        userData.role === "admin"
    ) {
        renderAdminPage();
    }
    if (currentEventChatId) {
        loadChatMessages().catch(console.error);
    }
});

window.addEventListener("hashchange", applyRouteFromHash);

function handleEventsListClick(e) {
    const delBtn = e.target.closest(".btn-delete-event");
    if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = delBtn.getAttribute("data-delete-id");
        console.log("Delete button clicked:", id);
        if (id) deleteCollegeEvent(id);
        return;
    }
    const chatBtn = e.target.closest(".btn-chat[data-chat-event-id]");
    if (chatBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = chatBtn.getAttribute("data-chat-event-id");
        if (id) {
            openChat(id).catch(console.error);
        }
        return;
    }
    const joinBtn = e.target.closest(".btn-join-event[data-join-event-id]");
    if (joinBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = joinBtn.getAttribute("data-join-event-id");
        if (id) {
            sendJoinRequest(id).catch(console.error);
        }
        return;
    }
    const card = e.target.closest(".event-card[data-event-id]");
    if (!card) {
        return;
    }
    
    // التحقق من أن المستخدم طالبة وليست مسؤولة
    if (!userData) {
        console.warn("userData is not defined", userData);
        showNotification("يرجى تسجيل الدخول أولاً.");
        return;
    }
    
    if (userData.role === "admin") {
        console.log("Admin user clicked event card - ignoring");
        return; // حساب الإدارة لا يرسل طلبات
    }
    
    e.preventDefault();
    e.stopPropagation();
    const id = card.getAttribute("data-event-id");
    console.log("Event card clicked:", id, "User role:", userData.role);
    if (id) {
        sendJoinRequest(id).catch(console.error);
    }
}
    // }


document.addEventListener("DOMContentLoaded", () => {
    // استعادة الجلسة من localStorage
    const sessionData = localStorage.getItem("athar_user_session");
    if (sessionData) {
        try {
            const parsed = JSON.parse(sessionData);
            if (parsed && parsed.uid && parsed.email) {
                if (parsed.role === "admin" && !isAdminEmail(parsed.email)) {
                    localStorage.removeItem("athar_user_session");
                } else {
                    userData = toPublicUser(parsed);
                    renderHomeColleges();
                    // إعادة تشغيل الاشتراكات إذا لزم الأمر
                    if (userData.role !== "admin") {
                        subscribeCurrentUserHours(userData.uid);
                    }
                    // الانتقال مباشرة إلى التطبيق
                    document.getElementById("login-wrapper").style.display = "none";
                    document.getElementById("site-content").style.display = "block";
                    document.querySelector(".site-nav").style.display = "flex";
                    document.getElementById("about-modal").style.display = "none";
                    updateNavForRole();
                    if (userData.role !== "admin") {
                        void refreshVolunteerHoursUI();
                    } else {
                        updateChart(0);
                    }
                    // تطبيق الـ route من الـ hash
                    applyRouteFromHash();
                    return; // لا نستمر في إعداد الـ login
                }
            }
        } catch (e) {
            console.warn("فشل استعادة الجلسة:", e);
            localStorage.removeItem("athar_user_session");
        }
    }

    setAuthMode("login");

    const eventsListEl = document.getElementById("events-list");
    if (eventsListEl) {
        eventsListEl.addEventListener("click", handleEventsListClick);
    }

    const authEmailEl = document.getElementById("reg-email");
    if (authEmailEl) {
        authEmailEl.addEventListener("input", sanitizeStudentIdInput);
    }

    ["forgot-password-new", "forgot-password-confirm"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleForgotPasswordReset();
            }
        });
    });

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
            closeChatModal();
            closeSuccessModal();
        }
    });
    window.addEventListener(
        "resize",
        () => {
            if (window.innerWidth > 900) closeNavMenu();
        },
        { passive: true }
    );
    document.getElementById("chat-modal")?.addEventListener("click", (e) => {
        if (e.target.id === "chat-modal") closeChatModal();
    });
    document.getElementById("success-modal")?.addEventListener("click", (e) => {
        if (e.target.id === "success-modal") closeSuccessModal();
    });
    document.getElementById("chat-send-btn")?.addEventListener("click", sendChatMessage);
    document.getElementById("chat-input")?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendChatMessage();
    });
});
