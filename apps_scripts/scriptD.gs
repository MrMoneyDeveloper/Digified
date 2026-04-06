/**
 * Script D - Zendesk Help Center Article Import (multi-target)
 *
 * Public entrypoints:
 *   setupScriptDArticleSheet()
 *   setupScriptDArticleSheets()
 *   setupScriptDZendeskConfig()
 *   getScriptDSetupStatus()
 *   checkScriptDSectionTargets()
 *   configureScriptDSpreadsheetTargets(googleSuiteSpreadsheetId, itSupportSpreadsheetId)
 *   configureScriptDVisibilityDefaults(tenantSegmentId, learnerContentTagIdsCsv)
 *   pushScriptDArticles()                  // pushes both buckets
 *   pushScriptDGoogleSuiteArticles()       // pushes Google Suite bucket only
 *   pushScriptDITSupportArticles()         // pushes IT Support bucket only
 */

const CFG_D = {
  SHEETS: {
    LOGS: "HC_ARTICLES_LOGS",
  },

  // Legacy default spreadsheet property used across Scripts A/B/D.
  SHEET_ID_PROP: "TRAINING_SHEET_ID",

  BUCKETS: {
    GOOGLE_SUITE: {
      key: "google_suite",
      label: "Google Suite",
      spreadsheetIdProp: "HC_GOOGLE_SUITE_SHEET_ID",
      sheetName: "HC_IMPORT_GOOGLE_SUITE",
      defaultSectionId: "26400615350556", // Learning Material > Google Suite
    },
    IT_SUPPORT: {
      key: "it_support",
      label: "IT Support Tier 1",
      spreadsheetIdProp: "HC_IT_SUPPORT_SHEET_ID",
      sheetName: "HC_IMPORT_IT_SUPPORT",
      defaultSectionId: "26400549254812", // Learning Material > IT Support Tier 1
    },
  },

  PIPELINE: {
    LIMIT_PER_RUN: 100,
  },

  HELP_CENTER: {
    LEARNING_PARENT_SECTION_ID: "26400542556316",
    DEFAULT_CATEGORY_ID: "26400425185692",
  },

  VISIBILITY_DEFAULTS: {
    TENANT_SEGMENT_PROP: "HC_TENANT_SEGMENT_ID",
    LEARNER_CONTENT_TAG_IDS_PROP: "HC_LEARNER_CONTENT_TAG_IDS_CSV",
  },

  ZENDESK: {
    SUBDOMAIN_PROP: "ZD_SUBDOMAIN",
    EMAIL_PROP: "ZD_EMAIL",
    TOKEN_PROP: "ZD_TOKEN",
    BRAND_ID_PROP: "ZD_BRAND_ID",
    DEFAULT_LOCALE_PROP: "HC_DEFAULT_LOCALE",
    DEFAULT_SUBDOMAIN: "cxsupporthub",
    DEFAULT_EMAIL: "mohammed@cxexperts.co.za",
    DEFAULT_LOCALE: "en-us",
    DEFAULT_BRAND_ID: "22700071871516",
    // Kept for backwards compatibility with existing setup behavior.
    DEFAULT_TOKEN: "7zB3NB6vMdOyV6riWS7SDdAJCSbMYP1Rm5D27pqG",
  },
};

const ARTICLE_HEADERS_D = [
  "enabled",
  "section_id",
  "article_id",
  "locale",
  "title",
  "body",
  "user_segment_id",
  "permission_group_id",
  "draft",
  "promoted",
  "position",
  "label_names_csv",
  "content_tag_ids_csv",
  "notify_subscribers",
  "sync_status",
  "zendesk_article_url",
  "error_code",
  "error_details",
  "processed_at",
];

