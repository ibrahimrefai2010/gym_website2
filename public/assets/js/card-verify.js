(function cardVerify() {
  const i18n = window.GymI18n;

  function t(key, repl) {
    return i18n.t(key, repl);
  }

  function localize(value) {
    return i18n.localize(value);
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

  function formatDate(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    const locale = i18n.currentLang() === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB";
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Riyadh"
    }).format(date);
  }

  function stateText(cardState, remainingDays) {
    if (cardState === "expiring_soon") {
      return t("portal.state.expiring_soon", { n: Math.max(Number(remainingDays) || 0, 0) });
    }
    return t(`portal.state.${cardState || "none"}`);
  }

  function render(data) {
    const body = document.querySelector("#verifyBody");
    if (!body) {
      return;
    }
    if (!data) {
      body.innerHTML = `<div class="state-block is-error" role="alert">${escapeHtml(t("card.verify.notFound"))}</div>`;
      return;
    }
    const verdict = data.valid ? t("card.verify.valid") : t("card.verify.invalid");
    body.innerHTML = `
      <p class="status-pill" data-state="${escapeHtml(data.state || "none")}" style="font-size:13px">${escapeHtml(
      verdict
    )}</p>
      <dl class="data-list">
        <div><dt>${escapeHtml(t("card.verify.member"))}</dt><dd>${escapeHtml(data.memberName || "—")}</dd></div>
        <div><dt>${escapeHtml(t("card.verify.memberId"))}</dt><dd>${escapeHtml(data.memberCode || "—")}</dd></div>
        <div><dt>${escapeHtml(t("card.verify.plan"))}</dt><dd>${escapeHtml(localize(data.plan) || "—")}</dd></div>
        <div><dt>${escapeHtml(t("card.verify.expiry"))}</dt><dd>${escapeHtml(formatDate(data.endDate))}</dd></div>
      </dl>
      <p class="field-hint">${escapeHtml(t("card.verify.checkedAt", { date: formatDate(new Date().toISOString()) }))} · ${escapeHtml(
      stateText(data.state, data.remainingDays)
    )}</p>`;
  }

  async function load() {
    const token = new URLSearchParams(window.location.search).get("t");
    if (!token || !/^[a-f0-9]{32}$/i.test(token)) {
      render(null);
      return;
    }
    try {
      const response = await fetch(`/api/v1/public/card/${encodeURIComponent(token)}`, {
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        render(null);
        return;
      }
      render(payload.data);
    } catch (_error) {
      render(null);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    load();
    window.addEventListener("languagechange", load);
  });
})();
