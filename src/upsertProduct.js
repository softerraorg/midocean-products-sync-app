const { shopifyRest } = require('./shopifyClient');
const logger = require('./logger');
const { 
  buildProductMetafields, 
  buildVariantMetafields, 
  createProductMetafieldsInBatches,
  createVariantMetafieldsInBatches 
} = require('./metafields');
const {
  METAFIELD_BATCH_SIZE,
  METAFIELD_BATCH_DELAY_MS,
  PRODUCT_CREATION_DELAY_MS,
  MAX_PRODUCT_IMAGES,
  CREATE_WITH_FIRST_VARIANT_THRESHOLD,
  MAX_INITIAL_IMAGES_SPLIT_CREATE,
  NEW_PRODUCT_STATUS
} = require('./config');
const { sleep } = require('./shopifyClient');
const { archiveProduct, setProductStatus, ensureProductHasSyncTag } = require('./reconciliation');
const { extractIdFromGid, isProductDiscontinued } = require('./utils');
const { buildVariantData } = require('./variantBuilder');
const { findProductBySku, getProductWithAllVariants } = require('./productLookup');
const {
  getProductImages,
  addImageToProduct,
  updateVariantImage,
  addVariantToProduct,
  removeVariant,
  updateVariantPrice,
  updateVariantCustomsInfo
} = require('./shopifyProductApi');

async function addVariantMetafields(shopifyVariantId, variant) {
  if (!shopifyVariantId || !variant) {
    return;
  }

  try {
    // Convert to string first to check if it's a GID
    const variantIdStr = String(shopifyVariantId);
    const variantId = variantIdStr.includes('/') 
      ? extractIdFromGid(variantIdStr) 
      : variantIdStr;

    // Build all variant metafields
    const metafields = buildVariantMetafields(variant);
    
    // Create metafields in batches
    if (metafields.length > 0) {
        await createVariantMetafieldsInBatches(
          variantId,
          metafields,
          variant.sku || 'unknown',
          METAFIELD_BATCH_SIZE,
          METAFIELD_BATCH_DELAY_MS
        );
    }
  } catch (err) {
    logger.error('Error adding variant metafields', {
      shopify_variant_id: shopifyVariantId,
      sku: variant.sku,
      error: err.message,
      stack: err.stack
    });
  }
}