function setupScriptDArticleSheet_() {
  const buckets = getBucketList_D_().map(function (bucket) {
    const ss = getSpreadsheetForBucket_D_(bucket);
    const articleSheet = ensureSheetWithHeader_D_(ss, bucket.sheetName, ARTICLE_HEADERS_D);
    ensureSheetWithHeader_D_(ss, CFG_D.SHEETS.LOGS, [
      "timestamp",
      "bucket",
      "level",
      "message",
      "meta_json",
    ]);
    return {
      bucket: bucket.key,
      label: bucket.label,
      spreadsheet_name: ss.getName(),
      spreadsheet_id: ss.getId(),
      spreadsheet_url: ss.getUrl(),
      article_sheet: articleSheet.getName(),
      default_section_id: bucket.defaultSectionId,
    };
  });

  return {
    ok: true,
    buckets: buckets,
    headers: ARTICLE_HEADERS_D,
    notes: [
      "Leave article_id blank to create a new article.",
      "Fill article_id to update an existing article.",
      "section_id can be left blank to use the bucket default section.",
      "If user_segment_id is blank, HC_TENANT_SEGMENT_ID is applied when configured.",
      "If content_tag_ids_csv is blank, HC_LEARNER_CONTENT_TAG_IDS_CSV is applied when configured.",
      "Run setupScriptDZendeskConfig() once before the first import.",
    ],
    defaults: {
      locale: CFG_D.ZENDESK.DEFAULT_LOCALE,
      learning_parent_section_id: CFG_D.HELP_CENTER.LEARNING_PARENT_SECTION_ID,
      category_id: CFG_D.HELP_CENTER.DEFAULT_CATEGORY_ID,
      google_suite_section_id: CFG_D.BUCKETS.GOOGLE_SUITE.defaultSectionId,
      it_support_section_id: CFG_D.BUCKETS.IT_SUPPORT.defaultSectionId,
    },
  };
}

function setupScriptDZendeskConfig_() {
  const props = PropertiesService.getScriptProperties();
  const updates = {};

  const currentSubdomain = String(props.getProperty(CFG_D.ZENDESK.SUBDOMAIN_PROP) || "").trim();
  const currentEmail = String(props.getProperty(CFG_D.ZENDESK.EMAIL_PROP) || "").trim();
  const currentLocale = String(props.getProperty(CFG_D.ZENDESK.DEFAULT_LOCALE_PROP) || "").trim();
  const currentToken = String(props.getProperty(CFG_D.ZENDESK.TOKEN_PROP) || "").trim();
  const currentBrandId = String(props.getProperty(CFG_D.ZENDESK.BRAND_ID_PROP) || "").trim();

  if (!currentSubdomain) updates[CFG_D.ZENDESK.SUBDOMAIN_PROP] = CFG_D.ZENDESK.DEFAULT_SUBDOMAIN;
  if (!currentEmail) updates[CFG_D.ZENDESK.EMAIL_PROP] = CFG_D.ZENDESK.DEFAULT_EMAIL;
  if (!currentLocale) updates[CFG_D.ZENDESK.DEFAULT_LOCALE_PROP] = CFG_D.ZENDESK.DEFAULT_LOCALE;
  if (!currentToken) updates[CFG_D.ZENDESK.TOKEN_PROP] = CFG_D.ZENDESK.DEFAULT_TOKEN;
  if (!currentBrandId && CFG_D.ZENDESK.DEFAULT_BRAND_ID) {
    updates[CFG_D.ZENDESK.BRAND_ID_PROP] = CFG_D.ZENDESK.DEFAULT_BRAND_ID;
  }

  if (Object.keys(updates).length) {
    props.setProperties(updates, false);
  }

  return getScriptDSetupStatus_();
}

function configureScriptDSpreadsheetTargets_(googleSuiteSpreadsheetId, itSupportSpreadsheetId) {
  const props = PropertiesService.getScriptProperties();
  const updates = {};
  updates[CFG_D.BUCKETS.GOOGLE_SUITE.spreadsheetIdProp] = String(googleSuiteSpreadsheetId || "").trim();
  updates[CFG_D.BUCKETS.IT_SUPPORT.spreadsheetIdProp] = String(itSupportSpreadsheetId || "").trim();
  props.setProperties(updates, false);
  return getScriptDSetupStatus_();
}

function configureScriptDVisibilityDefaults_(tenantSegmentId, learnerContentTagIdsCsv) {
  const props = PropertiesService.getScriptProperties();
  const updates = {};
  updates[CFG_D.VISIBILITY_DEFAULTS.TENANT_SEGMENT_PROP] = String(tenantSegmentId || "").trim();
  updates[CFG_D.VISIBILITY_DEFAULTS.LEARNER_CONTENT_TAG_IDS_PROP] = String(learnerContentTagIdsCsv || "").trim();
  props.setProperties(updates, false);
  return getScriptDSetupStatus_();
}

