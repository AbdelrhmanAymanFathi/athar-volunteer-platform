/**
 * IndexedDB: users (uid) + events (id) + requests (id) + chats (id)
 * أدوار: admin | student
 * حسابات الإدارة حسب الكليات محددة مسبقاً داخل COLLEGE_CATALOG
 */

const IDB_NAME = "athar_db";
const IDB_VERSION = 7;
const USERS_STORE = "users";
const EVENTS_STORE = "events";
const REQUESTS_STORE = "requests";
const CHATS_STORE = "chats";
const MFA_STORE = "mfa";
const LEGACY_LS_KEY = "athar_local_v1";
const ADMIN_ACCOUNTS_SEED_KEY = "athar_college_admin_seed_version";
const ADMIN_ACCOUNTS_SEED_VERSION = "v1";
const REQUEST_STATUS_PENDING = "pending";
const REQUEST_STATUS_APPROVED = "approved";
const REQUEST_STATUS_WAITLISTED = "waitlisted";
const REQUEST_STATUS_COMPLETED = "completed";
const REQUEST_STATUS_WITHDRAWN = "withdrawn";
const STUDENT_EMAIL_DOMAIN = "pnu.edu.sa";
const DB_SYNC_CHANNEL_NAME = "athar_db_sync";
const DB_SYNC_STORAGE_KEY = "athar_db_sync_storage";
const EVENT_MEMBERS_EXPANDED_STORAGE_KEY = "athar_event_members_expanded_state";

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
let dbSyncChannel = null;
let dbSyncReady = false;
let dbJsonFileHandle = null;
let dbJsonAutoSaveTimer = null;
let dbJsonAutoSaveInFlight = false;
let dbJsonAutoSaveQueued = false;

