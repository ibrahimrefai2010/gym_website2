(function adminDashboard() {
  const state = {
    overview: null,
    publicData: window.GYM_DEFAULT_DATA,
    plans: [],
    offers: [],
    siteImages: null,
    slides: [],
    messages: [],
    rbac: { roles: [], permissions: [], assignments: [] },
    reportSummary: null,
    aiAnswer: null,
    selectedRoleKey: null,
    selectedMessageId: null
  };

  const statusLabels = {
    active: "نشط",
    inactive: "غير نشط",
    suspended: "موقوف",
    unread: "غير مقروءة",
    read: "مقروءة",
    archived: "مؤرشفة",
    pending: "معلق",
    completed: "مكتمل",
    failed: "فشل",
    refunded: "مسترد",
    cancelled: "ملغي",
    expired: "منتهية",
    preferred: "مميزة",
    staff: "موظف",
    manager: "مدير",
    admin: "مشرف",
    super_admin: "مدير عام",
    info: "معلومة"
  };

  function localize(value) {
    return window.GymI18n.localize(value);
  }

  function t(key) {
    return window.GymI18n.t(key);
  }

  function setHtml(selector, html) {
    const node = document.querySelector(selector);
    if (node) {
      node.innerHTML = html;
    }
  }

  function setMessage(selector, text, success) {
    const node = document.querySelector(selector);
    if (!node) {
      return;
    }
    node.textContent = text;
    node.style.color = success ? "#c8a867" : "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function siteImages() {
    return state.siteImages || state.publicData.siteImages || window.GYM_DEFAULT_DATA.siteImages || {};
  }

  function imageUrl(value) {
    return String(value || "").trim();
  }

  function imageThumb(url, label = "") {
    const src = imageUrl(url);
    if (!src) {
      return `<span class="image-empty">No image</span>`;
    }
    return `<img class="table-image" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">`;
  }

  function applySiteImages() {
    const images = siteImages();
    const logoUrl = imageUrl(images.logo?.imageUrl);
    document.querySelectorAll('[data-site-image="logo"]').forEach((img) => {
      if (logoUrl) {
        img.src = logoUrl;
      }
    });
  }

  function statusLabel(value) {
    const key = String(value || "").toLowerCase();
    return statusLabels[key] || value || "";
  }

  function planName(plan) {
    return plan.name?.ar || plan.name?.en || localize(plan.name);
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    return new Intl.DateTimeFormat(window.GymI18n.currentLang() === "ar" ? "ar-SA" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "Asia/Riyadh"
    }).format(new Date(value));
  }

  function money(value, currency) {
    return new Intl.NumberFormat(window.GymI18n.currentLang() === "ar" ? "ar-SA" : "en-US", {
      style: "currency",
      currency: currency || "SAR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function renderBrand() {
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = localize(state.publicData.brand.localeName);
    });
    applySiteImages();
  }

  function renderStats() {
    setHtml(
      "#adminStats",
      (state.overview?.stats || [])
        .map(
          (stat) => `
            <article class="metric-card">
              <span>${escapeHtml(localize(stat.label))}</span>
              <strong>${escapeHtml(stat.value)}</strong>
              <small>${escapeHtml(stat.delta || "")}</small>
            </article>
          `
        )
        .join("")
    );
  }

  function renderUsers() {
    const users = state.overview?.users || [];
    setHtml(
      "#overviewUsers",
      users
        .map(
          (user) => `
            <tr>
              <td>${escapeHtml(user.fullName)}</td>
              <td>${escapeHtml(user.email)}</td>
              <td>${escapeHtml(user.plan || user.membership || "")}</td>
              <td>${escapeHtml(statusLabel(user.status))}</td>
            </tr>
          `
        )
        .join("")
    );
    setHtml(
      "#adminUsers",
      users
        .map(
          (user) => `
            <tr>
              <td>${escapeHtml(user.fullName)}</td>
              <td>${escapeHtml(user.email)}</td>
              <td>${escapeHtml(user.phone)}</td>
              <td>${escapeHtml(user.plan || user.membership || "")}</td>
              <td>${escapeHtml(statusLabel(user.status))}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderMemberships() {
    setHtml(
      "#membershipRows",
      (state.overview?.memberships || [])
        .map(
          (membership) => `
            <tr>
              <td>${escapeHtml(membership.member)}</td>
              <td>${escapeHtml(membership.plan)}</td>
              <td>${formatDate(membership.startDate)}</td>
              <td>${formatDate(membership.endDate)}</td>
              <td>${escapeHtml(membership.remainingDays ?? "")}</td>
              <td>${escapeHtml(statusLabel(membership.status))}</td>
              <td>${escapeHtml(statusLabel(membership.paymentStatus))}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderPlans() {
    const plans = state.plans.length ? state.plans : state.publicData.plans || [];
    setHtml(
      "#planRows",
      plans
        .map(
          (plan) => `
            <tr>
              <td>${escapeHtml(plan.id)}</td>
              <td>${escapeHtml(planName(plan))}</td>
              <td>${escapeHtml(plan.name?.ar || "")}</td>
              <td>${Number(plan.durationDays || 0)} يوم${Number(plan.bonusDays || 0) ? ` + ${Number(plan.bonusDays)} إضافية` : ""}</td>
              <td>${money(plan.priceDiscounted ?? plan.price, plan.currency)}</td>
              <td>${escapeHtml(plan.isActive === false ? statusLabel("inactive") : plan.highlighted || plan.isFeatured ? statusLabel("preferred") : statusLabel("active"))}</td>
              <td>
                <div class="row-actions">
                  <button class="btn small secondary" type="button" data-plan-action="edit" data-plan-id="${escapeHtml(plan.id)}">تعديل</button>
                  <button class="btn small danger" type="button" data-plan-action="delete" data-plan-id="${escapeHtml(plan.id)}">حذف</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderOffers() {
    setHtml(
      "#offerRows",
      (state.offers.length ? state.offers : state.publicData.offers || [])
        .map(
          (offer) => `
            <tr>
              <td>${escapeHtml(offer.id)}</td>
              <td>${imageThumb(offer.imageUrl, offer.title?.en || offer.title?.ar || "Offer")}</td>
              <td>${escapeHtml(offer.title?.ar || offer.title?.en || "")}</td>
              <td>${escapeHtml(offer.title?.ar || "")}</td>
              <td>${formatDate(offer.validUntil || offer.endDate)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn small secondary" type="button" data-offer-action="edit" data-offer-id="${escapeHtml(offer.id)}">تعديل</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderSlider() {
    setHtml(
      "#sliderRows",
      (state.slides.length ? state.slides : state.publicData.slides || [])
        .map(
          (slide) => `
            <tr>
              <td>${escapeHtml(slide.id)}</td>
              <td>${imageThumb(slide.imageUrl, slide.title?.en || slide.title?.ar || "Slide")}</td>
              <td>${escapeHtml(slide.title?.ar || slide.title?.en || "")}</td>
              <td>${escapeHtml(slide.title?.ar || "")}</td>
              <td>${escapeHtml(statusLabel(slide.isActive === false ? "inactive" : "active"))}</td>
              <td>
                <div class="row-actions">
                  <button class="btn small secondary" type="button" data-slide-action="edit" data-slide-id="${escapeHtml(slide.id)}">Edit</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    );
  }

  function updateImageFieldPreview(fieldName, url) {
    const preview = document.querySelector(`[data-image-preview-field="${fieldName}"] img`);
    if (preview && imageUrl(url)) {
      preview.src = imageUrl(url);
    }
  }

  function renderSiteImageForm() {
    const form = document.querySelector("#siteImageForm");
    if (!form) {
      return;
    }

    const images = siteImages();
    const values = {
      logoUrl: images.logo?.imageUrl || "/assets/logo.png",
      homeHeroImageUrl: images.homeHero?.imageUrl || "/assets/images/hero-gym.webp",
      homeHeroFallbackImageUrl: images.homeHero?.fallbackImageUrl || "/assets/images/hero-gym.png",
      authHeroImageUrl: images.authHero?.imageUrl || "/assets/images/hero-gym.webp",
      authHeroFallbackImageUrl: images.authHero?.fallbackImageUrl || "/assets/images/hero-gym.png",
      socialShareImageUrl: images.socialShare?.imageUrl || "/assets/images/hero-gym.png"
    };

    Object.entries(values).forEach(([name, value]) => {
      if (form.elements[name]) {
        form.elements[name].value = value;
      }
      updateImageFieldPreview(name, value);
    });
  }

  function renderHomepage() {
    const homepage = state.publicData.homepage || {};
    setHtml(
      "#homepageRows",
      Object.entries(homepage)
        .map(
          ([key, section]) => `
            <tr>
              <td>${escapeHtml(key)}</td>
              <td>${escapeHtml(section.title?.ar || section.headline?.ar || section.title?.en || section.headline?.en || "")}</td>
              <td>${escapeHtml(section.title?.ar || section.headline?.ar || "")}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderContact() {
    const contact = state.publicData.contact || {};
    const fields = [
      ["النادي", localize(state.publicData.brand?.localeName)],
      ["الهاتف", contact.phone],
      ["واتساب", contact.whatsapp],
      ["البريد", contact.email],
      ["العنوان", localize(contact.address)],
      ["الخريطة", contact.mapEmbedUrl]
    ];

    setHtml(
      "#contactCards",
      fields
        .map(
          ([label, value]) => `
            <div class="settings-card">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value || "")}</strong>
            </div>
          `
        )
        .join("")
    );
  }

  function renderMessages() {
    const messages = state.messages.length ? state.messages : state.overview?.messages || [];
    const unread = messages.filter((message) => message.status === "unread").length;
    const unreadBadge = document.querySelector("#unreadBadge");
    if (unreadBadge) {
      unreadBadge.textContent = `${unread} غير مقروءة`;
    }

    setHtml(
      "#messageRows",
      messages
        .map(
          (message) => `
            <tr>
              <td>${escapeHtml(message.name)}</td>
              <td>${escapeHtml(message.phone)}</td>
              <td>${escapeHtml(message.email)}</td>
              <td>${escapeHtml(message.subject)}</td>
              <td>${escapeHtml(statusLabel(message.status))}</td>
              <td>${formatDate(message.createdAt || message.created_at)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn small secondary" type="button" data-message-action="read" data-message-id="${escapeHtml(message.id)}">قراءة</button>
                  <button class="btn small secondary" type="button" data-message-action="archived" data-message-id="${escapeHtml(message.id)}">أرشفة</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    );

    renderMessageDetail();
  }

  function selectedMessage() {
    return (state.messages.length ? state.messages : state.overview?.messages || []).find(
      (message) => String(message.id) === String(state.selectedMessageId)
    );
  }

  function renderMessageDetail() {
    const panel = document.querySelector("#messageDetail");
    if (!panel) {
      return;
    }

    const message = selectedMessage();
    panel.hidden = !message;
    if (!message) {
      return;
    }

    document.querySelector("#messageDetailSubject").textContent = message.subject || "رسالة";
    setHtml(
      "#messageDetailMeta",
      `
        <span><strong>المرسل</strong>${escapeHtml(message.name)}</span>
        <span><strong>البريد</strong>${escapeHtml(message.email)}</span>
        <span><strong>الجوال</strong>${escapeHtml(message.phone)}</span>
        <span><strong>الحالة</strong>${escapeHtml(statusLabel(message.status))}</span>
        <span><strong>التاريخ</strong>${formatDate(message.createdAt || message.created_at)}</span>
      `
    );
    document.querySelector("#messageDetailBody").textContent = message.message || "";
    setMessage("#messageActionStatus", "", true);
  }

  function renderPayments() {
    setHtml(
      "#paymentRows",
      (state.overview?.payments || [])
        .map(
          (payment) => `
            <tr>
              <td>${escapeHtml(payment.id)}</td>
              <td>${escapeHtml(payment.member)}</td>
              <td>${escapeHtml(payment.amount)}</td>
              <td>${escapeHtml(statusLabel(payment.status))}</td>
              <td>${formatDate(payment.date)}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderAdminAccounts() {
    setHtml(
      "#adminAccountRows",
      (state.overview?.adminAccounts || [])
        .map(
          (account) => `
            <tr>
              <td>${escapeHtml(account.id)}</td>
              <td>${escapeHtml(account.username)}</td>
              <td>${escapeHtml(account.email)}</td>
              <td>${escapeHtml(statusLabel(account.role))}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function selectedRole() {
    const roles = state.rbac?.roles || [];
    if (!state.selectedRoleKey && roles.length > 0) {
      state.selectedRoleKey = roles[0].key;
    }
    return roles.find((role) => role.key === state.selectedRoleKey) || roles[0] || null;
  }

  function permissionGroups() {
    return (state.rbac?.permissions || []).reduce((groups, permission) => {
      const category = permission.category || "Custom";
      groups[category] = groups[category] || [];
      groups[category].push(permission);
      return groups;
    }, {});
  }

  function renderRbac() {
    const roles = state.rbac?.roles || [];
    const role = selectedRole();
    const selectedKeys = new Set(role?.permissionKeys || []);

    setHtml(
      "#roleRows",
      roles
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.displayName || item.key)}</td>
              <td>${escapeHtml(item.isActive === false ? statusLabel("inactive") : statusLabel("active"))}</td>
              <td>${escapeHtml((item.permissionKeys || []).length)}</td>
              <td><button class="btn small secondary" type="button" data-role-select="${escapeHtml(item.key)}">Select</button></td>
            </tr>
          `
        )
        .join("")
    );

    const roleKeyInput = document.querySelector("#selectedRoleKey");
    if (roleKeyInput) {
      roleKeyInput.value = role?.key || "";
    }
    const title = document.querySelector("#selectedRoleTitle");
    if (title) {
      title.textContent = role ? `${role.displayName || role.key} permissions` : "Role permissions";
    }

    setHtml(
      "#permissionChecks",
      Object.entries(permissionGroups())
        .map(
          ([category, permissions]) => `
            <fieldset class="permission-group">
              <legend>${escapeHtml(category)}</legend>
              ${permissions
                .map(
                  (permission) => `
                    <label class="permission-check">
                      <input type="checkbox" name="permissionKeys" value="${escapeHtml(permission.key)}" ${selectedKeys.has(permission.key) ? "checked" : ""}>
                      <span>${escapeHtml(permission.key)}</span>
                    </label>
                  `
                )
                .join("")}
            </fieldset>
          `
        )
        .join("")
    );

    setHtml(
      "#adminRoleOptions",
      roles
        .filter((item) => item.isActive !== false)
        .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.displayName || item.key)}</option>`)
        .join("")
    );

    setHtml(
      "#adminAssignmentRows",
      (state.rbac?.assignments || [])
        .map(
          (assignment) => `
            <tr>
              <td>${escapeHtml(assignment.adminId)}</td>
              <td>${escapeHtml(assignment.fullName)}</td>
              <td>${escapeHtml(assignment.email)}</td>
              <td>${escapeHtml((assignment.roleKeys || []).join(", "))}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderAiAssistant() {
    const answerRoot = document.querySelector("#aiAnswer");
    if (answerRoot) {
      answerRoot.textContent = state.aiAnswer?.answer || "";
    }

    const metrics = state.reportSummary?.metrics || {};
    const smartMetrics = [
      ["Revenue", metrics.revenue],
      ["Expenses", metrics.expenses],
      ["Profit", metrics.profit],
      ["New customers", metrics.newCustomers],
      ["Active memberships", metrics.activeMemberships],
      ["Attendance", metrics.attendance]
    ];
    setHtml(
      "#smartMetricRows",
      smartMetrics
        .map(
          ([label, value]) => `
            <article class="metric-card">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value ?? 0)}</strong>
              <small>${escapeHtml(state.reportSummary?.range?.from || "")} - ${escapeHtml(state.reportSummary?.range?.to || "")}</small>
            </article>
          `
        )
        .join("")
    );
    setHtml(
      "#aiRecommendationRows",
      (state.reportSummary?.aiRecommendations || [])
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.title)}</td>
              <td>${escapeHtml(item.category)}</td>
              <td>${escapeHtml(item.priority)}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderLogs() {
    setHtml(
      "#logRows",
      (state.overview?.logs || [])
        .map(
          (log) => `
            <tr>
              <td>${escapeHtml(log.id)}</td>
              <td>${escapeHtml(statusLabel(log.level || "info"))}</td>
              <td>${escapeHtml(log.message || log.description || log.action || "")}</td>
              <td>${formatDate(log.createdAt || log.created_at)}</td>
            </tr>
          `
        )
        .join("")
    );
  }

  function renderSettings() {
    const contact = state.publicData.contact || {};
    const node = document.querySelector("#settingsContact");
    if (node) {
      node.textContent = `${contact.phone || ""} · ${contact.email || ""} · ${localize(contact.address)}`;
    }
  }

  function drawChart(selector, values, label) {
    const canvas = document.querySelector(selector);
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const padding = 28;
    const data = values?.length ? values : [180, 240, 210, 310, 380, 418];
    const max = Math.max(...data);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    for (let row = 0; row < 4; row += 1) {
      const y = padding + row * ((height - padding * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#c8a867";
    ctx.lineWidth = 3;
    ctx.beginPath();
    data.forEach((value, index) => {
      const x = padding + index * ((width - padding * 2) / Math.max(data.length - 1, 1));
      const y = height - padding - (value / max) * (height - padding * 2);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText(label, padding, 22);
  }

  function renderCharts() {
    drawChart("#revenueChart", state.overview?.charts?.revenue, "الإيرادات");
    drawChart("#growthChart", state.overview?.charts?.growth, "نمو العضويات");
    drawChart("#revenueChartLarge", state.overview?.charts?.revenue, "الإيراد الشهري");
    drawChart("#growthChartLarge", state.overview?.charts?.growth, "نمو المستخدمين");
  }

  function renderAll() {
    renderBrand();
    renderStats();
    renderUsers();
    renderMemberships();
    renderPlans();
    renderOffers();
    renderSlider();
    renderSiteImageForm();
    renderHomepage();
    renderContact();
    renderMessages();
    renderPayments();
    renderAdminAccounts();
    renderRbac();
    renderAiAssistant();
    renderLogs();
    renderSettings();
    renderCharts();
  }

  async function ensureAdminSession() {
    try {
      return await window.GymApi.ensureSession();
    } catch (_first) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return window.GymApi.refreshSession();
    }
  }

  async function load() {
    try {
      const user = await ensureAdminSession();
      if (user?.type !== "admin") {
        window.location.href = "/login.html";
        return;
      }
      const [overview, publicData, plans, offers, siteImagesData, slides, messages, rbac, reportSummary] = await Promise.all([
        window.GymApi.request("/api/v1/admin/overview"),
        window.GymApi.bootstrap(),
        window.GymApi.request("/api/v1/admin/plans"),
        window.GymApi.request("/api/v1/admin/offers"),
        window.GymApi.request("/api/v1/admin/siteImages"),
        window.GymApi.request("/api/v1/admin/slides"),
        window.GymApi.request("/api/v1/messages"),
        window.GymApi.request("/api/v1/admin/rbac"),
        window.GymApi.request("/api/v1/reports/summary").catch(() => null)
      ]);
      state.overview = overview;
      state.publicData = publicData;
      state.plans = plans;
      state.offers = offers || publicData.offers || [];
      state.siteImages = siteImagesData || publicData.siteImages || null;
      state.slides = slides || publicData.slides || [];
      state.messages = messages;
      state.rbac = rbac;
      state.reportSummary = reportSummary;
      if (state.selectedRoleKey && !state.rbac.roles?.some((role) => role.key === state.selectedRoleKey)) {
        state.selectedRoleKey = null;
      }
      if (state.selectedMessageId && !selectedMessage()) {
        state.selectedMessageId = null;
      }
      renderAll();
    } catch (_error) {
      window.GymApi.clearSession();
      window.location.href = "/login.html";
    }
  }

  function setupTabs() {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const section = button.dataset.adminTab;
        document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
          tab.classList.toggle("is-active", tab === button);
        });
        document.querySelectorAll("[data-admin-section]").forEach((panel) => {
          panel.classList.toggle("is-active", panel.dataset.adminSection === section);
        });
        renderCharts();
        if (window.matchMedia("(max-width: 1024px)").matches) {
          document.querySelector(".admin-sidebar")?.classList.remove("is-open");
          document.querySelector(".admin-sidebar-toggle")?.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  function formPayload(form) {
    return Object.fromEntries(
      [...new FormData(form).entries()].filter(([, value]) => !(value instanceof File))
    );
  }

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function dateInputValue(value) {
    if (!value) {
      return "";
    }
    return String(value).slice(0, 10);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image.")));
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file) {
    const dataUrl = await fileToDataUrl(file);
    return window.GymApi.request("/api/v1/admin/uploads/images", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        dataUrl
      })
    });
  }

  function siteImagePayload(form) {
    const payload = formPayload(form);
    return {
      logoUrl: imageUrl(payload.logoUrl),
      homeHeroImageUrl: imageUrl(payload.homeHeroImageUrl),
      homeHeroFallbackImageUrl: imageUrl(payload.homeHeroFallbackImageUrl),
      authHeroImageUrl: imageUrl(payload.authHeroImageUrl),
      authHeroFallbackImageUrl: imageUrl(payload.authHeroFallbackImageUrl),
      socialShareImageUrl: imageUrl(payload.socialShareImageUrl)
    };
  }

  function planPayload(form) {
    const payload = formPayload(form);
    const price = numberValue(payload.price);
    const originalPrice = numberValue(payload.originalPrice, price);
    const displayOrder = numberValue(payload.displayOrder);

    return {
      id: String(payload.id || "").trim(),
      nameEn: String(payload.nameEn || "").trim(),
      nameAr: String(payload.nameAr || "").trim(),
      descriptionEn: String(payload.descriptionEn || "").trim(),
      descriptionAr: String(payload.descriptionAr || "").trim(),
      durationDays: numberValue(payload.durationDays, 30),
      bonusDays: numberValue(payload.bonusDays),
      price,
      priceDiscounted: price,
      originalPrice,
      priceOriginal: originalPrice,
      displayOrder,
      sortOrder: displayOrder,
      currency: payload.currency || "SAR",
      isFeatured: Boolean(form.elements.isFeatured?.checked),
      highlighted: Boolean(form.elements.isFeatured?.checked),
      isActive: Boolean(form.elements.isActive?.checked),
      featuresEn: [],
      featuresAr: []
    };
  }

  function resetPlanForm() {
    const form = document.querySelector("#planForm");
    if (!form) {
      return;
    }
    form.reset();
    form.elements.id.value = "";
    form.elements.currency.value = "SAR";
    form.elements.durationDays.value = "30";
    form.elements.bonusDays.value = "0";
    form.elements.displayOrder.value = "0";
    form.elements.isActive.checked = true;
    form.elements.isFeatured.checked = false;
    document.querySelector("#planSubmitButton").textContent = t("admin.savePlan");
    document.querySelector("#planCancelEdit")?.setAttribute("hidden", "");
  }

  function findPlan(planId) {
    return (state.plans.length ? state.plans : state.publicData.plans || []).find(
      (plan) => String(plan.id) === String(planId)
    );
  }

  function editPlan(plan) {
    const form = document.querySelector("#planForm");
    if (!form || !plan) {
      return;
    }

    form.elements.id.value = plan.id || "";
    form.elements.nameEn.value = plan.name?.en || "";
    form.elements.nameAr.value = plan.name?.ar || "";
    form.elements.descriptionEn.value = plan.description?.en || "";
    form.elements.descriptionAr.value = plan.description?.ar || "";
    form.elements.durationDays.value = plan.durationDays || 30;
    form.elements.bonusDays.value = plan.bonusDays || 0;
    form.elements.price.value = plan.priceDiscounted ?? plan.price ?? "";
    form.elements.originalPrice.value = plan.priceOriginal ?? plan.originalPrice ?? plan.price ?? "";
    form.elements.displayOrder.value = plan.displayOrder ?? plan.sortOrder ?? 0;
    form.elements.currency.value = plan.currency || "SAR";
    form.elements.isFeatured.checked = Boolean(plan.isFeatured || plan.highlighted);
    form.elements.isActive.checked = plan.isActive !== false;

    document.querySelector("#planSubmitButton").textContent = "تحديث الباقة";
    document.querySelector("#planCancelEdit")?.removeAttribute("hidden");
    setMessage("#planMessage", `تعديل الباقة رقم ${plan.id}`, true);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function offerPayload(form) {
    const payload = formPayload(form);
    return {
      id: String(payload.id || "").trim(),
      titleEn: String(payload.titleEn || "").trim(),
      titleAr: String(payload.titleAr || "").trim(),
      badgeEn: String(payload.badgeEn || "").trim(),
      badgeAr: String(payload.badgeAr || "").trim(),
      bodyEn: String(payload.bodyEn || "").trim(),
      bodyAr: String(payload.bodyAr || "").trim(),
      validUntil: payload.validUntil,
      imageUrl: imageUrl(payload.imageUrl),
      discountValue: numberValue(payload.discountValue),
      sortOrder: numberValue(payload.sortOrder),
      isActive: Boolean(form.elements.isActive?.checked)
    };
  }

  function resetOfferForm() {
    const form = document.querySelector("#offerForm");
    if (!form) {
      return;
    }
    form.reset();
    form.elements.id.value = "";
    form.elements.discountValue.value = "0";
    form.elements.sortOrder.value = "0";
    form.elements.isActive.checked = true;
    document.querySelector("#offerSubmitButton").textContent = t("admin.saveOffer");
    document.querySelector("#offerCancelEdit")?.setAttribute("hidden", "");
  }

  function findOffer(offerId) {
    return (state.offers.length ? state.offers : state.publicData.offers || []).find(
      (offer) => String(offer.id) === String(offerId)
    );
  }

  function editOffer(offer) {
    const form = document.querySelector("#offerForm");
    if (!form || !offer) {
      return;
    }
    form.elements.id.value = offer.id || "";
    form.elements.titleEn.value = offer.title?.en || "";
    form.elements.titleAr.value = offer.title?.ar || "";
    form.elements.badgeEn.value = offer.badge?.en || "";
    form.elements.badgeAr.value = offer.badge?.ar || "";
    form.elements.bodyEn.value = offer.body?.en || offer.description?.en || "";
    form.elements.bodyAr.value = offer.body?.ar || offer.description?.ar || "";
    form.elements.validUntil.value = dateInputValue(offer.validUntil || offer.endDate || offer.expiresAt);
    form.elements.imageUrl.value = offer.imageUrl || "";
    form.elements.discountValue.value = offer.discountValue || 0;
    form.elements.sortOrder.value = offer.sortOrder || offer.priority || 0;
    form.elements.isActive.checked = offer.isActive !== false;
    document.querySelector("#offerSubmitButton").textContent = "Update offer";
    document.querySelector("#offerCancelEdit")?.removeAttribute("hidden");
    setMessage("#offerMessage", `Editing offer ${offer.id}`, true);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function slidePayload(form) {
    const payload = formPayload(form);
    return {
      id: String(payload.id || "").trim(),
      imageUrl: imageUrl(payload.imageUrl),
      fallbackImageUrl: imageUrl(payload.fallbackImageUrl || payload.imageUrl),
      titleEn: String(payload.titleEn || "").trim(),
      titleAr: String(payload.titleAr || "").trim(),
      bodyEn: String(payload.bodyEn || "").trim(),
      bodyAr: String(payload.bodyAr || "").trim(),
      sortOrder: numberValue(payload.sortOrder),
      isActive: Boolean(form.elements.isActive?.checked)
    };
  }

  function resetSlideForm() {
    const form = document.querySelector("#slideForm");
    if (!form) {
      return;
    }
    form.reset();
    form.elements.id.value = "";
    form.elements.sortOrder.value = "0";
    form.elements.isActive.checked = true;
    document.querySelector("#slideSubmitButton").textContent = "Save slide";
    document.querySelector("#slideCancelEdit")?.setAttribute("hidden", "");
  }

  function findSlide(slideId) {
    return (state.slides.length ? state.slides : state.publicData.slides || []).find(
      (slide) => String(slide.id) === String(slideId)
    );
  }

  function editSlide(slide) {
    const form = document.querySelector("#slideForm");
    if (!form || !slide) {
      return;
    }
    form.elements.id.value = slide.id || "";
    form.elements.imageUrl.value = slide.imageUrl || "";
    form.elements.fallbackImageUrl.value = slide.fallbackImageUrl || slide.imageUrl || "";
    form.elements.titleEn.value = slide.title?.en || "";
    form.elements.titleAr.value = slide.title?.ar || "";
    form.elements.bodyEn.value = slide.body?.en || "";
    form.elements.bodyAr.value = slide.body?.ar || "";
    form.elements.sortOrder.value = slide.sortOrder || 0;
    form.elements.isActive.checked = slide.isActive !== false;
    document.querySelector("#slideSubmitButton").textContent = "Update slide";
    document.querySelector("#slideCancelEdit")?.removeAttribute("hidden");
    setMessage("#slideMessage", `Editing slide ${slide.id}`, true);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setupForms() {
    document.querySelector("#planForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = planPayload(event.currentTarget);
      const isEditing = Boolean(payload.id);
      const planId = encodeURIComponent(payload.id);
      try {
        await window.GymApi.request(isEditing ? `/api/v1/plans/${planId}` : "/api/v1/plans", {
          method: isEditing ? "PUT" : "POST",
          body: JSON.stringify(payload)
        });
        resetPlanForm();
        setMessage("#planMessage", t("form.saved"), true);
        await load();
      } catch (error) {
        setMessage("#planMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#planCancelEdit")?.addEventListener("click", () => {
      resetPlanForm();
      setMessage("#planMessage", "", true);
    });

    document.querySelector("#siteImageForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = await window.GymApi.request("/api/v1/admin/siteImages", {
          method: "POST",
          body: JSON.stringify(siteImagePayload(event.currentTarget))
        });
        state.siteImages = data.siteImages || data;
        state.publicData.siteImages = state.siteImages;
        renderBrand();
        renderSiteImageForm();
        setMessage("#siteImageMessage", "Website images saved.", true);
      } catch (error) {
        setMessage("#siteImageMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#offerForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await window.GymApi.request("/api/v1/admin/offers", {
          method: "POST",
          body: JSON.stringify(offerPayload(event.currentTarget))
        });
        resetOfferForm();
        setMessage("#offerMessage", t("form.saved"), true);
        await load();
      } catch (error) {
        setMessage("#offerMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#offerCancelEdit")?.addEventListener("click", () => {
      resetOfferForm();
      setMessage("#offerMessage", "", true);
    });

    document.querySelector("#slideForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await window.GymApi.request("/api/v1/admin/slides", {
          method: "POST",
          body: JSON.stringify(slidePayload(event.currentTarget))
        });
        resetSlideForm();
        setMessage("#slideMessage", "Slide saved.", true);
        await load();
      } catch (error) {
        setMessage("#slideMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#slideCancelEdit")?.addEventListener("click", () => {
      resetSlideForm();
      setMessage("#slideMessage", "", true);
    });

    document.querySelector("#settingForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await window.GymApi.request("/api/v1/admin/settings", {
          method: "POST",
          body: JSON.stringify(formPayload(event.currentTarget))
        });
        setMessage("#settingMessage", t("form.save"), true);
        await load();
      } catch (error) {
        setMessage("#settingMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#roleForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        ...formPayload(form),
        isActive: Boolean(form.elements.isActive?.checked)
      };
      try {
        const role = await window.GymApi.request("/api/v1/admin/roles", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        state.selectedRoleKey = role.key;
        form.reset();
        form.elements.isActive.checked = true;
        setMessage("#roleMessage", "Saved.", true);
        await load();
      } catch (error) {
        setMessage("#roleMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#rolePermissionForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const roleKey = document.querySelector("#selectedRoleKey")?.value || "";
      const permissionKeys = [...event.currentTarget.querySelectorAll('input[name="permissionKeys"]:checked')].map(
        (input) => input.value
      );
      try {
        await window.GymApi.request("/api/v1/admin/rolePermissions", {
          method: "POST",
          body: JSON.stringify({ roleKey, permissionKeys })
        });
        setMessage("#rbacMessage", "Saved.", true);
        await load();
      } catch (error) {
        setMessage("#rbacMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#adminRoleForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const roleKeys = [...form.elements.roles.selectedOptions].map((option) => option.value);
      try {
        await window.GymApi.request("/api/v1/admin/adminRoleAssignments", {
          method: "POST",
          body: JSON.stringify({ adminId: form.elements.adminId.value, roleKeys })
        });
        form.reset();
        setMessage("#adminRoleMessage", "Saved.", true);
        await load();
      } catch (error) {
        setMessage("#adminRoleMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#aiAssistantForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = formPayload(event.currentTarget);
      try {
        state.aiAnswer = await window.GymApi.request("/api/v1/ai/assistant", {
          method: "POST",
          body: JSON.stringify({ prompt: payload.prompt })
        });
        setMessage("#aiAssistantMessage", "Answered.", true);
        await load();
        renderAiAssistant();
      } catch (error) {
        setMessage("#aiAssistantMessage", error.message || t("admin.readOnly"), false);
      }
    });
  }

  function setupPlanActions() {
    document.querySelector("#planRows")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-plan-action]");
      if (!button) {
        return;
      }

      const plan = findPlan(button.dataset.planId);
      if (!plan) {
        setMessage("#planMessage", "لم يتم العثور على الباقة. حدّث الصفحة وحاول مرة أخرى.", false);
        return;
      }

      if (button.dataset.planAction === "edit") {
        editPlan(plan);
        return;
      }

      if (button.dataset.planAction !== "delete") {
        return;
      }

      const currentPlanName = planName(plan) || `#${plan.id}`;
      if (!window.confirm(`هل تريد حذف ${currentPlanName}؟ ستُزال من الموقع.`)) {
        return;
      }

      button.disabled = true;
      try {
        await window.GymApi.request(`/api/v1/plans/${encodeURIComponent(plan.id)}`, {
          method: "DELETE"
        });
        resetPlanForm();
        setMessage("#planMessage", "تم حذف الباقة.", true);
        await load();
      } catch (error) {
        button.disabled = false;
        setMessage("#planMessage", error.message || "تعذر حذف الباقة.", false);
      }
    });
  }

  function setupImageUploads() {
    document.querySelectorAll("[data-upload-target]").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        const target = document.getElementById(input.dataset.uploadTarget);
        if (!file || !target) {
          return;
        }

        input.disabled = true;
        try {
          const result = await uploadImage(file);
          target.value = result.url;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          if (target.name) {
            updateImageFieldPreview(target.name, result.url);
          }
          const message = input.closest("form")?.querySelector(".form-message");
          if (message) {
            message.textContent = "Image uploaded.";
            message.style.color = "#c8a867";
          }
        } catch (error) {
          const message = input.closest("form")?.querySelector(".form-message");
          if (message) {
            message.textContent = error.message || "Image upload failed.";
            message.style.color = "";
          }
        } finally {
          input.disabled = false;
          input.value = "";
        }
      });
    });

    document.querySelectorAll("#siteImageForm input[type='text'], #siteImageForm input:not([type])").forEach((input) => {
      input.addEventListener("input", () => updateImageFieldPreview(input.name, input.value));
    });
  }

  function setupOfferActions() {
    document.querySelector("#offerRows")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-offer-action]");
      if (!button) {
        return;
      }
      const offer = findOffer(button.dataset.offerId);
      if (!offer) {
        setMessage("#offerMessage", "Offer not found. Refresh and try again.", false);
        return;
      }
      if (button.dataset.offerAction === "edit") {
        editOffer(offer);
      }
    });
  }

  function setupSlideActions() {
    document.querySelector("#sliderRows")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-slide-action]");
      if (!button) {
        return;
      }
      const slide = findSlide(button.dataset.slideId);
      if (!slide) {
        setMessage("#slideMessage", "Slide not found. Refresh and try again.", false);
        return;
      }
      if (button.dataset.slideAction === "edit") {
        editSlide(slide);
      }
    });
  }

  async function updateMessageStatus(messageId, status) {
    await window.GymApi.request(`/api/v1/messages/${encodeURIComponent(messageId)}`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
  }

  async function deleteMessage(messageId) {
    await window.GymApi.request(`/api/v1/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE"
    });
  }

  function setupMessageActions() {
    document.querySelector("#messageRows")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-message-action]");
      if (!button) {
        return;
      }

      const messageId = button.dataset.messageId;
      const action = button.dataset.messageAction;
      const message = (state.messages || []).find((item) => String(item.id) === String(messageId));
      if (!message) {
        setMessage("#messageActionStatus", "لم يتم العثور على الرسالة. حدّث الصفحة وحاول مرة أخرى.", false);
        return;
      }

      if (action === "read") {
        state.selectedMessageId = messageId;
        renderMessageDetail();
        document.querySelector("#messageDetail")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      button.disabled = true;
      try {
        await updateMessageStatus(messageId, action);
        if (state.selectedMessageId === messageId) {
          state.selectedMessageId = null;
        }
        await load();
      } catch (error) {
        button.disabled = false;
        setMessage("#messageActionStatus", error.message || "تعذر تحديث الرسالة.", false);
      }
    });

    document.querySelector("#messageDetail")?.addEventListener("click", async (event) => {
      const closeButton = event.target.closest("[data-message-close]");
      if (closeButton) {
        state.selectedMessageId = null;
        renderMessageDetail();
        return;
      }

      const actionButton = event.target.closest("[data-message-detail-action]");
      if (!actionButton || !state.selectedMessageId) {
        return;
      }

      const action = actionButton.dataset.messageDetailAction;
      if (action === "delete" && !window.confirm("هل تريد حذف هذه الرسالة؟")) {
        return;
      }

      actionButton.disabled = true;
      try {
        if (action === "delete") {
          await deleteMessage(state.selectedMessageId);
          state.selectedMessageId = null;
          await load();
          return;
        }

        await updateMessageStatus(state.selectedMessageId, action);
        setMessage("#messageActionStatus", "تم تحديث الرسالة.", true);
        await load();
      } catch (error) {
        actionButton.disabled = false;
        setMessage("#messageActionStatus", error.message || "تعذر تحديث الرسالة.", false);
      }
    });
  }

  function setupRbacActions() {
    document.querySelector("#roleRows")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-role-select]");
      if (!button) {
        return;
      }
      state.selectedRoleKey = button.dataset.roleSelect;
      renderRbac();
      setMessage("#rbacMessage", "", true);
    });

    document.querySelector("#adminAssignmentRows")?.addEventListener("click", (event) => {
      const row = event.target.closest("tr");
      if (!row) {
        return;
      }
      const cells = row.querySelectorAll("td");
      const form = document.querySelector("#adminRoleForm");
      if (!form || cells.length < 4) {
        return;
      }
      form.elements.adminId.value = cells[0].textContent.trim();
      const currentRoles = cells[3].textContent.split(",").map((role) => role.trim()).filter(Boolean);
      [...form.elements.roles.options].forEach((option) => {
        option.selected = currentRoles.includes(option.value);
      });
    });
  }

  function setupSession() {
    document.querySelector("#adminLogout")?.addEventListener("click", async () => {
      try {
        await window.GymApi.logout(true);
      } catch (_error) {
        window.GymApi.clearSession();
      }
      window.location.href = "/";
    });
  }

  function setupSidebar() {
    const sidebar = document.querySelector(".admin-sidebar");
    const toggle = document.querySelector(".admin-sidebar-toggle");
    toggle?.addEventListener("click", () => {
      const isOpen = sidebar.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  function init() {
    setupSidebar();
    setupTabs();
    setupForms();
    setupPlanActions();
    setupImageUploads();
    setupOfferActions();
    setupSlideActions();
    setupMessageActions();
    setupRbacActions();
    setupSession();
    load();
    window.addEventListener("languagechange", renderAll);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