function getScriptDSetupStatus_() {
  const props = PropertiesService.getScriptProperties();
  const creds = getZendeskCreds_D_();

  const buckets = getBucketList_D_().map(function (bucket) {
    const configuredId = String(props.getProperty(bucket.spreadsheetIdProp) || "").trim();
    const target = getSpreadsheetForBucket_D_(bucket);
    return {
      bucket: bucket.key,
      label: bucket.label,
      sheet_name: bucket.sheetName,
      default_section_id: bucket.defaultSectionId,
      spreadsheet_property: bucket.spreadsheetIdProp,
      spreadsheet_id_from_property: configuredId || "",
      effective_spreadsheet_id: target.getId(),
      effective_spreadsheet_name: target.getName(),
      effective_spreadsheet_url: target.getUrl(),
    };
  });

  return {
    ok: !!(creds.subdomain && creds.email && creds.token),
    configured: {
      subdomain: creds.subdomain,
      email: creds.email,
      brand_id: creds.brandId,
      default_locale: creds.defaultLocale,
      token_present: !!creds.token,
      tenant_segment_id_default: String(
        props.getProperty(CFG_D.VISIBILITY_DEFAULTS.TENANT_SEGMENT_PROP) || ""
      ).trim(),
      learner_content_tag_ids_default: String(
        props.getProperty(CFG_D.VISIBILITY_DEFAULTS.LEARNER_CONTENT_TAG_IDS_PROP) || ""
      ).trim(),
    },
    buckets: buckets,
    required_script_properties: [
      CFG_D.ZENDESK.SUBDOMAIN_PROP,
      CFG_D.ZENDESK.EMAIL_PROP,
      CFG_D.ZENDESK.TOKEN_PROP,
      CFG_D.ZENDESK.BRAND_ID_PROP,
      CFG_D.VISIBILITY_DEFAULTS.TENANT_SEGMENT_PROP,
      CFG_D.VISIBILITY_DEFAULTS.LEARNER_CONTENT_TAG_IDS_PROP,
      CFG_D.BUCKETS.GOOGLE_SUITE.spreadsheetIdProp,
      CFG_D.BUCKETS.IT_SUPPORT.spreadsheetIdProp,
    ],
  };
}

function pushScriptDBucket_(bucket, opts) {
  const ss = getSpreadsheetForBucket_D_(bucket);
  const sh = ss.getSheetByName(bucket.sheetName);
  if (!sh) {
    return {
      ok: false,
      bucket: bucket.key,
      label: bucket.label,
      error: "ARTICLE_SHEET_NOT_FOUND",
      message: "Run setupScriptDArticleSheet() first.",
      spreadsheet_id: ss.getId(),
      sheet_name: bucket.sheetName,
    };
  }

  const creds = getZendeskCreds_D_();
  if (!creds.subdomain || !creds.email || !creds.token) {
    return {
      ok: false,
      bucket: bucket.key,
      label: bucket.label,
      error: "ZENDESK_NOT_CONFIGURED",
      message: "Set ZD_SUBDOMAIN, ZD_EMAIL, and ZD_TOKEN in Script Properties.",
    };
  }

  const defaults = getVisibilityDefaults_D_();
  const limit = Math.max(1, toInt_D_(opts && opts.limit, CFG_D.PIPELINE.LIMIT_PER_RUN));
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return {
      ok: true,
      bucket: bucket.key,
      label: bucket.label,
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      spreadsheet_id: ss.getId(),
      sheet_name: bucket.sheetName,
      default_section_id: bucket.defaultSectionId,
    };
  }

  const idx = indexMap_D_(values[0].map(String));
  const missing = listMissingRequiredCols_D_(idx);
  if (missing.length) {
    return {
      ok: false,
      bucket: bucket.key,
      label: bucket.label,
      error: "MISSING_REQUIRED_COLUMNS",
      missing: missing,
      sheet_name: bucket.sheetName,
      spreadsheet_id: ss.getId(),
    };
  }

  let processed = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 1; i < values.length && processed < limit; i++) {
    const rowNum = i + 1;
    const row = values[i];
    const article = articleFromRow_D_(row, idx, {
      defaultSectionId: bucket.defaultSectionId,
      defaultLocale: creds.defaultLocale,
      tenantSegmentId: defaults.tenantSegmentId,
      learnerContentTagIds: defaults.learnerContentTagIds,
    });

    if (!article.enabled) {
      skipped++;
      continue;
    }

    const validation = validateArticleRow_D_(article);
    if (!validation.ok) {
      writeArticleResult_D_(sh, rowNum, idx, {
        sync_status: "failed",
        error_code: validation.code,
        error_details: validation.message,
      });
      logWarn_D_(bucket, "Article row validation failed", {
        row: rowNum,
        error_code: validation.code,
        error_details: validation.message,
      });
      failed++;
      processed++;
      continue;
    }

    const request = buildArticleRequest_D_(article);
    const result = zendeskRequestWithFallback_D_(creds, request, article);

    if (result.ok) {
      writeArticleResult_D_(sh, rowNum, idx, {
        article_id: result.article_id,
        zendesk_article_url: result.article_url,
        sync_status: article.articleId ? "updated" : "created",
        error_code: "",
        error_details: "",
      });
      logInfo_D_(bucket, "Article synced", {
        row: rowNum,
        article_id: result.article_id,
        article_url: result.article_url,
        mode: article.articleId ? "update" : "create",
      });
      if (article.articleId) updated++;
      else created++;
    } else {
      const detailedError = withRequestAttemptDetails_D_(result);
      writeArticleResult_D_(sh, rowNum, idx, {
        sync_status: "failed",
        error_code: result.error_code,
        error_details: detailedError,
      });
      logError_D_(bucket, "Article sync failed", {
        row: rowNum,
        error_code: result.error_code,
        error_details: truncate_D_(detailedError, 800),
        attempts: result.attempts || [],
      });
      failed++;
    }

    processed++;
  }

  return {
    ok: true,
    bucket: bucket.key,
    label: bucket.label,
    processed: processed,
    created: created,
    updated: updated,
    failed: failed,
    skipped: skipped,
    limit: limit,
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    sheet_name: bucket.sheetName,
    default_section_id: bucket.defaultSectionId,
  };
}

