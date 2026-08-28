(function homeModule() {
  const state = {
    data: window.GYM_DEFAULT_DATA,
    slideIndex: 0,
    slideTimer: null
  };

  function i18n() {
    return window.GymI18n;
  }

  function localize(value) {
    return i18n().localize(value);
  }

  function t(key, replacements) {
    return i18n().t(key, replacements);
  }

  function money(amount, currency) {
    return new Intl.NumberFormat(i18n().currentLang() === "ar" ? "ar-SA" : "en-US", {
      style: "currency",
      currency: currency || "SAR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) {
      node.textContent = value;
    }
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

  function imageUrl(value) {
    return String(value || "").trim();
  }

  function siteImages() {
    return state.data.siteImages || window.GYM_DEFAULT_DATA.siteImages || {};
  }

  function renderSiteImages() {
    const images = siteImages();
    const logoUrl = imageUrl(images.logo?.imageUrl);
    document.querySelectorAll('[data-site-image="logo"]').forEach((img) => {
      if (logoUrl) {
        img.src = logoUrl;
      }
    });

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

    const socialImage = imageUrl(images.socialShare?.imageUrl || images.homeHero?.fallbackImageUrl || images.homeHero?.imageUrl);
    const ogImage = document.querySelector("[data-site-og-image]");
    if (ogImage && socialImage) {
      ogImage.content = socialImage;
    }
  }

  function renderBrand() {
    document.querySelectorAll("[data-brand-name]").forEach((node) => {
      node.textContent = localize(state.data.brand?.localeName) || state.data.brand?.name || "Muscle and Fitness Center";
    });
  }

  function renderHomepageCopy() {
    setText("[data-home-hero-title]", localize(state.data.homepage?.hero?.headline));
    setText("[data-home-hero-body]", localize(state.data.homepage?.hero?.body));
    setText("[data-home-about-title]", localize(state.data.homepage?.about?.title));
    setText("[data-home-about-body]", localize(state.data.homepage?.about?.body));
    setText("[data-home-coaching-title]", localize(state.data.homepage?.coaching?.title));
    setText("[data-home-coaching-body]", localize(state.data.homepage?.coaching?.body));
  }

  function renderMetrics() {
    const metrics = document.querySelector("#heroMetrics");
    if (!metrics) {
      return;
    }

    metrics.innerHTML = (state.data.metrics || [])
      .map(
        (item) => `
          <div>
          <dt>${escapeHtml(localize(item.label))}</dt>
          </div>
        `
      )
      .join("");
  }

  function renderPlans() {
    const root = document.querySelector("#plansGrid");
    if (!root) {
      return;
    }

    root.innerHTML = (state.data.plans || [])
      .map((plan) => {
        const features = (plan.features?.[i18n().currentLang()] || plan.features?.en || [])
          .map((feature) => `<li><span class="check" aria-hidden="true">✓</span><span>${escapeHtml(feature)}</span></li>`)
          .join("");
        const price = Number(plan.priceDiscounted || plan.price);
        const original = Number(plan.priceOriginal || plan.price);
        const hasDiscount = original > price;
        const saving = hasDiscount
  ? (((original - price) / original) * 100).toFixed(0)
  : "";

        return `
          <article class="plan-card reveal ${plan.highlighted ? "is-highlighted" : ""}">
            <div class="plan-top">
              ${plan.highlighted ? `<span class="badge">${t("plans.featured")}</span>` : ""}
              <h3>${escapeHtml(localize(plan.name))}</h3>
              <p>${escapeHtml(localize(plan.description))}</p>
            </div>
            <div class="plan-price">
            ${hasDiscount ? `<span class="price-original">${money(original, plan.currency)}</span>` : ""}
              <div class="price-line">
                <strong>${money(price, plan.currency)}</strong>
              </div>
              ${hasDiscount ? `<span class="savings">${t("plans.saving", { amount: saving })}%</span>` : ""}
            </div>
            <ul class="plan-features">${features}</ul>
            <a class="btn ${plan.highlighted ? "" : "ghost"}" href="/login.html">${t("plans.choose")}</a>
          </article>
        `;
      })
      .join("");

    observeReveals();
  }

  function renderOffers() {
    const root = document.querySelector("#offerList");
    if (!root) {
      return;
    }

    root.innerHTML = (state.data.offers || [])
      .map(
        (offer) => `
          <article class="offer-card reveal">
            ${offer.imageUrl ? `<img class="offer-card-image" src="${escapeHtml(offer.imageUrl)}" alt="" loading="lazy">` : ""}
            <span class="badge">${escapeHtml(localize(offer.badge))}</span>
            <h3>${escapeHtml(localize(offer.title))}</h3>
            <p>${escapeHtml(localize(offer.body))}</p>
          </article>
        `
      )
      .join("");

    observeReveals();
  }

  function renderSlides() {
    const root = document.querySelector("#sliderSlides");
    if (!root) {
      return;
    }

    root.innerHTML = (state.data.slides || [])
      .map((slide, index) => {
        const primary = imageUrl(slide.imageUrl);
        const fallback = imageUrl(slide.fallbackImageUrl || slide.imageUrl);
        const source = /\.webp(?:[?#].*)?$/i.test(primary)
          ? `<source srcset="${escapeHtml(primary)}" type="image/webp">`
          : primary
            ? `<source srcset="${escapeHtml(primary)}">`
            : "";
        return `
          <article class="slide ${index === state.slideIndex ? "is-active" : ""}" aria-hidden="${index === state.slideIndex ? "false" : "true"}">
            <picture>
              ${source}
              <img src="${escapeHtml(fallback)}" alt="" loading="${index === 0 ? "eager" : "lazy"}">
            </picture>
            <div class="slide-content">
              <h3>${escapeHtml(localize(slide.title))}</h3>
              <p>${escapeHtml(localize(slide.body))}</p>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function showSlide(nextIndex) {
    const slides = [...document.querySelectorAll(".slide")];
    if (slides.length === 0) {
      return;
    }

    state.slideIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const isActive = index === state.slideIndex;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });
  }

  function setupSlider() {
    const slider = document.querySelector("#offersSlider");
    if (!slider) {
      return;
    }

    document.querySelector("[data-slide-prev]")?.addEventListener("click", () => showSlide(state.slideIndex - 1));
    document.querySelector("[data-slide-next]")?.addEventListener("click", () => showSlide(state.slideIndex + 1));

    window.clearInterval(state.slideTimer);
    state.slideTimer = window.setInterval(() => showSlide(state.slideIndex + 1), 7000);

    slider.addEventListener("mouseenter", () => window.clearInterval(state.slideTimer));
    slider.addEventListener("mouseleave", () => {
      state.slideTimer = window.setInterval(() => showSlide(state.slideIndex + 1), 7000);
    });
  }

  function renderFaqs() {
    const root = document.querySelector("#faqList");
    if (!root) {
      return;
    }

    const faqs = window.GYM_DEFAULT_DATA?.faqs || state.data.faqs || [];

    root.innerHTML = faqs
      .map(
        (faq, index) => `
          <article class="faq-item ${index === 0 ? "is-open" : ""}">
            <h3>
              <button class="faq-question" type="button" aria-expanded="${index === 0 ? "true" : "false"}">
                <span>${escapeHtml(localize(faq.question))}</span>
                <span aria-hidden="true">+</span>
              </button>
            </h3>
            <div class="faq-answer">
              <p>${escapeHtml(localize(faq.answer))}</p>
            </div>
          </article>
        `
      )
      .join("");
  }

  function setupFaqs() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".faq-question");
      if (!button) {
        return;
      }

      const item = button.closest(".faq-item");
      const isOpen = item.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  }

  function renderContact() {
    const contact = state.data.contact || {};
    setText("[data-contact-phone]", contact.phone || "");
    setText("[data-contact-email]", contact.email || "");
    setText("[data-contact-address]", localize(contact.address));
    /*
    const map = document.querySelector("#mapFrame");
    if (map && contact.mapEmbedUrl) {
      map.src = contact.mapEmbedUrl;
    }
      */

    const whatsapp = document.querySelectorAll("[data-whatsapp-link]");
    whatsapp.forEach((link) => {
      link.href = `https://wa.me/${contact.whatsapp || ""}`;
    });

    const hoursRoot = document.querySelector("#workingHours");
    if (hoursRoot) {
      hoursRoot.innerHTML = (state.data.workingHours || [])
        .map(
          (item) => `
            <li>
              <span>${escapeHtml(localize(item.day))}</span>
              <strong>${escapeHtml(localize(item.hours))}</strong>
            </li>
          `
        )
        .join("");
    }
  }

  function setupCalculators() {
    document.querySelectorAll("[data-calc-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const calculator = button.dataset.calcTab;
        document.querySelectorAll("[data-calc-tab]").forEach((tab) => {
          tab.setAttribute("aria-selected", String(tab === button));
        });
        document.querySelectorAll("[data-calc-panel]").forEach((panel) => {
          panel.classList.toggle("is-active", panel.dataset.calcPanel === calculator);
        });
      });
    });

    const calculateBmi = () => {
      const form = document.querySelector("#bmiForm");
      if (!form) return;
      const data = new FormData(form);
      const weight = Number(data.get("weight"));
      const height = Number(data.get("height")) / 100;
      if (!weight || !height) return;
      const bmi = weight / (height * height);
      const label =
        bmi < 18.5
          ? t("result.underweight")
          : bmi < 25
            ? t("result.healthy")
            : bmi < 30
              ? t("result.overweight")
              : t("result.obesity");
      renderResult("#bmiResult", bmi.toFixed(1), label, t("result.bmiNote"));
    };

    const calculateCalories = () => {
      const form = document.querySelector("#calorieForm");
      if (!form) return;
      const data = new FormData(form);
      const sex = data.get("sex");
      const weight = Number(data.get("weight"));
      const height = Number(data.get("height"));
      const age = Number(data.get("age"));
      if (!weight || !height || !age) return;
      const activity = Number(data.get("activity"));
      const goal = Number(data.get("goal"));
      const base = 10 * weight + 6.25 * height - 5 * age + (sex === "male" ? 5 : -161);
      const calories = Math.round(base * activity + goal);
      renderResult(
        "#calorieResult",
        calories.toLocaleString(i18n().currentLang() === "ar" ? "ar-SA" : "en-US"),
        t("result.kcalDay"),
        t("result.calorieNote")
      );
    };

    const calculateMacros = () => {
      const form = document.querySelector("#macroForm");
      if (!form) return;
      const data = new FormData(form);
      const calories = Number(data.get("calories"));
      if (!calories) return;
      const goal = data.get("goal");
      const splits = {
        balanced: [0.3, 0.4, 0.3],
        loss: [0.35, 0.35, 0.3],
        gain: [0.28, 0.47, 0.25]
      };
      const [proteinRate, carbRate, fatRate] = splits[goal] || splits.balanced;
      const protein = Math.round((calories * proteinRate) / 4);
      const carbs = Math.round((calories * carbRate) / 4);
      const fat = Math.round((calories * fatRate) / 9);
      renderResult("#macroResult", `${protein}g / ${carbs}g / ${fat}g`, t("result.macros"), t("result.macroNote"));
    };

    [
      ["#bmiForm", calculateBmi],
      ["#calorieForm", calculateCalories],
      ["#macroForm", calculateMacros]
    ].forEach(([selector, calculate]) => {
      const form = document.querySelector(selector);
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        calculate();
      });
      form?.addEventListener("input", calculate);
      form?.addEventListener("change", calculate);
      calculate();
    });
  }

  function setupContactForm() {
    document.querySelector("#contactForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form).entries());
      const status = document.querySelector("#contactMessageStatus");
      if (!validateForm(form)) {
        return;
      }
      try {
        await window.GymApi.request("/api/v1/messages", {
          method: "POST",
          body: JSON.stringify(data)
        });
        form.reset();
        if (status) {
          status.textContent = t("contact.sent");
          status.style.color = "#115e38";
        }
      } catch (error) {
        if (status) {
          status.textContent = error.message;
          status.style.color = "";
        }
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
    if (!field) {
      return true;
    }

    let message = "";
    if (input.required && !String(input.value || "").trim()) {
      message = t("validation.required");
    } else if (input.type === "email" && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
      message = t("validation.email");
    } else if (input.type === "tel" && input.value && input.value.replace(/[^\d]/g, "").length < 8) {
      message = t("validation.phone");
    }

    field.classList.toggle("has-error", Boolean(message));
    ensureFieldError(field).textContent = message;
    return !message;
  }

  function validateForm(form) {
    return [...form.querySelectorAll("input, textarea, select")].map(validateField).every(Boolean);
  }

  function setupInlineValidation() {
    document.querySelectorAll("form input, form textarea, form select").forEach((input) => {
      input.addEventListener("blur", () => validateField(input));
      input.addEventListener("input", () => {
        if (input.closest(".field")?.classList.contains("has-error")) {
          validateField(input);
        }
      });
    });
  }

  function renderResult(selector, value, label, explanation) {
    const result = document.querySelector(selector);
    if (!result) {
      return;
    }

    result.innerHTML = `<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><p class="result-explanation">${escapeHtml(explanation || "")}</p>`;
  }

  function setupNav() {
    const toggle = document.querySelector(".nav-toggle");
    const panel = document.querySelector("#siteNav");

    toggle?.addEventListener("click", () => {
      const isOpen = panel.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("is-locked", isOpen);
    });

    panel?.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        panel.classList.remove("is-open");
        toggle?.setAttribute("aria-expanded", "false");
        document.body.classList.remove("is-locked");
      }
    });

    document.addEventListener("click", (event) => {
      if (!panel?.classList.contains("is-open")) {
        return;
      }
      if (event.target.closest("#siteNav") || event.target.closest(".nav-toggle")) {
        return;
      }
      panel.classList.remove("is-open");
      toggle?.setAttribute("aria-expanded", "false");
      document.body.classList.remove("is-locked");
    });
  }

  function setupRipple() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".btn");
      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "btn-ripple";
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      button.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 560);
    });
  }

  let revealObserver;

  function observeReveals() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach((node) => node.classList.add("is-visible"));
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.18 }
      );
    }

    document.querySelectorAll(".reveal:not(.is-visible)").forEach((node) => revealObserver.observe(node));
  }

  function setStructuredData() {
    const contact = state.data.contact || {};
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "HealthClub",
      name: state.data.brand?.name || "Muscle and Fitness Center",
      telephone: contact.phone,
      email: contact.email,
      address: localize(contact.address),
      url: window.location.origin
    });
    document.head.appendChild(script);
  }

  function renderAll() {
    renderSiteImages();
    renderBrand();
    renderHomepageCopy();
    renderMetrics();
    renderPlans();
    renderOffers();
    renderSlides();
    renderFaqs();
    renderContact();
    i18n().applyTranslations();
  }

  async function init() {
    setupNav();
    setupFaqs();
    setupCalculators();
    setupContactForm();
    setupInlineValidation();
    setupRipple();

    state.data = await window.GymApi.bootstrap();
    renderAll();
    setupSlider();
    observeReveals();
    setStructuredData();

    const year = document.querySelector("[data-current-year]");
    if (year) {
      year.textContent = String(new Date().getFullYear());
    }

    window.addEventListener("languagechange", () => {
      renderAll();
      showSlide(state.slideIndex);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