async function createProductWithVariants(productData, variants, priceMap = null) {
  if (!productData || typeof productData !== 'object') {
    throw new Error('Invalid productData provided to createProductWithVariants');
  }

  if (!variants || !Array.isArray(variants) || variants.length === 0) {
    throw new Error('Invalid or empty variants array provided to createProductWithVariants');
  }

  // Build variants array for Shopify with validation
  const shopifyVariants = [];
  const variantIdMap = new Map(); // Map to store variant_id for each variant (by index)
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    
    if (!variant || typeof variant !== 'object') {
      logger.warn('Skipping invalid variant', { index: i, master_code: productData.master_code });
      continue;
    }

    const variantData = buildVariantData(variant, priceMap, productData);
    if (variantData) {
      shopifyVariants.push(variantData);
      // Store variant_id if it exists for later metafield creation
      if (variant.variant_id) {
        variantIdMap.set(i, variant.variant_id);
      }
    }
  }

  if (shopifyVariants.length === 0) {
    throw new Error('No valid variants to create product');
  }

  // Collect images from ALL variants and track variant-to-image mapping
  const productImages = [];
  const variantImageMap = new Map(); // Map variant index -> array of image URLs
  const imageUrlSet = new Set(); // Track unique image URLs to avoid duplicates
  
  // Collect images from all variants
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const variantImages = [];
    
    if (variant && variant.digital_assets && Array.isArray(variant.digital_assets)) {
      for (const asset of variant.digital_assets) {
        if (asset && asset.type === 'image') {
          const imageUrl = asset.url || asset.url_highress;
          if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
            // Validate URL format
            try {
              const normalizedUrl = encodeURI(imageUrl.trim());
              new URL(imageUrl); // Validate URL format
              
              // Add to product images if not already added
              if (!imageUrlSet.has(normalizedUrl)) {
                productImages.push({ src: normalizedUrl });
                imageUrlSet.add(normalizedUrl);
              }
              
              // Track this image for this variant
              variantImages.push(normalizedUrl);
            } catch (err) {
              logger.warn('Invalid image URL skipped', { url: imageUrl, master_code: productData.master_code });
            }
          }
        }
      }
    }
    
    // Store variant images mapping (use first image as primary for variant)
    if (variantImages.length > 0) {
      variantImageMap.set(i, variantImages);
    }
  }
  
  // Product-level digital_assets for metafield (full array, no type filtering)
  const productDigitalAssets = (productData && productData.digital_assets && Array.isArray(productData.digital_assets))
    ? productData.digital_assets
    : [];

  // Determine if we need options (if variants have different colors, including pms_color as fallback)
  const hasColorVariants = variants.some(v => v.color_description || v.color_group || v.pms_color);
  const options = hasColorVariants ? [{ name: 'Color' }] : [];

  // Build tags array - add master_code, product_name, category levels, and printable
  const tags = new Set(); // Use Set to avoid duplicates
  
  // Tag to identify products managed by this sync (for archive/activate reconciliation)
  tags.add('midocean-sync');
  // Add master_code as tag if it exists
  if (productData.master_code) {
    tags.add(productData.master_code);
  }
  
  // Add product_name as tag if it exists
  if (productData.product_name) {
    tags.add(productData.product_name);
  }
  
  // Add printable as tag if it's "yes"
  if (productData.printable && productData.printable.toLowerCase() === 'yes') {
    tags.add('Printable');
  }
  
  // Collect all category levels from variants
  const categoryLevels = new Set();
  for (const variant of variants) {
    if (variant.category_level1) {
      categoryLevels.add(variant.category_level1);
    }
    if (variant.category_level2) {
      categoryLevels.add(variant.category_level2);
    }
    if (variant.category_level3) {
      categoryLevels.add(variant.category_level3);
    }
  }
  
  // Add all category levels to tags
  categoryLevels.forEach(category => tags.add(category));

  const productBase = {
    title: productData.short_description || productData.product_name || 'Untitled Product',
    body_html: productData.long_description || productData.short_description || '',
    vendor: productData.brand || 'midocean',
    product_type: productData.product_class || '',
    status: NEW_PRODUCT_STATUS,
    tags: Array.from(tags).join(', '),
    options: options
  };

  const useSplitCreate = CREATE_WITH_FIRST_VARIANT_THRESHOLD > 0 && variants.length > CREATE_WITH_FIRST_VARIANT_THRESHOLD;
  let response;
  let createdProduct;

  if (useSplitCreate) {
    // Create product with first variant and limited images to avoid 500 on large payloads
    const initialImages = (variantImageMap.get(0) || []).slice(0, MAX_INITIAL_IMAGES_SPLIT_CREATE).map(url => ({ src: url }));
    const payload = {
      product: {
        ...productBase,
        variants: [shopifyVariants[0]],
        images: initialImages
      }
    };
    try {
      response = await shopifyRest('POST', '/products.json', payload);
    } catch (err) {
      logger.error('Failed to create product in Shopify', {
        master_code: productData.master_code,
        error: err.message,
        responseData: err.response?.data,
        stack: err.stack
      });
      throw err;
    }
    if (!response || !response.product) {
      throw new Error('Invalid response from Shopify: missing product data');
    }
    createdProduct = response.product;
    logger.info('Product created with first variant (split flow), adding remaining variants', {
      master_code: productData.master_code,
      shopify_id: createdProduct.id,
      totalVariants: variants.length
    });

    const productId = createdProduct.id;
    const imageUrlToIdMap = new Map();
    if (createdProduct.images && Array.isArray(createdProduct.images)) {
      for (const image of createdProduct.images) {
        if (image && image.src && image.id) {
          imageUrlToIdMap.set(image.src, image.id);
          try {
            const decodedUrl = decodeURI(image.src);
            imageUrlToIdMap.set(decodedUrl, image.id);
            const reencodedUrl = encodeURI(decodedUrl);
            if (reencodedUrl !== image.src) imageUrlToIdMap.set(reencodedUrl, image.id);
          } catch (err) {}
        }
      }
    }

    const assignVariantImage = async (shopifyVariantId, variantIndex) => {
      const variantImages = variantImageMap.get(variantIndex);
      if (!variantImages || variantImages.length === 0) return;
      const firstImageUrl = variantImages[0];
      let imageId = imageUrlToIdMap.get(firstImageUrl) || imageUrlToIdMap.get(decodeURI(firstImageUrl));
      if (!imageId) {
        const newImage = await addImageToProduct(productId, firstImageUrl);
        if (newImage && newImage.id) {
          imageId = newImage.id;
          imageUrlToIdMap.set(firstImageUrl, imageId);
          try { imageUrlToIdMap.set(decodeURI(firstImageUrl), imageId); } catch (err) {}
        }
      }
      if (imageId) await updateVariantImage(shopifyVariantId, imageId);
    };

    const shopifyVariant0 = createdProduct.variants && createdProduct.variants[0];
    if (shopifyVariant0 && variants[0]) {
      await updateVariantCustomsInfo(shopifyVariant0.id, productData, shopifyVariant0.inventory_item_id || null);
      await addVariantMetafields(shopifyVariant0.id, variants[0]);
      await assignVariantImage(shopifyVariant0.id, 0);
    }

    for (let i = 1; i < variants.length; i++) {
      const variantData = shopifyVariants[i];
      const sourceVariant = variants[i];
      if (!variantData) continue;
      const added = await addVariantToProduct(productId, variantData);
      if (added && added.id) {
        await updateVariantCustomsInfo(added.id, productData, added.inventory_item_id || null);
        await addVariantMetafields(added.id, sourceVariant);
        await assignVariantImage(added.id, i);
      }
      await sleep(PRODUCT_CREATION_DELAY_MS);
    }

    const metafields = buildProductMetafields(productData, productDigitalAssets);
    if (metafields.length > 0) {
      await createProductMetafieldsInBatches(productId, metafields, productData.master_code, METAFIELD_BATCH_SIZE, METAFIELD_BATCH_DELAY_MS);
    }
    return createdProduct;
  }

  const payload = {
    product: {
      ...productBase,
      variants: shopifyVariants,
      images: productImages.slice(0, MAX_PRODUCT_IMAGES)
    }
  };

  try {
    response = await shopifyRest('POST', '/products.json', payload);
  } catch (err) {
    logger.error('Failed to create product in Shopify', {
      master_code: productData.master_code,
      error: err.message,
      responseData: err.response?.data,
      stack: err.stack
    });
    throw err;
  }

  if (!response || !response.product) {
    logger.error('Invalid response from Shopify product creation', {
      master_code: productData.master_code,
      response: response
    });
    throw new Error('Invalid response from Shopify: missing product data');
  }

  createdProduct = response.product;
  logger.info('Product created successfully', {
    master_code: productData.master_code,
    shopify_id: createdProduct.id,
    variant_count: shopifyVariants.length
  });

  if (createdProduct.images && Array.isArray(createdProduct.images) && variantImageMap.size > 0) {
    const imageUrlToIdMap = new Map();
    for (const image of createdProduct.images) {
      if (image && image.src && image.id) {
        imageUrlToIdMap.set(image.src, image.id);
        try {
          const decodedUrl = decodeURI(image.src);
          imageUrlToIdMap.set(decodedUrl, image.id);
          const reencodedUrl = encodeURI(decodedUrl);
          if (reencodedUrl !== image.src) imageUrlToIdMap.set(reencodedUrl, image.id);
        } catch (err) {}
      }
    }
    if (createdProduct.variants && Array.isArray(createdProduct.variants)) {
      for (let i = 0; i < createdProduct.variants.length && i < variants.length; i++) {
        const shopifyVariant = createdProduct.variants[i];
        const variantImages = variantImageMap.get(i);
        if (shopifyVariant && shopifyVariant.id && variantImages && variantImages.length > 0) {
          const firstImageUrl = variantImages[0];
          let imageId = imageUrlToIdMap.get(firstImageUrl);
          if (!imageId) {
            try { imageId = imageUrlToIdMap.get(decodeURI(firstImageUrl)); } catch (err) {}
          }
          if (imageId) {
            await updateVariantImage(shopifyVariant.id, imageId);
            logger.debug('Assigned image to variant', { variantId: shopifyVariant.id, sku: shopifyVariant.sku, imageId });
          } else {
            logger.debug('Could not find image ID for variant image URL', { variantId: shopifyVariant.id, sku: shopifyVariant.sku, imageUrl: firstImageUrl });
          }
        }
      }
    }
  }

  if (createdProduct.variants && Array.isArray(createdProduct.variants)) {
    for (let i = 0; i < createdProduct.variants.length && i < variants.length; i++) {
      const shopifyVariant = createdProduct.variants[i];
      const sourceVariant = variants[i];
      if (shopifyVariant && shopifyVariant.id && sourceVariant) {
        const inventoryItemId = shopifyVariant.inventory_item_id || null;
        await updateVariantCustomsInfo(shopifyVariant.id, productData, inventoryItemId);
        await addVariantMetafields(shopifyVariant.id, sourceVariant);
      }
    }
  }

  if (createdProduct.id) {
    const productId = createdProduct.id;
    const metafields = buildProductMetafields(productData, productDigitalAssets);
    if (metafields.length > 0) {
      await createProductMetafieldsInBatches(productId, metafields, productData.master_code, METAFIELD_BATCH_SIZE, METAFIELD_BATCH_DELAY_MS);
    }
  }

  return createdProduct;
}

