/**
 * Script D - Zendesk Help Center Article Import
 *
 * Public entrypoints:
 *   setupScriptDArticleSheet()
 *   pushScriptDArticles()
 */

const CFG_D = {
  SHEETS: {
    ARTICLES: "HC_ARTICLES_IMPORT",
    LOGS: "HC_ARTICLES_LOGS",
  },

  SHEET_ID_PROP: "TRAINING_SHEET_ID",

  PIPELINE: {
    LIMIT_PER_RUN: 100,
  },

  ZENDESK: {
    SUBDOMAIN_PROP: "ZD_SUBDOMAIN",
    EMAIL_PROP: "ZD_EMAIL",
    TOKEN_PROP: "ZD_TOKEN",
    DEFAULT_LOCALE_PROP: "HC_DEFAULT_LOCALE",
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
  const ss = getSS_D_();

  const articleSheet = ensureSheetWithHeader_D_(ss, CFG_D.SHEETS.ARTICLES, ARTICLE_HEADERS_D);
  const logSheet = ensureSheetWithHeader_D_(ss, CFG_D.SHEETS.LOGS, [
    "timestamp",
    "level",
    "message",
    "meta_json",
  ]);

  return {
    ok: true,
    spreadsheet_name: ss.getName(),
    spreadsheet_id: ss.getId(),
    spreadsheet_url: ss.getUrl(),
    article_sheet: articleSheet.getName(),
    log_sheet: logSheet.getName(),
    headers: ARTICLE_HEADERS_D,
    notes: [
      "Leave article_id blank to create a new article.",
      "Fill article_id to update an existing article.",
      "section_id is required for new articles.",
      "body accepts HTML or plain text.",
      "label_names_csv and content_tag_ids_csv accept comma-separated values.",
    ],
  };
}

function pushScriptDArticles_(opts) {
  const ss = getSS_D_();
  const sh = ss.getSheetByName(CFG_D.SHEETS.ARTICLES);
  if (!sh) {
    return { ok: false, error: "ARTICLE_SHEET_NOT_FOUND", message: "Run setupScriptDArticleSheet() first." };
  }

  const creds = getZendeskCreds_D_();
  if (!creds.subdomain || !creds.email || !creds.token) {
    return {
      ok: false,
      error: "ZENDESK_NOT_CONFIGURED",
      message: "Set ZD_SUBDOMAIN, ZD_EMAIL, and ZD_TOKEN in Script Properties.",
    };
  }

  const limit = Math.max(1, toInt_D_(opts && opts.limit, CFG_D.PIPELINE.LIMIT_PER_RUN));
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return { ok: true, processed: 0, created: 0, updated: 0, failed: 0, skipped: 0 };
  }

  const idx = indexMap_D_(values[0].map(String));
  const missing = listMissingRequiredCols_D_(idx);
  if (missing.length) {
    return { ok: false, error: "MISSING_REQUIRED_COLUMNS", missing: missing };
  }

  let processed = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 1; i < values.length && processed < limit; i++) {
    const rowNum = i + 1;
    const row = values[i];
    const article = articleFromRow_D_(row, idx, creds.defaultLocale);

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
      logWarn_D_("Article row validation failed", {
        row: rowNum,
        error_code: validation.code,
        error_details: validation.message,
      });
      failed++;
      processed++;
      continue;
    }

    const request = buildArticleRequest_D_(article);
    const result = zendeskRequest_D_(creds, request.method, request.path, request.payload);

    if (result.ok) {
      writeArticleResult_D_(sh, rowNum, idx, {
        article_id: result.article_id,
        zendesk_article_url: result.article_url,
        sync_status: article.articleId ? "updated" : "created",
        error_code: "",
        error_details: "",
      });
      logInfo_D_("Article synced", {
        row: rowNum,
        article_id: result.article_id,
        article_url: result.article_url,
        mode: article.articleId ? "update" : "create",
      });
      if (article.articleId) updated++;
      else created++;
    } else {
      writeArticleResult_D_(sh, rowNum, idx, {
        sync_status: "failed",
        error_code: result.error_code,
        error_details: result.error_details,
      });
      logError_D_("Article sync failed", {
        row: rowNum,
        error_code: result.error_code,
        error_details: truncate_D_(result.error_details, 800),
      });
      failed++;
    }

    processed++;
  }

  return {
    ok: true,
    processed: processed,
    created: created,
    updated: updated,
    failed: failed,
    skipped: skipped,
    limit: limit,
    sheet_name: CFG_D.SHEETS.ARTICLES,
  };
}

