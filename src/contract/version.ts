/**
 * The version of this package's port contracts ({@link ApiKeyStore}, {@link KeyHasher}, {@link RandomSource}, {@link Clock}, {@link ScopeAuthoriser}). Every port carries it as a literal `version` field, so an adapter written against one version stops type-checking against the next rather than failing at runtime. Bumped on any breaking change to a port's shape.
 */
export const API_KEYS_CONTRACT_VERSION = 1;

/** The literal type of {@link API_KEYS_CONTRACT_VERSION}, which every port's `version` field must equal. */
export type ApiKeysContractVersion = typeof API_KEYS_CONTRACT_VERSION;
