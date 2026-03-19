const { shopifyRest, shopifyGraphql } = require('./shopifyClient');
const logger = require('./logger');
const { updateVariantImage, getProductImages, addImageToProduct } = require('./upsertProduct');
const { midoceanApiKey, midoceanBaseUrl, GRAPHQL_PRODUCTS_LIMIT } = require('./config');
const axios = require('axios');
const { sleep } = require('./shopifyClient');

const categoryFilter = ['Drink & lunchware'];
// Test limit: set to number to limit products processed (set to null/undefined for no limit)
const TEST_PRODUCT_LIMIT = null; // Change to null for production

function extractIdFromGid(gid) {
  if (!gid) return null;
  const parts = gid.split('/');
  return parts[parts.length - 1];
}

async function getAllProducts(limit = 250) {
  const allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String, $query: String!) {
        products(first: $first, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              status
              images(first: 250) {
                edges {
                  node {
                    id
                    src
                  }
                }
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                    image {
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

    const variables = { 
      first: limit,
      query: 'status:active' // Only fetch active products
    };
    if (cursor) variables.after = cursor;

    try {
      const data = await shopifyGraphql(query, variables);
      
      if (data && data.products && data.products.edges) {
        allProducts.push(...data.products.edges.map(edge => edge.node));
        hasNextPage = data.products.pageInfo.hasNextPage;
        cursor = data.products.pageInfo.endCursor;
        logger.debug('Fetched products batch', { 
          count: data.products.edges.length, 
          total: allProducts.length,
          hasNextPage 
        });
      } else {
        hasNextPage = false;
      }
    } catch (err) {
      logger.error('Error fetching products', { error: err.message });
      hasNextPage = false;
    }
  }

  return allProducts;
}

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

async function backfillVariantImages() {
  try {
    // Fetch products from supplier API
    logger.info('Fetching products from supplier API...');
    const data = await fetchSupplierProducts();
    
    if (!data) {
      throw new Error('No data returned from products API');
    }

    const productsData = Array.isArray(data) ? data : (data.products || data.items || []);

    if (!Array.isArray(productsData)) {
      throw new Error('Products data is not an array');
    }

    logger.info('Loaded products from supplier API', { count: productsData.length });
    
    // Filter products by category_level1 if filter is configured
    let filteredProductsData = productsData;
    if (categoryFilter && categoryFilter.length > 0) {
      filteredProductsData = productsData.filter(product => {
        if (!product || typeof product !== 'object') {
          return false;
        }
        // Check if any variant has a matching category_level1
        if (product.variants && Array.isArray(product.variants)) {
          return product.variants.some(variant => {
            if (!variant || typeof variant !== 'object') return false;
            const category = variant.category_level1;
            return category && typeof category === 'string' && categoryFilter.some(filter =>
              category.toLowerCase() === filter.toLowerCase()
            );
          });
        }
        return false;
      });
      logger.info('Filtered products by category', {
        total: productsData.length,
        filtered: filteredProductsData.length,
        categories: categoryFilter
      });
    } else {
      logger.info('No category filter applied - processing all products');
    }
    
    // Create a map of SKU -> variant image URLs
    const skuToImagesMap = new Map();
    for (const product of filteredProductsData) {
      if (product.variants && Array.isArray(product.variants)) {
        for (const variant of product.variants) {
          if (variant.sku && variant.digital_assets) {
            const images = [];
            for (const asset of variant.digital_assets) {
              if (asset && asset.type === 'image') {
                const imageUrl = asset.url || asset.url_highress;
                if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
                  try {
                    const normalizedUrl = encodeURI(imageUrl.trim());
                    new URL(imageUrl); // Validate URL
                    images.push(normalizedUrl);
                  } catch (err) {
                    logger.debug('Invalid image URL skipped', { sku: variant.sku, url: imageUrl });
                  }
                }
              }
            }
            if (images.length > 0) {
              skuToImagesMap.set(variant.sku, images);
            }
          }
        }
      }
    }

    logger.info('Loaded variant images from supplier API', { variantCount: skuToImagesMap.size });

    // Get all products from Shopify
    logger.info('Fetching all products from Shopify...');
    let shopifyProducts = await getAllProducts();
    logger.info('Fetched products from Shopify', { count: shopifyProducts.length });
    
    // Apply test limit if configured
    const originalCount = shopifyProducts.length;
    if (TEST_PRODUCT_LIMIT && TEST_PRODUCT_LIMIT > 0) {
      shopifyProducts = shopifyProducts.slice(0, TEST_PRODUCT_LIMIT);
      logger.info('Test limit applied', { 
        originalCount: originalCount,
        limitedCount: shopifyProducts.length,
        limit: TEST_PRODUCT_LIMIT 
      });
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const product of shopifyProducts) {
      try {
        // Skip non-active products (additional safety check)
        if (product.status && product.status !== 'ACTIVE') {
          logger.debug('Skipping non-active product', { 
            productId: product.id, 
            status: product.status 
          });
          continue;
        }

        const productId = extractIdFromGid(product.id);
        if (!productId) {
          logger.warn('Invalid product ID', { productId: product.id });
          continue;
        }

        // Get product images from GraphQL response (already fetched)
        const imageUrlToIdMap = new Map();
        if (product.images && product.images.edges) {
          for (const imageEdge of product.images.edges) {
            const image = imageEdge.node;
            if (image && image.src && image.id) {
              const imageId = extractIdFromGid(image.id);
              if (imageId) {
                imageUrlToIdMap.set(image.src, imageId);
                try {
                  const decodedUrl = decodeURI(image.src);
                  imageUrlToIdMap.set(decodedUrl, imageId);
                  // Also try encoding the decoded URL to match our stored format
                  const reencodedUrl = encodeURI(decodedUrl);
                  if (reencodedUrl !== image.src) {
                    imageUrlToIdMap.set(reencodedUrl, imageId);
                  }
                } catch (err) {
                  // If decode fails, just use the original src
                }
              }
            }
          }
        }
        
        // Fallback: Try REST API if GraphQL didn't return images (for backward compatibility)
        if (imageUrlToIdMap.size === 0) {
          logger.debug('No images from GraphQL, trying REST API', { productId });
          const productImages = await getProductImages(productId);
          for (const image of productImages) {
            if (image && image.src && image.id) {
              imageUrlToIdMap.set(image.src, image.id);
              try {
                const decodedUrl = decodeURI(image.src);
                imageUrlToIdMap.set(decodedUrl, image.id);
                const reencodedUrl = encodeURI(decodedUrl);
                if (reencodedUrl !== image.src) {
                  imageUrlToIdMap.set(reencodedUrl, image.id);
                }
              } catch (err) {
                // If decode fails, just use the original src
              }
            }
          }
        }

        // Process each variant
        if (product.variants && product.variants.edges) {
          for (const variantEdge of product.variants.edges) {
            const variant = variantEdge.node;
            if (!variant || !variant.sku) continue;

            processed++;

            // Skip if variant already has an image
            if (variant.image && variant.image.id) {
              skipped++;
              logger.debug('Variant already has image, skipping', { 
                sku: variant.sku, 
                imageId: variant.image.id 
              });
              continue;
            }

            // Get variant images from source data
            const variantImages = skuToImagesMap.get(variant.sku);
            if (!variantImages || variantImages.length === 0) {
              skipped++;
              logger.debug('No variant images found in source data', { sku: variant.sku });
              continue;
            }

            const firstImageUrl = variantImages[0];
            // Try to find image ID with multiple URL formats
            let imageId = imageUrlToIdMap.get(firstImageUrl);
            if (!imageId) {
              try {
                imageId = imageUrlToIdMap.get(decodeURI(firstImageUrl));
              } catch (err) {
                // If decode fails, continue
              }
            }

            // If image doesn't exist in product, add it
            if (!imageId) {
              logger.debug('Image not found in product, adding it', { 
                productId, 
                imageUrl: firstImageUrl 
              });
              const newImage = await addImageToProduct(productId, firstImageUrl);
              if (newImage && newImage.id) {
                imageId = newImage.id;
                imageUrlToIdMap.set(firstImageUrl, imageId);
                try {
                  imageUrlToIdMap.set(decodeURI(firstImageUrl), imageId);
                } catch (err) {}
              } else {
                logger.warn('Failed to add image to product', { 
                  productId, 
                  imageUrl: firstImageUrl 
                });
                skipped++;
                continue;
              }
            }

            // Assign image to variant
            if (imageId) {
              const success = await updateVariantImage(variant.id, imageId);
              if (success) {
                updated++;
                logger.info('Assigned image to variant', {
                  productId,
                  variantId: variant.id,
                  sku: variant.sku,
                  imageId
                });
              } else {
                errors++;
                logger.warn('Failed to assign image to variant', {
                  productId,
                  variantId: variant.id,
                  sku: variant.sku
                });
              }
            } else {
              skipped++;
              logger.warn('Could not find or create image for variant', {
                productId,
                sku: variant.sku,
                imageUrl: firstImageUrl
              });
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } catch (err) {
        errors++;
        logger.error('Error processing product', {
          productId: product.id,
          error: err.message,
          stack: err.stack
        });
      }
    }

    logger.info('Backfill complete', {
      processed,
      updated,
      skipped,
      errors
    });

    return {
      processed,
      updated,
      skipped,
      errors
    };
  } catch (err) {
    logger.error('Backfill failed', { error: err.message, stack: err.stack });
    throw err;
  }
}

if (require.main === module) {
  backfillVariantImages()
    .then((stats) => {
      logger.info('Backfill script completed', stats);
      process.exit(0);
    })
    .catch(err => {
      logger.error('Backfill script failed', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}

module.exports = { backfillVariantImages };