function articleFromRow_D_(row, idx, defaultLocale) {
  return {
    enabled: toBool_D_(safeCell_D_(row, idx.enabled), true),
    sectionId: String(safeCell_D_(row, idx.section_id) || "").trim(),
    articleId: String(safeCell_D_(row, idx.article_id) || "").trim(),
    locale: String(safeCell_D_(row, idx.locale) || defaultLocale || "en-us").trim() || "en-us",
    title: String(safeCell_D_(row, idx.title) || "").trim(),
    body: String(safeCell_D_(row, idx.body) || "").trim(),
    userSegmentId: parseNumericCell_D_(safeCell_D_(row, idx.user_segment_id)),
    permissionGroupId: parseNumericCell_D_(safeCell_D_(row, idx.permission_group_id)),
    draft: parseOptionalBool_D_(safeCell_D_(row, idx.draft)),
    promoted: parseOptionalBool_D_(safeCell_D_(row, idx.promoted)),
    position: parseOptionalInt_D_(safeCell_D_(row, idx.position)),
    labelNames: splitCsv_D_(safeCell_D_(row, idx.label_names_csv)),
    contentTagIds: splitCsv_D_(safeCell_D_(row, idx.content_tag_ids_csv)),
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
    const res = UrlFetchApp.fetch(url, {
      method: method,
      contentType: "application/json",
      payload: JSON.stringify(payloadObj || {}),
      headers: { Authorization: "Basic " + auth },
      muteHttpExceptions: true,
    });

    const statusCode = Number(res.getResponseCode() || 0);
    const body = String(res.getContentText() || "");
    let parsed = {};
    try { parsed = JSON.parse(body || "{}"); } catch (ignore) {}

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

function writeArticleResult_D_(sheet, rowNum, idx, patch) {
  const processedAt = new Date().toISOString();

  setCellIf_D_(sheet, rowNum, idx.article_id, patch.article_id);
  setCellIf_D_(sheet, rowNum, idx.zendesk_article_url, patch.zendesk_article_url);
  setCellIf_D_(sheet, rowNum, idx.sync_status, patch.sync_status);
  setCellIf_D_(sheet, rowNum, idx.error_code, patch.error_code);
  setCellIf_D_(sheet, rowNum, idx.error_details, patch.error_details);
  setCellIf_D_(sheet, rowNum, idx.processed_at, processedAt);
}

function getSS_D_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(CFG_D.SHEET_ID_PROP);
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getZendeskCreds_D_() {
  const props = PropertiesService.getScriptProperties();
  return {
    subdomain: String(props.getProperty(CFG_D.ZENDESK.SUBDOMAIN_PROP) || "").trim(),
    email: String(props.getProperty(CFG_D.ZENDESK.EMAIL_PROP) || "").trim(),
    token: String(props.getProperty(CFG_D.ZENDESK.TOKEN_PROP) || "").trim(),
    defaultLocale: String(props.getProperty(CFG_D.ZENDESK.DEFAULT_LOCALE_PROP) || "en-us").trim() || "en-us",
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
    .map(function (item) { return String(item || "").trim(); })
    .filter(function (item) { return !!item; });
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

function logInfo_D_(message, meta) {
  log_D_("info", message, meta);
}

function logWarn_D_(message, meta) {
  log_D_("warn", message, meta);
}

function logError_D_(message, meta) {
  log_D_("error", message, meta);
}

function log_D_(level, message, meta) {
  try {
    const ss = getSS_D_();
    const sh = ensureSheetWithHeader_D_(ss, CFG_D.SHEETS.LOGS, [
      "timestamp",
      "level",
      "message",
      "meta_json",
    ]);
    sh.appendRow([
      new Date().toISOString(),
      String(level || "info"),
      String(message || ""),
      JSON.stringify(meta || {}),
    ]);
  } catch (ignore) {}
}

function setupScriptDArticleSheet() {
  return setupScriptDArticleSheet_();
}

function pushScriptDArticles() {
  return pushScriptDArticles_({});
}