function pushScriptDArticles_(opts) {
  const options = opts || {};
  const bucketKey = String(options.bucket || "").trim().toLowerCase();
  if (bucketKey) {
    const bucket = findBucketByKey_D_(bucketKey);
    if (!bucket) {
      return {
        ok: false,
        error: "UNKNOWN_BUCKET",
        message: "Valid buckets: google_suite, it_support",
        requested_bucket: bucketKey,
      };
    }
    return pushScriptDBucket_(bucket, options);
  }

  const google = pushScriptDBucket_(CFG_D.BUCKETS.GOOGLE_SUITE, options);
  const it = pushScriptDBucket_(CFG_D.BUCKETS.IT_SUPPORT, options);

  return {
    ok: !!(google.ok && it.ok),
    google_suite: google,
    it_support: it,
    totals: {
      processed: toInt_D_(google.processed, 0) + toInt_D_(it.processed, 0),
      created: toInt_D_(google.created, 0) + toInt_D_(it.created, 0),
      updated: toInt_D_(google.updated, 0) + toInt_D_(it.updated, 0),
      failed: toInt_D_(google.failed, 0) + toInt_D_(it.failed, 0),
      skipped: toInt_D_(google.skipped, 0) + toInt_D_(it.skipped, 0),
    },
  };
}

function articleFromRow_D_(row, idx, defaults) {
  const rawSectionId = String(safeCell_D_(row, idx.section_id) || "").trim();
  const rawUserSegmentId = parseNumericCell_D_(safeCell_D_(row, idx.user_segment_id));
  const rawContentTagIds = splitCsv_D_(safeCell_D_(row, idx.content_tag_ids_csv));

  return {
    enabled: toBool_D_(safeCell_D_(row, idx.enabled), true),
    sectionId: rawSectionId || defaults.defaultSectionId,
    articleId: String(safeCell_D_(row, idx.article_id) || "").trim(),
    locale: String(
      safeCell_D_(row, idx.locale) || defaults.defaultLocale || CFG_D.ZENDESK.DEFAULT_LOCALE
    ).trim() || CFG_D.ZENDESK.DEFAULT_LOCALE,
    title: String(safeCell_D_(row, idx.title) || "").trim(),
    body: String(safeCell_D_(row, idx.body) || "").trim(),
    userSegmentId:
      rawUserSegmentId !== null ? rawUserSegmentId : defaults.tenantSegmentId,
    permissionGroupId: parseNumericCell_D_(safeCell_D_(row, idx.permission_group_id)),
    draft: parseOptionalBool_D_(safeCell_D_(row, idx.draft)),
    promoted: parseOptionalBool_D_(safeCell_D_(row, idx.promoted)),
    position: parseOptionalInt_D_(safeCell_D_(row, idx.position)),
    labelNames: splitCsv_D_(safeCell_D_(row, idx.label_names_csv)),
    contentTagIds: rawContentTagIds.length
      ? rawContentTagIds
      : (defaults.learnerContentTagIds || []),
    notifySubscribers: toBool_D_(safeCell_D_(row, idx.notify_subscribers), false),
  };
}

