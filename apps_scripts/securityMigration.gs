/**
 * One-time migration for the August 2026 booking API credential exposure.
 *
 * SECURITY MODEL
 * - The web app must be deployed with appsscript.json webapp.access = DOMAIN.
 * - Google Workspace authentication is the security boundary.
 * - "workspace-auth" below is NOT a secret. It only satisfies the legacy
 *   requireApiKey_ compatibility check until Script A is refactored.
 *
 * Run migrateBookingApiToWorkspaceDomain() once from the Apps Script editor
 * before publishing the patched Zendesk theme.
 */
function migrateBookingApiToWorkspaceDomain() {
  const compatibilityValue = "workspace-auth";
  const props = PropertiesService.getScriptProperties();

  // The existing Script A requires TRAINING_API_KEY. Replace the compromised
  // value with a deliberately public compatibility value; DOMAIN access now
  // performs the actual authentication before Script A executes.
  props.setProperty("TRAINING_API_KEY", compatibilityValue);

  const ss = getSS_();
  if (ss) {
    upsertSetting_(ss, "TRAINING_API_KEY", compatibilityValue);
    upsertSetting_(ss, "AUTH_MODE", "GOOGLE_WORKSPACE_DOMAIN");
    upsertSetting_(ss, "SECURITY_MIGRATED_AT", new Date().toISOString());
  }

  return {
    ok: true,
    auth_mode: "GOOGLE_WORKSPACE_DOMAIN",
    compatibility_key: compatibilityValue,
    next_step: "Redeploy the web app with access restricted to the Workspace domain, then publish the patched Zendesk theme."
  };
}

/**
 * Optional verification helper. Run from the editor after migration.
 * It does not print or return any historical credential.
 */
function verifyBookingSecurityMigration() {
  const props = PropertiesService.getScriptProperties();
  const configured = props.getProperty("TRAINING_API_KEY") === "workspace-auth";
  return {
    ok: configured,
    compatibility_value_configured: configured,
    expected_webapp_access: "DOMAIN"
  };
}