const DB_SYNC_TAB_ID =
    (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "tab_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));

let userData = null;
let hoursUnsub = null;
let adminUnsub = null;
let hoursSyncHandler = null;
let adminSyncHandler = null;
let eventMembersExpandedState = new Map();
let forgotPasswordVerifiedEmail = "";
let forgotPasswordVerifiedUserId = "";

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

// Modal-level MFA status helpers
function setMfaStatus(type, message, isError = false) {
    const idMap = {
        setup: "mfa-setup-status",
        prompt: "mfa-prompt-status",
        manage: "mfa-manage-status",
    };
    const id = idMap[type];
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("mfa-status--error", !!isError);
    el.classList.toggle("mfa-status--ok", !!message && !isError);
    el.style.display = message ? "block" : "none";
}

function showMfaSetupStatus(msg, isError = false) {
    setMfaStatus("setup", msg, isError);
}

function showMfaPromptStatus(msg, isError = false) {
    setMfaStatus("prompt", msg, isError);
}

function showMfaManageStatus(msg, isError = false) {
    setMfaStatus("manage", msg, isError);
}

function showLoader(v) {
    document.getElementById("loader").style.display = v ? "flex" : "none";
}

function getEventMembersExpandedStorageKey(college = currentCollegeForEvents) {
    const normalizedCollege = normalizeCollegeName(college) || "global";
    return `${EVENT_MEMBERS_EXPANDED_STORAGE_KEY}:${userData?.uid || "guest"}:${normalizedCollege}`;
}

function restoreEventMembersExpandedState(college = currentCollegeForEvents) {
    try {
        const raw = localStorage.getItem(getEventMembersExpandedStorageKey(college));
        if (!raw) {
            eventMembersExpandedState = new Map();
            return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            eventMembersExpandedState = new Map();
            return;
        }
        eventMembersExpandedState = new Map(
            Object.entries(parsed).map(([eventId, expanded]) => [
                eventId,
                Boolean(expanded),
            ])
        );
    } catch (err) {
        console.warn("Athar: تعذر استعادة حالة طي الأعضاء", err);
        eventMembersExpandedState = new Map();
    }
}

function persistEventMembersExpandedState(college = currentCollegeForEvents) {
    try {
        localStorage.setItem(
            getEventMembersExpandedStorageKey(college),
            JSON.stringify(Object.fromEntries(eventMembersExpandedState))
        );
    } catch (err) {
        console.warn("Athar: تعذر حفظ حالة طي الأعضاء", err);
    }
}

function clearEventMembersExpandedStateStorageForUser() {
    try {
        const prefix = `${EVENT_MEMBERS_EXPANDED_STORAGE_KEY}:${userData?.uid || "guest"}:`;
        const keysToRemove = [];
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key && key.startsWith(prefix)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (err) {
        console.warn("Athar: تعذر تنظيف حالات طي الأعضاء", err);
    }
}

function isEventMembersPanelExpanded(eventId, defaultOpen = false) {
    if (!eventId) return defaultOpen;
    if (eventMembersExpandedState.has(eventId)) {
        return eventMembersExpandedState.get(eventId);
    }
    return defaultOpen;
}

function handleEventMembersToggle(event, eventId) {
    const detailsEl = event?.currentTarget;
    if (!detailsEl || !eventId) return;
    eventMembersExpandedState.set(eventId, Boolean(detailsEl.open));
    persistEventMembersExpandedState();
}

function updateDbJsonStatus(message, isError = false) {
    const statusEl = document.getElementById("db-json-status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#c0392b" : "#607171";
}

function isFirebaseConfigReady() {
    return Object.values(FIREBASE_CONFIG).every(
        (value) => value && !String(value).startsWith("YOUR_FIREBASE_")
    );
}

function getOtpPanelElements() {
    return {
        panel: document.getElementById("otp-verification-panel"),
        input: document.getElementById("otp-code"),
        statusText: document.getElementById("otp-status-text"),
        verifyButton: document.getElementById("otp-verify-btn"),
    };
}

function setButtonLoadingState(button, isLoading, idleText, loadingText) {
    if (!button) return;
    if (!button.dataset.idleText) {
        button.dataset.idleText = idleText || button.textContent.trim();
    }
    button.disabled = Boolean(isLoading);
    button.textContent = isLoading
        ? loadingText || "جاري المعالجة..."
        : button.dataset.idleText;
}

function setAuthSubmitLoading(isLoading, text = "جاري إرسال الرمز...") {
    const submitButton = document.getElementById("auth-submit-btn");
    setButtonLoadingState(submitButton, isLoading, "إنشاء الحساب", text);
}

function setOtpPanelVisible(isVisible, message = "") {
    const { panel, input, statusText } = getOtpPanelElements();
    if (!panel) return;

    panel.hidden = !isVisible;
    if (statusText && message) {
        statusText.textContent = message;
    }

    if (isVisible && input) {
        input.value = "";
        input.focus();
    }
}

function resetOtpFlow() {
    firebaseConfirmationResult = null;
    pendingRegistrationPayload = null;
    setOtpPanelVisible(false);
    const otpInput = document.getElementById("otp-code");
    if (otpInput) otpInput.value = "";
}
function formatPhoneForFirebase(phone, selectedCountryCode) {
    const rawValue = String(phone || "").trim();
    const normalizedValue = rawValue.replace(/[\s()\-]/g, "");
    const digitsOnly = normalizedValue.replace(/\D/g, "");
    const normalizedCountryCode = String(selectedCountryCode || "").trim();
    const countryDigits = normalizedCountryCode.replace(/\D/g, "");

    if (/^\+[1-9]\d{7,14}$/.test(normalizedValue)) {
        return normalizedValue;
    }

    if (/^00[1-9]\d{7,14}$/.test(digitsOnly)) {
        return `+${digitsOnly.slice(2)}`;
    }

    if (/^05\d{8}$/.test(digitsOnly)) {
        return `+966${digitsOnly.slice(1)}`;
    }
    if (/^5\d{8}$/.test(digitsOnly)) {
        return `+966${digitsOnly}`;
    }
    if (/^9665\d{8}$/.test(digitsOnly)) {
        return `+${digitsOnly}`;
    }

    if (countryDigits) {
        if (digitsOnly.startsWith(countryDigits) && /^[1-9]\d{7,14}$/.test(digitsOnly)) {
            return `+${digitsOnly}`;
        }

        const localDigits = digitsOnly.replace(/^0+/, "");
        const combinedDigits = `${countryDigits}${localDigits}`;
        if (
            /^[1-9]\d{5,14}$/.test(localDigits) &&
            /^[1-9]\d{7,14}$/.test(combinedDigits) &&
            combinedDigits.length <= 15
        ) {
            return `+${combinedDigits}`;
        }
    }

    if (/^[1-9]\d{7,14}$/.test(digitsOnly)) {
        return `+${digitsOnly}`;
    }

    return "";
}


function getFirebasePhoneAuthErrorMessage(error, phase = "send") {
    const code = String(error?.code || "").toLowerCase();

    if (phase === "verify") {
        if (code === "auth/invalid-verification-code") {
            return "رمز التحقق غير صحيح.";
        }
        if (code === "auth/code-expired" || code === "auth/session-expired") {
            return "انتهت صلاحية رمز التحقق. أعيدي إرسال الرمز مرة أخرى.";
        }
        if (code === "auth/network-request-failed") {
            return "تعذّر التحقق بسبب مشكلة في الاتصال بالإنترنت.";
        }
        return "تعذّر التحقق من الرمز. حاولي مرة أخرى.";
    }

    if (code === "auth/invalid-phone-number" || code === "auth/missing-phone-number") {
        return "رقم الجوال غير صحيح. تحققي من مفتاح الدولة والرقم المحلي.";
    }
    if (code === "auth/invalid-api-key") {
        return "إعداد Firebase غير صحيح: مفتاح API غير صالح أو عليه قيود تمنع Firebase Auth. راجعي Project Settings وقيود API Key في Google Cloud.";
    }
    if (code === "auth/too-many-requests") {
        return "تمت محاولات كثيرة على هذا الرقم. انتظري قليلًا ثم حاولي مرة أخرى.";
    }
    if (code === "auth/quota-exceeded") {
        return "تم استهلاك الحد المسموح لإرسال رسائل OTP في Firebase حالياً.";
    }
    if (code === "auth/captcha-check-failed" || code === "auth/invalid-app-credential") {
        return "فشل التحقق الأمني reCAPTCHA. أعيدي المحاولة أو أعيدي تحميل الصفحة.";
    }
    if (code === "auth/network-request-failed") {
        return "تعذّر إرسال رمز التحقق بسبب مشكلة في الاتصال بالإنترنت.";
    }

    return "تعذّر إرسال رمز التحقق. تحققي من رقم الجوال وحاولي مرة أخرى.";
}

async function ensureFirebasePhoneAuth() {
    if (!window.firebase || !window.firebase.auth) {
        throw new Error("firebase-sdk-missing");
    }
    if (!isFirebaseConfigReady()) {
        throw new Error("firebase-config-missing");
    }

    if (!firebaseAppInstance) {
        firebaseAppInstance = window.firebase.apps.length
            ? window.firebase.app()
            : window.firebase.initializeApp(FIREBASE_CONFIG);
    }

    if (!firebasePhoneAuth) {
        firebasePhoneAuth = firebaseAppInstance.auth();
    }

    if (!firebaseRecaptchaVerifier) {
        // 2) ننشئ reCAPTCHA مرة واحدة فقط وبشكل غير مرئي داخل النموذج.
        firebaseRecaptchaVerifier = new window.firebase.auth.RecaptchaVerifier(
            "recaptcha-container",
            {
                size: "invisible",
                callback: () => {
                    // يتم استدعاؤها تلقائياً عند نجاح reCAPTCHA غير المرئي.
                },
            },
            firebasePhoneAuth
        );

        await firebaseRecaptchaVerifier.render();
    }

    return firebasePhoneAuth;
}

function buildPendingRegistrationPayload() {
    const fullname = document.getElementById("reg-fullname").value.trim();
    const names = fullname.split(/\s+/);
    if (names.length < 3) {
        showNotification("مطلوب على الأقل ثلاثة أسماء");
        return null;
    }

    const emailInput = getAuthEmailInput();
    const password = getAuthPassword();
    const phone = document.getElementById("reg-phone").value.trim();
    const selectedCountryCode = getSelectedPhoneCountryCode();
    const email = normalizeEmailInput(emailInput);
    const role = resolveRoleFromEmail(email);
    const firebasePhoneNumber = formatPhoneForFirebase(phone, selectedCountryCode);

    if (!emailInput) {
        showNotification("أدخلي الرقم الجامعي.");
        return null;
    }
    if (!isValidStudentEmailLocalPart(emailInput)) {
        showNotification("يجب إدخال الرقم الجامعي من 9 أرقام.");
        return null;
    }
    if (!isStrongPassword(password)) {
        showNotification(
            "كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم ورمز خاص."
        );
        return null;
    }
    if (!phone) {
        showNotification("أدخلي رقم الجوال.");
        return null;
    }
    if (!firebasePhoneNumber) {
        showNotification("أدخلي رقم جوال صحيح. يمكنكِ اختيار الدولة ثم كتابة الرقم المحلي، أو إدخال الرقم كاملًا مثل +201234567890.");
        return null;
    }
    if (role === "admin") {
        showNotification(
            "حساب الإدارة موجود أساساً. استخدمي «تسجيل الدخول»."
        );
        return null;
    }

    return {
        fullname,
        email,
        password,
        phone,
        role,
        firebasePhoneNumber,
    };
}

async function finalizeRegisterAfterPhoneVerification(verifiedPhoneData) {
    const payload = pendingRegistrationPayload;
    if (!payload) {
        showNotification("انتهت جلسة التحقق. أعيدي إرسال الرمز مرة أخرى.");
        return;
    }

    const pwdHash = await hashPassword(payload.password);
    const db = await loadDb();
    const existing = findUserByEmail(db, payload.email);

    if (existing) {
        showNotification(
            "الرقم الجامعي مسجّل مسبقاً. استخدمي «تسجيل الدخول»."
        );
        resetOtpFlow();
        return;
    }

    // 4) بعد نجاح OTP نكمل نفس التسجيل القديم ونضيف علامة التحقق على الرقم.
    const uid = newUid();
    const row = {
        ...buildUserPayload(uid, payload.fullname, payload.email, payload.phone, "", payload.role),
        pwdHash,
        phoneVerified: true,
        phoneVerifiedAt: new Date().toISOString(),
        verifiedPhoneNumber: payload.firebasePhoneNumber,
        firebasePhoneUid: verifiedPhoneData?.uid || "",
    };

    db.users.push(row);
    await saveDb(db);
    userData = toPublicUser(row);

    if (userData && userData.role !== "admin") {
        subscribeCurrentUserHours(userData.uid);
    } else {
        clearHoursSubscription();
    }

    // Prompt user to optionally enroll TOTP (client-side) before starting app
    try {
        console.log("[MFA] finalizeRegister: preparing to enroll", { uid: userData?.uid });
        if (payload && payload.password) {
            const enrolled = await showMfaSetupModal(userData.uid, payload.password, userData.email);
            console.log("[MFA] showMfaSetupModal result:", enrolled);
            try {
                // Dispose of the plaintext password as soon as we can
                payload.password = undefined;
                if (pendingRegistrationPayload) pendingRegistrationPayload.password = undefined;
            } catch (e) {}
        } else {
            console.log("[MFA] finalizeRegister: no password in payload, skipping MFA enrollment");
        }
    } catch (err) {
        console.warn("MFA enrollment flow interrupted", err);
    }

    resetOtpFlow();
    if (firebasePhoneAuth) {
        firebasePhoneAuth.signOut().catch(() => {});
    }
    startApp();
}

async function buildDbJsonSnapshot() {
    const db = await loadDb();
    return {
        exportedAt: new Date().toISOString(),
        users: db.users,
        events: db.events,
        requests: db.requests,
        chats: db.chats,
    };
}

function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportDbJson() {
    showLoader(true);
    try {
        const snapshot = await buildDbJsonSnapshot();
        downloadTextFile("db.json", JSON.stringify(snapshot, null, 2));
        showNotification("تم تصدير ملف db.json بنجاح.");
    } catch (err) {
        console.error(err);
        showNotification("تعذّر تصدير ملف db.json.");
    } finally {
        showLoader(false);
    }
}

async function ensureDbJsonFilePermission(fileHandle) {
    if (!fileHandle) return false;
    if (typeof fileHandle.queryPermission === "function") {
        const current = await fileHandle.queryPermission({ mode: "readwrite" });
        if (current === "granted") return true;
    }
    if (typeof fileHandle.requestPermission === "function") {
        const requested = await fileHandle.requestPermission({ mode: "readwrite" });
        return requested === "granted";
    }
    return false;
}

async function writeSnapshotToDbJsonFile() {
    if (!dbJsonFileHandle) return;
    if (dbJsonAutoSaveInFlight) {
        dbJsonAutoSaveQueued = true;
        return;
    }

    dbJsonAutoSaveInFlight = true;
    try {
        const hasPermission = await ensureDbJsonFilePermission(dbJsonFileHandle);
        if (!hasPermission) {
            updateDbJsonStatus("تم إلغاء إذن الكتابة على ملف db.json المحلي.", true);
            return;
        }

        const snapshot = await buildDbJsonSnapshot();
        const writable = await dbJsonFileHandle.createWritable();
        await writable.write(JSON.stringify(snapshot, null, 2));
        await writable.close();
        updateDbJsonStatus(
            `تم تحديث ملف db.json المحلي تلقائياً آخر مرة في ${new Date().toLocaleTimeString("ar-SA")}.`
        );
    } catch (err) {
        console.error(err);
        updateDbJsonStatus("تعذّر تحديث ملف db.json المحلي تلقائياً.", true);
    } finally {
        dbJsonAutoSaveInFlight = false;
        if (dbJsonAutoSaveQueued) {
            dbJsonAutoSaveQueued = false;
            void writeSnapshotToDbJsonFile();
        }
    }
}

function queueDbJsonAutoSave() {
    if (!dbJsonFileHandle) return;
    if (dbJsonAutoSaveTimer) {
        clearTimeout(dbJsonAutoSaveTimer);
    }
    dbJsonAutoSaveTimer = setTimeout(() => {
        dbJsonAutoSaveTimer = null;
        void writeSnapshotToDbJsonFile();
    }, 200);
}

async function chooseDbJsonAutoSaveFile() {
    if (typeof window.showSaveFilePicker !== "function") {
        showNotification("هذه الميزة مدعومة في متصفحات حديثة مثل Chrome و Edge على سطح المكتب فقط.");
        updateDbJsonStatus("المتصفح الحالي لا يدعم اختيار ملف db.json للتحديث التلقائي.", true);
        return;
    }

    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: "db.json",
            types: [
                {
                    description: "JSON Files",
                    accept: { "application/json": [".json"] },
                },
            ],
        });
        dbJsonFileHandle = handle;
        updateDbJsonStatus("تم اختيار ملف db.json المحلي. سيتم تحديثه تلقائياً عند كل تغيير.");
        await writeSnapshotToDbJsonFile();
        showNotification("تم ربط ملف db.json المحلي للتحديث التلقائي.");
    } catch (err) {
        if (err && err.name === "AbortError") {
            updateDbJsonStatus("لم يتم اختيار ملف db.json للتحديث التلقائي بعد.");
            return;
        }
        console.error(err);
        updateDbJsonStatus("تعذّر اختيار ملف db.json المحلي.", true);
        showNotification("تعذّر اختيار ملف db.json المحلي.");
    }
}