function validateArticleRow_D_(article) {
  if (!article.title) {
    return { ok: false, code: "MISSING_TITLE", message: "title is required." };
  }
  if (!article.body) {
    return { ok: false, code: "MISSING_BODY", message: "body is required." };
  }
  if (!article.articleId && !article.sectionId) {
    return { ok: false, code: "MISSING_SECTION_ID", message: "section_id is required for new articles." };
  }
  return { ok: true };
}

function buildArticleRequest_D_(article) {
  const articlePayload = {
    title: article.title,
    body: article.body,
    locale: article.locale,
  };

  if (article.userSegmentId !== null) articlePayload.user_segment_id = article.userSegmentId;
  if (article.permissionGroupId !== null) articlePayload.permission_group_id = article.permissionGroupId;
  if (article.draft !== null) articlePayload.draft = article.draft;
  if (article.promoted !== null) articlePayload.promoted = article.promoted;
  if (article.position !== null) articlePayload.position = article.position;
  if (article.labelNames.length) articlePayload.label_names = article.labelNames;
  if (article.contentTagIds.length) articlePayload.content_tag_ids = article.contentTagIds;

  if (article.articleId) {
    return {
      method: "put",
      path: "/api/v2/help_center/articles/" + encodeURIComponent(article.articleId) + ".json",
      payload: {
        article: articlePayload,
        notify_subscribers: article.notifySubscribers,
      },
    };
  }

  return {
    method: "post",
    path: "/api/v2/help_center/sections/" + encodeURIComponent(article.sectionId) + "/articles.json",
    payload: {
      article: articlePayload,
      notify_subscribers: article.notifySubscribers,
    },
  };
}

function zendeskRequest_D_(creds, method, path, payloadObj) {
  const auth = Utilities.base64Encode(creds.email + "/token:" + creds.token);
  const url = "https://" + creds.subdomain + ".zendesk.com" + path;

  try {
    const requestMethod = String(method || "get").toLowerCase();
    const options = {
      method: method,
      contentType: "application/json",
      headers: { Authorization: "Basic " + auth },
      muteHttpExceptions: true,
    };
    if (requestMethod !== "get" && requestMethod !== "head" && requestMethod !== "delete") {
      options.payload = JSON.stringify(payloadObj || {});
    }

    const res = UrlFetchApp.fetch(url, options);

    const statusCode = Number(res.getResponseCode() || 0);
    const body = String(res.getContentText() || "");
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch (ignore) {}

    if (statusCode >= 200 && statusCode < 300) {
      const article = parsed && parsed.article ? parsed.article : {};
      return {
        ok: true,
        article_id: String(article.id || "").trim(),
        article_url: String(article.html_url || article.url || "").trim(),
        status_code: statusCode,
      };
    }

    return {
      ok: false,
      error_code: "ZENDESK_API_" + statusCode,
      error_details: body || "Unknown Zendesk response.",
      status_code: statusCode,
    };
  } catch (err) {
    return {
      ok: false,
      error_code: "ZENDESK_FETCH_EXCEPTION",
      error_details: String(err || ""),
      status_code: 0,
    };
  }
}

function zendeskRequestWithFallback_D_(creds, request, article) {
  const attempts = [];

  const runAttempt = function (path, label) {
    const response = zendeskRequest_D_(creds, request.method, path, request.payload);
    attempts.push({
      label: label,
      path: path,
      status_code: response.status_code,
      error_code: response.error_code || "",
    });
    response.attempts = attempts;
    return response;
  };

  let result = runAttempt(request.path, "primary");
  if (result.ok || Number(result.status_code || 0) !== 404) {
    return result;
  }

  if (creds.brandId) {
    const withBrand = appendBrandIdToPath_D_(request.path, creds.brandId);
    if (withBrand !== request.path) {
      result = runAttempt(withBrand, "primary+brand");
      if (result.ok || Number(result.status_code || 0) !== 404) {
        return result;
      }
    }
  }

  if (isSectionCreatePath_D_(request.path) && !article.articleId) {
    const localePath = buildLocaleSectionCreatePath_D_(article.sectionId, article.locale || creds.defaultLocale);
    result = runAttempt(localePath, "locale");
    if (result.ok || Number(result.status_code || 0) !== 404) {
      return result;
    }

    if (creds.brandId) {
      const localeWithBrand = appendBrandIdToPath_D_(localePath, creds.brandId);
      if (localeWithBrand !== localePath) {
        result = runAttempt(localeWithBrand, "locale+brand");
      }
    }
  }

  return result;
}

