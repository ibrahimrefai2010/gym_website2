(function memberPortal() {
  const state = {
    publicData: window.GYM_DEFAULT_DATA,
    dashboard: null,
    profile: null,
    activeTab: "home",
    loaded: {},
    avatarV: 0,
    payments: { page: 1, pages: 1, receipts: {} },
    notifications: { page: 1, pages: 1, filter: "all" }
  };

  const api = window.GymApi;
  const i18n = window.GymI18n;

  function t(key, repl) {
    return i18n.t(key, repl);
  }

  function localize(value) {
    return i18n.localize(value);
  }

  function lang() {
    return i18n.currentLang();
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

  function byId(id) {
    return document.getElementById(id);
  }

  function setMessage(node, text, tone) {
    if (typeof node === "string") {
      node = byId(node);
    }
    if (!node) {
      return;
    }
    node.textContent = text || "";
    node.style.color = tone === "success" ? "#115e38" : tone === "error" ? "" : "var(--color-muted)";
  }

  function formatDate(value, withTime) {
    if (!value) {
      return t("portal.notProvided");
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return t("portal.notProvided");
    }
    const locale = lang() === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB";
    const options = { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" };
    if (withTime) {
      options.hour = "2-digit";
      options.minute = "2-digit";
    }
    return new Intl.DateTimeFormat(locale, options).format(date);
  }

  function formatMonthYear(value) {
    if (!value) {
      return t("portal.notProvided");
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return t("portal.notProvided");
    }
    const locale = lang() === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB";
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(date);
  }

  function money(amount, currency) {
    const locale = lang() === "ar" ? "ar-u-nu-latn" : "en-US";
    const value = Number(amount || 0).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${currency || "SAR"} ${value}`;
  }

  function stateText(membershipState, remainingDays) {
    if (membershipState === "expiring_soon") {
      return t("portal.state.expiring_soon", { n: Math.max(Number(remainingDays) || 0, 0) });
    }
    return t(`portal.state.${membershipState || "none"}`);
  }

  function statusPill(membershipState, remainingDays) {
    return `<span class="status-pill" data-state="${escapeHtml(membershipState || "none")}">${escapeHtml(
      stateText(membershipState, remainingDays)
    )}</span>`;
  }

  function paymentStatusLabel(status) {
    const key = `portal.pay.${String(status || "").toLowerCase()}`;
    const label = t(key);
    return label === key ? String(status || "") : label;
  }

  function loadingBlock() {
    return `<div class="state-block" role="status">${escapeHtml(t("portal.loading"))}</div>`;
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return "•";
    }
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function renderAvatar(node, name, hasAvatar) {
    if (!node) {
      return;
    }
    if (hasAvatar) {
      node.innerHTML = `<img src="/api/v1/user/avatar?t=${state.avatarV}" alt="">`;
    } else {
      node.textContent = initials(name);
    }
  }

  function errorBlock(retryHandlerName) {
    return `<div class="state-block is-error" role="alert">
      <span>${escapeHtml(t("portal.error"))}</span>
      <button class="btn small secondary" type="button" data-retry="${escapeHtml(retryHandlerName)}">${escapeHtml(
      t("portal.retry")
    )}</button>
    </div>`;
  }

  function emptyBlock(message) {
    return `<div class="state-block">${escapeHtml(message)}</div>`;
  }

  /* ------------------------------------------------------------------ *
   * Session bootstrap
   * ------------------------------------------------------------------ */
  async function ensureSessionOrRedirect() {
    try {
      return await api.ensureSession();
    } catch (_first) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        return await api.refreshSession();
      } catch (_second) {
        api.clearSession();
        window.location.href = "/login.html";
        throw _second;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * HOME
   * ------------------------------------------------------------------ */
  function renderHome() {
    const data = state.dashboard;
    if (!data) {
      byId("homeMembership").innerHTML = loadingBlock();
      byId("homeCard").innerHTML = loadingBlock();
      byId("homeNotifications").innerHTML = loadingBlock();
      return;
    }

    const name = data.member?.fullName || "";
    const heading = byId("welcomeHeading");
    if (heading) {
      heading.textContent = t("portal.welcome", { name });
    }
    const welcomeAvatar = byId("welcomeAvatar");
    if (welcomeAvatar) {
      welcomeAvatar.hidden = false;
      renderAvatar(welcomeAvatar, name, data.member?.hasAvatar);
    }

    renderMembershipSummary(byId("homeMembership"), {
      membership: data.membership,
      membershipState: data.membershipState,
      remainingDays: data.remainingDays,
      memberCode: data.member?.memberCode,
      memberSince: data.member?.registeredAt
    });

    renderCard(byId("homeCard"), state.cardData, {
      membership: data.membership,
      membershipState: data.membershipState,
      memberName: data.member?.fullName,
      memberCode: data.member?.memberCode
    });

    renderNotificationList(byId("homeNotifications"), data.recentNotifications || [], { compact: true });
  }

  function renderMembershipSummary(node, info) {
    if (!node) {
      return;
    }
    const membership = info.membership;
    if (!membership || info.membershipState === "none") {
      node.innerHTML = `${emptyBlock(t("portal.membership.none"))}
        <div class="inline-actions" style="justify-content:center">
          <a class="btn" href="/#plans" data-i18n="portal.renew">${escapeHtml(t("portal.renew"))}</a>
        </div>`;
      return;
    }

    const remaining = info.remainingDays == null ? "—" : Math.max(info.remainingDays, 0);
    node.innerHTML = `
      <div class="summary-tiles">
        <div class="summary-tile">
          <span>${escapeHtml(t("portal.field.plan"))}</span>
          <strong>${escapeHtml(localize(membership.plan?.name) || "—")}</strong>
        </div>
        <div class="summary-tile">
          <span>${escapeHtml(t("portal.field.status"))}</span>
          <strong>${statusPill(info.membershipState, info.remainingDays)}</strong>
        </div>
        <div class="summary-tile big">
          <span>${escapeHtml(t("portal.field.remaining"))}</span>
          <strong>${escapeHtml(String(remaining))}</strong>
        </div>
      </div>
      <dl class="data-list">
        <div><dt>${escapeHtml(t("portal.field.startDate"))}</dt><dd>${escapeHtml(formatDate(membership.startDate))}</dd></div>
        <div><dt>${escapeHtml(t("portal.field.expiry"))}</dt><dd>${escapeHtml(formatDate(membership.endDate))}</dd></div>
        <div><dt>${escapeHtml(t("portal.field.memberId"))}</dt><dd>${escapeHtml(info.memberCode || "—")}</dd></div>
        <div><dt>${escapeHtml(t("portal.field.price"))}</dt><dd>${escapeHtml(money(membership.plan?.price, "SAR"))}</dd></div>
        <div><dt>${escapeHtml(t("portal.field.memberSince"))}</dt><dd>${escapeHtml(formatMonthYear(info.memberSince))}</dd></div>
      </dl>
      <button class="btn" type="button" data-action="renew">${escapeHtml(t("portal.renew"))}</button>
      <p class="form-message" data-renew-message aria-live="polite"></p>
    `;
  }

  function renderCard(node, card, fallback) {
    if (!node) {
      return;
    }
    const membership = card?.membership || fallback?.membership;
    const membershipState = card?.state || fallback?.membershipState || "none";
    if (!card || !card.qrDataUrl || membershipState === "none") {
      node.innerHTML = emptyBlock(t("portal.card.unavailable"));
      return;
    }
    const logo = state.publicData?.siteImages?.logo?.imageUrl || "/assets/logo.png";
    const brand = localize(state.publicData?.brand?.localeName) || "Muscle & Fitness Center";
    node.innerHTML = `
      <div class="member-card">
        <div class="member-card-top">
          <img src="${escapeHtml(logo)}" alt="" width="30" height="30">
          <span>${escapeHtml(brand)}</span>
        </div>
        <div class="member-card-body">
          <div class="member-card-fields">
            <div class="member-card-field">
              <span>${escapeHtml(t("card.verify.member"))}</span>
              <strong>${escapeHtml(card.memberName || fallback?.memberName || "")}</strong>
            </div>
            <div class="member-card-field">
              <span>${escapeHtml(t("portal.field.memberId"))}</span>
              <strong>${escapeHtml(card.memberCode || fallback?.memberCode || "")}</strong>
            </div>
            <div class="member-card-field">
              <span>${escapeHtml(t("portal.field.plan"))}</span>
              <strong>${escapeHtml(localize(membership?.plan?.name || membership?.plan) || "—")}</strong>
            </div>
            <div class="member-card-field">
              <span>${escapeHtml(t("portal.field.status"))}</span>
              ${statusPill(membershipState, card.remainingDays)}
            </div>
            <div class="member-card-field">
              <span>${escapeHtml(t("portal.field.expiry"))}</span>
              <strong>${escapeHtml(formatDate(membership?.endDate))}</strong>
            </div>
          </div>
          <div class="member-card-qr">
            <img src="${escapeHtml(card.qrDataUrl)}" alt="${escapeHtml(t("portal.card.scanHint"))}" width="132" height="132">
            <small>${escapeHtml(t("portal.card.scanHint"))}</small>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * MEMBERSHIP
   * ------------------------------------------------------------------ */
  async function loadMembership(force) {
    const currentNode = byId("membershipCurrent");
    const historyNode = byId("membershipHistory");
    if (!force && state.loaded.membership) {
      return;
    }
    currentNode.innerHTML = loadingBlock();
    historyNode.innerHTML = loadingBlock();
    try {
      const [detail, history] = await Promise.all([
        api.request("/api/v1/user/membership"),
        api.request("/api/v1/user/membership/history")
      ]);
      state.loaded.membership = true;

      renderMembershipSummary(currentNode, {
        membership: detail.membership,
        membershipState: detail.state,
        remainingDays: detail.remainingDays,
        memberCode: state.dashboard?.member?.memberCode,
        memberSince: detail.memberSince
      });

      if (!history.length) {
        historyNode.innerHTML = emptyBlock(t("portal.membership.noHistory"));
      } else {
        historyNode.innerHTML = `
          <div class="table-shell">
            <table class="table">
              <thead>
                <tr>
                  <th>${escapeHtml(t("portal.field.plan"))}</th>
                  <th>${escapeHtml(t("portal.table.start"))}</th>
                  <th>${escapeHtml(t("portal.table.end"))}</th>
                  <th>${escapeHtml(t("portal.field.status"))}</th>
                </tr>
              </thead>
              <tbody>
                ${history
                  .map(
                    (row) => `
                  <tr>
                    <td>${escapeHtml(localize(row.plan?.name) || "—")}</td>
                    <td>${escapeHtml(formatDate(row.startDate))}</td>
                    <td>${escapeHtml(formatDate(row.endDate))}</td>
                    <td>${statusPill(row.status === "active" ? "active" : row.status, null)}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`;
      }
    } catch (_error) {
      currentNode.innerHTML = errorBlock("membership");
      historyNode.innerHTML = "";
    }
  }

  /* ------------------------------------------------------------------ *
   * PAYMENTS
   * ------------------------------------------------------------------ */
  async function loadPayments(force) {
    const node = byId("paymentsBody");
    if (!force && state.loaded.payments) {
      return;
    }
    node.innerHTML = loadingBlock();
    try {
      const data = await api.request(`/api/v1/user/payments?page=${state.payments.page}&pageSize=10`);
      state.loaded.payments = true;
      const total = data.pagination?.total || 0;
      const pageSize = data.pagination?.pageSize || 10;
      state.payments.pages = Math.max(Math.ceil(total / pageSize), 1);

      if (!data.items.length) {
        node.innerHTML = emptyBlock(t("portal.payments.none"));
        return;
      }

      node.innerHTML = `
        <div class="table-shell">
          <table class="table">
            <thead>
              <tr>
                <th>${escapeHtml(t("table.date"))}</th>
                <th>${escapeHtml(t("portal.table.amount"))}</th>
                <th>${escapeHtml(t("portal.table.method"))}</th>
                <th>${escapeHtml(t("portal.table.reference"))}</th>
                <th>${escapeHtml(t("portal.field.status"))}</th>
                <th>${escapeHtml(t("portal.table.receipt"))}</th>
              </tr>
            </thead>
            <tbody>
              ${data.items
                .map(
                  (row) => `
                <tr data-payment-row="${escapeHtml(row.id)}">
                  <td>${escapeHtml(formatDate(row.date))}</td>
                  <td>${escapeHtml(money(row.amount, row.currency))}</td>
                  <td>${escapeHtml(row.paymentMethod || row.provider || "—")}</td>
                  <td>${escapeHtml(row.reference || "—")}</td>
                  <td>${escapeHtml(paymentStatusLabel(row.status))}</td>
                  <td>${
                    row.hasReceipt
                      ? `<button class="link-button" type="button" data-receipt="${escapeHtml(row.id)}">${escapeHtml(
                          t("portal.payments.viewReceipt")
                        )}</button>`
                      : "—"
                  }</td>
                </tr>
                <tr data-receipt-slot="${escapeHtml(row.id)}" hidden><td colspan="6"></td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn small secondary" type="button" data-payments-page="prev" ${
            state.payments.page <= 1 ? "disabled" : ""
          }>${escapeHtml(t("portal.prev"))}</button>
          <span>${escapeHtml(t("portal.pageLabel", { n: state.payments.page }))}</span>
          <button class="btn small secondary" type="button" data-payments-page="next" ${
            state.payments.page >= state.payments.pages ? "disabled" : ""
          }>${escapeHtml(t("portal.next"))}</button>
        </div>`;
    } catch (_error) {
      node.innerHTML = errorBlock("payments");
    }
  }

  async function toggleReceipt(paymentId) {
    const slot = document.querySelector(`[data-receipt-slot="${CSS.escape(String(paymentId))}"]`);
    if (!slot) {
      return;
    }
    const cell = slot.firstElementChild;
    if (!slot.hidden) {
      slot.hidden = true;
      cell.innerHTML = "";
      return;
    }
    slot.hidden = false;
    cell.innerHTML = `<div class="receipt-box">${escapeHtml(t("portal.loading"))}</div>`;
    try {
      const data = await api.request(`/api/v1/user/payments/${encodeURIComponent(paymentId)}/receipt`);
      const p = data.payment;
      const rows = [
        [t("portal.field.status"), paymentStatusLabel(p.status)],
        [t("portal.table.amount"), money(p.amount, p.currency)],
        [t("portal.table.method"), p.paymentMethod || p.provider || "—"],
        [t("portal.table.reference"), p.reference || "—"],
        [t("table.date"), formatDate(p.date, true)]
      ];
      if (p.plan) {
        rows.unshift([t("portal.field.plan"), localize(p.plan)]);
      }
      let invoiceHtml = "";
      if (data.invoice) {
        invoiceHtml = `
          <div class="receipt-row"><strong>${escapeHtml(data.invoice.number)}</strong><span>${escapeHtml(
          formatDate(data.invoice.issueDate)
        )}</span></div>
          ${data.invoice.items
            .map(
              (item) =>
                `<div class="receipt-row"><span>${escapeHtml(item.description)}</span><span>${escapeHtml(
                  money(item.lineTotal, data.invoice.currency)
                )}</span></div>`
            )
            .join("")}
          <div class="receipt-row"><strong>${escapeHtml(t("portal.table.amount"))}</strong><strong>${escapeHtml(
          money(data.invoice.total, data.invoice.currency)
        )}</strong></div>`;
      }
      cell.innerHTML = `<div class="receipt-box">
        ${rows
          .map(
            ([k, v]) => `<div class="receipt-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`
          )
          .join("")}
        ${invoiceHtml}
      </div>`;
    } catch (_error) {
      cell.innerHTML = `<div class="receipt-box">${escapeHtml(t("portal.payments.noReceipt"))}</div>`;
    }
  }

  /* ------------------------------------------------------------------ *
   * NOTIFICATIONS
   * ------------------------------------------------------------------ */
  function renderNotificationList(node, items, options) {
    if (!node) {
      return;
    }
    if (!items.length) {
      node.innerHTML = emptyBlock(t("portal.notif.none"));
      return;
    }
    const list = items
      .map((item) => {
        const title = localize(item.title) || t(`portal.notif.cat${item.category === "announcement" ? "Announcement" : "Transactional"}`);
        const body = localize(item.body);
        const tag =
          item.category === "announcement" ? t("portal.notif.catAnnouncement") : t("portal.notif.catTransactional");
        return `<div class="notif-item ${item.isRead ? "" : "is-unread"}">
          <div class="notif-item-head">
            <strong>${escapeHtml(title)}</strong>
            <time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatDate(item.createdAt))}</time>
          </div>
          ${body ? `<p>${escapeHtml(body)}</p>` : ""}
          <div class="notif-actions">
            <span class="notif-tag">${escapeHtml(tag)}</span>
            ${
              item.isRead
                ? ""
                : `<button class="link-button" type="button" data-mark-read="${escapeHtml(item.id)}">${escapeHtml(
                    t("portal.notif.markRead")
                  )}</button>`
            }
          </div>
        </div>`;
      })
      .join("");
    const viewAll =
      options && options.compact
        ? `<div class="inline-actions" style="justify-content:center;margin-block-start:12px">
            <button class="btn small ghost" type="button" data-goto-tab="notifications">${escapeHtml(
              t("portal.notif.all")
            )}</button>
          </div>`
        : "";
    node.innerHTML = `<div class="notif-list">${list}</div>${viewAll}`;
  }

  async function loadNotifications(force) {
    const node = byId("notificationsBody");
    if (!force && state.loaded.notifications) {
      return;
    }
    node.innerHTML = loadingBlock();
    try {
      const unreadOnly = state.notifications.filter === "unread";
      const data = await api.request(
        `/api/v1/user/notifications?page=${state.notifications.page}&pageSize=15&unreadOnly=${unreadOnly}`
      );
      state.loaded.notifications = true;
      updateUnreadBadge(data.unreadCount);
      const total = data.pagination?.total || 0;
      const pageSize = data.pagination?.pageSize || 15;
      state.notifications.pages = Math.max(Math.ceil(total / pageSize), 1);

      renderNotificationList(node, data.items, { compact: false });
      if (data.items.length) {
        node.insertAdjacentHTML(
          "beforeend",
          `<div class="pager">
            <button class="btn small secondary" type="button" data-notif-page="prev" ${
              state.notifications.page <= 1 ? "disabled" : ""
            }>${escapeHtml(t("portal.prev"))}</button>
            <span>${escapeHtml(t("portal.pageLabel", { n: state.notifications.page }))}</span>
            <button class="btn small secondary" type="button" data-notif-page="next" ${
              state.notifications.page >= state.notifications.pages ? "disabled" : ""
            }>${escapeHtml(t("portal.next"))}</button>
          </div>`
        );
      }
    } catch (_error) {
      node.innerHTML = errorBlock("notifications");
    }
  }

  async function loadPreferences() {
    try {
      const prefs = await api.request("/api/v1/user/notifications/preferences");
      const form = byId("prefsForm");
      if (!form) {
        return;
      }
      form.elements.emailTransactional.checked = Boolean(prefs.emailTransactional);
      form.elements.smsTransactional.checked = Boolean(prefs.smsTransactional);
      form.elements.emailMarketing.checked = Boolean(prefs.emailMarketing);
      form.elements.smsMarketing.checked = Boolean(prefs.smsMarketing);
      form.elements.whatsappMarketing.checked = Boolean(prefs.whatsappMarketing);
    } catch (_error) {
      setMessage("prefsMessage", t("portal.error"), "error");
    }
  }

  function updateUnreadBadge(count) {
    const badge = byId("navUnread");
    if (!badge) {
      return;
    }
    const value = Number(count) || 0;
    badge.textContent = String(value);
    badge.hidden = value === 0;
  }

  async function markRead(id) {
    try {
      await api.request(`/api/v1/user/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
      state.loaded.notifications = false;
      await refreshDashboardQuietly();
      if (state.activeTab === "notifications") {
        await loadNotifications(true);
      } else {
        renderHome();
      }
    } catch (_error) {
      /* no-op */
    }
  }

  async function markAllRead() {
    try {
      await api.request("/api/v1/user/notifications/read-all", { method: "POST" });
      state.loaded.notifications = false;
      updateUnreadBadge(0);
      await refreshDashboardQuietly();
      if (state.activeTab === "notifications") {
        await loadNotifications(true);
      } else {
        renderHome();
      }
    } catch (_error) {
      setMessage("prefsMessage", t("portal.error"), "error");
    }
  }

  /* ------------------------------------------------------------------ *
   * ACCOUNT
   * ------------------------------------------------------------------ */
  async function loadAccount(force) {
    if (!force && state.loaded.account) {
      return;
    }
    try {
      const profile = await api.request("/api/v1/user/profile");
      state.profile = profile;
      state.loaded.account = true;
      fillPersonalForm(profile);
      fillEmergencyForm(profile.emergencyContact);
      renderGymContact();
      await loadSessions(true);
    } catch (_error) {
      setMessage("personalMessage", t("portal.error"), "error");
    }
  }

  function fillPersonalForm(profile) {
    const form = byId("personalForm");
    if (!form) {
      return;
    }
    form.elements.fullName.value = profile.fullName || "";
    form.elements.email.value = profile.email || "";
    form.elements.phone.value = profile.phone || "";
    form.elements.nationalId.value = "";
    form.elements.nationalId.placeholder = profile.hasNationalId
      ? profile.nationalIdMasked || "••••••"
      : "";
    form.elements.birthDate.value = profile.birthDate || "";
    form.elements.gender.value = ["male", "female", "unspecified"].includes(profile.gender)
      ? profile.gender
      : "unspecified";
    form.elements.nationality.value = profile.nationality || "";
    form.elements.city.value = profile.city || "";

    renderAvatar(byId("pfAvatar"), profile.fullName, profile.hasAvatar);
    const removeButton = byId("pfAvatarRemove");
    if (removeButton) {
      removeButton.hidden = !profile.hasAvatar;
    }

    byId("personalReadonly").innerHTML = `
      <div><dt>${escapeHtml(t("portal.field.memberId"))}</dt><dd>${escapeHtml(profile.memberCode || "—")}</dd></div>
      <div><dt>${escapeHtml(t("portal.field.registered"))}</dt><dd>${escapeHtml(formatDate(profile.registeredAt))}</dd></div>`;
  }

  function fillEmergencyForm(contact) {
    const form = byId("emergencyForm");
    if (!form) {
      return;
    }
    form.elements.name.value = contact?.name || "";
    form.elements.relationship.value = contact?.relationship || "";
    form.elements.phone.value = contact?.phone || "";
  }

  function renderGymContact() {
    const node = byId("gymContact");
    if (!node) {
      return;
    }
    const contact = state.publicData?.contact || window.GYM_DEFAULT_DATA.contact || {};
    const hours = state.publicData?.workingHours || window.GYM_DEFAULT_DATA.workingHours || [];
    const waDigits = String(contact.whatsapp || "").replace(/[^\d]/g, "");
    const rows = [];
    if (contact.phone) {
      rows.push([
        t("contact.phone"),
        `<a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phone)}</a>`
      ]);
    }
    if (waDigits) {
      rows.push([
        t("contact.whatsapp"),
        `<a href="https://wa.me/${escapeHtml(waDigits)}" target="_blank" rel="noopener">+${escapeHtml(waDigits)}</a>`
      ]);
    }
    if (contact.email) {
      rows.push([
        t("contact.email"),
        `<a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>`
      ]);
    }
    if (contact.address) {
      rows.push([t("contact.address"), escapeHtml(localize(contact.address))]);
    }
    if (hours.length) {
      const multi = hours.length > 1;
      rows.push([
        t("contact.hours"),
        hours
          .map((row) => {
            const label = localize(row.day);
            const value = localize(row.hours);
            return multi && label ? `${escapeHtml(label)}: ${escapeHtml(value)}` : escapeHtml(value);
          })
          .join("<br>")
      ]);
    }
    node.innerHTML = rows
      .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`)
      .join("");
  }

  async function loadSessions(force) {
    const node = byId("sessionsBody");
    if (!node || (!force && state.loaded.sessions)) {
      return;
    }
    node.innerHTML = loadingBlock();
    try {
      const sessions = await api.request("/api/v1/user/sessions");
      state.loaded.sessions = true;
      const others = sessions.filter((session) => !session.current);
      byId("revokeOthers").disabled = others.length === 0;
      node.innerHTML = sessions
        .map(
          (session) => `
          <div class="session-item">
            <div class="session-meta">
              <strong>${escapeHtml(session.browser)} · ${escapeHtml(session.platform)}${
            session.current ? ` <span class="chip">${escapeHtml(t("portal.security.thisDevice"))}</span>` : ""
          }</strong>
              <small>${escapeHtml(session.ipAddress || "")} · ${escapeHtml(
            t("portal.security.started", { date: formatDate(session.createdAt, true) })
          )}</small>
            </div>
            <button class="btn small ghost" type="button" data-revoke-session="${escapeHtml(
              session.id
            )}">${escapeHtml(t("portal.security.revoke"))}</button>
          </div>`
        )
        .join("");
    } catch (_error) {
      node.innerHTML = errorBlock("sessions");
    }
  }

  /* ------------------------------------------------------------------ *
   * Tab handling + data loading
   * ------------------------------------------------------------------ */
  function setTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll("[data-portal-tab]").forEach((button) => {
      const isActive = button.dataset.portalTab === tab;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    document.querySelectorAll(".portal-section").forEach((section) => {
      section.hidden = section.id !== `section-${tab}`;
    });
    try {
      window.history.replaceState(null, "", `#${tab}`);
    } catch (_error) {
      /* ignore */
    }
    loadTab(tab);
  }

  function loadTab(tab) {
    if (tab === "membership") {
      loadMembership(false);
    } else if (tab === "payments") {
      loadPayments(false);
    } else if (tab === "notifications") {
      loadNotifications(false);
      if (!state.loaded.prefs) {
        state.loaded.prefs = true;
        loadPreferences();
      }
    } else if (tab === "account") {
      loadAccount(false);
    }
  }

  async function refreshDashboardQuietly() {
    try {
      state.dashboard = await api.request("/api/v1/user/dashboard");
      updateUnreadBadge(state.dashboard.unreadCount);
    } catch (_error) {
      /* keep previous */
    }
  }

  async function loadInitial() {
    renderHome();
    try {
      const [dashboard, publicData] = await Promise.all([
        api.request("/api/v1/user/dashboard"),
        api.bootstrap()
      ]);
      state.dashboard = dashboard;
      state.publicData = publicData || state.publicData;
      updateUnreadBadge(dashboard.unreadCount);
      renderBrand();
      renderHome();
      try {
        state.cardData = await api.request("/api/v1/user/card");
      } catch (_cardError) {
        state.cardData = null;
      }
      renderHome();
      document.querySelector("#adminLink")?.toggleAttribute("hidden", dashboard.member?.type === "admin" ? false : true);
    } catch (_error) {
      byId("homeMembership").innerHTML = errorBlock("initial");
      byId("homeCard").innerHTML = "";
      byId("homeNotifications").innerHTML = "";
    }
  }

  function renderBrand() {
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = localize(state.publicData?.brand?.localeName) || "";
    });
    const logo = state.publicData?.siteImages?.logo?.imageUrl;
    if (logo) {
      document.querySelectorAll('[data-site-image="logo"]').forEach((img) => {
        img.src = logo;
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Forms
   * ------------------------------------------------------------------ */
  function fieldError(input, message) {
    const field = input.closest(".field");
    if (!field) {
      return !message;
    }
    field.classList.toggle("has-error", Boolean(message));
    let node = field.querySelector(".field-error");
    if (!node) {
      node = document.createElement("span");
      node.className = "field-error";
      field.appendChild(node);
    }
    node.textContent = message || "";
    return !message;
  }

  function validatePhone(value) {
    return /^(05|5)\d{8}$/.test(String(value || "").replace(/[^\d]/g, "").replace(/^966/, ""));
  }

  function setupAvatar() {
    const input = byId("pfAvatarInput");
    const removeButton = byId("pfAvatarRemove");
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    input?.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) {
        return;
      }
      if (!allowed.includes(file.type)) {
        setMessage("avatarMessage", t("portal.photo.badType"), "error");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setMessage("avatarMessage", t("portal.photo.tooLarge"), "error");
        return;
      }
      setMessage("avatarMessage", t("portal.loading"), "neutral");
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
        await api.request("/api/v1/user/avatar", {
          method: "POST",
          body: JSON.stringify({ image: dataUrl })
        });
        state.avatarV = Date.now();
        await refreshAfterAvatarChange();
        setMessage("avatarMessage", t("portal.saved"), "success");
      } catch (error) {
        setMessage("avatarMessage", error.message, "error");
      }
    });

    removeButton?.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        await api.request("/api/v1/user/avatar", { method: "DELETE" });
        state.avatarV = Date.now();
        await refreshAfterAvatarChange();
        setMessage("avatarMessage", t("portal.saved"), "success");
      } catch (error) {
        setMessage("avatarMessage", error.message, "error");
      } finally {
        removeButton.disabled = false;
      }
    });
  }

  async function refreshAfterAvatarChange() {
    try {
      const profile = await api.request("/api/v1/user/profile");
      state.profile = profile;
      fillPersonalForm(profile);
    } catch (_error) {
      /* keep current */
    }
    await refreshDashboardQuietly();
    renderHome();
  }

  function setupPersonalForm() {
    const form = byId("personalForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      let valid = true;
      valid = fieldError(form.elements.fullName, data.get("fullName")?.trim() ? "" : t("validation.required")) && valid;
      if (data.get("phone")) {
        valid = fieldError(form.elements.phone, validatePhone(data.get("phone")) ? "" : t("validation.phone")) && valid;
      }
      const nationalId = String(data.get("nationalId") || "").trim();
      if (nationalId && !/^\d{8,15}$/.test(nationalId.replace(/\D/g, ""))) {
        valid = fieldError(form.elements.nationalId, t("validation.required")) && false;
      } else {
        fieldError(form.elements.nationalId, "");
      }
      if (!valid) {
        return;
      }

      const payload = {
        fullName: data.get("fullName").trim(),
        gender: data.get("gender"),
        birthDate: data.get("birthDate") || "",
        nationality: data.get("nationality").trim(),
        city: data.get("city").trim()
      };
      if (data.get("phone")) {
        payload.phone = data.get("phone").trim();
      }
      if (nationalId) {
        payload.nationalId = nationalId;
      }

      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const profile = await api.request("/api/v1/user/profile", {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        state.profile = profile;
        fillPersonalForm(profile);
        state.loaded.account = true;
        await refreshDashboardQuietly();
        renderHome();
        setMessage("personalMessage", t("portal.saved"), "success");
      } catch (error) {
        setMessage("personalMessage", error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  function setupEmergencyForm() {
    const form = byId("emergencyForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      const phone = String(data.get("phone") || "").trim();
      if ((name && !phone) || (!name && phone)) {
        setMessage("emergencyMessage", t("validation.required"), "error");
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const profile = await api.request("/api/v1/user/emergency-contact", {
          method: "PUT",
          body: JSON.stringify({
            name,
            phone,
            relationship: String(data.get("relationship") || "").trim()
          })
        });
        state.profile = profile;
        fillEmergencyForm(profile.emergencyContact);
        setMessage("emergencyMessage", t("portal.saved"), "success");
      } catch (error) {
        setMessage("emergencyMessage", error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  function setupPasswordForm() {
    const form = byId("passwordForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      let valid = true;
      valid = fieldError(form.elements.currentPassword, data.get("currentPassword") ? "" : t("validation.required")) && valid;
      valid = fieldError(
        form.elements.nextPassword,
        String(data.get("nextPassword") || "").length >= 8 ? "" : t("auth.passwordHint")
      ) && valid;
      if (!valid) {
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api.request("/api/v1/user/password", {
          method: "PATCH",
          body: JSON.stringify({
            currentPassword: data.get("currentPassword"),
            nextPassword: data.get("nextPassword")
          })
        });
        form.reset();
        setMessage("passwordMessage", t("portal.security.passwordChanged"), "success");
        state.loaded.sessions = false;
        await loadSessions(true);
      } catch (error) {
        setMessage("passwordMessage", error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  function setupPrefsForm() {
    const form = byId("prefsForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api.request("/api/v1/user/notifications/preferences", {
          method: "PUT",
          body: JSON.stringify({
            emailTransactional: form.elements.emailTransactional.checked,
            smsTransactional: form.elements.smsTransactional.checked,
            emailMarketing: form.elements.emailMarketing.checked,
            smsMarketing: form.elements.smsMarketing.checked,
            whatsappMarketing: form.elements.whatsappMarketing.checked
          })
        });
        setMessage("prefsMessage", t("portal.saved"), "success");
      } catch (error) {
        setMessage("prefsMessage", error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function renewMembership(button) {
    const messageNode = document.querySelector("[data-renew-message]");
    const plans = state.publicData?.plans || [];
    const currentPlanId = state.dashboard?.membership?.plan?.id;
    const plan =
      plans.find((item) => String(item.id) === String(currentPlanId)) ||
      plans.find((item) => item.highlighted) ||
      plans[0];
    if (!plan) {
      window.location.href = "/#plans";
      return;
    }
    if (button) {
      button.disabled = true;
    }
    try {
      const result = await api.request("/api/v1/payments/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id })
      });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      setMessage(messageNode, t("user.stripePrepared"), "success");
    } catch (error) {
      setMessage(messageNode, error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Global event delegation
   * ------------------------------------------------------------------ */
  function setupEvents() {
    document.querySelectorAll("[data-portal-tab]").forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.portalTab));
    });

    document.querySelector("#portalNav")?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      const buttons = [...document.querySelectorAll("[data-portal-tab]")];
      const index = buttons.findIndex((button) => button.classList.contains("is-active"));
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = buttons[(index + delta + buttons.length) % buttons.length];
      next?.focus();
      next?.click();
    });

    document.body.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action],[data-retry],[data-receipt],[data-payments-page],[data-notif-page],[data-notif-filter],[data-mark-read],[data-goto-tab],[data-revoke-session]");
      if (!target) {
        return;
      }

      if (target.dataset.action === "renew") {
        renewMembership(target);
      } else if (target.dataset.retry) {
        retry(target.dataset.retry);
      } else if (target.dataset.receipt) {
        toggleReceipt(target.dataset.receipt);
      } else if (target.dataset.paymentsPage) {
        state.payments.page += target.dataset.paymentsPage === "next" ? 1 : -1;
        state.payments.page = Math.min(Math.max(state.payments.page, 1), state.payments.pages);
        loadPayments(true);
      } else if (target.dataset.notifPage) {
        state.notifications.page += target.dataset.notifPage === "next" ? 1 : -1;
        state.notifications.page = Math.min(Math.max(state.notifications.page, 1), state.notifications.pages);
        loadNotifications(true);
      } else if (target.dataset.notifFilter) {
        state.notifications.filter = target.dataset.notifFilter;
        state.notifications.page = 1;
        document.querySelectorAll("[data-notif-filter]").forEach((button) => {
          button.classList.toggle("is-active", button.dataset.notifFilter === target.dataset.notifFilter);
        });
        loadNotifications(true);
      } else if (target.dataset.markRead) {
        markRead(target.dataset.markRead);
      } else if (target.dataset.gotoTab) {
        setTab(target.dataset.gotoTab);
      } else if (target.dataset.revokeSession) {
        revokeSession(target.dataset.revokeSession);
      }
    });

    byId("markAllRead")?.addEventListener("click", markAllRead);
    byId("revokeOthers")?.addEventListener("click", revokeOtherSessions);

    [byId("logoutButton"), byId("logoutButton2")].forEach((button) => {
      button?.addEventListener("click", async () => {
        try {
          await api.logout(false);
        } catch (_error) {
          api.clearSession();
        }
        window.location.href = "/";
      });
    });

    const toggle = document.querySelector(".nav-toggle");
    const panel = byId("siteNav");
    toggle?.addEventListener("click", () => {
      const isOpen = panel.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    window.addEventListener("languagechange", () => {
      renderBrand();
      renderHome();
      if (state.profile) {
        fillPersonalForm(state.profile);
        renderGymContact();
      }
      state.loaded.membership = false;
      state.loaded.payments = false;
      state.loaded.notifications = false;
      state.loaded.sessions = false;
      loadTab(state.activeTab);
    });
  }

  function retry(which) {
    if (which === "initial") {
      loadInitial();
    } else if (which === "membership") {
      loadMembership(true);
    } else if (which === "payments") {
      loadPayments(true);
    } else if (which === "notifications") {
      loadNotifications(true);
    } else if (which === "sessions") {
      loadSessions(true);
    }
  }

  async function revokeSession(id) {
    try {
      const result = await api.request(`/api/v1/user/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (result.wasCurrent) {
        api.clearSession();
        window.location.href = "/login.html";
        return;
      }
      state.loaded.sessions = false;
      await loadSessions(true);
    } catch (error) {
      setMessage("sessionsMessage", error.message, "error");
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm(t("portal.confirmRevokeOthers"))) {
      return;
    }
    try {
      await api.request("/api/v1/user/sessions/revoke-others", { method: "POST" });
      state.loaded.sessions = false;
      await loadSessions(true);
      setMessage("sessionsMessage", t("portal.saved"), "success");
    } catch (error) {
      setMessage("sessionsMessage", error.message, "error");
    }
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */
  async function init() {
    setupEvents();
    setupAvatar();
    setupPersonalForm();
    setupEmergencyForm();
    setupPasswordForm();
    setupPrefsForm();

    await ensureSessionOrRedirect();
    await loadInitial();

    const hash = String(window.location.hash || "").replace("#", "");
    if (["membership", "payments", "notifications", "account"].includes(hash)) {
      setTab(hash);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
