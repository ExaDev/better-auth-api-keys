import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

/**
 * The plugin's error codes, registered with better-auth through `$ERROR_CODES` so a host can report a key failure in better-auth's own error shape. The plugin never raises them itself (it has no endpoints); they name the service's outcomes for the host to use.
 */
export const API_KEY_ERROR_CODES = defineErrorCodes({
  INVALID_API_KEY: "The API key is not valid",
  API_KEY_EXPIRED: "The API key has expired",
  API_KEY_NOT_FOUND: "No such API key",
  API_KEY_NAME_TAKEN: "You already have an API key with this name",
  API_KEY_SCOPE_DENIED: "The API key's scopes do not permit this request",
});