function isSectionCreatePath_D_(path) {
  return /^\/api\/v2\/help_center\/sections\/[^/]+\/articles\.json(\?.*)?$/i.test(String(path || ""));
}

function buildLocaleSectionCreatePath_D_(sectionId, locale) {
  const safeLocale = String(locale || CFG_D.ZENDESK.DEFAULT_LOCALE).trim() || CFG_D.ZENDESK.DEFAULT_LOCALE;
  return (
    "/api/v2/help_center/" +
    encodeURIComponent(safeLocale) +
    "/sections/" +
    encodeURIComponent(String(sectionId || "").trim()) +
    "/articles.json"
  );
}

function appendBrandIdToPath_D_(path, brandId) {
  const safePath = String(path || "");
  const safeBrandId = String(brandId || "").trim();
  if (!safePath || !safeBrandId) return safePath;
  if (/[\?&]brand_id=/i.test(safePath)) return safePath;
  return safePath + (safePath.indexOf("?") >= 0 ? "&" : "?") + "brand_id=" + encodeURIComponent(safeBrandId);
}

function withRequestAttemptDetails_D_(result) {
  const baseError = String((result && result.error_details) || "Unknown Zendesk response.");
  const attempts = result && Array.isArray(result.attempts) ? result.attempts : [];
  if (!attempts.length) return baseError;
  return baseError + " | attempts=" + JSON.stringify(attempts);
}

function writeArticleResult_D_(sheet, rowNum, idx, patch) {
  const processedAt = new Date().toISOString();
  setCellIf_D_(sheet, rowNum, idx.article_id, patch.article_id);
  setCellIf_D_(sheet, rowNum, idx.zendesk_article_url, patch.zendesk_article_url);
  setCellIf_D_(sheet, rowNum, idx.sync_status, patch.sync_status);
  setCellIf_D_(sheet, rowNum, idx.error_code, patch.error_code);
  setCellIf_D_(sheet, rowNum, idx.error_details, patch.error_details);
  setCellIf_D_(sheet, rowNum, idx.processed_at, processedAt);
}

function getBucketList_D_() {
  return [CFG_D.BUCKETS.GOOGLE_SUITE, CFG_D.BUCKETS.IT_SUPPORT];
}

function findBucketByKey_D_(bucketKey) {
  const target = String(bucketKey || "").trim().toLowerCase();
  return getBucketList_D_().find(function (bucket) {
    return String(bucket.key || "").toLowerCase() === target;
  }) || null;
}

function getDefaultSpreadsheet_D_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = String(props.getProperty(CFG_D.SHEET_ID_PROP) || "").trim();
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSpreadsheetForBucket_D_(bucket) {
  const props = PropertiesService.getScriptProperties();
  const specificSheetId = String(props.getProperty(bucket.spreadsheetIdProp) || "").trim();
  if (specificSheetId) return SpreadsheetApp.openById(specificSheetId);
  return getDefaultSpreadsheet_D_();
}

function getVisibilityDefaults_D_() {
  const props = PropertiesService.getScriptProperties();
  return {
    tenantSegmentId: parseNumericCell_D_(
      props.getProperty(CFG_D.VISIBILITY_DEFAULTS.TENANT_SEGMENT_PROP)
    ),
    learnerContentTagIds: splitCsv_D_(
      props.getProperty(CFG_D.VISIBILITY_DEFAULTS.LEARNER_CONTENT_TAG_IDS_PROP)
    ),
  };
}

function getZendeskCreds_D_() {
  const props = PropertiesService.getScriptProperties();
  return {
    subdomain: String(
      props.getProperty(CFG_D.ZENDESK.SUBDOMAIN_PROP) || CFG_D.ZENDESK.DEFAULT_SUBDOMAIN
    ).trim(),
    email: String(
      props.getProperty(CFG_D.ZENDESK.EMAIL_PROP) || CFG_D.ZENDESK.DEFAULT_EMAIL
    ).trim(),
    token: String(
      props.getProperty(CFG_D.ZENDESK.TOKEN_PROP) || CFG_D.ZENDESK.DEFAULT_TOKEN
    ).trim(),
    brandId: String(
      props.getProperty(CFG_D.ZENDESK.BRAND_ID_PROP) || CFG_D.ZENDESK.DEFAULT_BRAND_ID
    ).trim(),
    defaultLocale: String(
      props.getProperty(CFG_D.ZENDESK.DEFAULT_LOCALE_PROP) || CFG_D.ZENDESK.DEFAULT_LOCALE
    ).trim() || CFG_D.ZENDESK.DEFAULT_LOCALE,
  };
}

