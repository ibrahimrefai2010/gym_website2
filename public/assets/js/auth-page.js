(function authPage() {
  const state = {
    publicData: window.GYM_DEFAULT_DATA,
    mode: "login"
  };

  function t(key) {
    return window.GymI18n.t(key);
  }

  function setMessage(text, tone) {
    const message = document.querySelector("#authMessage");
    if (!message) {
      return;
    }
    message.textContent = text;
    message.style.color = tone === "success" ? "#115e38" : "";
  }

  function clearFieldErrors(form) {
    form.querySelectorAll(".field").forEach((field) => {
      field.classList.remove("has-error");
      const error = field.querySelector(".field-error");
      if (error) {
        error.textContent = "";
      }
    });
  }

  function setMode(mode) {
    state.mode = mode;
    const heading = document.querySelector("#authHeading");
    if (heading) {
      heading.textContent = mode === "register" ? t("auth.registerTitle") : t("auth.title");
    }
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      const isActive = button.dataset.authMode === mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.dataset.authPanel !== mode);
      clearFieldErrors(panel);
    });
    setMessage("", "neutral");
  }

  function renderBrand() {
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = window.GymI18n.localize(state.publicData.brand?.localeName);
    });
  }

  function imageUrl(value) {
    return String(value || "").trim();
  }

  function renderSiteImages() {
    const images = state.publicData.siteImages || window.GYM_DEFAULT_DATA.siteImages || {};
    document.querySelectorAll("[data-site-picture]").forEach((picture) => {
      const image = images[picture.dataset.sitePicture];
      if (!image) {
        return;
      }
      const source = picture.querySelector("source");
      const img = picture.querySelector("img");
      const primary = imageUrl(image.imageUrl);
      const fallback = imageUrl(image.fallbackImageUrl || image.imageUrl);
      if (source && primary) {
        source.srcset = primary;
        if (/\.webp(?:[?#].*)?$/i.test(primary)) {
          source.type = "image/webp";
        } else {
          source.removeAttribute("type");
        }
      }
      if (img && fallback) {
        img.src = fallback;
      }
    });
  }

  function ensureFieldError(field) {
    let error = field.querySelector(".field-error");
    if (!error) {
      error = document.createElement("span");
      error.className = "field-error";
      field.appendChild(error);
    }
    return error;
  }

  function validateField(input) {
    const field = input.closest(".field");
    if (!field) return true;
    let message = input.required && !String(input.value || "").trim() ? t("validation.required") : "";
    if (!message && input.type === "email" && input.value && !input.validity.valid) {
      message = t("validation.email");
    }
    field.classList.toggle("has-error", Boolean(message));
    ensureFieldError(field).textContent = message;
    return !message;
  }

  function validateForm(form) {
    return [...form.querySelectorAll("input")].map(validateField).every(Boolean);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const data = new FormData(form);

    if (!validateForm(form)) {
      return;
    }

    submit.disabled = true;
    setMessage("", "neutral");

    const identifier = data.get("identifier");
    const password = data.get("password");
    const looksLikeEmail = String(identifier || "").includes("@");
    const order = looksLikeEmail ? [true, false] : [false, true];

    try {
      let result;
      let lastError;
      for (const asAdmin of order) {
        try {
          result = await window.GymApi.login(identifier, password, asAdmin);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!result) {
        throw lastError || new Error(t("auth.error") || "Sign in failed.");
      }

      // Confirm the refresh-cookie session is usable before navigating away,
      // so the destination page never bounces back to login.
      try {
        await window.GymApi.refreshSession();
      } catch (_refreshError) {
        /* fall through: access token in memory is still valid for this navigation */
      }

      setMessage(t("auth.success"), "success");
      window.setTimeout(() => {
        window.location.href = result.user.type === "admin" ? "/admin.html" : "/user.html";
      }, 200);
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  function handleForgotPassword() {
    const identifier = document.querySelector("#identifier")?.value || "";
    const query = identifier ? `?id=${encodeURIComponent(identifier)}` : "";
    window.location.href = `/reset-password.html${query}`;
  }

  async function handleRegister(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const data = new FormData(form);

    if (!validateForm(form)) {
      return;
    }

    submit.disabled = true;
    setMessage("", "neutral");

    try {
      await window.GymApi.register({
        fullName: data.get("fullName"),
        email: data.get("email"),
        phone: data.get("phone"),
        password: data.get("password")
      });
      setMessage(t("auth.registerSuccess"), "success");
      window.setTimeout(() => {
        window.location.href = "/user.html";
      }, 420);
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function init() {
    state.publicData = await window.GymApi.bootstrap();
    renderSiteImages();
    renderBrand();
    document.querySelector("#loginForm")?.addEventListener("submit", handleLogin);
    document.querySelector("#registerForm")?.addEventListener("submit", handleRegister);
    document.querySelector("#forgotPassword")?.addEventListener("click", handleForgotPassword);
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.authMode));
    });
    document.querySelectorAll("#loginForm input, #registerForm input").forEach((input) => {
      input.addEventListener("blur", () => validateField(input));
      input.addEventListener("input", () => {
        if (input.closest(".field")?.classList.contains("has-error")) {
          validateField(input);
        }
      });
    });
    setMode(state.mode);
    window.addEventListener("languagechange", () => {
      renderBrand();
      setMode(state.mode);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
