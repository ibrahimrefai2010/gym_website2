(function demoBanner() {
  var DISMISS_KEY = "mfc.demoBanner.dismissed";

  function copy() {
    var lang =
      (window.GymI18n && window.GymI18n.currentLang && window.GymI18n.currentLang()) ||
      (document.documentElement.lang === "ar" ? "ar" : "en");
    if (lang === "ar") {
      return {
        text: "بيئة تجريبية — بيانات نموذجية تُعاد ضبطها دورياً.",
        login: "دخول عضو تجريبي: demo@muscle-fitness.local / Demo@12345",
        dismiss: "إخفاء"
      };
    }
    return {
      text: "Demo environment — sample data, resets periodically.",
      login: "Demo member login: demo@muscle-fitness.local / Demo@12345",
      dismiss: "Dismiss"
    };
  }

  function render() {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") {
        return;
      }
    } catch (_error) {
      /* ignore */
    }
    if (document.getElementById("demoBanner")) {
      return;
    }

    var c = copy();
    var bar = document.createElement("div");
    bar.id = "demoBanner";
    bar.setAttribute("role", "note");
    bar.style.cssText =
      "position:fixed;inset-inline:0;bottom:0;z-index:9999;display:flex;gap:12px;" +
      "align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 14px;" +
      "background:#101010;color:#fff;font:600 12px/1.4 system-ui,Segoe UI,sans-serif;" +
      "border-top:2px solid #c8a867;text-align:center";

    var msg = document.createElement("span");
    msg.textContent = c.text;

    var login = document.createElement("span");
    login.textContent = c.login;
    login.style.cssText = "color:#c8a867;font-weight:700";

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "× " + c.dismiss;
    close.setAttribute("aria-label", c.dismiss);
    close.style.cssText =
      "border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;" +
      "border-radius:6px;padding:3px 9px;font:inherit;cursor:pointer";
    close.addEventListener("click", function () {
      try {
        sessionStorage.setItem(DISMISS_KEY, "1");
      } catch (_error) {
        /* ignore */
      }
      bar.remove();
      document.body.style.removeProperty("padding-bottom");
    });

    bar.appendChild(msg);
    bar.appendChild(login);
    bar.appendChild(close);
    document.body.appendChild(bar);
    document.body.style.paddingBottom = bar.offsetHeight + 8 + "px";

    window.addEventListener("languagechange", function () {
      var next = copy();
      msg.textContent = next.text;
      login.textContent = next.login;
      close.textContent = "× " + next.dismiss;
    });
  }

  async function init() {
    try {
      var response = await fetch("/api/v1/public/health", { headers: { Accept: "application/json" } });
      var payload = await response.json();
      if (payload && payload.data && payload.data.demo) {
        render();
      }
    } catch (_error) {
      /* health check unavailable: no banner */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