async function saveDbJsonNow() {
    if (!dbJsonFileHandle) {
        showNotification("اختاري ملف db.json أولاً للتحديث المحلي.");
        updateDbJsonStatus("لم يتم اختيار ملف db.json للتحديث التلقائي بعد.", true);
        return;
    }

    showLoader(true);
    try {
        await writeSnapshotToDbJsonFile();
        showNotification("تم حفظ db.json في الملف المختار.");
    } catch (err) {
        console.error(err);
        showNotification("تعذّر حفظ db.json في الملف المختار.");
    } finally {
        showLoader(false);
    }
}

function normalizeImportedDbPayload(payload) {
    const imported = payload && typeof payload === "object" ? payload : {};
    return {
        users: Array.isArray(imported.users)
            ? imported.users.map(normalizeUserRow)
            : [],
        events: Array.isArray(imported.events) ? imported.events : [],
        requests: Array.isArray(imported.requests)
            ? imported.requests.map(normalizeRequestRow)
            : [],
        chats: Array.isArray(imported.chats) ? imported.chats : [],
    };
}

async function overwriteDbFromJsonSnapshot(snapshot) {
    await ensureIdbInit();
    const db = await openIdb();
    await Promise.all([
        idbReplaceAllUsers(db, snapshot.users),
        idbReplaceAllEvents(db, snapshot.events),
        idbReplaceAllRequests(db, snapshot.requests),
        idbReplaceAllChats(db, snapshot.chats),
    ]);
}

async function importDbJsonFile() {
    if (typeof window.showOpenFilePicker !== "function") {
        showNotification("هذه الميزة مدعومة في متصفحات حديثة مثل Chrome و Edge على سطح المكتب فقط.");
        return;
    }

    try {
        const [fileHandle] = await window.showOpenFilePicker({
            multiple: false,
            types: [
                {
                    description: "JSON Files",
                    accept: { "application/json": [".json"] },
                },
            ],
        });

        if (!fileHandle) return;

        showLoader(true);
        const file = await fileHandle.getFile();
        const text = await file.text();
        const parsed = JSON.parse(text);
        const snapshot = normalizeImportedDbPayload(parsed);
        await overwriteDbFromJsonSnapshot(snapshot);
        updateDbJsonStatus("تم استيراد db.json بنجاح وتحديث البيانات المحلية.");
        showNotification("تم استيراد db.json بنجاح.");
    } catch (err) {
        if (err && err.name === "AbortError") {
            return;
        }
        console.error(err);
        showNotification("تعذّر استيراد db.json. تأكدي أن الملف بصيغة صحيحة.");
        updateDbJsonStatus("تعذّر استيراد db.json من الملف المختار.", true);
    } finally {
        showLoader(false);
    }
}

function dispatchDbChangedEvent() {
    window.dispatchEvent(new CustomEvent("athar-db-changed"));
}

function broadcastDbChange() {
    const payload = {
        type: "athar-db-changed",
        sourceTabId: DB_SYNC_TAB_ID,
        timestamp: Date.now(),
    };

    dispatchDbChangedEvent();

    if (dbSyncChannel) {
        dbSyncChannel.postMessage(payload);
    }

    try {
        localStorage.setItem(DB_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
        console.warn("Athar: تعذر إرسال مزامنة localStorage", err);
    }
}

function handleIncomingDbSync(payload) {
    if (!payload || payload.type !== "athar-db-changed") return;
    if (payload.sourceTabId === DB_SYNC_TAB_ID) return;
    dispatchDbChangedEvent();
}

function setupDbSync() {
    if (dbSyncReady) return;
    dbSyncReady = true;

    if (typeof BroadcastChannel !== "undefined") {
        dbSyncChannel = new BroadcastChannel(DB_SYNC_CHANNEL_NAME);
        dbSyncChannel.addEventListener("message", (event) => {
            handleIncomingDbSync(event.data);
        });
    }

    window.addEventListener("storage", (event) => {
        if (event.key !== DB_SYNC_STORAGE_KEY || !event.newValue) return;
        try {
            handleIncomingDbSync(JSON.parse(event.newValue));
        } catch (err) {
            console.warn("Athar: تعذر قراءة مزامنة localStorage", err);
        }
    });
}

function openIdb() {
    if (idbConnection) return Promise.resolve(idbConnection);

    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB غير متاح"));
            return;
        }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror = () => {
            const err = req.error;
            if (err && (err.name === "VersionError" || err.name === "InvalidStateError")) {
                // Existing DB has higher version; open without version to use current DB
                const fallback = indexedDB.open(IDB_NAME);
                fallback.onerror = () => reject(fallback.error);
                fallback.onsuccess = () => {
                    idbConnection = fallback.result;
                    idbConnection.onclose = () => {
                        idbConnection = null;
                    };
                    resolve(idbConnection);
                };
                fallback.onupgradeneeded = (e) => {
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
                    if (!db.objectStoreNames.contains(MFA_STORE)) {
                        const os2 = db.createObjectStore(MFA_STORE, { keyPath: "userId" });
                        os2.createIndex("by_userId", "userId", { unique: true });
                    }
                };
                return;
            }
            reject(err);
        };
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
            if (!db.objectStoreNames.contains(MFA_STORE)) {
                const os = db.createObjectStore(MFA_STORE, { keyPath: "userId" });
                os.createIndex("by_userId", "userId", { unique: true });
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

function idbGetMfaRecord(db, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!db.objectStoreNames.contains(MFA_STORE)) {
                // ensure store exists by upgrading DB
                await ensureMfaStore();
                db = await openIdb();
            }
            const tx = db.transaction(MFA_STORE, "readonly");
            const r = tx.objectStore(MFA_STORE).get(userId);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        } catch (err) {
            reject(err);
        }
    });
}

function idbPutMfaRecord(db, record) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!db.objectStoreNames.contains(MFA_STORE)) {
                await ensureMfaStore();
                db = await openIdb();
            }
            const tx = db.transaction(MFA_STORE, "readwrite");
            const store = tx.objectStore(MFA_STORE);
            const r = store.put(record);
            r.onsuccess = () => {
                broadcastDbChange();
                resolve(r.result);
            };
            r.onerror = () => reject(r.error);
        } catch (err) {
            reject(err);
        }
    });
}

function idbDeleteMfaRecord(db, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!db.objectStoreNames.contains(MFA_STORE)) {
                await ensureMfaStore();
                db = await openIdb();
            }
            const tx = db.transaction(MFA_STORE, "readwrite");
            const r = tx.objectStore(MFA_STORE).delete(userId);
            r.onsuccess = () => {
                broadcastDbChange();
                resolve();
            };
            r.onerror = () => reject(r.error);
        } catch (err) {
            reject(err);
        }
    });
}

async function ensureMfaStore() {
    // Ensure IDB connection exists
    await ensureIdbInit();
    let db = await openIdb();
    if (db.objectStoreNames.contains(MFA_STORE)) return;
    // Need to upgrade DB to add MFA_STORE
    const oldVersion = db.version;
    try {
        db.close();
    } catch (e) {}
    idbConnection = null;
    const newVersion = oldVersion + 1;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, newVersion);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(MFA_STORE)) {
                d.createObjectStore(MFA_STORE, { keyPath: "userId" });
            }
        };
        req.onsuccess = () => {
            idbConnection = req.result;
            idbConnection.onclose = () => { idbConnection = null; };
            resolve();
        };
        req.onerror = () => reject(req.error);
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
            broadcastDbChange();
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
            broadcastDbChange();
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
            broadcastDbChange();
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
            broadcastDbChange();
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

function normalizeRequestStatus(status) {
    const value = String(status || "").trim().toLowerCase();
    if (
        value === REQUEST_STATUS_PENDING ||
        value === REQUEST_STATUS_APPROVED ||
        value === REQUEST_STATUS_WAITLISTED ||
        value === REQUEST_STATUS_COMPLETED ||
        value === REQUEST_STATUS_WITHDRAWN
    ) {
        return value;
    }
    return REQUEST_STATUS_PENDING;
}

function normalizeRequestRow(request) {
    const row = { ...request };
    row.status = normalizeRequestStatus(row.status);
    return row;
}

function isSeatOccupyingRequest(request) {
    const status = normalizeRequestStatus(request?.status);
    return status === REQUEST_STATUS_APPROVED || status === REQUEST_STATUS_COMPLETED;
}

function canWithdrawRequest(request) {
    const status = normalizeRequestStatus(request?.status);
    return (
        status === REQUEST_STATUS_PENDING ||
        status === REQUEST_STATUS_APPROVED ||
        status === REQUEST_STATUS_WAITLISTED ||
        status === REQUEST_STATUS_COMPLETED
    );
}

function canRequestAccessChat(request) {
    const status = normalizeRequestStatus(request?.status);
    return status === REQUEST_STATUS_APPROVED || status === REQUEST_STATUS_COMPLETED;
}

function getRequestStatusMeta(status) {
    const normalized = normalizeRequestStatus(status);
    if (normalized === REQUEST_STATUS_APPROVED) {
        return { text: "مقبولة", className: "approved" };
    }
    if (normalized === REQUEST_STATUS_WAITLISTED) {
        return { text: "احتياط", className: "waitlisted" };
    }
    if (normalized === REQUEST_STATUS_COMPLETED) {
        return { text: "مكتملة", className: "completed" };
    }
    if (normalized === REQUEST_STATUS_WITHDRAWN) {
        return { text: "منسحبة", className: "withdrawn" };
    }
    return { text: "قيد المراجعة", className: "pending" };
}

