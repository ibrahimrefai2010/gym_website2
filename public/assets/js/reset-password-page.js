(function resetPasswordPage() {
  const i18n = window.GymI18n;
  const api = window.GymApi;

  const state = { identifier: "", resetToken: "" };

  function t(key) {
    return i18n.t(key);
  }

  function setMessage(text, tone) {
    const node = document.querySelector("#resetMessage");
    if (!node) {
      return;
    }
    node.textContent = text || "";
    node.style.color = tone === "success" ? "#115e38" : "";
  }

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

  function showStep(id) {
    ["stepIdentifier", "stepCode", "stepPassword", "stepDone"].forEach((step) => {
      document.querySelector(`#${step}`)?.classList.toggle("is-hidden", step !== id);
    });
    setMessage("", "neutral");
    const first = document.querySelector(`#${id} input`);
    if (first) {
      first.focus();
    }
  }

  function strongPassword(value) {
    return (
      String(value || "").length >= 8 &&
      /[A-Z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^A-Za-z0-9]/.test(value)
    );
  }

  async function submitIdentifier(event) {
    event.preventDefault();
    const input = document.querySelector("#identifier");
    if (!fieldError(input, input.value.trim() ? "" : t("validation.required"))) {
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      state.identifier = input.value.trim();
      await api.forgotPassword(state.identifier);
      setMessage(t("reset.sent"), "success");
      showStep("stepCode");
      setMessage(t("reset.sent"), "success");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    const input = document.querySelector("#otp");
    const value = input.value.replace(/\D/g, "");
    if (!fieldError(input, value.length === 6 ? "" : t("reset.invalidCode"))) {
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = await api.request("/api/v1/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ identifier: state.identifier, otp: value })
      });
      state.resetToken = data.reset_token || data.resetToken;
      showStep("stepPassword");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function resend() {
    try {
      await api.forgotPassword(state.identifier);
      setMessage(t("reset.sent"), "success");
    } catch (error) {
      setMessage(error.message, "error");
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const next = document.querySelector("#newPassword");
    const confirm = document.querySelector("#confirmPassword");
    let valid = fieldError(next, strongPassword(next.value) ? "" : t("auth.passwordHint"));
    valid = fieldError(confirm, next.value === confirm.value ? "" : t("reset.mismatch")) && valid;
    if (!valid) {
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api.request("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ reset_token: state.resetToken, password: next.value })
      });
      showStep("stepDone");
      setMessage(t("reset.success"), "success");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("id");
    if (prefill) {
      const input = document.querySelector("#identifier");
      if (input) {
        input.value = prefill;
      }
    }
    document.querySelector("#stepIdentifier")?.addEventListener("submit", submitIdentifier);
    document.querySelector("#stepCode")?.addEventListener("submit", submitCode);
    document.querySelector("#stepPassword")?.addEventListener("submit", submitPassword);
    document.querySelector("#resendCode")?.addEventListener("click", resend);
    window.addEventListener("languagechange", () => setMessage("", "neutral"));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
