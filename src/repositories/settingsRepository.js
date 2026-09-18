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

// `settings` is now branch-scoped (composite PK (branch_id, key_name), see
// migration 202609180002_settings_branch_scope) -- every function below
// takes a real branchId and reads/writes only that branch's row per key.
// branchId defaults to 1 (Main) to match branchResolver.js's FALLBACK_BRANCH
// and every other branch-aware repository in this codebase.
async function listSettings(branchId = 1) {
  if (!hasDatabaseConfig()) {
    return fallbackSettings;
  }

  const rows = await query(
    "SELECT key_name, value, type, label_en, label_ar FROM settings WHERE branch_id = ? ORDER BY key_name ASC",
    [branchId]
  );
  return rows.reduce((result, row) => {
    result[row.key_name] = castSetting(row);
    return result;
  }, {});
}

async function getSetting(key, fallback = null, branchId = 1) {
  if (!hasDatabaseConfig()) {
    return fallbackSettings[key] ?? fallback;
  }

  const rows = await query(
    "SELECT key_name, value, type FROM settings WHERE branch_id = ? AND key_name = ? LIMIT 1",
    [branchId, key]
  );
  return rows[0] ? castSetting(rows[0]) : fallback;
}

async function publicSettings(branchId = 1) {
  if (!hasDatabaseConfig()) {
    return publicKeys.reduce((result, key) => {
      result[key] = fallbackSettings[key];
      return result;
    }, {});
  }

  const rows = await query("SELECT key_name, value, type FROM settings WHERE branch_id = ?", [branchId || 1]);
  const data = rows.reduce((result, row) => {
    result[row.key_name] = castSetting(row);
    return result;
  }, {});
  return publicKeys.reduce((result, key) => {
    result[key] = data[key] ?? fallbackSettings[key];
    return result;
  }, {});
}

async function saveSetting(key, value, adminId = null, type = "string", branchId = 1) {
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
    `INSERT INTO settings (branch_id, key_name, value, type, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()`,
    [branchId || 1, key, value, type || "string", adminId]
  );

  return { key, value, type: type || "string", branchId: branchId || 1 };
}

async function saveSiteImages(payload, adminId = null, branchId = 1) {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }

  const saved = {};
  for (const [payloadKey, settingKey, label] of siteImageSettings) {
    if (payload[payloadKey] === undefined) {
      continue;
    }
    const value = cleanImageReference(payload[payloadKey], label);
    await saveSetting(settingKey, value, adminId, "string", branchId);
    saved[payloadKey] = value;
  }

  const settings = await publicSettings(branchId);
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
