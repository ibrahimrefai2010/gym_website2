(function adminDashboard() {
  const state = {
    me: null,
    branches: [],
    overview: null,
    publicData: window.GYM_DEFAULT_DATA,
    plans: [],
    offers: [],
    siteImages: null,
    slides: [],
    messages: { items: [], pagination: {} },
    messageFilters: { status: "", leadStatus: "", assignedTo: "", search: "" },
    leadNotes: [],
    rbac: { roles: [], permissions: [], assignments: [] },
    reportSummary: null,
    aiAnswer: null,
    selectedRoleKey: null,
    selectedMessageId: null,
    tasks: { items: [], pagination: {} },
    taskFilters: { status: "", priority: "", assignedTo: "", dueBefore: "" },
    taskMyTasksOnly: false
  };

  const VIEW_BRANCH_STORAGE_KEY = "admin.viewBranchId";

  function getStoredViewBranchId() {
    try {
      return window.localStorage.getItem(VIEW_BRANCH_STORAGE_KEY) || "";
    } catch (_error) {
      return "";
    }
  }

  function setStoredViewBranchId(branchId) {
    try {
      if (branchId) {
        window.localStorage.setItem(VIEW_BRANCH_STORAGE_KEY, String(branchId));
      } else {
        window.localStorage.removeItem(VIEW_BRANCH_STORAGE_KEY);
      }
    } catch (_error) {
      // Private-window/blocked storage: the switcher still works for this
      // page load, it just won't persist across reloads.
    }
  }

  // Client-side convenience only -- decides whether to *show* the switcher.
  // The real enforcement is 100% server-side (src/security/branchAccess.js);
  // an admin who fails this check and forges the request anyway still only
  // ever gets their own branch's data back.
  function canSwitchBranchesClientSide() {
    if (!state.me) {
      return false;
    }
    if (state.me.role === "super_admin") {
      return true;
    }
    const assignment = (state.rbac?.assignments || []).find(
      (item) => String(item.adminId) === String(state.me.id)
    );
    if (!assignment || !assignment.roleKeys?.length) {
      return false;
    }
    return (state.rbac?.roles || []).some(
      (role) => assignment.roleKeys.includes(role.key) && (role.permissionKeys || []).includes("branches:manage")
    );
  }

  // Two distinct, accessible colors: gold for the Main branch (matches the
  // existing brand accent), rose for the Women's branch. Any future branch
  // code falls back to the neutral badge style.
  const BRANCH_BADGE_CLASS = {
    main: "branch-badge--main",
    women: "branch-badge--women"
  };

  // Used to enrich confirm() dialogs (plan delete, message delete) with the
  // branch name of the record being acted on.
  function branchNameForId(branchId) {
    if (branchId == null) {
      return "";
    }
    const fromList = state.branches.find((item) => String(item.id) === String(branchId));
    if (fromList) {
      return localize(fromList.name);
    }
    if (state.me?.branchId != null && String(state.me.branchId) === String(branchId) && state.me.branchName) {
      return localize(state.me.branchName);
    }
    return "";
  }

  function currentBranchLabel() {
    const branchId = getStoredViewBranchId();
    if (branchId && canSwitchBranchesClientSide()) {
      const branch = state.branches.find((item) => String(item.id) === String(branchId));
      if (branch) {
        return branch;
      }
    }
    if (state.me?.branchName) {
      return { id: state.me.branchId, code: state.me.branchCode, name: state.me.branchName };
    }
    return null;
  }

  function renderBranchUi() {
    const badge = document.querySelector("#branchBadge");
    const switcherWrap = document.querySelector("#branchSwitcherWrap");
    const switcher = document.querySelector("#branchSwitcher");
    if (!badge || !state.me) {
      return;
    }

    const branch = currentBranchLabel();
    badge.textContent = branch ? localize(branch.name) : "";
    badge.className = "branch-badge " + (BRANCH_BADGE_CLASS[branch?.code] || "branch-badge--neutral");
    badge.hidden = !branch;

    const canSwitch = canSwitchBranchesClientSide();
    if (switcherWrap) {
      switcherWrap.hidden = !canSwitch;
    }
    if (switcher && canSwitch) {
      const selected = getStoredViewBranchId() || String(state.me.branchId || "");
      switcher.innerHTML = state.branches
        .map((item) => `<option value="${item.id}">${localize(item.name)}</option>`)
        .join("");
      switcher.value = selected;
    }

    document.querySelectorAll("[data-branch-field]").forEach((select) => {
      if (canSwitch) {
        // Preserve an in-progress edit's selection (editPlan/editOffer set
        // .value directly); otherwise default a fresh form to whichever
        // branch is currently being viewed.
        const previousValue = select.value;
        select.innerHTML = state.branches
          .map((item) => `<option value="${item.id}">${localize(item.name)}</option>`)
          .join("");
        select.value =
          previousValue && state.branches.some((item) => String(item.id) === previousValue)
            ? previousValue
            : getStoredViewBranchId() || String(state.me.branchId || "");
        select.closest("[data-branch-field-wrap]")?.removeAttribute("hidden");
        select.disabled = false;
      } else {
        select.innerHTML = state.me.branchName
          ? `<option value="${state.me.branchId}">${localize(state.me.branchName)}</option>`
          : "";
        if (state.me.branchId) {
          select.value = String(state.me.branchId);
        }
        select.disabled = true;
      }
    });
  }

  async function loadBranchesIfNeeded() {
    if (!canSwitchBranchesClientSide()) {
      state.branches = [];
      return;
    }
    try {
      const data = await window.GymApi.request("/api/v1/branches?pageSize=100");
      state.branches = (data?.items || []).filter((branch) => branch.status === "active");
    } catch (_error) {
      state.branches = [];
    }
  }

  function setupBranchSwitcher() {
    document.querySelector("#branchSwitcher")?.addEventListener("change", async (event) => {
      setStoredViewBranchId(event.target.value);
      await load();
    });
  }

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
    info: "معلومة",
    open: "مفتوحة",
    in_progress: "قيد التنفيذ",
    done: "مكتملة",
    low: "منخفضة",
    medium: "متوسطة",
    high: "عالية",
    urgent: "عاجلة",
    new: "جديد",
    contacted: "تم التواصل",
    converted: "محوّل",
    rejected: "مرفوض"
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
    renderMembers();
  }

  function renderMembers() {
    const data = state.members || { items: [], pagination: {} };
    const items = data.items || [];
    if (!items.length) {
      setHtml("#adminUsers", `<tr><td colspan="6">${escapeHtml(t("admin.memberNone"))}</td></tr>`);
      setHtml("#memberPager", "");
      return;
    }
    setHtml(
      "#adminUsers",
      items
        .map(
          (member) => `
            <tr data-member-id="${escapeHtml(member.id)}" tabindex="0">
              <td>${escapeHtml(member.memberCode || member.member_code || "—")}</td>
              <td>${escapeHtml(member.fullName)}</td>
              <td>${escapeHtml(member.email)}</td>
              <td>${escapeHtml(member.phone || "")}</td>
              <td>${escapeHtml(member.membershipPlan || member.membership || "—")}</td>
              <td>${escapeHtml(statusLabel(member.status))}</td>
            </tr>`
        )
        .join("")
    );

    const page = data.pagination?.page || 1;
    const total = data.pagination?.total || items.length;
    const pageSize = data.pagination?.pageSize || 20;
    const pages = Math.max(Math.ceil(total / pageSize), 1);
    setHtml(
      "#memberPager",
      pages > 1
        ? `<button class="btn small secondary" type="button" data-member-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${escapeHtml(t("portal.prev"))}</button>
           <span>${escapeHtml(t("portal.pageLabel").replace("{n}", page))} / ${pages}</span>
           <button class="btn small secondary" type="button" data-member-page="${page + 1}" ${page >= pages ? "disabled" : ""}>${escapeHtml(t("portal.next"))}</button>`
        : ""
    );
  }

  async function loadMembers(page = 1) {
    const f = state.memberFilters || {};
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (f.search) params.set("search", f.search);
    if (f.status) params.set("status", f.status);
    if (f.membershipStatus) params.set("membershipStatus", f.membershipStatus);
    try {
      state.members = await window.GymApi.request(`/api/v1/customers?${params.toString()}`);
      state.membersMode = "full";
    } catch (_error) {
      try {
        const basic = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (f.search) basic.set("search", f.search);
        if (f.status) basic.set("status", f.status);
        state.members = await window.GymApi.request(`/api/v1/users?${basic.toString()}`);
        state.membersMode = "basic";
      } catch (_error2) {
        state.members = { items: [], pagination: {} };
      }
    }
    renderMembers();
  }

  async function loadMemberDetail(memberId) {
    const panel = document.querySelector("#memberDetail");
    if (!panel || state.membersMode === "basic") {
      return;
    }
    panel.hidden = false;
    setMessage("#memberDetailMessage", t("portal.loading"), true);
    try {
      const detail = await window.GymApi.request(`/api/v1/customers/${encodeURIComponent(memberId)}`);
      const c = detail.customer || {};
      const p = detail.profile || {};
      document.querySelector("#memberDetailName").textContent = c.fullName || "—";
      const avatar = document.querySelector("#memberDetailAvatar");
      if (avatar) {
        avatar.innerHTML = c.hasAvatar
          ? `<img src="/api/v1/users/${encodeURIComponent(memberId)}/avatar?t=${Date.now()}" alt="">`
          : "";
        avatar.textContent = c.hasAvatar ? "" : (c.fullName || "?").trim().slice(0, 2).toUpperCase();
      }
      const rows = [
        [t("portal.field.memberId"), c.memberCode || "—"],
        [t("field.email"), c.email || "—"],
        [t("field.phone"), c.phone || "—"],
        [t("portal.field.nationalId"), p.nationalId || "—"],
        [t("portal.field.dob"), formatDate(c.birthDate) || "—"],
        [t("portal.field.gender"), c.gender && c.gender !== "unspecified" ? t(`option.${c.gender}`) : "—"],
        [t("portal.field.nationality"), c.nationality || "—"],
        [t("portal.field.city"), c.city || "—"],
        [t("table.status"), statusLabel(c.status)],
        [t("portal.field.registered"), formatDate(c.createdAt)]
      ];
      setHtml(
        "#memberDetailInfo",
        rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")
      );
      setHtml(
        "#memberDetailMemberships",
        (detail.memberships || []).length
          ? detail.memberships
              .map(
                (m) =>
                  `<tr><td>${escapeHtml(m.plan_name || m.plan || "—")}</td><td>${formatDate(m.start_date)}</td><td>${formatDate(m.end_date)}</td><td>${escapeHtml(statusLabel(m.status))}</td></tr>`
              )
              .join("")
          : `<tr><td>${escapeHtml(t("portal.membership.noHistory"))}</td></tr>`
      );
      setHtml(
        "#memberDetailPayments",
        (detail.payments || []).length
          ? detail.payments
              .map(
                (pay) =>
                  `<tr><td>${escapeHtml(money(pay.amount, pay.currency))}</td><td>${escapeHtml(pay.payment_method || "—")}</td><td>${escapeHtml(statusLabel(pay.status))}</td><td>${formatDate(pay.completed_at || pay.created_at)}</td></tr>`
              )
              .join("")
          : `<tr><td>${escapeHtml(t("portal.payments.none"))}</td></tr>`
      );
      const contacts = detail.emergencyContacts || [];
      setHtml(
        "#memberDetailEmergency",
        contacts.length
          ? contacts
              .map(
                (ct) =>
                  `<div><dt>${escapeHtml(ct.name)}${ct.relationship ? ` (${escapeHtml(ct.relationship)})` : ""}</dt><dd>${escapeHtml(ct.phone)}</dd></div>`
              )
              .join("")
          : `<div><dt>—</dt><dd>${escapeHtml(t("portal.emergency.none"))}</dd></div>`
      );
      setMessage("#memberDetailMessage", "", true);
    } catch (error) {
      setMessage("#memberDetailMessage", error.message, false);
    }
  }

  function setupMembers() {
    state.memberFilters = { search: "", status: "", membershipStatus: "" };

    document.querySelector("#memberFilterForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.memberFilters = {
        search: document.querySelector("#memberSearch")?.value.trim() || "",
        status: document.querySelector("#memberStatusFilter")?.value || "",
        membershipStatus: document.querySelector("#memberMembershipFilter")?.value || ""
      };
      loadMembers(1);
    });

    document.querySelector("#adminUsers")?.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-member-id]");
      if (row) {
        loadMemberDetail(row.dataset.memberId);
      }
    });
    document.querySelector("#adminUsers")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      const row = event.target.closest("tr[data-member-id]");
      if (row) {
        loadMemberDetail(row.dataset.memberId);
      }
    });

    document.querySelector("#memberPager")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-member-page]");
      if (button && !button.disabled) {
        loadMembers(Number(button.dataset.memberPage));
      }
    });

    document.querySelector("#memberDetailClose")?.addEventListener("click", () => {
      const panel = document.querySelector("#memberDetail");
      if (panel) {
        panel.hidden = true;
      }
    });
  }

  function setupTasks() {
    document.querySelector("#taskFilterForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.taskFilters = {
        status: document.querySelector("#taskStatusFilter")?.value || "",
        priority: document.querySelector("#taskPriorityFilter")?.value || "",
        assignedTo: document.querySelector("#taskAssigneeFilter")?.value || "",
        dueBefore: document.querySelector("#taskDueBeforeFilter")?.value || ""
      };
      loadTasks(1);
    });

    document.querySelector("#taskMyTasksToggle")?.addEventListener("click", (event) => {
      state.taskMyTasksOnly = !state.taskMyTasksOnly;
      event.currentTarget.classList.toggle("is-active", state.taskMyTasksOnly);
      loadTasks(1);
    });

    document.querySelector("#taskPager")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-task-page]");
      if (button && !button.disabled) {
        loadTasks(Number(button.dataset.taskPage));
      }
    });

    document.querySelector("#taskRows")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-task-action]");
      if (!button) {
        return;
      }
      const task = findTask(button.dataset.taskId);
      if (!task) {
        setMessage("#taskMessage", "Task not found. Refresh and try again.", false);
        return;
      }
      const action = button.dataset.taskAction;

      if (action === "edit") {
        editTask(task);
        return;
      }

      if (action === "cancel") {
        if (!window.confirm(t("admin.tasks.confirmCancel"))) {
          return;
        }
        try {
          await window.GymApi.request(`/api/v1/tasks/${encodeURIComponent(task.id)}/cancel`, { method: "PATCH" });
          await loadTasks(state.tasks.pagination?.page || 1);
          setMessage("#taskMessage", t("form.saved"), true);
        } catch (error) {
          setMessage("#taskMessage", error.message || t("admin.readOnly"), false);
        }
        return;
      }

      if (action === "close") {
        // Lightweight prompt for an optional outcome note, matching this
        // codebase's existing window.confirm-adjacent interaction style
        // (see plan/message delete confirmations) rather than a modal.
        const outcomeNote = window.prompt(t("admin.tasks.outcomePrompt"), "");
        if (outcomeNote === null) {
          return; // user cancelled the prompt
        }
        try {
          await window.GymApi.request(`/api/v1/tasks/${encodeURIComponent(task.id)}/close`, {
            method: "PATCH",
            body: JSON.stringify({ outcomeNote: outcomeNote.trim() || undefined })
          });
          await loadTasks(state.tasks.pagination?.page || 1);
          setMessage("#taskMessage", t("form.saved"), true);
        } catch (error) {
          setMessage("#taskMessage", error.message || t("admin.readOnly"), false);
        }
      }
    });

    document.querySelector("#taskForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = taskPayload(event.currentTarget);
      const isEditing = Boolean(payload.id);
      const taskId = encodeURIComponent(payload.id);
      try {
        await window.GymApi.request(isEditing ? `/api/v1/tasks/${taskId}` : "/api/v1/tasks", {
          method: isEditing ? "PATCH" : "POST",
          body: JSON.stringify(payload)
        });
        resetTaskForm();
        setMessage("#taskMessage", t("form.saved"), true);
        await loadTasks(state.tasks.pagination?.page || 1);
        renderTaskWidget();
      } catch (error) {
        setMessage("#taskMessage", error.message || t("admin.readOnly"), false);
      }
    });

    document.querySelector("#taskCancelEdit")?.addEventListener("click", () => {
      resetTaskForm();
      setMessage("#taskMessage", "", true);
    });
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

  function renderTaskWidget() {
    const tasks = state.overview?.tasks || { byPriority: {}, overdue: 0 };
    const byPriority = tasks.byPriority || {};
    const priorityKeyMap = {
      low: "admin.tasks.priorityLow",
      medium: "admin.tasks.priorityMedium",
      high: "admin.tasks.priorityHigh",
      urgent: "admin.tasks.priorityUrgent"
    };
    setHtml(
      "#taskWidgetStats",
      Object.entries(priorityKeyMap)
        .map(
          ([priority, key]) => `
            <article class="metric-card">
              <span>${escapeHtml(t(key))}</span>
              <strong>${escapeHtml(String(byPriority[priority] || 0))}</strong>
            </article>
          `
        )
        .join("")
    );
    const badge = document.querySelector("#taskWidgetOverdueBadge");
    if (badge) {
      badge.textContent = `${tasks.overdue || 0} ${t("admin.tasks.overdue")}`;
    }
  }

  // Shared by the Tasks assignee dropdowns and the Leads/CRM assignee
  // dropdowns -- same data source (state.overview.adminAccounts), same
  // "<option>" shape, just rendered into different <select> elements.
  function adminAccountOptionsHtml() {
    const accounts = state.overview?.adminAccounts || [];
    return accounts
      .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.username || account.email)}</option>`)
      .join("");
  }

  function renderTaskAssigneeOptions() {
    const options = adminAccountOptionsHtml();

    const filterSelect = document.querySelector("#taskAssigneeFilter");
    if (filterSelect) {
      const previous = filterSelect.value;
      filterSelect.innerHTML = `<option value="">${escapeHtml(t("admin.tasks.anyAssignee"))}</option>${options}`;
      filterSelect.value = previous;
    }

    const formSelect = document.querySelector("#taskAssignedTo");
    if (formSelect) {
      const previous = formSelect.value;
      formSelect.innerHTML = `<option value="">${escapeHtml(t("admin.tasks.unassigned"))}</option>${options}`;
      formSelect.value = previous;
    }
  }

  function renderLeadAssigneeOptions() {
    const options = adminAccountOptionsHtml();

    const filterSelect = document.querySelector("#leadAssigneeFilter");
    if (filterSelect) {
      const previous = filterSelect.value;
      filterSelect.innerHTML = `<option value="">${escapeHtml(t("admin.tasks.anyAssignee"))}</option>${options}`;
      filterSelect.value = previous;
    }

    const detailSelect = document.querySelector("#leadAssigneeSelect");
    if (detailSelect) {
      const previous = detailSelect.value;
      detailSelect.innerHTML = `<option value="">${escapeHtml(t("admin.tasks.unassigned"))}</option>${options}`;
      detailSelect.value = previous;
    }
  }

  function renderTasks() {
    const data = state.tasks || { items: [], pagination: {} };
    const items = data.items || [];
    if (!items.length) {
      setHtml("#taskRows", `<tr><td colspan="7">${escapeHtml(t("admin.tasks.none"))}</td></tr>`);
      setHtml("#taskPager", "");
      return;
    }
    setHtml(
      "#taskRows",
      items
        .map((task) => {
          const canAct = task.status === "open" || task.status === "in_progress";
          return `
            <tr>
              <td>${escapeHtml(task.id)}</td>
              <td>${escapeHtml(task.title)}</td>
              <td>${escapeHtml(task.assignedToName || t("admin.tasks.unassigned"))}</td>
              <td>${escapeHtml(statusLabel(task.priority))}</td>
              <td>${escapeHtml(statusLabel(task.status))}</td>
              <td>${task.dueDate ? formatDate(task.dueDate) : "—"}</td>
              <td>
                <div class="row-actions">
                  <button class="btn small secondary" type="button" data-task-action="edit" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t("admin.tasks.edit"))}</button>
                  ${canAct ? `<button class="btn small secondary" type="button" data-task-action="close" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t("admin.tasks.close"))}</button>` : ""}
                  ${canAct ? `<button class="btn small danger" type="button" data-task-action="cancel" data-task-id="${escapeHtml(task.id)}">${escapeHtml(t("admin.tasks.cancel"))}</button>` : ""}
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    );

    const page = data.pagination?.page || 1;
    const total = data.pagination?.total || items.length;
    const pageSize = data.pagination?.pageSize || 20;
    const pages = Math.max(Math.ceil(total / pageSize), 1);
    setHtml(
      "#taskPager",
      pages > 1
        ? `<button class="btn small secondary" type="button" data-task-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${escapeHtml(t("portal.prev"))}</button>
           <span>${escapeHtml(t("portal.pageLabel").replace("{n}", page))} / ${pages}</span>
           <button class="btn small secondary" type="button" data-task-page="${page + 1}" ${page >= pages ? "disabled" : ""}>${escapeHtml(t("portal.next"))}</button>`
        : ""
    );
  }

  async function loadTasks(page = 1) {
    const f = state.taskFilters || {};
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (f.status) params.set("status", f.status);
    if (f.priority) params.set("priority", f.priority);
    if (f.dueBefore) params.set("dueBefore", f.dueBefore);
    // "My Tasks" quick filter overrides the assignee dropdown while active.
    if (state.taskMyTasksOnly && state.me?.id) {
      params.set("assignedTo", state.me.id);
    } else if (f.assignedTo) {
      params.set("assignedTo", f.assignedTo);
    }
    try {
      state.tasks = await window.GymApi.request(`/api/v1/tasks?${params.toString()}`);
    } catch (_error) {
      state.tasks = { items: [], pagination: {} };
    }
    renderTasks();
  }

  // Reception check-in (Part 2). The station sends whatever was scanned or
  // typed; the server decides whether it is a card QR token or a manual
  // member code/phone/email lookup (see checkinService.resolveMember), and
  // always scopes to the current branch server-side.
  const CARD_TOKEN_PATTERN = /^[a-f0-9]{32}$|[?&]t=[a-f0-9]{32}/i;
  let checkinResultTimer = null;

  function formatTime(value) {
    if (!value) {
      return "—";
    }
    return new Intl.DateTimeFormat(window.GymI18n.currentLang() === "ar" ? "ar-SA" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Riyadh"
    }).format(new Date(value));
  }

  function checkinMethodLabel(method) {
    return method === "qr" ? t("admin.checkin.methodQr") : t("admin.checkin.methodManual");
  }

  function showCheckinResult(result) {
    const node = document.querySelector("#checkinResult");
    if (!node) {
      return;
    }
    clearTimeout(checkinResultTimer);
    if (result.allowed) {
      const plan = result.membership?.plan ? localize(result.membership.plan) : "";
      const until = result.membership?.endDate
        ? t("admin.checkin.validUntil").replace("{date}", formatDate(result.membership.endDate))
        : "";
      node.className = "checkin-result is-allowed";
      node.innerHTML = `
        <strong>${escapeHtml(t("admin.checkin.welcome").replace("{name}", result.member?.fullName || ""))}</strong>
        <span>${escapeHtml([result.member?.memberCode, plan, until].filter(Boolean).join(" · "))}</span>
        ${result.duplicate ? `<span>${escapeHtml(t("admin.checkin.already"))}</span>` : ""}
      `;
    } else {
      node.className = "checkin-result is-denied";
      node.innerHTML = `
        <strong>${escapeHtml(t("admin.checkin.denied"))}</strong>
        <span>${escapeHtml(t(`admin.checkin.reason.${result.reason}`))}</span>
        ${result.member?.fullName ? `<span>${escapeHtml([result.member.fullName, result.member.memberCode].filter(Boolean).join(" · "))}</span>` : ""}
      `;
    }
    node.hidden = false;
    checkinResultTimer = setTimeout(() => {
      node.hidden = true;
    }, 8000);
  }

  function renderCheckin() {
    const data = state.checkin;
    if (!data) {
      return;
    }
    const summary = data.summary || { today: 0, week: 0, month: 0 };
    setHtml(
      "#checkinStats",
      [
        ["admin.checkin.statToday", summary.today],
        ["admin.checkin.statWeek", summary.week],
        ["admin.checkin.statMonth", summary.month]
      ]
        .map(([key, value]) => `<div class="checkin-stat"><span>${escapeHtml(t(key))}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join("")
    );

    const log = data.log || [];
    setHtml(
      "#checkinRows",
      log.length
        ? log
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.customer)}</td>
                  <td>${escapeHtml(row.member_code || "—")}</td>
                  <td>${escapeHtml(formatTime(row.check_in_at))}</td>
                  <td>${escapeHtml(formatTime(row.check_out_at))}</td>
                  <td>${escapeHtml(checkinMethodLabel(row.method))}</td>
                  <td>${
                    row.status === "checked_in"
                      ? `<button class="btn small secondary" type="button" data-checkout-id="${escapeHtml(row.id)}" data-checkout-name="${escapeHtml(row.customer)}">${escapeHtml(t("admin.checkin.checkOut"))}</button>`
                      : ""
                  }</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="6">${escapeHtml(t("admin.checkin.none"))}</td></tr>`
    );

    renderCheckinHeatmap(data.heatmap || []);
  }

  function renderCheckinHeatmap(cells) {
    if (!cells.length) {
      setHtml("#checkinHeatmap", `<p class="muted">${escapeHtml(t("admin.checkin.heatmapEmpty"))}</p>`);
      return;
    }
    const counts = new Map(cells.map((cell) => [`${cell.day_of_week}-${cell.hour_of_day}`, Number(cell.total)]));
    const max = Math.max(...counts.values(), 1);
    const dayFormat = new Intl.DateTimeFormat(window.GymI18n.currentLang() === "ar" ? "ar-SA" : "en-US", {
      weekday: "short",
      timeZone: "UTC"
    });
    // 2024-01-07 is a Sunday = MySQL DAYOFWEEK() 1.
    const dayName = (dow) => dayFormat.format(new Date(Date.UTC(2024, 0, 6 + dow)));
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    const header = `<tr><th></th>${hours.map((hour) => `<th scope="col">${hour}</th>`).join("")}</tr>`;
    const body = [1, 2, 3, 4, 5, 6, 7]
      .map((dow) => {
        const row = hours
          .map((hour) => {
            const value = counts.get(`${dow}-${hour}`) || 0;
            const level = value ? Math.max(0.12, value / max) : 0;
            return `<td style="--heat:${level.toFixed(2)}" title="${escapeHtml(`${dayName(dow)} ${hour}:00 — ${value}`)}">${value || ""}</td>`;
          })
          .join("");
        return `<tr><th scope="row">${escapeHtml(dayName(dow))}</th>${row}</tr>`;
      })
      .join("");
    setHtml("#checkinHeatmap", `<table class="heatmap-table">${header}${body}</table>`);
  }

  async function loadCheckin() {
    try {
      const [log, summary, heatmap] = await Promise.all([
        window.GymApi.request("/api/v1/attendance/daily-log"),
        window.GymApi.request("/api/v1/attendance/summary"),
        window.GymApi.request("/api/v1/attendance/heatmap")
      ]);
      state.checkin = { log, summary, heatmap };
    } catch (_error) {
      // No checkin:manage / attendance:manage permission -- leave the section empty.
      state.checkin = null;
    }
    renderCheckin();
  }

  function exportCheckinCsv() {
    const log = state.checkin?.log || [];
    const header = [t("table.member"), t("admin.checkin.memberCode"), t("admin.checkin.checkInAt"), t("admin.checkin.checkOutAt"), t("admin.checkin.method")];
    const rows = log.map((row) => [row.customer, row.member_code || "", row.check_in_at || "", row.check_out_at || "", row.method]);
    const csv = [header, ...rows]
      .map((cells) => cells.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    // BOM so Excel opens Arabic names correctly.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `check-ins-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function setupCheckin() {
    const form = document.querySelector("#checkinForm");
    const input = document.querySelector("#checkinInput");
    const submit = document.querySelector("#checkinSubmit");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value || submit.disabled) {
        return;
      }
      const isCard = CARD_TOKEN_PATTERN.test(value);
      submit.disabled = true;
      submit.textContent = t("admin.checkin.checking");
      setMessage("#checkinMessage", "", true);
      try {
        const result = await window.GymApi.request("/api/v1/attendance/check-in", {
          method: "POST",
          body: JSON.stringify(isCard ? { code: value, method: "qr" } : { query: value, method: "manual" })
        });
        showCheckinResult(result);
        if (result.allowed && !result.duplicate) {
          loadCheckin();
        }
      } catch (error) {
        setMessage("#checkinMessage", error.message || t("admin.checkin.error"), false);
      } finally {
        submit.disabled = false;
        submit.textContent = t("admin.checkin.submit");
        input.value = "";
        input.focus();
      }
    });

    document.querySelector("#checkinFullscreen")?.addEventListener("click", () => {
      const station = document.querySelector("#checkinStation");
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        station?.requestFullscreen?.().then(() => input?.focus());
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const button = document.querySelector("#checkinFullscreen");
      if (button) {
        button.textContent = t(document.fullscreenElement ? "admin.checkin.exitFullscreen" : "admin.checkin.fullscreen");
      }
    });

    document.querySelector("#checkinRefresh")?.addEventListener("click", () => loadCheckin());
    document.querySelector("#checkinExport")?.addEventListener("click", exportCheckinCsv);

    document.querySelector("#checkinRows")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-checkout-id]");
      if (!button || button.disabled) {
        return;
      }
      const branch = currentBranchLabel();
      const prompt = t("admin.checkin.confirmCheckOut")
        .replace("{name}", button.dataset.checkoutName || "")
        .replace("{branch}", branch ? localize(branch.name) : "");
      if (!window.confirm(prompt)) {
        return;
      }
      button.disabled = true;
      try {
        await window.GymApi.request(`/api/v1/attendance/${encodeURIComponent(button.dataset.checkoutId)}/check-out`, { method: "PATCH" });
        await loadCheckin();
      } catch (error) {
        button.disabled = false;
        setMessage("#checkinMessage", error.message || t("admin.checkin.error"), false);
      }
    });

    // Focus the scan field whenever the reception tab is opened, so a
    // handheld scanner (keyboard wedge: types the code + Enter) works at once.
    document.querySelector('[data-admin-tab="checkin"]')?.addEventListener("click", () => {
      setTimeout(() => input?.focus(), 0);
    });
  }


  // Payments & invoicing (Part 2 §2.0.5). Every request is scoped server-side
  // to the current branch (switcher header for super_admin, fixed home
  // branch otherwise); the UI never sends a branch id itself.
  function formFilters(form) {
    return Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => String(value).trim() !== ""));
  }

  function pagerHtml(data, attr) {
    const page = data.pagination?.page || 1;
    const total = data.pagination?.total || 0;
    const pageSize = data.pagination?.pageSize || 20;
    const pages = Math.max(Math.ceil(total / pageSize), 1);
    if (pages <= 1) {
      return "";
    }
    return `<button class="btn small secondary" type="button" ${attr}="${page - 1}" ${page <= 1 ? "disabled" : ""}>${escapeHtml(t("portal.prev"))}</button>
      <span>${escapeHtml(t("portal.pageLabel").replace("{n}", page))} / ${pages}</span>
      <button class="btn small secondary" type="button" ${attr}="${page + 1}" ${page >= pages ? "disabled" : ""}>${escapeHtml(t("portal.next"))}</button>`;
  }

  function finLabel(prefix, value) {
    const key = `admin.fin.${prefix}.${value}`;
    const label = t(key);
    return label === key ? value || "—" : label;
  }

  function invoicePdfLink(id, number) {
    return id
      ? `<a href="/api/v1/invoices/${encodeURIComponent(id)}/pdf" target="_blank" rel="noopener">${escapeHtml(number || `#${id}`)}</a>`
      : "—";
  }

  async function loadPayments(page = 1) {
    const params = new URLSearchParams({ ...(state.paymentFilters || {}), page: String(page), pageSize: "20" });
    try {
      state.paymentsList = await window.GymApi.request(`/api/v1/payments?${params.toString()}`);
    } catch (_error) {
      state.paymentsList = null;
    }
    renderPaymentsList();
  }

  function renderPaymentsList() {
    const data = state.paymentsList;
    if (!data) {
      return;
    }
    const items = data.items || [];
    setHtml(
      "#paymentSummary",
      escapeHtml(
        t("admin.fin.summary")
          .replace("{count}", data.totals?.count || 0)
          .replace("{total}", money(data.totals?.completed || 0, "SAR"))
      )
    );
    setHtml(
      "#paymentRows",
      items.length
        ? items
            .map((row) => {
              const item = row.plan_ar || row.plan_en ? `${row.plan_ar || row.plan_en}${row.purpose === "renewal" ? ` (${t("admin.fin.renewal")})` : ""}` : "—";
              return `
                <tr>
                  <td>${escapeHtml(formatDate(row.created_at))}</td>
                  <td>${invoicePdfLink(row.invoice_id, row.invoice_number)}</td>
                  <td>${escapeHtml(row.member)}<br><small class="muted">${escapeHtml(row.member_code || "")}</small></td>
                  <td>${escapeHtml(item)}</td>
                  <td>${escapeHtml(finLabel("method", row.payment_method))}</td>
                  <td>${escapeHtml(money(row.amount, row.currency))}</td>
                  <td>${row.tax_total == null ? "—" : escapeHtml(money(row.tax_total, row.currency))}</td>
                  <td>${escapeHtml(finLabel("status", row.status))}${row.failure_reason ? `<br><small class="muted">${escapeHtml(row.failure_reason)}</small>` : ""}</td>
                </tr>`;
            })
            .join("")
        : `<tr><td colspan="8">${escapeHtml(t("admin.fin.noPayments"))}</td></tr>`
    );
    setHtml("#paymentPager", pagerHtml(data, "data-payment-page"));
  }

  async function loadInvoices(page = 1) {
    const params = new URLSearchParams({ ...(state.invoiceFilters || {}), page: String(page), pageSize: "20" });
    try {
      const [list, overdue] = await Promise.all([
        window.GymApi.request(`/api/v1/invoices?${params.toString()}`),
        page === 1 ? window.GymApi.request("/api/v1/invoices/overdue") : Promise.resolve(state.overdueInvoices)
      ]);
      state.invoicesList = list;
      state.overdueInvoices = overdue;
    } catch (_error) {
      state.invoicesList = null;
    }
    renderInvoices();
  }

  function renderInvoices() {
    const data = state.invoicesList;
    if (!data) {
      return;
    }
    const items = data.items || [];
    setHtml(
      "#invoiceRows",
      items.length
        ? items
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.invoice_number)}</td>
                  <td>${escapeHtml(formatDate(row.issued_at || row.issue_date))}</td>
                  <td>${escapeHtml(row.customer)}</td>
                  <td>${escapeHtml(money(row.subtotal, row.currency))}</td>
                  <td>${escapeHtml(money(row.tax_total, row.currency))}</td>
                  <td>${escapeHtml(money(row.total, row.currency))}</td>
                  <td>${escapeHtml(finLabel("inv", row.status))}</td>
                  <td><a class="btn small secondary" href="/api/v1/invoices/${encodeURIComponent(row.id)}/pdf" target="_blank" rel="noopener">PDF</a></td>
                </tr>`
            )
            .join("")
        : `<tr><td colspan="8">${escapeHtml(t("admin.fin.noInvoices"))}</td></tr>`
    );
    setHtml("#invoicePager", pagerHtml(data, "data-invoice-page"));

    const overdue = state.overdueInvoices?.items || [];
    setHtml(
      "#overdueRows",
      overdue.length
        ? overdue
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.invoice_number)}</td>
                  <td>${escapeHtml(row.customer)}<br><small class="muted">${escapeHtml(row.phone || "")}</small></td>
                  <td>${escapeHtml(formatDate(row.due_date || row.issue_date))}</td>
                  <td>${escapeHtml(money(row.balance_due, row.currency))}</td>
                </tr>`
            )
            .join("")
        : `<tr><td colspan="4">${escapeHtml(t("admin.fin.noOverdue"))}</td></tr>`
    );
  }

  function renderManualPaymentPlans() {
    const select = document.querySelector("#manualPaymentPlan");
    if (!select) {
      return;
    }
    const plans = (state.plans || []).filter((plan) => plan.isActive !== false);
    const previous = select.value;
    select.innerHTML = plans
      .map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(`${planName(plan)} — ${money(plan.priceDiscounted ?? plan.price, plan.currency)}`)}</option>`)
      .join("");
    if (previous) {
      select.value = previous;
    }
  }

  function newSubmissionKey() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
  }

  function setupFinance() {
    state.manualPaymentKey = newSubmissionKey();

    document.querySelector("#paymentFilterForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.paymentFilters = formFilters(event.currentTarget);
      loadPayments(1);
    });
    document.querySelector("#invoiceFilterForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.invoiceFilters = formFilters(event.currentTarget);
      loadInvoices(1);
    });
    document.querySelector("#paymentPager")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-payment-page]");
      if (button && !button.disabled) loadPayments(Number(button.dataset.paymentPage));
    });
    document.querySelector("#invoicePager")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-invoice-page]");
      if (button && !button.disabled) loadInvoices(Number(button.dataset.invoicePage));
    });

    document.querySelectorAll("[data-export]").forEach((button) => {
      button.addEventListener("click", async () => {
        const kind = button.dataset.export;
        const filters = (kind === "payments" ? state.paymentFilters : kind === "invoices" ? state.invoiceFilters : state.exportFilters?.[kind]) || {};
        const params = new URLSearchParams({ ...filters, lang: window.GymI18n.currentLang() });
        const path = button.dataset.exportPath || `/api/v1/${kind}/export`;
        const label = button.textContent;
        button.disabled = true;
        button.textContent = t("admin.exportRunning");
        try {
          await window.GymApi.download(`${path}?${params.toString()}`, `${kind}-${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (error) {
          window.alert(error.message || t("admin.exportFailed"));
        } finally {
          button.disabled = false;
          button.textContent = label;
        }
      });
    });

    document.querySelector("#manualPaymentFind")?.addEventListener("click", async () => {
      const term = document.querySelector("#manualPaymentMember")?.value.trim();
      const select = document.querySelector("#manualPaymentUser");
      if (!term || !select) {
        return;
      }
      try {
        const data = await window.GymApi.request(`/api/v1/customers?search=${encodeURIComponent(term)}&pageSize=10`);
        const items = data.items || [];
        select.innerHTML = items.length
          ? items
              .map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml([row.fullName, row.memberCode, row.phone].filter(Boolean).join(" · "))}</option>`)
              .join("")
          : `<option value="">${escapeHtml(t("admin.fin.noMembersFound"))}</option>`;
      } catch (error) {
        setMessage("#manualPaymentMessage", error.message, false);
      }
    });

    document.querySelector("#manualPaymentForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = document.querySelector("#manualPaymentSubmit");
      if (submit.disabled) {
        return;
      }
      const userSelect = document.querySelector("#manualPaymentUser");
      const planSelect = document.querySelector("#manualPaymentPlan");
      const methodSelect = document.querySelector("#manualPaymentMethod");
      if (!userSelect.value || !planSelect.value) {
        setMessage("#manualPaymentMessage", t("admin.fin.pickMemberAndPlan"), false);
        return;
      }
      const branch = currentBranchLabel();
      const prompt = t("admin.fin.confirmRecord")
        .replace("{amount}", planSelect.selectedOptions[0]?.textContent || "")
        .replace("{method}", methodSelect.selectedOptions[0]?.textContent || "")
        .replace("{member}", userSelect.selectedOptions[0]?.textContent || "")
        .replace("{branch}", branch ? localize(branch.name) : "");
      if (!window.confirm(prompt)) {
        return;
      }
      submit.disabled = true;
      setMessage("#manualPaymentMessage", t("admin.fin.recording"), true);
      try {
        const result = await window.GymApi.request("/api/v1/payments/manual", {
          method: "POST",
          body: JSON.stringify({
            userId: userSelect.value,
            planId: planSelect.value,
            method: methodSelect.value,
            reference: document.querySelector("#manualPaymentReference")?.value || "",
            idempotencyKey: state.manualPaymentKey
          })
        });
        // New key only after a definitive answer -- a network retry of the
        // same submission reuses the old key and gets the same payment back.
        state.manualPaymentKey = newSubmissionKey();
        setMessage(
          "#manualPaymentMessage",
          result.invoiceNumber ? t("admin.fin.recordedInvoice").replace("{number}", result.invoiceNumber) : t("admin.fin.recorded"),
          true
        );
        form.reset();
        userSelect.innerHTML = `<option value="">${escapeHtml(t("admin.fin.pickMember"))}</option>`;
        loadPayments(1);
        loadInvoices(1);
      } catch (error) {
        setMessage("#manualPaymentMessage", error.message || t("admin.fin.recordFailed"), false);
      } finally {
        submit.disabled = false;
      }
    });
  }

  // Leads/CRM (Part 2): same on-demand, filtered + paginated pattern as
  // loadTasks above (replaces the old one-shot /api/v1/messages fetch inside
  // load()'s Promise.all, which returned a flat, unfiltered array of up to
  // 100 rows -- see messageRepository.listMessages for the new { items,
  // pagination } shape this now consumes).
  async function loadMessages(page = 1) {
    const f = state.messageFilters || {};
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (f.status) params.set("status", f.status);
    if (f.leadStatus) params.set("leadStatus", f.leadStatus);
    if (f.assignedTo) params.set("assignedTo", f.assignedTo);
    if (f.search) params.set("search", f.search);
    try {
      state.messages = await window.GymApi.request(`/api/v1/messages?${params.toString()}`);
    } catch (_error) {
      state.messages = { items: [], pagination: {} };
    }
    if (state.selectedMessageId && !selectedMessage()) {
      state.selectedMessageId = null;
    }
    renderMessages();
  }

  function taskPayload(form) {
    const payload = formPayload(form);
    return {
      id: String(payload.id || "").trim(),
      // See planPayload's branchId note -- same pattern, same server-side
      // re-validation via resolveWriteBranchId.
      branchId: payload.branchId ? Number(payload.branchId) : undefined,
      title: String(payload.title || "").trim(),
      description: String(payload.description || "").trim(),
      assignedTo: payload.assignedTo ? Number(payload.assignedTo) : null,
      dueDate: payload.dueDate || null,
      priority: payload.priority || "medium",
      linkedResourceType: String(payload.linkedResourceType || "").trim() || null,
      linkedResourceId: payload.linkedResourceId ? Number(payload.linkedResourceId) : null
    };
  }

  function resetTaskForm() {
    const form = document.querySelector("#taskForm");
    if (!form) {
      return;
    }
    form.reset();
    form.elements.id.value = "";
    form.elements.priority.value = "medium";
    document.querySelector("#taskSubmitButton").textContent = t("admin.tasks.save");
    document.querySelector("#taskCancelEdit")?.setAttribute("hidden", "");
    renderBranchUi();
  }

  function findTask(taskId) {
    return (state.tasks.items || []).find((task) => String(task.id) === String(taskId));
  }

  function editTask(task) {
    const form = document.querySelector("#taskForm");
    if (!form || !task) {
      return;
    }
    form.elements.id.value = task.id || "";
    if (form.elements.branchId && task.branchId != null) {
      form.elements.branchId.value = String(task.branchId);
    }
    form.elements.title.value = task.title || "";
    form.elements.description.value = task.description || "";
    if (form.elements.assignedTo) {
      form.elements.assignedTo.value = task.assignedTo != null ? String(task.assignedTo) : "";
    }
    form.elements.dueDate.value = dateInputValue(task.dueDate);
    form.elements.priority.value = task.priority || "medium";
    form.elements.linkedResourceType.value = task.linkedResourceType || "";
    form.elements.linkedResourceId.value = task.linkedResourceId || "";
    document.querySelector("#taskSubmitButton").textContent = t("admin.tasks.save");
    document.querySelector("#taskCancelEdit")?.removeAttribute("hidden");
    setMessage("#taskMessage", `Editing task ${task.id}`, true);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // Leads/CRM (Part 2): dashboard stat is server-computed across ALL
  // messages (adminRepository.getOverview's "Unread messages" stat), not
  // just the current filtered/paginated page -- unlike the old flat-array
  // fetch (up to 100 rows), the Leads list is now paginated at 20/page, so
  // counting the visible page would under-report.
  function unreadMessagesCount() {
    const stat = (state.overview?.stats || []).find((item) => item.label?.en === "Unread messages");
    if (stat) {
      return Number(stat.value || 0);
    }
    return (state.messages.items || []).filter((message) => message.status === "unread").length;
  }

  function renderMessages() {
    const items = state.messages.items || [];
    const unreadBadge = document.querySelector("#unreadBadge");
    if (unreadBadge) {
      unreadBadge.textContent = `${unreadMessagesCount()} غير مقروءة`;
    }

    if (!items.length) {
      setHtml("#messageRows", `<tr><td colspan="9">${escapeHtml(t("admin.leads.none"))}</td></tr>`);
      setHtml("#messagePager", "");
      renderMessageDetail();
      return;
    }

    setHtml(
      "#messageRows",
      items
        .map(
          (message) => `
            <tr>
              <td>${escapeHtml(message.name)}</td>
              <td>${escapeHtml(message.phone)}</td>
              <td>${escapeHtml(message.email)}</td>
              <td>${escapeHtml(message.subject)}</td>
              <td>${escapeHtml(statusLabel(message.status))}</td>
              <td>${escapeHtml(statusLabel(message.leadStatus))}</td>
              <td>${escapeHtml(message.assignedToName || t("admin.tasks.unassigned"))}</td>
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

    const data = state.messages;
    const page = data.pagination?.page || 1;
    const total = data.pagination?.total || items.length;
    const pageSize = data.pagination?.pageSize || 20;
    const pages = Math.max(Math.ceil(total / pageSize), 1);
    setHtml(
      "#messagePager",
      pages > 1
        ? `<button class="btn small secondary" type="button" data-message-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${escapeHtml(t("portal.prev"))}</button>
           <span>${escapeHtml(t("portal.pageLabel").replace("{n}", page))} / ${pages}</span>
           <button class="btn small secondary" type="button" data-message-page="${page + 1}" ${page >= pages ? "disabled" : ""}>${escapeHtml(t("portal.next"))}</button>`
        : ""
    );

    renderMessageDetail();
  }

  function selectedMessage() {
    return (state.messages.items || []).find((message) => String(message.id) === String(state.selectedMessageId));
  }

  function renderLeadNotes() {
    const list = document.querySelector("#leadNotesList");
    if (!list) {
      return;
    }
    const notes = state.leadNotes || [];
    if (!notes.length) {
      list.innerHTML = `<li class="lead-notes-empty">${escapeHtml(t("admin.leads.notesNone"))}</li>`;
      return;
    }
    list.innerHTML = notes
      .map(
        (note) => `
          <li>
            <span class="lead-note-meta">${escapeHtml(note.createdByName || t("admin.tasks.unassigned"))} · ${formatDate(note.createdAt)}</span>
            ${escapeHtml(note.note)}
          </li>
        `
      )
      .join("");
  }

  async function loadLeadNotes(messageId) {
    try {
      state.leadNotes = await window.GymApi.request(`/api/v1/messages/${encodeURIComponent(messageId)}/notes`);
    } catch (_error) {
      state.leadNotes = [];
    }
    renderLeadNotes();
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

    renderLeadAssigneeOptions();
    const leadStatusSelect = document.querySelector("#leadStatusSelect");
    if (leadStatusSelect) {
      leadStatusSelect.value = message.leadStatus || "new";
    }
    const leadAssigneeSelect = document.querySelector("#leadAssigneeSelect");
    if (leadAssigneeSelect) {
      leadAssigneeSelect.value = message.assignedTo != null ? String(message.assignedTo) : "";
    }
    const convertButton = document.querySelector("#leadConvertButton");
    if (convertButton) {
      convertButton.disabled = message.leadStatus === "converted";
    }
    setMessage("#leadPipelineStatus", "", true);
    setMessage("#leadNoteStatus", "", true);
    const noteInput = document.querySelector("#leadNoteInput");
    if (noteInput) {
      noteInput.value = "";
    }
    state.leadNotes = [];
    renderLeadNotes();
    loadLeadNotes(message.id);
  }

  function renderPayments() {
    renderPaymentsList();
    renderInvoices();
    renderManualPaymentPlans();
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
    renderBranchUi();
    renderStats();
    renderTaskWidget();
    renderUsers();
    renderMemberships();
    renderPlans();
    renderOffers();
    renderSlider();
    renderSiteImageForm();
    renderHomepage();
    renderContact();
    renderMessages();
    renderAnnouncements();
    renderPayments();
    renderAdminAccounts();
    renderTaskAssigneeOptions();
    renderLeadAssigneeOptions();
    renderTasks();
    renderCheckin();
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
      state.me = user;
      const [overview, publicData, plans, offers, siteImagesData, slides, rbac, reportSummary, broadcasts] = await Promise.all([
        window.GymApi.request("/api/v1/admin/overview"),
        window.GymApi.bootstrap(),
        window.GymApi.request("/api/v1/admin/plans"),
        // Permission-gated: a 403 here (e.g. a Reception-only admin) must not
        // be treated as a dead session -- fall back to public data instead.
        window.GymApi.request("/api/v1/admin/offers").catch(() => null),
        window.GymApi.request("/api/v1/admin/siteImages").catch(() => null),
        window.GymApi.request("/api/v1/admin/slides").catch(() => null),
        window.GymApi.request("/api/v1/admin/rbac").catch(() => null),
        window.GymApi.request("/api/v1/reports/summary").catch(() => null),
        window.GymApi.request("/api/v1/admin/notificationBroadcasts").catch(() => [])
      ]);
      state.announcements = broadcasts || [];
      state.overview = overview;
      state.publicData = publicData;
      state.plans = plans;
      state.offers = offers || publicData.offers || [];
      state.siteImages = siteImagesData || publicData.siteImages || null;
      state.slides = slides || publicData.slides || [];
      state.rbac = rbac || { roles: [], permissions: [], assignments: [] };
      state.reportSummary = reportSummary;
      if (state.selectedRoleKey && !state.rbac.roles?.some((role) => role.key === state.selectedRoleKey)) {
        state.selectedRoleKey = null;
      }
      await loadBranchesIfNeeded();
      renderAll();
      loadMembers(1);
      loadTasks(1);
      loadCheckin();
      loadPayments(1);
      loadInvoices(1);
      // Leads/CRM (Part 2): loaded the same on-demand way as tasks -- see
      // loadMessages's own comment for why this moved out of the Promise.all
      // above.
      loadMessages(1);
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
      // Branch-scoped admins get a disabled, pre-filled <select> (see
      // renderBranchUi); a super_admin/branches:manage admin gets a real
      // dropdown. Either way the server re-validates/forces this value --
      // see resolveWriteBranchId in planController.js.
      branchId: payload.branchId ? Number(payload.branchId) : undefined,
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
    renderBranchUi();
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
    if (form.elements.branchId && plan.branchId != null) {
      form.elements.branchId.value = String(plan.branchId);
    }
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
      // See planPayload's branchId note -- same pattern, same server-side re-validation.
      branchId: payload.branchId ? Number(payload.branchId) : undefined,
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
    renderBranchUi();
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
    if (form.elements.branchId && offer.branchId != null) {
      form.elements.branchId.value = String(offer.branchId);
    }
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
      const branchSuffix = branchNameForId(plan.branchId) ? ` (${branchNameForId(plan.branchId)})` : "";
      if (!window.confirm(`هل تريد حذف ${currentPlanName}${branchSuffix}؟ ستُزال من الموقع.`)) {
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

  // Leads/CRM (Part 2) write helpers -- one small wrapper per new endpoint,
  // same style as updateMessageStatus/deleteMessage above.
  async function updateLeadFields(messageId, payload) {
    return window.GymApi.request(`/api/v1/messages/${encodeURIComponent(messageId)}/lead`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  async function addLeadNote(messageId, note) {
    return window.GymApi.request(`/api/v1/messages/${encodeURIComponent(messageId)}/notes`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
  }

  async function convertLead(messageId) {
    return window.GymApi.request(`/api/v1/messages/${encodeURIComponent(messageId)}/convert`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  function setupMessages() {
    document.querySelector("#messageFilterForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.messageFilters = {
        status: document.querySelector("#messageStatusFilter")?.value || "",
        leadStatus: document.querySelector("#leadStatusFilter")?.value || "",
        assignedTo: document.querySelector("#leadAssigneeFilter")?.value || "",
        search: document.querySelector("#messageSearchFilter")?.value || ""
      };
      loadMessages(1);
    });

    document.querySelector("#messagePager")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-message-page]");
      if (button && !button.disabled) {
        loadMessages(Number(button.dataset.messagePage));
      }
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
      const message = (state.messages.items || []).find((item) => String(item.id) === String(messageId));
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
        await loadMessages(state.messages.pagination?.page || 1);
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
      if (actionButton && state.selectedMessageId) {
        const action = actionButton.dataset.messageDetailAction;
        if (action === "delete" && !window.confirm("هل تريد حذف هذه الرسالة؟")) {
          return;
        }

        actionButton.disabled = true;
        try {
          if (action === "delete") {
            await deleteMessage(state.selectedMessageId);
            state.selectedMessageId = null;
            await loadMessages(state.messages.pagination?.page || 1);
            return;
          }

          await updateMessageStatus(state.selectedMessageId, action);
          setMessage("#messageActionStatus", "تم تحديث الرسالة.", true);
          await loadMessages(state.messages.pagination?.page || 1);
        } catch (error) {
          actionButton.disabled = false;
          setMessage("#messageActionStatus", error.message || "تعذر تحديث الرسالة.", false);
        }
        return;
      }

      // Leads/CRM (Part 2) pipeline actions below -- all scoped to the
      // currently-selected message (state.selectedMessageId), same as the
      // plain inbox actions above.
      if (event.target.closest("#leadSaveButton")) {
        if (!state.selectedMessageId) {
          return;
        }
        const button = event.target.closest("#leadSaveButton");
        button.disabled = true;
        try {
          const leadStatus = document.querySelector("#leadStatusSelect")?.value || "new";
          const assignedToValue = document.querySelector("#leadAssigneeSelect")?.value || "";
          await updateLeadFields(state.selectedMessageId, {
            leadStatus,
            assignedTo: assignedToValue ? Number(assignedToValue) : null
          });
          setMessage("#leadPipelineStatus", t("form.saved"), true);
          await loadMessages(state.messages.pagination?.page || 1);
          state.selectedMessageId = String(state.selectedMessageId);
          renderMessageDetail();
        } catch (error) {
          setMessage("#leadPipelineStatus", error.message || t("admin.readOnly"), false);
        } finally {
          button.disabled = false;
        }
        return;
      }

      if (event.target.closest("#leadConvertButton")) {
        if (!state.selectedMessageId) {
          return;
        }
        if (!window.confirm(t("admin.leads.confirmConvert"))) {
          return;
        }
        const button = event.target.closest("#leadConvertButton");
        button.disabled = true;
        try {
          await convertLead(state.selectedMessageId);
          setMessage("#leadPipelineStatus", t("admin.leads.convertSuccess"), true);
          await loadMessages(state.messages.pagination?.page || 1);
          renderMessageDetail();
        } catch (error) {
          button.disabled = false;
          setMessage("#leadPipelineStatus", error.message || t("admin.leads.convertFailed"), false);
        }
        return;
      }

      if (event.target.closest("#leadNoteAddButton")) {
        if (!state.selectedMessageId) {
          return;
        }
        const noteInput = document.querySelector("#leadNoteInput");
        const note = (noteInput?.value || "").trim();
        if (!note) {
          return;
        }
        const button = event.target.closest("#leadNoteAddButton");
        button.disabled = true;
        try {
          await addLeadNote(state.selectedMessageId, note);
          if (noteInput) {
            noteInput.value = "";
          }
          setMessage("#leadNoteStatus", t("form.saved"), true);
          await loadLeadNotes(state.selectedMessageId);
        } catch (error) {
          setMessage("#leadNoteStatus", error.message || t("admin.readOnly"), false);
        } finally {
          button.disabled = false;
        }
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

  function setupExports() {
    const message = document.querySelector("#exportMembersMessage");
    const run = async (format, button) => {
      if (!button) {
        return;
      }
      const label = button.textContent;
      button.disabled = true;
      if (message) {
        message.style.color = "";
        message.textContent = t("admin.exportRunning");
      }
      try {
        const lang = window.GymI18n.currentLang();
        const stamp = new Date().toISOString().slice(0, 10);
        await window.GymApi.download(
          `/api/v1/users/export?format=${format}&lang=${lang}`,
          `members-${stamp}.${format === "pdf" ? "pdf" : "xlsx"}`
        );
        if (message) {
          message.style.color = "#c8a867";
          message.textContent = t("admin.exportDone");
        }
      } catch (error) {
        if (message) {
          message.style.color = "";
          message.textContent = error.message || t("admin.exportFailed");
        }
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    };

    document
      .querySelector("#exportMembersXlsx")
      ?.addEventListener("click", (event) => run("xlsx", event.currentTarget));
    document
      .querySelector("#exportMembersPdf")
      ?.addEventListener("click", (event) => run("pdf", event.currentTarget));
  }

  function renderAnnouncements() {
    const rows = state.announcements || [];
    const typeLabels = {
      announcement: t("admin.typeAnnouncement"),
      notice: t("admin.typeNotice"),
      promo: t("admin.typePromo")
    };
    setHtml(
      "#announceRows",
      rows.length
        ? rows
            .map(
              (row) => `
            <tr>
              <td>${escapeHtml(typeLabels[row.type] || row.type)}</td>
              <td>${escapeHtml(row.titleEn || row.titleAr || "")}</td>
              <td>${escapeHtml(String(row.recipients))}</td>
              <td>${escapeHtml(String(row.readCount))} / ${escapeHtml(String(row.recipients))}</td>
              <td>${formatDate(row.sentAt)}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5">${escapeHtml(t("admin.announceEmpty"))}</td></tr>`
    );
  }

  async function loadAnnouncements() {
    try {
      state.announcements = await window.GymApi.request("/api/v1/admin/notificationBroadcasts");
    } catch (_error) {
      state.announcements = state.announcements || [];
    }
    renderAnnouncements();
  }

  function setupAnnounce() {
    const form = document.querySelector("#announceForm");
    const audience = document.querySelector("#announceAudience");
    const memberField = document.querySelector("#announceMemberField");

    const toggleMember = () => {
      if (memberField) {
        memberField.hidden = audience.value !== "member";
      }
    };
    audience?.addEventListener("change", toggleMember);
    toggleMember();

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const payload = {
        audience: data.get("audience"),
        type: data.get("type"),
        titleAr: String(data.get("titleAr") || "").trim(),
        titleEn: String(data.get("titleEn") || "").trim(),
        bodyAr: String(data.get("bodyAr") || "").trim(),
        bodyEn: String(data.get("bodyEn") || "").trim()
      };
      if (payload.audience === "member") {
        payload.userId = Number(data.get("userId"));
      }
      if (!payload.titleAr || !payload.titleEn || !payload.bodyAr || !payload.bodyEn) {
        setMessage("#announceMessage", t("admin.announceIncomplete"), false);
        return;
      }

      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      setMessage("#announceMessage", "", true);
      try {
        const result = await window.GymApi.request("/api/v1/admin/notifications", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setMessage(
          "#announceMessage",
          t("admin.announceSent").replace("{n}", result.recipients),
          true
        );
        form.reset();
        toggleMember();
        await loadAnnouncements();
      } catch (error) {
        setMessage("#announceMessage", error.message, false);
      } finally {
        submit.disabled = false;
      }
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
    setupMessages();
    setupMessageActions();
    setupRbacActions();
    setupExports();
    setupAnnounce();
    setupMembers();
    setupTasks();
    setupCheckin();
    setupFinance();
    setupSession();
    setupBranchSwitcher();
    load();
    window.addEventListener("languagechange", renderAll);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