function checkScriptDSectionTargets_() {
  const creds = getZendeskCreds_D_();
  if (!creds.subdomain || !creds.email || !creds.token) {
    return {
      ok: false,
      error: "ZENDESK_NOT_CONFIGURED",
      message: "Set ZD_SUBDOMAIN, ZD_EMAIL, and ZD_TOKEN first.",
    };
  }

  const results = getBucketList_D_().map(function (bucket) {
    const sectionId = String(bucket.defaultSectionId || "").trim();
    const basePath = "/api/v2/help_center/sections/" + encodeURIComponent(sectionId) + ".json";
    const checks = [];

    const primary = zendeskRequest_D_(creds, "get", basePath, null);
    checks.push({
      mode: "primary",
      path: basePath,
      ok: primary.ok,
      status_code: primary.status_code,
      error_code: primary.error_code || "",
    });
    if (primary.ok) {
      return {
        bucket: bucket.key,
        label: bucket.label,
        section_id: sectionId,
        ok: true,
        checks: checks,
      };
    }

    if (creds.brandId) {
      const brandPath = appendBrandIdToPath_D_(basePath, creds.brandId);
      const byBrand = zendeskRequest_D_(creds, "get", brandPath, null);
      checks.push({
        mode: "primary+brand",
        path: brandPath,
        ok: byBrand.ok,
        status_code: byBrand.status_code,
        error_code: byBrand.error_code || "",
      });
      if (byBrand.ok) {
        return {
          bucket: bucket.key,
          label: bucket.label,
          section_id: sectionId,
          ok: true,
          checks: checks,
        };
      }
    }

    const localePath =
      "/api/v2/help_center/" +
      encodeURIComponent(creds.defaultLocale) +
      "/sections/" +
      encodeURIComponent(sectionId) +
      ".json";
    const byLocale = zendeskRequest_D_(creds, "get", localePath, null);
    checks.push({
      mode: "locale",
      path: localePath,
      ok: byLocale.ok,
      status_code: byLocale.status_code,
      error_code: byLocale.error_code || "",
    });
    if (byLocale.ok) {
      return {
        bucket: bucket.key,
        label: bucket.label,
        section_id: sectionId,
        ok: true,
        checks: checks,
      };
    }

    if (creds.brandId) {
      const localeBrandPath = appendBrandIdToPath_D_(localePath, creds.brandId);
      const byLocaleBrand = zendeskRequest_D_(creds, "get", localeBrandPath, null);
      checks.push({
        mode: "locale+brand",
        path: localeBrandPath,
        ok: byLocaleBrand.ok,
        status_code: byLocaleBrand.status_code,
        error_code: byLocaleBrand.error_code || "",
      });
      if (byLocaleBrand.ok) {
        return {
          bucket: bucket.key,
          label: bucket.label,
          section_id: sectionId,
          ok: true,
          checks: checks,
        };
      }
    }

    return {
      bucket: bucket.key,
      label: bucket.label,
      section_id: sectionId,
      ok: false,
      checks: checks,
      note: "Section id not reachable with current Zendesk/brand configuration.",
    };
  });

  return {
    ok: results.every(function (r) { return !!r.ok; }),
    subdomain: creds.subdomain,
    brand_id: creds.brandId || "",
    locale: creds.defaultLocale,
    results: results,
  };
}

function ensureSheetWithHeader_D_(ss, name, headerRow) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headerRow.length);
    return sh;
  }

  const existingWidth = sh.getLastColumn();
  const existingHeader = sh.getRange(1, 1, 1, existingWidth).getValues()[0].map(function (cell) {
    return String(cell || "").trim();
  });
  const existingLookup = {};
  existingHeader.forEach(function (header) {
    if (header) existingLookup[String(header).toLowerCase()] = true;
  });

  const missing = headerRow.filter(function (header) {
    return !existingLookup[String(header || "").trim().toLowerCase()];
  });

  if (missing.length) {
    sh.getRange(1, existingHeader.length + 1, 1, missing.length).setValues([missing]);
    sh.autoResizeColumns(1, existingHeader.length + missing.length);
  }

  return sh;
}