async function syncVariantsForProduct(productId, sourceVariants, priceMap = null, productData = null) {
  if (!productId || !sourceVariants || !Array.isArray(sourceVariants)) {
    logger.warn('Invalid parameters for syncVariantsForProduct', { productId, sourceVariants });
    return { added: 0, removed: 0, updated: 0 };
  }

  const stats = { added: 0, removed: 0, updated: 0 };

  try {
    // Get full product with all existing variants
    const product = await getProductWithAllVariants(productId);
    if (!product || !product.variants) {
      logger.warn('Could not get product variants for sync', { productId });
      return stats;
    }

    // Build maps for comparison
    const existingVariantsMap = new Map();
    const sourceVariantsMap = new Map();

    // Map existing variants by SKU
    if (product.variants.edges && Array.isArray(product.variants.edges)) {
      for (const edge of product.variants.edges) {
        const variant = edge.node;
        if (variant && variant.sku) {
          existingVariantsMap.set(variant.sku, variant);
        }
      }
    }

    // Map source variants by SKU
    for (const variant of sourceVariants) {
      if (variant && variant.sku) {
        sourceVariantsMap.set(variant.sku, variant);
      }
    }

    // Build image URL -> image ID map from GraphQL response (avoids REST 400 on GET /products/{id}.json)
    const imageUrlToIdMap = new Map();
    if (product.images && product.images.edges && Array.isArray(product.images.edges)) {
      for (const imageEdge of product.images.edges) {
        const image = imageEdge.node;
        if (image && image.url && image.id) {
          const imageId = extractIdFromGid(image.id);
          if (imageId) {
            imageUrlToIdMap.set(image.url, imageId);
            try {
              const decodedUrl = decodeURI(image.url);
              imageUrlToIdMap.set(decodedUrl, imageId);
              const reencodedUrl = encodeURI(decodedUrl);
              if (reencodedUrl !== image.url) {
                imageUrlToIdMap.set(reencodedUrl, imageId);
              }
            } catch (err) {
              // If decode fails, keep original url mapping only
            }
          }
        }
      }
    }

    // Find variants to add (exist in source but not in Shopify)
    for (const [sku, sourceVariant] of sourceVariantsMap) {
      if (!existingVariantsMap.has(sku)) {
        const variantData = buildVariantData(sourceVariant, priceMap, productData);
        if (variantData) {
          const added = await addVariantToProduct(productId, variantData);
          if (added && added.id) {
            // Update customs information (country_code_of_origin and harmonized_system_code)
            // Pass inventory_item_id if available in the response to avoid extra API call
            const inventoryItemId = added.inventory_item_id || null;
            await updateVariantCustomsInfo(added.id, productData, inventoryItemId);
            
            // Handle variant images for NEW variants only
            // Note: Existing variants do not get their images synced to avoid overwriting manual changes
            if (sourceVariant && sourceVariant.digital_assets && Array.isArray(sourceVariant.digital_assets)) {
              const variantImages = [];
              for (const asset of sourceVariant.digital_assets) {
                if (asset && asset.type === 'image') {
                  const imageUrl = asset.url || asset.url_highress;
                  if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
                    try {
                      const normalizedUrl = encodeURI(imageUrl.trim());
                      new URL(imageUrl); // Validate URL
                      variantImages.push(normalizedUrl);
                    } catch (err) {
                      logger.debug('Invalid variant image URL skipped', { sku, url: imageUrl });
                    }
                  }
                }
              }
              
              // Assign first variant image to the variant
              if (variantImages.length > 0) {
                const firstImageUrl = variantImages[0];
                let imageId = imageUrlToIdMap.get(firstImageUrl) || imageUrlToIdMap.get(decodeURI(firstImageUrl));
                
                // If image doesn't exist, add it to the product
                if (!imageId) {
                  const newImage = await addImageToProduct(productId, firstImageUrl);
                  if (newImage && newImage.id) {
                    imageId = newImage.id;
                    // Update the map for future variants
                    imageUrlToIdMap.set(firstImageUrl, imageId);
                    imageUrlToIdMap.set(decodeURI(firstImageUrl), imageId);
                  }
                }
                
                // Assign image to variant
                if (imageId) {
                  await updateVariantImage(added.id, imageId);
                  logger.debug('Assigned image to new variant', { variantId: added.id, sku, imageId });
                }
              }
            }
            
            // Add variant metafields after variant is created
            await addVariantMetafields(added.id, sourceVariant);
            stats.added++;
            logger.info('Added new variant to product', { productId, sku });
          }
        }
      } else {
        // Variant exists - update price if pricelist is available
        // Note: Variant images are NOT synced for existing variants to avoid overwriting manual changes
        // Use backfillVariantImages.js script for one-time backfill of variant images
        // const existingVariant = existingVariantsMap.get(sku);
        // if (priceMap && existingVariant) {
        //   const newPrice = priceMap.get(sku);
        //   if (newPrice) {
        //     const priceUpdated = await updateVariantPrice(existingVariant.id, newPrice);
        //     if (priceUpdated) {
        //       stats.updated++;
        //       logger.debug('Updated variant price', { productId, sku, price: newPrice });
        //     }
        //   }
        // }
      }
    }

    // Find variants to remove (exist in Shopify but not in source)
    for (const [sku, existingVariant] of existingVariantsMap) {
      if (!sourceVariantsMap.has(sku)) {
        const removed = await removeVariant(existingVariant.id);
        if (removed) {
          stats.removed++;
          logger.info('Removed variant from product', { productId, sku });
        }
      }
    }

    if (stats.added > 0 || stats.removed > 0 || stats.updated > 0) {
      logger.info('Product already exists, Variant sync completed', { productId, ...stats });
    }
    return stats;
  } catch (err) {
    logger.error('Error syncing variants for product', {
      productId,
      error: err.message,
      stack: err.stack
    });
    return stats;
  }
}

