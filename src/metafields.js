const shopifyRest = require('./shopifyClient').shopifyRest;
const { shopifyGraphql } = require('./shopifyClient');
const logger = require('./logger');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractIdFromGid(gid) {
  if (!gid) return null;
  const parts = gid.toString().split('/');
  return parts[parts.length - 1];
}

/**
 * Builds all product metafields from productData
 * Returns array of metafield objects ready for API calls
 * @param {Object} productData - Product data from API
 * @param {Array} productDigitalAssets - Full product-level digital_assets array (no type filtering); used for midocean.digital_assets metafield
 */
function buildProductMetafields(productData, productDigitalAssets = []) {
  const metafields = [];

  // Helper to add metafield if value exists
  const addMetafield = (key, value, type, validator = null) => {
    if (value !== undefined && value !== null && value !== '') {
      let processedValue = value;
      
      // Apply validator if provided
      if (validator) {
        const validationResult = validator(value);
        if (!validationResult.valid) {
          logger.debug(`Skipping invalid ${key} metafield`, {
            key,
            value,
            reason: validationResult.reason,
            master_code: productData.master_code
          });
          return;
        }
        processedValue = validationResult.value;
      }
      
      metafields.push({
        namespace: 'midocean',
        key,
        value: processedValue.toString(),
        type
      });
    }
  };

  // Text fields
  addMetafield('master_code', productData.master_code, 'single_line_text_field');
  addMetafield('product_name', productData.product_name, 'single_line_text_field');
  addMetafield('printable', productData.printable?.toString(), 'single_line_text_field');
  addMetafield('type_of_products', productData.type_of_products, 'single_line_text_field');
  addMetafield('commodity_code', productData.commodity_code, 'single_line_text_field');
  addMetafield('category_code', productData.category_code, 'single_line_text_field');
  addMetafield('country_of_origin', productData.country_of_origin, 'single_line_text_field');
  addMetafield('dimensions', productData.dimensions, 'single_line_text_field');
  addMetafield('length_unit', productData.length_unit, 'single_line_text_field');
  addMetafield('width_unit', productData.width_unit, 'single_line_text_field');
  addMetafield('height_unit', productData.height_unit, 'single_line_text_field');
  addMetafield('volume_unit', productData.volume_unit, 'single_line_text_field');
  addMetafield('carton_length_unit', productData.carton_length_unit, 'single_line_text_field');
  addMetafield('carton_width_unit', productData.carton_width_unit, 'single_line_text_field');
  addMetafield('carton_height_unit', productData.carton_height_unit, 'single_line_text_field');
  addMetafield('carton_volume_unit', productData.carton_volume_unit, 'single_line_text_field');
  addMetafield('carton_gross_weight_unit', productData.carton_gross_weight_unit, 'single_line_text_field');
  addMetafield('material', productData.material, 'single_line_text_field');
  addMetafield('packaging_after_printing', productData.packaging_after_printing, 'single_line_text_field');

  // Integer fields
  addMetafield('master_id', productData.master_id, 'number_integer', (val) => {
    const parsed = parseInt(val, 10);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('number_of_print_positions', productData.number_of_print_positions, 'number_integer', (val) => {
    const parsed = parseInt(val, 10);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('pcs_in_inner_box', productData.pcs_in_inner_box, 'number_integer', (val) => {
    const parsed = parseInt(val, 10);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('outer_box_quantity', productData.outer_box_quantity, 'number_integer', (val) => {
    const parsed = parseInt(val, 10);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('gross_weight', productData.gross_weight, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('gross_weight_unit', productData.gross_weight_unit, 'single_line_text_field');

  // Decimal fields
  addMetafield('length', productData.length, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('width', productData.width, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('height', productData.height, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('volume', productData.volume, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('net_weight', productData.net_weight, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('net_weight_unit', productData.net_weight_unit, 'single_line_text_field');
  addMetafield('carton_length', productData.carton_length, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('carton_width', productData.carton_width, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('carton_height', productData.carton_height, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('carton_volume', productData.carton_volume, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });
  addMetafield('carton_gross_weight', productData.carton_gross_weight, 'number_decimal', (val) => {
    const parsed = parseFloat(val);
    return { valid: !isNaN(parsed), value: parsed };
  });

  // Date/DateTime fields
  addMetafield('timestamp', productData.timestamp, 'date_time');

  // JSON fields: product-level digital_assets (full array of objects, no type filtering)
  if (productDigitalAssets && productDigitalAssets.length > 0) {
    metafields.push({
      namespace: 'midocean',
      key: 'digital_assets',
      value: JSON.stringify(productDigitalAssets),
      type: 'json'
    });
  }

  return metafields;
}

/**
 * Builds all variant metafields from variant data
 * Returns array of metafield objects ready for API calls
 * @param {Object} variant - Variant data from API
 */
function buildVariantMetafields(variant) {
  const metafields = [];

  const addMetafield = (key, value, type, validator = null) => {
    if (value !== undefined && value !== null && value !== '') {
      let processedValue = value;

      if (validator) {
        const validationResult = validator(value);
        if (!validationResult.valid) {
          logger.debug(`Skipping invalid variant ${key} metafield`, {
            key,
            value,
            reason: validationResult.reason,
            sku: variant.sku
          });
          return;
        }
        processedValue = validationResult.value;
      }

      metafields.push({
        namespace: 'midocean',
        key,
        value: processedValue.toString(),
        type
      });
    }
  };

  // Text fields
  addMetafield('sku', variant.sku, 'single_line_text_field');
  addMetafield('color_description', variant.color_description, 'single_line_text_field');
  addMetafield('color_group', variant.color_group, 'single_line_text_field');
  addMetafield('pms_color', variant.pms_color, 'single_line_text_field');
  addMetafield('color_code', variant.color_code, 'single_line_text_field');
  addMetafield('size', variant.size, 'single_line_text_field');
  addMetafield('category_level1', variant.category_level1, 'single_line_text_field');
  addMetafield('category_level2', variant.category_level2, 'single_line_text_field');
  addMetafield('category_level3', variant.category_level3, 'single_line_text_field');
  addMetafield('gtin', variant.gtin, 'single_line_text_field');
  addMetafield('discontinued_date', variant.discontinued_date, 'single_line_text_field');

  // JSON fields: variant-level digital_assets (full array of objects, no type filtering)
  if (variant.digital_assets && Array.isArray(variant.digital_assets) && variant.digital_assets.length > 0) {
    metafields.push({
      namespace: 'midocean',
      key: 'digital_assets',
      value: JSON.stringify(variant.digital_assets),
      type: 'json'
    });
  }

  return metafields;
}

const METAFIELDS_SET_MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key namespace value }
      userErrors { field message }
    }
  }
`;

/**
 * Upserts product metafields in batches using GraphQL metafieldsSet (create or update).
 * @param {string} productId - Shopify product ID (numeric or GID)
 * @param {Array} metafields - Array of metafield objects
 * @param {string} masterCode - Product master code for logging
 * @param {number} batchSize - Number of metafields per batch (default: 5)
 * @param {number} delayBetweenBatches - Delay in ms between batches (default: 500)
 */
async function createProductMetafieldsInBatches(productId, metafields, masterCode, batchSize = 5, delayBetweenBatches = 500) {
  if (!metafields || metafields.length === 0) {
    logger.debug('No metafields to create', { productId, master_code: masterCode });
    return { success: 0, failed: 0, skipped: 0 };
  }

  const productIdStr = productId.toString().includes('/')
    ? extractIdFromGid(productId.toString())
    : productId.toString();

  const ownerGid = `gid://shopify/Product/${productIdStr}`;
  const stats = { success: 0, failed: 0, skipped: 0 };
  const totalMetafields = metafields.length;

  logger.info('Starting bulk product metafield creation', {
    productId: productIdStr,
    master_code: masterCode,
    totalMetafields,
    batchSize,
    delayBetweenBatches
  });

  for (let i = 0; i < metafields.length; i += batchSize) {
    const batch = metafields.slice(i, i + batchSize);

    const metafieldsInput = batch.map(m => ({
      ownerId: ownerGid,
      namespace: m.namespace,
      key: m.key,
      value: m.value.toString(),
      type: m.type
    }));

    try {
      const data = await shopifyGraphql(METAFIELDS_SET_MUTATION, { metafields: metafieldsInput });
      const userErrors = data?.metafieldsSet?.userErrors || [];
      const created = data?.metafieldsSet?.metafields || [];

      stats.success += created.length;

      if (userErrors.length > 0) {
        stats.failed += userErrors.length;
        logger.warn('Product metafield upsert errors', {
          productId: productIdStr,
          master_code: masterCode,
          errors: userErrors
        });
      }
    } catch (err) {
      stats.failed += batch.length;
      logger.warn('Failed to upsert product metafield batch', {
        productId: productIdStr,
        master_code: masterCode,
        error: err.message,
        responseData: err.response?.data
      });
    }

    if (i + batchSize < metafields.length) {
      await sleep(delayBetweenBatches);
    }
  }

  logger.info('Completed bulk product metafield creation', {
    productId: productIdStr,
    master_code: masterCode,
    totalMetafields,
    success: stats.success,
    failed: stats.failed,
    skipped: stats.skipped,
    successRate: `${((stats.success / totalMetafields) * 100).toFixed(1)}%`
  });

  return stats;
}

/**
 * Upserts variant metafields in batches using GraphQL metafieldsSet (create or update).
 * @param {string} variantId - Shopify variant ID (numeric or GID)
 * @param {Array} metafields - Array of metafield objects
 * @param {string} sku - Variant SKU for logging
 * @param {number} batchSize - Number of metafields per batch (default: 5)
 * @param {number} delayBetweenBatches - Delay in ms between batches (default: 500)
 */
async function createVariantMetafieldsInBatches(variantId, metafields, sku, batchSize = 5, delayBetweenBatches = 500) {
  if (!metafields || metafields.length === 0) {
    logger.debug('No variant metafields to create', { variantId, sku });
    return { success: 0, failed: 0, skipped: 0 };
  }

  const variantIdStr = variantId.toString().includes('/')
    ? extractIdFromGid(variantId.toString())
    : String(variantId);

  const ownerGid = `gid://shopify/ProductVariant/${variantIdStr}`;
  const stats = { success: 0, failed: 0, skipped: 0 };
  const totalMetafields = metafields.length;

  logger.debug('Starting bulk variant metafield creation', {
    variantId: variantIdStr,
    sku,
    totalMetafields,
    batchSize
  });

  for (let i = 0; i < metafields.length; i += batchSize) {
    const batch = metafields.slice(i, i + batchSize);

    const metafieldsInput = batch.map(m => ({
      ownerId: ownerGid,
      namespace: m.namespace,
      key: m.key,
      value: m.value.toString(),
      type: m.type
    }));

    try {
      const data = await shopifyGraphql(METAFIELDS_SET_MUTATION, { metafields: metafieldsInput });
      const userErrors = data?.metafieldsSet?.userErrors || [];
      const created = data?.metafieldsSet?.metafields || [];

      stats.success += created.length;

      if (userErrors.length > 0) {
        stats.failed += userErrors.length;
        logger.warn('Variant metafield upsert errors', {
          variantId: variantIdStr,
          sku,
          errors: userErrors
        });
      }
    } catch (err) {
      stats.failed += batch.length;
      logger.warn('Failed to upsert variant metafield batch', {
        variantId: variantIdStr,
        sku,
        error: err.message,
        responseData: err.response?.data
      });
    }

    if (i + batchSize < metafields.length) {
      await sleep(delayBetweenBatches);
    }
  }

  logger.debug('Completed bulk variant metafield creation', {
    variantId: variantIdStr,
    sku,
    totalMetafields,
    success: stats.success,
    failed: stats.failed,
    skipped: stats.skipped
  });

  return stats;
}

module.exports = {
  buildProductMetafields,
  buildVariantMetafields,
  createProductMetafieldsInBatches,
  createVariantMetafieldsInBatches
};
