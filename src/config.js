require('dotenv').config();

const requiredEnv = [
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_API_VERSION',
  'SHOPIFY_ACCESS_TOKEN',
  'MIDOCEAN_BASE_URL',
  'MIDOCEAN_API_KEY'
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing env var: ${key}`);
  }
}

// ============================================
// Configuration Constants
// These can be modified directly in this file
// ============================================

// Sync schedule (cron expression, e.g., "0 0 * * *" for daily at midnight)
const SYNC_SCHEDULE = '0 0 * * *';
const SYNC_TIMEZONE = 'UTC';

// Metafield batch processing configuration
const METAFIELD_BATCH_SIZE = 5;
const METAFIELD_BATCH_DELAY_MS = 500;

// API rate limiting and delays
const API_RATE_LIMIT_THRESHOLD = 5;
const PRODUCT_CREATION_DELAY_MS = 500;
const VARIANT_RETRY_DELAY_MS = 1000;

// GraphQL query limits
const GRAPHQL_PRODUCTS_LIMIT = 50;
const GRAPHQL_VARIANTS_LIMIT = 250;

// Shopify API limits
const MAX_PRODUCT_IMAGES = 250;

// When variant count exceeds this, product is created with first variant only then rest are added (avoids 500 on large payloads)
const CREATE_WITH_FIRST_VARIANT_THRESHOLD = 3;

// Max images to send in the initial create when using split flow (remaining images can be added later)
const MAX_INITIAL_IMAGES_SPLIT_CREATE = 20;

// Product status for newly created products (active, draft, archived)
const NEW_PRODUCT_STATUS = 'active';
// Validate status value
const validStatuses = ['active', 'draft', 'archived'];
if (!validStatuses.includes(NEW_PRODUCT_STATUS)) {
  throw new Error(`Invalid NEW_PRODUCT_STATUS: ${NEW_PRODUCT_STATUS}. Must be one of: ${validStatuses.join(', ')}`);
}

// Product limit for testing (set to null or 0 to process all products)
const PRODUCT_LIMIT = 246;

// Sync only these master_codes (e.g. ['MO2995']). Set to null or [] to sync all.
const SYNC_MASTER_CODES = [];

// Category sync mode:
//   'all'    - sync all products, ignore SYNC_CATEGORIES
//   'only'   - sync only products whose category_level1 is in SYNC_CATEGORIES
//   'except' - sync all products whose category_level1 is NOT in SYNC_CATEGORIES
const SYNC_CATEGORY_MODE = 'all';

// Categories to include/exclude depending on SYNC_CATEGORY_MODE.
// Comma-separated string, e.g. 'Drink & lunchware, Bottles'
const SYNC_CATEGORIES = 'Drink & lunchware';
const LOG_FILE = 'logs/sync.log';
const LOG_LEVEL = 'INFO';

module.exports = {
  storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
  apiVersion: process.env.SHOPIFY_API_VERSION,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  midoceanApiKey: process.env.MIDOCEAN_API_KEY,
  midoceanBaseUrl: process.env.MIDOCEAN_BASE_URL,
  // Configuration constants
  SYNC_SCHEDULE,
  SYNC_TIMEZONE,
  METAFIELD_BATCH_SIZE,
  METAFIELD_BATCH_DELAY_MS,
  API_RATE_LIMIT_THRESHOLD,
  PRODUCT_CREATION_DELAY_MS,
  VARIANT_RETRY_DELAY_MS,
  GRAPHQL_PRODUCTS_LIMIT,
  GRAPHQL_VARIANTS_LIMIT,
  MAX_PRODUCT_IMAGES,
  CREATE_WITH_FIRST_VARIANT_THRESHOLD,
  MAX_INITIAL_IMAGES_SPLIT_CREATE,
  NEW_PRODUCT_STATUS,
  PRODUCT_LIMIT,
  SYNC_MASTER_CODES,
  SYNC_CATEGORY_MODE,
  SYNC_CATEGORIES,
  LOG_FILE,
  LOG_LEVEL
};
