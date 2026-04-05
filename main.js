const API_URL = "https://sheetdb.io/api/v1/oerc98e04b1uo";
let userData = null;

function showNotification(message, duration = 4000) {
    const toast = document.getElementById("notification-toast");
    const messageEl = document.getElementById("notification-message");
    messageEl.textContent = message;
    toast.classList.add("show");
    
    setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

async function handleAuth(e) {
    e.preventDefault();
    const fullname = document.getElementById("reg-fullname").value.trim();
    const names = fullname.split(/\s+/);
    if (names.length < 3) {
        showNotification("مطلوب على الأقل ثلاثة أسماء");
        return;
    }
    showLoader(true);
    const email = document.getElementById("reg-email").value;
    const isAdmin = email === "admin@pnu.edu.sa";

    try {
        const res = await fetch(`${API_URL}/search?email=${email}`);
        const data = await res.json();

        if (data.length > 0) {
            userData = data[0];
        } else {
            userData = {
                name: fullname,
                email: email,
                phone: document.getElementById("reg-phone").value,
                dob: document.getElementById("reg-dob").value,
                hours: 0,
                role: isAdmin ? "admin" : "student",
            };
            await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: [userData] }),
            });
        }
        startApp();
    } catch (err) {
        showNotification("عذراً، فشل الاتصال بقاعدة البيانات.");
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
    }
}

function updateChart(h) {
    const hrs = parseInt(h) || 0;
    const percent = Math.min((hrs / 50) * 100, 100);
    document.getElementById("chart-circle").style.background =
        `conic-gradient(var(--primary) ${percent}%, #eee 0%)`;
    document
        .getElementById("chart-circle")
        .querySelector("span").innerText = percent.toFixed(0) + "%";
    document.getElementById("hours-summary").innerText =
        `أنجزتِ ${hrs} من 50 ساعة تطوعية`;
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

async function loadAdmin() {
    goToPage("admin-page");
    const table = document.getElementById("admin-table-body");
    table.innerHTML =
        "<tr><td colspan='3' style='text-align:center;'>جاري جلب قائمة الطالبات...</td></tr>";
    try {
        const res = await fetch(API_URL);
        const all = await res.json();
        table.innerHTML = "";
        all
            .filter((u) => u.role !== "admin")
            .forEach((u) => {
                table.innerHTML += `<tr>
                    <td>${u.name}</td>
                    <td><b>${u.hours}</b> ساعة</td>
                    <td><button onclick="addHours('${u.email}', ${u.hours})" style="background:#2e7d32; color:white; border:none; padding:8px 15px; border-radius:8px; cursor:pointer; font-weight:bold;">+5 ساعات</button></td>
                </tr>`;
            });
    } catch (e) {
        table.innerHTML = "خطأ في تحميل البيانات.";
    }
}

async function addHours(email, current) {
    showLoader(true);
    await fetch(`${API_URL}/email/${email}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { hours: parseInt(current) + 5 } }),
    });
    loadAdmin();
    showLoader(false);
}

function closeAbout() {
    document.getElementById("about-modal").style.display = "none";
    document.getElementById("site-content").style.display = "block";
    document.querySelector(".site-nav").style.display = "flex";
    goToPage("home-page");
}

function goToPage(id) {
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    window.scrollTo(0, 0);
}

function showLoader(v) {
    document.getElementById("loader").style.display = v ? "flex" : "none";
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
