"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} must include ${expected}`);
}

function assertExcludes(source, unexpected, label) {
  assert.ok(!source.includes(unexpected), `${label} must not include ${unexpected}`);
}

function manifestSetting(manifest, identifier) {
  for (const group of manifest.settings || []) {
    for (const variable of group.variables || []) {
      if (variable.identifier === identifier) return variable;
    }
  }
  assert.fail(`manifest must define ${identifier}`);
}

const requestTemplate = read("templates/new_request_page.hbs");
const requestBundle = read("assets/new-request-form-bundle.js");
const documentHead = read("templates/document_head.hbs");
const themeScript = read("script.js");
const manifest = JSON.parse(read("manifest.json"));

const requestRoutingStart = themeScript.indexOf("// Only run on new request page");
const requestRoutingEnd = themeScript.indexOf("const isPrintableChar", requestRoutingStart);
assert.ok(requestRoutingStart >= 0, "theme script must include new-request routing");
assert.ok(
  requestRoutingEnd > requestRoutingStart,
  "new-request routing must have a stable end boundary"
);
const requestRouting = themeScript.slice(requestRoutingStart, requestRoutingEnd);

// Zendesk's renderer owns the subject field, its React state, validation errors,
// CSRF setup and final submission. Theme code may style the form, but must not
// intercept that submit pipeline or replace the renderer-owned subject state.
assertIncludes(
  requestTemplate,
  'import { renderNewRequestForm } from "new-request-form";',
  "new request template"
);
assertIncludes(
  requestTemplate,
  "requestForm: {{json new_request_form}}",
  "new request template"
);
assertIncludes(
  requestTemplate,
  "renderNewRequestForm(settings, props, container);",
  "new request template"
);
assertExcludes(
  requestTemplate,
  'form.addEventListener("submit"',
  "new request template"
);
assertExcludes(requestTemplate, "stopImmediatePropagation", "new request template");
assertExcludes(requestTemplate, "checkValidity()", "new request template");
assertExcludes(requestTemplate, "reportValidity()", "new request template");

// The Subject field must remain physically interactive as well as wired to
// Zendesk React state. Guard against stale disabled/readonly attributes and
// theme layers that can swallow pointer input without replacing the field.
assertIncludes(
  requestTemplate,
  'input[name="request[subject]"]',
  "subject editability guard"
);
assertIncludes(requestTemplate, "pointer-events: auto !important", "subject editability guard");
assertIncludes(requestTemplate, "user-select: text !important", "subject editability guard");
assertIncludes(requestTemplate, "subject.disabled = false", "subject editability guard");
assertIncludes(requestTemplate, "subject.readOnly = false", "subject editability guard");
assertIncludes(requestTemplate, "new MutationObserver", "subject editability guard");
assertExcludes(requestTemplate, "subject.value =", "subject editability guard");

// Guard the vendored Zendesk bundle contract that renders and updates the
// standard request subject before its native submit handler posts the form.
assertIncludes(requestBundle, '"subject"===t.type', "Zendesk request renderer");
assert.ok(
  /"subject"===t\.type[\s\S]{0,300}onChange/.test(requestBundle),
  "Zendesk request renderer must keep subject state wired to onChange"
);
assertIncludes(requestBundle, "handleSubmit", "Zendesk request renderer");

// A global document-head redirect used to send generic request URLs (including
// internal staff) to the external/tenant form and also matched request history.
// Routing belongs in the segment-aware theme script, not in document_head.
assertExcludes(documentHead, "external_support_form_id", "document head");
assertExcludes(documentHead, "/requests(?:\\/new)?", "document head");
assertExcludes(documentHead, "ticket_form_id=", "document head");

// Existing explicit form selections must be left alone. When no form is in the
// URL, internal and tenant users must use their configurable form IDs.
assert.ok(
  /const\s+urlFormId\s*=\s*params\.get\(["']ticket_form_id["']\);[\s\S]{0,120}if\s*\(urlFormId\)\s*\{\s*return;\s*\}/.test(
    requestRouting
  ),
  "request routing must preserve an explicit ticket_form_id"
);
assert.ok(
  /ticket_form_id=\$\{segmentSettings\.internalFormId\}/.test(requestRouting),
  "internal request routing must use internal_request_form_id from theme settings"
);
assert.ok(
  /ticket_form_id=\$\{segmentSettings\.tenantFormId\}/.test(requestRouting),
  "tenant request routing must use tenant_request_form_id from theme settings"
);
assertExcludes(requestRouting, "/hc/en-us/requests/new", "request routing");
assert.ok(
  /HelpCenter[\s\S]{0,240}locale|window\.location\.pathname/.test(requestRouting),
  "request routing must preserve or derive the active Help Center locale"
);

// The renderer receives settings.show_form_selector. Legacy label matching must
// not override that setting or hide an unrelated translated combobox.
assert.strictEqual(
  manifestSetting(manifest, "show_form_selector").type,
  "checkbox",
  "show_form_selector must remain a boolean theme setting"
);
assertIncludes(requestTemplate, "const settings = {{json settings}};", "new request template");
assertExcludes(themeScript, 'text.includes("Please choose your issue")', "request form UI");
assertExcludes(themeScript, "Hiding form selector field", "request form UI");

// Staff and tenant support forms are separate configurable routes. Keep the IDs
// valid and distinct, and keep both active/compatibility home templates wired to
// the corresponding setting rather than to the other audience's form.
const internalRequestFormId = String(
  manifestSetting(manifest, "internal_request_form_id").value || ""
);
const tenantRequestFormId = String(
  manifestSetting(manifest, "tenant_request_form_id").value || ""
);
assert.match(internalRequestFormId, /^\d+$/, "internal request form ID must be numeric");
assert.match(tenantRequestFormId, /^\d+$/, "tenant request form ID must be numeric");
assert.notStrictEqual(
  internalRequestFormId,
  tenantRequestFormId,
  "internal and tenant request form IDs must remain distinct"
);

[
  "templates/home_internal.hbs",
  "templates/custom_pages/home_internal.hbs"
].forEach((relativePath) => {
  assertIncludes(read(relativePath), "settings.internal_request_form_id", relativePath);
});

[
  "templates/home_tenant.hbs",
  "templates/custom_pages/home_tenant.hbs"
].forEach((relativePath) => {
  assertIncludes(read(relativePath), "settings.tenant_request_form_id", relativePath);
});

console.log("request form contract tests passed");
