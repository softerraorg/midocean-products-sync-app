const { shopifyGraphql, shopifyRest } = require('./shopifyClient');
const logger = require('./logger');
const { GRAPHQL_PRODUCTS_LIMIT, GRAPHQL_VARIANTS_LIMIT } = require('./config');

function extractIdFromGid(gid) {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

async function getDefaultLocationId() {
  try {
    const query = `
      query {
        locations(first: 1) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const data = await shopifyGraphql(query);
    
    if (!data || !data.locations) {
      logger.warn('No locations data returned from GraphQL query');
      return null;
    }

    const locations = data.locations.edges || [];
    if (locations.length > 0 && locations[0].node) {
      const locationGid = locations[0].node.id;
      const locationId = extractIdFromGid(locationGid);
      logger.debug('Found default location', { locationId, name: locations[0].node.name });
      return locationId;
    }
    
    logger.warn('No locations found in Shopify store');
    return null;
  } catch (err) {
    logger.error('Error getting default location', {
      error: err.message,
      stack: err.stack
    });
    return null;
  }
}

async function getLocationIdForInventoryItem(inventoryItemGid) {
  if (!inventoryItemGid) {
    logger.warn('getLocationIdForInventoryItem called with invalid GID');
    return null;
  }

  try {
    const query = `
      query getInventoryItem($id: ID!) {
        inventoryItem(id: $id) {
          inventoryLevels(first: 1) {
            edges {
              node {
                location {
                  id
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphql(query, { id: inventoryItemGid });

    if (!data || !data.inventoryItem) {
      logger.debug('Inventory item not found or invalid response', { inventoryItemGid });
      return null;
    }

    const locationGid =
      data.inventoryItem.inventoryLevels?.edges?.[0]?.node?.location?.id;

    if (locationGid) {
      const locationId = extractIdFromGid(locationGid);
      logger.debug('Found location for inventory item', { inventoryItemGid, locationId });
      return locationId;
    }

    // If no location found, get default location and connect inventory item
    logger.debug('No location found for inventory item, attempting to connect to default location', { inventoryItemGid });
    const defaultLocationId = await getDefaultLocationId();
    if (defaultLocationId) {
      try {
        const inventoryItemId = extractIdFromGid(inventoryItemGid);
        if (!inventoryItemId) {
          logger.warn('Failed to extract inventory item ID from GID', { inventoryItemGid });
          return null;
        }

        // Connect inventory item to default location
        await shopifyRest('POST', '/inventory_levels/connect.json', {
          location_id: defaultLocationId,
          inventory_item_id: inventoryItemId
        });
        logger.info('Connected inventory item to default location', { inventoryItemGid, locationId: defaultLocationId });
        return defaultLocationId;
      } catch (err) {
        logger.warn('Failed to connect inventory item to default location', {
          inventoryItemGid,
          locationId: defaultLocationId,
          error: err.message,
          responseData: err.response?.data
        });
        // If connect fails, still return the location ID to try setting inventory
        return defaultLocationId;
      }
    } else {
      logger.warn('No default location available', { inventoryItemGid });
    }

    return null;
  } catch (err) {
    logger.error('Error getting location for inventory item', {
      inventoryItemGid,
      error: err.message,
      stack: err.stack
    });
    return null;
  }
}

async function findVariantBySku(sku, retries = 3) {
  const query = `
    query getVariantBySKU($query: String!) {
      products(first: ${GRAPHQL_PRODUCTS_LIMIT}, query: $query) {
        edges {
          node {
            status
            variants(first: 50) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  for (let attempt = 0; attempt < retries; attempt++) {
    const data = await shopifyGraphql(query, {
      query: `sku:${sku} AND (status:active OR status:draft)`
    });

    const products = (data && data.products && data.products.edges) || [];
    let shouldRetry = false;

    for (const pEdge of products) {
      const product = pEdge.node;
      if (product.status === 'ARCHIVED') continue;

      const variantEdges = (product.variants && product.variants.edges) || [];
      for (const vEdge of variantEdges) {
        const variant = vEdge.node;
        if (variant.sku === sku) {
          const inventoryItemGid = variant.inventoryItem && variant.inventoryItem.id;
          if (!inventoryItemGid) {
            // Wait a bit and retry if inventory item not ready yet
            if (attempt < retries - 1) {
              shouldRetry = true;
              break;
            }
            return null;
          }

          const inventoryItemId = extractIdFromGid(inventoryItemGid);
          const locationId = await getLocationIdForInventoryItem(inventoryItemGid);

          if (!locationId && attempt < retries - 1) {
            // Wait a bit and retry if location not ready yet
            shouldRetry = true;
            break;
          }

          if (locationId) {
            return {
              inventoryItemId,
              locationId
            };
          }
        }
      }
      if (shouldRetry) break;
    }

    // If we should retry, wait and continue to next attempt
    if (shouldRetry && attempt < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    // If variant not found and we have retries left, wait and retry
    if (attempt < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return null;
}

async function setInventoryLevel(inventoryItemId, locationId, quantity) {
  if (!inventoryItemId || !locationId) {
    throw new Error('Missing inventoryItemId or locationId');
  }

  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 0) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }

  const payload = {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available: qty
  };

  try {
    const data = await shopifyRest(
      'POST',
      '/inventory_levels/set.json',
      payload
    );
    return data;
  } catch (err) {
    logger.error('Failed to set inventory level', {
      inventoryItemId,
      locationId,
      quantity: qty,
      error: err.message,
      responseData: err.response?.data
    });
    throw err;
  }
}

/**
 * items: [{ sku, quantity }]
 */
async function updateInventoryForItems(items) {
  if (!Array.isArray(items)) {
    logger.error('updateInventoryForItems called with non-array', { items });
    throw new Error('Items must be an array');
  }

  const results = [];
  let processed = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      logger.warn('Skipping invalid inventory item', { item });
      results.push({
        sku: 'UNKNOWN',
        success: false,
        error: 'Invalid item format'
      });
      continue;
    }

    const { sku, quantity } = item;

    if (!sku || typeof sku !== 'string') {
      logger.warn('Skipping inventory item with invalid SKU', { item });
      results.push({
        sku: sku || 'UNKNOWN',
        success: false,
        error: 'Invalid or missing SKU'
      });
      continue;
    }

    try {
      const variantInfo = await findVariantBySku(sku);

      if (!variantInfo || !variantInfo.inventoryItemId || !variantInfo.locationId) {
        logger.debug('Variant or location not found for inventory update', {
          sku,
          hasVariantInfo: !!variantInfo,
          hasInventoryItemId: !!variantInfo?.inventoryItemId,
          hasLocationId: !!variantInfo?.locationId
        });
        results.push({
          sku,
          success: false,
          error: 'Variant or location not found'
        });
        continue;
      }

      await setInventoryLevel(
        variantInfo.inventoryItemId,
        variantInfo.locationId,
        quantity
      );

      results.push({
        sku,
        success: true,
        quantity: parseInt(quantity, 10) || 0
      });
      processed++;

      // Log progress for large batches
      if (processed % 100 === 0) {
        logger.debug('Inventory update progress', { processed, total: items.length });
      }
    } catch (err) {
      logger.error('Error updating inventory for item', {
        sku,
        quantity,
        error: err.message,
        stack: err.stack
      });
      results.push({
        sku,
        success: false,
        error: err.message || 'Unknown error'
      });
    }
  }

  logger.info('Inventory update batch complete', {
    total: items.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  });

  return results;
}

module.exports = {
  updateInventoryForItems,
  findVariantBySku,
  setInventoryLevel
};
