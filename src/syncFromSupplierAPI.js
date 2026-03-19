const axios = require('axios');
const { midoceanApiKey, midoceanBaseUrl, PRODUCT_LIMIT, SYNC_MASTER_CODES, SYNC_CATEGORY_MODE, SYNC_CATEGORIES } = require('./config');
const { updateInventoryForItems } = require('./inventory');
const { upsertProduct } = require('./upsertProduct');
const { reconcileProductStatus } = require('./reconciliation');
const logger = require('./logger');
const { sleep } = require('./shopifyClient');

/**
 * Formats duration in seconds to a human-readable string (hours, minutes, seconds)
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string (e.g., "3h 30m 15s" or "45m 30s" or "30s")
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

const categoryFilter = null; // replaced by SYNC_CATEGORY_MODE / SYNC_CATEGORIES from config
async function fetchSupplierProducts(retries = 3) {
  // Fetch from API with retry logic
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      logger.debug(`Fetching products from API (attempt ${attempt + 1}/${retries})`);
      const response = await axios.get(`${midoceanBaseUrl}/products/2.0?language=en`, {
        headers: {
          'x-Gateway-APIKey': midoceanApiKey
        },
        timeout: 30000 // 30 second timeout
      });

      // Validate response structure
      if (!response.data) {
        throw new Error('Empty response from products API');
      }

      const products = Array.isArray(response.data) ? response.data : (response.data.products || response.data.items || []);
      logger.info('Successfully fetched products from API', { count: products.length });
      return response.data;
    } catch (err) {
      const isLastAttempt = attempt === retries - 1;
      const errorDetails = {
        attempt: attempt + 1,
        maxRetries: retries,
        status: err.response?.status,
        statusText: err.response?.statusText,
        message: err.message
      };

      if (err.response?.status === 429) {
        const retryAfter = err.response.headers['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
        logger.warn('Rate limited when fetching products, waiting before retry', { waitMs, ...errorDetails });
        await sleep(waitMs);
        continue;
      }

      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.warn('Timeout when fetching products', errorDetails);
        if (!isLastAttempt) {
          await sleep((attempt + 1) * 2000);
          continue;
        }
      }

      if (isLastAttempt) {
        logger.error('Failed to fetch products after all retries', errorDetails);
        throw new Error(`Failed to fetch products: ${err.message}`);
      }

      logger.warn('Error fetching products, retrying', errorDetails);
      await sleep((attempt + 1) * 2000);
    }
  }

  throw new Error('Max retries exceeded for fetching products');
}

async function fetchStock(retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      logger.debug(`Fetching stock from API (attempt ${attempt + 1}/${retries})`);
      const response = await axios.get(`${midoceanBaseUrl}/stock/2.0`, {
        headers: {
          'x-Gateway-APIKey': midoceanApiKey
        },
        timeout: 30000
      });

      if (!response.data) {
        throw new Error('Empty response from stock API');
      }

      const stock = response.data.stock || [];
      logger.info('Successfully fetched stock from API', { count: stock.length });
      return stock;
    } catch (err) {
      const isLastAttempt = attempt === retries - 1;
      const errorDetails = {
        attempt: attempt + 1,
        maxRetries: retries,
        status: err.response?.status,
        message: err.message
      };

      if (err.response?.status === 429) {
        const retryAfter = err.response.headers['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
        logger.warn('Rate limited when fetching stock, waiting before retry', { waitMs, ...errorDetails });
        await sleep(waitMs);
        continue;
      }

      if (isLastAttempt) {
        logger.error('Failed to fetch stock after all retries', errorDetails);
        throw new Error(`Failed to fetch stock: ${err.message}`);
      }

      logger.warn('Error fetching stock, retrying', errorDetails);
      await sleep((attempt + 1) * 2000);
    }
  }

  throw new Error('Max retries exceeded for fetching stock');
}

async function fetchPricelist(retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      logger.debug(`Fetching pricelist from API (attempt ${attempt + 1}/${retries})`);
      const response = await axios.get(`${midoceanBaseUrl}/pricelist/2.0/`, {
        headers: {
          'x-Gateway-APIKey': midoceanApiKey
        },
        timeout: 30000
      });

      if (!response.data) {
        throw new Error('Empty response from pricelist API');
      }

      const prices = response.data.price || [];
      logger.info('Successfully fetched pricelist from API', { count: prices.length });
      return prices;
    } catch (err) {
      const isLastAttempt = attempt === retries - 1;
      const errorDetails = {
        attempt: attempt + 1,
        maxRetries: retries,
        status: err.response?.status,
        message: err.message
      };

      if (err.response?.status === 429) {
        const retryAfter = err.response.headers['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
        logger.warn('Rate limited when fetching pricelist, waiting before retry', { waitMs, ...errorDetails });
        await sleep(waitMs);
        continue;
      }

      if (isLastAttempt) {
        logger.error('Failed to fetch pricelist after all retries', errorDetails);
        throw new Error(`Failed to fetch pricelist: ${err.message}`);
      }

      logger.warn('Error fetching pricelist, retrying', errorDetails);
      await sleep((attempt + 1) * 2000);
    }
  }

  throw new Error('Max retries exceeded for fetching pricelist');
}

// Validate product data structure
function validateProduct(product) {
  const errors = [];

  if (!product) {
    errors.push('Product is null or undefined');
    return { valid: false, errors };
  }

  if (!product.master_code && !product.variants?.some(v => v.sku)) {
    errors.push('Product missing master_code and all variants missing SKU');
  }

  return { valid: errors.length === 0, errors };
}

// Validate variant data structure
function validateVariant(variant) {
  const errors = [];

  if (!variant) {
    errors.push('Variant is null or undefined');
    return { valid: false, errors };
  }

  if (!variant.sku) {
    errors.push('Variant missing SKU');
  }

  return { valid: errors.length === 0, errors };
}

// Map Midocean API product structure to internal format
function mapSupplierRowToProduct(product, variant) {
  try {
    // Validate inputs
    const productValidation = validateProduct(product);
    if (!productValidation.valid) {
      logger.warn('Invalid product data', { master_code: product?.master_code, errors: productValidation.errors });
    }

    const variantValidation = validateVariant(variant);
    if (!variantValidation.valid) {
      logger.warn('Invalid variant data', { sku: variant?.sku, errors: variantValidation.errors });
    }

    // Extract images from variant's digital_assets where type is "image"
    const images = [];
    if (variant && variant.digital_assets && Array.isArray(variant.digital_assets)) {
      variant.digital_assets
        .filter(asset => asset && asset.type === 'image')
        .forEach(asset => {
          const imageUrl = asset.url_highress || asset.url;
          if (imageUrl && typeof imageUrl === 'string') {
            images.push(imageUrl);
          }
        });
    }

    // Safely parse weight
    let weight = 0;
    try {
      const weightStr = product?.gross_weight || product?.net_weight;
      if (weightStr) {
        weight = parseFloat(weightStr);
        if (isNaN(weight)) weight = 0;
      }
    } catch (err) {
      logger.debug('Failed to parse weight', { error: err.message, product: product?.master_code });
    }

    return {
      supplierSku: variant?.sku || product?.master_code || '',
      title: product?.product_name || '',
      description: product?.long_description || product?.short_description || '',
      category: product?.product_class || variant?.category_level1 || '',
      subcategory: variant?.category_level2 || variant?.category_level3 || '',
      colour: variant?.color_description || variant?.color_group || '',
      size: '', // Size not in API structure
      price: 0, // Price not in API structure
      stock: 0, // Stock not in API structure, default to 0
      images: images,
      weight: weight,
      dimensions: product?.dimensions || ''
    };
  } catch (err) {
    logger.error('Error mapping product to internal format', {
      error: err.message,
      master_code: product?.master_code,
      variant_sku: variant?.sku
    });
    // Return minimal valid structure
    return {
      supplierSku: variant?.sku || product?.master_code || 'UNKNOWN',
      title: '',
      description: '',
      category: '',
      subcategory: '',
      colour: '',
      size: '',
      price: 0,
      stock: 0,
      images: [],
      weight: 0,
      dimensions: ''
    };
  }
}

function getAllCategoryLevel1(products) {
  const categories = new Set();
  for (const product of products) {
    if (product.variants && Array.isArray(product.variants)) {
      for (const variant of product.variants) {
        if (variant.category_level1) {
          categories.add(variant.category_level1);
        }
      }
    }
  }
  return Array.from(categories).sort();
}

async function main() {
  const syncStats = {
    startTime: new Date(),
    productsProcessed: 0,
    productsCreated: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    productsFailed: 0,
    variantsProcessed: 0,
    inventoryUpdated: 0,
    inventoryFailed: 0,
    errors: []
  };

  try {
    logger.info('Starting product sync', { timestamp: syncStats.startTime.toISOString() });

    // Fetch products with error handling
    let data;
    try {
      data = await fetchSupplierProducts();
    } catch (err) {
      logger.error('Failed to fetch products', { error: err.message, stack: err.stack });
      syncStats.errors.push({ type: 'FETCH_PRODUCTS', error: err.message });
      throw err;
    }

    // Validate and parse products
    if (!data) {
      throw new Error('No data returned from products API');
    }

    const products = Array.isArray(data) ? data : (data.products || data.items || []);

    if (!Array.isArray(products)) {
      throw new Error('Products data is not an array');
    }

    logger.info('Loaded products', { count: products.length });

    // Show available categories
    const availableCategories = getAllCategoryLevel1(products);
    logger.info(`Available category_level1 values`, { count: availableCategories.length, categories: availableCategories.slice(0, 10) });

    // Fetch stock data with error handling
    let stockData = [];
    try {
      stockData = await fetchStock();
      if (!Array.isArray(stockData)) {
        logger.warn('Stock data is not an array, using empty array');
        stockData = [];
      }
    } catch (err) {
      logger.error('Failed to fetch stock, continuing without stock data', { error: err.message });
      syncStats.errors.push({ type: 'FETCH_STOCK', error: err.message });
      stockData = [];
    }

    // Create a stock lookup map by SKU with validation
    const stockMap = new Map();
    let invalidStockItems = 0;
    for (const stockItem of stockData) {
      if (!stockItem || typeof stockItem !== 'object') {
        invalidStockItems++;
        continue;
      }
      if (stockItem.sku && typeof stockItem.sku === 'string') {
        const qty = parseInt(stockItem.qty, 10);
        stockMap.set(stockItem.sku, isNaN(qty) ? 0 : qty);
      } else {
        invalidStockItems++;
      }
    }
    if (invalidStockItems > 0) {
      logger.warn('Invalid stock items skipped', { count: invalidStockItems, total: stockData.length });
    }
    logger.info('Created stock map', { validItems: stockMap.size, invalidItems: invalidStockItems });

    // Fetch pricelist data with error handling
    let pricelistData = [];
    try {
      pricelistData = await fetchPricelist();
      if (!Array.isArray(pricelistData)) {
        logger.warn('Pricelist data is not an array, using empty array');
        pricelistData = [];
      }
    } catch (err) {
      logger.error('Failed to fetch pricelist, continuing without price data', { error: err.message });
      syncStats.errors.push({ type: 'FETCH_PRICELIST', error: err.message });
      pricelistData = [];
    }

    // Create a price lookup map by SKU with validation
    const priceMap = new Map();
    let invalidPriceItems = 0;
    for (const priceItem of pricelistData) {
      if (!priceItem || typeof priceItem !== 'object') {
        invalidPriceItems++;
        continue;
      }
      if (priceItem.sku && priceItem.price) {
        try {
          // Convert comma decimal separator to dot, remove any spaces
          const priceStr = priceItem.price.toString().replace(',', '.').trim();
          const price = parseFloat(priceStr);
          if (!isNaN(price) && price >= 0) {
            priceMap.set(priceItem.sku, priceStr);
          } else {
            invalidPriceItems++;
            logger.debug('Invalid price value', { sku: priceItem.sku, price: priceItem.price });
          }
        } catch (err) {
          invalidPriceItems++;
          logger.debug('Error parsing price', { sku: priceItem.sku, error: err.message });
        }
      } else {
        invalidPriceItems++;
      }
    }
    if (invalidPriceItems > 0) {
      logger.warn('Invalid price items skipped', { count: invalidPriceItems, total: pricelistData.length });
    }
    logger.info('Created price map', { validItems: priceMap.size, invalidItems: invalidPriceItems });

    // Filter products by category_level1 based on SYNC_CATEGORY_MODE
    let filteredProducts = products;
    const mode = (SYNC_CATEGORY_MODE || 'all').toLowerCase().trim();
    if (mode !== 'all') {
      // Parse categories once into a lowercased Set for O(1) lookup
      const categorySet = new Set(
        (SYNC_CATEGORIES || '')
          .split(',')
          .map(c => c.trim().toLowerCase())
          .filter(Boolean)
      );

      if (categorySet.size > 0) {
        filteredProducts = products.filter(product => {
          if (!product || typeof product !== 'object') return false;
          if (!product.variants || !Array.isArray(product.variants)) return false;
          const hasMatchingCategory = product.variants.some(variant => {
            if (!variant || typeof variant !== 'object') return false;
            const cat = variant.category_level1;
            return cat && typeof cat === 'string' && categorySet.has(cat.trim().toLowerCase());
          });
          return mode === 'only' ? hasMatchingCategory : !hasMatchingCategory;
        });

        logger.info('Filtered products by category', {
          mode,
          categories: Array.from(categorySet),
          total: products.length,
          filtered: filteredProducts.length
        });
      } else {
        logger.warn('SYNC_CATEGORY_MODE is set but SYNC_CATEGORIES is empty - syncing all products');
      }
    } else {
      logger.info('No category filter applied - syncing all products (SYNC_CATEGORY_MODE=all)');
    }

    // Filter by master_code if configured
    if (SYNC_MASTER_CODES && SYNC_MASTER_CODES.length > 0) {
      const codeSet = new Set(SYNC_MASTER_CODES.map(c => c && String(c).trim()).filter(Boolean));
      filteredProducts = filteredProducts.filter(p => p && p.master_code && codeSet.has(String(p.master_code).trim()));
      logger.info('Filtered products by master_code', { total: products.length, filtered: filteredProducts.length, codes: SYNC_MASTER_CODES });
    }

    // Apply product limit if configured (for testing)
    let limitedProducts = filteredProducts;
    if (PRODUCT_LIMIT && PRODUCT_LIMIT > 0) {
      limitedProducts = filteredProducts.slice(0, PRODUCT_LIMIT);
      logger.info('Product processing limit applied', { limit: PRODUCT_LIMIT, total: filteredProducts.length });
    }

    // Reconcile status with API only when syncing all products (not for partial syncs)
    const apiMasterCodes = new Set(limitedProducts.map(p => p && p.master_code).filter(Boolean));
    const isPartialSync = (SYNC_MASTER_CODES && SYNC_MASTER_CODES.length > 0) || (mode !== 'all');
    if (!isPartialSync) {
      try {
        await reconcileProductStatus(apiMasterCodes);
      } catch (err) {
        logger.error('Reconciliation failed, continuing with sync', { error: err.message });
        syncStats.errors.push({ type: 'RECONCILE_STATUS', error: err.message });
      }
    } else {
      logger.info('Skipping reconciliation (partial sync - SYNC_MASTER_CODES or category filter is active)');
    }

    // First, create/upsert products with their variants
    logger.info('Starting product creation/update phase');
    for (let i = 0; i < limitedProducts.length; i++) {
      const product = limitedProducts[i];
      syncStats.productsProcessed++;

      if (!product || typeof product !== 'object') {
        logger.warn('Skipping invalid product', { index: i });
        syncStats.productsSkipped++;
        continue;
      }

      const variants = (product.variants && Array.isArray(product.variants))
        ? product.variants.filter(v => v && typeof v === 'object')
        : [product]; // If no variants, treat product as single variant

      if (variants.length === 0) {
        logger.warn('Product has no valid variants', { master_code: product.master_code });
        syncStats.productsSkipped++;
        continue;
      }

      syncStats.variantsProcessed += variants.length;

      try {
        const result = await upsertProduct(product, variants, priceMap);
        if (result) {
          // Determine if it was created or updated (result will have id if it exists)
          syncStats.productsUpdated++;
        } else {
          syncStats.productsSkipped++;
        }
        // Small delay to ensure Shopify has processed the product creation
        const { PRODUCT_CREATION_DELAY_MS } = require('./config');
        await sleep(PRODUCT_CREATION_DELAY_MS);
      } catch (err) {
        syncStats.productsFailed++;
        syncStats.errors.push({
          type: 'PRODUCT_UPSERT',
          master_code: product?.master_code,
          error: err.message,
          stack: err.stack
        });
        logger.error('Error creating/updating product', {
          master_code: product?.master_code,
          error: err.message,
          stack: err.stack
        });
      }
    }

    // Additional delay before inventory update to ensure all products are ready
    logger.info('Waiting for products to be fully processed before inventory update');
    await sleep(2000);

    // Flatten products to variants (each variant is a separate inventory item)
    const allVariants = [];
    for (const product of limitedProducts) {
      if (!product || typeof product !== 'object') continue;

      if (product.variants && Array.isArray(product.variants)) {
        for (const variant of product.variants) {
          if (variant && typeof variant === 'object') {
            allVariants.push({ product, variant });
          }
        }
      } else {
        // If no variants, treat the product itself as a variant
        allVariants.push({ product, variant: product });
      }
    }
    logger.info('Prepared variants for inventory update', { count: allVariants.length });

    const inventoryItems = [];
    for (const { product, variant } of allVariants) {
      try {
        const mapped = mapSupplierRowToProduct(product, variant);
        const sku = mapped.supplierSku;

        if (!sku || sku === 'UNKNOWN') {
          logger.warn('Skipping inventory update for variant without valid SKU', {
            master_code: product?.master_code,
            variant_sku: variant?.sku
          });
          continue;
        }

        // Get stock quantity from stock map, default to 0 if not found
        const quantity = stockMap.get(sku) || 0;
        inventoryItems.push({
          sku: sku,
          quantity: quantity
        });
      } catch (err) {
        logger.error('Error preparing inventory item', {
          master_code: product?.master_code,
          variant_sku: variant?.sku,
          error: err.message
        });
      }
    }

    let inventoryResults = [];
    try {
      inventoryResults = await updateInventoryForItems(inventoryItems);
    } catch (err) {
      logger.error('Failed to update inventory', { error: err.message, stack: err.stack });
      syncStats.errors.push({ type: 'INVENTORY_UPDATE', error: err.message });
      inventoryResults = [];
    }

    const failed = inventoryResults.filter(r => !r.success);
    const succeeded = inventoryResults.filter(r => r.success);

    syncStats.inventoryUpdated = succeeded.length;
    syncStats.inventoryFailed = failed.length;

    if (failed.length > 0) {
      logger.warn('Inventory update failures', {
        count: failed.length,
        sample: failed.slice(0, 10).map(f => ({ sku: f.sku, error: f.error }))
      });
    }

    // Final statistics
    syncStats.endTime = new Date();
    const durationSeconds = (syncStats.endTime - syncStats.startTime) / 1000;
    syncStats.duration = formatDuration(durationSeconds);

    logger.info('Sync completed', syncStats);

    return syncStats;
  } catch (err) {
    syncStats.endTime = new Date();
    const durationSeconds = (syncStats.endTime - syncStats.startTime) / 1000;
    syncStats.duration = formatDuration(durationSeconds);
    syncStats.errors.push({ type: 'FATAL', error: err.message, stack: err.stack });

    logger.error('Fatal error in sync', {
      error: err.message,
      stack: err.stack,
      stats: syncStats
    });

    throw err;
  }
}

// Export main function for use in scheduler
module.exports = { main };

// Run main if this file is executed directly
if (require.main === module) {
  main().catch(err => {
    logger.error('Fatal error in sync', {
      error: err.message,
      stack: err.stack
    });
    process.exit(1);
  });
}
