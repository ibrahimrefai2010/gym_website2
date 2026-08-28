(function privacyPage() {
  function currentLang() {
    if (window.GymI18n && typeof window.GymI18n.currentLang === "function") {
      return window.GymI18n.currentLang();
    }
    return document.documentElement.lang === "ar" ? "ar" : "en";
  }

  function apply() {
    const lang = currentLang();
    const en = document.getElementById("privacyEn");
    const ar = document.getElementById("privacyAr");
    if (en) {
      en.hidden = lang === "ar";
    }
    if (ar) {
      ar.hidden = lang !== "ar";
    }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title =
      lang === "ar"
        ? "مركز بناء ولياقة الرياضي | إشعار الخصوصية"
        : "Muscle and Fitness Center | Privacy Notice";

    const stamp = new Date().toISOString().slice(0, 10);
    document.querySelectorAll("[data-privacy-date]").forEach((node) => {
      node.textContent = stamp;
    });
  }

  document.addEventListener("DOMContentLoaded", apply);
  window.addEventListener("languagechange", apply);
})();
