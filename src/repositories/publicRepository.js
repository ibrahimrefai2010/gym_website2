const { hasDatabaseConfig, query } = require("../config/database");
const fallbackData = require("../db/fallbackData");
const planRepository = require("./planRepository");
const offerRepository = require("./offerRepository");
const settingsRepository = require("./settingsRepository");
const sliderRepository = require("./sliderRepository");
const { appLogger } = require("../utils/logger");

async function optionalRows(sql, params = []) {
  try {
    return await query(sql, params);
  } catch (error) {
    appLogger.warn({ error: error.message }, "Optional public table query failed");
    return [];
  }
}

async function getDatabaseBootstrap() {
  const [plans, offers, settings, slides, homepageRows] = await Promise.all([
    planRepository.listPlans(),
    offerRepository.listOffers(),
    settingsRepository.publicSettings(),
    sliderRepository.listSlides(),
    optionalRows("SELECT section_key, title_en, title_ar, body_en, body_ar FROM homepage_text")
  ]);

  const homepage = homepageRows.reduce((result, row) => {
    result[row.section_key] = {
      title: { en: row.title_en || "", ar: row.title_ar || "" },
      headline: { en: row.title_en || "", ar: row.title_ar || "" },
      body: { en: row.body_en || "", ar: row.body_ar || "" }
    };
    return result;
  }, {});

  const dynamic = settingsRepository.settingsToBootstrap(settings);

  return {
    ...fallbackData,
    brand: dynamic.brand,
    homepage: {
      ...fallbackData.homepage,
      ...homepage
    },
    plans: plans.length > 0 ? plans : fallbackData.plans,
    offers: offers.length > 0 ? offers : fallbackData.offers,
    slides: slides.length > 0 ? slides : fallbackData.slides,
    faqs: fallbackData.faqs,
    siteImages: dynamic.siteImages,
    contact: dynamic.contact,
    workingHours: dynamic.workingHours
  };
}

async function getBootstrap() {
  const homepage = {
    ...fallbackData.homepage,
    about: {
      ...fallbackData.homepage.about,
      body: {
        en: "The club combines refined training spaces, structured membership plans, and attentive service for members who value quality over noise.",
        ar: "يجمع النادي بين مساحات تدريب راقية، وباقات عضوية منظمة، وخدمة دقيقة للأعضاء الذين يقدّرون الجودة قبل الضجيج."
      }
    }
  };

  if (!hasDatabaseConfig()) {
    const settings = await settingsRepository.publicSettings();
    const dynamic = settingsRepository.settingsToBootstrap(settings);
    return {
      ...fallbackData,
      brand: dynamic.brand,
      homepage,
      siteImages: dynamic.siteImages,
      contact: dynamic.contact,
      workingHours: dynamic.workingHours
    };
  }

  const data = await getDatabaseBootstrap();
  return {
    ...data,
    homepage: {
      ...homepage,
      ...data.homepage
    }
  };
}

module.exports = {
  getBootstrap
};
