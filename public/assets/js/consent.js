// Cookie consent (Saudi PDPL) + analytics loader (Part 2 §2.7.7).
//
// Nothing but essential cookies until the visitor chooses. Google Analytics
// 4 and the Meta Pixel are loaded only after "Accept analytics", and only
// when their IDs are configured (GA4_MEASUREMENT_ID / META_PIXEL_ID, sent in
// the public bootstrap). The choice is remembered in localStorage (a
// per-browser preference) and can be changed from "Cookie settings".
(function cookieConsent() {
  const KEY = "mf.consent";
  let analytics = null;
  let loaded = false;

  function readChoice() {
    try {
      return localStorage.getItem(KEY);
    } catch (_error) {
      return null;
    }
  }

  function saveChoice(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (_error) {
      /* storage blocked: ask again next visit */
    }
  }

  function loadScript(src) {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  function loadAnalytics() {
    if (loaded || !analytics) return;
    loaded = true;
    const ga = String(analytics.ga4MeasurementId || "");
    if (/^G-[A-Z0-9]+$/i.test(ga)) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() {
        window.dataLayer.push(arguments);
      };
      window.gtag("js", new Date());
      window.gtag("config", ga, { anonymize_ip: true });
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`);
    }
    const pixel = String(analytics.metaPixelId || "");
    if (/^\d{5,20}$/.test(pixel)) {
      const fbq = function fbq() {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
      };
      fbq.queue = [];
      fbq.loaded = true;
      fbq.version = "2.0";
      window.fbq = window.fbq || fbq;
      window._fbq = window.fbq;
      window.fbq("init", pixel);
      window.fbq("track", "PageView");
      loadScript("https://connect.facebook.net/en_US/fbevents.js");
    }
  }

  function banner() {
    return document.querySelector("#cookieBanner");
  }

  function showBanner() {
    const node = banner();
    if (node) node.hidden = false;
  }

  function apply(choice) {
    saveChoice(choice);
    const node = banner();
    if (node) node.hidden = true;
    if (choice === "accept") loadAnalytics();
    else if (loaded) {
      // Analytics already ran this page view; stop on the next load.
      window.location.reload();
    }
  }

  window.addEventListener("gym:bootstrap", (event) => {
    analytics = event.detail?.analytics || null;
    const configured = analytics && (analytics.ga4MeasurementId || analytics.metaPixelId);
    const choice = readChoice();
    if (choice === "accept") loadAnalytics();
    // Only ask when there is something optional to consent to.
    else if (!choice && configured) showBanner();
  });

  document.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-cookie-choice]");
    if (choice) apply(choice.dataset.cookieChoice);
    if (event.target.closest("[data-cookie-settings]")) showBanner();
  });
})();
