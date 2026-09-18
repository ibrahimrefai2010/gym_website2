const { hasDatabaseConfig, query } = require("../config/database");
const fallbackData = require("../db/fallbackData");
const { createHttpError } = require("../utils/httpError");
const { cleanImageReference } = require("../utils/imageReference");

const publicKeys = [
  "gym_name_en",
  "gym_name_ar",
  "phone_number",
  "whatsapp_number",
  "google_maps_url",
  "working_hours_ar",
  "working_hours_en",
  "site_logo_url",
  "home_hero_image_url",
  "home_hero_fallback_image_url",
  "auth_hero_image_url",
  "auth_hero_fallback_image_url",
  "social_share_image_url"
];

const siteImageSettings = [
  ["logoUrl", "site_logo_url", "Site logo URL"],
  ["homeHeroImageUrl", "home_hero_image_url", "Home hero image URL"],
  ["homeHeroFallbackImageUrl", "home_hero_fallback_image_url", "Home hero fallback image URL"],
  ["authHeroImageUrl", "auth_hero_image_url", "Login hero image URL"],
  ["authHeroFallbackImageUrl", "auth_hero_fallback_image_url", "Login hero fallback image URL"],
  ["socialShareImageUrl", "social_share_image_url", "Social share image URL"]
];

const fallbackSettings = {
  gym_name_en: "Muscle and Fitness Center",
  gym_name_ar: "مركز بناء ولياقة الرياضي",
  phone_number: "+966569919944",
  whatsapp_number: "966569919944",
  google_maps_url: "https://maps.google.com/?q=Hyper+Panda+Roundabout+Jizan+Saudi+Arabia",
  working_hours_ar: "السبت - الخميس: 6ص - 11م  |  الجمعة: 4م - 11م",
  working_hours_en: "Sat - Thu: 6AM - 11PM  |  Fri: 4PM - 11PM",
  membership_activation_mode: "manual",
  site_logo_url: "/assets/logo.png",
  home_hero_image_url: "/assets/images/hero-gym.webp",
  home_hero_fallback_image_url: "/assets/images/hero-gym.png",
  auth_hero_image_url: "/assets/images/hero-gym.webp",
  auth_hero_fallback_image_url: "/assets/images/hero-gym.png",
  social_share_image_url: "/assets/images/hero-gym.png"
};

function castSetting(row) {
  if (!row) return null;
  if (row.type === "number") return Number(row.value);
  if (row.type === "boolean") return String(row.value).toLowerCase() === "true" || row.value === "1";
  if (row.type === "json") {
    try {
      return JSON.parse(row.value || "null");
    } catch (_error) {
      return null;
    }
  }
  return row.value;
}

async function listSettings() {
  if (!hasDatabaseConfig()) {
    return fallbackSettings;
  }

  const rows = await query("SELECT key_name, value, type, label_en, label_ar FROM settings ORDER BY key_name ASC");
  return rows.reduce((result, row) => {
    result[row.key_name] = castSetting(row);
    return result;
  }, {});
}

async function getSetting(key, fallback = null) {
  if (!hasDatabaseConfig()) {
    return fallbackSettings[key] ?? fallback;
  }

  const rows = await query("SELECT key_name, value, type FROM settings WHERE key_name = ? LIMIT 1", [key]);
  return rows[0] ? castSetting(rows[0]) : fallback;
}

// NOTE: `settings` is keyed on `key_name` alone (global, not per-branch) --
// giving it real per-branch storage would mean restructuring its primary key
// (key_name is not branch-scoped today) and touching every other call site
// that assumes one global row per key. That restructure isn't part of the
// owner-confirmed branch decisions (only plans/offers/invoices/business
// registration were), so it's deferred to the branch-content seeding phase.
// `branchId` is accepted here for forward-compatibility with callers that
// already pass it (e.g. publicRepository.getBootstrap) but is currently a
// no-op: every branch reads the same global settings row.
async function publicSettings(_branchId = null) {
  if (!hasDatabaseConfig()) {
    return publicKeys.reduce((result, key) => {
      result[key] = fallbackSettings[key];
      return result;
    }, {});
  }

  const rows = await query("SELECT key_name, value, type FROM settings");
  const data = rows.reduce((result, row) => {
    result[row.key_name] = castSetting(row);
    return result;
  }, {});
  return publicKeys.reduce((result, key) => {
    result[key] = data[key] ?? fallbackSettings[key];
    return result;
  }, {});
}

async function saveSetting(key, value, adminId = null, type = "string") {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }

  if (!/^[a-z0-9_:-]{1,100}$/.test(key)) {
    throw createHttpError(422, "Setting key is invalid.", "SETTING_KEY_INVALID");
  }
  if (!["string", "number", "boolean", "json"].includes(type)) {
    throw createHttpError(422, "Setting type is invalid.", "SETTING_TYPE_INVALID");
  }
  if (type === "json") {
    try {
      JSON.parse(value || "null");
    } catch (_error) {
      throw createHttpError(422, "Setting value must be valid JSON.", "SETTING_JSON_INVALID");
    }
  }
  if (type === "number" && !Number.isFinite(Number(value))) {
    throw createHttpError(422, "Setting value must be a number.", "SETTING_NUMBER_INVALID");
  }
  if (type === "boolean" && !/^(true|false|1|0)$/i.test(String(value))) {
    throw createHttpError(422, "Setting value must be boolean.", "SETTING_BOOLEAN_INVALID");
  }

  await query(
    `INSERT INTO settings (key_name, value, type, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()`,
    [key, value, type || "string", adminId]
  );

  return { key, value, type: type || "string" };
}

async function saveSiteImages(payload, adminId = null) {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }

  const saved = {};
  for (const [payloadKey, settingKey, label] of siteImageSettings) {
    if (payload[payloadKey] === undefined) {
      continue;
    }
    const value = cleanImageReference(payload[payloadKey], label);
    await saveSetting(settingKey, value, adminId, "string");
    saved[payloadKey] = value;
  }

  const settings = await publicSettings();
  return {
    saved,
    siteImages: settingsToBootstrap(settings).siteImages
  };
}

function settingsToBootstrap(settings) {
  return {
    brand: {
      name: settings.gym_name_en,
      localeName: {
        en: settings.gym_name_en,
        ar: settings.gym_name_ar
      }
    },
    contact: {
      phone: settings.phone_number,
      whatsapp: settings.whatsapp_number,
      email: fallbackData.contact.email,
      address: fallbackData.contact.address,
      mapEmbedUrl: settings.google_maps_url
    },
    workingHours: [
      {
        day: { en: "Hours", ar: "ساعات العمل" },
        hours: {
          en: settings.working_hours_en,
          ar: settings.working_hours_ar
        }
      }
    ],
    siteImages: {
      logo: {
        imageUrl: settings.site_logo_url || fallbackSettings.site_logo_url
      },
      homeHero: {
        imageUrl: settings.home_hero_image_url || fallbackSettings.home_hero_image_url,
        fallbackImageUrl: settings.home_hero_fallback_image_url || fallbackSettings.home_hero_fallback_image_url
      },
      authHero: {
        imageUrl: settings.auth_hero_image_url || fallbackSettings.auth_hero_image_url,
        fallbackImageUrl: settings.auth_hero_fallback_image_url || fallbackSettings.auth_hero_fallback_image_url
      },
      socialShare: {
        imageUrl: settings.social_share_image_url || fallbackSettings.social_share_image_url
      }
    }
  };
}

module.exports = {
  getSetting,
  listSettings,
  publicKeys,
  publicSettings,
  saveSiteImages,
  saveSetting,
  settingsToBootstrap
};