function getRequestSortTimestamp(request) {
    return new Date(
        request.approvedAt ||
            request.createdAt ||
            request.completedAt ||
            request.withdrawnAt ||
            0
    ).getTime();
}

function getEventRequestStats(requests, eventId) {
    return (requests || []).reduce(
        (stats, request) => {
            if (request.eventId !== eventId) return stats;
            stats.totalCount += 1;
            const status = normalizeRequestStatus(request.status);
            if (status === REQUEST_STATUS_PENDING) stats.pendingCount += 1;
            if (status === REQUEST_STATUS_WAITLISTED) stats.waitlistCount += 1;
            if (status === REQUEST_STATUS_WITHDRAWN) stats.withdrawnCount += 1;
            if (status === REQUEST_STATUS_COMPLETED) stats.completedCount += 1;
            if (isSeatOccupyingRequest(request)) stats.activeCount += 1;
            return stats;
        },
        {
            totalCount: 0,
            activeCount: 0,
            pendingCount: 0,
            waitlistCount: 0,
            withdrawnCount: 0,
            completedCount: 0,
        }
    );
}

function getEventMemberGroups(users, requests, eventId) {
    const userMap = new Map(
        (users || []).map((user) => [user.uid, normalizeUserRow(user)])
    );

    const currentMembers = [];
    const departedMembers = [];

    for (const request of requests || []) {
        if (request.eventId !== eventId) continue;
        const user = userMap.get(request.userId);
        if (!user || user.role === "admin") continue;

        const member = {
            uid: user.uid,
            name: user.name || "-",
            status: normalizeRequestStatus(request.status),
            avatarInitial: getUserInitial(user.name),
            dateLabel: isSeatOccupyingRequest(request)
                ? formatMemberTimelineLabel(
                    request.promotedAt || request.approvedAt || request.completedAt,
                    "انضمت"
                )
                : formatMemberTimelineLabel(request.withdrawnAt, "غادرت"),
        };

        if (isSeatOccupyingRequest(request)) {
            currentMembers.push(member);
        } else if (member.status === REQUEST_STATUS_WITHDRAWN) {
            departedMembers.push(member);
        }
    }

    const byName = (left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), "ar");

    currentMembers.sort(byName);
    departedMembers.sort(byName);

    return { currentMembers, departedMembers };
}

function getUserInitial(name) {
    const value = String(name || "").trim();
    return value ? value.charAt(0).toUpperCase() : "؟";
}

function formatMemberTimelineLabel(iso, prefix) {
    if (!iso) return "";
    try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "";
        return `${prefix} ${date.toLocaleDateString("ar-SA", {
            year: "numeric",
            month: "short",
            day: "numeric",
        })}`;
    } catch {
        return "";
    }
}

function resolveAdmissionStatusForEvent(requests, eventRecord, requestIdToIgnore = "") {
    const maxParticipants = parseInt(eventRecord?.maxParticipants, 10) || 0;
    if (maxParticipants === 0) return REQUEST_STATUS_APPROVED;

    const activeCount = (requests || []).filter(
        (request) =>
            request.eventId === eventRecord.id &&
            request.id !== requestIdToIgnore &&
            isSeatOccupyingRequest(request)
    ).length;

    return activeCount < maxParticipants
        ? REQUEST_STATUS_APPROVED
        : REQUEST_STATUS_WAITLISTED;
}

function promoteWaitlistedRequests(requests, eventRecord) {
    if (!eventRecord) return [];

    const maxParticipants = parseInt(eventRecord.maxParticipants, 10) || 0;
    const waitlistedRequests = (requests || [])
        .filter(
            (request) =>
                request.eventId === eventRecord.id &&
                normalizeRequestStatus(request.status) === REQUEST_STATUS_WAITLISTED
        )
        .sort((left, right) => getRequestSortTimestamp(left) - getRequestSortTimestamp(right));

    if (!waitlistedRequests.length) return [];

    let availableSeats = maxParticipants === 0
        ? waitlistedRequests.length
        : maxParticipants - (requests || []).filter(
            (request) =>
                request.eventId === eventRecord.id &&
                isSeatOccupyingRequest(request)
        ).length;

    if (availableSeats <= 0) return [];

    const promoted = [];
    for (const request of waitlistedRequests) {
        if (availableSeats <= 0) break;
        request.status = REQUEST_STATUS_APPROVED;
        request.promotedAt = new Date().toISOString();
        promoted.push(request);
        availableSeats -= 1;
    }

    return promoted;
}

function addVolunteerHoursToUser(user, eventRecord) {
    if (!user || !eventRecord) return;
    const hours = Math.max(1, parseInt(eventRecord.volunteerHours, 10) || 4);
    user.hours = (parseInt(user.hours, 10) || 0) + hours;
    normalizeUserRow(user);
    if (!user.volunteerEventIds.includes(eventRecord.id)) {
        user.volunteerEventIds.push(eventRecord.id);
    }
}

function removeVolunteerHoursFromUser(user, eventRecord) {
    if (!user || !eventRecord) return;
    const hours = Math.max(1, parseInt(eventRecord.volunteerHours, 10) || 4);
    user.hours = Math.max(0, (parseInt(user.hours, 10) || 0) - hours);
    normalizeUserRow(user);
    user.volunteerEventIds = user.volunteerEventIds.filter(
        (eventId) => eventId !== eventRecord.id
    );
}

function getCompletedRequestCountForUser(userId, requests) {
    return (requests || []).filter(
        (request) =>
            request.userId === userId &&
            normalizeRequestStatus(request.status) === REQUEST_STATUS_COMPLETED
    ).length;
}