function indexMap_D_(header) {
  const map = {};
  header.forEach(function (value, index) {
    const key = String(value || "").trim().toLowerCase();
    if (key) map[key] = index;
  });

  return {
    enabled: map.enabled,
    section_id: map.section_id,
    article_id: map.article_id,
    locale: map.locale,
    title: map.title,
    body: map.body,
    user_segment_id: map.user_segment_id,
    permission_group_id: map.permission_group_id,
    draft: map.draft,
    promoted: map.promoted,
    position: map.position,
    label_names_csv: map.label_names_csv,
    content_tag_ids_csv: map.content_tag_ids_csv,
    notify_subscribers: map.notify_subscribers,
    sync_status: map.sync_status,
    zendesk_article_url: map.zendesk_article_url,
    error_code: map.error_code,
    error_details: map.error_details,
    processed_at: map.processed_at,
  };
}

function listMissingRequiredCols_D_(idx) {
  const required = ["enabled", "section_id", "article_id", "locale", "title", "body", "sync_status"];
  return required.filter(function (key) {
    return idx[key] === undefined;
  });
}

function safeCell_D_(row, index) {
  if (index === undefined || index === null || index < 0) return "";
  return row[index];
}

function setCellIf_D_(sheet, rowNum, index, value) {
  if (index === undefined || index === null || index < 0) return;
  if (value === undefined) return;
  sheet.getRange(rowNum, index + 1).setValue(value);
}

function parseNumericCell_D_(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function parseOptionalInt_D_(value) {
  return parseNumericCell_D_(value);
}

function parseOptionalBool_D_(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "y", "on"].indexOf(s) >= 0) return true;
  if (["0", "false", "no", "n", "off"].indexOf(s) >= 0) return false;
  return null;
}

function toBool_D_(value, fallback) {
  const parsed = parseOptionalBool_D_(value);
  return parsed === null ? !!fallback : parsed;
}

function splitCsv_D_(value) {
  return String(value || "")
    .split(",")
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(function (item) {
      return !!item;
    });
}

function toInt_D_(value, fallback) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function truncate_D_(value, maxLen) {
  const s = String(value || "");
  const limit = Math.max(40, toInt_D_(maxLen, 280));
  return s.length <= limit ? s : s.slice(0, limit) + "...";
}

function logInfo_D_(bucket, message, meta) {
  log_D_(bucket, "info", message, meta);
}

function logWarn_D_(bucket, message, meta) {
  log_D_(bucket, "warn", message, meta);
}

function logError_D_(bucket, message, meta) {
  log_D_(bucket, "error", message, meta);
}

function log_D_(bucket, level, message, meta) {
  try {
    const targetBucket = bucket || CFG_D.BUCKETS.IT_SUPPORT;
    const ss = getSpreadsheetForBucket_D_(targetBucket);
    const sh = ensureSheetWithHeader_D_(ss, CFG_D.SHEETS.LOGS, [
      "timestamp",
      "bucket",
      "level",
      "message",
      "meta_json",
    ]);
    sh.appendRow([
      new Date().toISOString(),
      String(targetBucket.key || ""),
      String(level || "info"),
      String(message || ""),
      JSON.stringify(meta || {}),
    ]);
  } catch (ignore) {}
}

function setupScriptDArticleSheet() {
  return setupScriptDArticleSheet_();
}

function setupScriptDArticleSheets() {
  return setupScriptDArticleSheet_();
}

function setupScriptDZendeskConfig() {
  return setupScriptDZendeskConfig_();
}

function configureScriptDSpreadsheetTargets(googleSuiteSpreadsheetId, itSupportSpreadsheetId) {
  return configureScriptDSpreadsheetTargets_(googleSuiteSpreadsheetId, itSupportSpreadsheetId);
}

function configureScriptDVisibilityDefaults(tenantSegmentId, learnerContentTagIdsCsv) {
  return configureScriptDVisibilityDefaults_(tenantSegmentId, learnerContentTagIdsCsv);
}

function getScriptDSetupStatus() {
  return getScriptDSetupStatus_();
}

function checkScriptDSectionTargets() {
  return checkScriptDSectionTargets_();
}

function pushScriptDGoogleSuiteArticles() {
  return pushScriptDArticles_({ bucket: "google_suite" });
}

function pushScriptDITSupportArticles() {
  return pushScriptDArticles_({ bucket: "it_support" });
}

function pushScriptDArticles() {
  return pushScriptDArticles_({});
}
