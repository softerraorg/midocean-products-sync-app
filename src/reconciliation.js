const { shopifyRest, shopifyGraphql } = require('./shopifyClient');
const logger = require('./logger');
const { extractIdFromGid } = require('./utils');

const SYNC_TAG = 'midocean-sync';

async function archiveProduct(productId) {
  if (!productId) {
    logger.warn('Cannot archive product: missing productId');
    return false;
  }
  const id = productId.toString().includes('/') ? extractIdFromGid(productId.toString()) : productId.toString();
  if (!id) return false;
  try {
    await shopifyRest('DELETE', `/products/${id}.json`);
    logger.info('Product archived successfully', { productId: id });
    return true;
  } catch (err) {
    logger.error('Failed to archive product', {
      productId: id,
      error: err.message,
      responseData: err.response?.data,
      stack: err.stack
    });
    return false;
  }
}

/**
 * Set product status (active, draft, archived) via REST API
 */
async function setProductStatus(productId, status) {
  if (!productId || !status) return false;
  const id = productId.toString().includes('/') ? extractIdFromGid(productId.toString()) : productId.toString();
  if (!id) return false;
  try {
    await shopifyRest('PUT', `/products/${id}.json`, {
      product: { id: id, status: status }
    });
    logger.info('Product status updated', { productId: id, status });
    return true;
  } catch (err) {
    logger.error('Failed to set product status', { productId: id, status, error: err.message });
    return false;
  }
}

/**
 * Ensure a product has the midocean-sync tag (so it is included in reconciliation). Call when syncing an existing product.
 * Uses GraphQL to read product (avoids REST GET 400 on some API versions).
 */
async function ensureProductHasSyncTag(productId) {
  if (!productId) return;
  const id = productId.toString().includes('/') ? extractIdFromGid(productId.toString()) : productId.toString();
  if (!id) return;
  try {
    const gid = id.toString().startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
    const query = `
      query getProductTags($id: ID!) {
        product(id: $id) {
          id
          tags
        }
      }
    `;
    const data = await shopifyGraphql(query, { id: gid });
    if (!data || !data.product) return;
    const tags = (data.product.tags || []).filter(Boolean);
    if (tags.includes(SYNC_TAG)) return;
    const newTags = [...tags, SYNC_TAG].join(', ');
    await shopifyRest('PUT', `/products/${id}.json`, { product: { id: id, tags: newTags } });
    logger.debug('Added midocean-sync tag to product', { productId: id });
  } catch (err) {
    logger.warn('Could not ensure sync tag on product', { productId: id, error: err.message });
  }
}

/**
 * Fetch all Shopify products that have the midocean-sync tag; returns { id, status, masterCode }[].
 */
async function getShopifyProductsWithSyncTag() {
  const results = [];
  let cursor = null;
  const pageSize = 250;
  try {
    do {
      const query = `
        query getSyncTaggedProducts($query: String!, $first: Int!, $after: String) {
          products(first: $first, query: $query, after: $after) {
            edges {
              node {
                id
                status
                metafield(namespace: "midocean", key: "master_code") {
                  value
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;
      const variables = {
        query: `tag:${SYNC_TAG}`,
        first: pageSize,
        after: cursor
      };
      const data = await shopifyGraphql(query, variables);
      if (!data || !data.products) break;
      const edges = data.products.edges || [];
      for (const edge of edges) {
        const node = edge.node;
        const masterCode = node.metafield?.value || null;
        results.push({
          id: node.id,
          status: node.status,
          masterCode
        });
      }
      const pageInfo = data.products.pageInfo || {};
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    } while (true);
  } catch (err) {
    logger.error('Error fetching products with sync tag', { error: err.message, stack: err.stack });
    throw err;
  }
  return results;
}

/**
 * Reconcile product status with API: archive products no longer in API, activate products that are back in API.
 * Call at the start of sync with the set of master_codes from the current API response.
 */
async function reconcileProductStatus(apiMasterCodes) {
  if (!apiMasterCodes || typeof apiMasterCodes !== 'object') return;
  const set = apiMasterCodes instanceof Set ? apiMasterCodes : new Set(apiMasterCodes);
  let archived = 0;
  let activated = 0;
  try {
    const shopifyProducts = await getShopifyProductsWithSyncTag();
    for (const p of shopifyProducts) {
      const productId = extractIdFromGid(p.id) || p.id;
      const inApi = p.masterCode && set.has(p.masterCode);
      if (inApi && p.status === 'ARCHIVED') {
        const ok = await setProductStatus(productId, 'active');
        if (ok) activated++;
      } else if (!inApi && (p.status === 'ACTIVE' || p.status === 'DRAFT')) {
        const ok = await archiveProduct(productId);
        if (ok) archived++;
      }
    }
    if (archived > 0 || activated > 0) {
      logger.info('Reconciled product status with API', { archived, activated });
    }
  } catch (err) {
    logger.error('Reconciliation failed', { error: err.message, stack: err.stack });
    throw err;
  }
}

module.exports = {
  reconcileProductStatus,
  archiveProduct,
  setProductStatus,
  ensureProductHasSyncTag,
  SYNC_TAG
};