function getVolunteerHoursForRequest(request, eventRecord) {
    if (
        !request ||
        !eventRecord ||
        normalizeRequestStatus(request.status) !== REQUEST_STATUS_COMPLETED
    ) {
        return 0;
    }
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
        (request) => normalizeRequestStatus(request.status) === REQUEST_STATUS_COMPLETED
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
                        getRequestStatusMeta(request.status).text;
                    const statusClass =
                        normalizeRequestStatus(request.status) === REQUEST_STATUS_COMPLETED
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
        requests: Array.isArray(requests)
            ? requests.map(normalizeRequestRow)
            : [],
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
    return canRequestAccessChat(requestRecord);
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

function isStrongPassword(password) {
    const value = String(password || "");
    return (
        value.length >= 8 &&
        /[A-Z]/.test(value) &&
        /[a-z]/.test(value) &&
        /\d/.test(value) &&
        /[^A-Za-z0-9]/.test(value)
    );
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
    const otpEl = document.getElementById("forgot-password-otp");
    return {
        otp: otpEl ? otpEl.value.trim() : "",
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
    const otpEl = document.getElementById("forgot-password-otp");
    const newPasswordEl = document.getElementById("forgot-password-new");
    const confirmPasswordEl = document.getElementById("forgot-password-confirm");
    if (otpEl) otpEl.value = "";
    if (newPasswordEl) newPasswordEl.value = "";
    if (confirmPasswordEl) confirmPasswordEl.value = "";
    forgotPasswordVerifiedEmail = "";
    forgotPasswordVerifiedUserId = "";
    renderForgotPasswordState(false);
}

function renderForgotPasswordState(isVerified) {
    const hint = document.getElementById("forgot-password-hint");
    const otpEl = document.getElementById("forgot-password-otp");
    const newFields = document.getElementById("forgot-password-new-fields");
    const submitBtn = document.getElementById("forgot-password-submit");
    if (hint) {
        hint.textContent = isVerified
            ? "تم التحقق من البريد ورمز المصادقة. أدخلي كلمة المرور الجديدة ثم أكّديها."
            : "أدخلي البريد الجامعي بالأعلى ثم رمز المصادقة الثنائية للتحقق أولاً.";
    }
    if (otpEl) otpEl.disabled = Boolean(isVerified);
    if (newFields) newFields.hidden = !isVerified;
    if (submitBtn) submitBtn.textContent = isVerified ? "تغيير كلمة المرور" : "تحقق";
}

function resetForgotPasswordVerificationState(shouldClearOtp = false) {
    forgotPasswordVerifiedEmail = "";
    forgotPasswordVerifiedUserId = "";
    if (shouldClearOtp) {
        const otpEl = document.getElementById("forgot-password-otp");
        if (otpEl) otpEl.value = "";
    }
    const newPasswordEl = document.getElementById("forgot-password-new");
    const confirmPasswordEl = document.getElementById("forgot-password-confirm");
    if (newPasswordEl) newPasswordEl.value = "";
    if (confirmPasswordEl) confirmPasswordEl.value = "";
    renderForgotPasswordState(false);
}

function toggleForgotPasswordPanel(forceOpen) {
    const panel = document.getElementById("forgot-password-panel");
    if (!panel || getAuthMode() !== "login") return;

    const shouldOpen =
        typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
    panel.hidden = !shouldOpen;

    if (!shouldOpen) {
        clearForgotPasswordForm();
    } else {
        renderForgotPasswordState(Boolean(forgotPasswordVerifiedEmail));
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

function syncForgotPasswordVerificationWithEmail() {
    const panel = document.getElementById("forgot-password-panel");
    if (!panel || panel.hidden || !forgotPasswordVerifiedEmail) return;
    const currentEmail = normalizeEmailInput(getAuthEmailInput());
    if (currentEmail !== forgotPasswordVerifiedEmail) {
        resetForgotPasswordVerificationState(false);
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
        pw.minLength = isRegister ? 8 : 6;
    }
}

async function handleForgotPasswordReset() {
    if (getAuthMode() !== "login") return;

    const emailInput = getAuthEmailInput();
    const email = normalizeEmailInput(emailInput);
    const { otp, newPassword, confirmPassword } = getForgotPasswordValues();
    const isVerifiedStep =
        forgotPasswordVerifiedEmail === email && Boolean(forgotPasswordVerifiedUserId);

    if (!emailInput) {
        showNotification("أدخلي الرقم الجامعي أولاً.");
        return;
    }
    if (!isAdminEmail(email) && !isValidStudentEmailLocalPart(emailInput)) {
        showNotification("أدخلي الرقم الجامعي الصحيح أولاً.");
        return;
    }
    if (!isVerifiedStep) {
        if (!otp) {
            showNotification("أدخلي رمز المصادقة الثنائية أولاً.");
            return;
        }
    } else {
        if (!isStrongPassword(newPassword)) {
            showNotification(
                "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم ورمز خاص."
            );
            return;
        }
        if (newPassword !== confirmPassword) {
            showNotification("كلمتا المرور غير متطابقتين.");
            return;
        }
    }

    showLoader(true);

    try {
        const db = await loadDb();
        const existing = findUserByEmail(db, email);

        if (!isVerifiedStep) {
            const verifyResult = existing && window.MFA
                ? await window.MFA.verifyForRecovery(existing.uid, existing.email, otp)
                : null;

            if (!verifyResult || !verifyResult.ok) {
                showNotification("تعذّر التحقق من بيانات الاستعادة.");
                return;
            }

            forgotPasswordVerifiedEmail = email;
            forgotPasswordVerifiedUserId = existing.uid;
            renderForgotPasswordState(true);
            document.getElementById("forgot-password-new")?.focus();
            showNotification("تم التحقق. أدخلي كلمة المرور الجديدة.");
            return;
        }

        if (!existing || existing.uid !== forgotPasswordVerifiedUserId) {
            resetForgotPasswordVerificationState(true);
            showNotification("تعذّر التحقق من بيانات الاستعادة.");
            return;
        }

        if (window.MFA) {
            const rewrapResult = await window.MFA.rewrapForPasswordReset(
                existing.uid,
                existing.email,
                newPassword
            );
            if (!rewrapResult || !rewrapResult.ok) {
                resetForgotPasswordVerificationState(true);
                showNotification("تعذّر التحقق من بيانات الاستعادة.");
                return;
            }
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
        // Hide the global loader. MFA prompt is shown from the profile page only.
        showLoader(false);

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
    if (!isStrongPassword(password)) {
        showNotification(
            "كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم ورمز خاص."
        );
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
    restoreEventMembersExpandedState();

    if (window.MFA && userData?.email) {
        const authPassword = getAuthPassword();
        if (authPassword) {
            window.MFA
                .ensureRecoveryAccess(userData.uid, authPassword, userData.email)
                .catch((err) => console.warn("MFA recovery migration skipped", err));
        }
    }

    document.getElementById("login-wrapper").style.display = "none";
    document.getElementById("about-modal").style.display = "flex";

    document.getElementById("prof-name-title").innerText = userData.name;
    document.getElementById("prof-name").innerText = userData.name;
    document.getElementById("prof-email").innerText = userData.email;
    document.getElementById("prof-phone").innerText = userData.phone;
    renderHomeColleges();

    // Render MFA status in profile
    try {
        void renderMfaProfileSection();
    } catch (e) {
        console.warn("MFA profile render failed", e);
    }

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

async function showMfaSetupModal(userId, password, accountLabel) {
    console.log("[MFA] showMfaSetupModal start", { userId, accountLabel });
    if (!window.MFA) {
        console.warn("[MFA] window.MFA not available");
        return false;
    }
    const modal = document.getElementById("mfa-setup-modal");
    const qrEl = document.getElementById("mfa-qr");
    const codeInput = document.getElementById("mfa-setup-code");
    const confirmBtn = document.getElementById("mfa-setup-confirm");
    const skipBtn = document.getElementById("mfa-setup-skip");
    const backupPanel = document.getElementById("mfa-backup-codes");
    const backupList = document.getElementById("mfa-backup-list");

    qrEl.innerHTML = "";
    codeInput.value = "";
    backupPanel.hidden = true;
    backupList.textContent = "";

    // create and store encrypted secret, and get provisioning URI + backup codes
    let enrollResult;
    try {
        console.log("[MFA] calling enrollForUser");
        enrollResult = await window.MFA.enrollForUser(
            userId,
            password,
            accountLabel || userId,
            "Athar",
            accountLabel || userId
        );
        console.log("[MFA] enrollForUser returned", enrollResult && { provisioningUri: enrollResult.provisioningUri });
    } catch (err) {
        console.error("MFA enroll failed", err);
        return false;
    }

    // render QR
    try {
        // QRCode lib creates an element inside
        new QRCode(qrEl, { text: enrollResult.provisioningUri, width: 160, height: 160 });
    } catch (err) {
        console.warn("[MFA] QR render failed, falling back to text", err);
        qrEl.textContent = enrollResult.provisioningUri || "";
    }

    modal.classList.add("is-open");
    console.log("[MFA] setup modal opened");

    return await new Promise((resolve) => {
        const cleanup = () => {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "تأكيد وتفعيل";
            modal.classList.remove("is-open");
            confirmBtn.removeEventListener("click", onConfirm);
            skipBtn.removeEventListener("click", onSkip);
            skipBtn.removeEventListener("click", onDone);
        };

        const onSkip = () => {
            // User chose to skip enrollment
            // wipe local password reference
            password = undefined;
            cleanup();
            resolve(false);
        };

        // will be reassigned later if needed
        let onDone = null;

        const onConfirm = async () => {
            const code = codeInput.value.trim();
            if (!/^\d{6}$/.test(code)) {
                showNotification("أدخلي رمزاً صالحاً من تطبيق المصادقة.");
                return;
            }
            setButtonLoadingState(confirmBtn, true, "تأكيد وتفعيل", "جاري التحقق...");
            try {
                const res = await window.MFA.verifyWithPassword(userId, password, code);
                if (res && res.ok) {
                    // show backup codes (enrollResult.backupPlain) and keep modal open
                    backupPanel.hidden = false;
                    backupList.textContent = (enrollResult.backupPlain || []).join("\n");
                    showNotification("تم تفعيل المصادقة الثنائية. احتفظي برموز الطوارئ في مكان آمن.");
                    // disable confirm to prevent repeat
                    confirmBtn.disabled = true;
                    // change skip button to act as a Done/Close button
                    skipBtn.removeEventListener("click", onSkip);
                    skipBtn.textContent = "تم";
                    onDone = () => {
                        // wipe local password reference
                        password = undefined;
                        cleanup();
                        resolve(true);
                    };
                    skipBtn.addEventListener("click", onDone);
                    return;
                }
                showNotification("رمز التحقق غير صحيح.");
            } catch (err) {
                console.error(err);
                showNotification("فشل التحقق. حاولي مرة أخرى.");
            } finally {
                setButtonLoadingState(confirmBtn, false, "تأكيد وتفعيل", "جاري التحقق...");
            }
        };

        confirmBtn.addEventListener("click", onConfirm);
        skipBtn.addEventListener("click", onSkip);
    });
}

async function showMfaPromptModal(userId, password) {
    const modal = document.getElementById("mfa-prompt-modal");
    const input = document.getElementById("mfa-code-input");
    const verifyBtn = document.getElementById("mfa-verify-btn");
    const cancelBtn = document.getElementById("mfa-prompt-cancel");

    if (input) input.value = "";
    modal.classList.add("is-open");
    if (input) input.focus();
    showMfaPromptStatus("", false);

    return await new Promise((resolve) => {
        const cleanup = () => {
            modal.classList.remove("is-open");
            verifyBtn.removeEventListener("click", onVerify);
            cancelBtn.removeEventListener("click", onCancel);
            showMfaPromptStatus("", false);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onVerify = async () => {
            const code = (input && input.value || "").trim();
            if (!code) {
                showMfaPromptStatus("أدخلي رمز المصادقة أو رمز الطوارئ.", true);
                return;
            }
            setButtonLoadingState(verifyBtn, true, "تأكيد", "جاري التحقق...");
            try {
                const res = await window.MFA.verifyWithPassword(userId, password, code);
                if (res && res.ok) {
                    showMfaPromptStatus("", false);
                    cleanup();
                    setButtonLoadingState(verifyBtn, false, "تأكيد", "جاري التحقق...");
                    return resolve(true);
                }
                showMfaPromptStatus("رمز المصادقة غير صحيح.", true);
            } catch (err) {
                console.error("MFA verify error", err);
                showMfaPromptStatus("تعذّر التحقق. حاولي مرة أخرى.", true);
            } finally {
                setButtonLoadingState(verifyBtn, false, "تأكيد", "جاري التحقق...");
            }
        };

        verifyBtn.addEventListener("click", onVerify);
        cancelBtn.addEventListener("click", onCancel);
    });
}

function escapeHtml(text) {
    if (text === undefined || text === null) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
}

async function renderMfaProfileSection() {
    const box = document.getElementById("mfa-profile-box");
    const statusText = document.getElementById("mfa-status-text");
    const enableBtn = document.getElementById("mfa-profile-enable-btn");
    const manageBtn = document.getElementById("mfa-profile-manage-btn");
    if (!box || !statusText || !enableBtn || !manageBtn) return;
    if (!userData) {
        statusText.textContent = "يجب تسجيل الدخول لعرض حالة المصادقة.";
        enableBtn.style.display = "none";
        manageBtn.style.display = "none";
        return;
    }
    statusText.textContent = "جارٍ تحميل حالة المصادقة...";
    enableBtn.style.display = "none";
    manageBtn.style.display = "none";

    if (!window.MFA) {
        statusText.textContent = "المتصفح لا يدعم إدارة المصادقة الثنائية في هذه النسخة.";
        return;
    }

    try {
        const rec = await window.MFA.getMfaRecord(userData.uid);
        if (!rec) {
            statusText.textContent = "المصادقة الثنائية غير مفعّلة للحساب.";
            enableBtn.style.display = "inline-block";
            enableBtn.onclick = async () => {
                let pw = getAuthPassword();
                if (!pw) pw = prompt("أدخلي كلمة المرور لتفعيل المصادقة الثنائية:");
                if (!pw) return;
                const ok = await showMfaSetupModal(userData.uid, pw, userData.email);
                if (ok) {
                    showNotification("تم تفعيل المصادقة الثنائية. يمكنك إدارة الإعدادات من هنا.");
                }
                await renderMfaProfileSection();
            };
            return;
        }

        const devices = Array.isArray(rec.devices) ? rec.devices : [];
        const deviceCount = devices.length;
        const firstDevice = devices[0] || {};
        const label = firstDevice.name || userData.email || userData.uid;
        const created = firstDevice.createdAt ? new Date(firstDevice.createdAt).toLocaleString("ar-SA") : rec.createdAt ? new Date(rec.createdAt).toLocaleString("ar-SA") : "غير معروف";
        statusText.innerHTML = `المصادقة الثنائية مفعّلة لـ: <b>${escapeHtml(label)}</b> — <b>${deviceCount}</b> جهاز`;
        manageBtn.style.display = "inline-block";
        manageBtn.onclick = async () => {
            // Require password + MFA verification before opening manage modal
            let pw = getAuthPassword();
            if (!pw) pw = prompt("أدخلي كلمة المرور لتأكيد الدخول إلى إعدادات المصادقة الثنائية:");
            if (!pw) return;
            try {
                const ok = await showMfaPromptModal(userData.uid, pw);
                if (!ok) {
                    showNotification("فشل التحقق الثنائي. لم يتم فتح إعدادات المصادقة.");
                    return;
                }
                const fresh = await window.MFA.getMfaRecord(userData.uid);
                openMfaManageModal(fresh);
            } catch (err) {
                console.error("MFA manage open error", err);
                showNotification("تعذّر فتح إعدادات المصادقة.");
            }
        };
    } catch (err) {
        console.error("renderMfaProfileSection error", err);
        statusText.textContent = "تعذّر الحصول على حالة المصادقة.";
    }
}

function openMfaManageModal(rec) {
    const modal = document.getElementById("mfa-manage-modal");
    const info = document.getElementById("mfa-manage-info");
    const backupPanel = document.getElementById("mfa-manage-backup");
    const backupList = document.getElementById("mfa-manage-backup-list");
    const closeBtn = document.getElementById("mfa-manage-close");
    const regenBtn = document.getElementById("mfa-manage-regenerate");
    const delBtn = document.getElementById("mfa-manage-delete");

    backupPanel.hidden = true;
    backupList.textContent = "";
    info.textContent = "";
    if (!rec) {
        info.textContent = "لا توجد بيانات المصادقة لهذا المستخدم.";
        modal.classList.add("is-open");
        return;
    }

    // display devices list
    const devicesContainer = document.getElementById("mfa-manage-devices");
    devicesContainer.innerHTML = "";
    const devices = Array.isArray(rec.devices) ? rec.devices : [];
    if (devices.length === 0) {
        info.textContent = "لا توجد أجهزة مسجلة للمصادقة الثنائية.";
    } else {
        info.innerHTML = `المصادقة الثنائية مفعّلة — <b>${devices.length}</b> جهاز`;
        devices.forEach((d) => {
            const row = document.createElement("div");
            row.className = "mfa-manage-device-row";
            const created = d.createdAt ? new Date(d.createdAt).toLocaleString("ar-SA") : "غير معروف";
            row.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee">
                    <div>
                        <strong>${escapeHtml(d.name || d.deviceId)}</strong><br>
                        <small>تم التسجيل: ${escapeHtml(created)}</small>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn-modal-secondary mfa-device-rename" data-device-id="${escapeAttr(d.deviceId)}">إعادة تسمية</button>
                        <button class="btn-modal-secondary mfa-device-revoke" data-device-id="${escapeAttr(d.deviceId)}">إلغاء</button>
                    </div>
                </div>
            `;
            devicesContainer.appendChild(row);
        });
    }

    modal.classList.add("is-open");

    const cleanup = () => {
        modal.classList.remove("is-open");
        closeBtn.removeEventListener("click", onClose);
        regenBtn.removeEventListener("click", onRegen);
        delBtn.removeEventListener("click", onDelete);
        // detach device button handlers
        devicesContainer.querySelectorAll(".mfa-device-rename").forEach((b) => b.removeEventListener("click", onRename));
        devicesContainer.querySelectorAll(".mfa-device-revoke").forEach((b) => b.removeEventListener("click", onRevoke));
    };

    const onClose = () => cleanup();

    const onRegen = async () => {
        let pw = prompt("أدخلي كلمة المرور لتجديد رموز الطوارئ:");
        if (!pw) return;
        try {
            setButtonLoadingState(regenBtn, true, "تجديد رموز الطوارئ", "جاري التجديد...");
            const res = await window.MFA.regenerateBackupCodes(userData.uid, pw);
            if (res && res.ok) {
                backupPanel.hidden = false;
                backupList.textContent = (res.backupPlain || []).join("\n");
                showNotification("تم تجديد رموز الطوارئ. احتفظي بها في مكان آمن.");
            } else {
                showNotification("فشل التحقق أو تجديد الرموز.");
            }
        } catch (err) {
            console.error(err);
            showNotification("حدث خطأ أثناء تجديد الرموز.");
        } finally {
            setButtonLoadingState(regenBtn, false, "تجديد رموز الطوارئ", "جاري التجديد...");
        }
    };

    const onDelete = async () => {
        if (!confirm("هل أنتِ متأكدة من إلغاء تفعيل المصادقة الثنائية؟ سيُطلب إعادة تفعيلها لاحقاً.")) return;
        try {
            await window.MFA.deleteMfaRecord(userData.uid);
            showNotification("تم إلغاء تفعيل المصادقة الثنائية لهذا الحساب.");
            cleanup();
            await renderMfaProfileSection();
        } catch (err) {
            console.error(err);
            showNotification("فشل إلغاء تفعيل المصادقة الثنائية.");
        }
    };

    // per-device handlers
    const onRename = async (ev) => {
        const deviceId = ev.currentTarget.dataset.deviceId;
        const newName = prompt("أدخلي الاسم الجديد للجهاز:");
        if (!newName) return;
        try {
            const res = await window.MFA.renameMfaDevice(userData.uid, deviceId, newName);
            if (res && res.ok) {
                showNotification("تمت إعادة تسمية الجهاز.");
                const fresh = await window.MFA.getMfaRecord(userData.uid);
                openMfaManageModal(fresh);
            } else {
                showNotification("فشل إعادة التسمية.");
            }
        } catch (err) {
            console.error(err);
            showNotification("حدث خطأ أثناء إعادة التسمية.");
        }
    };

    const onRevoke = async (ev) => {
        const deviceId = ev.currentTarget.dataset.deviceId;
        if (!confirm("هل أنتِ متأكدة من إلغاء تفعيل هذا الجهاز؟")) return;
        const pw = prompt("أدخلي كلمة المرور لتأكيد إلغاء تفعيل الجهاز:");
        if (!pw) return;
        try {
            const res = await window.MFA.deleteMfaDevice(userData.uid, deviceId, pw);
            if (res && res.ok) {
                showNotification("تم إلغاء تفعيل الجهاز.");
                const fresh = await window.MFA.getMfaRecord(userData.uid);
                if (!fresh) {
                    cleanup();
                    await renderMfaProfileSection();
                    return;
                }
                openMfaManageModal(fresh);
            } else {
                showNotification("فشل إلغاء تفعيل الجهاز.");
            }
        } catch (err) {
            console.error(err);
            showNotification("حدث خطأ أثناء إلغاء تفعيل الجهاز.");
        }
    };

    closeBtn.addEventListener("click", onClose);
    regenBtn.addEventListener("click", onRegen);
    delBtn.addEventListener("click", onDelete);

    // attach per-device listeners
    devicesContainer.querySelectorAll(".mfa-device-rename").forEach((b) => b.addEventListener("click", onRename));
    devicesContainer.querySelectorAll(".mfa-device-revoke").forEach((b) => b.addEventListener("click", onRevoke));
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

    const { events, requests, users } = await loadDb();
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

    const userRequests = requests.filter((request) => request.userId === userData?.uid);
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
            const stats = getEventRequestStats(requests, ev.id);

            const isReg = registeredEventIds.has(ev.id);
            const request = userRequests.find((item) => item.eventId === ev.id);
            const requestMeta = request ? getRequestStatusMeta(request.status) : null;
            const requestStatus = normalizeRequestStatus(request?.status);
            const canOpenChat = canUserAccessEventChat(userData, ev, request);
            const canViewMembers = Boolean(
                canManageCollege ||
                canRequestAccessChat(request)
            );
            const memberGroups = canViewMembers
                ? getEventMemberGroups(users, requests, ev.id)
                : { currentMembers: [], departedMembers: [] };
            const currentMembersHtml = memberGroups.currentMembers.length
                ? memberGroups.currentMembers
                    .map((member) => `
                        <li class="event-member-item">
                            <span class="event-member-avatar">${escapeHtml(member.avatarInitial)}</span>
                            <span class="event-member-content">
                                <strong>${escapeHtml(member.name)}</strong>
                                ${member.dateLabel ? `<small>${escapeHtml(member.dateLabel)}</small>` : ""}
                            </span>
                        </li>
                    `)
                    .join("")
                : '<li class="event-members-list__empty">لا توجد عضوات حاليات بعد.</li>';
            const departedMembersHtml = memberGroups.departedMembers.length
                ? memberGroups.departedMembers
                    .map((member) => `
                        <li class="event-member-item">
                            <span class="event-member-avatar event-member-avatar--departed">${escapeHtml(member.avatarInitial)}</span>
                            <span class="event-member-content">
                                <strong>${escapeHtml(member.name)}</strong>
                                ${member.dateLabel ? `<small>${escapeHtml(member.dateLabel)}</small>` : ""}
                            </span>
                        </li>
                    `)
                    .join("")
                : '<li class="event-members-list__empty">لا توجد حالات مغادرة حتى الآن.</li>';
            const membersPanelExpanded = isEventMembersPanelExpanded(
                ev.id,
                canManageCollege
            );
            const membersSection = canViewMembers
                ? `
                    <details class="event-members-panel" data-members-event-id="${escapeHtml(ev.id)}" ontoggle="handleEventMembersToggle(event, '${escapeAttr(ev.id)}')" ${membersPanelExpanded ? "open" : ""}>
                        <summary class="event-members-panel__summary">
                            <span class="event-members-panel__header">
                                <span><i class="fas fa-users"></i> أعضاء الفعالية</span>
                            </span>
                            <span class="event-members-panel__meta">${memberGroups.currentMembers.length} حاليات • ${memberGroups.departedMembers.length} غادرن</span>
                        </summary>
                        <div class="event-members-groups">
                            <div class="event-members-group">
                                <h5>الأعضاء الحاليون (${memberGroups.currentMembers.length})</h5>
                                <ul class="event-members-list">${currentMembersHtml}</ul>
                            </div>
                            <div class="event-members-group event-members-group--departed">
                                <h5>الأعضاء الذين غادروا (${memberGroups.departedMembers.length})</h5>
                                <ul class="event-members-list event-members-list--departed">${departedMembersHtml}</ul>
                            </div>
                        </div>
                    </details>
                `
                : "";

            const regNote = isReg
                ? `<span class="hours-tag hours-tag--status hours-tag--${requestMeta.className}">${requestMeta.text}</span>`
                : canRegister
                    ? maxPart > 0 && stats.activeCount >= maxPart
                        ? '<span class="event-tap-hint" style="color: #9c6b00;">العدد مكتمل حالياً، ويمكن وضعك في قائمة الاحتياط بعد قبول الإدارة</span>'
                        : '<span class="event-tap-hint">يمكنكِ الإرسال من الزر أو من البطاقة</span>'
                    : "";

            const canRegClass = canRegister && !isReg ? "event-card--can-register" : "";

            const delBtn = canManageCollege
                ? `<button type="button" class="btn-delete-event" data-delete-id="${escapeHtml(ev.id)}" aria-label="حذف الفعالية" onclick="event.stopPropagation(); deleteCollegeEvent('${escapeAttr(ev.id)}');"><i class="fas fa-trash-alt"></i></button>`
                : "";

            const chatBtn = canOpenChat
                ? `<button type="button" class="btn-chat btn-chat--event" data-chat-event-id="${escapeHtml(ev.id)}" onclick="event.stopPropagation(); openChat('${escapeAttr(ev.id)}').catch(console.error);"><i class="fas fa-comments"></i> شات الفعالية</button>`
                : `<button type="button" class="btn-chat btn-chat--event btn-chat--disabled" disabled>${requestStatus === REQUEST_STATUS_PENDING ? "متاح بعد قبول الإدارة" : requestStatus === REQUEST_STATUS_WAITLISTED ? "متاح بعد دخولك ضمن المقاعد" : "الشات للمشاركات فقط"}</button>`;

            const joinBtn = canRegister && !isReg
                ? `<button type="button" class="btn-join-event" data-join-event-id="${escapeHtml(ev.id)}"><i class="fas fa-paper-plane"></i> إرسال طلب الانضمام</button>`
                : "";

            const withdrawBtn = canRegister && canWithdrawRequest(request)
                ? `<button type="button" class="btn-reject btn-withdraw-event" data-withdraw-event-id="${escapeHtml(ev.id)}"><i class="fas fa-right-from-bracket"></i> انسحاب</button>`
                : "";

            return `
            <div class="event-card${isReg ? " event-card--registered" : ""} ${canRegClass}" data-event-id="${escapeHtml(ev.id)}">
                <div class="event-details">
                    <h4>${title}</h4>
                    <p><i class="far fa-calendar-alt"></i> <b>التاريخ:</b> ${dateStr}</p>
                    <p><i class="far fa-clock"></i> <b>الوقت:</b> ${timeStr}</p>
                    <p><i class="fas fa-map-marker-alt"></i> <b>المكان:</b> ${loc}</p>
                    ${desc ? `<p><i class="fas fa-info-circle"></i> <b>الوصف:</b> ${desc}</p>` : ""}
                    ${maxPart > 0 ? `<p><i class="fas fa-users"></i> <b>المقبولات:</b> ${stats.activeCount}/${maxPart}</p>` : (stats.totalCount > 0 ? `<p><i class="fas fa-users"></i> <b>إجمالي الطلبات:</b> ${stats.totalCount}</p>` : "")}
                    ${stats.waitlistCount > 0 ? `<p><i class="fas fa-user-clock"></i> <b>قائمة الاحتياط:</b> ${stats.waitlistCount}</p>` : ""}
                    ${stats.withdrawnCount > 0 ? `<p><i class="fas fa-user-minus"></i> <b>المنسحبات:</b> ${stats.withdrawnCount}</p>` : ""}
                    ${membersSection}
                </div>
                <div class="event-card-actions">
                    <span class="hours-tag">+${vh} ساعات مكتسبة</span>
                    ${regNote}
                    ${joinBtn}
                    ${withdrawBtn}
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
    restoreEventMembersExpandedState(normalizedCollege);
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

    showLoader(true);
    try {
        const request = {
            id: newUid(),
            userId: userData.uid,
            eventId: eventId,
            status: REQUEST_STATUS_PENDING,
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

async function withdrawEventRequest(eventId) {
    if (!userData || userData.role === "admin") return;

    showLoader(true);
    try {
        const db = await loadDb();
        const request = db.requests.find(
            (item) => item.userId === userData.uid && item.eventId === eventId
        );
        if (!request) {
            showNotification("لا يوجد طلب مرتبط بهذه الفعالية.");
            return;
        }

        if (!canWithdrawRequest(request)) {
            showNotification("لا يمكن تنفيذ الانسحاب لهذا الطلب حالياً.");
            return;
        }

        const eventRecord = db.events.find((eventItem) => eventItem.id === eventId);
        const previousStatus = normalizeRequestStatus(request.status);
        const user = db.users.find((item) => item.uid === userData.uid);
        request.status = REQUEST_STATUS_WITHDRAWN;
        request.withdrawnAt = new Date().toISOString();

        if (previousStatus === REQUEST_STATUS_COMPLETED && user && eventRecord) {
            removeVolunteerHoursFromUser(user, eventRecord);
            await saveDb(db);
        }

        if (isSeatOccupyingRequest({ status: previousStatus }) && eventRecord) {
            promoteWaitlistedRequests(db.requests, eventRecord);
        }

        await saveRequests(db.requests);
        showNotification("تم تسجيل انسحابك من الفعالية.");
        await refreshEventsListUI();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر تنفيذ الانسحاب من الفعالية.");
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
    const completedRequests = db.requests.filter(
        (request) =>
            request.userId === userData.uid &&
            normalizeRequestStatus(request.status) === REQUEST_STATUS_COMPLETED
    );
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

function goToVolunteerOpportunities() {
    closeSuccessModal();
    if (currentCollegeForEvents) {
        goToPage("events-page");
        return;
    }
    goToPage("home-page");
}

function goToProfileFromSuccessModal() {
    closeSuccessModal();
    goToPage("profile-page");
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
            const stats = getEventRequestStats(eventRequests, ev.id);
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
            const buildRequestCard = (r) => {
                const user = userMap.get(r.userId);
                if (!user) return '';
                const name = escapeHtml(user.name);
                const email = escapeHtml(user.email);
                const statusMeta = getRequestStatusMeta(r.status);
                const status = normalizeRequestStatus(r.status);
                const metaLine = status === REQUEST_STATUS_WITHDRAWN && r.withdrawnAt
                    ? `<div class="request-meta-line">انسحبت في ${escapeHtml(new Date(r.withdrawnAt).toLocaleString('ar-SA'))}</div>`
                    : status === REQUEST_STATUS_WAITLISTED
                        ? '<div class="request-meta-line">بانتظار توفر مقعد بسبب اكتمال العدد.</div>'
                        : status === REQUEST_STATUS_APPROVED
                            ? '<div class="request-meta-line">ضمن العضوات المعتمدات داخل العدد.</div>'
                            : status === REQUEST_STATUS_COMPLETED
                                ? '<div class="request-meta-line">تم اعتماد الساعات لهذه الطالبة.</div>'
                                : '<div class="request-meta-line">بانتظار قرار الإدارة.</div>';

                const actions = [];
                if (status === REQUEST_STATUS_PENDING) {
                    actions.push(`<button class="btn-approve" onclick="approveRequest('${r.id}')">قبول</button>`);
                }
                if (status === REQUEST_STATUS_APPROVED) {
                    actions.push(`<button class="btn-approve" onclick="completeRequest('${r.id}')">إنجاز الساعات</button>`);
                }
                if (status === REQUEST_STATUS_COMPLETED) {
                    actions.push(`<button class="btn-reject" onclick="rejectRequest('${r.id}')">تراجع عن الإنجاز</button>`);
                }

                return `
                    <div class="admin-request-item">
                        <div class="request-info">
                            <div class="request-name">${name}</div>
                            <div class="request-email">${email}</div>
                            ${metaLine}
                        </div>
                        <div class="request-status ${statusMeta.className}">${statusMeta.text}</div>
                        <div class="request-actions">
                            ${actions.join('')}
                        </div>
                    </div>
                `;
            };

            const activeRequests = eventRequests
                .filter((request) => isSeatOccupyingRequest(request))
                .sort((left, right) => getRequestSortTimestamp(left) - getRequestSortTimestamp(right));
            const waitlistedRequests = eventRequests
                .filter((request) => normalizeRequestStatus(request.status) === REQUEST_STATUS_WAITLISTED)
                .sort((left, right) => getRequestSortTimestamp(left) - getRequestSortTimestamp(right));
            const pendingRequests = eventRequests
                .filter((request) => normalizeRequestStatus(request.status) === REQUEST_STATUS_PENDING)
                .sort((left, right) => getRequestSortTimestamp(left) - getRequestSortTimestamp(right));
            const withdrawnRequests = eventRequests
                .filter((request) => normalizeRequestStatus(request.status) === REQUEST_STATUS_WITHDRAWN)
                .sort((left, right) => getRequestSortTimestamp(right) - getRequestSortTimestamp(left));

            const renderGroup = (title, items, emptyText) => `
                <div class="admin-request-group">
                    <h5 class="admin-request-group__title">${title}</h5>
                    ${items.length ? items.map(buildRequestCard).join('') : `<p class="admin-request-group__empty">${emptyText}</p>`}
                </div>
            `;

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
                        <p><strong>المقبولات داخل العدد:</strong> ${stats.activeCount}${ev.maxParticipants ? ` / ${ev.maxParticipants}` : ''}</p>
                        <p><strong>قائمة الاحتياط:</strong> ${stats.waitlistCount}</p>
                        <p><strong>المنسحبات:</strong> ${stats.withdrawnCount}</p>
                        <p><strong>عدد الرسائل:</strong> ${eventChats.length}</p>
                        <p><strong>آخر رسالة:</strong> ${lastChat ? `${lastChatSender}: ${lastChatPreview}` : lastChatPreview}</p>
                        ${ev.maxParticipants ? `<p><strong>الحد الأقصى:</strong> ${ev.maxParticipants}</p>` : ''}
                    </div>
                    <div class="admin-requests-list">
                        <h4>إدارة العضوات والطلبات (${eventRequests.length})</h4>
                        ${renderGroup('العضوات الموجودات داخل الفعالية', activeRequests, 'لا توجد عضوات معتمدات داخل هذه الفعالية بعد.')}
                        ${renderGroup('قائمة الاحتياط', waitlistedRequests, 'لا توجد عضوات في قائمة الاحتياط.')}
                        ${renderGroup('طلبات قيد المراجعة', pendingRequests, 'لا توجد طلبات قيد المراجعة.')}
                        ${renderGroup('المنسحبات', withdrawnRequests, 'لا توجد حالات انسحاب حتى الآن.')}
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
        if (!request || normalizeRequestStatus(request.status) !== REQUEST_STATUS_PENDING) {
            showNotification("الطلب غير موجود أو لم يعد بانتظار القبول.");
            return;
        }

        const event = db.events.find(e => e.id === request.eventId);
        if (!event || !canAdminAccessCollege(event.college)) {
            showNotification("لا تملكين صلاحية تعديل هذا الطلب.");
            return;
        }

        request.status = resolveAdmissionStatusForEvent(db.requests, event, request.id);
        request.approvedAt = new Date().toISOString();

        await saveRequests(db.requests);
        showNotification(
            request.status === REQUEST_STATUS_WAITLISTED
                ? "تم قبول الطلب وإضافته إلى قائمة الاحتياط بسبب اكتمال العدد."
                : "تم قبول الطلب وإدخال الطالبة ضمن المشاركات."
        );
        renderAdminPage();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر قبول الطلب.");
    } finally {
        showLoader(false);
    }
}

async function completeRequest(requestId) {
    if (!userData || userData.role !== "admin") return;

    showLoader(true);
    try {
        const db = await loadDb();
        const request = db.requests.find((item) => item.id === requestId);
        if (!request || normalizeRequestStatus(request.status) !== REQUEST_STATUS_APPROVED) {
            showNotification("يمكن اعتماد الساعات فقط للطلبات المقبولة داخل العدد.");
            return;
        }

        const event = db.events.find((item) => item.id === request.eventId);
        if (!event || !canAdminAccessCollege(event.college)) {
            showNotification("لا تملكين صلاحية تعديل هذا الطلب.");
            return;
        }

        const user = db.users.find((item) => item.uid === request.userId);
        if (user) {
            addVolunteerHoursToUser(user, event);
            await saveDb(db);
        }

        request.status = REQUEST_STATUS_COMPLETED;
        request.completedAt = new Date().toISOString();
        await saveRequests(db.requests);
        showNotification("تم اعتماد الساعات للطالبة.");
        renderAdminPage();
    } catch (err) {
        console.error(err);
        showNotification("تعذّر اعتماد الساعات.");
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
        if (!request || normalizeRequestStatus(request.status) !== REQUEST_STATUS_COMPLETED) {
            showNotification("الطلب غير موجود أو غير مكتمل.");
            return;
        }

        const event = db.events.find(e => e.id === request.eventId);
        if (!event || !canAdminAccessCollege(event.college)) {
            showNotification("لا تملكين صلاحية تعديل هذا الطلب.");
            return;
        }

        request.status = resolveAdmissionStatusForEvent(db.requests, event, request.id);

        const user = db.users.find(u => u.uid === request.userId);
        if (user) {
            removeVolunteerHoursFromUser(user, event);
            await saveDb(db);
        }

        await saveRequests(db.requests);
        showNotification(
            request.status === REQUEST_STATUS_WAITLISTED
                ? "تم التراجع عن الإنجاز وإعادة الطالبة إلى قائمة الاحتياط."
                : "تم التراجع عن الإنجاز وإزالة الساعات."
        );
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
    clearEventMembersExpandedStateStorageForUser();
    userData = null;
    clearHoursSubscription();
    clearAdminSubscription();
    eventMembersExpandedState = new Map();
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

async function testOpenMfaModal() {
    try {
        if (!userData) {
            alert("يجب تسجيل الدخول أولاً لاختبار المصادقة الثنائية.");
            return;
        }
        // Prefer any available password from the registration payload or the auth form
        let pw = null;
        try {
            if (typeof pendingRegistrationPayload !== "undefined" && pendingRegistrationPayload && pendingRegistrationPayload.password) {
                pw = pendingRegistrationPayload.password;
            }
        } catch (e) {}
        if (!pw) {
            const formPw = getAuthPassword();
            if (formPw) pw = formPw;
        }
        // fallback to prompt only if we couldn't find a password in the form/payload
        if (!pw) {
            pw = prompt("أدخلي كلمة المرور لاختبار تفعيل المصادقة الثنائية:");
        }
        if (!pw) return;
        console.log("[MFA] testOpenMfaModal invoking setup", { uid: userData.uid });
        await showMfaSetupModal(userData.uid, pw, userData.email);
    } catch (err) {
        console.error("[MFA] testOpenMfaModal error", err);
        showNotification("تعذّر فتح اختبار المصادقة الثنائية.");
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

    if (pageId === "events-page" && currentCollegeForEvents) {
        refreshEventsListUI().catch(console.error);
    }

    if (pageId === "profile-page") {
        try {
            void renderMfaProfileSection();
        } catch (err) {
            console.warn("renderMfaProfileSection error", err);
        }
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
        restoreEventMembersExpandedState(normalizedCollege);
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

function handleNavToggleClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    toggleNavMenu();
}

window.addEventListener("athar-db-changed", () => {
    queueDbJsonAutoSave();

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
    const memberPanel = e.target.closest(".event-members-panel");
    if (memberPanel) {
        e.stopPropagation();
        return;
    }
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
    const withdrawBtn = e.target.closest(".btn-withdraw-event[data-withdraw-event-id]");
    if (withdrawBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = withdrawBtn.getAttribute("data-withdraw-event-id");
        if (id) {
            withdrawEventRequest(id).catch(console.error);
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
    setupDbSync();

    const eventsListEl = document.getElementById("events-list");
    if (eventsListEl) {
        eventsListEl.addEventListener("click", handleEventsListClick);
    }

    const authEmailEl = document.getElementById("reg-email");
    if (authEmailEl) {
        authEmailEl.addEventListener("input", () => {
            sanitizeStudentIdInput();
            syncForgotPasswordVerificationWithEmail();
        });
    }

    ["forgot-password-otp", "forgot-password-new", "forgot-password-confirm"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleForgotPasswordReset();
            }
        });
    });

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
                    restoreEventMembersExpandedState();
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
});