async function upsertProduct(productData, variants, priceMap = null) {
  // Check if product is discontinued
  const isDiscontinued = isProductDiscontinued(productData, variants);
  
  // Check if any variant SKU already exists
  for (const variant of variants) {
    if (variant.sku) {
      const existingProduct = await findProductBySku(variant.sku);
      if (existingProduct) {
        // Extract numeric ID from GID if needed
        const productId = existingProduct.id.includes('/') 
          ? extractIdFromGid(existingProduct.id) 
          : existingProduct.id;
        
        // If product is discontinued and not already archived, archive it
        if (isDiscontinued && existingProduct.status !== 'ARCHIVED') {
          logger.info('Product is discontinued, archiving...', { sku: variant.sku, productId });
          await archiveProduct(productId);
        } else if (!isDiscontinued && existingProduct.status === 'ARCHIVED') {
          logger.info('Product back in API, activating...', { sku: variant.sku, productId });
          await setProductStatus(productId, 'active');
        }
        
        // Sync variants (add/remove/update)
        if (!isDiscontinued) {
          await ensureProductHasSyncTag(productId);
          await syncVariantsForProduct(productId, variants, priceMap, productData);
        }
        
        return existingProduct;
      }
    }
  }

  // If product is discontinued, don't create it
  if (isDiscontinued) {
    logger.info('Product is discontinued, skipping creation', { master_code: productData.master_code });
    return null;
  }

  // Create new product with variants
  logger.info('Creating new product with variants', { master_code: productData.master_code, variantCount: variants.length });
  const createdProduct = await createProductWithVariants(productData, variants, priceMap);
  return createdProduct;
}

module.exports = {
  upsertProduct,
  updateVariantImage,
  getProductImages,
  addImageToProduct
};
